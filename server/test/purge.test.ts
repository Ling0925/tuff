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
         + (select count(*) from project_member where project_id = ${project})
         + (select count(*) from github_link where project_id = ${project})
         + (select count(*) from github_pull where project_id = ${project})
         + (select count(*) from github_pull_task where project_id = ${project})
         + (select count(*) from github_issue where project_id = ${project})
         + (select count(*) from github_comment where project_id = ${project})
         + (select count(*) from github_out where project_id = ${project}) as n`
  return Number(r!.n)
}

/**
 * A repository linked to the project, with something in each of GitHub's
 * tables: a pull request naming its task, the task paired with an issue,
 * its comment mirrored, a change still owed. Unlinked, the link is stamped
 * and kept, as `DELETE /api/projects/:id/github` leaves it, and so are the
 * rows under it. Written as the table owner: what is being tested is the
 * purge, not how GitHub's webhooks fill these.
 */
async function aRepository(project: string, task: string, actorId: string, workspaceId: string, unlinked = false) {
  const n = () => Math.floor(Math.random() * 1e12)
  const [link, pull] = [uuidv7(), uuidv7()]
  const [comment] = await owner<{ id: string }[]>`select id from comment where object_id = ${task} limit 1`
  assert.ok(comment, 'the task has a comment to mirror')
  // One installation a workspace.
  const [had] = await owner<{ id: string }[]>`
    select id from github_install where workspace_id = ${workspaceId} and deleted_at is null`
  const install = had?.id ?? uuidv7()
  if (!had) {
    await owner`insert into github_install (id, workspace_id, installation_id, account_login, account_type, installed_by)
                values (${install}, ${workspaceId}, ${n()}, 'acme', 'Organization', ${actorId})`
  }
  await owner`insert into github_link (id, workspace_id, project_id, install_id, repo_id, repo_name, private, issues, linked_by, deleted_at)
              values (${link}, ${workspaceId}, ${project}, ${install}, ${n()}, 'acme/web', true, true, ${actorId},
                      ${unlinked ? new Date() : null})`
  await owner`insert into github_pull (id, workspace_id, project_id, link_id, number, title, url, state)
              values (${pull}, ${workspaceId}, ${project}, ${link}, 7, 'Fix it', 'https://github.com/acme/web/pull/7', 'open')`
  await owner`insert into github_pull_task (workspace_id, project_id, pull_id, task_id, closes)
              values (${workspaceId}, ${project}, ${pull}, ${task}, true)`
  await owner`insert into github_issue (workspace_id, project_id, link_id, task_id, number)
              values (${workspaceId}, ${project}, ${link}, ${task}, 3)`
  await owner`insert into github_comment (workspace_id, project_id, comment_id, github_id, seen_body)
              values (${workspaceId}, ${project}, ${comment.id}, ${n()}, 'Said')`
  /* Sent already: the queue is the whole database's, and a row waiting in
     it is claimed by whichever GitHub test drains it next. */
  await owner`insert into github_out (id, workspace_id, project_id, kind, object_id, actor_id, done_at)
              values (${uuidv7()}, ${workspaceId}, ${project}, 'task', ${task}, ${actorId}, now())`
  return { install }
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

/*
 * The GitHub tables came after `purge_project_rows` and were never
 * added to it, and unlinking stamps the link rather than removing it: a
 * project that had a repository once answered `400 invalid` to Delete for
 * good, and the clear-out passed it over every hour.
 */
test('a project with a repository, linked or unlinked, goes for good — and the installation stays', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  for (const unlinked of [false, true]) {
    const { project, task } = await aFullProject(token, ctx.actorId, workspaceId)
    const { install } = await aRepository(project, task, ctx.actorId, workspaceId, unlinked)
    assert.equal((await asked(token, `/projects/${project}`, 'DELETE')).status, 200)

    const done = await asked(token, `/projects/${project}/forever`, 'DELETE')
    assert.equal(done.status, 200, unlinked ? 'an unlinked repository' : 'a linked repository')
    assert.equal(await whatIsLeft(project), 0)
    // The installation is the workspace's, not the project's.
    const [still] = await owner`select id from github_install where id = ${install}`
    assert.ok(still, 'the GitHub installation is kept')
  }
})

test('the clear-out takes a project with a repository, linked or unlinked, past its days', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const projects: string[] = []
  for (const unlinked of [false, true]) {
    const { project, task } = await aFullProject(token, ctx.actorId, workspaceId)
    await aRepository(project, task, ctx.actorId, workspaceId, unlinked)
    assert.equal((await asked(token, `/projects/${project}`, 'DELETE')).status, 200)
    await owner`update project set deleted_at = now() - interval '10 years 7 days' where id = ${project}`
    projects.push(project)
  }
  // And one beside them with a repository and no reason to go.
  const live = await aFullProject(token, ctx.actorId, workspaceId)
  await aRepository(live.project, live.task, ctx.actorId, workspaceId)

  await asWorker((tx) => tx`select purge_deleted(3653)`)

  for (const project of projects) assert.equal(await whatIsLeft(project), 0)
  const [kept] = await owner<{ n: number }[]>`
    select (select count(*) from github_link where project_id = ${live.project})
         + (select count(*) from github_issue where project_id = ${live.project})
         + (select count(*) from github_comment where project_id = ${live.project})
         + (select count(*) from github_out where project_id = ${live.project}) as n`
  assert.equal(Number(kept!.n), 4, 'a live project’s GitHub rows are untouched')
})

/*
 * What `purge_project_rows` deletes by name. Every foreign key in the
 * database that points at one of these — or at anything that goes with one
 * of them by cascade — either goes with its row by itself (cascade, or set
 * null on a column that may be null) or is one of REVIEWED below. A table
 * or a key added later that names a project, a task or a comment with a
 * plain foreign key fails here, rather than making projects that cannot be
 * deleted, which is what the GitHub tables did for a year.
 */
const PURGED = [
  'github_pull_task',
  'github_comment',
  'github_issue',
  'github_pull',
  'github_out',
  'github_link',
  'message',
  'conversation_member',
  'task_label',
  'time_entry',
  'comment',
  'subscription',
  'notification',
  'object_link',
  'sidebar_place',
  'activity_event',
  'task',
  'file',
  'conversation',
  'task_list',
  'cycle',
  'label',
  'post',
  'project_member',
  'project',
]

/*
 * The plain foreign keys from a PURGED table into what goes, each read
 * against the function's `where`: the rows that can point at what goes are
 * among the rows it deletes, in the same statement or an earlier one.
 * Being on PURGED is not enough by itself — a `message.task_id` would come
 * from a purged table and still hold, since messages go by their room — so
 * a new key fails until somebody reads it and adds it here.
 */
const REVIEWED = [
  // By `project_id = p`, or by the project's rooms, tasks, comments or links.
  'activity_event_project_id_fkey',
  'comment_project_id_fkey',
  'conversation_project_id_fkey',
  'cycle_project_id_fkey',
  'file_project_id_fkey',
  'label_project_id_fkey',
  'post_project_id_fkey',
  'project_member_project_id_fkey',
  'task_list_project_id_fkey',
  'task_project_id_fkey',
  'time_entry_project_id_fkey',
  'github_comment_project_id_fkey',
  'github_issue_project_id_fkey',
  'github_link_project_id_fkey',
  'github_out_project_id_fkey',
  'github_pull_project_id_fkey',
  'github_pull_task_project_id_fkey',
  'conversation_member_conversation_id_fkey',
  'file_conversation_id_fkey',
  'message_conversation_id_fkey',
  'task_label_task_id_fkey',
  'github_comment_comment_id_fkey',
  'github_issue_link_id_fkey',
  'github_pull_link_id_fkey',
  // Within one table and one project, gone in one statement: a reply with
  // what it answers, a part with its task, a file with its folder or document.
  'comment_parent_id_fkey',
  'message_parent_id_fkey',
  'task_parent_id_fkey',
  'file_folder_id_fkey',
  'file_held_by_a_document',
  // A task's own list and cycle, which are its project's.
  'task_cycle_id_fkey',
  'task_list_id_fkey',
]

test('every foreign key into what a purge deletes is deleted by it or goes by itself', async () => {
  const fks = await owner<{ tbl: string; ref: string; del: string; name: string; not_null: boolean }[]>`
    select c.conrelid::regclass::text as tbl, c.confrelid::regclass::text as ref,
           c.confdeltype as del, c.conname as name,
           exists (select 1 from pg_attribute a
                   where a.attrelid = c.conrelid and a.attnum = any(c.conkey) and a.attnotnull) as not_null
    from pg_constraint c
    where c.contype = 'f' and c.connamespace = 'public'::regnamespace`
  assert.ok(
    fks.some((f) => f.ref === 'project' && f.tbl === 'github_link'),
    'the catalogue is read: github_link names project',
  )

  // What goes: the list, and whatever its rows take with them by cascade.
  const gone = new Set(PURGED)
  for (let grew = true; grew; ) {
    grew = false
    for (const f of fks) {
      if (gone.has(f.ref) && f.del === 'c' && !gone.has(f.tbl)) {
        gone.add(f.tbl)
        grew = true
      }
    }
  }
  const into = fks.filter((f) => gone.has(f.ref))
  const holding = into
    .filter((f) => f.del !== 'c' && f.del !== 'n' && !(PURGED.includes(f.tbl) && REVIEWED.includes(f.name)))
    .map((f) => `${f.tbl} → ${f.ref} (${f.name})`)
    .sort()
  assert.deepEqual(
    holding,
    [],
    'delete its rows in purge_project_rows and add it to REVIEWED (and its table to PURGED), or make the key cascade',
  )
  // Set null on a column that may not be null fails the delete as surely.
  const cannotBeNull = into
    .filter((f) => f.del === 'n' && f.not_null)
    .map((f) => `${f.tbl} → ${f.ref} (${f.name})`)
    .sort()
  assert.deepEqual(cannotBeNull, [], '`on delete set null` on a not-null column')
  // And nothing on REVIEWED is stale: each is still a plain key into what goes.
  const stale = REVIEWED.filter((n) => !into.some((f) => f.name === n && f.del !== 'c' && f.del !== 'n'))
  assert.deepEqual(stale, [], 'on REVIEWED but no longer a plain key into what a purge deletes')

  // And the list is what the function does.
  const [fn] = await owner<{ src: string }[]>`select prosrc as src from pg_proc where proname = 'purge_project_rows'`
  const missing = PURGED.filter((t) => !new RegExp(`\\bdelete from ${t}\\b`).test(fn!.src))
  assert.deepEqual(missing, [], 'on PURGED but not deleted by purge_project_rows')
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
