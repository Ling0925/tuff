import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { app } from '../src/http/routes.js'
import {
  closeDb,
  withActor,
  withoutActor,
  uuidv7,
  makeOwner,
  addPerson,
  asTableOwner,
  bearerFor,
  inWorkspace,
  makeProject,
} from './helpers.js'

after(async () => {
  await closeDb()
})

async function call(path: string, token: string, init: { method?: string; body?: unknown } = {}) {
  const r = await app.request(path, {
    method: init.method ?? 'GET',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  })
  return { status: r.status, headers: r.headers, body: (await r.json().catch(() => ({}))) as Record<string, unknown> }
}

test('a copy of what Tuff keeps is the person’s own, across their workspaces', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const p = await makeProject(ctx, workspaceId, 'Acme')
  const sam = await addPerson(ctx, workspaceId, 'member', [p])
  await withActor(ctx.actorId, async (tx) => {
    await tx`insert into task (id, workspace_id, project_id, author_id, title, sort_key, body)
             values (${uuidv7()}, ${workspaceId}, ${p}, ${ctx.actorId}, 'Mine to keep', 'a0',
                     ${tx.json({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'written by me' }] }] } as never)})`
  })
  await withActor(sam.actorId, async (tx) => {
    await tx`insert into task (id, workspace_id, project_id, author_id, title, sort_key)
             values (${uuidv7()}, ${workspaceId}, ${p}, ${sam.actorId}, 'Not mine', 'a1')`
  })
  const r = await call('/api/me/export', token)
  assert.equal(r.status, 200)
  assert.match(r.headers.get('content-disposition') ?? '', /attachment; filename="tuff-data-/)
  const account = r.body.account as { email: string }
  assert.match(account.email, /@example\.com$/)
  const ws = (r.body.workspaces as { tasks: { title: string; description: string }[] }[])[0]!
  assert.deepEqual(
    ws.tasks.map((t) => t.title),
    ['Mine to keep'],
  )
  assert.equal(ws.tasks[0]!.description, 'written by me')
})

test('a copy keeps the comments somebody wrote in a room and a project they have left, and nobody else’s', async () => {
  const { ctx, workspaceId, token: owner } = await makeOwner()
  const p = await makeProject(ctx, workspaceId, 'Acme')
  const q = await makeProject(ctx, workspaceId, 'Beta')
  const sam = await addPerson(ctx, workspaceId, 'member', [p, q], ['task.create', 'channel.create'])
  const kim = await addPerson(ctx, workspaceId, 'member', [p])
  const samToken = await bearerFor(sam.actorId, workspaceId)
  const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })

  /* A file in a room of Sam's and Kim's on Acme — Kim stays, so the room
     stays theirs rather than going back to the whole project — and a task
     on Beta. */
  const room = await call(`/api/projects/${p}/conversations`, samToken, {
    method: 'POST',
    body: { name: 'ours', member_ids: [sam.actorId, kim.actorId] },
  })
  assert.equal(room.status, 201, JSON.stringify(room.body))
  const fileId = uuidv7()
  const taskId = uuidv7()
  await withActor(sam.actorId, async (tx) => {
    await tx`
      insert into file (id, workspace_id, project_id, conversation_id, author_id, name, storage_key, size_bytes, uploaded_at)
      values (${fileId}, ${workspaceId}, ${p}, ${room.body.id as string}, ${sam.actorId}, 'plan.pdf', ${`k/${fileId}`}, 10, now())`
    await tx`insert into task (id, workspace_id, project_id, author_id, title, sort_key)
             values (${taskId}, ${workspaceId}, ${q}, ${sam.actorId}, 'Beta work', 'a0')`
  })
  for (const [path, text] of [
    [`/api/files/${fileId}/comments`, 'said in our room'],
    [`/api/tasks/${taskId}/comments`, 'said on Beta'],
  ] as const) {
    const r = await call(path, samToken, { method: 'POST', body: { body: doc(text) } })
    assert.equal(r.status, 201, JSON.stringify(r.body))
  }
  // Somebody else's comment on the same task is not Sam's to take.
  assert.equal(
    (await call(`/api/tasks/${taskId}/comments`, owner, { method: 'POST', body: { body: doc('said by the owner') } })).status,
    201,
  )

  // Sam leaves the room, and is taken off Beta.
  const db = asTableOwner()
  await db`update conversation_member set joined_at = null where conversation_id = ${room.body.id as string} and actor_id = ${sam.actorId}`
  await db`update project_member set deleted_at = now() where project_id = ${q} and actor_id = ${sam.actorId}`
  // Through the policies, neither is Sam's to read any more.
  const seen = await inWorkspace(sam.actorId, workspaceId, (tx) => tx`select id from comment where author_id = ${sam.actorId}`)
  assert.equal(seen.length, 0)

  const r = await call('/api/me/export', samToken)
  assert.equal(r.status, 200)
  const comments = (r.body.workspaces as { comments: { on_a: string; words: string }[] }[])[0]!.comments
  assert.deepEqual(
    comments.map((c) => [c.on_a, c.words]),
    [
      ['file', 'said in our room'],
      ['task', 'said on Beta'],
    ],
  )
})

test('an account is deleted by its owner, asked twice, and a workspace with others in it stops it', async () => {
  const lone = await makeOwner()
  // The dry run says what would go.
  const dry = await call('/api/me/delete', lone.token, { method: 'POST', body: { dry: true } })
  assert.equal(dry.status, 200)
  assert.equal(dry.body.asks, 'password')
  assert.equal((dry.body.alone as unknown[]).length, 1)
  // A wrong password deletes nothing.
  const wrong = await call('/api/me/delete', lone.token, { method: 'POST', body: { password: 'not it at all' } })
  assert.equal(wrong.status, 403)
  // Their GitHub, linked from Account, goes with them: kept, its token went
  // on editing their old comments on GitHub after the account was gone.
  await withActor(
    lone.ctx.actorId,
    (tx) => tx`
    insert into github_person (actor_id, github_id, login, token_enc)
    values (${lone.ctx.actorId}, ${Math.floor(Math.random() * 1e9)}, ${'gone-person'}, ${'sealed'})`,
  )
  const kept = () => withActor(lone.ctx.actorId, (tx) => tx<{ n: number }[]>`select count(*)::int as n from github_person`)
  assert.equal((await kept())[0]!.n, 1)
  const done = await call('/api/me/delete', lone.token, { method: 'POST', body: { password: 'correct-horse-battery-staple' } })
  assert.equal(done.status, 200)
  assert.equal((await kept())[0]!.n, 0)
  const [gone] = await withoutActor((tx) => tx<{ n: number }[]>`select count(*)::int as n from workspace where id = ${lone.workspaceId}`)
  assert.equal(gone!.n, 0)

  // Owning a workspace others are in: handed over first.
  const shared = await makeOwner()
  const p = await makeProject(shared.ctx, shared.workspaceId, 'Acme')
  await addPerson(shared.ctx, shared.workspaceId, 'member', [p])
  const refused = await call('/api/me/delete', shared.token, { method: 'POST', body: { password: 'correct-horse-battery-staple' } })
  assert.equal(refused.status, 409)
  assert.equal((refused.body.error as { code: string }).code, 'sole_owner')
})
