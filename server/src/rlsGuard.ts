import type postgres from 'postgres'

/**
 * Whether row-level security binds the role this process asks as,
 * the sixth audit, M3.
 *
 * Every policy in the schema is let through by three kinds of role: a
 * superuser, a role with `BYPASSRLS`, and the owner of the table (or
 * anybody who inherits the owner's rights). Connected as any of them, the
 * application answers every query, passes every test, and lets every
 * workspace read every other — which is what `DATABASE_URL_APP` left unset
 * used to mean, said only in a log line.
 *
 * So it is asked of the database at start, and on a server where nobody
 * is watching the log it is a refusal: the process will not serve a
 * schema whose isolation does nothing. Where the refusal is on is the
 * edition's to say (`edition.rlsFailClosed`), and only in production — a
 * developer pointing the server at the owner on purpose is told, not
 * stopped.
 */
export type RlsRow = { role: string; superuser: boolean; bypass: boolean; owns: boolean }

/** What is wrong with the role, in a sentence, or null when the policies bind it. */
export function rlsVerdict(r: RlsRow | undefined): string | null {
  if (!r) return 'the database did not say which role this is'
  if (r.superuser) return `"${r.role}" is a superuser, which no policy binds`
  if (r.bypass) return `"${r.role}" has BYPASSRLS, which no policy binds`
  if (r.owns) return `"${r.role}" owns the tables, or inherits from the role that does, and an owner is under no policy of its own table`
  return null
}

export async function askRls(sql: postgres.Sql): Promise<RlsRow | undefined> {
  const [r] = await sql<RlsRow[]>`
    select current_user::text as role,
           r.rolsuper as superuser,
           r.rolbypassrls as bypass,
           exists (
             select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
             where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relrowsecurity
               and pg_has_role(current_user, c.relowner, 'USAGE')
           ) as owns
    from pg_roles r where r.rolname = current_user`
  return r
}

export class RlsRefused extends Error {}

/**
 * Asks, and says so — as loudly as a log can when `refuse` is off, and by
 * throwing when it is on, so the caller's start fails before it listens.
 * A question that cannot be asked at all counts as the wrong answer when
 * refusing: a guard that waves things through on an error is not one.
 */
export async function guardRls(sql: postgres.Sql, who: string, refuse: boolean, log: (s: string) => void = console.error): Promise<void> {
  let wrong: string | null
  try {
    wrong = rlsVerdict(await askRls(sql))
  } catch (e) {
    const why = `the role could not be checked (${e instanceof Error ? e.message : String(e)})`
    if (refuse) throw new RlsRefused(`The ${who} will not start: ${why}.`)
    log(`[rls] ${why}`)
    return
  }
  if (!wrong) return
  const said =
    `\n!!! The ${who} is connected to Postgres as a role that row-level security does not bind: ${wrong}.\n` +
    '!!! Every workspace can read every other. Set DATABASE_URL_APP to the tracker_app role.\n'
  if (refuse) throw new RlsRefused(`${said}!!! Refusing to start.\n`)
  log(said)
}
