import { AsyncLocalStorage } from 'node:async_hooks'
import postgres from 'postgres'
import { env, wholeFromEnv } from './env.js'

export type Sql = postgres.Sql
export type Tx = postgres.TransactionSql

/**
 * The runtime connection: the tracker_app role, which RLS applies to.
 * Its options are the sign-in role's too (`asAuth`, below).
 *
 * Prepared statements, on. They were off for a PgBouncer in transaction
 * mode that has not been put in front of the database — and the cost of
 * being ready for it was paid on every query since: unprepared, a query
 * with parameters is described before it is run, a round trip of its own,
 * and the describe makes the driver wait instead of sending the next query
 * behind it. Measured against a database 20 ms away, an open task took 880
 * ms with them off; most of that was this. PgBouncer has kept prepared
 * statements across transaction mode since 1.21 (`max_prepared_statements`),
 * so this is no longer the thing in its way.
 */
const OPTIONS = {
  prepare: true,
  onnotice: () => {},
  /*
   * No JIT, on every connection this application opens.
   *
   * Postgres turns the compiler on when a plan's *estimated* cost crosses a
   * threshold, and row-level security inflates that estimate enormously: the
   * policies inline subqueries and function calls into every plan, so a
   * query over twenty-three rows looked expensive enough to be worth
   * compiling. It compiled 112 functions and spent 538 ms doing it, out of
   * 732 ms total — the compilation cost more than five times the query.
   *
   * That was the whole reason a chat room took two seconds to open. Not the
   * volume: the demo has twenty-three messages in seven rooms.
   *
   * JIT is right for analytical work, where a long scan pays back the
   * compilation. Nothing in this product is that shape — every query is a
   * small indexed lookup under RLS, and the load table makes them bigger
   * without making them longer-running per row. So it is off here rather
   * than tuned per query, because the next RLS-heavy query will cross the
   * same threshold for the same wrong reason.
   */
  connection: { jit: 'off' },
  types: {
    // Dates come back as strings: a date is a plan with no zone, and turning
    // it into a Date would mix in the server's timezone.
    date: { to: 1082, from: [1082], serialize: (x: string) => x, parse: (x: string) => x },
  },
}

export const sql: Sql = postgres(env.databaseUrlApp, { ...OPTIONS, max: env.poolMax })

/**
 * The projects a token is limited to, for the request it came with.
 *
 * `withActor` is called from some two hundred and fifty places, and a limit each of
 * them had to pass along is a limit one of them forgets: the list was
 * carried on the request for months and never reached a query. So it rides
 * the request itself, set once where the request is let in (`bounded`), and
 * every transaction made for that token's actor inside it hands it to the
 * database, where `visible_projects()` narrows to it. A transaction for
 * anybody else — a mention's reader, a linked GitHub account — is not
 * bound by this token, and the worker, outside any request, never is.
 */
type Bound = { actorId: string; projectIds: readonly string[]; sessionId: string | null; tokenId: string | null; viaTool: boolean }
const scope = new AsyncLocalStorage<Bound>()

/**
 * Runs `fn` with the token's limit on, when it has one — and with the
 * session or token the request came with, which every transaction made for
 * its person asks about first (`stillIn`).
 */
export function bounded<T>(
  who: {
    actorId: string
    tokenProjectIds: readonly string[]
    sessionId?: string | undefined
    tokenId?: string | undefined
    viaMcp?: boolean | undefined
    viaGithub?: boolean | undefined
    viaImport?: string | undefined
    agent?: boolean | undefined
  },
  fn: () => T,
): T {
  return scope.run(
    {
      actorId: who.actorId,
      projectIds: who.tokenProjectIds,
      sessionId: who.sessionId ?? null,
      tokenId: who.tokenId ?? null,
      /* A token of any kind, an agent, GitHub or an import acting as
         somebody — the database's floor under what `can()` keeps from a
         tool (`via_tool()`, migration 320). */
      viaTool: who.viaMcp === true || who.viaGithub === true || Boolean(who.viaImport) || who.agent === true,
    },
    fn,
  )
}

/** `on` when the request is a tool's and the transaction its person's —
    set every time, as the limit is. */
function toolFor(actorId: string): string {
  const b = scope.getStore()
  return b && b.actorId === actorId && b.viaTool ? 'on' : ''
}

/** The settings for the limit, or empty strings for none — set every time,
    so a pooled connection never carries one request's list into another's. */
function limitFor(actorId: string): [string, string] {
  const b = scope.getStore()
  return b && b.actorId === actorId && b.projectIds.length > 0 ? [actorId, `{${b.projectIds.join(',')}}`] : ['', '']
}

/**
 * Who the request is, with the session or the token it came with — asked
 * of every transaction made inside it, as whomever: `auth_still_in`
 * (migration 317) holds the account for the transaction and refuses
 * (`28000`, answered 401) when the account's previous holder was put out
 * after that session or token was begun. So a request let in before a
 * put-out writes nothing after it, however slowly its body came and through
 * whichever connection — the application's, the sign-in role's, as its own
 * person or as nobody — and one writing first is seen by the put-out.
 * Nulls outside a request, and for a request with neither (a board's link,
 * a server-signed token): those ask nothing.
 */
function stillIn(): [string | null, string | null, string | null] {
  const b = scope.getStore()
  return b && (b.sessionId || b.tokenId) ? [b.actorId, b.sessionId, b.tokenId] : [null, null, null]
}

/**
 * Runs `fn` as outside any request: its transactions ask nothing. For the
 * one request that may put its own account's previous holder out — a new
 * address confirmed from an unproved account's own session — whose next
 * statements, the letter that chooses a password among them, are the
 * put-out's own and not a write let in before it.
 */
export function outsideRequest<T>(fn: () => T): T {
  return scope.exit(fn)
}

/** The same question, sent first in a transaction that sets nothing else. */
function asking<T>(pool: Sql, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const [who, sid, tid] = stillIn()
  if (!who) return pool.begin(fn) as Promise<T>
  return pool.begin(async (tx) => {
    const asked = tx`select auth_still_in(${who}, ${sid}::uuid, ${tid}::uuid)`.execute()
    const [, out] = await Promise.all([asked, fn(tx)])
    return out
  }) as Promise<T>
}

/**
 * A transaction on behalf of an actor.
 *
 * app.actor_id is set locally in the transaction and read by the RLS policies.
 * Anything that touches workspace data must go through this function: a query
 * that skips it sees emptiness, not someone else's data.
 */
export async function withActor<T>(actorId: string, workspaceId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return actorOn(sql, actorId, workspaceId, fn)
}

function actorOn<T>(pool: Sql, actorId: string, workspaceId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  /* Read here, not inside: the driver may start the transaction from a
     socket's callback, where the request's store is not. */
  const [tokenActor, tokenProjects] = limitFor(actorId)
  const [who, sid, tid] = stillIn()
  return pool.begin(async (tx) => {
    /*
     * One statement for both, and not waited for.
     *
     * Each `await` here was a round trip to the database before the
     * handler's first query could leave — two of them on every
     * transaction, and every request opens at least two (who is asking,
     * then what they asked). The connection runs statements in the order
     * they are sent, so the handler's queries go out right behind this one
     * and still read the settings it makes; if it fails, the transaction is
     * aborted and they fail with it.
     */
    /* `execute()`, because a query here is lazy: it leaves when somebody
       waits on it, and the handler's first `await` would otherwise send its
       own query ahead of this one — into a transaction with nobody in it,
       where every policy answers with nothing. */
    /* And fifteen seconds for any one statement of a request. A request is
       answered in milliseconds or something is wrong, and a query left to
       run held its connection while twenty more queued behind the pool. */
    const set = tx`select set_config('statement_timeout', '15s', true),
                          set_config('app.actor_id', ${actorId}, true),
                          set_config('app.workspace_id', ${workspaceId}, true),
                          set_config('app.token_actor', ${tokenActor}, true),
                          set_config('app.token_projects', ${tokenProjects}, true),
                          set_config('app.via_tool', ${toolFor(actorId)}, true),
                          auth_still_in(${who}::uuid, ${sid}::uuid, ${tid}::uuid)`.execute()
    const [, out] = await Promise.all([set, fn(tx)])
    return out
  }) as Promise<T>
}

/**
 * The same, for the questions that are about a person rather than a place.
 *
 * Which workspaces somebody belongs to, and switching into one, cannot be
 * asked from inside a workspace — that is the whole question. The login flows
 * and the worker are in the same position for the same reason.
 *
 * It is named at length on purpose. The workspace bound used to be absent
 * from `withActor` rather than declined by name, so a handler that wanted one
 * workspace and a handler that wanted all of them were spelled identically,
 * and My tasks quietly listed another company's work for as long as it took
 * one account to have two workspaces. Whatever this is called, it should be
 * the thing somebody has to choose.
 */
export async function withActorEverywhere<T>(actorId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return everywhereOn(sql, actorId, fn)
}

function everywhereOn<T>(pool: Sql, actorId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const [tokenActor, tokenProjects] = limitFor(actorId)
  const [who, sid, tid] = stillIn()
  return pool.begin(async (tx) => {
    // Sent ahead of the handler's queries, as `withActor` does, and asking the same.
    const set = tx`select set_config('app.actor_id', ${actorId}, true),
                          set_config('app.token_actor', ${tokenActor}, true),
                          set_config('app.token_projects', ${tokenProjects}, true),
                          set_config('app.via_tool', ${toolFor(actorId)}, true),
                          auth_still_in(${who}::uuid, ${sid}::uuid, ${tid}::uuid)`.execute()
    const [, out] = await Promise.all([set, fn(tx)])
    return out
  }) as Promise<T>
}

/**
 * The worker's own connection, as `tracker_worker` — migration 153.
 *
 * The queues, the clear-out and the GitHub token by person are that role's
 * alone: as the application role, which every request runs as, an
 * injection anywhere could have called them with anybody's ids. Opened
 * only when first asked, so the server, which never asks, holds none.
 * Without `DATABASE_URL_WORKER` it is the application's connection, and
 * those calls are refused — said once, loudly, rather than found out from
 * a sync that quietly stopped.
 *
 * A warning from the database is printed, a notice is not. The clear-out
 * says with a warning that a project could not go, and goes on to the
 * next; thrown away with the notices, a project nobody could delete was
 * skipped every hour and nobody heard. What it says every hour
 * whatever happens — rows something live still names — is a notice (318).
 */
let worker: Sql | null = null
const workerNotice = (n: { severity?: string; message?: string }): void => {
  if (n.severity === 'WARNING') console.warn(`worker: ${n.message}`)
}
export async function asWorker<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!worker) {
    if (!env.databaseUrlWorker) console.error('DATABASE_URL_WORKER is not set: the worker’s queues and clear-out will be refused')
    worker = env.databaseUrlWorker
      ? postgres(env.databaseUrlWorker, { max: 4, prepare: true, onnotice: workerNotice, connection: { jit: 'off' } })
      : sql
  }
  return worker.begin(fn) as Promise<T>
}

/**
 * The sign-in connection, as `tracker_auth` — migration 308,
 *
 * Writing a password, an address, a second factor, a provider's identity or
 * a recovery code; making a session, a token, a reset ticket or an OAuth
 * code; reading a password's hash or a factor's secret; deleting an
 * account: the definer functions that do these are this role's to run and
 * not the application's, and so are the inserts into `refresh_session` and
 * `api_token`. SQL run as the application — an injection anywhere in the
 * request code — cannot reach them. The role is a member of `tracker_app`,
 * so a sign-in transaction reads and writes everything else as a request
 * does, under the same policies.
 *
 * Used only by `auth/*` and the routes that sign somebody in, out or away,
 * through the four functions below; anything else that called them would
 * be a second door. Its own few connections, opened when first asked for.
 * Without `DATABASE_URL_AUTH` and nothing to make it from (`db/authUrl.ts`)
 * it is the application's connection — right for a developer running as
 * the owner, and said loudly otherwise, since signing in is then refused.
 */
let auth: Sql | null = null
function authPool(): Sql {
  if (!auth) {
    if (!env.databaseUrlAuth && env.databaseUrlApp !== env.databaseUrl) {
      console.error('DATABASE_URL_AUTH is not set and cannot be made from DATABASE_URL_APP: signing in will be refused')
    }
    auth = env.databaseUrlAuth ? postgres(env.databaseUrlAuth, { ...OPTIONS, max: 6 }) : sql
  }
  return auth
}

/** The sign-in connection itself, for a statement outside a transaction. */
export const authSql = (): Sql => authPool()

/** A sign-in transaction with no actor — `withoutActor`, as `tracker_auth`. */
export async function asAuth<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return asking(authPool(), fn)
}

/** A sign-in transaction for an actor in a workspace — `withActor`, as `tracker_auth`. */
export async function asAuthActor<T>(actorId: string, workspaceId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return actorOn(authPool(), actorId, workspaceId, fn)
}

/** A sign-in transaction for an actor in no one workspace — `withActorEverywhere`, as `tracker_auth`. */
export async function asAuthEverywhere<T>(actorId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return everywhereOn(authPool(), actorId, fn)
}

/**
 * A sign-in transaction that learns whose it is from its first statement:
 * a refresh, which finds the person by spending their token, and must write
 * the session that replaces it in the same transaction — so a second
 * request with the same token waits on the first and then finds what it
 * wrote. It starts as nobody, as `asAuth`;
 * `actAs(actorId)` makes the rest of it that person's in no one workspace,
 * as `asAuthEverywhere` would have from the start. No token's limit: a
 * refresh is never asked with a token.
 */
export async function asAuthThenActor<T>(fn: (tx: Tx, actAs: (actorId: string) => Promise<void>) => Promise<T>): Promise<T> {
  return asking(authPool(), async (tx) => {
    const actAs = async (actorId: string): Promise<void> => {
      await tx`select set_config('app.actor_id', ${actorId}, true),
                      set_config('app.token_actor', '', true),
                      set_config('app.token_projects', '', true)`
    }
    return fn(tx, actAs)
  })
}

/*
 * Boards by link have a pool of their own.
 * A few connections, so that however many boards are asked of at
 * once, they wait on each other and never on the connections the product's
 * own requests need. Opened when first asked for.
 */
let boards: Sql | null = null
export const boardPool = (): Sql =>
  (boards ??= postgres(env.databaseUrlApp, {
    max: wholeFromEnv(process.env.BOARD_POOL, 4),
    prepare: true,
    onnotice: () => {},
    connection: { jit: 'off' },
  }))

/* How long each board transaction took, told to whoever is watching — the
   breaker (`http/boardGuard.ts`), which times the database alone, never a
   slow upload or a slow reader. */
let timed: ((ms: number) => void) | null = null
export function onBoardQuery(fn: ((ms: number) => void) | null): void {
  timed = fn
}
async function timedBoard<T>(run: () => Promise<T>): Promise<T> {
  const t = performance.now()
  try {
    return await run()
  } finally {
    timed?.(performance.now() - t)
  }
}

/** `withActor`, on the boards' own pool. */
export async function withBoardActor<T>(actorId: string, workspaceId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return timedBoard(
    () =>
      boardPool().begin(async (tx) => {
        const set = tx`select set_config('statement_timeout', '5s', true),
                          set_config('app.actor_id', ${actorId}, true),
                          set_config('app.workspace_id', ${workspaceId}, true),
                          set_config('app.token_actor', '', true),
                          set_config('app.token_projects', '', true)`.execute()
        const [, out] = await Promise.all([set, fn(tx)])
        return out
      }) as Promise<T>,
  )
}

/** `withoutActor`, on the boards' own pool. */
export async function withBoardOnly<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return timedBoard(() => boardPool().begin(fn) as Promise<T>)
}

/** A transaction with no actor: authentication and housekeeping only. */
export async function withoutActor<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return asking(sql, fn)
}

export async function closeDb(): Promise<void> {
  if (worker && worker !== sql) await worker.end()
  worker = null
  if (auth && auth !== sql) await auth.end()
  auth = null
  if (boards) await boards.end()
  boards = null
  await sql.end()
}
