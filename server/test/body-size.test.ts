import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { app } from '../src/http/routes.js'
import { BODY_MOST } from '../src/http/body.js'
import { COMMENTS_MOST, COMMENT_BYTES_MOST } from '../src/http/objects.js'
import { MESSAGE_BYTES_MOST } from '../src/http/chat.js'
import { asTableOwner, closeDb, makeOwner, makeProject, uuidv7 } from './helpers.js'

after(async () => {
  await closeDb()
})

/*
 * How much one body may weigh, and how much one answer carries of many —
 * finding 5. Four hundred comments of
 * five megabytes on one task made `GET /api/tasks/:id` an answer of
 * gigabytes, and the process went down building it.
 */
const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
const call =
  (token: string) =>
  (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
    app.request(path, {
      method,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })

test('a body past its ceiling is 413 too_large, said in the reader’s language', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const p = await makeProject(ctx, workspaceId, 'Studio')
  const req = call(token)
  const made = await req('POST', `/api/projects/${p}/tasks`, { title: 'One', body: doc('Fine.') })
  assert.equal(made.status, 201)
  const { id } = (await made.json()) as { id: string }

  // A comment: up to its ceiling, and not past it.
  assert.equal((await req('POST', `/api/tasks/${id}/comments`, { body: doc('x'.repeat(BODY_MOST.said - 1024)) })).status, 201)
  const long = await req('POST', `/api/tasks/${id}/comments`, { body: doc('x'.repeat(BODY_MOST.said)) })
  assert.equal(long.status, 413)
  const said = (await long.json()) as { error: { code: string; message: string } }
  assert.equal(said.error.code, 'too_large')
  assert.match(said.error.message, /too long to send/)
  const fr = await req('POST', `/api/tasks/${id}/comments`, { body: doc('x'.repeat(BODY_MOST.said)) }, { 'x-tongue': 'fr' })
  assert.match(((await fr.json()) as { error: { message: string } }).error.message, /trop long/)

  // A task's description: a page, larger, and still bounded.
  assert.equal((await req('PATCH', `/api/tasks/${id}`, { body: doc('y'.repeat(BODY_MOST.said * 2)) })).status, 200)
  const page = await req('PATCH', `/api/tasks/${id}`, { body: doc('y'.repeat(BODY_MOST.page)) })
  assert.equal(page.status, 413)
  assert.match(((await page.json()) as { error: { message: string } }).error.message, /too long to save/)
  assert.equal((await req('POST', `/api/projects/${p}/tasks`, { title: 'Two', body: doc('y'.repeat(BODY_MOST.page)) })).status, 413)
  assert.equal((await req('POST', `/api/projects/${p}/posts`, { title: 'News', body: doc('y'.repeat(BODY_MOST.page)) })).status, 413)

  // A message, sent and changed.
  const room = (await (await req('POST', `/api/projects/${p}/conversations`, { name: 'room' })).json()) as { id: string }
  assert.equal((await req('POST', `/api/conversations/${room.id}/messages`, { body: doc('z'.repeat(BODY_MOST.said)) })).status, 413)
  const ok = await req('POST', `/api/conversations/${room.id}/messages`, { body: doc('Hello.') })
  assert.equal(ok.status, 201)
  const message = (await ok.json()) as { id: string }
  assert.equal((await req('PATCH', `/api/messages/${message.id}`, { body: doc('z'.repeat(BODY_MOST.said)) })).status, 413)
})

test('a read carries the newest comments up to a count and a weight, and the rest are a page away', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const p = await makeProject(ctx, workspaceId, 'Studio')
  const req = call(token)
  const { id } = (await (await req('POST', `/api/projects/${p}/tasks`, { title: 'Busy' })).json()) as { id: string }

  // Written straight in, as many as a page and five more, a second apart.
  const owner = asTableOwner()
  const many = COMMENTS_MOST + 5
  await owner`
    insert into comment (id, workspace_id, project_id, object_type, object_id, author_id, body, origin, created_at)
    select gen_random_uuid(), ${workspaceId}, ${p}, 'task', ${id}, ${ctx.actorId},
           jsonb_build_object('type', 'doc', 'content', jsonb_build_array(jsonb_build_object('type', 'paragraph',
             'content', jsonb_build_array(jsonb_build_object('type', 'text', 'text', 'c' || n))))),
           'web', now() - make_interval(secs => ${many} - n)
    from generate_series(1, ${many}) n`

  type Said = { id: string; body: { content: { content: { text: string }[] }[] } }
  const text = (c: Said) => c.body.content[0]!.content[0]!.text
  const read = (await (await req('GET', `/api/tasks/${id}`)).json()) as { comments: Said[]; comments_earlier: string | null }
  assert.equal(read.comments.length, COMMENTS_MOST)
  assert.equal(text(read.comments[0]!), 'c6', 'oldest first, and the newest kept')
  assert.equal(text(read.comments.at(-1)!), `c${many}`)
  assert.ok(read.comments_earlier)

  const before = (await (await req('GET', `/api/tasks/${id}/comments?before=${encodeURIComponent(read.comments_earlier!)}`)).json()) as {
    comments: Said[]
    next_cursor: string | null
  }
  assert.deepEqual(before.comments.map(text), ['c1', 'c2', 'c3', 'c4', 'c5'])
  assert.equal(before.next_cursor, null)
  assert.equal((await req('GET', `/api/tasks/${id}/comments?before=nonsense`)).status, 400)
  assert.equal((await req('GET', `/api/tasks/${uuidv7()}/comments`)).status, 404)

  // And by weight: comments near the ceiling stop the page at 4 MB.
  const { id: heavy } = (await (await req('POST', `/api/projects/${p}/tasks`, { title: 'Heavy' })).json()) as { id: string }
  const big = 'w'.repeat(BODY_MOST.said - 1024)
  await owner`
    insert into comment (id, workspace_id, project_id, object_type, object_id, author_id, body, origin, created_at)
    select gen_random_uuid(), ${workspaceId}, ${p}, 'task', ${heavy}, ${ctx.actorId},
           jsonb_build_object('type', 'doc', 'content', jsonb_build_array(jsonb_build_object('type', 'paragraph',
             'content', jsonb_build_array(jsonb_build_object('type', 'text', 'text', ${big}::text))))),
           'web', now() - make_interval(secs => 60 - n)
    from generate_series(1, 60) n`
  const r = await req('GET', `/api/tasks/${heavy}`)
  const weighed = (await r.json()) as { comments: Said[]; comments_earlier: string | null }
  assert.ok(weighed.comments.length < 60 && weighed.comments.length >= 30, `${weighed.comments.length} carried`)
  assert.ok(JSON.stringify(weighed.comments).length < COMMENT_BYTES_MOST + BODY_MOST.said * 2)
  assert.ok(weighed.comments_earlier)

  // An announcement and a document answer the same way.
  const post = (await (await req('POST', `/api/projects/${p}/posts`, { title: 'News', body: doc('Hi.') })).json()) as { id: string }
  const postRead = (await (await req('GET', `/api/posts/${post.id}`)).json()) as { comments_earlier: string | null }
  assert.equal(postRead.comments_earlier, null)
  assert.equal((await req('GET', `/api/posts/${post.id}/comments`)).status, 200)
})

test('a page of messages carries no more than its weight, and the cursor goes on from where it stopped', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const p = await makeProject(ctx, workspaceId, 'Studio')
  const req = call(token)
  const room = (await (await req('POST', `/api/projects/${p}/conversations`, { name: 'heavy' })).json()) as { id: string }
  const owner = asTableOwner()
  const big = 'm'.repeat(BODY_MOST.said - 1024)
  /* Written straight in, as rows from before the ceiling would be. */
  await owner`
    insert into message (id, workspace_id, conversation_id, author_id, body, origin, created_at)
    select gen_random_uuid(), ${workspaceId}, ${room.id}, ${ctx.actorId},
           jsonb_build_object('type', 'doc', 'content', jsonb_build_array(jsonb_build_object('type', 'paragraph',
             'content', jsonb_build_array(jsonb_build_object('type', 'text', 'text', ${big}::text))))),
           'web', now() - make_interval(secs => 60 - n)
    from generate_series(1, 60) n`
  const seen = new Set<string>()
  let cursor: string | null = null
  let pages = 0
  do {
    const r = await req('GET', `/api/conversations/${room.id}/messages?limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`)
    const text = await r.text()
    assert.ok(text.length < MESSAGE_BYTES_MOST + BODY_MOST.said * 2, `a page of ${text.length}`)
    const page = JSON.parse(text) as { messages: { id: string }[]; next_cursor: string | null }
    for (const m of page.messages) seen.add(m.id)
    cursor = page.next_cursor
    pages++
  } while (cursor && pages < 10)
  assert.equal(seen.size, 60, 'every message, on some page')

  /* Messages written in one moment are neither skipped nor repeated
     across a page's edge: the cursor is the moment and the id. */
  const same = (await (await req('POST', `/api/projects/${p}/conversations`, { name: 'same' })).json()) as { id: string }
  await owner`
    insert into message (id, workspace_id, conversation_id, author_id, body, origin, created_at)
    select gen_random_uuid(), ${workspaceId}, ${same.id}, ${ctx.actorId}, ${owner.json(doc('tick') as never)}, 'web', '2026-11-01T00:00:00Z'
    from generate_series(1, 7)`
  const ids: string[] = []
  let at: string | null = null
  for (let i = 0; i < 10; i++) {
    const r = (await (
      await req('GET', `/api/conversations/${same.id}/messages?limit=3${at ? `&cursor=${encodeURIComponent(at)}` : ''}`)
    ).json()) as { messages: { id: string }[]; next_cursor: string | null }
    ids.push(...r.messages.map((m) => m.id))
    at = r.next_cursor
    if (!at) break
  }
  assert.equal(new Set(ids).size, 7)
  assert.equal(ids.length, 7)
  assert.ok(pages >= 2)
})

test('the database refuses a said body far past the ceiling, whoever writes it', async () => {
  const { ctx, workspaceId } = await makeOwner()
  const p = await makeProject(ctx, workspaceId, 'Studio')
  await assert.rejects(
    asTableOwner()`
      insert into comment (id, workspace_id, project_id, object_type, object_id, author_id, body, origin)
      values (${uuidv7()}, ${workspaceId}, ${p}, 'task', ${uuidv7()}, ${ctx.actorId},
              ${asTableOwner().json(doc('x'.repeat(600_000)) as never)}, 'web')`,
    /too_large/,
  )
})
