import { test, after } from 'node:test'
import type postgres from 'postgres'
import assert from 'node:assert/strict'
import type { WSContext } from 'hono/ws'
import { app } from '../src/http/routes.js'
import { authenticate } from '../src/auth/context.js'
import { closeRealtime, subscribe } from '../src/realtime.js'
import { join, leave } from '../src/coedit.js'
import { addManager, addPerson, asTableOwner, bearerFor, closeDb, makeOwner, makeProject, uuidv7, withActor } from './helpers.js'

/*
 * A written document starts as its author's and is published to the project
 * or to chosen people. Every way a
 * file reaches somebody, asked as somebody who was not given it.
 */

after(async () => {
  await closeRealtime()
  await closeDb()
})

type Res = { status: number; body: Record<string, unknown> }
async function call(token: string, method: string, path: string, body?: unknown): Promise<Res> {
  const r = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, unknown> }
}
const para = (...parts: unknown[]) => ({ type: 'doc', content: [{ type: 'paragraph', content: parts }] })
const text = (t: string) => ({ type: 'text', text: t })
const mention = (id: string) => ({ type: 'mention', attrs: { id, label: 'x' } })
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** A workspace: Ann writes, Ben and Cara are on the project, Dev is not; the owner runs everything. */
async function studio() {
  const owner = await makeOwner()
  const project = await makeProject(owner.ctx, owner.workspaceId, 'Studio')
  const ann = await addPerson(owner.ctx, owner.workspaceId, 'member', [project])
  const ben = await addPerson(owner.ctx, owner.workspaceId, 'member', [project])
  const cara = await addPerson(owner.ctx, owner.workspaceId, 'member', [project])
  const dev = await addPerson(owner.ctx, owner.workspaceId, 'member', [])
  const t = {
    owner: owner.token,
    ann: await bearerFor(ann.actorId, owner.workspaceId),
    ben: await bearerFor(ben.actorId, owner.workspaceId),
    cara: await bearerFor(cara.actorId, owner.workspaceId),
    dev: await bearerFor(dev.actorId, owner.workspaceId),
  }
  /* An agent on the project, reading through its own token. */
  const agent = await call(owner.token, 'POST', '/api/agents', { name: 'Scout', project_ids: [project], reach: 'mcp' })
  assert.equal(agent.status, 201, JSON.stringify(agent.body))
  return {
    owner,
    project,
    ann,
    ben,
    cara,
    dev,
    t,
    agentId: agent.body.agent_id as string,
    agentToken: agent.body.token as string,
  }
}

async function draft(token: string, project: string, word: string): Promise<string> {
  const made = await call(token, 'POST', `/api/projects/${project}/files`, {
    name: `Plan ${word}`,
    body: para(text(`notes about ${word}`)),
    audience: 'author',
  })
  assert.equal(made.status, 201, JSON.stringify(made.body))
  return made.body.id as string
}

const listed = async (token: string, project: string, id: string) => {
  const r = await call(token, 'GET', `/api/projects/${project}/files`)
  return ((r.body.files ?? []) as { id: string; audience?: string }[]).find((f) => f.id === id)
}
const found = async (token: string, word: string, id: string) => {
  const r = await call(token, 'GET', `/api/search?q=${encodeURIComponent(word)}&type=file`)
  return ((r.body.results ?? []) as { id: string }[]).some((x) => x.id === id)
}
const inFeed = async (token: string, project: string, id: string) => {
  const r = await call(token, 'GET', `/api/activity?project=${project}`)
  return ((r.body.events ?? []) as { object_id: string; action: string }[]).filter((e) => e.object_id === id).map((e) => e.action)
}
const notes = async (actorId: string, id: string) =>
  (
    await asTableOwner()<{ reason: string }[]>`
      select reason::text from notification where actor_id = ${actorId} and object_id = ${id} order by created_at`
  ).map((r) => r.reason)
const deliveries = async (workspaceId: string, id: string) =>
  (
    await asTableOwner()<{ event: string }[]>`
      select event from webhook_delivery where workspace_id = ${workspaceId} and payload->>'object_id' = ${id} order by created_at`
  ).map((r) => r.event)

function socket() {
  const closed: { code?: number } = {}
  const ws = {
    send: () => {},
    close: (code: number) => {
      closed.code = code
    },
    readyState: 1,
  } as unknown as WSContext
  return { ws, closed }
}

test('a draft is its author’s alone: list, read, search, feed, follow, comment, mention, socket, webhook, public link', async () => {
  const w = await studio()
  /* A webhook for the workspace, which hears every event. */
  await asTableOwner()`
    insert into webhook (id, workspace_id, url, secret_enc, created_by)
    values (${uuidv7()}, ${w.owner.workspaceId}, 'https://example.com/hook', 'whs_x', ${w.owner.ctx.actorId})`
  const heard: { kind: string; id: unknown }[] = []
  const stop = await subscribe(`project:${w.project}`, (e) =>
    heard.push({ kind: e.kind, id: (e.payload as { object_id?: unknown }).object_id }),
  )
  try {
    const word = `zebra${uuidv7().slice(-6)}`
    const id = await draft(w.t.ann, w.project, word)
    assert.equal((await call(w.t.ann, 'PATCH', `/api/files/${id}`, { body: para(text(`more about ${word}`)) })).status, 200)
    /* Ann's own comment, naming Ben. */
    assert.equal(
      (await call(w.t.ann, 'POST', `/api/files/${id}/comments`, { body: para(text('look '), mention(w.ben.actorId)) })).status,
      201,
    )

    /* Ann sees it, as a draft. */
    assert.equal((await listed(w.t.ann, w.project, id))?.audience, 'author')
    const mine = await call(w.t.ann, 'GET', `/api/files/${id}`)
    assert.equal(mine.status, 200)
    assert.equal((mine.body.file as { audience: string; may_share: boolean }).audience, 'author')
    assert.equal((mine.body.file as { may_share: boolean }).may_share, true)
    assert.equal(await found(w.t.ann, word, id), true)
    assert.ok((await inFeed(w.t.ann, w.project, id)).includes('file.create'))

    /* Nobody else does — not the owner, not the agent. */
    for (const [who, token] of [
      ['ben', w.t.ben],
      ['owner', w.t.owner],
      ['agent', w.agentToken],
    ] as const) {
      assert.equal(await listed(token, w.project, id), undefined, `${who} lists it`)
      assert.equal((await call(token, 'GET', `/api/files/${id}`)).status, 404, `${who} reads it`)
      assert.equal((await call(token, 'GET', `/api/files/${id}/comments`)).status, 404, `${who} reads its comments`)
      assert.equal(await found(token, word, id), false, `${who} finds it`)
      assert.deepEqual(await inFeed(token, w.project, id), [], `${who} sees it in the feed`)
      assert.equal((await call(token, 'POST', `/api/files/${id}/subscription`)).status, 404, `${who} follows it`)
      assert.equal((await call(token, 'POST', `/api/files/${id}/comments`, { body: para(text('hi')) })).status, 404, `${who} comments`)
      assert.equal((await call(token, 'PATCH', `/api/files/${id}`, { name: 'Mine now' })).status, 404, `${who} renames it`)
    }
    /* Named in its comment, Ben is told nothing — not even that it exists. */
    assert.deepEqual(await notes(w.ben.actorId, id), [])
    /* The co-editing socket asks the same question. */
    const ctxBen = await authenticate(`Bearer ${w.t.ben}`)
    assert.ok(ctxBen)
    assert.equal(await join(ctxBen, id, socket().ws), null)
    /* Not on the web while it is a draft. */
    const pub = await call(w.t.ann, 'PUT', `/api/files/${id}/public`, { public: true })
    assert.equal(pub.status, 409)
    assert.equal((pub.body.error as { code: string }).code, 'not_published')
    /* Saved as a template, it is still nobody else's to start from. */
    assert.equal((await call(w.t.ann, 'PUT', `/api/files/${id}/template`, { template: true })).status, 200)
    const templates = (await call(w.t.ben, 'GET', '/api/doc-templates')).body.templates as { id: string }[]
    assert.equal(
      templates.some((x) => x.id === id),
      false,
    )
    assert.equal((await call(w.t.ben, 'POST', `/api/projects/${w.project}/files`, { template: id })).status, 404)

    await pause(300)
    assert.deepEqual(
      heard.filter((e) => e.id === id),
      [],
      'the project’s socket heard nothing of it',
    )
    assert.deepEqual(await deliveries(w.owner.workspaceId, id), [], 'no webhook was queued')

    /* Published to the project: everybody on it, the socket and the webhook. */
    const out = await call(w.t.ann, 'PUT', `/api/files/${id}/audience`, { audience: 'project' })
    assert.equal(out.status, 200, JSON.stringify(out.body))
    assert.equal(out.body.audience, 'project')
    assert.equal((await call(w.t.ben, 'GET', `/api/files/${id}`)).status, 200)
    assert.equal(await found(w.t.cara, word, id), true)
    assert.ok((await inFeed(w.t.ben, w.project, id)).includes('file.publish'))
    assert.deepEqual(await deliveries(w.owner.workspaceId, id), ['file.publish'])
    await pause(300)
    assert.deepEqual(
      heard.filter((e) => e.id === id).map((e) => e.kind),
      ['file.publish'],
    )
    /* And now it may go on the web. */
    assert.equal((await call(w.t.ann, 'PUT', `/api/files/${id}/public`, { public: true })).status, 200)
    /* Dev, on no project, still reads nothing. */
    assert.equal((await call(w.t.dev, 'GET', `/api/files/${id}`)).status, 404)
  } finally {
    await stop()
  }
})

test('chosen people see it, nobody else does; taking somebody off ends it, the open socket included', async () => {
  const w = await studio()
  const word = `quokka${uuidv7().slice(-6)}`
  const id = await draft(w.t.ann, w.project, word)
  /* Ben has it open the moment it is shared with him. */
  const out = await call(w.t.ann, 'PUT', `/api/files/${id}/audience`, { audience: 'chosen', reader_ids: [w.ben.actorId] })
  assert.equal(out.status, 200, JSON.stringify(out.body))
  assert.deepEqual(out.body.reader_ids, [w.ben.actorId])

  /* Ben: everywhere. */
  assert.equal((await listed(w.t.ben, w.project, id))?.audience, 'chosen')
  const read = await call(w.t.ben, 'GET', `/api/files/${id}`)
  assert.equal(read.status, 200)
  assert.deepEqual((read.body.file as { reader_ids: string[] }).reader_ids, [w.ben.actorId])
  assert.equal(await found(w.t.ben, word, id), true)
  /* A line written while it is kept is read by its people while it stays
     kept: Ben, chosen, reads that it was published. */
  assert.ok((await inFeed(w.t.ben, w.project, id)).includes('file.publish'))
  assert.deepEqual(await notes(w.ben.actorId, id), ['shared'], 'told it was shared with him')
  assert.equal((await call(w.t.ben, 'POST', `/api/files/${id}/subscription`)).status, 200)
  assert.equal((await call(w.t.ben, 'POST', `/api/files/${id}/comments`, { body: para(text('seen')) })).status, 201)

  /* Cara, the owner and the agent: nowhere. */
  for (const [who, token] of [
    ['cara', w.t.cara],
    ['owner', w.t.owner],
    ['agent', w.agentToken],
  ] as const) {
    assert.equal(await listed(token, w.project, id), undefined, `${who} lists it`)
    assert.equal((await call(token, 'GET', `/api/files/${id}`)).status, 404, `${who} reads it`)
    assert.equal(await found(token, word, id), false, `${who} finds it`)
    assert.deepEqual(await inFeed(token, w.project, id), [], `${who} sees it in the feed`)
  }
  /* A comment naming Cara tells her nothing. */
  assert.equal((await call(w.t.ann, 'POST', `/api/files/${id}/comments`, { body: para(mention(w.cara.actorId)) })).status, 201)
  assert.deepEqual(await notes(w.cara.actorId, id), [])
  /* No line of it was sent out. */
  assert.deepEqual(await deliveries(w.owner.workspaceId, id), [])

  /* Ben in the document, live. */
  const ctxBen = await authenticate(`Bearer ${w.t.ben}`)
  assert.ok(ctxBen)
  const b = socket()
  const seat = await join(ctxBen, id, b.ws)
  assert.ok(seat, 'a chosen person opens it together')
  const before = (await notes(w.ben.actorId, id)).length

  /* Taken off. */
  const off = await call(w.t.ann, 'PUT', `/api/files/${id}/audience`, { audience: 'chosen', reader_ids: [] })
  assert.equal(off.status, 200)
  for (let i = 0; i < 40 && b.closed.code === undefined; i++) await pause(50)
  assert.equal(b.closed.code, 4404, 'the open socket was closed at once')
  await leave(seat!)
  assert.equal((await call(w.t.ben, 'GET', `/api/files/${id}`)).status, 404)
  assert.equal(await listed(w.t.ben, w.project, id), undefined)
  assert.equal(await found(w.t.ben, word, id), false)
  assert.deepEqual(await inFeed(w.t.ben, w.project, id), [])
  /* He still has the subscription row, and hears nothing through it. */
  assert.equal((await call(w.t.ann, 'POST', `/api/files/${id}/comments`, { body: para(text('after')) })).status, 201)
  assert.equal((await notes(w.ben.actorId, id)).length, before)
  /* Chosen with nobody left is its author's, not the project's. */
  assert.equal((await call(w.t.cara, 'GET', `/api/files/${id}`)).status, 404)
  assert.equal((await call(w.t.ann, 'GET', `/api/files/${id}`)).status, 200)
})

test('who may change who sees it: the author, an editor it was shared with, never a token or an agent', async () => {
  const w = await studio()
  const id = await draft(w.t.ann, w.project, 'rights')
  /* Nobody but Ann can see a draft, so nobody but Ann can publish it. */
  assert.equal((await call(w.t.owner, 'PUT', `/api/files/${id}/audience`, { audience: 'project' })).status, 404)
  /* Chosen from the project only. */
  const stranger = await call(w.t.ann, 'PUT', `/api/files/${id}/audience`, { audience: 'chosen', reader_ids: [w.dev.actorId] })
  assert.equal(stranger.status, 400)
  assert.equal((stranger.body.error as { code: string }).code, 'not_on_project')
  assert.equal(
    (await call(w.t.ann, 'PUT', `/api/files/${id}/audience`, { audience: 'chosen', reader_ids: [w.ben.actorId, w.ann.actorId] })).status,
    200,
  )
  /* The author is never on the list. */
  const r = await call(w.t.ann, 'GET', `/api/files/${id}`)
  assert.deepEqual((r.body.file as { reader_ids: string[] }).reader_ids, [w.ben.actorId])
  /* Ben may edit others' documents in this workspace, so he may add Cara. */
  assert.equal(((await call(w.t.ben, 'GET', `/api/files/${id}`)).body.file as { may_share: boolean }).may_share, true)
  assert.equal((await call(w.t.ben, 'PUT', `/api/files/${id}/audience`, { audience: 'chosen', reader_ids: [w.cara.actorId] })).status, 200)
  /* And he is kept on it, as whoever edits a room stays in it. */
  const now = (await call(w.t.ann, 'GET', `/api/files/${id}`)).body.file as { reader_ids: string[] }
  assert.deepEqual(new Set(now.reader_ids), new Set([w.ben.actorId, w.cara.actorId]))
  /* Where members keep to their own documents, Ben may no longer. */
  await asTableOwner()`
    update workspace set settings = settings || '{"edit_others_content":"own_only"}'::jsonb where id = ${w.owner.workspaceId}`
  assert.equal((await call(w.t.ben, 'PUT', `/api/files/${id}/audience`, { audience: 'project' })).status, 403)
  await asTableOwner()`
    update workspace set settings = settings - 'edit_others_content' where id = ${w.owner.workspaceId}`

  /* A person's own token never says who sees it. */
  const made = await call(w.t.ann, 'POST', '/api/tokens', { name: 'Tool' })
  assert.equal(made.status, 201, JSON.stringify(made.body))
  const tool = made.body.token as string
  assert.equal((await call(tool, 'PUT', `/api/files/${id}/audience`, { audience: 'project' })).status, 403)
  /* Nor does it make a draft it could not publish. */
  assert.equal(
    (await call(tool, 'POST', `/api/projects/${w.project}/files`, { name: 'x', body: para(text('x')), audience: 'author' })).status,
    403,
  )
  /* A document an agent or a tool writes is the project's at once. */
  const agentDoc = await call(w.agentToken, 'POST', `/api/projects/${w.project}/files`, { name: 'Brief', body: para(text('for all')) })
  assert.equal(agentDoc.status, 201)
  assert.equal((await listed(w.t.cara, w.project, agentDoc.body.id as string))?.audience, 'project')
  assert.equal(
    (await call(w.agentToken, 'PUT', `/api/files/${agentDoc.body.id as string}/audience`, { audience: 'chosen', reader_ids: [] })).status,
    403,
  )
  /* Uploads, links and folders are never drafts. */
  assert.equal(
    (await call(w.t.ann, 'POST', `/api/projects/${w.project}/files`, { name: 'Site', url: 'https://example.com', audience: 'author' }))
      .status,
    400,
  )
  const link = await call(w.t.ann, 'POST', `/api/projects/${w.project}/files`, { name: 'Site', url: 'https://example.com' })
  assert.equal((await listed(w.t.cara, w.project, link.body.id as string))?.audience, 'project')
  assert.equal(
    (await call(w.t.ann, 'PUT', `/api/files/${link.body.id as string}/audience`, { audience: 'chosen', reader_ids: [] })).status,
    409,
  )
  /* Left out, a document is the project's — what a phone on an older build sends. */
  const plain = await call(w.t.ann, 'POST', `/api/projects/${w.project}/files`, { name: 'Old', body: para(text('old')) })
  assert.equal((await listed(w.t.cara, w.project, plain.body.id as string))?.audience, 'project')
})

test('narrowed from the project, a document comes off the web and stops being the project’s', async () => {
  const w = await studio()
  const id = await draft(w.t.ann, w.project, 'web')
  assert.equal((await call(w.t.ann, 'PUT', `/api/files/${id}/audience`, { audience: 'project' })).status, 200)
  const on = await call(w.t.ann, 'PUT', `/api/files/${id}/public`, { public: true })
  const token = on.body.token as string
  assert.equal((await app.request(`/api/public/docs/${token}`)).status === 404, false)
  assert.equal((await call(w.t.ann, 'PUT', `/api/files/${id}/audience`, { audience: 'chosen', reader_ids: [w.ben.actorId] })).status, 200)
  assert.equal((await app.request(`/api/public/docs/${token}`)).status, 404)
  const [row] = await asTableOwner()<{ public_token: string | null }[]>`select public_token from file where id = ${id}`
  assert.equal(row?.public_token, null)
  /* Lines from here are the feed's alone. */
  assert.equal((await call(w.t.ann, 'PATCH', `/api/files/${id}`, { name: 'Renamed' })).status, 200)
  assert.deepEqual(await deliveries(w.owner.workspaceId, id), [])
  /* What the project had already read stays the project's; the rename after is not. */
  const cara = await inFeed(w.t.cara, w.project, id)
  assert.equal(cara.includes('file.update'), false)
  assert.ok(cara.includes('file.public'), 'what the project saw while it was the project’s')
})

test('the rows themselves: the read policy, chosen_for, may_read and file_reader', async () => {
  const w = await studio()
  const id = await draft(w.t.ann, w.project, 'rls')
  await call(w.t.ann, 'PUT', `/api/files/${id}/audience`, { audience: 'chosen', reader_ids: [w.ben.actorId] })
  const sees = (actorId: string) =>
    withActor(actorId, async (tx) => {
      await tx`select set_config('app.workspace_id', ${w.owner.workspaceId}, true)`
      const [f] = await tx<{ n: number }[]>`select count(*)::int as n from file where id = ${id}`
      const [r] = await tx<{ n: number }[]>`select count(*)::int as n from file_reader where file_id = ${id}`
      return { file: f?.n ?? 0, readers: r?.n ?? 0 }
    })
  assert.deepEqual(await sees(w.ann.actorId), { file: 1, readers: 1 })
  assert.deepEqual(await sees(w.ben.actorId), { file: 1, readers: 1 })
  assert.deepEqual(await sees(w.cara.actorId), { file: 0, readers: 0 })
  assert.deepEqual(await sees(w.owner.ctx.actorId), { file: 0, readers: 0 })
  assert.deepEqual(await sees(w.agentId), { file: 0, readers: 0 })
  /* Asked about somebody, as a mention asks. */
  const may = await withActor(w.ann.actorId, async (tx) => {
    await tx`select set_config('app.workspace_id', ${w.owner.workspaceId}, true)`
    return tx<{ ben: boolean; cara: boolean; owner: boolean }[]>`
      select may_read(${w.ben.actorId}, 'file', ${id}) as ben, may_read(${w.cara.actorId}, 'file', ${id}) as cara,
             may_read(${w.owner.ctx.actorId}, 'file', ${id}) as owner`
  })
  assert.deepEqual({ ...may[0] }, { ben: true, cara: false, owner: false })
  /* Cara cannot write herself onto it under the policy either. */
  await assert.rejects(
    withActor(w.cara.actorId, async (tx) => {
      await tx`select set_config('app.workspace_id', ${w.owner.workspaceId}, true)`
      await tx`insert into file_reader (workspace_id, file_id, actor_id) values (${w.owner.workspaceId}, ${id}, ${w.cara.actorId})`
    }),
  )
  /* Nor can she widen it by updating the row she cannot see. */
  const widened = await withActor(w.cara.actorId, async (tx) => {
    await tx`select set_config('app.workspace_id', ${w.owner.workspaceId}, true)`
    return tx`update file set audience = 'project' where id = ${id}`
  })
  assert.equal(widened.count, 0)
  /* A link is never anybody's but the project's — the table says so. */
  const link = await call(w.t.ann, 'POST', `/api/projects/${w.project}/files`, { name: 'Site', url: 'https://example.com' })
  await assert.rejects(asTableOwner()`update file set audience = 'chosen' where id = ${link.body.id as string}`)
})

/* ------------------------------------------------- what the review found */

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
async function upload(token: string, path: string, name: string): Promise<string> {
  const form = new FormData()
  form.append('file', new File([png], name, { type: 'image/png' }))
  const r = await app.request(path, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form })
  assert.equal(r.status, 201, `${path} ${await r.clone().text()}`)
  return ((await r.json()) as { id: string }).id
}
const attachment = (fileId: string, name: string) => ({
  type: 'doc',
  content: [{ type: 'attachment', attrs: { fileId, name, kind: 'image' } }],
})
const as =
  (actorId: string, workspaceId: string) =>
  <T>(fn: (tx: postgres.TransactionSql) => Promise<T>) =>
    withActor(actorId, async (tx) => {
      await tx`select set_config('app.workspace_id', ${workspaceId}, true)`
      return fn(tx as unknown as postgres.TransactionSql)
    })

test('a picture put into a draft is the draft’s: not listed, read, signed, searched, told or linked to anybody else', async () => {
  const w = await studio()
  await asTableOwner()`
    insert into webhook (id, workspace_id, url, secret_enc, created_by)
    values (${uuidv7()}, ${w.owner.workspaceId}, 'https://example.com/hook', 'whs_x', ${w.owner.ctx.actorId})`
  const heard: unknown[] = []
  const stop = await subscribe(`project:${w.project}`, (e) => heard.push((e.payload as { object_id?: unknown }).object_id))
  try {
    const draftId = await draft(w.t.ann, w.project, 'reorg')
    /* As the editor does it: uploaded into the document, then written into its body. */
    const name = `layoffs${uuidv7().slice(-6)}.png`
    const pic = await upload(w.t.ann, `/api/projects/${w.project}/uploads?into=${draftId}`, name)
    assert.equal((await call(w.t.ann, 'PATCH', `/api/files/${draftId}`, { body: attachment(pic, name) })).status, 200)

    /* Ann has it. */
    assert.ok(await listed(w.t.ann, w.project, pic))
    assert.equal((await call(w.t.ann, 'GET', `/api/files/${pic}/url`)).status, 200)

    for (const [who, token] of [
      ['ben', w.t.ben],
      ['owner', w.t.owner],
      ['agent', w.agentToken],
    ] as const) {
      assert.equal(await listed(token, w.project, pic), undefined, `${who} lists the picture`)
      assert.equal((await call(token, 'GET', `/api/files/${pic}`)).status, 404, `${who} reads it`)
      assert.equal((await call(token, 'GET', `/api/files/${pic}/url`)).status, 404, `${who} has it signed`)
      assert.equal(await found(token, name.slice(0, 10), pic), false, `${who} finds it`)
      assert.deepEqual(await inFeed(token, w.project, pic), [], `${who} sees its upload in the feed`)
    }
    /* An agent's links to files: nothing for it. */
    const links = await call(w.agentToken, 'GET', `/api/file-links?ids=${pic}`)
    assert.deepEqual((links.body.links as unknown[] | undefined) ?? [], [])
    /* What the draft points at is nobody else's either. */
    const back = await call(w.t.ben, 'GET', `/api/links/file/${draftId}`)
    assert.deepEqual((back.body.links as unknown[] | undefined) ?? [], [])
    await pause(300)
    assert.equal(heard.includes(pic), false, 'the project’s socket heard nothing of the picture')
    assert.deepEqual(await deliveries(w.owner.workspaceId, pic), [], 'no webhook for the picture')
    /* Asked for into a document the asker cannot read, refused. */
    const form = new FormData()
    form.append('file', new File([png], 'x.png', { type: 'image/png' }))
    const into = await app.request(`/api/projects/${w.project}/uploads?into=${draftId}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${w.t.ben}` },
      body: form,
    })
    assert.equal(into.status, 404)

    /* Published, the picture goes with it. */
    assert.equal((await call(w.t.ann, 'PUT', `/api/files/${draftId}/audience`, { audience: 'project' })).status, 200)
    assert.ok(await listed(w.t.ben, w.project, pic), 'Ben lists it once the document is the project’s')
    assert.equal((await call(w.t.ben, 'GET', `/api/files/${pic}/url`)).status, 200)
  } finally {
    await stop()
  }
})

test('a picture in a comment on a draft is the draft’s when sent into it; one sent the old way stays the project’s', async () => {
  const w = await studio()
  const draftId = await draft(w.t.ann, w.project, 'notes')
  /* Sent into the draft, as a comment under it does now; and one sent the
     old way, without saying where — a phone from before `into`. */
  const fresh = await upload(w.t.ann, `/api/projects/${w.project}/uploads?into=${draftId}`, 'note-to-self.png')
  const oldWay = await upload(w.t.ann, `/api/projects/${w.project}/uploads`, 'old-way.png')
  /* And one Ben put in Docs a while ago. */
  const old = await upload(w.t.ben, `/api/projects/${w.project}/uploads`, 'team-photo.png')
  await asTableOwner()`update file set created_at = now() - interval '2 hours' where id = ${old}`
  const said = await call(w.t.ann, 'POST', `/api/files/${draftId}/comments`, {
    body: {
      type: 'doc',
      content: [
        { type: 'attachment', attrs: { fileId: fresh, name: 'note-to-self.png', kind: 'image' } },
        { type: 'attachment', attrs: { fileId: old, name: 'team-photo.png', kind: 'image' } },
        { type: 'attachment', attrs: { fileId: oldWay, name: 'old-way.png', kind: 'image' } },
      ],
    },
  })
  assert.equal(said.status, 201)
  assert.equal(await listed(w.t.ben, w.project, fresh), undefined, 'the picture sent into the draft is the draft’s')
  assert.ok(await listed(w.t.ben, w.project, oldWay), 'one sent the old way stays the project’s: only into makes a document its place')
  assert.ok(await listed(w.t.cara, w.project, old), 'Ben’s old picture is still in Docs')
  const [row] = await asTableOwner()<{ origin_id: string | null }[]>`select origin_id from file where id = ${old}`
  assert.equal(row?.origin_id, null, 'and does not name the draft')
  /* No row anybody else can list names the draft. */
  const all = (await call(w.t.ben, 'GET', `/api/projects/${w.project}/files`)).body.files as { origin_id?: string | null }[]
  assert.equal(
    all.some((f) => f.origin_id === draftId),
    false,
  )
  assert.equal((await call(w.t.ben, 'GET', `/api/files/${draftId}/comments`)).status, 404)
})

test('a draft taken for good takes its lines and its pictures with it', async () => {
  const w = await studio()
  const draftId = await draft(w.t.ann, w.project, 'gone')
  const pic = await upload(w.t.ann, `/api/projects/${w.project}/uploads?into=${draftId}`, 'gone.png')
  await call(w.t.ann, 'PATCH', `/api/files/${draftId}`, { name: 'Second secret v2' })
  await call(w.t.ann, 'PUT', `/api/files/${draftId}/audience`, { audience: 'chosen', reader_ids: [w.ben.actorId] })
  assert.equal((await call(w.t.ann, 'DELETE', `/api/files/${draftId}`)).status, 200)
  assert.deepEqual(await inFeed(w.t.cara, w.project, draftId), [])
  /* The clear-out, thirty days on. */
  await asTableOwner()`delete from file where id = ${draftId}`
  assert.deepEqual(await inFeed(w.t.cara, w.project, draftId), [], 'its lines do not turn up once it is gone')
  assert.deepEqual(await inFeed(w.t.cara, w.project, pic), [], 'nor its picture’s')
  const [lines] = await asTableOwner()<{ n: number }[]>`
    select count(*)::int as n from activity_event where object_id in (${draftId}, ${pic})`
  assert.equal(lines?.n, 0)
  const [p] = await asTableOwner()<{ n: number }[]>`select count(*)::int as n from file where id = ${pic}`
  assert.equal(p?.n, 0, 'its picture goes for good with it')
  assert.equal(await listed(w.t.cara, w.project, pic), undefined)
})

test('taken off the project or out of the workspace, a chosen person loses their place for good', async () => {
  const w = await studio()
  const id = await draft(w.t.ann, w.project, 'places')
  await call(w.t.ann, 'PUT', `/api/files/${id}/audience`, { audience: 'chosen', reader_ids: [w.ben.actorId, w.cara.actorId] })
  const places = async () =>
    (await asTableOwner()<{ actor_id: string }[]>`select actor_id from file_reader where file_id = ${id}`).map((r) => r.actor_id)
  assert.equal((await places()).length, 2)

  /* Cara off the project, and back on. */
  await asTableOwner()`update project_member set deleted_at = now() where project_id = ${w.project} and actor_id = ${w.cara.actorId}`
  assert.deepEqual(await places(), [w.ben.actorId])
  await asTableOwner()`update project_member set deleted_at = null where project_id = ${w.project} and actor_id = ${w.cara.actorId}`
  assert.equal((await call(w.t.cara, 'GET', `/api/files/${id}`)).status, 404, 'added back is not chosen again')

  /* Ben out of the workspace. */
  await asTableOwner()`update membership set deleted_at = now() where workspace_id = ${w.owner.workspaceId} and actor_id = ${w.ben.actorId}`
  assert.deepEqual(await places(), [])
  /* And nobody outside the workspace can be chosen. */
  const r = await call(w.t.ann, 'PUT', `/api/files/${id}/audience`, { audience: 'chosen', reader_ids: [w.ben.actorId] })
  assert.equal(r.status, 400)
})

test('the rows hold who may share: not a reader who may not edit, never back to a draft', async () => {
  const w = await studio()
  const id = await draft(w.t.ann, w.project, 'floor')
  await call(w.t.ann, 'PUT', `/api/files/${id}/audience`, { audience: 'chosen', reader_ids: [w.cara.actorId] })
  /* Members keep to their own documents here: Cara reads it and may not share it. */
  await asTableOwner()`
    update workspace set settings = settings || '{"edit_others_content":"own_only"}'::jsonb where id = ${w.owner.workspaceId}`
  const cara = as(w.cara.actorId, w.owner.workspaceId)
  const ann = as(w.ann.actorId, w.owner.workspaceId)
  assert.equal((await cara((tx) => tx<{ n: number }[]>`select count(*)::int as n from file where id = ${id}`))[0]?.n, 1)
  await assert.rejects(
    cara((tx) => tx`insert into file_reader (workspace_id, file_id, actor_id) values (${w.owner.workspaceId}, ${id}, ${w.ben.actorId})`),
  )
  await assert.rejects(cara((tx) => tx`update file set audience = 'project' where id = ${id}`))
  const removed = await cara((tx) => tx`delete from file_reader where file_id = ${id}`)
  assert.equal(removed.count, 0)
  /* Not back to a draft, whoever asks. */
  await assert.rejects(ann((tx) => tx`update file set audience = 'author' where id = ${id}`))
  /* Nobody can be put on it who is not on the project. */
  await assert.rejects(
    ann((tx) => tx`insert into file_reader (workspace_id, file_id, actor_id) values (${w.owner.workspaceId}, ${id}, ${w.dev.actorId})`),
  )
  /* Ann may. */
  await ann((tx) => tx`insert into file_reader (workspace_id, file_id, actor_id) values (${w.owner.workspaceId}, ${id}, ${w.ben.actorId})`)
})

test('a picture sent without saying where, then written into a draft, stays the project’s', async () => {
  const w = await studio()
  const draftId = await draft(w.t.ann, w.project, 'old way')
  /* A client from before `into`: the upload, then the body. The file was
     the project's the moment it arrived, and naming it does not take it
     back — nor does it take a file the project had from its Docs. */
  const pic = await upload(w.t.ann, `/api/projects/${w.project}/uploads`, 'org-chart.png')
  assert.equal((await call(w.t.ann, 'PATCH', `/api/files/${draftId}`, { body: attachment(pic, 'org-chart.png') })).status, 200)
  assert.ok(await listed(w.t.ben, w.project, pic))
  const [o] = await asTableOwner()<{ origin_type: string | null }[]>`select origin_type from file where id = ${pic}`
  assert.equal(o?.origin_type, null)
  /* Somebody else's picture, already the project's, is not taken by naming it. */
  const bens = await upload(w.t.ben, `/api/projects/${w.project}/uploads`, 'bens.png')
  assert.equal((await call(w.t.ann, 'PATCH', `/api/files/${draftId}`, { body: attachment(bens, 'bens.png') })).status, 200)
  assert.ok(await listed(w.t.cara, w.project, bens))
})

/* ------------------------------------------------- what the second review found */

/** Two projects, and Ann, Mal and Ben on both. */
async function twoProjects() {
  const owner = await makeOwner()
  const a = await makeProject(owner.ctx, owner.workspaceId, 'Alpha')
  const b = await makeProject(owner.ctx, owner.workspaceId, 'Beta')
  const ann = await addPerson(owner.ctx, owner.workspaceId, 'member', [a, b])
  const mal = await addPerson(owner.ctx, owner.workspaceId, 'member', [a, b])
  const ben = await addPerson(owner.ctx, owner.workspaceId, 'member', [a, b])
  return {
    owner,
    a,
    b,
    ann,
    mal,
    ben,
    t: {
      ann: await bearerFor(ann.actorId, owner.workspaceId),
      mal: await bearerFor(mal.actorId, owner.workspaceId),
      ben: await bearerFor(ben.actorId, owner.workspaceId),
    },
  }
}
const deletedAt = async (id: string) =>
  (await asTableOwner()<{ deleted_at: string | null }[]>`select deleted_at from file where id = ${id}`)[0]?.deleted_at ?? null

test('a comment on a document never takes somebody else’s file, here or in another project', async () => {
  const w = await twoProjects()
  /* Ann's contract, in Beta. Mal names it in a comment on his own document in Alpha. */
  const contract = await upload(w.t.ann, `/api/projects/${w.b}/uploads`, 'contract.png')
  const doc = (await call(w.t.mal, 'POST', `/api/projects/${w.a}/files`, { name: 'Notes', body: { type: 'doc', content: [] } })).body
    .id as string
  assert.equal((await call(w.t.mal, 'POST', `/api/files/${doc}/comments`, { body: attachment(contract, 'x.png') })).status, 201)
  const [o] = await asTableOwner()<{ origin_type: string | null }[]>`select origin_type from file where id = ${contract}`
  assert.equal(o?.origin_type, null, 'a document the project has claims nothing')
  /* Narrowed, and taken for good: Ann's file is untouched. */
  assert.equal((await call(w.t.mal, 'PUT', `/api/files/${doc}/audience`, { audience: 'chosen', reader_ids: [] })).status, 200)
  assert.ok(await listed(w.t.ben, w.b, contract), 'Ben still sees the contract')
  await call(w.t.mal, 'DELETE', `/api/files/${doc}`)
  await asTableOwner()`delete from file where id = ${doc}`
  assert.equal(await deletedAt(contract), null, 'the clear-out of Mal’s document leaves it be')
  assert.ok(await listed(w.t.ben, w.b, contract))

  /* Mal names it in a draft of his own: not his upload, so not claimed. */
  const malDraft = (
    await call(w.t.mal, 'POST', `/api/projects/${w.a}/files`, { name: 'D', body: { type: 'doc', content: [] }, audience: 'author' })
  ).body.id as string
  await call(w.t.mal, 'PATCH', `/api/files/${malDraft}`, { body: attachment(contract, 'x.png') })
  assert.ok(await listed(w.t.ben, w.b, contract))

  /* Ann's own fresh upload in Beta, named in her draft in Alpha: another project, not claimed. */
  const shot = await upload(w.t.ann, `/api/projects/${w.b}/uploads`, 'shared-in-B.png')
  const annDraft = (
    await call(w.t.ann, 'POST', `/api/projects/${w.a}/files`, { name: 'D', body: { type: 'doc', content: [] }, audience: 'author' })
  ).body.id as string
  await call(w.t.ann, 'PATCH', `/api/files/${annDraft}`, { body: attachment(shot, 'x.png') })
  assert.ok(await listed(w.t.ben, w.b, shot), 'Ben in Beta still sees it')

  /* Ann's fresh upload already named by a task: not claimed by her draft either. */
  const inTask = await upload(w.t.ann, `/api/projects/${w.a}/uploads`, 'in-task.png')
  assert.equal(
    (await call(w.t.ann, 'POST', `/api/projects/${w.a}/tasks`, { title: 'Look', body: attachment(inTask, 'x.png') })).status,
    201,
  )
  await call(w.t.ann, 'PATCH', `/api/files/${annDraft}`, { body: attachment(inTask, 'x.png') })
  assert.ok(await listed(w.t.ben, w.a, inTask))
})

test('a draft’s picture stays the draft’s wherever it is shown, and goes with the draft', async () => {
  const w = await twoProjects()
  const draftId = (
    await call(w.t.ann, 'POST', `/api/projects/${w.a}/files`, { name: 'D', body: { type: 'doc', content: [] }, audience: 'author' })
  ).body.id as string
  const pic = await upload(w.t.ann, `/api/projects/${w.a}/uploads?into=${draftId}`, 'in-draft.png')
  assert.equal(await listed(w.t.ben, w.a, pic), undefined)
  assert.equal((await call(w.t.ann, 'POST', `/api/projects/${w.a}/tasks`, { title: 'Look', body: attachment(pic, 'x.png') })).status, 201)
  assert.equal((await call(w.t.ben, 'GET', `/api/files/${pic}/url`)).status, 404, 'shown in a task, still the draft’s')
  await call(w.t.ann, 'DELETE', `/api/files/${draftId}`)
  await asTableOwner()`delete from file where id = ${draftId}`
  const [left] = await asTableOwner()<{ n: number }[]>`select count(*)::int as n from file where id = ${pic}`
  assert.equal(left?.n, 0, 'and it goes with the draft')
})

test('?into is a written document of the same project the uploader may read', async () => {
  const w = await twoProjects()
  const annDraft = (
    await call(w.t.ann, 'POST', `/api/projects/${w.a}/files`, { name: 'D', body: { type: 'doc', content: [] }, audience: 'author' })
  ).body.id as string
  const inB = (await call(w.t.ann, 'POST', `/api/projects/${w.b}/files`, { name: 'B', body: { type: 'doc', content: [] } })).body
    .id as string
  const pic = await upload(w.t.ann, `/api/projects/${w.a}/uploads?into=${annDraft}`, 'p.png')
  const link = (await call(w.t.ann, 'POST', `/api/projects/${w.a}/files`, { name: 'L', url: 'https://example.com' })).body.id as string
  const tryInto = async (token: string, into: string) => {
    const form = new FormData()
    form.append('file', new File([png], 'a.png', { type: 'image/png' }))
    return (
      await app.request(`/api/projects/${w.a}/uploads?into=${into}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        body: form,
      })
    ).status
  }
  assert.equal(await tryInto(w.t.ben, annDraft), 404, 'a draft Ben cannot read')
  assert.equal(await tryInto(w.t.ben, inB), 404, 'a document of another project')
  assert.equal(await tryInto(w.t.ann, pic), 400, 'an upload')
  assert.equal(await tryInto(w.t.ann, link), 400, 'a link')
})

test('an owner chosen while on no project loses the place when no longer the owner', async () => {
  const w = await studio()
  /* The owner, taken off the project's list: they see it as the owner. */
  const boss = w.owner.ctx
  await asTableOwner()`delete from project_member where project_id = ${w.project} and actor_id = ${boss.actorId}`
  const id = await draft(w.t.ann, w.project, 'boss')
  assert.equal((await call(w.t.ann, 'PUT', `/api/files/${id}/audience`, { audience: 'chosen', reader_ids: [boss.actorId] })).status, 200)
  const rows = async () => (await asTableOwner()`select 1 from file_reader where file_id = ${id}`).length
  assert.equal(await rows(), 1)
  await asTableOwner()`update membership set role = 'member' where workspace_id = ${w.owner.workspaceId} and actor_id = ${boss.actorId}`
  assert.equal(await rows(), 0)
})

test('narrowed, a document is said gone on the project’s socket — its id and nothing else', async () => {
  const w = await studio()
  const id = await draft(w.t.ann, w.project, 'hidden')
  await call(w.t.ann, 'PUT', `/api/files/${id}/audience`, { audience: 'project' })
  const heard: { kind: string; payload: unknown }[] = []
  const stop = await subscribe(`project:${w.project}`, (e) => heard.push({ kind: e.kind, payload: e.payload }))
  try {
    await call(w.t.ann, 'PUT', `/api/files/${id}/audience`, { audience: 'chosen', reader_ids: [w.ben.actorId] })
    await pause(300)
    const gone = heard.filter((e) => e.kind === 'file.hidden')
    assert.equal(gone.length, 1)
    assert.equal((gone[0]!.payload as { object_id: string }).object_id, id)
    assert.equal(JSON.stringify(gone[0]!.payload).includes('hidden'), false, 'no name in it')
  } finally {
    await stop()
  }
})

test('a task made from a draft’s line names the draft without its title', async () => {
  const w = await studio()
  const id = await draft(w.t.ann, w.project, 'veiled')
  const ref = (title: string) => ({
    type: 'doc',
    content: [{ type: 'paragraph', content: [text('From '), { type: 'docref', attrs: { id, projectId: w.project, number: 9, title } }] }],
  })
  const made = await call(w.t.ann, 'POST', `/api/projects/${w.project}/tasks`, { title: 'Do it', body: ref('Plan veiled') })
  assert.equal(made.status, 201)
  const task = await call(w.t.ben, 'GET', `/api/tasks/${made.body.id as string}`)
  assert.equal(JSON.stringify(task.body).includes('Plan veiled'), false, 'Ben does not read the draft’s title')
  /* A comment naming it, too. */
  await call(w.t.ann, 'POST', `/api/tasks/${made.body.id as string}/comments`, { body: ref('Plan veiled') })
  const again = await call(w.t.ben, 'GET', `/api/tasks/${made.body.id as string}`)
  assert.equal(JSON.stringify(again.body).includes('Plan veiled'), false)
  /* Once it is the project's, a new mention keeps its title. */
  await call(w.t.ann, 'PUT', `/api/files/${id}/audience`, { audience: 'project' })
  const later = await call(w.t.ann, 'POST', `/api/projects/${w.project}/tasks`, { title: 'Do more', body: ref('Plan veiled') })
  const read = await call(w.t.ben, 'GET', `/api/tasks/${later.body.id as string}`)
  assert.equal(JSON.stringify(read.body).includes('Plan veiled'), true)
})

/* ------------------------------------------------- what the third review found */

test('a draft’s picture named in a second draft goes for good with the first; a file whose document is gone is its uploader’s alone', async () => {
  const w = await studio()
  const d1 = await draft(w.t.ann, w.project, 'one')
  const pic = await upload(w.t.ann, `/api/projects/${w.project}/uploads?into=${d1}`, 'secret.png')
  await call(w.t.ann, 'PATCH', `/api/files/${d1}`, { body: attachment(pic, 'secret.png') })
  const d2 = await draft(w.t.ann, w.project, 'two')
  await call(w.t.ann, 'PATCH', `/api/files/${d2}`, { body: attachment(pic, 'secret.png') })
  assert.equal(await listed(w.t.ben, w.project, pic), undefined)
  await call(w.t.ann, 'DELETE', `/api/files/${d1}`)
  assert.equal(await listed(w.t.ben, w.project, pic), undefined, 'binned, its picture is still the draft’s')
  await asTableOwner()`delete from file where id = ${d1}`
  const [left] = await asTableOwner()<{ n: number }[]>`select count(*)::int as n from file where id = ${pic}`
  assert.equal(left?.n, 0, 'the clear-out takes it for good')
  assert.deepEqual(await inFeed(w.t.ben, w.project, pic), [])

  /* A held file cannot outlive its document: a document's row gone by any
     path takes its kept files with it, and the key says no to anything
     else (migration 287). */
  const d3 = await draft(w.t.ann, w.project, 'three')
  const kept3 = await upload(w.t.ann, `/api/projects/${w.project}/uploads?into=${d3}`, 'kept3.png')
  await asTableOwner()`delete from file where id = ${d3}`
  const [k3] = await asTableOwner()<{ n: number }[]>`select count(*)::int as n from file where id = ${kept3}`
  assert.equal(k3?.n, 0)
  const [key] = await asTableOwner()<{ def: string }[]>`
    select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'file_held_by_a_document'`
  assert.match(key?.def ?? '', /FOREIGN KEY \(held_by\) REFERENCES file\(id\)/)

  /* A document the project had, taken for good: what was put into it is the project's. */
  const pub = (await call(w.t.ann, 'POST', `/api/projects/${w.project}/files`, { name: 'Pub', body: { type: 'doc', content: [] } })).body
    .id as string
  const its = await upload(w.t.ann, `/api/projects/${w.project}/uploads?into=${pub}`, 'its.png')
  assert.ok(await listed(w.t.ben, w.project, its))
  await asTableOwner()`delete from file where id = ${pub}`
  assert.ok(await listed(w.t.ben, w.project, its), 'still in Docs')
})

test('every way a task is made names a draft without its title — the title key gone, whoever writes it', async () => {
  const w = await studio()
  const id = await draft(w.t.ann, w.project, 'layoffs')
  const chip = (title: string) => ({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'docref', attrs: { id, projectId: w.project, number: 9, title } }] }],
  })
  const parent = (await call(w.t.ann, 'POST', `/api/projects/${w.project}/tasks`, { title: 'Parent' })).body.id as string
  /* A part of a task — the endpoint MCP's create_subtask calls. */
  const sub = await call(w.t.ann, 'POST', `/api/tasks/${parent}/steps`, { title: 'Sub', body: chip('Layoffs plan') })
  assert.equal(sub.status, 201)
  const [stored] = await asTableOwner()<{ body: unknown }[]>`select body from task where id = ${sub.body.id as string}`
  const said = JSON.stringify(stored?.body)
  assert.equal(said.includes('Layoffs plan'), false)
  assert.equal(said.includes('"title"'), false, 'the key itself is gone, for the iPhone app to say Document')
  assert.equal(said.includes('"number"'), false)
  /* Ben, who cannot see the draft, names it with a title of his choosing: veiled all the same. */
  const spoof = await call(w.t.ben, 'POST', `/api/projects/${w.project}/tasks`, { title: 'spoof', body: chip('Anything Ben likes') })
  assert.equal(
    JSON.stringify((await call(w.t.ben, 'GET', `/api/tasks/${spoof.body.id as string}`)).body).includes('Anything Ben likes'),
    false,
  )
  /* A message made a task or an announcement. */
  const room = await call(w.t.ann, 'POST', `/api/projects/${w.project}/conversations`, { name: `r${uuidv7().slice(-6)}` })
  const msg = await call(w.t.ann, 'POST', `/api/conversations/${room.body.id as string}/messages`, { body: chip('Layoffs plan') })
  assert.equal(msg.status, 201)
  /* Written as the draft's while it is the draft's — and the message, if
     it carried the title from before, does not hand it on. */
  await asTableOwner()`update message set body = ${asTableOwner().json(chip('Layoffs plan') as never)} where id = ${msg.body.id as string}`
  for (const to of ['task', 'post'] as const) {
    const made = await call(w.t.ann, 'POST', `/api/messages/${msg.body.id as string}/promote`, { to, title: 'From chat' })
    assert.equal(made.status, 201, JSON.stringify(made.body))
    const table = to === 'task' ? 'task' : 'post'
    const [row] = await asTableOwner()<{ body: unknown }[]>`select body from ${asTableOwner()(table)} where id = ${made.body.id as string}`
    assert.equal(JSON.stringify(row?.body).includes('Layoffs plan'), false, `promoted to ${to}`)
  }
  /* A chip written while the document was the project's keeps its title
     after it is narrowed — said in the spec, and accepted. */
  const pub = (await call(w.t.ann, 'POST', `/api/projects/${w.project}/files`, { name: 'Reorg', body: { type: 'doc', content: [] } })).body
    .id as string
  const early = await call(w.t.ben, 'POST', `/api/projects/${w.project}/tasks`, {
    title: 'see',
    body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'docref', attrs: { id: pub, title: 'Reorg' } }] }] },
  })
  await call(w.t.ann, 'PUT', `/api/files/${pub}/audience`, { audience: 'chosen', reader_ids: [] })
  assert.equal(JSON.stringify((await call(w.t.ben, 'GET', `/api/tasks/${early.body.id as string}`)).body).includes('Reorg'), true)
})

test('no body lets a document’s picture go: not a task, an edit by somebody else, a duplicate, a copy, an announcement, an agent or a token', async () => {
  const w = await twoProjects()
  const cara = await addPerson(w.owner.ctx, w.owner.workspaceId, 'member', [w.a, w.b])
  const tCara = await bearerFor(cara.actorId, w.owner.workspaceId)
  const dev = await addPerson(w.owner.ctx, w.owner.workspaceId, 'member', [w.b])
  const tDev = await bearerFor(dev.actorId, w.owner.workspaceId)
  const d = (
    await call(w.t.ann, 'POST', `/api/projects/${w.a}/files`, {
      name: 'Secret plan',
      body: { type: 'doc', content: [] },
      audience: 'author',
    })
  ).body.id as string
  await call(w.t.ann, 'PUT', `/api/files/${d}/audience`, { audience: 'chosen', reader_ids: [w.ben.actorId] })
  const fresh = () => upload(w.t.ann, `/api/projects/${w.a}/uploads?into=${d}`, 'secret.png')
  const kept = async (pic: string) => {
    const [o] = await asTableOwner()<{ held_by: string | null }[]>`select held_by from file where id = ${pic}`
    return o?.held_by === d
  }
  const urlOf = async (token: string, pic: string) => (await call(token, 'GET', `/api/files/${pic}/url`)).status

  /* Cara, who cannot see it, writes it into a task; Ben, who can, edits the task. */
  const p1 = await fresh()
  const t1 = (await call(tCara, 'POST', `/api/projects/${w.a}/tasks`, { title: 'Cara', body: attachment(p1, 'x.png') })).body.id as string
  assert.equal((await call(w.t.ben, 'PATCH', `/api/tasks/${t1}`, { body: attachment(p1, 'see!') })).status, 200)
  assert.equal(await kept(p1), true)
  assert.equal(await urlOf(tCara, p1), 404)
  /* Ben duplicates it, and copies it into Beta: no copy of the picture is made there. */
  const p2 = await fresh()
  const t2 = (await call(w.t.ben, 'POST', `/api/projects/${w.a}/tasks`, { title: 'Ben', body: attachment(p2, 'x.png') })).body.id as string
  assert.ok([200, 201].includes((await call(w.t.ben, 'POST', `/api/tasks/${t2}/duplicate`, {})).status))
  const cp = await call(w.t.ben, 'POST', `/api/tasks/${t2}/copy`, { project_id: w.b })
  assert.ok([200, 201].includes(cp.status), JSON.stringify(cp.body))
  const copies = await asTableOwner()<{ id: string }[]>`
    select id from file where project_id = ${w.b} and storage_key = (select storage_key from file where id = ${p2})`
  assert.equal(copies.length, 0, 'a picture put into a document is never re-homed by a copy')
  assert.equal(await kept(p2), true)
  assert.equal(await urlOf(tDev, p2), 404)
  /* An announcement that is out. */
  const p3 = await fresh()
  await call(w.t.ben, 'POST', `/api/projects/${w.a}/posts`, { title: 'now', body: attachment(p3, 'x.png'), publish: true })
  assert.equal(await kept(p3), true)
  assert.equal(await urlOf(tCara, p3), 404)
  /* A person's own token. */
  const tok = (await call(w.t.ben, 'POST', '/api/tokens', { name: 'Tool' })).body.token as string
  const p4 = await fresh()
  await call(tok, 'POST', `/api/projects/${w.a}/tasks`, { title: 'Tool', body: attachment(p4, 'x.png') })
  assert.equal(await kept(p4), true)
})

test('a picture put into a document that is narrowed is told to nobody, whoever acts on it — its uploader included', async () => {
  const w = await twoProjects()
  const cara = await addPerson(w.owner.ctx, w.owner.workspaceId, 'member', [w.a])
  const tCara = await bearerFor(cara.actorId, w.owner.workspaceId)
  await asTableOwner()`
    insert into webhook (id, workspace_id, url, secret_enc, created_by)
    values (${uuidv7()}, ${w.owner.workspaceId}, 'https://example.com/hook', 'whs_x', ${w.owner.ctx.actorId})`
  const d = (await call(w.t.ann, 'POST', `/api/projects/${w.a}/files`, { name: 'Shared', body: { type: 'doc', content: [] } })).body
    .id as string
  /* Cara puts a picture into Ann's document while it is the project's. */
  const pic = await upload(tCara, `/api/projects/${w.a}/uploads?into=${d}`, 'cara.png')
  const heard: { kind: string; id: unknown }[] = []
  const stop = await subscribe(`project:${w.a}`, (e) => heard.push({ kind: e.kind, id: (e.payload as { object_id?: unknown }).object_id }))
  try {
    /* Ann narrows it to Ben: the picture is said gone with it. */
    await call(w.t.ann, 'PUT', `/api/files/${d}/audience`, { audience: 'chosen', reader_ids: [w.ben.actorId] })
    await pause(300)
    assert.ok(
      heard.some((h) => h.kind === 'file.hidden' && h.id === pic),
      'its picture is said gone too',
    )
    heard.length = 0
    const before = (await deliveries(w.owner.workspaceId, pic)).length
    /* Cara, its uploader, still sees it — and what she does with it is told to nobody. */
    assert.equal((await call(tCara, 'GET', `/api/files/${pic}/url`)).status, 200)
    assert.equal((await call(tCara, 'POST', `/api/files/${pic}/comments`, { body: para(text('hm')) })).status, 201)
    assert.equal((await call(tCara, 'DELETE', `/api/files/${pic}`)).status, 200)
    assert.equal((await call(tCara, 'POST', `/api/files/${pic}/restore`)).status, 200)
    await pause(300)
    assert.deepEqual((await deliveries(w.owner.workspaceId, pic)).slice(before), [])
    assert.deepEqual(
      heard.filter((h) => h.id === pic),
      [],
    )
  } finally {
    await stop()
  }
})

test('a chip naming a draft is veiled whatever case its id is written in', async () => {
  const w = await studio()
  const id = await draft(w.t.ann, w.project, 'people')
  const chip = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'docref', attrs: { id: id.toUpperCase(), projectId: w.project, number: 3, title: 'Layoffs' } }],
      },
    ],
  }
  const t = await call(w.t.ann, 'POST', `/api/projects/${w.project}/tasks`, { title: 'x', body: chip })
  assert.equal(JSON.stringify((await call(w.t.ben, 'GET', `/api/tasks/${t.body.id as string}`)).body).includes('Layoffs'), false)
})

/* ------------------------------------------------- Recently Deleted */

test('a draft with a picture, deleted and deleted forever, leaves nothing a manager can list or put back', async () => {
  const w = await studio()
  const boss = await addManager(w.owner.ctx, w.owner.workspaceId, [w.project])
  const tBoss = await bearerFor(boss.actorId, w.owner.workspaceId)
  await asTableOwner()`
    insert into webhook (id, workspace_id, url, secret_enc, created_by)
    values (${uuidv7()}, ${w.owner.workspaceId}, 'https://example.com/hook', 'whs_x', ${w.owner.ctx.actorId})`
  const id = await draft(w.t.ann, w.project, 'forever')
  const pic = await upload(w.t.ann, `/api/projects/${w.project}/uploads?into=${id}`, 'forever.png')
  await call(w.t.ann, 'PATCH', `/api/files/${id}`, { body: attachment(pic, 'forever.png') })
  assert.equal((await call(w.t.ann, 'DELETE', `/api/files/${id}`)).status, 200)
  const binned = async (token: string) =>
    ((await call(token, 'GET', `/api/projects/${w.project}/files/deleted`)).body.files as { id: string }[] | undefined) ?? []
  /* Binned: we sees it in Recently Deleted, the manager does not. */
  assert.ok((await binned(w.t.ann)).some((f) => f.id === id))
  assert.equal(
    (await binned(tBoss)).some((f) => f.id === id || f.id === pic),
    false,
  )
  /* Nor can the manager take it out for good. */
  assert.equal((await call(tBoss, 'DELETE', `/api/files/${id}/forever`, { confirm: id })).status, 404)
  /* Ann does. */
  assert.equal((await call(w.t.ann, 'DELETE', `/api/files/${id}/forever`, { confirm: id })).status, 200)
  const [left] = await asTableOwner()<{ n: number }[]>`select count(*)::int as n from file where id in (${id}, ${pic})`
  assert.equal(left?.n, 0, 'the draft and its picture are gone for good, not binned')
  assert.equal(
    (await binned(tBoss)).some((f) => f.id === id || f.id === pic),
    false,
  )
  assert.equal((await call(tBoss, 'POST', `/api/files/${pic}/restore`)).status, 404)
  assert.equal((await call(w.t.ann, 'POST', `/api/files/${pic}/restore`)).status, 404)
  /* And purging it was told to nobody: no feed line, no webhook. */
  const [lines] = await asTableOwner()<{ n: number }[]>`
    select count(*)::int as n from activity_event where object_id in (${id}, ${pic})`
  assert.equal(lines?.n, 0)
  assert.deepEqual(await deliveries(w.owner.workspaceId, id), [])
  assert.deepEqual(await deliveries(w.owner.workspaceId, pic), [])
})

test('purging a document of chosen people writes no feed line and sends no webhook; purging the project’s does', async () => {
  const w = await studio()
  await asTableOwner()`
    insert into webhook (id, workspace_id, url, secret_enc, created_by)
    values (${uuidv7()}, ${w.owner.workspaceId}, 'https://example.com/hook', 'whs_x', ${w.owner.ctx.actorId})`
  const kept = await draft(w.t.ann, w.project, 'kept')
  await call(w.t.ann, 'PUT', `/api/files/${kept}/audience`, { audience: 'chosen', reader_ids: [w.ben.actorId] })
  const open = await draft(w.t.ann, w.project, 'open')
  await call(w.t.ann, 'PUT', `/api/files/${open}/audience`, { audience: 'project' })
  for (const id of [kept, open]) {
    assert.equal((await call(w.t.ann, 'DELETE', `/api/files/${id}`)).status, 200)
    assert.equal((await call(w.t.ann, 'DELETE', `/api/files/${id}/forever`, { confirm: id })).status, 200)
  }
  const purges = async (id: string) =>
    (
      await asTableOwner()<{ action: string }[]>`
        select action from activity_event where object_id = ${id} and action = 'file.purge'`
    ).length
  assert.equal(await purges(kept), 0)
  assert.equal((await deliveries(w.owner.workspaceId, kept)).includes('file.purge'), false)
  assert.equal(await purges(open), 1, 'the project’s document is said gone, as before')
})

/* ------------------------------------------------- what the fifth review found */

test('a file whose place says a document — as production has them — is seen as it was, and never goes with the document', async () => {
  const w = await studio()
  const seen = async (id: string) => ({
    cara: (await call(w.t.cara, 'GET', `/api/files/${id}/url`)).status,
    listed: Boolean(await listed(w.t.cara, w.project, id)),
    owner: (await call(w.t.owner, 'GET', `/api/files/${id}/url`)).status,
  })
  /* The exact write main's claimFiles made, from a comment on an upload. */
  const pdf = await upload(w.t.ann, `/api/projects/${w.project}/uploads`, 'spec.png')
  const shot = await upload(w.t.ben, `/api/projects/${w.project}/uploads`, 'zebrashot.png')
  const before = await seen(shot)
  await asTableOwner()`update file set origin_type = 'file', origin_id = ${pdf} where id = ${shot} and origin_type is null`
  assert.deepEqual(await seen(shot), before)
  assert.equal(await found(w.t.cara, 'zebrashot', shot), true)
  const [mr] = await withActor(w.ann.actorId, async (tx) => {
    await tx`select set_config('app.workspace_id', ${w.owner.workspaceId}, true)`
    return tx<{ ok: boolean }[]>`select may_read(${w.cara.actorId}, 'file'::object_kind, ${shot}) as ok`
  })
  assert.equal(mr?.ok, true)

  /* And from a comment on a document of the project, which is then narrowed and taken for good. */
  const d = (await call(w.t.ann, 'POST', `/api/projects/${w.project}/files`, { name: 'Ann notes', body: { type: 'doc', content: [] } }))
    .body.id as string
  const bens = await upload(w.t.ben, `/api/projects/${w.project}/uploads`, 'board-deck.png')
  await asTableOwner()`update file set origin_type = 'file', origin_id = ${d} where id = ${bens} and origin_type is null`
  const b0 = await seen(bens)
  assert.equal((await call(w.t.ann, 'PUT', `/api/files/${d}/audience`, { audience: 'chosen', reader_ids: [] })).status, 200)
  assert.deepEqual(await seen(bens), b0, 'narrowing the document changes nothing for it')
  await call(w.t.ann, 'DELETE', `/api/files/${d}`)
  assert.equal((await call(w.t.ann, 'DELETE', `/api/files/${d}/forever`, { confirm: d })).status, 200)
  const [still] = await asTableOwner()<{ n: number }[]>`select count(*)::int as n from file where id = ${bens} and deleted_at is null`
  assert.equal(still?.n, 1, 'never purged with the document')
  assert.deepEqual(await seen(bens), b0)

  /* And one whose first place was purged on main before the deploy. */
  const orphan = await upload(w.t.ben, `/api/projects/${w.project}/uploads`, 'orphan.png')
  await asTableOwner()`update file set origin_type = 'file', origin_id = ${uuidv7()} where id = ${orphan}`
  assert.equal((await call(w.t.cara, 'GET', `/api/files/${orphan}/url`)).status, 200)
})

test('a picture put in a document before it was private stays the project’s, and the panel says so', async () => {
  const w = await studio()
  const d = (await call(w.t.ann, 'POST', `/api/projects/${w.project}/files`, { name: 'Old doc', body: { type: 'doc', content: [] } })).body
    .id as string
  /* As every document on production was written: uploaded to the project, then put in the body. */
  const pic = await upload(w.t.ann, `/api/projects/${w.project}/uploads`, 'salary-table.png')
  const held = await upload(w.t.ann, `/api/projects/${w.project}/uploads?into=${d}`, 'held.png')
  await call(w.t.ann, 'PATCH', `/api/files/${d}`, {
    body: {
      type: 'doc',
      content: [
        { type: 'attachment', attrs: { fileId: pic, name: 'salary-table.png', kind: 'image' } },
        { type: 'attachment', attrs: { fileId: held, name: 'held.png', kind: 'image' } },
      ],
    },
  })
  assert.equal(((await call(w.t.ann, 'GET', `/api/files/${d}`)).body.file as { loose_files: number }).loose_files, 1)
  await call(w.t.ann, 'PUT', `/api/files/${d}/audience`, { audience: 'chosen', reader_ids: [] })
  assert.ok(await listed(w.t.cara, w.project, pic), 'the picture put in before stays in Docs')
  assert.equal(await listed(w.t.cara, w.project, held), undefined, 'the one it holds goes with it')
})

test('what was done in a document while it was kept stays its doer’s after it is published; webhooks carry no names', async () => {
  const w = await studio()
  await asTableOwner()`
    insert into webhook (id, workspace_id, url, secret_enc, created_by)
    values (${uuidv7()}, ${w.owner.workspaceId}, 'https://example.com/hook', 'whs_x', ${w.owner.ctx.actorId})`
  const d = await draft(w.t.ann, w.project, 'hush')
  await call(w.t.ann, 'PATCH', `/api/files/${d}`, { name: 'Hush v2' })
  await call(w.t.ann, 'PUT', `/api/files/${d}/audience`, { audience: 'chosen', reader_ids: [w.ben.actorId] })
  await call(w.t.ann, 'PUT', `/api/files/${d}/audience`, { audience: 'project' })
  assert.deepEqual(await inFeed(w.t.cara, w.project, d), ['file.access'], 'Cara sees that it became the project’s, nothing from before')
  assert.ok((await inFeed(w.t.ann, w.project, d)).length >= 4, 'Ann still sees her own lines')
  const sent = await asTableOwner()<{ p: Record<string, unknown> }[]>`
    select payload as p from webhook_delivery where workspace_id = ${w.owner.workspaceId} and payload->>'object_id' = ${d}`
  assert.equal(sent.length, 1)
  assert.equal(JSON.stringify(sent[0]?.p).includes(w.ben.actorId), false, 'who was chosen is not sent out')
  assert.equal(sent[0]?.p.removed, 1)
})

test('taking somebody off a document’s chosen people tells the project’s socket, the id alone', async () => {
  const w = await studio()
  const d = await draft(w.t.ann, w.project, 'fewer')
  await call(w.t.ann, 'PUT', `/api/files/${d}/audience`, { audience: 'chosen', reader_ids: [w.ben.actorId, w.cara.actorId] })
  const heard: { kind: string; id: unknown }[] = []
  const stop = await subscribe(`project:${w.project}`, (e) =>
    heard.push({ kind: e.kind, id: (e.payload as { object_id?: unknown }).object_id }),
  )
  try {
    await call(w.t.ann, 'PUT', `/api/files/${d}/audience`, { audience: 'chosen', reader_ids: [w.ben.actorId] })
    await pause(300)
    assert.ok(heard.some((h) => h.kind === 'file.hidden' && h.id === d))
  } finally {
    await stop()
  }
})

/* ------------------------------------------------- what the sixth review found */

test('a file of a room with chosen people: its lines are the room’s, not the project’s', async () => {
  const w = await studio()
  const room = await call(w.t.ann, 'POST', `/api/projects/${w.project}/conversations`, {
    name: `secret${uuidv7().slice(-4)}`,
    member_ids: [w.ann.actorId, w.ben.actorId],
  })
  assert.equal(room.status, 201, JSON.stringify(room.body))
  const f = await upload(w.t.ann, `/api/conversations/${room.body.id as string}/uploads`, 'secretroom.png')
  assert.equal((await call(w.t.ann, 'PATCH', `/api/files/${f}`, { name: 'renamed.png' })).status, 200)
  assert.ok((await inFeed(w.t.ben, w.project, f)).includes('file.update'), 'Ben, in the room, sees the rename')
  assert.deepEqual(await inFeed(w.t.cara, w.project, f), [], 'Cara, outside it, does not')
})

test('narrowing and publishing again: what the project read stays its own, what was done while kept stays with its readers', async () => {
  const w = await studio()
  const d = (await call(w.t.ann, 'POST', `/api/projects/${w.project}/files`, { name: 'Open', body: { type: 'doc', content: [] } })).body
    .id as string
  await call(w.t.ben, 'PATCH', `/api/files/${d}`, { name: 'Open by Ben' })
  assert.ok((await inFeed(w.t.cara, w.project, d)).includes('file.update'))
  await call(w.t.ann, 'PUT', `/api/files/${d}/audience`, { audience: 'chosen', reader_ids: [w.ben.actorId] })
  await call(w.t.ann, 'PATCH', `/api/files/${d}`, { name: 'Kept rename' })
  assert.ok((await inFeed(w.t.ben, w.project, d)).length >= 2, 'Ben, chosen, reads all of it')
  await call(w.t.ann, 'PUT', `/api/files/${d}/audience`, { audience: 'project' })
  const cara = await inFeed(w.t.cara, w.project, d)
  assert.equal(cara.filter((a) => a === 'file.update').length, 1, 'Ben’s edit from before, not the rename while kept')
  assert.ok(cara.includes('file.create'))
})

test('held_by is written once, by an upload into a document of the same project that is there; only ever cleared', async () => {
  const w = await twoProjects()
  const d = (await call(w.t.ann, 'POST', `/api/projects/${w.a}/files`, { name: 'D', body: { type: 'doc', content: [] } })).body.id as string
  const other = (await call(w.t.ann, 'POST', `/api/projects/${w.a}/files`, { name: 'E', body: { type: 'doc', content: [] } })).body
    .id as string
  const inB = (await call(w.t.ann, 'POST', `/api/projects/${w.b}/files`, { name: 'B', body: { type: 'doc', content: [] } })).body
    .id as string
  const pic = await upload(w.t.ann, `/api/projects/${w.a}/uploads?into=${d}`, 'p.png')
  const plain = await upload(w.t.ann, `/api/projects/${w.a}/uploads`, 'q.png')
  await assert.rejects(asTableOwner()`update file set held_by = ${other} where id = ${pic}`, 'moved to another document')
  await assert.rejects(asTableOwner()`update file set held_by = ${d} where id = ${plain}`, 'held after the fact')
  /* Cleared only by the clear-out, from inside its own trigger. */
  await assert.rejects(asTableOwner()`update file set held_by = null where id = ${pic}`, 'cleared by hand')
  const insert = (holder: string) => asTableOwner()`
    insert into file (id, workspace_id, project_id, author_id, name, storage_key, content_type, size_bytes, uploaded_at, held_by)
    values (${uuidv7()}, ${w.owner.workspaceId}, ${w.a}, ${w.ann.actorId}, 'x.png', ${`load/${uuidv7()}`}, 'image/png', 1, now(), ${holder})`
  await assert.rejects(insert(inB), 'a document of another project')
  await call(w.t.ann, 'DELETE', `/api/files/${other}`)
  await assert.rejects(insert(other), 'a document in the bin')
  /* Into a document in the bin, through the endpoint: not found. */
  const form = new FormData()
  form.append('file', new File([png], 'z.png', { type: 'image/png' }))
  const r = await app.request(`/api/projects/${w.a}/uploads?into=${other}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${w.t.ann}` },
    body: form,
  })
  assert.equal(r.status, 404)
})

test('loose_files counts only files no document holds; Recently Deleted says what goes with a kept document', async () => {
  const w = await studio()
  const d = await draft(w.t.ann, w.project, 'loose')
  const e = (await call(w.t.ann, 'POST', `/api/projects/${w.project}/files`, { name: 'E', body: { type: 'doc', content: [] } })).body
    .id as string
  const own = await upload(w.t.ann, `/api/projects/${w.project}/uploads?into=${d}`, 'own.png')
  const theirs = await upload(w.t.ann, `/api/projects/${w.project}/uploads?into=${e}`, 'theirs.png')
  const loose = await upload(w.t.ann, `/api/projects/${w.project}/uploads`, 'loose.png')
  await call(w.t.ann, 'PATCH', `/api/files/${d}`, {
    body: {
      type: 'doc',
      content: [attachment(own, 'a').content[0], attachment(theirs, 'b').content[0], attachment(loose, 'c').content[0]],
    },
  })
  assert.equal(((await call(w.t.ann, 'GET', `/api/files/${d}`)).body.file as { loose_files: number }).loose_files, 1)
  await call(w.t.ann, 'DELETE', `/api/files/${d}`)
  const bin = (await call(w.t.ann, 'GET', `/api/projects/${w.project}/files/deleted`)).body.files as { id: string; held_files?: number }[]
  assert.equal(bin.find((f) => f.id === d)?.held_files, 1)
})

/* ------------------------------------------------- what the seventh review found */

test('a held file is not read on a session with no workspace, but by its uploader', async () => {
  const w = await studio()
  const d = await draft(w.t.ann, w.project, 'no workspace')
  const pic = await upload(w.t.ann, `/api/projects/${w.project}/uploads?into=${d}`, 'secret.png')
  const rows = (actorId: string) =>
    withActor(actorId, (tx) => tx<{ id: string }[]>`select id from file where id in (${d}, ${pic})`).then((r) => r.map((x) => x.id))
  assert.deepEqual(await rows(w.cara.actorId), [], 'Cara, with no workspace on the session, reads neither')
  assert.ok((await rows(w.ann.actorId)).includes(pic), 'Ann, its uploader, reads her picture')
})

test('held_by: an upload cannot name a document its writer cannot read, and nobody but the clear-out clears it', async () => {
  const w = await studio()
  const d = await draft(w.t.ann, w.project, 'theirs')
  await call(w.t.ann, 'PUT', `/api/files/${d}/audience`, { audience: 'chosen', reader_ids: [w.ben.actorId] })
  const pic = await upload(w.t.ann, `/api/projects/${w.project}/uploads?into=${d}`, 'ann.png')
  const as =
    (actorId: string) =>
    <T>(fn: (tx: postgres.TransactionSql) => Promise<T>) =>
      withActor(actorId, async (tx) => {
        await tx`select set_config('app.workspace_id', ${w.owner.workspaceId}, true)`
        return fn(tx as unknown as postgres.TransactionSql)
      })
  /* Ben reads it and may not clear it. */
  await assert.rejects(as(w.ben.actorId)((tx) => tx`update file set held_by = null where id = ${pic}`))
  assert.equal((await call(w.t.cara, 'GET', `/api/files/${pic}/url`)).status, 404)
  /* Cara cannot attach a row to a draft she cannot read: told nothing more than not found. */
  await assert.rejects(
    as(w.cara.actorId)(
      (tx) => tx`
        insert into file (id, workspace_id, project_id, author_id, name, storage_key, content_type, size_bytes, uploaded_at, held_by)
        values (${uuidv7()}, ${w.owner.workspaceId}, ${w.project}, ${w.cara.actorId}, 'x.png', 'k/x', 'image/png', 1, now(), ${d})`,
    ),
    /No such document/,
  )
})

test('a workspace erased and put back keeps its documents’ people; somebody leaving still takes theirs', async () => {
  const w = await studio()
  const d = await draft(w.t.ann, w.project, 'erase')
  await call(w.t.ann, 'PUT', `/api/files/${d}/audience`, { audience: 'chosen', reader_ids: [w.ben.actorId, w.cara.actorId] })
  const readers = async () => (await asTableOwner()<{ n: number }[]>`select count(*)::int as n from file_reader where file_id = ${d}`)[0]?.n
  assert.equal(await readers(), 2)
  /* As delete_workspace erases it, and an operator puts it back — one moment for all of it. */
  await asTableOwner().begin(async (tx) => {
    const [at] = await tx<{ at: string }[]>`select now() as at`
    await tx`update workspace set deleted_at = ${at!.at} where id = ${w.owner.workspaceId}`
    await tx`update membership set deleted_at = ${at!.at} where workspace_id = ${w.owner.workspaceId} and deleted_at is null`
    await tx`update project_member set deleted_at = ${at!.at} where workspace_id = ${w.owner.workspaceId} and deleted_at is null`
  })
  assert.equal(await readers(), 2, 'the erase leaves them')
  await asTableOwner().begin(async (tx) => {
    const [ws] = await tx<{ at: string }[]>`select deleted_at as at from workspace where id = ${w.owner.workspaceId}`
    await tx`update workspace set deleted_at = null where id = ${w.owner.workspaceId}`
    await tx`update membership set deleted_at = null where workspace_id = ${w.owner.workspaceId} and deleted_at = ${ws!.at}`
    await tx`update project_member set deleted_at = null where workspace_id = ${w.owner.workspaceId} and deleted_at = ${ws!.at}`
  })
  assert.equal((await call(w.t.ben, 'GET', `/api/files/${d}`)).status, 200, 'Ben reads it again')
  /* Cara leaves the project on her own: her place goes. */
  await asTableOwner()`update project_member set deleted_at = now() where project_id = ${w.project} and actor_id = ${w.cara.actorId}`
  assert.equal(await readers(), 1)
})

test('an agent on the project may be chosen: Select all takes it, its token reads the document, and it goes when it leaves', async () => {
  const w = await studio()
  const id = await draft(w.t.ann, w.project, 'handed')
  /* What the panel draws: the project's list less the author — the people
     and, after them, the agent, which says whose it is. */
  const listedPeople = await call(w.t.ann, 'GET', `/api/projects/${w.project}/members`)
  const members = (listedPeople.body.members ?? []) as { actor_id: string; agent?: boolean; connected_by_name?: string | null }[]
  const scout = members.find((m) => m.actor_id === w.agentId)
  assert.ok(scout?.agent, 'the agent is on the list, marked')
  assert.equal(typeof scout?.connected_by_name, 'string', 'and says who connected it')
  assert.ok(
    members.every((m) => m.agent || m.connected_by_name === undefined),
    'a person carries no connector',
  )
  const everybody = members.filter((m) => m.actor_id !== w.ann.actorId).map((m) => m.actor_id)

  /* A picture in it, which follows it. */
  const pic = await upload(w.t.ann, `/api/projects/${w.project}/uploads?into=${id}`, 'handed.png')
  assert.equal((await call(w.t.ann, 'PATCH', `/api/files/${id}`, { body: attachment(pic, 'handed.png') })).status, 200)

  const r = await call(w.t.ann, 'PUT', `/api/files/${id}/audience`, { audience: 'chosen', reader_ids: everybody })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.deepEqual(new Set(r.body.reader_ids as string[]), new Set(everybody))

  /* The agent's token reads it, its picture and its list row — and still may
     not say who it is for. */
  assert.equal((await call(w.agentToken, 'GET', `/api/files/${id}`)).status, 200)
  assert.ok(await listed(w.agentToken, w.project, id))
  assert.equal((await call(w.agentToken, 'GET', `/api/files/${pic}/url`)).status, 200)
  assert.equal((await call(w.agentToken, 'PUT', `/api/files/${id}/audience`, { audience: 'project' })).status, 403)

  /* An agent on another project is not offered and is refused. */
  const other = await makeProject(w.owner.ctx, w.owner.workspaceId, 'Elsewhere')
  const away = await call(w.t.owner, 'POST', '/api/agents', { name: 'Away', project_ids: [other], reach: 'mcp' })
  assert.equal(away.status, 201, JSON.stringify(away.body))
  const refused = await call(w.t.ann, 'PUT', `/api/files/${id}/audience`, {
    audience: 'chosen',
    reader_ids: [...everybody, away.body.agent_id as string],
  })
  assert.equal(refused.status, 400)
  assert.equal((refused.body.error as { code: string }).code, 'not_on_project')

  /* Taken off the project, it loses the document and its picture. */
  const off = await call(w.t.owner, 'DELETE', `/api/projects/${w.project}/members/${w.agentId}`)
  assert.equal(off.status, 200, JSON.stringify(off.body))
  assert.equal((await call(w.agentToken, 'GET', `/api/files/${id}`)).status, 404)
  assert.equal((await call(w.agentToken, 'GET', `/api/files/${pic}/url`)).status, 404)
  const after = (await call(w.t.ann, 'GET', `/api/files/${id}`)).body.file as { reader_ids: string[] }
  assert.ok(!after.reader_ids.includes(w.agentId), 'its place on the document went with it')
})

test('a disconnected agent is no longer one of a document’s chosen people', async () => {
  const w = await studio()
  const id = await draft(w.t.ann, w.project, 'unplugged')
  const r = await call(w.t.ann, 'PUT', `/api/files/${id}/audience`, { audience: 'chosen', reader_ids: [w.agentId] })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal((await call(w.agentToken, 'GET', `/api/files/${id}`)).status, 200)

  const gone = await call(w.t.owner, 'DELETE', `/api/agents/${w.agentId}`)
  assert.equal(gone.status, 200, JSON.stringify(gone.body))
  const after = (await call(w.t.ann, 'GET', `/api/files/${id}`)).body.file as { reader_ids: string[] }
  assert.deepEqual(after.reader_ids, [])
  /* And it cannot be chosen again. */
  const again = await call(w.t.ann, 'PUT', `/api/files/${id}/audience`, { audience: 'chosen', reader_ids: [w.agentId] })
  assert.equal(again.status, 400)
})
