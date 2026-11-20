import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { Hono } from 'hono'
import { app } from '../src/http/routes.js'
import { outbox } from '../src/mail.js'
import { env } from '../src/env.js'
import { edition } from '../src/edition.js'
import { registerUser } from '../src/auth/flows.js'
import { linkOrigin, needSiteUrl, NoSiteUrl, origin } from '../src/publicUrl.js'
import { closeDb, stamp } from './helpers.js'

after(async () => {
  await closeDb()
})

/*
 * Links are made from `APP_URL`, never from the request, in production,
 * the seventh audit. A reset asked
 * for with `Host: attacker.example` mailed the genuine token to the
 * attacker's site when `APP_URL` was empty.
 */

/* As production would, for the length of one block: `origin` asks at each call. */
async function asProduction<T>(work: () => Promise<T>, appUrl = ''): Promise<T> {
  const was = { node: process.env.NODE_ENV, appUrl: env.appUrl }
  process.env.NODE_ENV = 'production'
  env.appUrl = appUrl
  try {
    return await work()
  } finally {
    process.env.NODE_ENV = was.node
    env.appUrl = was.appUrl
  }
}

const hostile = { host: 'attacker.example', 'x-forwarded-proto': 'https', 'x-forwarded-host': 'attacker.example' }

test('in production a link reads APP_URL, or the service’s own address, and never the request', () => {
  const request = () => 'https://attacker.example'
  assert.equal(linkOrigin({ appUrl: 'https://tuff.example.com', vendorSite: null, live: true, request }), 'https://tuff.example.com')
  assert.equal(linkOrigin({ appUrl: '', vendorSite: 'https://usetuff.com', live: true, request }), 'https://usetuff.com')
  // Never reached in production — the server would not have started — and never the request either.
  assert.equal(linkOrigin({ appUrl: '', vendorSite: null, live: true, request }), '')
  // A laptop without APP_URL: the host it was asked at.
  assert.equal(linkOrigin({ appUrl: '', vendorSite: null, live: false, request: () => 'http://localhost:8787' }), 'http://localhost:8787')
  assert.equal(linkOrigin({ appUrl: 'https://tuff.example.com', vendorSite: null, live: false, request }), 'https://tuff.example.com')
})

test('a production server with no address of its own refuses to start', () => {
  assert.throws(() => needSiteUrl({ appUrl: '', vendorSite: null, live: true }), NoSiteUrl)
  // Your own server with APP_URL, as scripts/setup.sh writes it; the service, which names its own.
  needSiteUrl({ appUrl: 'https://tuff.example.com', vendorSite: null, live: true })
  needSiteUrl({ appUrl: '', vendorSite: 'https://usetuff.com', live: true })
  // Development may go without.
  needSiteUrl({ appUrl: '', vendorSite: null, live: false })
})

test('the request’s Host, Forwarded-Host and Forwarded-Proto move no link in production', async () => {
  const probe = new Hono().get('/o', (c) => c.text(origin(c)))
  const said = await asProduction(
    async () => (await probe.request('http://attacker.example/o', { headers: hostile })).text(),
    'https://tuff.example.com',
  )
  assert.equal(said, 'https://tuff.example.com')
  const vendor = edition.vendor?.site ?? null
  if (vendor) {
    const fallback = await asProduction(async () => (await probe.request('http://attacker.example/o', { headers: hostile })).text())
    assert.equal(fallback, vendor)
  }
  // The OAuth metadata reads the same function: its copy took any X-Forwarded-Proto.
  const meta = await asProduction(async () => {
    const r = await app.request('http://attacker.example/.well-known/oauth-protected-resource', {
      headers: { ...hostile, 'x-forwarded-proto': 'javascript' },
    })
    return (await r.json()) as { resource: string; authorization_servers: string[] }
  }, 'https://tuff.example.com')
  assert.equal(meta.resource, 'https://tuff.example.com/mcp')
  assert.deepEqual(meta.authorization_servers, ['https://tuff.example.com'])
})

test('a reset asked for with somebody else’s Host mails a link to this server', async () => {
  const email = `host${stamp()}@example.com`
  await registerUser({ email, password: 'correct-horse-battery-staple', name: 'Vic', workspace_name: `V ${stamp().slice(0, 6)}` })
  const asked = await asProduction(
    async () =>
      app.request('http://attacker.example/auth/password/forgot', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...hostile },
        body: JSON.stringify({ email }),
      }),
    'https://tuff.example.com',
  )
  assert.equal(asked.status, 200)
  const letter = outbox.filter((m) => m.to === email).at(-1)
  assert.ok(letter, 'a letter was sent')
  const links = letter.text.match(/https?:\/\/[^\s)\]]+/g) ?? []
  assert.ok(
    links.some((l) => l.startsWith('https://tuff.example.com/reset/')),
    links.join(' '),
  )
  assert.equal(
    links.some((l) => l.includes('attacker.example')),
    false,
  )
})
