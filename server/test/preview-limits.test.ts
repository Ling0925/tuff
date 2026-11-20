import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type ServerResponse } from 'node:http'
import type { AddressInfo, Socket } from 'node:net'
import { lookup } from 'node:dns'
import { createHmac } from 'node:crypto'
import { app } from '../src/http/routes.js'
import { ask, fetching, openReads, signature, take, through } from '../src/http/preview.js'
import { env } from '../src/env.js'
import { fileCookie } from '../src/storage.js'
import { machineOf } from '../src/http/machine.js'
import { asTableOwner, closeDb, makeOwner, stamp } from './helpers.js'

after(closeDb)

/*
 * Link previews; the security audit spec,
 * the seventh audit. A site that sent a byte every four seconds
 * held a read open for as long as it liked, nothing counted how many were
 * open, the picture route answered anybody uncounted, and its signed
 * address never ran out.
 */

const with_ = async <T>(change: Partial<typeof fetching>, work: () => Promise<T>): Promise<T> => {
  const was = { ...fetching }
  Object.assign(fetching, change)
  try {
    return await work()
  } finally {
    Object.assign(fetching, was)
  }
}

test('a site that drips its page is dropped at the deadline, socket and all', async () => {
  const sockets: Socket[] = []
  const drips: NodeJS.Timeout[] = []
  const site = createServer((_req, res: ServerResponse) => {
    res.writeHead(200, { 'content-type': 'text/html' })
    res.write('<html><head>')
    // A byte at a time, well inside the idle timeout, for ever.
    drips.push(setInterval(() => res.write(' '), 50))
  })
  site.on('connection', (s) => sockets.push(s))
  await new Promise<void>((done) => site.listen(0, '127.0.0.1', () => done()))
  const port = (site.address() as AddressInfo).port
  try {
    /* Through a lookup of the test's own: the real reads' refuses this machine. */
    const read = ask(new URL(`http://localhost:${port}/slow`), 'page', Date.now() + 200, lookup as never)
    await assert.rejects(read, /too slow/)
    // The site's end of the socket closes: nothing is held open after the deadline.
    await Promise.all(sockets.map((s) => (s.destroyed ? null : new Promise((done) => s.on('close', done)))))
    assert.ok(sockets.length > 0 && sockets.every((s) => s.destroyed))
  } finally {
    for (const d of drips) clearInterval(d)
    site.close()
  }
})

/*
 * And one whose body is never read — a wrong type, a redirect — is not
 * drained either: drained, it kept its socket with only the idle timeout,
 * past the deadline and with its place given back. The
 * test's own timeout is what fails it if the socket is kept.
 */
for (const [label, status, headers] of [
  ['200 text/plain', 200, { 'content-type': 'text/plain' }],
  ['302 with a body', 302, { location: '/next', 'content-type': 'text/html' }],
] as const) {
  test(`a ${label} that drips is let go at once, socket and all`, { timeout: 10_000 }, async () => {
    const sockets: Socket[] = []
    const drips: NodeJS.Timeout[] = []
    const site = createServer((_req, res: ServerResponse) => {
      res.writeHead(status, headers)
      res.write('x')
      drips.push(setInterval(() => res.write(' '), 50))
    })
    site.on('connection', (s) => sockets.push(s))
    await new Promise<void>((done) => site.listen(0, '127.0.0.1', () => done()))
    const port = (site.address() as AddressInfo).port
    try {
      const got = await ask(new URL(`http://localhost:${port}/x`), 'page', Date.now() + 60_000, lookup as never)
      assert.equal(got.status, status)
      assert.equal(got.body, '')
      await Promise.all(sockets.map((s) => (s.destroyed ? null : new Promise((done) => s.on('close', done)))))
      assert.ok(sockets.length > 0 && sockets.every((s) => s.destroyed))
    } finally {
      for (const d of drips) clearInterval(d)
      site.close()
    }
  })
}

test('reads open at once are capped for the process and shared out among callers', async () => {
  await with_({ most: 2, perCaller: 1 }, async () => {
    const before = openReads()
    const a = take('a')
    assert.ok(a)
    assert.equal(take('a'), null, 'one caller holds one')
    const b = take('b')
    assert.ok(b)
    assert.equal(take('c'), null, 'the process is full')
    a()
    a() // given back once, however often it is called
    const c = take('c')
    assert.ok(c)
    b()
    c()
    assert.equal(openReads(), before)
  })
})

test('a card refused for want of a place says so, and is not kept as no card', async () => {
  const { token } = await makeOwner()
  const url = `https://nowhere-${stamp()}.invalid/page`
  const askFor = async () => app.request(`/api/preview?url=${encodeURIComponent(url)}`, { headers: { authorization: `Bearer ${token}` } })
  const refused = await with_({ most: 0 }, askFor)
  assert.equal(refused.status, 429)
  assert.equal(((await refused.json()) as { error: { code: string } }).error.code, 'busy')
  // With room again it is read, and found to be nothing.
  assert.equal((await askFor()).status, 422)
})

test('a picture’s signed address has a date; past it, or unsigned by date, it is for somebody signed in', () => {
  const u = 'https://example.com/p.png'
  const path = new URL(through(u), 'http://x')
  const e = path.searchParams.get('e')!
  const s = path.searchParams.get('s')!
  assert.equal(path.searchParams.get('u'), u)
  assert.ok(Number(e) * 1000 > Date.now())
  assert.equal(signature(u, e, s), 'open')
  assert.equal(signature(u, e, s, Number(e) * 1000 + 1), 'members')
  assert.equal(signature(u, String(Number(e) + 1), s), 'forged', 'the date is signed')
  assert.equal(signature('https://example.com/other.png', e, s), 'forged')
  // An address the shipped apps and every sent card already hold: signed over the address alone.
  const old = legacy(u)
  assert.equal(signature(u, undefined, old, fetching.legacyUntil - 1), 'open')
  assert.equal(signature(u, undefined, old, fetching.legacyUntil), 'members')
  assert.equal(signature(u, undefined, 'x'.repeat(32)), 'forged')
})

/* The signature as it was made before it had a date — written out again
   here rather than borrowed, so a change to it is caught. */
function legacy(u: string): string {
  const key = createHmac('sha256', env.jwtSecret).update('tuff:preview-picture').digest()
  return createHmac('sha256', key).update(u).digest('base64url').slice(0, 32)
}

let n = Math.floor(Math.random() * 200)
/* Each request from an address of its own, so no two tests share a count. */
const from = () => ({ 'x-forwarded-for': `203.0.113.${(n++ % 200) + 1}, 10.0.0.9` })
/* A private address: once the signature is taken, the read is refused before
   any socket, so `gone` says the signature passed and `not_found` that it did not. */
const target = () => `https://10.0.0.1/p-${stamp()}.png`
async function code(path: string, headers: Record<string, string>): Promise<string> {
  const r = await app.request(path, { headers })
  return ((await r.json()) as { error: { code: string } }).error.code
}

test('the picture route answers a stranger only while the address is in date', async () => {
  const { ctx, token } = await makeOwner()
  const bearer = { authorization: `Bearer ${token}` }
  const cookie = { cookie: `tracker_files=${fileCookie(ctx.actorId)}` }

  const fresh = through(target())
  assert.equal(await code(fresh, from()), 'gone')

  const past = through(target(), Math.floor(Date.now() / 1000) - 60)
  assert.equal(await code(past, from()), 'not_found')
  // Somebody signed in reads what was sent to them however old: the app by its bearer, the browser by its pass.
  assert.equal(await code(past, { ...from(), ...bearer }), 'gone')
  assert.equal(await code(past, { ...from(), ...cookie }), 'gone')

  const u = target()
  const old = `/api/preview/image?u=${encodeURIComponent(u)}&s=${legacy(u)}`
  await with_({ legacyUntil: Date.now() + 60_000 }, async () => {
    assert.equal(await code(old, from()), 'gone')
  })
  await with_({ legacyUntil: 0 }, async () => {
    assert.equal(await code(old, from()), 'not_found')
    assert.equal(await code(old, { ...from(), ...bearer }), 'gone')
  })
})

test('the picture route counts who asks', async () => {
  const headers = from()
  const ip = headers['x-forwarded-for'].split(',')[0]!
  await asTableOwner()`
    insert into rate_window (key, window_start, hits)
    values (${`picture:ip:${ip}`}, to_timestamp(floor(extract(epoch from now()) / 60) * 60), 1000000)
    on conflict (key, window_start) do update set hits = 1000000`
  const r = await app.request(through(target()), { headers })
  assert.equal(r.status, 429)
})

test('an IPv6 machine is counted by its /64, not by each address in it', async () => {
  const net = `2001:db8:${(Math.floor(Math.random() * 0xffff) + 1).toString(16)}:42`
  assert.equal(machineOf(`${net}::1`), machineOf(`${net}::beef`))
  await asTableOwner()`
    insert into rate_window (key, window_start, hits)
    values (${`picture:ip:${machineOf(`${net}::1`)}`}, to_timestamp(floor(extract(epoch from now()) / 60) * 60), 1000000)
    on conflict (key, window_start) do update set hits = 1000000`
  // Another address in the same /64 is the same machine, and as spent.
  const r = await app.request(through(target()), { headers: { 'x-forwarded-for': `${net}::beef, 10.0.0.9` } })
  assert.equal(r.status, 429)
})

/* The apps send their bearer with every picture; one that ran out is told so,
   and renews it, rather than reading a 404 as no picture. */
test('a bearer that does not hold is answered 401, not 404', async () => {
  const fresh = through(target())
  const past = through(target(), Math.floor(Date.now() / 1000) - 60)
  for (const path of [fresh, past]) {
    const r = await app.request(path, { headers: { ...from(), authorization: 'Bearer not-a-token-at-all' } })
    assert.equal(r.status, 401)
  }
  // And a forged address is still not found, whoever asks.
  const forged = `/api/preview/image?u=${encodeURIComponent(target())}&e=9999999999&s=${'x'.repeat(32)}`
  assert.equal((await app.request(forged, { headers: { authorization: 'Bearer not-a-token-at-all' } })).status, 404)
})
