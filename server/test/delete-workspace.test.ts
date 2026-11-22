import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import postgres from 'postgres'
import { app } from '../src/http/routes.js'
import { issueApiToken } from '../src/auth/flows.js'
import { outbox } from '../src/mail.js'
import { addPerson, bearerFor, closeDb, makeOwner, makeProject } from './helpers.js'

/* As the tables' owner, for what only a fixture reads or sets. */
const owner = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} })
after(async () => {
  await owner.end()
  await closeDb()
})

const PASSWORD = 'correct-horse-battery-staple'
const call = async (method: string, path: string, token: string, body?: unknown) => {
  const r = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, unknown> }
}
const nameOf = async (workspaceId: string) =>
  (await owner<{ name: string; slug: string }[]>`select name, slug::text as slug from workspace where id = ${workspaceId}`)[0]!
/* The letters go after the answer, ten at a time. */
const lettersSince = async (from: number, n: number) => {
  for (let i = 0; i < 50 && outbox.length - from < n; i++) await new Promise((r) => setTimeout(r, 20))
  return outbox.slice(from)
}

/* A workspace deleted by its owner: what goes, who is told — on a server of
   one's own as on the service, with nothing paid for. */
test('the owner deletes the workspace with its name and their password, and everybody in it is told — nothing paid for', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const project = await makeProject(ctx, workspaceId, 'Going')
  const sam = await addPerson(ctx, workspaceId, 'member')
  await owner.begin(
    (tx) => tx`
    insert into app_user (actor_id, email, password_hash, timezone)
    values (${sam.actorId}, ${`sam-${sam.actorId}@example.com`}, 'x', 'UTC')`,
  )
  const asSam = await bearerFor(sam.actorId, workspaceId)
  const { name } = await nameOf(workspaceId)
  // Sam is in another workspace too, which nothing here touches.
  const elsewhere = await makeOwner()
  await owner`insert into membership (id, workspace_id, actor_id, role, joined_at)
              values (gen_random_uuid(), ${elsewhere.workspaceId}, ${sam.actorId}, 'member', now())`
  const samElsewhere = await bearerFor(sam.actorId, elsewhere.workspaceId)
  // A document shared by link.
  const shareToken = workspaceId.replace(/-/g, '').slice(0, 24)
  const [doc] = await owner<{ id: string }[]>`
    insert into file (id, workspace_id, project_id, author_id, name, body, public_token)
    values (gen_random_uuid(), ${workspaceId}, ${project}, ${ctx.actorId}, 'Shared', '{"type":"doc","content":[]}'::jsonb, ${shareToken})
    returning id`

  // Not by a member, not through a token, not without the name or the password.
  assert.equal((await call('POST', '/api/workspace/delete', asSam, { dry: true })).status, 403)
  const tool = await issueApiToken(ctx.actorId, workspaceId, 'agent')
  assert.equal((await call('POST', '/api/workspace/delete', tool, { name, password: PASSWORD })).status, 403)
  assert.equal((await call('POST', '/api/workspace/delete', token, { name, password: 'wrong-password-here' })).status, 403)
  assert.equal((await call('POST', '/api/workspace/delete', token, { name: `${name} x`, password: PASSWORD })).status, 400)

  // What goes, said first.
  const dry = await call('POST', '/api/workspace/delete', token, { dry: true })
  assert.equal(dry.status, 200, JSON.stringify(dry.body))
  assert.equal(dry.body.name, name)
  assert.equal(dry.body.projects, 1)
  assert.equal(dry.body.people, 2)
  assert.equal(dry.body.paid, false)
  assert.equal(dry.body.asks, 'password')
  // Still there after all of that.
  assert.equal((await call('GET', '/api/me', asSam)).status, 200)
  // Its shared document reads by its link, until it goes.
  assert.equal((await app.request(`/api/public/docs/${shareToken}`)).status, 200)

  const sent = outbox.length
  const gone = await call('POST', '/api/workspace/delete', token, { name, password: PASSWORD })
  assert.equal(gone.status, 200, JSON.stringify(gone.body))

  // Dark at once, for everybody in it and every token for it.
  for (const t of [token, asSam, tool]) assert.equal((await call('GET', '/api/me', t)).status, 401)
  const [state] = await owner<{ deleted: boolean; members: number; live_tokens: number; shared: number }[]>`
    select (select deleted_at is not null from workspace where id = ${workspaceId}) as deleted,
           (select count(*)::int from membership where workspace_id = ${workspaceId} and deleted_at is null) as members,
           (select count(*)::int from api_token where workspace_id = ${workspaceId} and revoked_at is null) as live_tokens,
           (select count(*)::int from file where workspace_id = ${workspaceId} and public_token is not null) as shared`
  assert.deepEqual({ ...state }, { deleted: true, members: 0, live_tokens: 0, shared: 0 })
  assert.ok(doc)
  assert.equal((await app.request(`/api/public/docs/${shareToken}`)).status, 404)
  // Nobody joins it in the moment after: the row refuses a live place.
  await assert.rejects(
    owner`insert into membership (id, workspace_id, actor_id, role, joined_at)
          values (gen_random_uuid(), ${workspaceId}, ${elsewhere.ctx.actorId}, 'member', now())`,
    /workspace_deleted/,
  )
  // Sam's other workspace is as it was.
  assert.equal((await call('GET', '/api/me', samElsewhere)).status, 200)
  // Both told: the owner what went, Sam who did it.
  const mail = await lettersSince(sent, 2)
  assert.equal(mail.length, 2)
  assert.ok(mail.some((m) => m.to.startsWith('sam-') && m.text.includes(name)))
  assert.ok(mail.some((m) => !m.to.startsWith('sam-') && m.text.includes(name)))
})
