/**
 * The last answer to a question, kept until it is asked again.
 *
 * Every tool in a project is unmounted when you leave it, so coming back is
 * a cold start: the screen has nothing, fetches, and stands empty for the
 * sixty milliseconds in between. Measured frame by frame, the content area
 * of a tab being returned to fell to thirty per cent of itself and filled
 * again — which is what "the transitions are jerky" is made of. Nothing
 * moves; the screen simply is not there for a moment, twice per click.
 *
 * So the answer is kept and handed back immediately, and the request still
 * goes out and replaces it. Stale for one frame beats absent for four, and
 * the staleness is bounded by the round trip that is already happening.
 *
 * Deliberately not a cache with rules. No expiry, no invalidation, no keys
 * to get wrong: it is a memory of the last response per question. Anything
 * cleverer would be a second source of truth for data the server already
 * owns.
 *
 * ## And it is kept on this machine, for when there is no network
 *
 * Every answer is also written to IndexedDB, under the account and the
 * workspace it was asked in, so a window opened with no connection can show
 * what this person last saw instead of the browser's "You're offline" —
 * `docs/specs/offline.md` — and drawn at every start until the server
 * answers, `docs/specs/arrival.md`. It is a copy to read, never to edit in
 * place: what goes in is a fresh answer, or what a screen shows once it has
 * moved on from one (the board, after a move), so the next start opens on
 * what was last seen. Signing out deletes it.
 */
const last = new Map<string, unknown>()

/*
 * A board's page keeps its answers apart.
 * The product's own screens draw it there (the board, the new-task window's
 * project picker), and a board's one project must never be what the app's
 * picker remembers. So on a board every key is the board's own, and nothing
 * of it is ever written to the disk the app reads from.
 */
let apart: string | null = null
export function keepApart(namespace: string | null): void {
  apart = namespace
}
const named = (key: string) => (apart ? `${apart}|${key}` : key)

/** What came back last time, or null if this is the first time. */
export function recall<T>(key: string): T | null {
  return (last.get(named(key)) as T | undefined) ?? null
}

/** Keep it, and hand it straight back so a loader reads as one line. */
export function remember<T>(key: string, value: T): T {
  const k = named(key)
  /* Set again rather than updated, so the map's own order is the order
     things were last looked at, which is what the bound below reads. */
  last.delete(k)
  last.set(k, value)
  if (ONE_THING.test(key)) bound()
  if (!apart) keep(key, value)
  return value
}

/*
 * The answers about one thing — a task, a document, a room's messages, a
 * person — kept for the last few dozen of them, not for every one ever
 * opened.
 *
 * Kept without a bound, a phone that had opened a few hundred tasks and
 * documents carried every one of them, bodies and comments, and read them
 * all back from the disk at every start. Safari ends a tab that holds too
 * much, and then ends it again when it reloads: "A problem repeatedly
 * occurred" on opening a board, which held none of it. The lists — a
 * project's tasks, its files, its lists, the shell — are one answer each
 * and stay; what is about one thing is many, and is what grew.
 */
const ONE_THING = /^(task|file|post|person|history|activity|room-messages|room-members|candidates):/
const ONE_THING_IN_MEMORY = 60
const ONE_THING_ON_DISK = 120
function bound(): void {
  /* A board's keys carry its namespace in front: `board|task:…`. */
  const isThing = (k: string) => ONE_THING.test(k) || ONE_THING.test(k.slice(k.indexOf('|') + 1))
  let things = 0
  for (const k of last.keys()) if (isThing(k)) things++
  if (things <= ONE_THING_IN_MEMORY) return
  for (const k of last.keys()) {
    if (things <= ONE_THING_IN_MEMORY) break
    if (isThing(k)) {
      last.delete(k)
      things--
    }
  }
}

/* The order things were last kept on the disk, newest last, so the oldest
   can be let go there too. In localStorage: a list of keys, not the
   answers. */
const RECENT_KEY = 'memory-recent'
function recent(): string[] {
  try {
    const r = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
    return Array.isArray(r) ? r.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}
function setRecent(keys: string[]): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(keys))
  } catch {
    // Not kept: the disk is pruned at the next start instead.
  }
}

/*
 * Whose answers these are: `<actor>:<workspace>`, set when `/me` answers and
 * kept in localStorage so a window opened offline knows which shelf to read.
 * Nothing is written before it is known — an answer with no owner is not
 * one to leave on a disk.
 */
const SCOPE_KEY = 'memory-scope'
let scope: string | null = null

export function scopeTo(next: string): void {
  scope = next
  try {
    localStorage.setItem(SCOPE_KEY, next)
  } catch {
    // Kept for this tab only, which is what it was before.
  }
}

/** The shelf the last session on this browser wrote to, if any. */
export function lastScope(): string | null {
  try {
    return localStorage.getItem(SCOPE_KEY)
  } catch {
    return null
  }
}

const DB = 'tracker-memory'
const STORE = 'answers'
let opened: Promise<IDBDatabase> | null = null
function db(): Promise<IDBDatabase> {
  opened ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return opened
}

/*
 * Written a second after the last answer to the same question, not on every
 * one: a board refetches on every event from another device, and a column
 * of ten thousand rows written to disk per keystroke somebody else makes is
 * a disk doing nothing useful.
 */
const due = new Map<string, unknown>()
// biome-ignore lint/correctness/noUnusedVariables: read by the `??=` below, which is what keeps it to one flush in flight
let flushing: ReturnType<typeof setTimeout> | null = null
function keep(key: string, value: unknown): void {
  if (!scope || typeof indexedDB === 'undefined') return
  due.set(`${scope}|${key}`, value)
  flushing ??= setTimeout(flush, 1000)
}
function flush(): void {
  flushing = null
  const batch = [...due]
  due.clear()
  /* Which of these are about one thing, moved to the end of the recent
     list; whatever falls off its front is deleted with the same write. */
  let order = recent()
  for (const [k] of batch) {
    if (!ONE_THING.test(k.slice(k.indexOf('|') + 1))) continue
    order = order.filter((x) => x !== k)
    order.push(k)
  }
  const gone = order.length > ONE_THING_ON_DISK ? order.slice(0, order.length - ONE_THING_ON_DISK) : []
  if (gone.length) order = order.slice(gone.length)
  setRecent(order)
  void db()
    .then((d) => {
      const tx = d.transaction(STORE, 'readwrite')
      for (const [k, v] of batch) tx.objectStore(STORE).put(v, k)
      for (const k of gone) tx.objectStore(STORE).delete(k)
    })
    .catch(() => {
      // A full or refused disk costs the offline copy, not the screen.
    })
}

/**
 * Bring back what this machine kept for `owner`, for the questions this tab
 * has no answer to yet.
 *
 * At every start, `light`: the lists and the shell, which is what the first
 * screen is drawn from, and not the answers about one thing — read back in
 * full, those were the start's whole weight on a phone that had opened
 * hundreds of them. And the ones the recent list no longer names, left on
 * the disk by a build that kept everything, are deleted on the way.
 * In full when the server cannot be reached, for the screens a person can
 * still open offline — `docs/specs/offline.md`.
 */
export async function hydrate(owner: string, light = false): Promise<void> {
  if (typeof indexedDB === 'undefined') return
  try {
    const d = await db()
    const prefix = `${owner}|`
    const named = new Set(recent())
    const stale: IDBValidKey[] = []
    const wanted: IDBValidKey[] = []
    /* Keys first, so an answer that is not wanted is never read off the
       disk at all. */
    const store = d.transaction(STORE).objectStore(STORE)
    await new Promise<void>((resolve, reject) => {
      const req = store.openKeyCursor(IDBKeyRange.bound(prefix, `${prefix}\uffff`))
      req.onsuccess = () => {
        const at = req.result
        if (!at) return resolve()
        const key = String(at.key).slice(prefix.length)
        const thing = ONE_THING.test(key)
        if (thing && !named.has(String(at.key))) stale.push(at.key)
        else if (!(light && thing) && !last.has(key)) wanted.push(at.key)
        at.continue()
      }
      req.onerror = () => reject(req.error)
    })
    if (wanted.length) {
      const read = d.transaction(STORE).objectStore(STORE)
      await Promise.all(
        wanted.map(
          (k) =>
            new Promise<void>((resolve) => {
              const req = read.get(k)
              req.onsuccess = () => {
                const key = String(k).slice(prefix.length)
                if (!last.has(key)) last.set(key, req.result)
                resolve()
              }
              req.onerror = () => resolve()
            }),
        ),
      )
    }
    if (stale.length) {
      const tx = d.transaction(STORE, 'readwrite')
      for (const k of stale) tx.objectStore(STORE).delete(k)
    }
  } catch {
    // Nothing kept, or nothing readable: the screen is empty, as it was.
  }
}

/**
 * Forget everything.
 *
 * On signing out — the map and the copy on disk — because the next person
 * to use this browser is not necessarily the same person, and a
 * workspace's task titles left behind are a leak however short-lived.
 */
export async function forget(): Promise<void> {
  last.clear()
  due.clear()
  scope = null
  try {
    localStorage.removeItem(SCOPE_KEY)
    localStorage.removeItem(RECENT_KEY)
    /* The faces' last links, kept by `Avatar` so a renewed one does not
       reload the picture: links to the people of a workspace, likewise. */
    localStorage.removeItem('faces-on-screen')
  } catch {
    // Nothing to remove.
  }
  if (typeof indexedDB === 'undefined') return
  /* Waited for: the page reloads after this, and a clear still running
     when it does is a clear that may not have happened. */
  await db()
    .then(
      (d) =>
        new Promise<void>((done) => {
          const tx = d.transaction(STORE, 'readwrite')
          tx.objectStore(STORE).clear()
          tx.oncomplete = () => done()
          tx.onerror = () => done()
          tx.onabort = () => done()
        }),
    )
    .catch(() => {})
}
