import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { app } from '../src/http/routes.js'
import { issueApiToken } from '../src/auth/flows.js'
import { closeDb, withActor, uuidv7, makeOwner, makeProject, addPerson, bearerFor } from './helpers.js'

after(async () => {
  await closeDb()
})

/**
 * A task copied into a project.
 *
 * What the copy carries, what it leaves, who may make one, and that the
 * original is exactly as it was.
 */

async function call(method: string, path: string, token: string, body?: unknown) {
  const r = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, any> }
}
const post = (path: string, token: string, body: unknown) => call('POST', path, token, body)
const get = (path: string, token: string) => call('GET', path, token)

async function list(project: string, token: string, name: string, finishes = false): Promise<string> {
  const r = await post(`/api/projects/${project}/lists`, token, { name, finishes })
  assert.equal(r.status, 201, JSON.stringify(r.body))
  return r.body.id as string
}

async function labelId(project: string, token: string, name: string): Promise<string> {
  const r = await get(`/api/projects/${project}/labels`, token)
  const found = (r.body.labels as { id: string; name: string }[]).find((l) => l.name === name)
  if (found) return found.id
  const made = await post(`/api/projects/${project}/labels`, token, { name })
  assert.equal(made.status, 201, JSON.stringify(made.body))
  return made.body.id as string
}

/** Two projects, with lists, and three people: one on both, one on each. */
async function scene() {
  const owner = await makeOwner()
  const { ctx, workspaceId, token } = owner
  const from = await makeProject(ctx, workspaceId, 'Website')
  const to = await makeProject(ctx, workspaceId, 'Mobile')
  const fromTodo = await list(from, token, 'Todo')
  const fromDoing = await list(from, token, 'Doing')
  const fromDone = await list(from, token, 'Done', true)
  const toBacklog = await list(to, token, 'Backlog')
  const toDoing = await list(to, token, 'Doing')
  const toShipped = await list(to, token, 'Shipped', true)
  const both = await addPerson(ctx, workspaceId, 'member', [from, to])
  const onlyFrom = await addPerson(ctx, workspaceId, 'member', [from])
  const onlyTo = await addPerson(ctx, workspaceId, 'member', [to])
  return {
    ...owner,
    from,
    to,
    fromTodo,
    fromDoing,
    fromDone,
    toBacklog,
    toDoing,
    toShipped,
    both: { ...both, token: await bearerFor(both.actorId, workspaceId) },
    onlyFrom: { ...onlyFrom, token: await bearerFor(onlyFrom.actorId, workspaceId) },
    onlyTo: { ...onlyTo, token: await bearerFor(onlyTo.actorId, workspaceId) },
  }
}

const doc = (...content: unknown[]) => ({ type: 'doc', content })

test('a copy carries the plan — words, pictures, parts as finished as they were, labels by name — and the original is untouched', async () => {
  const s = await scene()
  const bug = await labelId(s.from, s.token, 'Bug')
  const copy = await labelId(s.from, s.token, 'Copy')
  const cycle = await post(`/api/projects/${s.from}/cycles`, s.token, { name: 'Sprint 3', starts_on: '2026-11-01', ends_on: '2026-11-14' })

  const picture = uuidv7()
  await withActor(
    s.ctx.actorId,
    (tx) => tx`
    insert into file (id, workspace_id, project_id, author_id, name, storage_key, content_type, pixel_width, pixel_height)
    values (${picture}, ${s.workspaceId}, ${s.from}, ${s.ctx.actorId}, 'shot.png', ${`k/${picture}`}, 'image/png', 640, 480)`,
  )
  const body = doc(
    { type: 'paragraph', content: [{ type: 'text', text: 'See the shot.' }] },
    { type: 'attachment', attrs: { fileId: picture, name: 'shot.png' } },
  )
  const made = await post(`/api/projects/${s.from}/tasks`, s.token, {
    title: 'Redo the pricing page',
    body,
    list_id: s.fromDoing,
    labels: [bug, copy],
    cycle_id: cycle.body.id,
    assignee_ids: [s.both.actorId, s.onlyFrom.actorId],
    priority: 'high',
    due_on: '2026-12-01',
  })
  assert.equal(made.status, 201)
  const id = made.body.id as string
  const a = await post(`/api/tasks/${id}/steps`, s.token, { title: 'The table' })
  await post(`/api/tasks/${id}/steps`, s.token, { title: 'The toggle' })
  assert.equal((await call('PATCH', `/api/steps/${a.body.id}`, s.token, { done: true })).status, 200)
  await post(`/api/tasks/${id}/comments`, s.onlyFrom.token, { body: doc() })
  await post('/api/time', s.token, { project_id: s.from, object_type: 'task', object_id: id, minutes: 30, spent_on: '2026-11-05' })
  const before = await get(`/api/tasks/${id}`, s.token)

  // What it would be, and nothing made.
  const dry = await post(`/api/tasks/${id}/copy`, s.token, { project_id: s.to, dry: true })
  assert.equal(dry.status, 200, JSON.stringify(dry.body))
  assert.equal(dry.body.id, null)
  assert.equal(dry.body.list_id, s.toDoing, 'Doing to Doing')
  assert.deepEqual(dry.body.labels_kept, ['Bug'])
  assert.deepEqual(dry.body.labels_dropped, ['Copy'])
  assert.equal(dry.body.cycle, 'Sprint 3')
  assert.deepEqual(
    dry.body.assignees_dropped.map((x: { actor_id: string }) => x.actor_id),
    [s.onlyFrom.actorId],
  )
  assert.equal(dry.body.subtasks, 2)
  assert.equal(dry.body.files, 1)
  assert.equal(dry.body.github_to, false)
  const [none] = await withActor(s.ctx.actorId, (tx) => tx<{ n: number }[]>`select count(*)::int as n from task where project_id = ${s.to}`)
  assert.equal(none!.n, 0, 'a dry run makes nothing')

  const done = await post(`/api/tasks/${id}/copy`, s.token, { project_id: s.to })
  assert.equal(done.status, 201, JSON.stringify(done.body))
  const copyId = done.body.id as string
  assert.ok(typeof done.body.number === 'number')

  const read = await get(`/api/tasks/${copyId}`, s.token)
  const t = read.body.task
  assert.equal(t.project_id, s.to)
  assert.equal(t.title, 'Redo the pricing page')
  assert.equal(t.list_id, s.toDoing)
  assert.equal(t.priority, 'high')
  assert.equal(t.due_on, '2026-12-01')
  assert.equal(t.cycle_id, null, 'the sprint is the original’s')
  assert.deepEqual(t.assignee_ids, [s.both.actorId])
  assert.deepEqual(
    (t.labels as { name: string }[]).map((l) => l.name),
    ['Bug'],
  )
  assert.equal(read.body.comments.length, 0, 'what was said stays with the original')
  assert.equal((read.body.time ?? []).length, 0)
  const steps = read.body.steps as { title: string; done_at?: string | null; completed_at?: string | null }[]
  assert.deepEqual(
    steps.map((x) => x.title),
    ['The table', 'The toggle'],
  )
  assert.deepEqual(
    steps.map((x) => Boolean(x.done_at ?? x.completed_at)),
    [true, false],
    'each part as finished as it was',
  )

  // Its picture is a file of the new project, over the same bytes.
  const shown = JSON.stringify(t.body).match(/"fileId":"([0-9a-f-]{36})"/)?.[1]
  assert.ok(shown && shown !== picture, 'the copy shows a file of its own')
  const [row] = await withActor(
    s.ctx.actorId,
    (tx) =>
      tx<
        { project_id: string; storage_key: string; origin_id: string }[]
      >`select project_id, storage_key, origin_id from file where id = ${shown!}`,
  )
  assert.equal(row!.project_id, s.to)
  assert.equal(row!.storage_key, `k/${picture}`)
  assert.equal(row!.origin_id, copyId)
  assert.equal((await get(`/api/files/${shown}`, s.onlyTo.token)).status, 200)
  assert.equal((await get(`/api/files/${shown}`, s.onlyFrom.token)).status, 404, 'read as the project it is in')
  assert.equal((await get(`/api/files/${picture}`, s.onlyTo.token)).status, 404, 'and the original as its own')

  // The original, exactly as it was.
  const after_ = await get(`/api/tasks/${id}`, s.token)
  assert.deepEqual({ ...after_.body.task, subscribed: undefined }, { ...before.body.task, subscribed: undefined })
  assert.equal(after_.body.comments.length, 1)
  assert.equal((after_.body.steps as unknown[]).length, 2)
})

test('the lines on each: the copy says where it came from, the original where it went — each to whoever can see the other', async () => {
  const s = await scene()
  const made = await post(`/api/projects/${s.from}/tasks`, s.token, { title: 'Shared plan' })
  const id = made.body.id as string
  const done = await post(`/api/tasks/${id}/copy`, s.token, { project_id: s.to })
  const copyId = done.body.id as string

  type Line = { action: string; object_id: string; meta: Record<string, unknown> }
  const lines = async (token: string, project: string) => (await get(`/api/activity?project=${project}`, token)).body.events as Line[]

  // On the copy: the source, to whoever sees it; nothing of it to whoever does not.
  const seen = (await lines(s.both.token, s.to)).find((e) => e.action === 'task.copy' && e.object_id === copyId)
  assert.equal(seen?.meta.from_project_id, s.from)
  assert.equal(seen?.meta.from_number, made.body.number)
  const unseen = (await lines(s.onlyTo.token, s.to)).find((e) => e.action === 'task.copy' && e.object_id === copyId)
  assert.ok(unseen, 'the copy was made, and says so')
  assert.equal(unseen!.meta.from_project_id, undefined)
  assert.equal(unseen!.meta.from_number, undefined)

  // On the original: where it went, only to whoever can see it there.
  const there = (await lines(s.both.token, s.from)).find((e) => e.action === 'task.copied' && e.object_id === id)
  assert.equal(there?.meta.to_task_id, copyId)
  const hidden = (await lines(s.onlyFrom.token, s.from)).find((e) => e.action === 'task.copied')
  assert.equal(hidden, undefined)
  // Its own history panel asks the same.
  const panel = (await get(`/api/activity?object=${id}`, s.onlyFrom.token)).body.events as Line[]
  assert.equal(
    panel.find((e) => e.action === 'task.copied'),
    undefined,
  )
})

test('who may copy: read it where it is, make tasks where it goes; the same project is a duplicate', async () => {
  const s = await scene()
  const theirs = await post(`/api/projects/${s.from}/tasks`, s.token, { title: 'The owner’s' })

  // Not on the project it would go to: not there for them.
  assert.equal((await post(`/api/tasks/${theirs.body.id}/copy`, s.onlyFrom.token, { project_id: s.to })).status, 404)
  // Cannot read the original: not there for them either.
  assert.equal((await post(`/api/tasks/${theirs.body.id}/copy`, s.onlyTo.token, { project_id: s.to })).status, 404)
  // On both, without the right to make tasks where it goes.
  const noMaking = await addPerson(s.ctx, s.workspaceId, 'member', [s.from], ['task.create'])
  await withActor(
    s.ctx.actorId,
    (tx) => tx`
    insert into project_member (id, workspace_id, project_id, actor_id, added_by, rights)
    values (${uuidv7()}, ${s.workspaceId}, ${s.to}, ${noMaking.actorId}, ${s.ctx.actorId}, ${[] as string[]})`,
  )
  const noMakingToken = await bearerFor(noMaking.actorId, s.workspaceId)
  assert.equal((await post(`/api/tasks/${theirs.body.id}/copy`, noMakingToken, { project_id: s.to })).status, 403)
  // Somebody else's task, read where it is and made where it goes: theirs to copy.
  const ok = await post(`/api/tasks/${theirs.body.id}/copy`, s.both.token, { project_id: s.to })
  assert.equal(ok.status, 201, JSON.stringify(ok.body))
  // Into the same project: a duplicate, with a number of its own.
  const dup = await post(`/api/tasks/${theirs.body.id}/copy`, s.token, { project_id: s.from })
  assert.equal(dup.status, 201)
  assert.notEqual(dup.body.number, theirs.body.number)

  // A part is copied with its task, not alone; an archived project takes nothing.
  const part = await post(`/api/tasks/${theirs.body.id}/steps`, s.token, { title: 'Part' })
  assert.equal((await post(`/api/tasks/${part.body.id}/copy`, s.token, { project_id: s.to })).status, 400)
  const list = await post(`/api/tasks/${theirs.body.id}/copy`, s.token, { project_id: s.to, list_id: s.fromDoing })
  assert.equal(list.status, 400, 'a list of another project')
  await withActor(s.ctx.actorId, (tx) => tx`update project set archived_at = now() where id = ${s.to}`)
  assert.equal((await post(`/api/tasks/${theirs.body.id}/copy`, s.token, { project_id: s.to })).status, 400)

  // Another workspace's project, and another workspace's task: neither is there.
  const other = await makeOwner()
  const elsewhere = await makeProject(other.ctx, other.workspaceId, 'Theirs')
  const foreign = await post(`/api/projects/${elsewhere}/tasks`, other.token, { title: 'Not yours' })
  assert.equal((await post(`/api/tasks/${theirs.body.id}/copy`, s.token, { project_id: elsewhere })).status, 404)
  assert.equal((await post(`/api/tasks/${foreign.body.id}/copy`, s.token, { project_id: s.from })).status, 404)
  const [theirsNow] = await withActor(
    other.ctx.actorId,
    (tx) => tx<{ n: number }[]>`select count(*)::int as n from task where project_id = ${elsewhere}`,
  )
  assert.equal(theirsNow!.n, 1)
})

test('a list by name, else the first open one; a finished task lands open where there is no list of its name', async () => {
  const s = await scene()
  const done = await post(`/api/projects/${s.from}/tasks`, s.token, { title: 'Shipped', list_id: s.fromDone })
  const c = await post(`/api/tasks/${done.body.id}/copy`, s.token, { project_id: s.to })
  assert.equal(c.body.list_id, s.toBacklog)
  const read = await get(`/api/tasks/${c.body.id}`, s.token)
  assert.equal(read.body.task.completed_at, null, 'a copy is work to do there')
  const named = await post(`/api/tasks/${done.body.id}/copy`, s.token, { project_id: s.to, list_id: s.toShipped })
  assert.equal(named.body.list_id, s.toShipped)
})

test('a token for some projects copies inside them only; a tool may copy', async () => {
  const s = await scene()
  const third = await makeProject(s.ctx, s.workspaceId, 'Third')
  const t = await post(`/api/projects/${s.from}/tasks`, s.token, { title: 'Asked by a tool' })
  const tool = await issueApiToken(s.ctx.actorId, s.workspaceId, 'tool', [], 30)
  assert.equal((await post(`/api/tasks/${t.body.id}/copy`, tool, { project_id: s.to })).status, 201)
  const narrow = await issueApiToken(s.ctx.actorId, s.workspaceId, 'narrow', [s.from, s.to], 30)
  assert.equal((await post(`/api/tasks/${t.body.id}/copy`, narrow, { project_id: third })).status, 404, 'its target is outside the token')
  const inThird = await post(`/api/projects/${third}/tasks`, s.token, { title: 'Outside' })
  assert.equal(
    (await post(`/api/tasks/${inThird.body.id}/copy`, narrow, { project_id: s.to })).status,
    404,
    'its source is outside the token',
  )
  assert.equal((await post(`/api/tasks/${t.body.id}/copy`, narrow, { project_id: s.to })).status, 201)
})

test('only the original project’s own files are carried; any other reference keeps its id and its readers', async () => {
  const s = await scene()
  // A project only the owner and onlyFrom are on, with a file in it.
  const secret = await makeProject(s.ctx, s.workspaceId, 'Secret')
  await withActor(
    s.ctx.actorId,
    (tx) => tx`
    insert into project_member (id, workspace_id, project_id, actor_id, added_by)
    values (${uuidv7()}, ${s.workspaceId}, ${secret}, ${s.onlyFrom.actorId}, ${s.ctx.actorId})`,
  )
  const theirs = uuidv7()
  const roomFile = uuidv7()
  const direct = uuidv7()
  const own = uuidv7()
  const room = { id: uuidv7() }
  await withActor(
    s.ctx.actorId,
    (tx) => tx`
    insert into conversation (id, workspace_id, project_id, name) values (${room.id}, ${s.workspaceId}, ${s.from}, 'main')`,
  )
  await withActor(s.ctx.actorId, async (tx) => {
    await tx`insert into file (id, workspace_id, project_id, author_id, name, storage_key, size_bytes)
             values (${theirs}, ${s.workspaceId}, ${secret}, ${s.ctx.actorId}, 'secret.pdf', ${`k/${theirs}`}, 10)`
    await tx`insert into file (id, workspace_id, project_id, author_id, name, storage_key, size_bytes)
             values (${own}, ${s.workspaceId}, ${s.from}, ${s.ctx.actorId}, 'own.png', ${`k/${own}`}, 10)`
    await tx`insert into file (id, workspace_id, project_id, conversation_id, author_id, name, storage_key, size_bytes)
             values (${roomFile}, ${s.workspaceId}, ${s.from}, ${room.id}, ${s.ctx.actorId}, 'room.png', ${`k/${roomFile}`}, 10)`
  })
  // A file sent in a direct conversation between the owner and onlyFrom.
  const dm = await post('/api/conversations/direct', s.token, { actor_ids: [s.onlyFrom.actorId] })
  assert.ok(dm.status < 300, JSON.stringify(dm.body))
  await withActor(
    s.ctx.actorId,
    (tx) => tx`
    insert into file (id, workspace_id, project_id, conversation_id, author_id, name, storage_key, size_bytes)
    values (${direct}, ${s.workspaceId}, null, ${dm.body.id as string}, ${s.ctx.actorId}, 'direct.png', ${`k/${direct}`}, 10)`,
  )
  // onlyFrom writes the secret file — and others — into a task everybody on Website reads.
  const nodes = [theirs, roomFile, direct, own, uuidv7(), 'a'.repeat(36)].map((f) => ({ type: 'attachment', attrs: { fileId: f } }))
  const t = await post(`/api/projects/${s.from}/tasks`, s.onlyFrom.token, { title: 'Look at this', body: doc(...nodes) })
  assert.equal(t.status, 201)

  // The owner, who can read every one of them, copies it to Mobile.
  const dry = await post(`/api/tasks/${t.body.id}/copy`, s.token, { project_id: s.to, dry: true })
  assert.equal(dry.body.files, 1, 'only Website’s own file')
  const c = await post(`/api/tasks/${t.body.id}/copy`, s.token, { project_id: s.to })
  assert.equal(c.status, 201, JSON.stringify(c.body))
  const copied = await get(`/api/tasks/${c.body.id}`, s.token)
  const ids = (copied.body.task.body.content as { attrs: { fileId: string } }[]).map((n) => n.attrs.fileId)
  assert.equal(ids[0], theirs, 'another project’s file keeps its id')
  assert.equal(ids[1], roomFile, 'a room’s file keeps its id')
  assert.equal(ids[2], direct, 'a direct file keeps its id')
  assert.notEqual(ids[3], own, 'Website’s own file is Mobile’s now')
  assert.equal(ids[5], 'a'.repeat(36), 'something that is not an id is left as it is')
  assert.equal((await get(`/api/files/${theirs}`, s.onlyTo.token)).status, 404, 'and Mobile’s readers still cannot open it')
  assert.equal((await get(`/api/files/${ids[3]}`, s.onlyTo.token)).status, 200)
  const [rows] = await withActor(
    s.ctx.actorId,
    (tx) => tx<{ n: number }[]>`
    select count(*)::int as n from file where project_id = ${s.to}`,
  )
  assert.equal(rows!.n, 1)
})

test('the copy keeps its dates; whoever is given a part hears it; a duplicate is the same copy beside the original', async () => {
  const s = await scene()
  const cycle = await post(`/api/projects/${s.from}/cycles`, s.token, { name: 'Sprint 9', starts_on: '2026-11-01', ends_on: '2026-11-14' })
  const t = await post(`/api/projects/${s.from}/tasks`, s.token, {
    title: 'Dated',
    list_id: s.fromDoing,
    cycle_id: cycle.body.id,
    starts_at: '2026-11-03T09:00:00.000Z',
    ends_at: '2026-11-07T17:00:00.000Z',
  })
  const part = await post(`/api/tasks/${t.body.id}/steps`, s.token, { title: 'Theirs' })
  await call('PATCH', `/api/tasks/${part.body.id}`, s.token, { assignee_ids: [s.both.actorId] })
  const notes = async () =>
    (
      await withActor(
        s.both.actorId,
        (tx) => tx<{ n: number }[]>`select count(*)::int as n from notification where actor_id = ${s.both.actorId} and reason = 'assigned'`,
      )
    )[0]!.n
  const before = await notes()

  const c = await post(`/api/tasks/${t.body.id}/copy`, s.token, { project_id: s.to })
  const read = await get(`/api/tasks/${c.body.id}`, s.token)
  assert.equal(new Date(read.body.task.starts_at).toISOString(), '2026-11-03T09:00:00.000Z')
  assert.equal(new Date(read.body.task.ends_at).toISOString(), '2026-11-07T17:00:00.000Z')
  assert.equal(await notes(), before + 1, 'given the copied part, and told so')

  // Duplicate: under the original, its list and its sprint kept, through the same copy.
  const dup = await post(`/api/tasks/${t.body.id}/duplicate`, s.token, {})
  assert.equal(dup.status, 201)
  const d = await get(`/api/tasks/${dup.body.id}`, s.token)
  assert.equal(d.body.task.project_id, s.from)
  assert.equal(d.body.task.list_id, s.fromDoing)
  assert.equal(d.body.task.cycle_id, cycle.body.id)
  assert.equal((d.body.steps as unknown[]).length, 1)
  const order = await withActor(
    s.ctx.actorId,
    (tx) => tx<{ id: string }[]>`
    select id from task where project_id = ${s.from} and list_id = ${s.fromDoing} and parent_id is null order by sort_key`,
  )
  const at = order.findIndex((r) => r.id === t.body.id)
  assert.equal(order[at + 1]?.id, dup.body.id, 'directly under the original')
  // A part duplicates beside itself, under the same task.
  const partDup = await post(`/api/tasks/${part.body.id}/duplicate`, s.token, {})
  assert.equal(partDup.status, 201)
  const pd = await get(`/api/tasks/${partDup.body.id}`, s.token)
  assert.equal(pd.body.task.parent_id, t.body.id)
})
