import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { app } from '../src/http/routes.js'
import { addPerson, bearerFor, closeDb, withActor, uuidv7, makeOwner, makeProject } from './helpers.js'

/* What AI tools spent on a task. */

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

type Line = { id: string; client: string; model: string | null; tokens: number; cost_usd: number | null; actor_name: string }

test('spend sent to a task comes back with it, and a session reported again replaces its line', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const project = await makeProject(ctx, workspaceId, 'Acme')
  const one = await task(ctx.actorId, workspaceId, project, 'The work')
  const other = await task(ctx.actorId, workspaceId, project, 'Something else')

  const first = await call(`/api/tasks/${one}/spend`, token, {
    method: 'POST',
    body: { client: 'Claude Code', model: 'claude-opus-5-5', tokens: 400_000, cost_usd: 1.2, session: 's1' },
  })
  assert.equal(first.status, 201)
  // The running total after the next reply: the same line, not a second one.
  const again = await call(`/api/tasks/${one}/spend`, token, {
    method: 'POST',
    body: { client: 'Claude Code', model: 'claude-opus-5-5', tokens: 1_200_000, cost_usd: 4.8, session: 's1' },
  })
  assert.equal(again.status, 201)
  assert.equal(again.body.id, first.body.id)
  // Without a session, every report is its own line; a cost is not required.
  await call(`/api/tasks/${one}/spend`, token, { method: 'POST', body: { client: 'Cursor', tokens: 3000 } })

  const read = await call(`/api/tasks/${one}`, token)
  const spend = read.body.spend as Line[]
  assert.equal(spend.length, 2)
  assert.deepEqual(
    spend.map((l) => [l.client, l.tokens, l.cost_usd]),
    [
      ['Claude Code', 1_200_000, 4.8],
      ['Cursor', 3000, null],
    ],
  )
  assert.equal(spend[0]?.model, 'claude-opus-5-5')
  assert.deepEqual((await call(`/api/tasks/${other}`, token)).body.spend, [])

  const report = await call(`/api/spend?project=${project}`, token)
  assert.equal(report.status, 200)
  const rows = report.body.spend as { client: string; tokens: number; cost_usd: number | null }[]
  assert.equal(
    rows.reduce((n, r) => n + r.tokens, 0),
    1_203_000,
  )
  assert.equal(rows.find((r) => r.client === 'Claude Code')?.cost_usd, 4.8)
})

test('a report says something and names a task that is there', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const project = await makeProject(ctx, workspaceId, 'Acme')
  const t = await task(ctx.actorId, workspaceId, project, 'The work')

  for (const body of [{ client: 'Claude Code', tokens: 0 }, { tokens: 10 }, { client: '', tokens: 10 }, { client: 'X', tokens: -1 }]) {
    assert.equal((await call(`/api/tasks/${t}/spend`, token, { method: 'POST', body })).status, 400)
  }
  assert.equal((await call(`/api/tasks/${uuidv7()}/spend`, token, { method: 'POST', body: { client: 'X', tokens: 1 } })).status, 404)

  // Another company's task is not there at all.
  const them = await makeOwner()
  assert.equal((await call(`/api/tasks/${t}/spend`, them.token, { method: 'POST', body: { client: 'X', tokens: 1 } })).status, 404)
})

test("a line is removed by whoever sent it, and somebody else's needs the right to", async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const project = await makeProject(ctx, workspaceId, 'Acme')
  const t = await task(ctx.actorId, workspaceId, project, 'The work')
  const sam = await addPerson(ctx, workspaceId, 'member', [project])
  const samToken = await bearerFor(sam.actorId, workspaceId)

  const mine = await call(`/api/tasks/${t}/spend`, token, { method: 'POST', body: { client: 'Claude Code', tokens: 10 } })
  // Sam sees it and may not take it back.
  assert.equal(((await call(`/api/tasks/${t}`, samToken)).body.spend as unknown[]).length, 1)
  assert.equal((await call(`/api/spend/${mine.body.id as string}`, samToken, { method: 'DELETE' })).status, 403)

  // Sam's own goes in as Sam's, with no way to say it is anybody else's.
  const theirs = await call(`/api/tasks/${t}/spend`, samToken, {
    method: 'POST',
    body: { client: 'Cursor', tokens: 20, actor_id: ctx.actorId },
  })
  assert.equal(theirs.status, 201)
  const lines = (await call(`/api/tasks/${t}`, token)).body.spend as (Line & { actor_id: string })[]
  assert.equal(lines.find((l) => l.client === 'Cursor')?.actor_id, sam.actorId)
  assert.equal((await call(`/api/spend/${theirs.body.id as string}`, samToken, { method: 'DELETE' })).status, 200)

  // The owner runs the project and may take back anybody's.
  assert.equal((await call(`/api/spend/${mine.body.id as string}`, token, { method: 'DELETE' })).status, 200)
  assert.deepEqual((await call(`/api/tasks/${t}`, token)).body.spend, [])
  assert.equal((await call(`/api/spend/${mine.body.id as string}`, token, { method: 'DELETE' })).status, 404)

  // Somebody from elsewhere is told nothing exists.
  const stranger = await makeOwner()
  assert.equal((await call(`/api/spend/${theirs.body.id as string}`, stranger.token, { method: 'DELETE' })).status, 404)
})
