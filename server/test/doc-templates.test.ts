import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { closeDb, makeOwner, addPerson, makeProject, bearerFor } from './helpers.js'
import { app } from '../src/http/routes.js'
import { closeRealtime } from '../src/realtime.js'

/* A document started from a template, and a document saved as one. */
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
type Read = { file: { name: string; body: unknown; template_at: string | null } }

test('a built-in template makes a document with its name and shape, filled in', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const p = await makeProject(ctx, workspaceId, 'Acme Rebrand')
  const me = as(token)
  const made = await me('POST', `/api/projects/${p}/files`, { template: 'report' })
  assert.equal(made.status, 201)
  const { id } = (await made.json()) as { id: string }
  const { file } = (await (await me('GET', `/api/files/${id}`)).json()) as Read
  assert.match(file.name, /^Client report \d{1,2} [A-Z][a-z]+ \d{4}$/)
  const text = JSON.stringify(file.body)
  assert.match(text, /Acme Rebrand · \d{1,2} [A-Z][a-z]+ \d{4}/)
  assert.doesNotMatch(text, /\{date\}|\{project\}/)
  assert.match(text, /"type":"callout"/)
  assert.equal(file.template_at, null)

  /* A name given wins, and a body sent beside it is written after it. */
  const named = (await (
    await me('POST', `/api/projects/${p}/files`, { template: 'brief', name: 'Kick-off', body: doc('Our own line.') })
  ).json()) as { id: string }
  const read = (await (await me('GET', `/api/files/${named.id}`)).json()) as Read
  assert.equal(read.file.name, 'Kick-off')
  const blocks = (read.file.body as { content: { type: string }[] }).content
  assert.equal(blocks[0]?.type, 'callout')
  assert.match(JSON.stringify(blocks.at(-1)), /Our own line/)

  /* Nothing, or a template nobody wrote, is refused. */
  assert.equal((await me('POST', `/api/projects/${p}/files`, {})).status, 400)
  assert.equal((await me('POST', `/api/projects/${p}/files`, { template: 'memo' })).status, 400)
  assert.equal((await me('POST', `/api/projects/${p}/files`, { template: crypto.randomUUID() })).status, 404)
})

test('a document saved as a template is offered across the workspace to whoever can read it', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const a = await makeProject(ctx, workspaceId, 'Studio')
  const b = await makeProject(ctx, workspaceId, 'Board only')
  const me = as(token)
  const sam = await addPerson(ctx, workspaceId, 'member', [a])
  const theirs = as(await bearerFor(sam.actorId, workspaceId))

  const write = async (project: string, name: string, words: string) =>
    ((await (await me('POST', `/api/projects/${project}/files`, { name, body: doc(words) })).json()) as { id: string }).id
  const open = await write(a, 'Weekly {project}', 'Week of {date}.')
  const hidden = await write(b, 'Board pack', 'Only for the board.')

  const on = await me('PUT', `/api/files/${open}/template`, { template: true })
  assert.equal(on.status, 200)
  const { template_at } = (await on.json()) as { template_at: string | null }
  assert.ok(template_at)
  assert.equal((await me('PUT', `/api/files/${hidden}/template`, { template: true })).status, 200)
  // Saved again, nothing changes.
  assert.equal(
    ((await (await me('PUT', `/api/files/${open}/template`, { template: true })).json()) as { template_at: string }).template_at,
    template_at,
  )

  /* The owner sees both; Sam, who is not on the board's project, one. */
  const listed = async (who: typeof me) =>
    ((await (await who('GET', '/api/doc-templates')).json()) as { templates: { id: string; project_name: string }[] }).templates
  assert.deepEqual((await listed(me)).map((t) => t.id).sort(), [open, hidden].sort())
  const forSam = await listed(theirs)
  assert.deepEqual(
    forSam.map((t) => t.id),
    [open],
  )
  assert.equal(forSam[0]?.project_name, 'Studio')

  /* Made from: a copy of its words, filled in, and not itself a template. */
  const made = await theirs('POST', `/api/projects/${a}/files`, { template: open })
  assert.equal(made.status, 201)
  const { id } = (await made.json()) as { id: string }
  const { file } = (await (await theirs('GET', `/api/files/${id}`)).json()) as Read
  assert.equal(file.name, 'Weekly Studio')
  assert.doesNotMatch(JSON.stringify(file.body), /\{date\}/)
  assert.equal(file.template_at, null)
  /* One Sam cannot read is one Sam cannot start from: not found, as if none. */
  assert.equal((await theirs('POST', `/api/projects/${a}/files`, { template: hidden })).status, 404)

  /* Taken back, it is offered no more. */
  assert.equal((await me('PUT', `/api/files/${open}/template`, { template: false })).status, 200)
  assert.deepEqual(
    (await listed(theirs)).map((t) => t.id),
    [],
  )
  assert.equal((await theirs('POST', `/api/projects/${a}/files`, { template: open })).status, 404)
})

test('only whoever may edit a written document saves it as a template', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const p = await makeProject(ctx, workspaceId, 'Acme')
  const me = as(token)
  assert.equal((await me('PATCH', '/api/workspace', { edit_others_content: 'own_only' })).status, 200)
  const sam = await addPerson(ctx, workspaceId, 'member', [p])
  const theirs = as(await bearerFor(sam.actorId, workspaceId))
  const { id } = (await (await me('POST', `/api/projects/${p}/files`, { name: 'Notes', body: doc('x') })).json()) as { id: string }
  assert.equal((await theirs('PUT', `/api/files/${id}/template`, { template: true })).status, 403)
  // Their own, they may.
  const { id: mine } = (await (await theirs('POST', `/api/projects/${p}/files`, { name: 'Mine', body: doc('y') })).json()) as {
    id: string
  }
  assert.equal((await theirs('PUT', `/api/files/${mine}/template`, { template: true })).status, 200)
  // A link has no words to start from.
  const { id: link } = (await (await me('POST', `/api/projects/${p}/files`, { name: 'Site', url: 'https://example.com' })).json()) as {
    id: string
  }
  assert.equal((await me('PUT', `/api/files/${link}/template`, { template: true })).status, 409)
  // And a file in another workspace is not found.
  const other = await makeOwner()
  assert.equal((await as(other.token)('PUT', `/api/files/${id}/template`, { template: true })).status, 404)
  assert.equal((await me('PUT', `/api/files/${id}/template`, { template: 'yes' })).status, 400)
})
