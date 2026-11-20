import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { app } from '../src/http/routes.js'
import { addPerson, bearerFor, closeDb, withActor, uuidv7, makeOwner, makeProject } from './helpers.js'

after(async () => {
  await closeDb()
})

async function call(path: string, token: string, init: { method?: string; body?: unknown } = {}) {
  const r = await app.request(path, {
    method: init.method ?? 'GET',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  })
  return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, unknown> }
}

async function task(ownerId: string, ws: string, project: string, title: string) {
  const id = uuidv7()
  await withActor(ownerId, async (tx) => {
    await tx`
      insert into task (id, workspace_id, project_id, author_id, title, sort_key)
      values (${id}, ${ws}, ${project}, ${ownerId}, ${title}, 'a0')`
  })
  return id
}

const line = (text: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
})

/*
 * A comment could be made and never touched again: a typo stood for ever and
 * a line sent to the wrong task stayed on it.
 */
test('a comment is changed and withdrawn by whoever wrote it', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const project = await makeProject(ctx, workspaceId, 'Acme')
  const t = await task(ctx.actorId, workspaceId, project, 'The work')

  const made = await call(`/api/tasks/${t}/comments`, token, {
    method: 'POST',
    body: { body: line('Frist go') },
  })
  const id = made.body.id as string

  const before = (await call(`/api/tasks/${t}`, token)).body.comments as {
    edited_at: string | null
  }[]
  // Null until somebody has actually changed it, so the screen does not have
  // to compare two timestamps and decide what counts as a change.
  assert.equal(before[0]?.edited_at, null)

  const fixed = await call(`/api/comments/${id}`, token, {
    method: 'PATCH',
    body: { body: line('First go') },
  })
  assert.equal(fixed.status, 200)

  const after_ = (await call(`/api/tasks/${t}`, token)).body.comments as {
    body: { content: { content: { text: string }[] }[] }
    edited_at: string | null
  }[]
  assert.equal(after_[0]?.body.content[0]?.content[0]?.text, 'First go')
  assert.ok(after_[0]?.edited_at, 'an edit says so')

  const gone = await call(`/api/comments/${id}`, token, { method: 'DELETE' })
  assert.equal(gone.status, 200)
  assert.deepEqual((await call(`/api/tasks/${t}`, token)).body.comments, [])

  // Soft, like everything else: the row is there for the clear-out.
  const left = await withActor(ctx.actorId, (tx) => tx<{ n: number }[]>`select count(*)::int as n from comment where id = ${id}`)
  assert.equal(left[0]?.n, 1)
})

test("somebody else's words need the right that says so", async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const project = await makeProject(ctx, workspaceId, 'Acme')
  const t = await task(ctx.actorId, workspaceId, project, 'The work')

  // A plain member of the project. The workspace default is that editing
  // somebody else's content is not theirs.
  const sam = await addPerson(ctx, workspaceId, 'member', [project])
  const samToken = await bearerFor(sam.actorId, workspaceId)

  const mine = await call(`/api/tasks/${t}/comments`, token, {
    method: 'POST',
    body: { body: line('Said by the owner') },
  })
  const theirs = await call(`/api/tasks/${t}/comments`, samToken, {
    method: 'POST',
    body: { body: line('Said by Sam') },
  })

  // They can see it — this is not a 404, they are on the project.
  assert.equal((await call(`/api/tasks/${t}`, samToken)).status, 200)
  assert.equal(
    (
      await call(`/api/comments/${mine.body.id as string}`, samToken, {
        method: 'PATCH',
        body: { body: line('Rewritten') },
      })
    ).status,
    403,
  )
  // Deleting is not given a stronger right than editing: anybody who can
  // rewrite a sentence into nothing has already deleted it.
  assert.equal((await call(`/api/comments/${mine.body.id as string}`, samToken, { method: 'DELETE' })).status, 403)

  // Their own, though, is theirs.
  assert.equal(
    (
      await call(`/api/comments/${theirs.body.id as string}`, samToken, {
        method: 'PATCH',
        body: { body: line('Said by Sam, better') },
      })
    ).status,
    200,
  )
  // And the owner may change anybody's.
  assert.equal((await call(`/api/comments/${theirs.body.id as string}`, token, { method: 'DELETE' })).status, 200)
})

test('a comment in a project you are not on is not there at all', async () => {
  const mine = await makeOwner()
  const theirs = await makeOwner()
  const project = await makeProject(theirs.ctx, theirs.workspaceId, 'Theirs')
  const t = await task(theirs.ctx.actorId, theirs.workspaceId, project, 'Their work')
  const made = await call(`/api/tasks/${t}/comments`, theirs.token, {
    method: 'POST',
    body: { body: line('Said elsewhere') },
  })

  // 404 and not 403: that the row exists is information about somebody else.
  const tried = await call(`/api/comments/${made.body.id as string}`, mine.token, {
    method: 'DELETE',
  })
  assert.equal(tried.status, 404)
})

/**
 * A comment can answer another — one level deep, and only on the same thing.
 * `docs/specs/comments.md`.
 */
test('a reply names the comment it answers, and a reply to a reply answers the same one', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const project = await makeProject(ctx, workspaceId, 'Threads')
  const t = await task(ctx.actorId, workspaceId, project, 'Talked about')
  const other = await task(ctx.actorId, workspaceId, project, 'Elsewhere')

  const top = await call(`/api/tasks/${t}/comments`, token, { method: 'POST', body: { body: line('First') } })
  const reply = await call(`/api/tasks/${t}/comments`, token, {
    method: 'POST',
    body: { body: line('Answer'), parent_id: top.body.id },
  })
  assert.equal(reply.status, 201)
  const again = await call(`/api/tasks/${t}/comments`, token, {
    method: 'POST',
    body: { body: line('Answer to the answer'), parent_id: reply.body.id },
  })
  assert.equal(again.status, 201)

  const read = await call(`/api/tasks/${t}`, token)
  const said = read.body.comments as { id: string; parent_id: string | null }[]
  assert.equal(said.find((c) => c.id === top.body.id)!.parent_id, null)
  assert.equal(said.find((c) => c.id === reply.body.id)!.parent_id, top.body.id)
  // Flattened to one level: it answers the thread's comment, not the reply.
  assert.equal(said.find((c) => c.id === again.body.id)!.parent_id, top.body.id)

  // A reply cannot answer a comment on something else.
  const hop = await call(`/api/tasks/${other}/comments`, token, {
    method: 'POST',
    body: { body: line('Wrong place'), parent_id: top.body.id },
  })
  assert.equal(hop.status, 403)
})
