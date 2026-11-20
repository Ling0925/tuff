import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { app } from '../src/http/routes.js'
import { closeDb, withActor, uuidv7, makeOwner, addPerson, makeProject, bearerFor } from './helpers.js'
import { asWorker, withoutActor } from '../src/db.js'
import { digestOffLink, digestOffValid, remindDue } from '../src/digest.js'

/*
 * What reaches you — `docs/specs/notifications.md`.
 */

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

const line = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })

/* Every note, waiting or not: the waiting is a thing these tests look at. */
async function notes(actorId: string) {
  return withActor(
    actorId,
    (tx) =>
      tx<{ reason: string; what: string | null; object_id: string; deliver_after: Date }[]>`
      select reason::text, what, object_id, deliver_after from notification
      where actor_id = ${actorId} and deleted_at is null order by created_at`,
  )
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

test('the person given a task follows it, and hears who wrote on it', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const p = await makeProject(ctx, workspaceId, 'Acme')
  const sam = await addPerson(ctx, workspaceId, 'member', [p])
  const id = await task(ctx.actorId, workspaceId, p, 'Do it')

  assert.equal((await call(`/api/tasks/${id}`, token, { method: 'PATCH', body: { assignee_id: sam.actorId } })).status, 200)
  const given = await notes(sam.actorId)
  assert.deepEqual(
    given.map((n) => n.reason),
    ['assigned'],
  )
  assert.match(given[0]!.what ?? '', /gave it to you$/)

  // Given it, they follow it: a comment after reaches them, saying who.
  assert.equal((await call(`/api/tasks/${id}/comments`, token, { method: 'POST', body: { body: line('done?') } })).status, 201)
  const after_ = await notes(sam.actorId)
  assert.deepEqual(
    after_.map((n) => n.reason),
    ['assigned', 'subscribed'],
  )
  assert.match(after_[1]!.what ?? '', /commented$/)
  // Never what was said: a push puts the line on a lock screen.
  assert.doesNotMatch(after_[1]!.what ?? '', /done\?/)
})

test('watchers hear what moved, not a save of nothing or a rename, and a burst is one note', async () => {
  const { ctx, workspaceId } = await makeOwner()
  const p = await makeProject(ctx, workspaceId, 'Acme')
  const sam = await addPerson(ctx, workspaceId, 'member', [p], ['task.create', 'edit.any'])
  const id = await task(ctx.actorId, workspaceId, p, 'Do it')
  const samToken = await bearerFor(sam.actorId, workspaceId)
  const { token } = await (async () => ({ token: await bearerFor(ctx.actorId, workspaceId) }))()
  const list = await call(`/api/projects/${p}/lists`, token, { method: 'POST', body: { name: 'Doing' } })
  const done = { id: String(list.body.id) }
  // The owner watches it; Sam does the changing.
  const watcher = ctx.actorId
  await withActor(
    watcher,
    (tx) =>
      tx`insert into subscription (id, workspace_id, object_type, object_id, actor_id)
       values (${uuidv7()}, ${workspaceId}, 'task', ${id}, ${watcher})`,
  )

  assert.equal((await call(`/api/tasks/${id}`, samToken, { method: 'PATCH', body: { title: 'Do it' } })).status, 200)
  assert.equal((await call(`/api/tasks/${id}`, samToken, { method: 'PATCH', body: { title: 'Do it now' } })).status, 200)
  assert.equal((await notes(watcher)).length, 0, 'nothing, and a rename, tell nobody')

  assert.equal((await call(`/api/tasks/${id}`, samToken, { method: 'PATCH', body: { list_id: done!.id } })).status, 200)
  assert.equal((await call(`/api/tasks/${id}`, samToken, { method: 'PATCH', body: { due_on: '2030-10-31' } })).status, 200)
  const told = await notes(watcher)
  assert.equal(told.length, 1, 'a move and a date in a burst are one note')
  assert.equal(told[0]!.reason, 'subscribed')
  assert.match(told[0]!.what ?? '', /set the due date to 31 Oct$/)
  // And it waits, so the burst has time to land in it.
  assert.ok(told[0]!.deliver_after.getTime() > Date.now())
})

test('an announcement reaches everybody on its project', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const p = await makeProject(ctx, workspaceId, 'Acme')
  const elsewhere = await makeProject(ctx, workspaceId, 'Other')
  const sam = await addPerson(ctx, workspaceId, 'member', [p])
  const ada = await addPerson(ctx, workspaceId, 'member', [elsewhere])

  const made = await call(`/api/projects/${p}/posts`, token, { method: 'POST', body: { title: 'Live on Monday', body: line('it is') } })
  assert.equal(made.status, 201)
  const told = await notes(sam.actorId)
  assert.deepEqual(
    told.map((n) => n.reason),
    ['posted'],
  )
  assert.match(told[0]!.what ?? '', /posted$/)
  assert.equal((await notes(ada.actorId)).length, 0, 'not somebody off the project')
  assert.equal((await notes(ctx.actorId)).length, 0, 'not whoever posted it')

  // A draft tells nobody.
  await call(`/api/projects/${p}/posts`, token, { method: 'POST', body: { title: 'Draft', body: line('x'), publish: false } })
  assert.equal((await notes(sam.actorId)).length, 1)
})

test('a reply reaches the thread, through Mentions only but not through Nothing', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const p = await makeProject(ctx, workspaceId, 'Acme')
  const sam = await addPerson(ctx, workspaceId, 'member', [p])
  const ada = await addPerson(ctx, workspaceId, 'member', [p])
  const room = uuidv7()
  await withActor(ctx.actorId, async (tx) => {
    await tx`insert into conversation (id, workspace_id, project_id, name, channel) values (${room}, ${workspaceId}, ${p}, 'main', true)`
    for (const who of [ctx.actorId, sam.actorId, ada.actorId]) {
      await tx`
        insert into conversation_member (id, workspace_id, conversation_id, actor_id, joined_at)
        values (${uuidv7()}, ${workspaceId}, ${room}, ${who}, now())`
    }
    await tx`update conversation_member set notify = 'mentions' where conversation_id = ${room} and actor_id = ${sam.actorId}`
    await tx`update conversation_member set notify = 'none' where conversation_id = ${room} and actor_id = ${ada.actorId}`
  })
  const samToken = await bearerFor(sam.actorId, workspaceId)
  const adaToken = await bearerFor(ada.actorId, workspaceId)
  const started = await call(`/api/conversations/${room}/messages`, samToken, { method: 'POST', body: { body: line('who has the file?') } })
  assert.equal(started.status, 201)
  const parent = String(started.body.id)
  await call(`/api/conversations/${room}/messages`, adaToken, { method: 'POST', body: { body: line('me'), parent_id: parent } })
  await call(`/api/conversations/${room}/messages`, token, { method: 'POST', body: { body: line('thanks'), parent_id: parent } })

  assert.deepEqual(
    (await notes(sam.actorId)).map((n) => n.reason),
    ['replied'],
    'one note for the thread, merged',
  )
  assert.equal((await notes(ada.actorId)).length, 0, 'Nothing is nothing')
})

test('@everyone calls the whole room', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const p = await makeProject(ctx, workspaceId, 'Acme')
  const sam = await addPerson(ctx, workspaceId, 'member', [p])
  const room = uuidv7()
  await withActor(ctx.actorId, async (tx) => {
    await tx`insert into conversation (id, workspace_id, project_id, name, channel) values (${room}, ${workspaceId}, ${p}, 'main', true)`
  })
  const body = {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'mention', attrs: { id: 'everyone', label: 'everyone' } }] }],
  }
  assert.equal((await call(`/api/conversations/${room}/messages`, token, { method: 'POST', body: { body } })).status, 201)
  assert.deepEqual(
    (await notes(sam.actorId)).map((n) => n.reason),
    ['mentioned'],
  )
})

test('somebody put on a project is told, once', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const p = await makeProject(ctx, workspaceId, 'Acme')
  const sam = await addPerson(ctx, workspaceId, 'member', [])
  for (let i = 0; i < 2; i++) {
    assert.equal((await call(`/api/projects/${p}/members`, token, { method: 'POST', body: { actor_id: sam.actorId } })).status, 200)
  }
  const told = await notes(sam.actorId)
  assert.deepEqual(
    told.map((n) => n.reason),
    ['added'],
  )
  assert.equal(told[0]!.object_id, p)
})

test('a date is reminded the morning before, once', async () => {
  const { ctx, workspaceId } = await makeOwner()
  const p = await makeProject(ctx, workspaceId, 'Acme')
  /* A zone where it is after nine now, whatever the hour here: the offsets
     span more than a day, so one of them always is. */
  const [zone] = await withoutActor(
    (tx) =>
      tx<{ name: string; tomorrow: string }[]>`
      select name, ((now() at time zone name)::date + 1)::text as tomorrow from pg_timezone_names
      where name like 'Etc/GMT%' and (now() at time zone name)::time between time '09:30' and time '23:00'
      order by name limit 1`,
  )
  await withActor(ctx.actorId, (tx) => tx`update app_user set timezone = ${zone!.name} where actor_id = ${ctx.actorId}`)
  const id = uuidv7()
  await withActor(ctx.actorId, async (tx) => {
    await tx`
      insert into task (id, workspace_id, project_id, author_id, title, sort_key, assignee_ids, due_on)
      values (${id}, ${workspaceId}, ${p}, ${ctx.actorId}, 'Ship it', 'a0', array[${ctx.actorId}]::uuid[], ${zone!.tomorrow})`
  })
  await remindDue()
  await remindDue()
  const told = (await notes(ctx.actorId)).filter((n) => n.object_id === id)
  assert.deepEqual(
    told.map((n) => [n.reason, n.what]),
    [['due', 'Due tomorrow']],
  )
})

test("the day's email is owed for what is unread, and its link turns it off for one person", async () => {
  const { ctx, workspaceId } = await makeOwner()
  const p = await makeProject(ctx, workspaceId, 'Acme')
  const sam = await makeOwner()
  await withActor(ctx.actorId, async (tx) => {
    await tx`insert into membership (id, workspace_id, actor_id, role, invited_by, joined_at) values (${uuidv7()}, ${workspaceId}, ${sam.ctx.actorId}, 'member', ${ctx.actorId}, now())`
    await tx`insert into project_member (id, workspace_id, project_id, actor_id) values (${uuidv7()}, ${workspaceId}, ${p}, ${sam.ctx.actorId})`
  })
  const id = await task(ctx.actorId, workspaceId, p, 'Old news')
  /* In their day, out of quiet hours, verified, and unread for five hours. */
  const [zone] = await withoutActor(
    (tx) =>
      tx<{ name: string }[]>`
      select name from pg_timezone_names
      where name like 'Etc/GMT%' and (now() at time zone name)::time between time '09:00' and time '19:00'
      order by name limit 1`,
  )
  await withActor(
    sam.ctx.actorId,
    (tx) => tx`update app_user set timezone = ${zone!.name}, quiet_from = null, quiet_to = null where actor_id = ${sam.ctx.actorId}`,
  )
  await withActor(sam.ctx.actorId, async (tx) => {
    await tx`
      insert into notification (id, workspace_id, actor_id, reason, object_type, object_id, deliver_after, created_at, what)
      values (${uuidv7()}, ${workspaceId}, ${sam.ctx.actorId}, 'subscribed', 'task', ${id},
              now() - interval '5 hours', now() - interval '5 hours', 'Owner commented')`
  })
  const owed = await asWorker((tx) => tx<{ actor_id: string }[]>`select actor_id from digest_due()`)
  assert.ok(owed.some((o) => o.actor_id === sam.ctx.actorId))
  const claimed = await asWorker((tx) => tx<{ what: string }[]>`select what from digest_claim(${sam.ctx.actorId})`)
  assert.deepEqual(
    claimed.map((c) => c.what),
    ['Owner commented'],
  )
  const again = await asWorker((tx) => tx<{ actor_id: string }[]>`select actor_id from digest_due()`)
  assert.ok(!again.some((o) => o.actor_id === sam.ctx.actorId), 'never twice a day, never the same note twice')

  const link = new URL(digestOffLink(sam.ctx.actorId), 'http://x')
  assert.ok(digestOffValid(sam.ctx.actorId, link.searchParams.get('t')!))
  assert.ok(!digestOffValid(ctx.actorId, link.searchParams.get('t')!), 'signed for one person')
  const at = `/digest/off?u=${sam.ctx.actorId}&t=${link.searchParams.get('t')}`
  const digestOn = async () =>
    (
      await withActor(
        sam.ctx.actorId,
        (tx) => tx<{ email_digest: boolean }[]>`select email_digest from app_user where actor_id = ${sam.ctx.actorId}`,
      )
    )[0]!.email_digest
  // Opened, it asks: a scanner that follows every link turns nothing off.
  assert.equal((await app.request(at)).status, 200)
  assert.equal(await digestOn(), true)
  // Pressed — the button, or the mail client's own Unsubscribe — it does.
  const off = await app.request(at, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'List-Unsubscribe=One-Click',
  })
  assert.equal(off.status, 200)
  const [row] = await withActor(
    sam.ctx.actorId,
    (tx) => tx<{ email_digest: boolean }[]>`select email_digest from app_user where actor_id = ${sam.ctx.actorId}`,
  )
  assert.equal(row!.email_digest, false)
  assert.equal((await app.request(`/digest/off?u=${ctx.actorId}&t=${link.searchParams.get('t')}`)).status, 400)
})
