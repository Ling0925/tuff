import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import postgres from 'postgres'
import { app } from '../src/http/routes.js'
import { closeRealtime } from '../src/realtime.js'
import { closeDb, makeOwner, makeProject } from './helpers.js'

/* As the tables' owner, to read the stamp itself. */
const owner = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} })

after(async () => {
  await owner.end()
  await closeRealtime()
  await closeDb()
})

async function send(method: string, path: string, token: string, body?: unknown) {
  const r = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, unknown> }
}

/* The stamp is written beside the request, not before its answer. */
async function seenAt(actorId: string): Promise<Date | null> {
  for (let i = 0; i < 50; i++) {
    const [row] = await owner<{ seen_at: Date | null }[]>`select seen_at from actor where id = ${actorId}`
    if (row?.seen_at) return row.seen_at
    await new Promise((r) => setTimeout(r, 20))
  }
  return null
}

test('an agent calling with its token is here, and a person’s own token does not make them so', async () => {
  const boss = await makeOwner()
  const project = await makeProject(boss.ctx, boss.workspaceId, 'Presence')
  const made = await send('POST', '/api/agents', boss.token, { name: 'Claude Code', project_ids: [project], reach: 'mcp' })
  assert.equal(made.status, 201, JSON.stringify(made.body))
  const agent = made.body.agent_id as string

  const before = await send('GET', '/api/people', boss.token)
  const listed = (before.body.people as { actor_id: string; presence: string }[]).find((p) => p.actor_id === agent)
  assert.equal(listed?.presence, 'away', 'an agent that has not called is away')

  assert.equal((await send('GET', '/api/me', made.body.token as string)).status, 200)
  assert.ok(await seenAt(agent), 'the agent’s call stamped it')
  const now = await send('GET', '/api/people', boss.token)
  assert.equal((now.body.people as { actor_id: string; presence: string }[]).find((p) => p.actor_id === agent)?.presence, 'here')

  /* The owner's own token: their tool at work, not them looking. */
  await owner`update actor set seen_at = null where id = ${boss.ctx.actorId}`
  const mine = await send('POST', '/api/tokens', boss.token, { name: 'My laptop' })
  assert.equal(mine.status, 201, JSON.stringify(mine.body))
  assert.equal((await send('GET', '/api/me', mine.body.token as string)).status, 200)
  await new Promise((r) => setTimeout(r, 200))
  const [row] = await owner<{ seen_at: Date | null }[]>`select seen_at from actor where id = ${boss.ctx.actorId}`
  assert.equal(row?.seen_at ?? null, null)
})
