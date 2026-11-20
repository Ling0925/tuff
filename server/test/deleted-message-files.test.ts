import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { app } from '../src/http/routes.js'
import { issueApiToken } from '../src/auth/flows.js'
import { closeRealtime } from '../src/realtime.js'
import { addPerson, asTableOwner, asWorker, bearerFor, closeDb, makeOwner, makeProject, stamp } from './helpers.js'

after(async () => {
  await closeRealtime()
  await closeDb()
})

/*
 * A deleted message takes the files it brought;
 * The seventh audit.
 * Its attachments stayed in the project's Docs, in search and
 * behind `/url`, to people who joined after, and were never cleared out.
 */

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

async function call(method: string, path: string, token: string, body?: unknown) {
  const r = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const text = await r.text()
  return { status: r.status, body: (text ? JSON.parse(text) : {}) as Record<string, unknown> }
}

async function upload(path: string, token: string, name: string): Promise<string> {
  const form = new FormData()
  form.set('file', new File([Buffer.from(PNG, 'base64')], name, { type: 'image/png' }))
  const r = await app.request(path, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form })
  assert.equal(r.status, 201)
  return ((await r.json()) as { id: string }).id
}

const attachment = (fileId: string, name: string) => ({ type: 'attachment', attrs: { fileId, name, kind: 'image' } })

async function seen(token: string, project: string, fileId: string, word: string) {
  const url = await call('GET', `/api/files/${fileId}/url`, token)
  const one = await call('GET', `/api/files/${fileId}`, token)
  const list = await call('GET', `/api/projects/${project}/files`, token)
  const search = await call('GET', `/api/search?q=${word}`, token)
  return {
    url: url.status,
    file: one.status,
    listed: ((list.body.files ?? []) as { id: string }[]).some((f) => f.id === fileId),
    searched: JSON.stringify(search.body).includes(fileId),
  }
}

test('a deleted message’s attachment goes with it, for everyone, and comes back from the bin', async () => {
  const o = await makeOwner()
  const P = await makeProject(o.ctx, o.workspaceId, 'Shared')
  const ben = await addPerson(o.ctx, o.workspaceId, 'member', [P])
  const ann = await addPerson(o.ctx, o.workspaceId, 'member', [P])
  const benB = await bearerFor(ben.actorId, o.workspaceId)
  const annB = await bearerFor(ann.actorId, o.workspaceId)
  const annTok = await issueApiToken(ann.actorId, o.workspaceId, 'ann tool')
  const room = await call('POST', `/api/projects/${P}/conversations`, benB, { name: `main-${stamp().slice(-5)}` })
  assert.equal(room.status, 201, JSON.stringify(room.body))
  const main = room.body.id as string

  const word = `shown${stamp().slice(-6)}`
  const fileId = await upload(`/api/conversations/${main}/uploads`, benB, `${word}.png`)
  /* And one that was in the project's Docs first, shown in the same message:
     it was not the message's to take. */
  const docsWord = `kept${stamp().slice(-6)}`
  const docsFile = await upload(`/api/projects/${P}/uploads`, benB, `${docsWord}.png`)
  const said = await call('POST', `/api/conversations/${main}/messages`, benB, {
    body: { type: 'doc', content: [attachment(fileId, `${word}.png`), attachment(docsFile, `${docsWord}.png`)] },
  })
  assert.equal(said.status, 201, JSON.stringify(said.body))
  const mid = said.body.id as string
  assert.deepEqual(await seen(annB, P, fileId, word), { url: 200, file: 200, listed: true, searched: true })

  assert.equal((await call('DELETE', `/api/messages/${mid}`, benB)).status, 200)

  const gone = { url: 404, file: 404, listed: false, searched: false }
  assert.deepEqual(await seen(annB, P, fileId, word), gone)
  const content = await app.request(`/api/files/${fileId}/content`, { headers: { authorization: `Bearer ${annTok}` } })
  assert.equal(content.status, 404)
  // Somebody who joins after it was taken back.
  const cal = await addPerson(o.ctx, o.workspaceId, 'member', [P])
  assert.deepEqual(await seen(await bearerFor(cal.actorId, o.workspaceId), P, fileId, word), gone)
  // What was in Docs first stays where it was.
  assert.deepEqual(await seen(annB, P, docsFile, docsWord), { url: 200, file: 200, listed: true, searched: true })

  // Deleted in the same moment as the message, by the same person: the clear-out takes both together.
  const owner = asTableOwner()
  const [m] = await owner<{ deleted_at: Date }[]>`select deleted_at from message where id = ${mid}`
  const [f] = await owner<
    { deleted_at: Date | null; deleted_by: string | null }[]
  >`select deleted_at, deleted_by from file where id = ${fileId}`
  assert.ok(f?.deleted_at)
  assert.equal(f.deleted_at.getTime(), m!.deleted_at.getTime())
  assert.equal(f.deleted_by, ben.actorId)
  // And the feed says it went, as a delete in Docs does.
  const [line] = await owner`select 1 from activity_event where action = 'file.delete' and object_id = ${fileId}`
  assert.ok(line)

  // The bin offers it back to whoever deleted it — and only to them.
  const bin = await call('GET', `/api/projects/${P}/files/deleted`, benB)
  assert.equal(bin.status, 200, JSON.stringify(bin.body))
  assert.ok(JSON.stringify(bin.body).includes(fileId))
  assert.equal((await call('POST', `/api/files/${fileId}/restore`, annB)).status, 403)
  assert.equal((await call('POST', `/api/files/${fileId}/restore`, benB)).status, 200)
  assert.equal((await call('GET', `/api/files/${fileId}/url`, annB)).status, 200)
})

test('the clear-out takes a deleted message’s files with it', async () => {
  const o = await makeOwner()
  const P = await makeProject(o.ctx, o.workspaceId, 'Purged')
  const room = await call('POST', `/api/projects/${P}/conversations`, o.token, { name: `purge-${stamp().slice(-5)}` })
  assert.equal(room.status, 201)
  const fileId = await upload(`/api/conversations/${room.body.id as string}/uploads`, o.token, 'gone.png')
  const said = await call('POST', `/api/conversations/${room.body.id as string}/messages`, o.token, {
    body: { type: 'doc', content: [attachment(fileId, 'gone.png')] },
  })
  assert.equal(said.status, 201)
  const mid = said.body.id as string
  assert.equal((await call('DELETE', `/api/messages/${mid}`, o.token)).status, 200)

  /* Ten years, not thirty-one days: the tests share the development
     database, and a clear-out at thirty days would take whatever else is there. */
  const owner = asTableOwner()
  await owner`update message set deleted_at = now() - interval '10 years 7 days' where id = ${mid}`
  await owner`update file set deleted_at = now() - interval '10 years 7 days' where id = ${fileId}`
  await asWorker((tx) => tx`select purge_deleted(3653)`)
  const [m] = await owner`select id from message where id = ${mid}`
  const [f] = await owner`select id from file where id = ${fileId}`
  assert.equal(m, undefined)
  assert.equal(f, undefined, 'the attachment’s row went with the message’s')
})

/*
 * A message is the place only of what its writer sent into its room — the
 * review of. Any file with no place yet was taken by any message
 * naming its id, and `file.upload` in the feed says the id before its
 * uploader presses send: Mallory named Alice's picture in a message of her
 * own, deleted that message, and Alice's picture went with it — for good in
 * a direct conversation, which has no bin.
 */
for (const where of ['a project’s room', 'a direct conversation']) {
  test(`in ${where}, deleting a message never takes somebody else’s upload it named`, async () => {
    const o = await makeOwner()
    const P = await makeProject(o.ctx, o.workspaceId, 'Shared')
    const alice = await addPerson(o.ctx, o.workspaceId, 'member', [P])
    const mal = await addPerson(o.ctx, o.workspaceId, 'member', [P])
    const aB = await bearerFor(alice.actorId, o.workspaceId)
    const mB = await bearerFor(mal.actorId, o.workspaceId)
    const room =
      where === 'a project’s room'
        ? await call('POST', `/api/projects/${P}/conversations`, aB, { name: `r-${stamp().slice(-5)}` })
        : await call('POST', '/api/conversations/direct', aB, { actor_ids: [mal.actorId] })
    assert.ok(room.status === 200 || room.status === 201, JSON.stringify(room.body))
    const id = room.body.id as string
    const fileId = await upload(`/api/conversations/${id}/uploads`, aB, 'alice.png')

    // Mallory names it first, in a message of hers; then Alice sends hers.
    const hers = await call('POST', `/api/conversations/${id}/messages`, mB, {
      body: { type: 'doc', content: [attachment(fileId, 'x.png')] },
    })
    assert.equal(hers.status, 201)
    const alices = await call('POST', `/api/conversations/${id}/messages`, aB, {
      body: { type: 'doc', content: [attachment(fileId, 'x.png')] },
    })
    assert.equal(alices.status, 201)
    const [placed] = await asTableOwner()<{ origin_id: string | null }[]>`select origin_id from file where id = ${fileId}`
    assert.equal(placed?.origin_id, alices.body.id, 'the place is the uploader’s own message')

    assert.equal((await call('DELETE', `/api/messages/${hers.body.id as string}`, mB)).status, 200)
    assert.equal((await call('GET', `/api/files/${fileId}/url`, aB)).status, 200, 'Alice’s picture survives')
    // And it still goes with Alice's own message.
    assert.equal((await call('DELETE', `/api/messages/${alices.body.id as string}`, aB)).status, 200)
    assert.equal((await call('GET', `/api/files/${fileId}/url`, aB)).status, 404)
  })
}

test('somebody who deletes another’s message leaves its files where they are', async () => {
  const o = await makeOwner()
  const P = await makeProject(o.ctx, o.workspaceId, 'Moderated')
  const ben = await addPerson(o.ctx, o.workspaceId, 'member', [P])
  const benB = await bearerFor(ben.actorId, o.workspaceId)
  const room = await call('POST', `/api/projects/${P}/conversations`, benB, { name: `m-${stamp().slice(-5)}` })
  assert.equal(room.status, 201)
  const fileId = await upload(`/api/conversations/${room.body.id as string}/uploads`, benB, 'ben.png')
  const said = await call('POST', `/api/conversations/${room.body.id as string}/messages`, benB, {
    body: { type: 'doc', content: [attachment(fileId, 'ben.png')] },
  })
  assert.equal(said.status, 201)
  // The owner may delete anybody's message in a project's room — the message, not what Ben uploaded.
  assert.equal((await call('DELETE', `/api/messages/${said.body.id as string}`, o.token)).status, 200)
  assert.equal((await call('GET', `/api/files/${fileId}/url`, benB)).status, 200)
  const [f] = await asTableOwner()<{ deleted_at: Date | null }[]>`select deleted_at from file where id = ${fileId}`
  assert.equal(f?.deleted_at, null)
})
