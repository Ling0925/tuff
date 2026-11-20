import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { app } from '../src/http/routes.js'
import { closeDb, makeOwner, makeProject } from './helpers.js'

after(closeDb)

/*
 * A change of an announcement's title alone leaves its words. `Body.partial()`
 * let zod fill `body: {}` from the default, so PATCH { title } emptied the
 * post — MCP's update_post with only a title did exactly that. Found by the
 * agent on 14 November 2026.
 */
const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })

async function call(path: string, token: string, init: { method?: string; body?: unknown } = {}) {
  const r = await app.request(path, {
    method: init.method ?? 'GET',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  })
  return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, any> }
}

test('a change of title alone keeps the announcement’s words, and its category', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const p = await makeProject(ctx, workspaceId, 'Acme')
  const made = await call(`/api/projects/${p}/posts`, token, {
    method: 'POST',
    body: { title: 'Week 1', body: doc('Design review done'), category: 'update' },
  })
  assert.equal(made.status, 201)
  const id = (made.body.post?.id ?? made.body.id) as string

  assert.equal((await call(`/api/posts/${id}`, token, { method: 'PATCH', body: { title: 'Week 1, again' } })).status, 200)
  const post = (await call(`/api/posts/${id}`, token)).body.post
  assert.equal(post.title, 'Week 1, again')
  assert.equal(post.body.content?.length, 1, 'the words are still there')
  assert.equal(post.category, 'update')

  /* And a body sent is still a body taken. */
  assert.equal((await call(`/api/posts/${id}`, token, { method: 'PATCH', body: { body: doc('New words') } })).status, 200)
  const again = (await call(`/api/posts/${id}`, token)).body.post
  assert.equal(again.body.content?.[0]?.content?.[0]?.text, 'New words')
})
