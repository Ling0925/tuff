import { mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { AHEAD_MS, MAX_WAIT_MS, RETRY_MS, expiresAt, renewAhead, stamped } from '../src/data/renewAhead.js'

/*
 * The session is renewed ahead of its end, not after a burst of 401s.
 *
 * First the scheduler on a clock that moves only when told, then `api.ts`
 * itself in a pretend browser whose server refuses a spent token.
 */

const MIN = 60_000
const settled = () => new Promise((done) => setImmediate(done))

/* A clock and a list of timers that move only when told. */
function clock() {
  let t = 0
  const timers: { at: number; fn: () => void; gone: boolean }[] = []
  return {
    now: () => t,
    setTimer: (fn: () => void, ms: number) => {
      const timer = { at: t + ms, fn, gone: false }
      timers.push(timer)
      return timer
    },
    clearTimer: (timer: unknown) => {
      ;(timer as { gone: boolean }).gone = true
    },
    pending: () => timers.filter((x) => !x.gone).map((x) => x.at),
    /* To `to`, running whatever falls due on the way. */
    async go(to: number) {
      for (;;) {
        const next = timers.filter((x) => !x.gone && x.at <= to).sort((a, b) => a.at - b.at)[0]
        if (!next) break
        t = next.at
        next.gone = true
        next.fn()
        await settled()
      }
      t = to
    },
  }
}

/* A session whose token ends at `endsAt`, and a renewal held until answered. */
function fixture(endsAt: number, workspace: string | null = 'w') {
  const c = clock()
  let s: { access_token: string; workspace_id: string | null; expires_at: number } | null = {
    access_token: 't0',
    workspace_id: workspace,
    expires_at: endsAt,
  }
  let renewals = 0
  let answer: 'ok' | 'refused' | 'offline' = 'ok'
  let hold: (() => void) | null = null
  const a = renewAhead({
    current: () => s,
    renew: async () => {
      renewals++
      await new Promise<void>((done) => {
        hold = done
      })
      if (answer === 'offline') throw new Error('offline')
      if (answer === 'ok' && s) s = { ...s, access_token: `t${renewals}`, expires_at: c.now() + 15 * MIN }
      return answer === 'ok'
    },
    now: c.now,
    setTimer: c.setTimer,
    clearTimer: c.clearTimer,
  })
  return {
    a,
    c,
    renewals: () => renewals,
    says: (what: typeof answer) => {
      answer = what
    },
    answer: async () => {
      hold?.()
      hold = null
      await settled()
    },
    renewedElsewhere: (at: number) => {
      s = { access_token: 'other', workspace_id: workspace, expires_at: at }
    },
  }
}

test('the timer renews a minute before the end, once, and again a minute before the next end', async () => {
  const f = fixture(15 * MIN)
  f.a.reschedule()
  assert.deepEqual(f.c.pending(), [15 * MIN - AHEAD_MS])
  await f.c.go(14 * MIN)
  assert.equal(f.renewals(), 1)
  await f.answer()
  assert.deepEqual(f.c.pending(), [14 * MIN + 15 * MIN - AHEAD_MS])
  await f.c.go(20 * MIN)
  assert.equal(f.renewals(), 1, 'nothing more until a minute before the next end')
  await f.c.go(28 * MIN)
  assert.equal(f.renewals(), 2)
})

test('a tab come back far from the end renews nothing, and its requests go as they are', () => {
  const f = fixture(10 * MIN)
  f.a.returned()
  f.a.returned()
  assert.equal(f.a.before(), null)
  assert.equal(f.renewals(), 0)
})

test('a tab come back with less than two minutes left renews once, however often it is told', async () => {
  const f = fixture(90_000)
  f.a.returned()
  f.a.returned()
  f.a.returned()
  assert.equal(f.renewals(), 1)
  await f.answer()
  f.a.returned()
  assert.equal(f.renewals(), 1, 'the new token has a quarter of an hour')
})

test('a dozen requests carrying a spent token wait for one renewal', async () => {
  const f = fixture(15 * MIN)
  await f.c.go(20 * MIN)
  const waits = Array.from({ length: 12 }, () => f.a.before())
  assert.ok(waits.every((w) => w instanceof Promise))
  assert.equal(f.renewals(), 1)
  await f.answer()
  assert.deepEqual(await Promise.all(waits), Array(12).fill(true))
  assert.equal(f.a.before(), null, 'and the next request has a good token')
})

test('a request with a good token does not wait on a renewal on its way', () => {
  const f = fixture(90_000)
  f.a.returned()
  assert.equal(f.renewals(), 1)
  assert.equal(f.a.before(), null)
})

test('a refused renewal is not asked ahead again for that token: the 401 path decides', async () => {
  const f = fixture(0)
  f.says('refused')
  const first = f.a.before()
  assert.ok(first)
  await f.answer()
  assert.equal(await first, false)
  assert.equal(f.a.before(), null)
  f.a.returned()
  await f.c.go(10 * MIN)
  assert.equal(f.renewals(), 1)
  assert.deepEqual(f.c.pending(), [], 'no timer left asking')
})

test('a renewal that could not be made is asked again thirty seconds on, not on every request and tick', async () => {
  const f = fixture(30_000)
  f.says('offline')
  f.a.reschedule()
  await f.c.go(1)
  assert.equal(f.renewals(), 1)
  await f.answer()
  assert.equal(f.a.before(), null, 'paused: the request goes and the 401 path has it')
  f.a.returned()
  assert.equal(f.renewals(), 1)
  assert.deepEqual(f.c.pending(), [1 + RETRY_MS])
  f.says('ok')
  await f.c.go(1 + RETRY_MS)
  assert.equal(f.renewals(), 2)
})

test('a renewal another tab made is only looked at when the timer fires', async () => {
  const f = fixture(15 * MIN)
  f.a.reschedule()
  f.renewedElsewhere(28 * MIN)
  await f.c.go(14 * MIN)
  assert.equal(f.renewals(), 0)
  assert.deepEqual(f.c.pending(), [28 * MIN - AHEAD_MS])
})

test('a session in no workspace is left to the 401 path', async () => {
  const f = fixture(30_000, null)
  f.a.reschedule()
  f.a.returned()
  assert.equal(f.a.before(), null)
  await f.c.go(10 * MIN)
  assert.equal(f.renewals(), 0)
})

test('a far end sets the timer for no more than fifteen minutes, which only looks again', async () => {
  const f = fixture(400 * 24 * 60 * MIN)
  f.a.reschedule()
  assert.deepEqual(f.c.pending(), [MAX_WAIT_MS])
  await f.c.go(MAX_WAIT_MS)
  assert.equal(f.renewals(), 0)
  assert.deepEqual(f.c.pending(), [2 * MAX_WAIT_MS])
})

test('when a token ends is counted on this clock from when it came', () => {
  assert.deepEqual(stamped({ access_token: 'x', expires_in: 900 }, 1000), { access_token: 'x', expires_in: 900, expires_at: 901_000 })
  const kept = { access_token: 'x', expires_in: 900, expires_at: 5 }
  assert.equal(stamped(kept, 1000), kept)
  /* A session kept before this: the token's own `exp`. */
  const body = Buffer.from(JSON.stringify({ exp: 1_700_000_000 })).toString('base64url')
  assert.equal(expiresAt({ access_token: `h.${body}.s` }), 1_700_000_000_000)
  assert.equal(expiresAt({ access_token: 'nonsense' }), null)
})

/*
 * The same, through `api.ts` itself: copies of the module are tabs of one
 * origin, sharing one storage, one lock and one server whose refresh tokens
 * are spent by use, and which refuses any access token it did not give.
 */
function browser(opts: { locks?: boolean; slow?: Promise<void> } = {}) {
  const win = new EventTarget()
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' })
  const kept = new Map<string, string>()
  const storage = {
    getItem: (k: string) => kept.get(k) ?? null,
    setItem: (k: string, v: string) => {
      kept.set(k, v)
      /* Every tab hears it, as other tabs do in a browser, with the value
         as it was written. */
      queueMicrotask(() => win.dispatchEvent(Object.assign(new Event('storage'), { key: k, newValue: v })))
    },
    removeItem: (k: string) => {
      kept.delete(k)
      queueMicrotask(() => win.dispatchEvent(Object.assign(new Event('storage'), { key: k, newValue: null })))
    },
    key: () => null,
    get length() {
      return kept.size
    },
  }
  const chains = new Map<string, Promise<unknown>>()
  const locks = {
    request: (name: string, fn: () => Promise<unknown>) => {
      const run = (chains.get(name) ?? Promise.resolve()).then(fn)
      chains.set(
        name,
        run.catch(() => {}),
      )
      return run
    },
  }
  const server = { refreshes: 0, refused: 0, spent: new Map<string, number>(), live: new Set<string>() }
  const said = (status: number, body: unknown) => new Response(JSON.stringify(body), { status })
  const fetch = async (url: string, init: RequestInit = {}) => {
    if (url.endsWith('/auth/refresh')) {
      await opts.slow
      server.refreshes++
      const { refresh_token } = JSON.parse(String(init.body)) as { refresh_token: string }
      /* Spent already: the grace answers with the same session. */
      const again = server.spent.get(refresh_token)
      if (again !== undefined) {
        return said(200, { access_token: `new${again}`, refresh_token: `r${again}`, actor_id: 'me', workspace_id: 'w', expires_in: 900 })
      }
      const n = server.refreshes
      server.spent.set(refresh_token, n)
      server.live.add(`new${n}`)
      return said(200, { access_token: `new${n}`, refresh_token: `r${n}`, actor_id: 'me', workspace_id: 'w', expires_in: 900 })
    }
    const bearer = String((init.headers as Record<string, string>).authorization ?? '').replace('Bearer ', '')
    if (!server.live.has(bearer)) {
      server.refused++
      return said(401, { error: { code: 'unauthorized' } })
    }
    return said(200, { bearer })
  }
  for (const [k, v] of Object.entries({ window: win, document: doc, localStorage: storage, sessionStorage: storage, fetch })) {
    Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true })
  }
  Object.defineProperty(globalThis, 'navigator', {
    value: { language: 'en', onLine: true, ...(opts.locks === false ? {} : { locks }) },
    configurable: true,
  })
  return { server, storage, doc, win }
}

let copy = 0
const tab = async () => (await import(`../src/data/api.js?tab=${++copy}`)) as typeof import('../src/data/api.js')
const kept = (endsIn: number) =>
  JSON.stringify({ access_token: 'old', refresh_token: 'r0', actor_id: 'me', workspace_id: 'w', expires_at: Date.now() + endsIn })

async function inAClock(fn: () => Promise<void>) {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_800_000_000_000 })
  try {
    await fn()
  } finally {
    mock.timers.reset()
  }
}

test('through api.ts: a tab opened twenty minutes on renews once, before its reads, and nothing is refused', () =>
  inAClock(async () => {
    const b = browser()
    b.storage.setItem('session', kept(-20 * MIN))
    const api = await tab()
    const answers = await Promise.all(Array.from({ length: 12 }, (_, i) => api.api<{ bearer: string }>(`/read/${i}`)))
    assert.equal(b.server.refreshes, 1)
    assert.equal(b.server.refused, 0, 'no request went out to be refused')
    assert.ok(answers.every((a) => a.bearer === 'new1'))
    assert.equal(typeof api.stored()?.expires_at, 'number', 'the new session carries its end')
  }))

test('through api.ts: reads sent with a token that ran out while the timers slept wait for one renewal', () =>
  inAClock(async () => {
    const b = browser()
    b.storage.setItem('session', kept(15 * MIN))
    const api = await tab()
    await settled()
    /* Twenty minutes on, and neither the timer nor coming back heard of it. */
    mock.timers.setTime(Date.now() + 20 * MIN)
    const answers = await Promise.all(Array.from({ length: 12 }, (_, i) => api.api<{ bearer: string }>(`/read/${i}`)))
    assert.equal(b.server.refreshes, 1)
    assert.equal(b.server.refused, 0, 'no request went out to be refused')
    assert.ok(answers.every((a) => a.bearer === 'new1'))
  }))

test('through api.ts: a tab come back with a minute and a half left renews on coming back', () =>
  inAClock(async () => {
    const b = browser()
    b.storage.setItem('session', kept(15 * MIN))
    const api = await tab()
    await settled()
    assert.equal(b.server.refreshes, 0, 'loaded far from the end: nothing')
    /* The lid closed for thirteen and a half minutes: the timer did not run. */
    mock.timers.setTime(Date.now() + 13.5 * MIN)
    b.doc.dispatchEvent(new Event('visibilitychange'))
    b.win.dispatchEvent(new Event('focus'))
    await settled()
    await settled()
    assert.equal(b.server.refreshes, 1, 'once, though it heard both')
    assert.equal(api.stored()?.refresh_token, 'r1')
  }))

test('through api.ts: the timer renews a minute ahead, once', () =>
  inAClock(async () => {
    const b = browser()
    b.storage.setItem('session', kept(15 * MIN))
    const api = await tab()
    mock.timers.tick(13 * MIN)
    await settled()
    assert.equal(b.server.refreshes, 0, 'not yet')
    mock.timers.tick(MIN + 1)
    await settled()
    await settled()
    assert.equal(b.server.refreshes, 1)
    assert.equal((await api.api<{ bearer: string }>('/read')).bearer, 'new1')
    assert.equal(b.server.refreshes, 1)
  }))

test('through api.ts: two tabs come back together spend the refresh token once', () =>
  inAClock(async () => {
    const b = browser()
    b.storage.setItem('session', kept(90_000))
    const one = await tab()
    const two = await tab()
    const [a, c] = await Promise.all([one.api<{ bearer: string }>('/read'), two.api<{ bearer: string }>('/read')])
    assert.equal(b.server.refreshes, 1, 'the second tab took up the first one’s renewal')
    assert.equal(a.bearer, 'new1')
    assert.equal(c.bearer, 'new1')
  }))

test('through api.ts: two tabs with no Web Locks both send the token, and both stay signed in', () =>
  inAClock(async () => {
    const b = browser({ locks: false })
    b.storage.setItem('session', kept(-MIN))
    const one = await tab()
    const two = await tab()
    const [a, c] = await Promise.all([one.api<{ bearer: string }>('/read'), two.api<{ bearer: string }>('/read')])
    assert.equal(a.bearer, 'new1')
    assert.equal(c.bearer, 'new1', 'the server’s grace gave the second the same session')
    assert.equal(b.server.refused, 0)
  }))

test('through api.ts: a renewal that lands after signing out is not written back', () =>
  inAClock(async () => {
    let answer = () => {}
    const b = browser({ slow: new Promise<void>((done) => (answer = done)) })
    b.storage.setItem('session', kept(90_000))
    const api = await tab()
    /* Loaded with a minute and a half left: the renewal is on its way. */
    api.setSession(null)
    answer()
    await settled()
    await settled()
    assert.equal(b.server.refreshes, 1)
    assert.equal(api.stored(), null, 'still signed out')
  }))

/*
 * A renewal for workspace X that lands after the tab moved to W — a
 * workspace created, one left, an invitation taken — is not kept: the tab
 * stays in W, in memory and in storage, and the request that waited on it
 * goes with W's token rather than signing the tab out. The tabs still in X
 * are handed it, since it spent the refresh token they hold.
 */
test('through api.ts: a renewal for the workspace left lands after the move, and the tab stays where it went', () =>
  inAClock(async () => {
    let answer = () => {}
    const b = browser({ slow: new Promise<void>((done) => (answer = done)) })
    b.server.live.add('wtok')
    b.storage.setItem('session', kept(90_000))
    const one = await tab()
    const two = await tab()
    await settled()
    /* Loaded with a minute and a half left: one renewal on its way, the
       other tab waiting behind the lock. A read with X's token is refused
       and waits on the same renewal. */
    const read = one.api<{ bearer: string }>('/read')
    await settled()
    one.setSession({ access_token: 'wtok', refresh_token: 'rw', actor_id: 'me', workspace_id: 'W', expires_in: 900 })
    answer()
    assert.equal((await read).bearer, 'wtok', 'sent again with W’s token, not signed out')
    await settled()
    assert.equal(one.stored()?.workspace_id, 'W')
    assert.equal(one.stored()?.access_token, 'wtok')
    assert.equal(b.storage.getItem('session:handed'), null, 'the hand-over is never left in storage')
    /* The tab still in X took the renewal up, and spent nothing itself. */
    assert.equal((await two.api<{ bearer: string }>('/read')).bearer, 'new1')
    assert.equal(b.server.refreshes, 1)
    assert.equal((await one.api<{ bearer: string }>('/read')).bearer, 'wtok')
  }))

test('through api.ts: a renewed token’s end is counted from when it was asked for', () =>
  inAClock(async () => {
    let answer = () => {}
    const b = browser({ slow: new Promise<void>((done) => (answer = done)) })
    b.storage.setItem('session', kept(90_000))
    const api = await tab()
    const asked = Date.now()
    mock.timers.setTime(asked + 7000)
    answer()
    await settled()
    await settled()
    assert.equal(b.server.refreshes, 1)
    assert.equal(api.stored()?.expires_at, asked + 900_000)
  }))
