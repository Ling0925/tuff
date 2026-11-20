/**
 * Every secret kept at rest, sealed again under `ENCRYPTION_KEY` —
 * `auth/seal.ts`, and "Rotating the secrets" in `docs/self-hosting.md`.
 *
 *   pnpm --filter @tracker/server reseal          (from a checkout)
 *   node --conditions=compiled server/dist/reseal.js   (in the image)
 *
 * Run once after `ENCRYPTION_KEY` is first set, so nothing is left under
 * the keys derived from `JWT_SECRET` and that secret can then be changed
 * on its own; and once after `ENCRYPTION_KEY` itself is changed with the
 * old one in `ENCRYPTION_KEY_PREVIOUS`, before that is taken away.
 *
 * As the table owner (`DATABASE_URL`): these columns are selectable by no
 * application role, on purpose. Each row is written only if it still holds
 * what was read, so a person enrolling or reconnecting meanwhile is never
 * overwritten with their old secret. Safe to run again; a second run finds
 * nothing to do. Rows that will not open under any key the server has are
 * counted and left as they are — the person's recovery codes still work,
 * and the integration says it needs connecting again.
 */
import { pathToFileURL } from 'node:url'
import postgres from 'postgres'
import { envRing, open, type Ring, seal, type Sealing, stale } from './auth/seal.js'
import { env } from './env.js'

/** Where sealed things live: table, its key column, the sealed column, and how it was sealed. */
export const SEALED: readonly { table: string; id: string; column: string; kind: Sealing }[] = [
  { table: 'app_user', id: 'actor_id', column: 'totp_secret_enc', kind: 'totp' },
  { table: 'github_person', id: 'actor_id', column: 'token_enc', kind: 'github' },
  { table: 'github_person', id: 'actor_id', column: 'refresh_enc', kind: 'github' },
  { table: 'slack_connection', id: 'id', column: 'token_enc', kind: 'github' },
  { table: 'linear_import', id: 'id', column: 'key_enc', kind: 'github' },
  { table: 'webhook', id: 'id', column: 'authorization_enc', kind: 'webhook' },
  { table: 'instance_mail', id: 'id', column: 'smtp_password_enc', kind: 'mail' },
  { table: 'instance_mail', id: 'id', column: 'resend_key_enc', kind: 'mail' },
  { table: 'instance_push_key', id: 'id', column: 'private_key_enc', kind: 'vapid' },
]

export type Resealed = { moved: number; unreadable: number /** `table.column id=…` of each one that would not open. */; which: string[] }

/** `only`, a list of row ids, narrows it to those rows — for a test on a shared database. */
export async function reseal(sql: postgres.Sql, ring: Ring = envRing(), only?: readonly string[]): Promise<Resealed> {
  const out: Resealed = { moved: 0, unreadable: 0, which: [] }
  if (!ring.current) return out
  for (const s of SEALED) {
    const rows = await sql<{ id: string; sealed: string }[]>`
      select ${sql(s.id)}::text as id, ${sql(s.column)} as sealed from ${sql(s.table)}
      where ${sql(s.column)} is not null ${only ? sql`and ${sql(s.id)}::text = any(${only as string[]})` : sql``}`
    for (const r of rows) {
      if (!stale(r.sealed, ring)) continue
      const plain = open(s.kind, r.sealed, ring)
      if (plain === null) {
        out.unreadable += 1
        /* Where it is, never what: the row's id says whose 2FA to reset or
           which integration to connect again. */
        out.which.push(`${s.table}.${s.column} ${s.id}=${r.id}`)
        continue
      }
      const done = await sql`
        update ${sql(s.table)} set ${sql(s.column)} = ${seal(s.kind, plain, ring)}
        where ${sql(s.id)}::text = ${r.id} and ${sql(s.column)} = ${r.sealed}`
      out.moved += done.count
    }
  }
  return out
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!env.encryptionKey) {
    console.error('ENCRYPTION_KEY is not set, so there is nothing to seal again: secrets stay under keys from JWT_SECRET.')
    process.exit(2)
  }
  const sql = postgres(env.databaseUrl, { max: 1, onnotice: () => {} })
  try {
    const r = await reseal(sql)
    console.log(`sealed again under ENCRYPTION_KEY: ${r.moved}`)
    if (r.unreadable) {
      console.log(`would not open under any key this server has, and left as they were: ${r.unreadable}`)
      for (const w of r.which) console.log(`  ${w}`)
      process.exitCode = 1
    }
  } finally {
    await sql.end()
  }
}
