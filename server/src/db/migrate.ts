/**
 * The migration runner. Plain SQL files, applied in filename order, each in its
 * own transaction.
 *
 * There is deliberately no ORM: it would not describe RLS policies, partial
 * unique indexes or triggers anyway, and hiding those behind an abstraction is
 * more dangerous than keeping them in SQL you can read whole.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations')

/** The newest migration this build carries, for a process that must not run ahead of it. */
export function newestMigration(): string | null {
  try {
    return (
      readdirSync(MIGRATIONS)
        .filter((f) => f.endsWith('.sql'))
        .sort()
        .at(-1) ?? null
    )
  } catch {
    return null
  }
}

/**
 * `after` runs on the same connection once the files are in — the edition's
 * own step (`edition.migrated`), which for the service makes the operators
 * match `OPERATORS`.
 */
export async function migrate(url: string, after?: (sql: postgres.Sql) => Promise<void>): Promise<string[]> {
  // Migrations run as the table owner, not as the application role.
  const sql = postgres(url, { max: 1, onnotice: () => {} })
  const applied: string[] = []
  try {
    await sql`
      create table if not exists schema_migration (
        name       text primary key,
        applied_at timestamptz not null default now()
      )`

    const done = new Set((await sql<{ name: string }[]>`select name from schema_migration`).map((r) => r.name))
    const files = readdirSync(MIGRATIONS)
      .filter((f) => f.endsWith('.sql'))
      .sort()

    for (const file of files) {
      if (done.has(file)) continue
      const body = readFileSync(join(MIGRATIONS, file), 'utf8')
      await sql.begin(async (tx) => {
        await tx.unsafe(body)
        await tx`insert into schema_migration (name) values (${file})`
      })
      applied.push(file)
    }
    await letTheAppIn(sql)
    await letTheAppIn(sql, process.env.DATABASE_URL_WORKER, 'tracker_worker')
    await after?.(sql)
    return applied
  } finally {
    await sql.end()
  }
}

/**
 * Give the application role a way to log in.
 *
 * Migration 002 creates `tracker_app` as `nologin` with no password, which is
 * right — a password in a migration is a password in the repository. But
 * nothing else set one either, so the role could only ever connect on a
 * machine where somebody had typed the statement by hand.
 *
 * That is exactly what had happened: it worked on the one laptop that had
 * done it, and CI failed on every push since the job was written with
 * `password authentication failed for user "tracker_app"`. A database that
 * only one machine can produce is not a database the project has.
 *
 * So the password comes from `DATABASE_URL_APP` — the same string the
 * application will connect with, which is where the answer already is. In
 * development and CI that is a throwaway; in production it is whatever the
 * operator put in the environment, and this makes the role match it rather
 * than inventing anything.
 */
async function letTheAppIn(sql: postgres.Sql, url = process.env.DATABASE_URL_APP, only?: string): Promise<void> {
  /* The worker's role the same way, from `DATABASE_URL_WORKER` — and only
     that role: a string naming another user is a mistake, not a request to
     give the owner a new password. */
  if (!url) return
  let who: URL
  try {
    who = new URL(url)
  } catch {
    return
  }
  const role = decodeURIComponent(who.username)
  const secret = decodeURIComponent(who.password)
  if (!role || !secret || (only && role !== only)) return
  // Identifiers cannot be parameters, and the password must not be one either
  // — `alter role` takes a literal. Both are quoted by the server rather than
  // by hand: `format` with %I and %L is the escaping, not a concatenation
  // somebody has to get right.
  await sql`select format('alter role %I login password %L', ${role}::text, ${secret}::text)`.then((rows) =>
    sql.unsafe((rows[0] as { format: string }).format),
  )
}

// The project path contains a space, so comparing strings against file:// does
// not work: pathToFileURL encodes it as %20, a template string does not.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url = process.env.DATABASE_URL ?? 'postgres://tracker:tracker@localhost:5433/tracker'
  /* Imported here and not above: the worker and the server read this file
     for `newestMigration`, and need none of what the edition mounts. */
  const { edition } = await import('../edition.js')
  const applied = await migrate(url, (sql) => edition.migrated(sql))
  console.log(applied.length ? `applied: ${applied.join(', ')}` : 'no migrations to apply')
}
