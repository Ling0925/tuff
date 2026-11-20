/**
 * Whether a development script may write to this database.
 *
 * `pnpm seed`, `pnpm dev:account` and `pnpm load` make accounts whose
 * password is written in this repository, and the first two delete what
 * they made last time. On a real server either is a door anybody who has
 * read the code can open, so they run only against a database on this
 * machine, and never under `NODE_ENV=production`.
 *
 * Two signals, because each misses a case the other catches. `NODE_ENV` is
 * what a production container says (`docker-compose.prod.yml` sets it), and
 * a shell pointed at production by hand does not say it. The database's
 * host is what that shell does say: a hosted Postgres is somewhere else,
 * and the development one — Compose's on `localhost:5455`, CI's service
 * container — is here. A Unix socket counts as here.
 *
 * `SEED_ANY_DATABASE=1` lets a script through to a development database on
 * another machine, on purpose; it does not let it through production.
 */
const LOCAL = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

export function refusal(script: string, e: { NODE_ENV?: string; DATABASE_URL?: string; SEED_ANY_DATABASE?: string }): string | null {
  if ((e.NODE_ENV ?? '').trim().toLowerCase() === 'production') {
    return `${script} refused: NODE_ENV is production. It makes accounts whose password is in the repository, and is for a development database only.`
  }
  if (e.SEED_ANY_DATABASE === '1') return null
  let host: string
  try {
    host = new URL(e.DATABASE_URL ?? '').hostname.toLowerCase()
  } catch {
    return `${script} refused: DATABASE_URL is not a URL.`
  }
  /* An empty host is a socket on this machine; so is one named by `?host=/…`. */
  if (host === '' || LOCAL.has(host) || host.endsWith('.localhost')) return null
  return (
    `${script} refused: the database is at ${host}, not on this machine. It makes accounts whose password is in the repository, ` +
    'and is for a development database only. To use a development database elsewhere on purpose, set SEED_ANY_DATABASE=1.'
  )
}
