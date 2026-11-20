import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { closeDb, withActor, makeOwner, addPerson, makeProject, bearerFor } from './helpers.js'
import { app } from '../src/http/routes.js'
import { closeRealtime } from '../src/realtime.js'

/* A document anybody can read, by its link. */
after(async () => {
  await closeRealtime()
  await closeDb()
})

const as = (token: string) => (method: string, path: string, body?: unknown) =>
  app.request(path, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
const doc = (t: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] })

test('a document shared to the web is read by its link alone, and stops when it is turned off', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const p = await makeProject(ctx, workspaceId, 'Acme')
  const me = as(token)
  const made = await me('POST', `/api/projects/${p}/files`, { name: 'Brief', body: doc('The brief, for the client.') })
  const { id } = (await made.json()) as { id: string }

  const on = await me('PUT', `/api/files/${id}/public`, { public: true })
  assert.equal(on.status, 200)
  const { token: link } = (await on.json()) as { token: string }
  assert.match(link, /^[A-Za-z0-9_-]{24}$/)
  // Asked again, the same link: on is not a new token every press.
  assert.equal(((await (await me('PUT', `/api/files/${id}/public`, { public: true })).json()) as { token: string }).token, link)

  // No session at all.
  const read = await app.request(`/api/public/docs/${link}`)
  assert.equal(read.status, 200)
  assert.equal(read.headers.get('x-robots-tag'), 'noindex')
  const page = (await read.json()) as { name: string; body: unknown }
  assert.equal(page.name, 'Brief')
  assert.match(JSON.stringify(page.body), /The brief, for the client/)
  // Nothing about who or where.
  assert.ok(!('workspace' in page) && !('author' in page))

  // Off: the old link is dead, and a new one is a new token.
  await me('PUT', `/api/files/${id}/public`, { public: false })
  assert.equal((await app.request(`/api/public/docs/${link}`)).status, 404)
  const again = ((await (await me('PUT', `/api/files/${id}/public`, { public: true })).json()) as { token: string }).token
  assert.notEqual(again, link)

  // In the bin, it stops at once.
  await withActor(ctx.actorId, (tx) => tx`update file set deleted_at = now() where id = ${id}`)
  assert.equal((await app.request(`/api/public/docs/${again}`)).status, 404)
  // And a token nobody made reads the same as one turned off.
  assert.equal((await app.request('/api/public/docs/aaaaaaaaaaaaaaaaaaaaaaaa')).status, 404)
})

test('only whoever may edit a written document shares it', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const p = await makeProject(ctx, workspaceId, 'Acme')
  /* A member who may not edit somebody else's documents may not put them on
     the web either. */
  const me = as(token)
  assert.equal((await me('PATCH', '/api/workspace', { edit_others_content: 'own_only' })).status, 200)
  const sam = await addPerson(ctx, workspaceId, 'member', [p])
  const theirs = as(await bearerFor(sam.actorId, workspaceId))
  const { id } = (await (await me('POST', `/api/projects/${p}/files`, { name: 'Notes', body: doc('x') })).json()) as { id: string }
  assert.equal((await theirs('PUT', `/api/files/${id}/public`, { public: true })).status, 403)
  // A link is not a written document.
  const { id: link } = (await (await me('POST', `/api/projects/${p}/files`, { name: 'Site', url: 'https://example.com' })).json()) as {
    id: string
  }
  assert.equal((await me('PUT', `/api/files/${link}/public`, { public: true })).status, 409)
})
