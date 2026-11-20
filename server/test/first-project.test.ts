import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { app } from '../src/http/routes.js'
import { addPerson, bearerFor, closeDb, makeOwner, withActor } from './helpers.js'
import { SAMPLE } from '../src/templates.js'
import { PROJECT_TEMPLATES } from '@tracker/shared-schema'

after(async () => {
  await closeDb()
})

const call = (token: string, path: string, init: { method?: string; body?: unknown } = {}) =>
  app.request(path, {
    method: init.method ?? 'GET',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  })

test('a template starts a project with its first tasks, on whoever made it, its document and its mark', async () => {
  const owner = await makeOwner()
  const r = await call(owner.token, '/api/projects', { method: 'POST', body: { name: 'Launch', template: 'launch' } })
  assert.equal(r.status, 201)
  const { id } = (await r.json()) as { id: string }

  const rows = await withActor(
    owner.ctx.actorId,
    (tx) =>
      tx<{ title: string; assignee_id: string; list: string; subscribed: boolean }[]>`
      select t.title, t.assignee_id, l.name as list,
             exists (select 1 from subscription s
                     where s.object_id = t.id and s.actor_id = ${owner.ctx.actorId}) as subscribed
      from task t join task_list l on l.id = t.list_id
      where t.project_id = ${id} order by l.sort_key, t.sort_key`,
  )
  const plan = PROJECT_TEMPLATES.launch
  // Backlog stands before Todo on the board, so the plan's order is read per list.
  assert.deepEqual(
    rows.map((t) => [t.list, t.title]),
    [...plan.tasks.filter((t) => t.list === 'Backlog'), ...plan.tasks.filter((t) => t.list === 'Todo')].map((t) => [t.list, t.title]),
  )
  assert.ok(rows.every((t) => t.assignee_id === owner.ctx.actorId && t.subscribed))
  // The document the first task asks for, and the template's mark.
  const [made] = await withActor(
    owner.ctx.actorId,
    (tx) =>
      tx<{ mark_icon: string; docs: string[] }[]>`
      select p.mark_icon, array(select name from file f where f.project_id = p.id and f.deleted_at is null) as docs
      from project p where p.id = ${id}`,
  )
  assert.equal(made!.mark_icon, plan.icon)
  assert.deepEqual(made!.docs, [plan.doc.name])
  // One line in the feed: the project's, not one per task.
  const lines = await withActor(
    owner.ctx.actorId,
    (tx) => tx<{ action: string }[]>`select action from activity_event where project_id = ${id}`,
  )
  assert.deepEqual(
    lines.map((l) => l.action),
    ['project.create'],
  )

  // In My tasks at once.
  const mine = (await (await call(owner.token, '/api/my/tasks?tab=assigned')).json()) as { tasks: { title: string }[] }
  const titles = plan.tasks.map((t) => t.title)
  assert.equal(mine.tasks.filter((t) => titles.includes(t.title)).length, titles.length)

  // Blank is the lists and nothing else; an unknown template is refused.
  const blank = (await (await call(owner.token, '/api/projects', { method: 'POST', body: { name: 'Blank' } })).json()) as { id: string }
  const [n] = await withActor(
    owner.ctx.actorId,
    (tx) => tx<{ n: number }[]>`select count(*)::int as n from task where project_id = ${blank.id}`,
  )
  assert.equal(n!.n, 0)
  assert.equal((await call(owner.token, '/api/projects', { method: 'POST', body: { name: 'X', template: 'party' } })).status, 400)
})

test('a sample is one per workspace, nobody’s work, and goes for good at once', async () => {
  const owner = await makeOwner()
  const made = await call(owner.token, '/api/projects/sample', { method: 'POST' })
  assert.equal(made.status, 201)
  const sample = (await made.json()) as { id: string; sample: boolean; slug: string }
  assert.equal(sample.sample, true)

  const tasks = await withActor(
    owner.ctx.actorId,
    (tx) =>
      tx<{ title: string; assignee_id: string | null; completed_at: Date | null; parent_id: string | null }[]>`
      select title, assignee_id, completed_at, parent_id from task where project_id = ${sample.id}`,
  )
  const parts = SAMPLE.tasks.reduce((n, t) => n + (t.parts?.length ?? 0), 0)
  assert.equal(tasks.length, SAMPLE.tasks.length + parts)
  assert.ok(
    tasks.every((t) => t.assignee_id === null),
    'nothing in it is on anybody',
  )
  // The part marked done is done, though its parent's list does not finish.
  assert.ok(tasks.find((t) => t.title === 'Draft the layout')!.completed_at)
  // Made without a line in the feed, and out of My tasks — even Created.
  const [lines] = await withActor(
    owner.ctx.actorId,
    (tx) => tx<{ n: number }[]>`select count(*)::int as n from activity_event where project_id = ${sample.id}`,
  )
  assert.equal(lines!.n, 0)
  const created = (await (await call(owner.token, '/api/my/tasks?tab=created')).json()) as { tasks: unknown[] }
  assert.equal(created.tasks.length, 0)
  // The list says which project is the sample.
  const list = (await (await call(owner.token, '/api/projects')).json()) as { projects: { id: string; sample: boolean }[] }
  assert.equal(list.projects.find((p) => p.id === sample.id)?.sample, true)

  // Asking again opens the same one; so does a colleague, who is put on it.
  const again = await call(owner.token, '/api/projects/sample', { method: 'POST' })
  assert.equal(again.status, 200)
  assert.equal(((await again.json()) as { id: string }).id, sample.id)
  const colleague = await addPerson(owner.ctx, owner.workspaceId, 'member')
  const theirs = await call(await bearerFor(colleague.actorId, owner.workspaceId), '/api/projects/sample', { method: 'POST' })
  assert.equal(((await theirs.json()) as { id: string }).id, sample.id)

  // A project that is not a sample is not deleted this way.
  const real = (await (await call(owner.token, '/api/projects', { method: 'POST', body: { name: 'Real' } })).json()) as { id: string }
  assert.equal((await call(owner.token, `/api/projects/${real.id}/sample`, { method: 'DELETE' })).status, 404)
  assert.equal((await call(owner.token, `/api/projects/${real.id}`)).status, 200)

  // The sample goes at once, with everything in it, not to the bin.
  assert.equal((await call(owner.token, `/api/projects/${sample.id}/sample`, { method: 'DELETE' })).status, 200)
  const [left] = await withActor(
    owner.ctx.actorId,
    (tx) =>
      tx<{ n: number }[]>`
      select (select count(*) from project where id = ${sample.id})
           + (select count(*) from task where project_id = ${sample.id}) as n`,
  )
  assert.equal(Number(left!.n), 0)
  // And another can be made after it.
  assert.equal((await call(owner.token, '/api/projects/sample', { method: 'POST' })).status, 201)
})
