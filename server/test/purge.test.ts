import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import postgres from 'postgres'
import { app } from '../src/http/routes.js'
import { closeRealtime } from '../src/realtime.js'
import { issueApiToken } from '../src/auth/flows.js'
import { addManager, asWorker, bearerFor, closeDb, makeOwner, stamp, uuidv7, withActor } from './helpers.js'

/*
 * A project gone for good — `docs/specs/projects-index.md`.
 *
 * Counted as the table owner, because row-level security hides a deleted
 * project and everything under it from everybody: asked as the application,
 * "nothing left" and "nothing visible" read the same.
 */
const owner = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} })

const queued: string[] = []
after(async () => {
  if (queued.length) await owner`delete from storage_orphan where key = any(${queued})`
  await owner.end()
  await closeRealtime()
  await closeDb()
})

const asked = (token: string, path: string, method = 'GET', body?: unknown) =>
  app.request(`/api${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

/** A project with something in every corner of it: a task, a comment on it, a
    message in its room, a file, and an invite that names it. */
async function aFullProject(token: string, actorId: string, workspaceId: string) {
  const made = await asked(token, '/projects', 'POST', { name: `Full ${stamp().slice(0, 6)}` })
  assert.equal(made.status, 201)
  const project = ((await made.json()) as { id: string }).id

  const t = await asked(token, `/projects/${project}/tasks`, 'POST', { title: 'Something to do' })
  assert.equal(t.status, 201)
  const task = ((await t.json()) as { id: string }).id
  const c = await asked(token, `/tasks/${task}/comments`, 'POST', {
    body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Said' }] }] },
  })
  assert.equal(c.status, 201)

  const key = `test/purge-${stamp()}`
  queued.push(key)
  await withActor(actorId, async (tx) => {
    const [room] = await tx<{ id: string }[]>`
      select id from conversation where project_id = ${project} limit 1`
    if (room) {
      await tx`
        insert into message (id, workspace_id, conversation_id, author_id, body)
        values (${uuidv7()}, ${workspaceId}, ${room.id}, ${actorId},
                ${tx.json({ type: 'doc', content: [] })})`
    }
    await tx`
      insert into file (id, workspace_id, project_id, author_id, name, storage_key, size_bytes, uploaded_at)
      values (${uuidv7()}, ${workspaceId}, ${project}, ${actorId}, 'a.txt', ${key}, 1, now())`
  })
  const invite = uuidv7()
  await owner`
    insert into invite (id, workspace_id, role, project_ids, token_hash, created_by, expires_at)
    values (${invite}, ${workspaceId}, 'member', ${[project]}, ${'h' + stamp()}, ${actorId},
            now() + interval '1 day')`
  return { project, task, key, invite }
}

async function whatIsLeft(project: string) {
  const [r] = await owner<{ n: number }[]>`
    select (select count(*) from project where id = ${project})
         + (select count(*) from task where project_id = ${project})
         + (select count(*) from conversation where project_id = ${project})
         + (select count(*) from file where project_id = ${project})
         + (select count(*) from comment where project_id = ${project})
         + (select count(*) from activity_event where project_id = ${project})
         + (select count(*) from project_member where project_id = ${project}) as n`
  return Number(r!.n)
}

test('a project in the bin goes for good, with everything it held — by the owner alone', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const { project, key, invite } = await aFullProject(token, ctx.actorId, workspaceId)

  // A live project is not in the bin, so there is nothing to take for good.
  assert.equal((await asked(token, `/projects/${project}/forever`, 'DELETE')).status, 404)

  assert.equal((await asked(token, `/projects/${project}`, 'DELETE')).status, 200)

  // Whoever runs the project may bin it and may not end it.
  const manager = await addManager(ctx, workspaceId, [project])
  const managerSaid = await asked(await bearerFor(manager.actorId, workspaceId), `/projects/${project}/forever`, 'DELETE')
  assert.equal(managerSaid.status, 403)
  // Nor may the owner's own token.
  const agent = await issueApiToken(ctx.actorId, workspaceId, 'agent')
  assert.equal((await asked(agent, `/projects/${project}/forever`, 'DELETE')).status, 403)
  assert.ok((await whatIsLeft(project)) > 0, 'nothing was taken by the refusals')

  const done = await asked(token, `/projects/${project}/forever`, 'DELETE')
  assert.equal(done.status, 200)
  assert.equal(await whatIsLeft(project), 0)

  const [orphan] = await owner`select key from storage_orphan where key = ${key}`
  assert.ok(orphan, "the file's bytes are queued for the worker")
  const [inv] = await owner<{ project_ids: string[] }[]>`select project_ids from invite where id = ${invite}`
  assert.deepEqual(inv!.project_ids, [], 'the invite no longer names it')
  const [said] = await owner<{ n: number }[]>`
    select count(*)::int as n from security_event
    where workspace_id = ${workspaceId} and kind = 'project.purged'`
  assert.equal(said!.n, 1)

  // And it is gone from the bin.
  const bin = (await (await asked(token, '/projects/deleted')).json()) as { projects: { id: string }[] }
  assert.ok(!bin.projects.some((p) => p.id === project))
})

test('another workspace’s project in the bin is not found, even by its own owner from here', async () => {
  const a = await makeOwner()
  const b = await makeOwner()
  const { project } = await aFullProject(a.token, a.ctx.actorId, a.workspaceId)
  assert.equal((await asked(a.token, `/projects/${project}`, 'DELETE')).status, 200)
  assert.equal((await asked(b.token, `/projects/${project}/forever`, 'DELETE')).status, 404)
  assert.ok((await whatIsLeft(project)) > 0)
})

/*
 * The clear-out could not take a binned project before: its tasks held the
 * row, and meeting a row it could not remove, `purge_deleted` gave up on
 * every other table too. Asked as the worker asks — the application, with
 * nobody acting.
 */
test('the clear-out takes a project past its days whole, and goes on to the rest', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const { project, key } = await aFullProject(token, ctx.actorId, workspaceId)
  assert.equal((await asked(token, `/projects/${project}`, 'DELETE')).status, 200)

  // And, elsewhere, a task deleted long ago, which the generic pass removes.
  const kept = await aFullProject(token, ctx.actorId, workspaceId)
  assert.equal((await asked(token, `/tasks/${kept.task}`, 'DELETE')).status, 200)

  /* Ten years, not forty days: the tests share the development database,
     and a clear-out at thirty days would take whatever else is there. */
  await owner`update project set deleted_at = now() - interval '10 years 7 days' where id = ${project}`
  await owner`update task set deleted_at = now() - interval '10 years 7 days' where id = ${kept.task}`

  await asWorker((tx) => tx`select purge_deleted(3653)`)

  assert.equal(await whatIsLeft(project), 0)
  const [task] = await owner`select id from task where id = ${kept.task}`
  assert.equal(task, undefined, 'the rest of the clear-out ran')
  assert.ok((await whatIsLeft(kept.project)) > 0, 'a live project is untouched')

  // The worker's half: the key comes off the queue for removal.
  const keys = await asWorker((tx) => tx<{ key: string }[]>`select storage_orphans(1000000) as key`)
  assert.ok(keys.some((k) => k.key === key))
})

test('a key some row still names is kept, not removed', async () => {
  const { ctx, workspaceId } = await makeOwner()
  const key = `test/shared-${stamp()}`
  queued.push(key)
  const [one, two] = [uuidv7(), uuidv7()]
  const project = uuidv7()
  await withActor(ctx.actorId, async (tx) => {
    await tx`insert into project (id, workspace_id, name) values (${project}, ${workspaceId}, 'Shared')`
    for (const id of [one, two]) {
      await tx`
        insert into file (id, workspace_id, project_id, author_id, name, storage_key, size_bytes, uploaded_at)
        values (${id}, ${workspaceId}, ${project}, ${ctx.actorId}, 'same.txt', ${key}, 1, now())`
    }
  })
  await owner`delete from file where id = ${one}`
  const keys = await asWorker((tx) => tx<{ key: string }[]>`select storage_orphans(1000000) as key`)
  assert.ok(!keys.some((k) => k.key === key), 'the other file still points at it')
  const [left] = await owner`select key from storage_orphan where key = ${key}`
  assert.equal(left, undefined, 'and it is off the queue')
})
