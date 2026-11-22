/**
 * The migration runner. Plain SQL files, applied in filename order, each in its
 * own transaction.
 *
 * There is deliberately no ORM: it would not describe RLS policies, partial
 * unique indexes or triggers anyway, and hiding those behind an abstraction is
 * more dangerous than keeping them in SQL you can read whole.
 */
import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'
import { authUrlFrom } from './authUrl.js'

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

/** The session lock one migrator holds at a time — any fixed number, this one. */
const MIGRATION_LOCK = 7_295_000_295

/**
 * Whether a migration's SQL holds something Postgres will not run inside a
 * transaction block, or that a later file in the same transaction could
 * not use. Read with its comments taken out, so prose that names one does
 * not count.
 */
export function outsideATransaction(body: string): boolean {
  const code = body.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ')
  return /\b(concurrently|add\s+value|vacuum|alter\s+system|create\s+database|drop\s+database|reindex\s+database)\b/i.test(code)
}

/**
 * The migrators' lock, asked for until it is free or `wait` runs out.
 * `pg_advisory_lock` would wait inside Postgres, saying nothing, for as
 * long as the other start takes; this says that it waits, and stops.
 */
async function takeTheLock(sql: postgres.Sql, wait: number): Promise<void> {
  const until = Date.now() + wait
  let said = 0
  for (;;) {
    const [r] = await sql<{ got: boolean }[]>`select pg_try_advisory_lock(${MIGRATION_LOCK}) as got`
    if (r?.got) return
    if (Date.now() >= until) {
      throw new Error(`[migrate] Another migrator held the lock for ${Math.round(wait / 60_000)} minutes; giving up.`)
    }
    if (Date.now() - said >= 10_000) {
      console.log('[migrate] Waiting for another migrator to finish…')
      said = Date.now()
    }
    await new Promise((r) => setTimeout(r, Math.min(2_000, Math.max(50, until - Date.now()))))
  }
}

/**
 * Between two files of one transaction, what a commit between them would
 * have done to the constraints: every deferrable one checked now, then put
 * back to how it was declared. Migration 287 made `file.held_by` deferred,
 * so a file that deletes from `file` leaves trigger events pending, and a
 * later `alter table file` in the same transaction is refused ("pending
 * trigger events"). Not `set constraints all immediate`, which would hold
 * for the rest of the transaction — constraints a later file makes among
 * them — and check a later file's deferred ones before it meant them to
 * be. By name instead: those that exist now, immediate, then the ones
 * declared deferred back to deferred.
 */
export async function settleConstraints(tx: postgres.TransactionSql): Promise<void> {
  const rows = await tx<{ name: string; deferred: boolean }[]>`
    select format('%I.%I', n.nspname, c.conname) as name, bool_and(c.condeferred) as deferred
    from pg_constraint c join pg_namespace n on n.oid = c.connamespace
    where c.condeferrable
    group by 1`
  if (!rows.length) return
  await tx.unsafe(`set constraints ${rows.map((r) => r.name).join(', ')} immediate`)
  const back = rows.filter((r) => r.deferred).map((r) => r.name)
  if (back.length) await tx.unsafe(`set constraints ${back.join(', ')} deferred`)
}

/** What is about to be applied, told to `before` while nothing has been yet. */
export type Pending = {
  /** The files not yet applied, in the order they will be. */
  pending: string[]
  /** The files applied before this run — none on a new database. */
  done: string[]
  /** The table owner's connection, the one that is about to migrate. */
  sql: postgres.Sql
}

/**
 * `after` runs on the same connection once the files are in — the edition's
 * own step (`edition.migrated`), which for the service makes the operators
 * match `OPERATORS`.
 *
 * `before` runs once something is pending and before any of it is applied
 * — on your own server, the backup (`backup.ts`). If it throws, nothing is
 * applied and the error is the caller's. `dir` is for a test's own files.
 *
 * One migrator at a time: a session lock on this connection, taken before
 * anything is read and held through `before`, the files and `after`, so a
 * second start waits and then finds nothing pending. It is asked for, not
 * waited on in Postgres: every two seconds, saying so every ten, for up to
 * half an hour — as long as a backup of a large database may take — and
 * then the start fails and is started again. And no statement waits more
 * than `lock_timeout` (ten seconds) for a lock a request holds: a migration
 * stuck behind a long query fails, and is tried again, rather than holding
 * every lock it took so far while the app's requests queue behind it.
 *
 * With `whole` — your own server, which backs up first — the pending files
 * go in **one transaction** on a database migrated before, when none of
 * them needs to run outside one, so a migration that fails leaves the
 * database exactly as the backup taken in `before` has it, and the next
 * start finds the same files pending. A file that cannot share a
 * transaction — `create index concurrently`, `alter type … add value` (a
 * value added cannot be used before its transaction commits), `vacuum`,
 * `alter system`, a database made or dropped — puts the run back to one
 * transaction per file. Between files, every deferrable constraint is
 * checked then and there and put back to how it was declared
 * (`settleConstraints`), as a commit between them would have. A new
 * database is migrated one file at a time, as it always was, and so is the
 * service: its old container keeps serving while the new one migrates, a
 * batch would hold every lock its first file took until the last commits,
 * and there is no backup to undo it with.
 */
export async function migrate(
  url: string,
  after?: (sql: postgres.Sql) => Promise<void>,
  opts: {
    before?: ((p: Pending) => Promise<void>) | undefined
    dir?: string | undefined
    whole?: boolean | undefined
    /** How long to ask for the migrators' lock, in milliseconds — a test's. */
    lockWait?: number | undefined
  } = {},
): Promise<string[]> {
  const dir = opts.dir ?? MIGRATIONS
  // Migrations run as the table owner, not as the application role.
  const sql = postgres(url, { max: 1, onnotice: () => {}, connection: { lock_timeout: 10_000 } })
  const applied: string[] = []
  try {
    await takeTheLock(sql, opts.lockWait ?? 30 * 60_000)
    await sql`
      create table if not exists schema_migration (
        name       text primary key,
        applied_at timestamptz not null default now()
      )`

    const done = new Set((await sql<{ name: string }[]>`select name from schema_migration`).map((r) => r.name))
    const files = readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .sort()
    const pending = files.filter((f) => !done.has(f))
    if (pending.length && opts.before) await opts.before({ pending, done: [...done].sort(), sql })

    const bodies = pending.map((file) => ({ file, body: readFileSync(join(dir, file), 'utf8') }))
    const whole = Boolean(opts.whole) && done.size > 0 && bodies.every((b) => !outsideATransaction(b.body))
    if (pending.length) {
      console.log(`[migrate] Applying ${pending.length} migration(s)${whole && pending.length > 1 ? ' in one transaction' : ''}…`)
    }
    if (whole && bodies.length) {
      await sql.begin(async (tx) => {
        for (const [i, { file, body }] of bodies.entries()) {
          if (i > 0) await settleConstraints(tx)
          await tx.unsafe(body)
          await tx`insert into schema_migration (name) values (${file})`
        }
      })
      applied.push(...pending)
    } else {
      for (const { file, body } of bodies) {
        await sql.begin(async (tx) => {
          await tx.unsafe(body)
          await tx`insert into schema_migration (name) values (${file})`
        })
        applied.push(file)
      }
    }
    await letTheAppIn(sql)
    await letTheAppIn(sql, process.env.DATABASE_URL_WORKER, 'tracker_worker')
    /* The sign-in role from `DATABASE_URL_AUTH`, or from what `db/authUrl.ts`
       makes of `DATABASE_URL_APP` — the string the serving start connects
       with, so the two cannot disagree. Once it exists (migration 308). */
    await letTheAppIn(sql, authUrlFrom(process.env.DATABASE_URL_AUTH, process.env.DATABASE_URL_APP), 'tracker_auth')
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
  /* A role a migration has not made yet — the sign-in role on a database
     migrated by a build older than 308 — is left for the start that makes it. */
  const [known] = await sql<{ yes: boolean }[]>`select exists (select 1 from pg_roles where rolname = ${role}) as yes`
  if (!known?.yes) return
  // Identifiers cannot be parameters, and the password must not be one either
  // — `alter role` takes a literal. Both are quoted by the server rather than
  // by hand: `format` with %I and %L is the escaping, not a concatenation
  // somebody has to get right.
  //
  // And what is sent is a SCRAM-SHA-256 verifier made here, never the
  // password: a statement that fails, or a server set to `log_statement =
  // ddl` (or `all`, which logs the parameter of the `format` too), writes it
  // to the log whole, and a verifier there cannot be signed in with.
  // Postgres stores a verifier it is handed as it is.
  const [made] = await sql<{ format: string }[]>`
    select format('alter role %I login password %L', ${role}::text, ${scramVerifier(secret)}::text)`
  await sql.unsafe(made!.format)
}

/**
 * The SCRAM-SHA-256 verifier Postgres would store for `password` — RFC 5802
 * and 7677, as `pg_authid.rolpassword` holds it:
 * `SCRAM-SHA-256$<iterations>:<salt>$<StoredKey>:<ServerKey>`, base64.
 *
 * Over the password's raw UTF-8 bytes, nothing normalised: that is what the
 * client proves against when it signs in — postgres.js runs PBKDF2 over the
 * password exactly as given — so a verifier made from anything else (a
 * SASLprep or NFKC form of a non-ASCII password) would lock the role out.
 * Every password made for these roles is printable ASCII anyway
 * (`setup.sh`, the template's `secret()`, `db/authUrl.ts`).
 */
export function scramVerifier(password: string, salt: Buffer = randomBytes(16), iterations = 4096): string {
  const salted = pbkdf2Sync(Buffer.from(password, 'utf8'), salt, iterations, 32, 'sha256')
  const hmac = (key: Buffer, text: string) => createHmac('sha256', key).update(text).digest()
  const stored = createHash('sha256').update(hmac(salted, 'Client Key')).digest()
  const server = hmac(salted, 'Server Key')
  return `SCRAM-SHA-256$${iterations}:${salt.toString('base64')}$${stored.toString('base64')}:${server.toString('base64')}`
}
