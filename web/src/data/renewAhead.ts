/*
 * Renewing the session before it runs out, not after.
 *
 * The access token lives a quarter of an hour, and the client renewed it
 * only after a request came back 401. A tab back from a break sent a dozen
 * reads at once, every one was refused, and each went twice. So the renewal
 * is asked for ahead: a minute before the token ends, when the tab comes
 * back with less than two minutes left, and before a request whose token is
 * spent. Each goes through the one shared renewal (`renewOnce` in `api.ts`,
 * behind its lock across tabs), and the 401 stays the fallback for whatever
 * this misses — and the only thing that signs out.
 *
 * This decides *when*; it holds no session and talks to no server, so it is
 * tested on its own clock (`web/test/renew-ahead.test.ts`).
 */

/** A minute before the token ends. */
export const AHEAD_MS = 60_000
/** A tab come back with less than this left renews at once. */
export const BACK_MS = 120_000
/** A request about to carry a token this close to its end waits for the renewal. */
export const SPENT_MS = 5_000
/** After a renewal that brought nothing usable, the next is not asked ahead sooner. */
export const RETRY_MS = 30_000
/** The longest a timer is set for; past it, it only looks again. A browser
    fires anything over 2³¹ ms at once, and the timer would spin. */
export const MAX_WAIT_MS = 15 * 60_000

export type Timed = {
  access_token: string
  workspace_id?: string | null
  expires_in?: number
  expires_at?: number
}

/** When this session's token ends, on this machine's clock, if it can be told. */
export function expiresAt(s: Timed | null): number | null {
  if (!s) return null
  if (typeof s.expires_at === 'number') return s.expires_at
  /* A session kept before `expires_at` was written: the token's own `exp`,
     on the server's clock, until its first renewal. */
  try {
    const part = s.access_token.split('.')[1]
    if (!part) return null
    const exp = (JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/'))) as { exp?: unknown }).exp
    return typeof exp === 'number' ? exp * 1000 : null
  } catch {
    return null
  }
}

/**
 * A session as the server gave it, with the moment its token ends written
 * on it — counted on this machine's clock, so a clock minutes out with the
 * server's renews on time all the same. A renewal passes the moment it was
 * asked for (`renew` in `api.ts`), so a slow answer does not make the token
 * seem to live longer than it does; a sign-in counts from its arrival.
 */
export function stamped<S extends Timed>(s: S, now = Date.now()): S {
  if (typeof s.expires_at === 'number' || typeof s.expires_in !== 'number') return s
  return { ...s, expires_at: now + s.expires_in * 1000 }
}

export type Ahead = {
  /** Look again at when the token ends — a new session, another tab's. */
  reschedule(): void
  /** The tab is in front of somebody again, or has just loaded. */
  returned(): void
  /**
   * For a request about to be sent: the renewal to wait for when its token
   * is spent — the one already on its way, or a new one — and null when the
   * token is still good to send, even while a renewal is on its way.
   */
  before(): Promise<boolean> | null
}

export function renewAhead(deps: {
  /** This tab's session as it is now. */
  current: () => Timed | null
  /** The one shared renewal: true when there is a new session, false when
      the server refused, a throw when it could not be asked. */
  renew: () => Promise<boolean>
  now?: () => number
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (t: unknown) => void
}): Ahead {
  const now = deps.now ?? (() => Date.now())
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
  const clearTimer = deps.clearTimer ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>))
  let timer: unknown = null
  let flying: Promise<boolean> | null = null
  /* Not asked ahead before this, after a renewal that brought nothing usable,
     so a failing one is not asked on every request and tick. */
  let pausedUntil = Number.NEGATIVE_INFINITY
  /* The token whose renewal the server refused. Its refresh token is dead:
     nothing is asked ahead for it again, and the next request's 401 signs
     out, as it always did. A new session is a new token, and starts afresh. */
  let refusedFor: string | null = null

  /* How long the token has left, or null when this is not to renew ahead. */
  const left = (): number | null => {
    const s = deps.current()
    if (!s || s.access_token === refusedFor) return null
    /* A session in no workspace stays on the 401 path: its refresh may move
       it into a workspace, which the server's grace does not answer twice,
       and two tabs' timers firing together would race on it. */
    if (s.workspace_id === null) return null
    const at = expiresAt(s)
    return at === null ? null : at - now()
  }
  /* A pause further off than it could ever be is a clock that went back:
     not believed. */
  const mayTry = () => {
    const wait = pausedUntil - now()
    return wait <= 0 || wait > RETRY_MS
  }

  const go = (): Promise<boolean> | null => {
    if (flying) return flying
    if (!mayTry()) return null
    const asked = deps.current()?.access_token ?? null
    flying = deps
      .renew()
      .then(
        (ok) => {
          if (!ok) refusedFor = asked
          return ok
        },
        () => false,
      )
      .then((ok) => {
        /* A renewal that worked holds nothing back — unless the token it
           brought is already due, when asking at once would never stop. */
        const l = left()
        pausedUntil = ok && l !== null && l > AHEAD_MS ? Number.NEGATIVE_INFINITY : now() + RETRY_MS
        return ok
      })
      .finally(() => {
        flying = null
        schedule()
      })
    return flying
  }

  const schedule = (): void => {
    if (timer !== null) clearTimer(timer)
    timer = null
    if (flying) return
    const l = left()
    if (l === null) return
    const wait = Math.min(Math.max(l - AHEAD_MS, pausedUntil - now(), 0), MAX_WAIT_MS)
    timer = setTimer(fire, wait)
  }

  const fire = (): void => {
    timer = null
    const l = left()
    /* Another tab may have renewed meanwhile, or the wait was only the
       longest a timer is set for: then this is only a look again. */
    if (l !== null && l <= AHEAD_MS && go()) return
    schedule()
  }

  return {
    reschedule: schedule,
    returned() {
      const l = left()
      if (l !== null && l < BACK_MS) void go()
    },
    before() {
      const l = left()
      if (l === null || l >= SPENT_MS) return null
      return go()
    },
  }
}
