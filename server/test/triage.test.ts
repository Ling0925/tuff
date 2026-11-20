import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { app } from '../src/http/routes.js'
import { issueApiToken } from '../src/auth/flows.js'
import { issueAccessToken } from '../src/auth/tokens.js'
import { addPerson, bearerFor, closeDb, makeOwner, makeProject, withActor } from './helpers.js'

after(closeDb)

const call = (method: string, path: string, token: string, body?: unknown) =>
  app.request(`/api${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

async function listsOf(actor: string, project: string) {
  return withActor(
    actor,
    (tx) => tx<{ id: string; name: string; intake: boolean; deleted: boolean }[]>`
    select id, name, intake, deleted_at is not null as deleted from task_list where project_id = ${project} order by sort_key`,
  )
}

test('what an agent makes waits in Triage; what a person makes by hand does not', async () => {
  const me = await makeOwner()
  const p = await makeProject(me.ctx, me.workspaceId, 'Inbox')
  await withActor(
    me.ctx.actorId,
    (tx) => tx`
    insert into task_list (id, workspace_id, project_id, author_id, name, sort_key)
    values (gen_random_uuid(), ${me.workspaceId}, ${p}, ${me.ctx.actorId}, 'Backlog', 'a5')`,
  )
  const on = await call('PUT', `/projects/${p}/triage`, me.token, { on: true })
  assert.equal(on.status, 200)
  const lists = (await listsOf(me.ctx.actorId, p)).filter((l) => !l.deleted)
  assert.equal(lists[0]!.intake, true)
  assert.equal(lists[0]!.name, 'Triage')
  // On twice is one list.
  await call('PUT', `/projects/${p}/triage`, me.token, { on: true })
  assert.equal((await listsOf(me.ctx.actorId, p)).filter((l) => l.intake && !l.deleted).length, 1)

  const byHand = (await (await call('POST', `/projects/${p}/tasks`, me.token, { title: 'Mine' })).json()) as { id: string }
  const agent = await issueApiToken(me.ctx.actorId, me.workspaceId, 'agent')
  const byAgent = (await (await call('POST', `/projects/${p}/tasks`, agent, { title: 'Filed by an agent' })).json()) as { id: string }
  const where = async (id: string) =>
    (
      await withActor(
        me.ctx.actorId,
        (tx) => tx<{ intake: boolean }[]>`
      select l.intake from task t join task_list l on l.id = t.list_id where t.id = ${id}`,
      )
    )[0]!.intake
  assert.equal(await where(byHand.id), false)
  assert.equal(await where(byAgent.id), true)
  // And what GitHub opens, made as the person who linked the repository.
  const github = await issueAccessToken({ sub: me.ctx.actorId, workspace_id: me.workspaceId, via: 'github' })
  const byGithub = (await (await call('POST', `/projects/${p}/tasks`, github, { title: 'Opened on GitHub' })).json()) as { id: string }
  assert.equal(await where(byGithub.id), true)

  // Off: what waited goes to the first list, and the list goes.
  assert.equal((await call('PUT', `/projects/${p}/triage`, me.token, { on: false })).status, 200)
  assert.equal(await where(byAgent.id), false)
  assert.equal((await listsOf(me.ctx.actorId, p)).filter((l) => l.intake && !l.deleted).length, 0)
})

/* The switch is the project's, by hand: not a token, not somebody who does
   not run its tools, not a project somebody cannot see. */
test('Triage is switched only by whoever runs the project’s tools, by hand', async () => {
  const me = await makeOwner()
  const p = await makeProject(me.ctx, me.workspaceId, 'Guarded')
  const member = await addPerson(me.ctx, me.workspaceId, 'member', [p], ['task.edit'])
  assert.equal((await call('PUT', `/projects/${p}/triage`, await bearerFor(member.actorId, me.workspaceId), { on: true })).status, 403)
  const agent = await issueApiToken(me.ctx.actorId, me.workspaceId, 'agent')
  assert.equal((await call('PUT', `/projects/${p}/triage`, agent, { on: true })).status, 403)
  // Another company's owner is told there is nothing there.
  const other = await makeOwner()
  assert.equal((await call('PUT', `/projects/${p}/triage`, other.token, { on: true })).status, 404)
})

/* Off moves every task, deleted ones too: one restored later came back into
   a list that was gone. On twice at once is one list. */
test('turning Triage off takes even deleted tasks out, and on twice at once is one list', async () => {
  const me = await makeOwner()
  const p = await makeProject(me.ctx, me.workspaceId, 'Edges')
  await withActor(
    me.ctx.actorId,
    (tx) => tx`
    insert into task_list (id, workspace_id, project_id, author_id, name, sort_key)
    values (gen_random_uuid(), ${me.workspaceId}, ${p}, ${me.ctx.actorId}, 'Backlog', 'a5')`,
  )
  const both = await Promise.all([
    call('PUT', `/projects/${p}/triage`, me.token, { on: true }),
    call('PUT', `/projects/${p}/triage`, me.token, { on: true }),
  ])
  assert.deepEqual(
    both.map((r) => r.status),
    [200, 200],
  )
  const ids = await Promise.all(both.map(async (r) => ((await r.json()) as { list_id: string }).list_id))
  assert.equal(ids[0], ids[1])
  const agent = await issueApiToken(me.ctx.actorId, me.workspaceId, 'agent')
  const t = (await (await call('POST', `/projects/${p}/tasks`, agent, { title: 'Then deleted' })).json()) as { id: string }
  await withActor(me.ctx.actorId, (tx) => tx`update task set deleted_at = now() where id = ${t.id}`)
  await call('PUT', `/projects/${p}/triage`, me.token, { on: false })
  const [row] = await withActor(
    me.ctx.actorId,
    (tx) => tx<{ list: string | null }[]>`
    select l.name as list from task t left join task_list l on l.id = t.list_id where t.id = ${t.id}`,
  )
  assert.equal(row!.list, 'Backlog')
})

/* A copy's work was the team's already: Triage comes as Triage, and what
   is copied goes to the first list after it. */
test('a project copied keeps its Triage as Triage and puts nothing in it', async () => {
  const me = await makeOwner()
  const p = await makeProject(me.ctx, me.workspaceId, 'Source')
  await withActor(
    me.ctx.actorId,
    (tx) => tx`
    insert into task_list (id, workspace_id, project_id, author_id, name, sort_key)
    values (gen_random_uuid(), ${me.workspaceId}, ${p}, ${me.ctx.actorId}, 'Backlog', 'a5')`,
  )
  await call('PUT', `/projects/${p}/triage`, me.token, { on: true })
  await call('POST', `/projects/${p}/tasks`, me.token, { title: 'Agreed work' })
  const copied = await call('POST', `/projects/${p}/copy`, me.token, { name: 'Copy' })
  assert.equal(copied.status, 201)
  const { id } = (await copied.json()) as { id: string }
  const lists = (await listsOf(me.ctx.actorId, id)).filter((l) => !l.deleted)
  assert.equal(lists.filter((l) => l.intake).length, 1)
  const [task] = await withActor(
    me.ctx.actorId,
    (tx) => tx<{ intake: boolean }[]>`
    select l.intake from task t join task_list l on l.id = t.list_id where t.project_id = ${id} and t.title = 'Agreed work'`,
  )
  assert.equal(task!.intake, false)
})
