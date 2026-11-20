import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serve } from '@hono/node-server'
import { addCookies } from '../src/http/afterward.js'

/*
 * Through the real adapter, not `app.request`: the cookie was lost only
 * where `@hono/node-server` had swapped the global `Response`, and the app's
 * `cors` — outside, adding `Vary` after the answer — is what dropped it.
 * A GET with no `Origin` is what a browser sends to its own site.
 */
test('a cookie added after the answer reaches a GET with no Origin, behind cors', async () => {
  const app = new Hono()
  app.use('*', cors({ origin: (o) => o ?? '*', credentials: false }))
  app.use('/appended/*', async (c, next) => {
    await next()
    c.res.headers.append('set-cookie', 'a=1; Path=/')
  })
  app.use('/added/*', async (c, next) => {
    await next()
    addCookies(c, ['a=1; Path=/api/blob', 'a=1; Path=/api/preview/image'])
  })
  app.get('/appended/me', (c) => c.json({ ok: true }))
  app.get('/added/me', (c) => c.json({ ok: true }))
  app.post('/added/me', (c) => c.json({ made: true }, 201))

  const server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' })
  await new Promise((done) => server.once('listening', done))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  try {
    /* The fault, kept in view: if this ever passes, the adapter changed and
       the workaround may go. */
    const appended = await fetch(`${base}/appended/me`)
    assert.equal(appended.headers.getSetCookie().length, 0)

    const added = await fetch(`${base}/added/me`)
    assert.equal(added.status, 200)
    assert.deepEqual(added.headers.getSetCookie(), ['a=1; Path=/api/blob', 'a=1; Path=/api/preview/image'])
    assert.equal(added.headers.get('vary'), 'Origin')
    assert.deepEqual(await added.json(), { ok: true })

    const withOrigin = await fetch(`${base}/added/me`, { method: 'POST', headers: { origin: base } })
    assert.equal(withOrigin.status, 201)
    assert.equal(withOrigin.headers.getSetCookie().length, 2)
    assert.deepEqual(await withOrigin.json(), { made: true })
  } finally {
    server.close()
  }
})
