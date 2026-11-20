import postgres from 'postgres'
import { env } from './env.js'
import { sql, type Tx } from './db.js'

/**
 * Realtime fan-out, through the database rather than from inside the API.
 *
 * The design asks for a pub/sub layer rather than a broadcast from the API
 * process, because with two API instances a message sent to one of them never
 * reaches sockets held by the other. Postgres LISTEN/NOTIFY is a pub/sub layer
 * that needs no new infrastructure: every instance subscribes, and the
 * database does the fan-out.
 *
 * Swapping this for Redis later touches this file and nothing else — handlers
 * call `publish`, sockets call `subscribe`, and neither knows what carries it.
 */
export type Event = {
  /** What to listen on: a conversation, or a project. */
  topic: string
  /** Or several at once — one notice for everybody in a room. */
  topics?: string[]
  kind: string
  payload: unknown
}

type Handler = (e: Event) => void

const local = new Map<string, Set<Handler>>()

// A separate connection: a listening connection cannot also run queries, and
// borrowing one from the pool would hold it open forever. As the
// application's role, not the owner: LISTEN asks no privilege, and a
// connection that runs no query has no business holding the one role in
// the database every policy lets through.
const connect = () => postgres(env.databaseUrlApp, { max: 1, onnotice: () => {} })
let listener = connect()

let started: Promise<void> | null = null
let heard = 0
let check: ReturnType<typeof setInterval> | null = null
let rebuilding = false

function hear(raw: string): void {
  heard = Date.now()
  let e: Event
  try {
    e = JSON.parse(raw) as Event
  } catch {
    return
  }
  for (const topic of e.topics ?? [e.topic]) {
    for (const fn of local.get(topic) ?? []) fn({ topic, kind: e.kind, payload: e.payload })
  }
}

async function start(): Promise<void> {
  /* A start that failed is forgotten, so the next subscriber tries again
     rather than inheriting the rejection for the life of the process. */
  started ??= listener.listen('realtime', hear).then(
    () => {
      heard = Date.now()
      check ??= setInterval(() => void alive(), 30_000)
      check.unref?.()
    },
    (err: unknown) => {
      started = null
      throw err
    },
  )
  return started
}

/*
 * Whether the listener still hears anything.
 *
 * The driver listens again by itself when its connection closes, once: if
 * the database is still restarting at that moment the attempt fails, nothing
 * tries again, and every socket in the process stays open and hears nothing
 * until the next deploy. So the process says something to itself every
 * thirty seconds, and a listener that has heard nothing — not that, not
 * anybody — for two of them is replaced.
 */
async function alive(): Promise<void> {
  if (Date.now() - heard > 75_000) return rebuild()
  await sql.notify('realtime', JSON.stringify({ topic: '', kind: 'alive', payload: null })).catch(() => {})
}

async function rebuild(): Promise<void> {
  if (rebuilding) return
  rebuilding = true
  try {
    const old = listener
    listener = connect()
    void old.end({ timeout: 0 }).catch(() => {})
    await listener.listen('realtime', hear)
    heard = Date.now()
    /* What was said while it was deaf was said to nobody: every socket is
       told, closes, and its screen reads itself again when it reopens. */
    for (const [topic, fns] of local) for (const fn of fns) fn({ topic, kind: 'again', payload: null })
  } catch {
    // The next check tries again.
  } finally {
    rebuilding = false
  }
}

/**
 * Said on the transaction's own connection when there is one — a NOTIFY is
 * delivered when its transaction commits, so nobody hears of a change
 * before it is there to read, and no second connection is asked for.
 *
 * It was always the pool: a write held its connection open and waited for
 * another to say so, and twenty writes at once — a selection of twenty-five
 * cards deleted — held all twenty connections waiting for a twenty-first.
 * Nothing committed again, and every request after them waited for ever.
 */
export async function publish(topic: string, kind: string, payload: unknown, tx?: Tx): Promise<void> {
  const said = JSON.stringify({ topic, kind, payload } satisfies Event)
  if (tx) {
    await tx`select pg_notify('realtime', ${said})`
    return
  }
  /*
   * Sent on the pool, not on the listening connection.
   *
   * Saying something needs no subscription, and using the listener for it
   * opened that dedicated connection in every process that ever published —
   * which, since every mutation publishes, is every one of them. A test suite
   * that only writes would sit with an open socket and never exit, having
   * passed. It looked like a slow test and was a hung one.
   *
   * NOTIFY has an 8 kB payload limit, so what travels is the fact and the
   * ids. A client that hears "a message arrived" fetches it through the same
   * endpoint it would have used anyway, which keeps one path into the data.
   */
  await sql.notify('realtime', said)
}

/** One kind of notice to many topics, in as few NOTIFYs as fit 8 kB each. */
export async function publishMany(topics: string[], kind: string, payload: unknown): Promise<void> {
  for (let i = 0; i < topics.length; i += 100) {
    const some = topics.slice(i, i + 100)
    await sql.notify('realtime', JSON.stringify({ topic: some[0]!, topics: some, kind, payload } satisfies Event))
  }
}

/** The same, said on a transaction's connection, so it lands when the write does. */
export async function publishTo(tx: Tx, topics: string[], kind: string, payload: unknown): Promise<void> {
  for (let i = 0; i < topics.length; i += 100) {
    const some = topics.slice(i, i + 100)
    await tx`select pg_notify('realtime', ${JSON.stringify({ topic: some[0]!, topics: some, kind, payload } satisfies Event)})`
  }
}

export async function subscribe(topic: string, fn: Handler): Promise<() => void> {
  await start()
  const set = local.get(topic) ?? new Set<Handler>()
  set.add(fn)
  local.set(topic, set)
  return () => {
    set.delete(fn)
    if (set.size === 0) local.delete(topic)
  }
}

export async function closeRealtime(): Promise<void> {
  if (check) clearInterval(check)
  check = null
  await listener.end({ timeout: 1 })
}
