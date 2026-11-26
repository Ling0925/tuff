import { now } from './words.js'
import { API as W } from '../words/api.js'
import { forget } from './memory.js'
import { boardAsProjects, boardPath, boardSecret } from './boardApi.js'
import { type Ahead, renewAhead, stamped } from './renewAhead.js'
const BASE = '/api'

export type Session = {
  access_token: string
  refresh_token: string
  actor_id: string
  /** Null for a session in no workspace. */
  workspace_id: string | null
  nowhere?: true
  /** Seconds the access token lives, as the server said when it gave it. */
  expires_in?: number
  /** When it ends on this machine's clock, written as it arrives —
      `data/renewAhead.ts`. */
  expires_at?: number
}

const KEY = 'session'

/**
 * The browser's own name for itself, sent when a session is made or
 * renewed, so its tabs and workspaces are one line in the list of places
 * you are signed in. Not the person's: it stays
 * through signing out, as the browser does.
 */
/* Where to come back to after signing in, kept for the tab: a page that
   sends somebody to sign in puts its own path here, and the sign-in screen
   goes there when it is done (`App.tsx`, `Connect.tsx`). */
export const AFTER_SIGN_IN = 'tuff:after-sign-in'

export function device(): string {
  try {
    let d = localStorage.getItem('device')
    if (!d) {
      d = crypto.randomUUID()
      localStorage.setItem('device', d)
    }
    return d
  } catch {
    return ''
  }
}

/** The headers every way in carries — and the language an error is to be
    answered in. */
export function authHeaders(): Record<string, string> {
  return { 'content-type': 'application/json', 'x-device': device(), 'x-tongue': now }
}

export function stored(): Session | null {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Session) : null
  } catch {
    return null
  }
}

export function remember(s: Session | null): void {
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s))
    else localStorage.removeItem(KEY)
  } catch {
    // A private window is not a reason for the app to stop working.
  }
}

let session: Session | null = stored()
let onSignedOut: (() => void) | null = null
/* Renewed ahead of the token's end — made below, once `renewOnce` is. */
let ahead: Ahead | null = null

export function setSession(given: Session | null): void {
  const s = given ? stamped(given) : null
  session = s
  remember(s)
  ahead?.reschedule()
  /* Signed in again: the sentence about being removed has been read. */
  if (s) {
    try {
      sessionStorage.removeItem(REMOVED_FROM)
    } catch {
      // Nothing kept.
    }
  }
}
export function whenSignedOut(fn: () => void): void {
  onSignedOut = fn
}

let renewing: Promise<boolean> | null = null

/*
 * Removed from the workspace, as the refused renewal said: its name, for
 * the sign-in to say why it is there — `docs/specs/removing-someone.md`,
 * "On their devices". Kept for the tab until they are signed in again:
 * forgotten as the sign-in page opened, it was gone before it was read,
 * because several refused requests each send the tab to `/signin` and the
 * last of those pages is the one that stays.
 */
let removedFrom: string | null = null
export const REMOVED_FROM = 'tuff:removed-from'
export function whyRemoved(): string | null {
  try {
    return sessionStorage.getItem(REMOVED_FROM)
  } catch {
    return null
  }
}

/*
 * Another tab's turn of the same session is this tab's too.
 *
 * A refresh token is spent by using it, and every tab of this origin — the
 * installed app among them — holds the same one. Each kept its own copy in
 * memory, so the first tab to renew spent it, the second renewed with the
 * spent one, was refused, and signed out: with two windows open somebody
 * was put back at the sign-in screen every quarter of an hour or so. Now a
 * renewal written by another tab is taken up here, as long as it is for the
 * same workspace — a tab in another workspace has a session of its own.
 */
const sameRoom = (a: Session | null, b: Session | null) => Boolean(a && b && a.workspace_id === b.workspace_id)
/* Another tab's session, taken up here — and the timer set by its end. */
function takeUp(s: Session): void {
  session = s
  ahead?.reschedule()
}
/*
 * A renewal this tab no longer holds the session for, handed to the tabs
 * that do.
 *
 * Creating a workspace, leaving one and taking an invitation each set a
 * session for another workspace and go on working in it, and a renewal
 * started ahead for the old one can land after that. Kept here it would put
 * the old workspace back under this tab — the invitations typed next sent
 * there — so it is not kept. But it spent the refresh token the tabs still
 * in the old workspace hold, so they are told: under a key of its own,
 * written and removed in one step, which exists only as the event other
 * tabs hear. Nothing that reads the kept session (`stored()`) can read it,
 * in this tab or another. With no storage, those tabs renew with the spent
 * token, and the server's grace answers them for ten seconds.
 */
const HANDED = 'session:handed'
function handOn(s: Session): void {
  try {
    localStorage.setItem(HANDED, JSON.stringify(s))
    localStorage.removeItem(HANDED)
  } catch {
    // No storage: left to the grace, as above.
  }
}
function parsed(raw: string | null): Session | null {
  try {
    return raw ? (JSON.parse(raw) as Session) : null
  } catch {
    return null
  }
}
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY && e.key !== HANDED) return
    /* The kept session as it is now; a handed one as the event carries it,
       since it is gone from storage by the time the event is heard. */
    const now = e.key === KEY ? stored() : parsed(e.newValue)
    if (now && sameRoom(now, session)) takeUp(now)
  })
}

/*
 * Renewing, one tab at a time and never twice for one token.
 *
 * Behind a lock every tab shares, and looking first at what is stored: if
 * another tab renewed while this one waited, its session is the answer and
 * nothing is spent. A refusal is looked at once more for the same reason —
 * the other tab may have won the race in between. And only a refusal signs
 * out: a server in the middle of a deploy answering 502 is not a reason to
 * throw somebody's session away.
 */
async function renew(): Promise<boolean> {
  const asked = session?.access_token
  const run = async (): Promise<boolean> => {
    const mine = session
    if (!mine) return false
    /* Another tab's renewal, taken up while this one waited for the lock
       (the `storage` event, above): that is the renewal asked for, and
       spending the new refresh token too would only renew twice. */
    if (mine.access_token !== asked) return true
    /* Read in the same step as `mine`, before anything is awaited: the
       session cannot have moved in between. */
    const latest = stored()
    if (latest && sameRoom(latest, mine) && latest.refresh_token !== mine.refresh_token) {
      takeUp(latest)
      return true
    }
    /* After the answer the session may be another workspace's — created,
       left, an invitation taken — or none: signed out. */
    const moved = () => !sameRoom(session, mine)
    /* When the new token's quarter of an hour starts, at the latest: a slow
       answer must not make it seem to live longer than it does. */
    const askedAt = Date.now()
    /* No timeout and no abort, on purpose: the server spends the token the
       moment it takes the request, so a refresh given up on is a token
       spent with nothing kept. A connection that dies is an error to try
       again, and a try within ten seconds is answered by the server's grace
       with the same session. */
    const r = await fetch(`${BASE.replace('/api', '')}/auth/refresh`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ refresh_token: mine.refresh_token }),
    })
    if (r.ok) {
      const fresh = stamped((await r.json()) as Session, askedAt)
      /* Signed out while it was on its way: the server has ended the line
         already, and writing it back would put a dead session in storage. */
      if (!session) return false
      /* In another workspace now: not kept here, handed to the tabs still
         in the old one (`handOn`). True, not false: the request waiting on
         this is sent again with the session there is now, and a false would
         sign out a tab that is signed in. */
      if (moved()) {
        handOn(fresh)
        return true
      }
      setSession(fresh)
      return true
    }
    if (r.status === 401 || r.status === 400) {
      const said = (await r.json().catch(() => ({}))) as { error?: { code?: string; workspace?: { name?: string } } }
      /* The old workspace's token refused, after this tab left it: not this
         tab's to answer, nor its sign-out to say. */
      if (moved()) return Boolean(session)
      if (said.error?.code === 'removed') removedFrom = said.error.workspace?.name ?? ''
      const after = stored()
      if (after && sameRoom(after, mine) && after.refresh_token !== mine.refresh_token) {
        takeUp(after)
        return true
      }
      return false
    }
    throw new Refused(r.status, W.notAnswering)
  }
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
  return locks ? locks.request('tuff:renew-session', run) : run()
}

/* The one renewal of this tab: a 401, the timer, a tab come back and a
   request with a spent token all join it rather than each spending the
   refresh token. */
function renewOnce(): Promise<boolean> {
  renewing ??= renew().finally(() => {
    renewing = null
  })
  return renewing
}

/*
 * Renewed ahead, not after a burst of 401s — `data/renewAhead.ts`,
 * A minute before the token
 * ends, when the tab comes back (or loads) with less than two minutes
 * left, and before a request that would carry a spent token; all through
 * `renewOnce`, so across tabs it is the same lock and the same look at
 * what is stored.
 */
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const a = renewAhead({ current: () => session, renew: renewOnce })
  ahead = a
  a.reschedule()
  /* Just loaded counts as come back: a tab reloaded while its renewal was
     on its way renews at once, inside the server's grace, and gets the
     answer it lost. */
  a.returned()
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') a.returned()
  })
  window.addEventListener('focus', () => a.returned())
}

/**
 * One place that talks to the server.
 *
 * The access token is short-lived on purpose, so a 401 is normal rather than
 * exceptional: it is retried once behind a single shared refresh. Without
 * this, an app that has been open for twenty minutes silently stops saving.
 */
/**
 * This tab, and nothing wider.
 *
 * The realtime channel tells every open screen that something changed, and
 * each screen drops the echo of its own change so it does not refetch what
 * it already drew. The echo was recognised by `actor_id` — which is the
 * person, not the tab. A second device signed in as the same person was
 * therefore filtered as an echo too, and never learned about a move made on
 * the first: measured, a card carried to the top on a desktop stayed third
 * on a phone open to the same board under the same account.
 *
 * So the thing that is recognised is this tab. Made once per page load and
 * sent on every request and on the socket, and it means nothing to the
 * server beyond being handed back inside the event.
 */
export const TAB = Math.random().toString(36).slice(2, 10)

/*
 * Reads still on their way, so the first screen can arrive in one piece —
 * `docs/specs/arrival.md`. Reads only: a write is the interface already
 * having moved, and the screen does not wait for it — though a read sent
 * after it does (`afterWrites`, below).
 */
let reading = 0
export const readsInFlight = () => reading

/*
 * Whether the server can be reached, as the last request found it.
 *
 * Not `navigator.onLine` alone: that says a network is attached, not that
 * this server is on the other end of it — a hotel's Wi-Fi is "online". A
 * request that could not be sent at all says offline; any answer at all,
 * even an error, says the server is there. The browser's own events are
 * heard too, so the change is seen without waiting for the next request.
 * `docs/specs/offline.md`.
 */
let reachable = typeof navigator === 'undefined' ? true : navigator.onLine
const hearing = new Set<(online: boolean) => void>()
function reached(now: boolean): void {
  if (now === reachable) return
  reachable = now
  for (const said of hearing) said(now)
}
export const isOnline = () => reachable
export function onReach(said: (online: boolean) => void): () => void {
  hearing.add(said)
  return () => hearing.delete(said)
}
if (typeof window !== 'undefined') {
  window.addEventListener('offline', () => reached(false))
  window.addEventListener('online', () => reached(true))
}

/**
 * For a loader's `catch`: clear the screen when the server said no, keep it
 * when the server could not be asked. A list emptied because the train went
 * into a tunnel is the screen lying about the work.
 */
export const unlessOffline =
  (then: () => void) =>
  (e: unknown): void => {
    if (!(e instanceof Unreachable)) then()
  }

/** A request that never reached the server, as against one it refused. */
export class Unreachable extends Error {
  constructor() {
    super('offline')
  }
}

/**
 * A request the server answered and refused, with the status it said.
 *
 * Kept as an `Error` with the same message as before, so nothing that reads
 * the message changes; what is new is that a screen can tell "that thing is
 * not there" (404, 403) from "the server could not answer just now" (a 500,
 * a restart mid-request) — and only the first is a reason to say it is gone.
 */
export class Refused extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** The whole answer, for a refusal that says more than why — a removed
        person's `410` carries their name. */
    readonly said?: unknown,
  ) {
    super(message)
  }
}

/**
 * Whether a failure means the thing is not there for this person: the
 * server answered and the answer was no — 404 and 403 above all, and any
 * other refusal of the request itself. A 5xx, a 429 or no answer at all is
 * the server not managing just now, and is asked again.
 */
export const isGone = (e: unknown): boolean => e instanceof Refused && e.status < 500 && e.status !== 429

/**
 * Load until it answers: gone is said once, anything else is asked again,
 * a little later each time — `docs/specs/not-there.md`. Returns the way to
 * stop asking, for the screen that is left.
 */
export function untilAnswered(load: () => Promise<unknown>, onGone: () => void): () => void {
  let stopped = false
  let wait = 500
  let timer: ReturnType<typeof setTimeout> | undefined
  const go = () => {
    load().catch((e: unknown) => {
      if (stopped) return
      if (isGone(e)) return onGone()
      /* Too many asked: asking again in half a second was more of the
         same. A quarter of the minute the ceiling is counted over. */
      if (e instanceof Refused && e.status === 429) wait = Math.max(wait, 15_000)
      timer = setTimeout(go, wait * (0.75 + Math.random() / 2))
      wait = Math.min(wait * 2, e instanceof Refused && e.status === 429 ? 60_000 : 8000)
    })
  }
  go()
  return () => {
    stopped = true
    if (timer) clearTimeout(timer)
  }
}

/*
 * Writes this tab has sent and not yet heard back from.
 *
 * A read sent while one of them is in the air is a question asked before
 * the answer it depends on exists. A message made into a task and the Tasks
 * tab pressed straight after it: the tab's read reached the server before
 * the task did, and drew the list without it — and the event the write
 * publishes names this tab, so this tab ignores it as its own echo, and
 * nothing ever read the list again. Somebody assigned to a task and My
 * tasks opened the same moment was the same race. Under load the write is
 * slower and the race was lost most of the time.
 *
 * So a read waits for the writes sent before it, and is asked after them.
 * Not for long: past `WRITE_WAIT` the read goes anyway, as it did before,
 * because a write that hangs must not take every screen with it. The
 * screen is not held up either — it is already drawn from memory, and the
 * answer replaces it in place when it comes.
 */
const writing = new Set<Promise<unknown>>()
const WRITE_WAIT = 3000

async function afterWrites(): Promise<void> {
  if (!writing.size) return
  let timer: ReturnType<typeof setTimeout> | undefined
  await Promise.race([Promise.allSettled([...writing]), new Promise<void>((done) => (timer = setTimeout(done, WRITE_WAIT)))])
  clearTimeout(timer)
}

/**
 * A write that has not been sent yet but will be — one waiting for
 * something else first — counted as in the air from now, so a read asked
 * meanwhile waits for it too.
 */
export function writingNow<T>(sent: Promise<T>): Promise<T> {
  writing.add(sent)
  void sent.then(
    () => writing.delete(sent),
    () => writing.delete(sent),
  )
  return sent
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const read = !init.method || init.method === 'GET' || init.method === 'HEAD'
  if (!read) return writingNow(call<T>(path, init))
  reading++
  try {
    await afterWrites()
    return await call<T>(path, init)
  } finally {
    reading--
  }
}

/* `fetch`, with what it says about the connection written down. */
async function reach(url: string, init: RequestInit): Promise<Response> {
  try {
    const res = await fetch(url, init)
    reached(true)
    return res
  } catch {
    reached(false)
    throw new Unreachable()
  }
}

async function call<T>(path: string, init: RequestInit): Promise<T> {
  /* On a board's page, the board's own routes — `data/boardApi.ts`. */
  const secret = boardSecret()
  if (secret) return callBoard<T>(path, init, secret)
  const send = () =>
    reach(`${BASE}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        'x-api-version': '1',
        'x-tab': TAB,
        'x-device': device(),
        'x-tongue': now,
        ...(session ? { authorization: `Bearer ${session.access_token}` } : {}),
        ...(init.headers ?? {}),
      },
    })

  /* A spent token is not sent to be refused: the renewal is waited for
     first. Whatever it comes to, the request then goes, and a refusal is
     the 401 path's below, as it always was. */
  const waiting = session ? ahead?.before() : null
  if (waiting) await waiting
  let res = await send()
  if (res.status === 401 && session) {
    if (await renewOnce()) res = await send()
  }

  if (res.status === 401) {
    setSession(null)
    /* Removed: the sign-in says from where, and that what this device kept
       of it is gone — which the line below makes true before it is said. */
    if (removedFrom !== null) {
      try {
        sessionStorage.setItem(REMOVED_FROM, removedFrom)
      } catch {
        // No storage: signed out, as before, without the sentence.
      }
    }
    /* Ended from elsewhere — signed out on another device, removed from
       the workspace, the account gone: what was kept goes as it would on
       signing out here. */
    void dropPushHere()
      .then(() => wipe())
      .finally(() => onSignedOut?.())
    throw new Error('unauthorized')
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
    throw new Refused(res.status, body.error?.message ?? `${res.status}`, body)
  }
  /* Done, with nothing to say: an empty body read as JSON throws, and a
     disconnect that worked looked as if it had not. */
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

/**
 * Signing in, with the second factor when the account has one.
 *
 * Throws `totp_required` when the password was right and a code is needed —
 * the screen then asks for it. It never sent one, so anybody who turned on
 * two-factor could not sign in to the web again.
 */
export async function signIn(email: string, password: string, totp?: string): Promise<Session> {
  const res = await fetch('/auth/login', {
    method: 'POST',
    headers: authHeaders(),
    /* This client can show the screen of a session in no workspace. */
    body: JSON.stringify({ email, password, nowhere: true, ...(totp ? { totp } : {}) }),
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { code?: string } }
    const code = body.error?.code
    throw new Error(code === 'totp_required' || code === 'email_unverified' ? code : W.couldNotSignIn)
  }
  const s = (await res.json()) as Session
  setSession(s)
  return s
}

/** What an invitation is to, before anybody has an account. */
export async function previewInvite(token: string): Promise<{ workspace_name?: string; state: string; email?: string | null }> {
  const res = await fetch(`/auth/invite/${encodeURIComponent(token)}`)
  if (!res.ok) return { state: 'invalid' }
  return (await res.json()) as { workspace_name?: string; state: string; email?: string | null }
}

/**
 * Taking an invitation: a new account, or an existing one with its own
 * password (and code). Throws the server's code — `totp_required`,
 * `unauthorized`, `not_found`, `limit` — with its message.
 */
export async function acceptInvite(
  token: string,
  input: { name: string; email: string; password: string; totp?: string },
): Promise<Session> {
  const res = await fetch(`/auth/invite/${encodeURIComponent(token)}/accept`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(input),
  })
  const body = (await res.json().catch(() => ({}))) as Session & { error?: { code?: string; message?: string } }
  if (!res.ok) {
    const e = new Error(body.error?.message ?? W.couldNotJoin) as Error & { code?: string | undefined }
    e.code = body.error?.code
    throw e
  }
  setSession(body)
  return body
}

/**
 * What this browser keeps for whoever was signed in, gone —
 * `docs/specs/offline.md`.
 *
 * The copy of what they read (memory and IndexedDB), the half-written
 * messages and the rooms last open, and this device's push subscription.
 * `forget` was written for this and called by nothing: the next person on
 * a shared machine was drawn the last one's sidebar, inbox and searches
 * until their own answers came, their unsent words were in the composer,
 * and their notifications kept arriving.
 */
export async function wipe(): Promise<void> {
  await forget()
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith('tracker:')) localStorage.removeItem(k)
  } catch {
    // Storage refused: nothing was kept there either.
  }
}

/** This device's push subscription, dropped here only — the server's row
    answers 410 at the next send and is removed then. */
async function dropPushHere(): Promise<void> {
  try {
    const reg = await navigator.serviceWorker?.getRegistration('/')
    const sub = await reg?.pushManager.getSubscription()
    await sub?.unsubscribe()
  } catch {
    // No worker, no subscription.
  }
}

/**
 * Every page of a list, for the few that are drawn whole — the sidebar's
 * projects. They were one page of fifty, and the fifty-first project was
 * in no sidebar, no index and no picker.
 */
export async function everyPage<T>(path: string, key: string): Promise<{ [k: string]: T[] }> {
  const all: T[] = []
  let cursor: string | null = null
  const join = path.includes('?') ? '&' : '?'
  do {
    const r: Record<string, unknown> = await api(`${path}${join}limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`)
    all.push(...((r[key] as T[]) ?? []))
    cursor = (r.next_cursor as string | null | undefined) ?? null
  } while (cursor && all.length < 5000)
  return { [key]: all }
}

export async function signOut(): Promise<void> {
  const s = session
  /*
   * The server is told, and not waited for.
   *
   * Sign-out sat through a chunk to load, two round trips — the device's
   * notifications off, then the session ended — and the clear-out before
   * the page went anywhere: most of a second of a pressed button doing
   * nothing visible. Both requests go now with `keepalive`, which a browser
   * finishes after the page has gone, and only what is on this machine is
   * waited for. A notification sent to this device in the moment between
   * is refused by the browser, whose subscription is dropped here first,
   * and the server removes the row at its first 410.
   */
  const sub = await (async () => {
    try {
      const reg = await navigator.serviceWorker?.getRegistration('/')
      return (await reg?.pushManager.getSubscription()) ?? null
    } catch {
      return null
    }
  })()
  if (s) {
    const said = { ...authHeaders(), 'x-api-version': '1', authorization: `Bearer ${s.access_token}` }
    if (sub) {
      void fetch(`${BASE}/push/off`, {
        method: 'POST',
        keepalive: true,
        headers: said,
        body: JSON.stringify({ endpoint: sub.endpoint }),
      }).catch(() => {})
    }
    void fetch('/auth/logout', {
      method: 'POST',
      keepalive: true,
      headers: authHeaders(),
      body: JSON.stringify({ refresh_token: s.refresh_token }),
    }).catch(() => {})
  }
  await sub?.unsubscribe().catch(() => false)
  setSession(null)
  await wipe()
}

/**
 * A uuid v7, made here so a row can be drawn before it is sent.
 *
 * The id used to come back from the server, which meant the screen could
 * not put a message up until it had — two round trips for one message, and
 * 460 ms of nothing on the deployed app. Chosen here, the optimistic row and
 * the stored row are one row, and the merge that folds the real one in has
 * nothing to reconcile.
 *
 * Hand-written rather than the `uuid` package the server uses: the layout is
 * forty-eight bits of millisecond, four of version, and the rest random,
 * and the web bundle does not need a dependency to lay out sixteen bytes.
 *
 * Version 7 and not 4 because these sort by time, the way the server's do.
 */
export function newId(): string {
  const b = new Uint8Array(16)
  crypto.getRandomValues(b)
  const ms = Date.now()
  // Big-endian milliseconds in the first six bytes, which is what makes the
  // string sort in the order the rows were made.
  b[0] = (ms / 2 ** 40) & 0xff
  b[1] = (ms / 2 ** 32) & 0xff
  b[2] = (ms / 2 ** 24) & 0xff
  b[3] = (ms / 2 ** 16) & 0xff
  b[4] = (ms / 2 ** 8) & 0xff
  b[5] = ms & 0xff
  const hex = [...b]
    .map((n, i) => {
      // Version 7 in the high nibble of byte six, and the RFC's variant bits
      // in byte eight. Written while laying out the string rather than back
      // into the array, which the index checks would make three lines of
      // assertions for no gain.
      const v = i === 6 ? 0x70 | (n & 0x0f) : i === 8 ? 0x80 | (n & 0x3f) : n
      return v.toString(16).padStart(2, '0')
    })
    .join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/** A request the product's board makes, asked of the board it is drawing. */
async function callBoard<T>(path: string, init: RequestInit, secret: string): Promise<T> {
  const method = (init.method ?? 'GET').toUpperCase()
  /* A picture on a board is never at an address of its own: its bytes are
     asked for with the board's secret and handed to the screen as a link
     that lives in this tab only. */
  const picture = method === 'GET' ? /^\/files\/([0-9a-f-]{36})\/url$/i.exec(path) : null
  if (picture) {
    const res = await reach(`${BASE}/board/app/images/${picture[1]}`, {
      headers: { 'x-api-version': '1', authorization: `Board ${secret}` },
    })
    if (!res.ok) throw new Refused(res.status, W.notOnBoard)
    const blob = await res.blob()
    return { url: URL.createObjectURL(blob), display_url: null, name: 'Picture', size: blob.size, expires_in: 86_400 } as T
  }
  /* The projects there are: this board's own, which is all a board has. */
  if (method === 'GET' && /^\/projects(\?|$)/.test(path)) {
    const one = boardAsProjects()
    if (one) return one as T
  }
  const to = boardPath(path, method)
  if (!to) throw new Refused(404, W.notOnBoard)
  const res = await reach(`${BASE}${to}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      'x-api-version': '1',
      'x-tongue': now,
      authorization: `Board ${secret}`,
    },
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
    throw new Refused(res.status, body.error?.message ?? `${res.status}`, body)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}
