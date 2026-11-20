import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { app } from '../src/http/routes.js'
import { addManager, addPerson, bearerFor, closeDb, makeOwner, makeProject } from './helpers.js'

after(closeDb)

/*
 * Who may take away an announcement.
 * Its author, the owner and whoever runs the project; not every
 * member the workspace's edit switch lets touch others' documents, which is
 * on by default. Found by the independent review of 15 November 2026.
 */
const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })

async function call(path: string, token: string, method = 'GET', body?: unknown) {
  const r = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, any> }
}

test('an announcement is taken away by its author, the owner or whoever runs the project — not by any member', async () => {
  const { ctx, workspaceId, token: owner } = await makeOwner()
  const p = await makeProject(ctx, workspaceId, 'Acme')
  const writer = await addPerson(ctx, workspaceId, 'member', [p])
  const reader = await addPerson(ctx, workspaceId, 'member', [p])
  const runner = await addManager(ctx, workspaceId, [p])
  const stranger = await addPerson(ctx, workspaceId, 'member', [])
  const as = {
    writer: await bearerFor(writer.actorId, workspaceId),
    reader: await bearerFor(reader.actorId, workspaceId),
    runner: await bearerFor(runner.actorId, workspaceId),
    stranger: await bearerFor(stranger.actorId, workspaceId),
  }
  const post = async () => {
    const r = await call(`/api/projects/${p}/posts`, as.writer, 'POST', { title: `Week ${Date.now()}`, body: doc('Notes') })
    assert.equal(r.status, 201)
    return (r.body.post?.id ?? r.body.id) as string
  }

  /* A plain member, with the default switch that lets them edit others'
     documents: still not this. And somebody off the project is not told
     the announcement is there. */
  const one = await post()
  assert.equal((await call(`/api/posts/${one}`, as.reader, 'DELETE')).status, 403)
  assert.equal((await call(`/api/posts/${one}`, as.stranger, 'DELETE')).status, 404)

  assert.equal((await call(`/api/posts/${one}`, as.runner, 'DELETE')).status, 200)
  assert.equal((await call(`/api/posts/${one}`, as.writer)).status, 404, 'gone for its author too')

  assert.equal((await call(`/api/posts/${await post()}`, owner, 'DELETE')).status, 200)
  assert.equal((await call(`/api/posts/${await post()}`, as.writer, 'DELETE')).status, 200)
})
