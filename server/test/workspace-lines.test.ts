import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { app } from '../src/http/routes.js'
import { startSession } from '../src/auth/flows.js'
import { issueAccessToken } from '../src/auth/tokens.js'
import { addPerson, asTableOwner, closeDb, inWorkspace, makeOwner, makeProject, uuidv7 } from './helpers.js'

after(async () => {
  await closeDb()
})

/*
 * The feed's lines about the workspace — a switch turned, rights given,
 * somebody removed, a webhook's host — are the audit log's, and the owner's
 * to read: finding 9, migration 241. They were served to every
 * member and every token by `GET /api/activity`.
 */
test('the workspace lines of the feed are the owner’s, in their own session', async () => {
  const { ctx, workspaceId, token: owner } = await makeOwner()
  const project = await makeProject(ctx, workspaceId, 'Studio')
  const ann = await addPerson(ctx, workspaceId, 'member', [project])
  const annT = (await startSession(ann.actorId, workspaceId, {}, null)).access_token

  const line = async (actor: string, action: string, meta: object, projectId: string | null = null) => {
    const id = uuidv7()
    await asTableOwner()`
      insert into activity_event (id, workspace_id, project_id, actor_id, action, origin, meta)
      values (${id}, ${workspaceId}, ${projectId}, ${actor}, ${action}, 'web', ${asTableOwner().json(meta as never)})`
    return id
  }
  const rights = await line(ctx.actorId, 'people.rights', { actor_id: ann.actorId })
  const hook = await line(ctx.actorId, 'webhook.create', { url: 'https://internal.example.com/hook' })
  const own = await line(ann.actorId, 'agent.connect', { name: 'Ann’s helper' })
  const work = await line(ann.actorId, 'project.update', {}, project)

  const ids = async (token: string) => {
    const r = await app.request('/api/activity?limit=200', { headers: { authorization: `Bearer ${token}` } })
    assert.equal(r.status, 200)
    return ((await r.json()) as { events: { id: string }[] }).events.map((e) => e.id)
  }

  const asAnn = await ids(annT)
  assert.equal(asAnn.includes(rights), false, 'a member is not told who was given what')
  assert.equal(asAnn.includes(hook), false, 'nor where the webhooks go')
  assert.equal(asAnn.includes(own), true, 'their own doing is theirs')
  assert.equal(asAnn.includes(work), true, 'the work is still the feed')

  // The database says the same, whatever the query.
  const seen = await inWorkspace(
    ann.actorId,
    workspaceId,
    (tx) => tx<{ id: string }[]>`select id from activity_event where id = any(${[rights, hook, own]}::uuid[])`,
  )
  assert.deepEqual(
    seen.map((r) => r.id),
    [own],
  )

  const asOwner = await ids(owner)
  for (const id of [rights, hook, own, work]) assert.equal(asOwner.includes(id), true)

  // The owner's token without a session — what an MCP key or a tool holds —
  // is not the owner looking.
  const bare = await issueAccessToken({ sub: ctx.actorId, workspace_id: workspaceId })
  const asTool = await ids(bare)
  assert.equal(asTool.includes(rights), false)
  assert.equal(asTool.includes(hook), false)
  assert.equal(asTool.includes(work), true)
  const annBare = await issueAccessToken({ sub: ann.actorId, workspace_id: workspaceId })
  assert.equal((await ids(annBare)).includes(own), false, 'nor is a member’s token')
})
