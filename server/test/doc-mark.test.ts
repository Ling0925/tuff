import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { closeDb, makeOwner, addPerson, makeProject, bearerFor } from './helpers.js'
import { app } from '../src/http/routes.js'
import { closeRealtime } from '../src/realtime.js'

/* A document's colour and icon, and a pinned document's first lines —
   `docs/specs/docs.md`, "A document's mark" and "A pinned document is a
   page". */
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

type Row = {
  id: string
  author_id: string
  mark_icon: string | null
  mark_tint: number | null
  preview?: { lines: { h: number; t: string }[]; picture: string | null }
}

test('a document wears the colour and icon its editor chose, and only a written document does', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const p = await makeProject(ctx, workspaceId, 'Marks')
  const me = as(token)
  const { id } = (await (await me('POST', `/api/projects/${p}/files`, { name: 'Brief', body: { type: 'doc', content: [] } })).json()) as {
    id: string
  }

  const set = await me('PATCH', `/api/files/${id}`, { mark_icon: 'rocket', mark_tint: 3 })
  assert.equal(set.status, 200)
  const read = (await (await me('GET', `/api/files/${id}`)).json()) as { file: Row }
  assert.equal(read.file.mark_icon, 'rocket')
  assert.equal(read.file.mark_tint, 3)

  /* One half changed leaves the other; the list and search carry both. */
  assert.equal((await me('PATCH', `/api/files/${id}`, { mark_tint: 5 })).status, 200)
  const { files } = (await (await me('GET', `/api/projects/${p}/files`)).json()) as { files: Row[] }
  const row = files.find((f) => f.id === id)!
  assert.equal(row.mark_icon, 'rocket')
  assert.equal(row.mark_tint, 5)
  const { results } = (await (await me('GET', '/api/search?q=Brief&type=file')).json()) as { results: Row[] }
  assert.equal(results.find((r) => r.id === id)?.mark_icon, 'rocket')

  /* Null puts back a document's own look. */
  assert.equal((await me('PATCH', `/api/files/${id}`, { mark_icon: null, mark_tint: null })).status, 200)
  const back = (await (await me('GET', `/api/files/${id}`)).json()) as { file: Row }
  assert.equal(back.file.mark_icon, null)
  assert.equal(back.file.mark_tint, null)

  /* A glyph nobody offers, a tint past the ten: refused. */
  assert.equal((await me('PATCH', `/api/files/${id}`, { mark_icon: 'skull' })).status, 400)
  assert.equal((await me('PATCH', `/api/files/${id}`, { mark_tint: 10 })).status, 400)

  /* A link has its place's icon, not one chosen. */
  const link = (await (await me('POST', `/api/projects/${p}/files`, { name: 'Site', url: 'https://example.com' })).json()) as { id: string }
  const refused = await me('PATCH', `/api/files/${link.id}`, { mark_tint: 1 })
  assert.equal(refused.status, 409)
  assert.equal(((await refused.json()) as { error: { code: string } }).error.code, 'not_document')
})

test('somebody who may not edit a document may not change what it wears', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const p = await makeProject(ctx, workspaceId, 'Others')
  const me = as(token)
  const { id } = (await (await me('POST', `/api/projects/${p}/files`, { name: 'Mine', body: { type: 'doc', content: [] } })).json()) as {
    id: string
  }
  const sam = await addPerson(ctx, workspaceId, 'member', [p])
  const theirs = as(await bearerFor(sam.actorId, workspaceId))
  /* Behind the switch that lets members edit each other's documents, as the name is. */
  assert.equal((await me('PATCH', '/api/workspace', { edit_others_content: 'own_only' })).status, 200)
  const said = await theirs('PATCH', `/api/files/${id}`, { mark_icon: 'star' })
  assert.equal(said.status, 403)
  const read = (await (await me('GET', `/api/files/${id}`)).json()) as { file: Row }
  assert.equal(read.file.mark_icon, null)

  /* And one outside the project is told nothing is there. */
  const other = await makeProject(ctx, workspaceId, 'Elsewhere')
  const kim = await addPerson(ctx, workspaceId, 'member', [other])
  assert.equal((await as(await bearerFor(kim.actorId, workspaceId))('PATCH', `/api/files/${id}`, { mark_icon: 'star' })).status, 404)
})

test('a pinned document carries its first lines, bounded, and an unpinned one does not', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const p = await makeProject(ctx, workspaceId, 'Pins')
  const me = as(token)
  const long = 'word '.repeat(400)
  const picture = '0190f0f0-0000-7000-8000-000000000001'
  const body = {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Launch plan' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'What we ship, and when.' }] },
      { type: 'attachment', attrs: { fileId: picture, kind: 'image', name: 'hero.png' } },
      ...Array.from({ length: 12 }, () => ({ type: 'paragraph', content: [{ type: 'text', text: long }] })),
    ],
  }
  const { id } = (await (await me('POST', `/api/projects/${p}/files`, { name: 'Plan', body })).json()) as { id: string }
  const listed = async () =>
    ((await (await me('GET', `/api/projects/${p}/files`)).json()) as { files: Row[] }).files.find((f) => f.id === id)!

  assert.equal((await listed()).preview, undefined)
  assert.equal((await me('PUT', `/api/files/${id}/pin`, { pinned: true })).status, 200)
  const preview = (await listed()).preview!
  assert.deepEqual(preview.lines[0], { h: 1, t: 'Launch plan' })
  assert.deepEqual(preview.lines[1], { h: 0, t: 'What we ship, and when.' })
  assert.equal(preview.picture, picture)
  assert.ok(preview.lines.length <= 6)
  assert.ok(preview.lines.reduce((n, l) => n + l.t.length, 0) <= 600)

  /* Pinned and let go, it is where it was in Recent: a pin keeps the clock. */
  const clock = (await (await me('GET', `/api/files/${id}`)).json()) as { file: { updated_at: string } }
  assert.equal((await me('PUT', `/api/files/${id}/pin`, { pinned: false })).status, 200)
  assert.equal((await me('PUT', `/api/files/${id}/pin`, { pinned: true })).status, 200)
  assert.equal((await me('PUT', `/api/files/${id}/pin`, { pinned: false })).status, 200)
  const after = (await (await me('GET', `/api/files/${id}`)).json()) as { file: { updated_at: string; pinned_at: string | null } }
  assert.equal(after.file.pinned_at, null)
  assert.equal(after.file.updated_at, clock.file.updated_at)
})
