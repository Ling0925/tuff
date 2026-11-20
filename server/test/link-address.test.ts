import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { app } from '../src/http/routes.js'
import { closeRealtime } from '../src/realtime.js'
import { addPerson, bearerFor, closeDb, makeOwner, makeProject } from './helpers.js'

/* A link's address in Docs, changed — `docs/specs/docs.md`, "A link's address". */
after(async () => {
  await closeRealtime()
  await closeDb()
})

async function call(path: string, token: string, method = 'GET', body?: unknown) {
  const r = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, unknown> }
}

test('a link’s address is changed by whoever may edit it, to http or https only, and only a link’s', async () => {
  const { ctx, workspaceId, token: owner } = await makeOwner()
  const p = await makeProject(ctx, workspaceId, 'Acme')
  const writer = await addPerson(ctx, workspaceId, 'member', [p])
  const bare = await addPerson(ctx, workspaceId, 'member', [p], [])
  const off = await addPerson(ctx, workspaceId, 'member', [])
  const stranger = await makeOwner()
  const as = {
    writer: await bearerFor(writer.actorId, workspaceId),
    bare: await bearerFor(bare.actorId, workspaceId),
    off: await bearerFor(off.actorId, workspaceId),
  }
  const made = await call(`/api/projects/${p}/files`, as.writer, 'POST', { name: 'Brief', url: 'https://example.com/old' })
  assert.equal(made.status, 201, JSON.stringify(made.body))
  const id = made.body.id as string
  const address = async () => ((await call(`/api/files/${id}`, owner)).body.file as { url: string | null }).url

  // Its author.
  const moved = await call(`/api/files/${id}`, as.writer, 'PATCH', { url: 'https://example.com/new' })
  assert.equal(moved.status, 200, JSON.stringify(moved.body))
  assert.equal(await address(), 'https://example.com/new')
  // Never to an address somebody else would be sent somewhere else by.
  assert.equal((await call(`/api/files/${id}`, as.writer, 'PATCH', { url: 'javascript:alert(1)' })).status, 400)
  assert.equal((await call(`/api/files/${id}`, as.writer, 'PATCH', { url: 'file:///etc/passwd' })).status, 400)
  // Nor taken away: a link with no address is not one.
  assert.equal((await call(`/api/files/${id}`, as.writer, 'PATCH', { url: null })).status, 400)
  assert.equal(await address(), 'https://example.com/new')

  // Another member, as far as the workspace lets members edit each other's documents.
  assert.equal((await call(`/api/files/${id}`, as.bare, 'PATCH', { url: 'https://example.com/theirs' })).status, 200)
  assert.equal((await call('/api/workspace', owner, 'PATCH', { edit_others_content: 'own_only' })).status, 200)
  // Not by somebody who may not edit somebody else's, off the project, or elsewhere.
  assert.equal((await call(`/api/files/${id}`, as.bare, 'PATCH', { url: 'https://evil.example/' })).status, 403)
  assert.equal((await call(`/api/files/${id}`, as.off, 'PATCH', { url: 'https://evil.example/' })).status, 404)
  assert.equal((await call(`/api/files/${id}`, stranger.token, 'PATCH', { url: 'https://evil.example/' })).status, 404)
  assert.equal(await address(), 'https://example.com/theirs')

  // The feed says it was changed.
  const feed = (await call(`/api/activity?object=${id}`, owner)).body.events as { action: string; meta: Record<string, unknown> }[]
  assert.ok(
    feed.some((e) => e.action === 'file.update' && e.meta.relinked === true),
    JSON.stringify(feed),
  )

  // A document does not become a link.
  const written = await call(`/api/projects/${p}/files`, as.writer, 'POST', {
    name: 'Notes',
    body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hi' }] }] },
  })
  assert.equal((await call(`/api/files/${written.body.id as string}`, as.writer, 'PATCH', { url: 'https://example.com/' })).status, 400)
  assert.equal(((await call(`/api/files/${written.body.id as string}`, owner)).body.file as { url: string | null }).url, null)
})
