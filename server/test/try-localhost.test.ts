import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { env, readTryLocalhost } from '../src/env.js'
import { loopbackHost, secureAttr } from '../src/tryLocalhost.js'
import { cookieHeader } from '../src/storage.js'
import { app } from '../src/http/routes.js'
import { closeDb } from './helpers.js'

after(async () => {
  await closeDb()
})

/*
 * Tuff tried on one computer over plain http.
 * `TRY_LOCALHOST=1` takes `Secure` off two cookies, so it must be
 * impossible to have on a server people reach over a network.
 */

const src = join(dirname(fileURLToPath(import.meta.url)), '..', 'src')

/* For the length of one block, as the try install runs. */
async function trying<T>(on: boolean, work: () => Promise<T> | T): Promise<T> {
  const was = { node: process.env.NODE_ENV, on: env.tryLocalhost, appUrl: env.appUrl }
  process.env.NODE_ENV = 'production'
  env.tryLocalhost = on
  env.appUrl = 'http://localhost:8081'
  try {
    return await work()
  } finally {
    process.env.NODE_ENV = was.node
    env.tryLocalhost = was.on
    env.appUrl = was.appUrl
  }
}

test('TRY_LOCALHOST is on only beside an APP_URL of http://localhost or http://127.0.0.1', () => {
  for (const off of [undefined, '', '0', 'false', 'no', 'off', ' OFF ']) {
    assert.equal(readTryLocalhost(off, 'https://tuff.example.com'), false, String(off))
  }
  for (const url of ['http://localhost', 'http://localhost:8081', 'http://localhost:8081/', 'http://127.0.0.1:3000']) {
    assert.equal(readTryLocalhost('1', url), true, url)
  }
  assert.equal(readTryLocalhost('yes', 'http://localhost:8081'), true)
  for (const url of [
    '',
    undefined,
    'not a url',
    'https://localhost:8443',
    'https://tuff.example.com',
    'http://tuff.example.com',
    'http://192.168.1.20:8081',
    'http://10.0.0.1',
    'http://0.0.0.0:8081',
    'http://[::1]:8081',
    'http://localhost.:8081',
    'http://localhost.example.com',
    'http://localhost@tuff.example.com',
    'http://user:pass@localhost:8081',
    'http://localhost:8081/tuff',
    'http://localhost:8081/?x=1',
    'http://localhost:8081/#x',
    'http://localhost:8081?',
    'ws://localhost:8081',
    // Matched as written: what is checked is what the server uses.
    'http://LOCALHOST:8081',
    ' http://localhost:8081',
    'http://localhost:8081 ',
    'http://localhost:8081\nx',
    'http://127.1:8081',
    'http://localhost:8081//',
  ]) {
    assert.throws(() => readTryLocalhost('1', url), /Refusing to start/, String(url))
  }
  // Not a guess at what somebody meant.
  assert.throws(() => readTryLocalhost('maybe', 'http://localhost:8081'), /TRY_LOCALHOST is 1 or nothing/)
})

/* The real processes, as the try install's compose file starts them — but
   on a real server's address. Neither may get as far as listening. */
for (const entry of ['main.ts', 'worker.ts']) {
  test(`${entry === 'main.ts' ? 'the app' : 'the worker'} refuses to start with TRY_LOCALHOST=1 on a real server's APP_URL`, () => {
    for (const appUrl of ['https://tuff.example.com', 'http://tuff.example.com', '']) {
      const r = spawnSync(process.execPath, ['--import', 'tsx', join(src, entry)], {
        env: { ...process.env, NODE_ENV: 'production', TRY_LOCALHOST: '1', APP_URL: appUrl, PORT: '0', MIGRATE_ON_START: '' },
        encoding: 'utf8',
        timeout: 30_000,
      })
      assert.notEqual(r.status, 0, `${entry} ${appUrl}: ${r.stdout}`)
      assert.equal(r.signal, null, `${entry} ${appUrl} ran until it was stopped`)
      assert.match(r.stderr, /TRY_LOCALHOST=1 is for trying Tuff on this computer/)
      assert.match(r.stderr, /Refusing to start/)
      assert.doesNotMatch(r.stdout, /^server: /m)
    }
  })
}

test('trying it, only requests addressed to localhost are answered', async () => {
  await trying(true, async () => {
    for (const host of ['localhost:8081', '127.0.0.1:8787', 'localhost', 'LOCALHOST:8081']) {
      const r = await app.request('http://localhost/health', { headers: { host } })
      assert.equal(r.status, 200, host)
    }
    for (const host of [
      'tuff.example.com',
      'rebind.attacker.example:8081',
      '192.168.1.20:8081',
      '[::1]:8081',
      'localhost.attacker.example',
      '',
    ]) {
      const r = await app.request('http://localhost/health', { headers: { host } })
      assert.equal(r.status, 421, host)
      assert.match(await r.text(), /trying on one computer/)
    }
  })
  // A server never asks.
  const r = await app.request('http://tuff.example.com/health', { headers: { host: 'tuff.example.com' } })
  assert.equal(r.status, 200)
})

/* A tunnel or proxy that rewrites Host to localhost — ngrok's
   `--host-header=rewrite`, cloudflared's `httpHostHeader` — still says it
   forwarded the request. */
test('trying it, a request that came through a proxy or a tunnel is not answered', async () => {
  const through: Record<string, string>[] = [
    { 'x-forwarded-for': '203.0.113.7' },
    { 'x-forwarded-host': 'tunnel.example' },
    { 'x-forwarded-proto': 'https' },
    { forwarded: 'for=203.0.113.7;proto=https' },
    { via: '1.1 cloudflared' },
    { 'x-real-ip': '203.0.113.7' },
    { 'cf-connecting-ip': '203.0.113.7' },
    { 'true-client-ip': '203.0.113.7' },
    { 'x-forwarded-for': '' },
  ]
  await trying(true, async () => {
    for (const extra of through) {
      const r = await app.request('http://localhost/health', { headers: { host: 'localhost:8081', ...extra } })
      assert.equal(r.status, 421, JSON.stringify(extra))
    }
  })
  // A server behind its own proxy is not touched.
  for (const extra of through) {
    const r = await app.request('http://tuff.example.com/health', { headers: { host: 'tuff.example.com', ...extra } })
    assert.notEqual(r.status, 421, JSON.stringify(extra))
  }
})

test('the Host check reads only localhost and 127.0.0.1', () => {
  assert.ok(loopbackHost('localhost:8081'))
  assert.ok(loopbackHost('127.0.0.1'))
  assert.equal(loopbackHost(undefined), false)
  assert.equal(loopbackHost('localhost:8081, evil.example'), false)
  assert.equal(loopbackHost('127.0.0.1.nip.io'), false)
  assert.equal(loopbackHost('localhost:99999999'), false)
})

test('cookies lose Secure only while trying it on this computer', async () => {
  await trying(false, () => {
    assert.match(cookieHeader('x.1.y'), /; Secure$/)
    assert.equal(secureAttr(), '; Secure')
  })
  await trying(true, () => {
    assert.doesNotMatch(cookieHeader('x.1.y'), /Secure/)
    assert.doesNotMatch(cookieHeader(null), /Secure/)
    assert.equal(secureAttr(), '')
  })
  // Development, as before: the file pass without, the binding with.
  const node = process.env.NODE_ENV
  process.env.NODE_ENV = 'development'
  try {
    assert.doesNotMatch(cookieHeader('x.1.y'), /Secure/)
    assert.equal(secureAttr(), '; Secure')
  } finally {
    process.env.NODE_ENV = node
  }
})
