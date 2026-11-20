import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { app } from '../src/http/routes.js'
import { closeDb, makeOwner, makeProject } from './helpers.js'

after(async () => {
  await closeDb()
})

async function call(method: string, path: string, token: string, body?: unknown) {
  const r = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return { status: r.status, body: (await r.json()) as Record<string, unknown> }
}

/*
 * A label is renamed and recoloured from a project's settings, and a name
 * another label has is refused rather than merged.
 */
test('a label is renamed, recoloured, given its own colour back, and refused a taken name', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const project = await makeProject(ctx, workspaceId, 'Words')
  const stamp = Date.now()
  const a = await call('POST', `/api/projects/${project}/labels`, token, { name: `Bug ${stamp}`, color: 'red' })
  const b = await call('POST', `/api/projects/${project}/labels`, token, { name: `Feature ${stamp}` })
  assert.equal(a.status, 201)
  const id = a.body.id as string

  const renamed = await call('PATCH', `/api/labels/${id}`, token, { name: `Defect ${stamp}` })
  assert.equal(renamed.status, 200)
  assert.equal(renamed.body.name, `Defect ${stamp}`)
  assert.equal(renamed.body.color, 'red', 'a rename leaves the colour')

  const green = await call('PATCH', `/api/labels/${id}`, token, { color: 'green' })
  assert.equal(green.body.color, 'green')
  assert.equal(green.body.name, `Defect ${stamp}`, 'a colour leaves the name')

  const own = await call('PATCH', `/api/labels/${id}`, token, { color: null })
  assert.equal(own.body.color, null)

  const clash = await call('PATCH', `/api/labels/${id}`, token, { name: b.body.name })
  assert.equal(clash.status, 409)
  assert.equal((clash.body.error as { code: string }).code, 'taken')

  const nothing = await call('PATCH', `/api/labels/${id}`, token, {})
  assert.equal(nothing.status, 400)
  const notAColour = await call('PATCH', `/api/labels/${id}`, token, { color: '#ff0000' })
  assert.equal(notAColour.status, 400)

  const listed = await call('GET', `/api/projects/${project}/labels`, token)
  const row = (listed.body.labels as { id: string; name: string; color: string | null }[]).find((l) => l.id === id)
  assert.deepEqual([row?.name, row?.color], [`Defect ${stamp}`, null])
})
