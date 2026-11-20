import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { closeDb, withActor, uuidv7, makeOwner, addPerson, makeProject, bearerFor } from './helpers.js'
import { app } from '../src/http/routes.js'
import { closeRealtime } from '../src/realtime.js'

/*
 * Narrowing what was said: from
 * one person, with a link, with a file, in threads, oldest first; words
 * may be left out once one of them is on.
 */

after(async () => {
  await closeRealtime()
  await closeDb()
})

type Hit = { type: string; id: string; parent_id: string | null; author_name: string }

async function search(token: string, query: Record<string, string>): Promise<Hit[]> {
  const r = await app.request(`/api/search?${new URLSearchParams(query)}`, { headers: { authorization: `Bearer ${token}` } })
  assert.equal(r.status, 200)
  return ((await r.json()) as { results: Hit[] }).results
}

const para = (content: unknown[]) => ({ type: 'paragraph', content })

async function world() {
  const { ctx, workspaceId, token } = await makeOwner()
  const p = await makeProject(ctx, workspaceId, 'Acme')
  const lee = await addPerson(ctx, workspaceId, 'member', [p])
  const room = uuidv7()
  await withActor(
    ctx.actorId,
    (tx) =>
      tx`insert into conversation (id, workspace_id, project_id, name, channel) values (${room}, ${workspaceId}, ${p}, 'general', true)`,
  )
  let at = Date.parse('2026-01-01T10:00:00Z')
  const say = async (who: string, content: unknown[], parent: string | null = null) => {
    const id = uuidv7()
    at += 60_000
    await withActor(
      who,
      (tx) => tx`
      insert into message (id, workspace_id, conversation_id, author_id, parent_id, body, created_at)
      values (${id}, ${workspaceId}, ${room}, ${who}, ${parent}, ${tx.json({ type: 'doc', content } as never)}, ${new Date(at)})`,
    )
    return id
  }
  const plain = await say(ctx.actorId, [para([{ type: 'text', text: 'quokka plans for the launch' }])])
  const linked = await say(lee.actorId, [para([{ type: 'text', text: 'quokka notes at https://example.com/notes' }])])
  const marked = await say(ctx.actorId, [
    para([{ type: 'text', text: 'quokka doc', marks: [{ type: 'link', attrs: { href: 'https://x.example' } }] }]),
  ])
  const filed = await say(lee.actorId, [
    para([{ type: 'text', text: 'quokka picture' }]),
    { type: 'attachment', attrs: { fileId: uuidv7(), name: 'q.png' } },
  ])
  const reply = await say(lee.actorId, [para([{ type: 'text', text: 'quokka in a thread' }])], plain)
  return { ctx, workspaceId, token, lee, room, ids: { plain, linked, marked, filed, reply } }
}

test('from one person, with a link, with a file, in threads', async () => {
  const { token, lee, ids } = await world()
  const all = await search(token, { q: 'quokka', type: 'message' })
  assert.equal(all.length, 5)

  const fromLee = await search(token, { q: 'quokka', type: 'message', from: lee.actorId })
  assert.deepEqual(fromLee.map((h) => h.id).sort(), [ids.linked, ids.filed, ids.reply].sort())

  const links = await search(token, { q: 'quokka', type: 'message', has: 'link' })
  assert.deepEqual(links.map((h) => h.id).sort(), [ids.linked, ids.marked].sort())

  const files = await search(token, { q: 'quokka', type: 'message', has: 'file' })
  assert.deepEqual(
    files.map((h) => h.id),
    [ids.filed],
  )

  const threads = await search(token, { q: 'quokka', type: 'message', in: 'thread' })
  assert.deepEqual(
    threads.map((h) => h.id),
    [ids.reply],
  )

  /* Together, they narrow together. */
  const both = await search(token, { q: 'quokka', type: 'message', from: lee.actorId, has: 'link' })
  assert.deepEqual(
    both.map((h) => h.id),
    [ids.linked],
  )
  for (const h of [...fromLee, ...links, ...files, ...threads]) assert.equal(h.type, 'message')
})

test('newest first, or oldest first', async () => {
  const { token, ids } = await world()
  const newest = await search(token, { q: 'quokka', type: 'message' })
  const oldest = await search(token, { q: 'quokka', type: 'message', sort: 'oldest' })
  assert.equal(newest[0]!.id, ids.reply)
  assert.equal(oldest[0]!.id, ids.plain)
  assert.deepEqual(
    oldest.map((h) => h.id),
    newest.map((h) => h.id).reverse(),
  )
})

test('words may be left out once something narrows; never without', async () => {
  const { token, lee, ids } = await world()
  assert.deepEqual(await search(token, { q: '', type: 'message' }), [])
  assert.deepEqual(await search(token, { q: 'qu', type: 'message', sort: 'oldest' }), [])
  const files = await search(token, { q: '', type: 'message', has: 'file' })
  assert.deepEqual(
    files.map((h) => h.id),
    [ids.filed],
  )
  const fromLee = await search(token, { type: 'message', from: lee.actorId })
  assert.equal(fromLee.length, 3)
})

test('narrowing finds nothing outside the rooms the asker may read, nor in another company', async () => {
  const { ctx, workspaceId, lee } = await world()
  const outsider = await addPerson(ctx, workspaceId, 'member', [await makeProject(ctx, workspaceId, 'Other')])
  const outsiderToken = await bearerFor(outsider.actorId, workspaceId)
  assert.deepEqual(await search(outsiderToken, { q: 'quokka', type: 'message', from: lee.actorId }), [])
  assert.deepEqual(await search(outsiderToken, { type: 'message', has: 'link' }), [])
  const stranger = await makeOwner()
  assert.deepEqual(await search(stranger.token, { type: 'message', from: lee.actorId }), [])
  assert.deepEqual(await search(stranger.token, { type: 'message', in: 'thread' }), [])
})

test('a person or a project that is not an id is refused, not searched', async () => {
  const { token } = await world()
  const r = await app.request('/api/search?q=quokka&type=message&from=nobody', { headers: { authorization: `Bearer ${token}` } })
  assert.equal(r.status, 400)
})
