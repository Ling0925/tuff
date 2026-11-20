import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { closeDb, withActor, inWorkspace, uuidv7, makeOwner, addPerson, makeProject, bearerFor } from './helpers.js'
import { app } from '../src/http/routes.js'
import { linkMentionedObjects, mentionedIds, notify } from '../src/notify.js'
import { closeRealtime, subscribe } from '../src/realtime.js'

after(async () => {
  await closeRealtime()
  await closeDb()
})

const doc = (t: string) => ({ type: 'doc', content: [{ type: 'text', text: t }] })

async function task(ownerId: string, ws: string, project: string, title: string) {
  const id = uuidv7()
  await withActor(ownerId, async (tx) => {
    await tx`
      insert into task (id, workspace_id, project_id, author_id, title, sort_key)
      values (${id}, ${ws}, ${project}, ${ownerId}, ${title}, 'a0')`
  })
  return id
}

async function unread(actorId: string) {
  return withActor(actorId, async (tx) => {
    const rows = await tx<{ reason: string }[]>`
      select reason from notification
      where actor_id = ${actorId} and read_at is null and deleted_at is null
        and deliver_after <= now()`
    return rows.map((r) => r.reason)
  })
}

test('being assigned puts it in your inbox, doing it yourself does not', async () => {
  const { ctx, workspaceId } = await makeOwner()
  const p = await makeProject(ctx, workspaceId, 'Acme')
  const sam = await addPerson(ctx, workspaceId, 'member', [p])
  const id = await task(ctx.actorId, workspaceId, p, 'Do it')

  await withActor(ctx.actorId, async (tx) => {
    await notify(tx, ctx, { objectType: 'task', objectId: id, assignees: [sam.actorId, ctx.actorId] })
  })

  assert.deepEqual(await unread(sam.actorId), ['assigned'])
  // An inbox that reports your own actions back to you is one people learn to
  // ignore, so the actor is never a target.
  assert.deepEqual(await unread(ctx.actorId), [])
})

test('a mention outranks a subscription', async () => {
  const { ctx, workspaceId } = await makeOwner()
  const p = await makeProject(ctx, workspaceId, 'Acme')
  const sam = await addPerson(ctx, workspaceId, 'member', [p])
  const id = await task(ctx.actorId, workspaceId, p, 'Do it')

  await withActor(sam.actorId, async (tx) => {
    await tx`
      insert into subscription (id, workspace_id, object_type, object_id, actor_id)
      values (${uuidv7()}, ${workspaceId}, 'task', ${id}, ${sam.actorId})`
  })
  await withActor(ctx.actorId, async (tx) => {
    await notify(tx, ctx, {
      objectType: 'task',
      objectId: id,
      body: doc(`hey @${sam.actorId} look`),
    })
  })
  // Addressed to you beats keeping an eye on it: one row, and it says why.
  assert.deepEqual(await unread(sam.actorId), ['mentioned'])
})

test('a mention is found in the body', () => {
  const id = '01a0bfe6-ac50-7000-8000-000000000000'
  assert.deepEqual(mentionedIds(doc(`ping @${id} please`)), [id])
  assert.deepEqual(mentionedIds(doc('no mention here')), [])
})

test('a mention node from the chat line is found too', () => {
  const id = '01a0bfe6-ac50-7000-8000-000000000001'
  const body = {
    type: 'doc',
    content: [
      {
        type: 'bulletList',
        content: [
          {
            type: 'listItem',
            content: [
              {
                type: 'paragraph',
                content: [
                  { type: 'text', text: 'over to ' },
                  { type: 'mention', attrs: { id, label: 'Sam' } },
                ],
              },
            ],
          },
        ],
      },
    ],
  }
  assert.deepEqual(mentionedIds(body), [id])
  // A label is not an id: a node naming somebody without one calls nobody.
  assert.deepEqual(mentionedIds({ type: 'doc', content: [{ type: 'mention', attrs: { id: 'sam', label: 'Sam' } }] }), [])
})

test('chat can be switched off without switching off the rest', async () => {
  const { ctx, workspaceId } = await makeOwner()
  const p = await makeProject(ctx, workspaceId, 'Acme')
  const sam = await makeOwner()
  await withActor(ctx.actorId, async (tx) => {
    await tx`
      insert into membership (id, workspace_id, actor_id, role, invited_by, joined_at)
      values (${uuidv7()}, ${workspaceId}, ${sam.ctx.actorId}, 'member', ${ctx.actorId}, now())`
    await tx`
      insert into project_member (id, workspace_id, project_id, actor_id)
      values (${uuidv7()}, ${workspaceId}, ${p}, ${sam.ctx.actorId})`
  })
  await withActor(sam.ctx.actorId, async (tx) => {
    await tx`update app_user set notify_chat = false where actor_id = ${sam.ctx.actorId}`
  })

  const conv = uuidv7()
  const id = await task(ctx.actorId, workspaceId, p, 'Still notifies')
  await withActor(ctx.actorId, async (tx) => {
    await tx`
      insert into conversation (id, workspace_id, project_id, name)
      values (${conv}, ${workspaceId}, ${p}, 'Team')`
  })
  await withActor(sam.ctx.actorId, async (tx) => {
    for (const [type, target] of [
      ['conversation', conv],
      ['task', id],
    ] as const) {
      await tx`
        insert into subscription (id, workspace_id, object_type, object_id, actor_id)
        values (${uuidv7()}, ${workspaceId}, ${type}::object_kind, ${target}, ${sam.ctx.actorId})`
    }
  })
  await withActor(ctx.actorId, async (tx) => {
    await notify(tx, ctx, { objectType: 'conversation', objectId: conv, isChat: true })
    await notify(tx, ctx, { objectType: 'task', objectId: id })
  })

  // The one preference there is. Without it a busy channel drowns the
  // assignments and the inbox stops being read at all.
  const rows = await withActor(
    sam.ctx.actorId,
    async (tx) =>
      tx<{ object_type: string }[]>`
      select object_type from notification where actor_id = ${sam.ctx.actorId}`,
  )
  assert.deepEqual(
    rows.map((r) => r.object_type),
    ['task'],
  )
})

test('quiet hours hold a notification rather than dropping it', async () => {
  const { ctx, workspaceId } = await makeOwner()
  const p = await makeProject(ctx, workspaceId, 'Acme')
  const sam = await makeOwner()
  await withActor(ctx.actorId, async (tx) => {
    await tx`
      insert into membership (id, workspace_id, actor_id, role, invited_by, joined_at)
      values (${uuidv7()}, ${workspaceId}, ${sam.ctx.actorId}, 'member', ${ctx.actorId}, now())`
  })
  // A window that certainly contains now, in a zone where that is true.
  await withActor(sam.ctx.actorId, async (tx) => {
    await tx`
      update app_user set quiet_from = '00:00', quiet_to = '23:59', timezone = 'UTC'
      where actor_id = ${sam.ctx.actorId}`
  })

  const id = await task(ctx.actorId, workspaceId, p, 'Later')
  await withActor(ctx.actorId, async (tx) => {
    await notify(tx, ctx, { objectType: 'task', objectId: id, assignees: [sam.ctx.actorId] })
  })

  const rows = await withActor(
    sam.ctx.actorId,
    async (tx) =>
      tx<{ due: boolean }[]>`
      select deliver_after > now() as due from notification
      where actor_id = ${sam.ctx.actorId}`,
  )
  // It waits. Somebody not at work should not be woken and should still find
  // everything in the morning.
  assert.deepEqual(
    rows.map((r) => r.due),
    [true],
  )
  assert.deepEqual(await unread(sam.ctx.actorId), [])
})

test('a link in a body points both ways', async () => {
  const { ctx, workspaceId } = await makeOwner()
  const p = await makeProject(ctx, workspaceId, 'Acme')
  const a = await task(ctx.actorId, workspaceId, p, 'First')
  const b = await task(ctx.actorId, workspaceId, p, 'Second')

  await withActor(ctx.actorId, async (tx) => {
    await linkMentionedObjects(tx, ctx, { type: 'task', id: a }, doc(`see /tasks/${b}`))
  })

  const both = await withActor(
    ctx.actorId,
    async (tx) =>
      tx<{ from_id: string; to_id: string }[]>`
      select from_id, to_id from object_link where deleted_at is null`,
  )
  // Following it back is what stops a decision living only where it was
  // written, so the reverse side is made at the same moment rather than by a
  // later pass that is missing exactly when somebody looks.
  assert.equal(both.length, 2)
  assert.ok(both.some((l) => l.from_id === a && l.to_id === b))
  assert.ok(both.some((l) => l.from_id === b && l.to_id === a))
})

/*
 * A note says what it is about without being opened — `docs/specs/inbox.md`:
 * the room and what was said, for a mention in a conversation.
 */
test('a mention in a conversation arrives with the room and the words', async () => {
  const { ctx, workspaceId } = await makeOwner()
  const sam = await addPerson(ctx, workspaceId, 'member')
  const me = await bearerFor(ctx.actorId, workspaceId)
  const him = await bearerFor(sam.actorId, workspaceId)
  const { id } = (await (
    await app.request('/api/conversations/direct', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${me}` },
      body: JSON.stringify({ actor_ids: [sam.actorId] }),
    })
  ).json()) as { id: string }
  await app.request(`/api/conversations/${id}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${me}` },
    body: JSON.stringify({
      body: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'mention', attrs: { id: sam.actorId, label: 'Sam' } },
              { type: 'text', text: ' can you look at the hero?' },
            ],
          },
        ],
      },
    }),
  })
  const r = await app.request('/api/inbox', { headers: { authorization: `Bearer ${him}` } })
  const note = (
    (await r.json()) as {
      notifications: { object_id: string; reason: string; said: string | null; said_by: string | null; room_others: string | null }[]
    }
  ).notifications.find((n) => n.object_id === id && n.reason === 'mentioned')!
  assert.ok(note, 'the mention is in the inbox')
  assert.match(note.said ?? '', /can you look at the hero\?/)
  assert.ok(note.said_by)
  assert.ok(note.room_others)
})

test('a note from one workspace is not in the inbox of another', async () => {
  const { ctx, workspaceId } = await makeOwner()
  const other = await makeOwner()
  // The second owner is also a member of the first workspace.
  await withActor(ctx.actorId, async (tx) => {
    await tx`
      insert into membership (id, workspace_id, actor_id, role, invited_by, joined_at)
      values (${uuidv7()}, ${workspaceId}, ${other.ctx.actorId}, 'member', ${ctx.actorId}, now())`
    await tx`
      insert into notification (id, workspace_id, actor_id, reason, object_type, object_id, deliver_after)
      values (${uuidv7()}, ${workspaceId}, ${other.ctx.actorId}, 'mentioned', 'conversation', ${uuidv7()}, now())`
  })
  // Asked from their own workspace, the first workspace's note is not there.
  const r = await app.request('/api/inbox', { headers: { authorization: `Bearer ${other.token}` } })
  const body = (await r.json()) as { notifications: unknown[]; unread: { mentioned: string } }
  assert.equal(body.notifications.length, 0)
  assert.equal(body.unread.mentioned, '0')
})

/*
 * A note about something that went to the bin is neither listed nor
 * counted: opened, it said "Can't find this task", and unread it was a
 * count the bell could never lose. `docs/specs/inbox.md`.
 */
test('a note about a task in the bin is not listed and not counted', async () => {
  const { ctx, workspaceId } = await makeOwner()
  const p = await makeProject(ctx, workspaceId, 'Acme')
  const sam = await addPerson(ctx, workspaceId, 'member', [p])
  const id = await task(ctx.actorId, workspaceId, p, 'Gone soon')
  await withActor(ctx.actorId, async (tx) => {
    await notify(tx, ctx, { objectType: 'task', objectId: id, assignees: [sam.actorId] })
  })
  const token = await bearerFor(sam.actorId, workspaceId)
  const read = async () =>
    (await (await app.request('/api/inbox', { headers: { authorization: `Bearer ${token}` } })).json()) as {
      notifications: { object_id: string }[]
      unread: Record<string, string>
    }
  let box = await read()
  assert.ok(box.notifications.some((n) => n.object_id === id))
  assert.equal(Number(box.unread.assigned), 1)

  await withActor(ctx.actorId, (tx) => tx`update task set deleted_at = now() where id = ${id}`)
  box = await read()
  assert.ok(!box.notifications.some((n) => n.object_id === id))
  assert.equal(Number(box.unread.assigned), 0)
})

test("the inbox read on one device is said to the person's others", async () => {
  const { ctx, workspaceId } = await makeOwner()
  const token = await bearerFor(ctx.actorId, workspaceId)
  const heard: unknown[] = []
  const off = await subscribe(`actor:${ctx.actorId}`, (e) => heard.push([e.kind, e.payload]))
  const id = uuidv7()
  await app.request('/api/inbox/read', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ id }),
  })
  await app.request('/api/inbox/read', { method: 'POST', headers: { authorization: `Bearer ${token}` } })

  // Through the database, as every word on a socket is: a laptop held by
  // the other instance hears it too.
  for (let i = 0; i < 40 && heard.length < 2; i++) await new Promise((r) => setTimeout(r, 50))
  off()
  // Each says its workspace, so a token of another hears neither.
  assert.deepEqual(heard, [
    ['read', { id, workspace_id: workspaceId }],
    ['read', { workspace_id: workspaceId }],
  ])
})

/*
 * Who did it, what kind of thing, and what they said — `docs/specs/inbox.md`,
 * "Who, and what kind". The row draws the face of whoever did it, so the
 * note has to know whose, and it is the caller's whatever is passed.
 */
test('a note says who did it, what kind of thing, and what the comment said', async () => {
  const { ctx, workspaceId } = await makeOwner()
  const p = await makeProject(ctx, workspaceId, 'Acme')
  const sam = await addPerson(ctx, workspaceId, 'member', [p])
  const id = await task(ctx.actorId, workspaceId, p, 'Hero image')
  const me = await bearerFor(ctx.actorId, workspaceId)
  const him = await bearerFor(sam.actorId, workspaceId)
  const sent = await app.request(`/api/tasks/${id}/comments`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${me}` },
    body: JSON.stringify({
      body: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'mention', attrs: { id: sam.actorId, label: 'Sam' } },
              { type: 'text', text: ' the crop is too tight on the left' },
            ],
          },
        ],
      },
    }),
  })
  assert.ok(sent.status < 300, `comment: ${sent.status}`)
  const r = await app.request('/api/inbox', { headers: { authorization: `Bearer ${him}` } })
  const note = (
    (await r.json()) as {
      notifications: {
        object_id: string
        reason: string
        kind: string | null
        by_id: string | null
        by_name: string | null
        by_avatar_url: string | null
        excerpt: string | null
      }[]
    }
  ).notifications.find((n) => n.object_id === id)!
  assert.ok(note, 'the note is in the inbox')
  assert.equal(note.reason, 'mentioned')
  assert.equal(note.kind, 'commented')
  assert.equal(note.by_id, ctx.actorId)
  assert.ok(note.by_name)
  assert.ok('by_avatar_url' in note)
  assert.match(note.excerpt ?? '', /crop is too tight/)
})

test('a note cannot be written in somebody else’s name, and a reminder is nobody’s', async () => {
  const { ctx, workspaceId } = await makeOwner()
  const p = await makeProject(ctx, workspaceId, 'Acme')
  const sam = await addPerson(ctx, workspaceId, 'member', [p])
  const id = await task(ctx.actorId, workspaceId, p, 'Hero image')
  await withActor(ctx.actorId, async (tx) => {
    await tx`select notify_many(${workspaceId}, ${[uuidv7()]}::uuid[], ${[sam.actorId]}::uuid[],
                                ${['assigned']}::notify_reason[], 'task'::object_kind, ${id},
                                ${['x']}::text[], ${[new Date().toISOString()]}::timestamptz[], ${['gave']}::text[])`
    await tx`select notify_once(${uuidv7()}, ${workspaceId}, ${sam.actorId}, 'due'::notify_reason,
                                'task'::object_kind, ${id}, 'Due tomorrow', now(), false, 'due', false)`
  })
  const rows = await withActor(
    sam.actorId,
    (tx) =>
      tx<{ reason: string; by_id: string | null; kind: string | null }[]>`
      select reason, by_id, kind from notification where actor_id = ${sam.actorId} and object_id = ${id}`,
  )
  assert.equal(rows.find((r) => r.reason === 'assigned')?.by_id, ctx.actorId)
  assert.equal(rows.find((r) => r.reason === 'assigned')?.kind, 'gave')
  assert.equal(rows.find((r) => r.reason === 'due')?.by_id, null)
})

/* ------------------------------------------------ mentions in a task
   `docs/specs/task-mentions.md`. */

async function mentions(actorId: string, objectId: string): Promise<number> {
  return withActor(actorId, async (tx) => {
    const [r] = await tx<{ n: number }[]>`
      select count(*)::int as n from notification
      where actor_id = ${actorId} and object_id = ${objectId} and reason = 'mentioned' and deleted_at is null`
    return r?.n ?? 0
  })
}

const naming = (...people: { id: string; label: string }[]) => ({
  type: 'doc',
  content: [
    { type: 'paragraph', content: [...people.map((p) => ({ type: 'mention', attrs: p })), { type: 'text', text: ' have a look' }] },
  ],
})

test('a mention in a task tells only people who may read its project', async () => {
  const { ctx, workspaceId } = await makeOwner()
  const p = await makeProject(ctx, workspaceId, 'Acme')
  const other = await makeProject(ctx, workspaceId, 'Elsewhere')
  const sam = await addPerson(ctx, workspaceId, 'member', [p])
  /* In the workspace, on another project. */
  const ann = await addPerson(ctx, workspaceId, 'member', [other])
  /* Taken off this project. */
  const gone = await addPerson(ctx, workspaceId, 'member', [p])
  /* Taken out of the workspace. */
  const left = await addPerson(ctx, workspaceId, 'member', [p])
  /* Invited, never came. */
  const asked = await addPerson(ctx, workspaceId, 'member', [p])
  /* Somebody of another workspace altogether. */
  const stranger = await makeOwner()
  await withActor(ctx.actorId, async (tx) => {
    await tx`update project_member set deleted_at = now() where project_id = ${p} and actor_id = ${gone.actorId}`
    await tx`update membership set deleted_at = now() where workspace_id = ${workspaceId} and actor_id = ${left.actorId}`
    await tx`update membership set joined_at = null where workspace_id = ${workspaceId} and actor_id = ${asked.actorId}`
  })
  const id = await task(ctx.actorId, workspaceId, p, 'Hero image')

  await inWorkspace(sam.actorId, workspaceId, async (tx) => {
    await notify(tx, sam, {
      objectType: 'task',
      objectId: id,
      body: naming(
        { id: ann.actorId, label: 'Ann' },
        { id: gone.actorId, label: 'Gone' },
        { id: left.actorId, label: 'Left' },
        { id: asked.actorId, label: 'Asked' },
        { id: stranger.ctx.actorId, label: 'Stranger' },
        { id: ctx.actorId, label: 'Owner' },
      ),
    })
  })
  for (const [who, said] of [
    [ann, 'another project'],
    [gone, 'taken off it'],
    [left, 'out of the workspace'],
    [asked, 'invited, not joined'],
  ] as const) {
    assert.equal(await mentions(who.actorId, id), 0, `somebody ${said} is not told`)
  }
  assert.equal(await mentions(stranger.ctx.actorId, id), 0, 'somebody of another workspace is not told')
  /* The owner reads every project, on its list or not. */
  assert.equal(await mentions(ctx.actorId, id), 1, 'the owner is told')
})

test('the owner not on the project is told, through the API', async () => {
  const { ctx, workspaceId } = await makeOwner()
  const p = await makeProject(ctx, workspaceId, 'Acme')
  const sam = await addPerson(ctx, workspaceId, 'member', [p])
  await withActor(ctx.actorId, async (tx) => {
    await tx`update project_member set deleted_at = now() where project_id = ${p} and actor_id = ${ctx.actorId}`
  })
  const his = await bearerFor(sam.actorId, workspaceId)
  const made = await app.request(`/api/projects/${p}/tasks`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${his}` },
    body: JSON.stringify({ title: 'Copy', body: naming({ id: ctx.actorId, label: 'Owner' }) }),
  })
  assert.equal(made.status, 201)
  const { id } = (await made.json()) as { id: string }
  assert.equal(await mentions(ctx.actorId, id), 1)
})

test('a description PATCH tells only the names it added; @everyone in a task tells nobody', async () => {
  const { ctx, workspaceId } = await makeOwner()
  const p = await makeProject(ctx, workspaceId, 'Acme')
  const sam = await addPerson(ctx, workspaceId, 'member', [p])
  const kim = await addPerson(ctx, workspaceId, 'member', [p])
  const me = await bearerFor(ctx.actorId, workspaceId)
  const call = (path: string, method: string, body: unknown) =>
    app.request(path, {
      method,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${me}` },
      body: JSON.stringify(body),
    })
  const made = await call(`/api/projects/${p}/tasks`, 'POST', {
    title: 'Copy',
    body: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'mention', attrs: { id: 'everyone', label: 'everyone' } },
            { type: 'mention', attrs: { id: sam.actorId, label: 'Sam' } },
          ],
        },
      ],
    },
  })
  const { id } = (await made.json()) as { id: string }
  assert.equal(await mentions(sam.actorId, id), 1)
  assert.equal(await mentions(kim.actorId, id), 0, '@everyone means nothing in a task')
  await withActor(sam.actorId, async (tx) => {
    await tx`update notification set read_at = now() where actor_id = ${sam.actorId} and object_id = ${id}`
  })
  const patched = await call(`/api/tasks/${id}`, 'PATCH', {
    body: naming({ id: sam.actorId, label: 'Sam' }, { id: kim.actorId, label: 'Kim' }),
  })
  assert.ok(patched.status < 300, `patch: ${patched.status}`)
  assert.equal(await mentions(kim.actorId, id), 1, 'the name the edit added is told')
  assert.equal(await mentions(sam.actorId, id), 1, 'the name it had is not told again')
})

test('a name already waiting unread is not told again', async () => {
  const { ctx, workspaceId } = await makeOwner()
  const p = await makeProject(ctx, workspaceId, 'Acme')
  const sam = await addPerson(ctx, workspaceId, 'member', [p])
  const id = await task(ctx.actorId, workspaceId, p, 'Hero image')
  for (let i = 0; i < 2; i++) {
    await inWorkspace(ctx.actorId, workspaceId, async (tx) => {
      await notify(tx, ctx, { objectType: 'task', objectId: id, body: naming({ id: sam.actorId, label: 'Sam' }), watchers: false })
    })
  }
  assert.equal(await mentions(sam.actorId, id), 1)
})

test('a comment on a file sent in a room with chosen people tells nobody outside the room', async () => {
  const { ctx, workspaceId } = await makeOwner()
  const p = await makeProject(ctx, workspaceId, 'Acme')
  const sam = await addPerson(ctx, workspaceId, 'member', [p])
  const kim = await addPerson(ctx, workspaceId, 'member', [p])
  const room = uuidv7()
  const fileId = uuidv7()
  await withActor(ctx.actorId, async (tx) => {
    await tx`insert into conversation (id, workspace_id, project_id, name) values (${room}, ${workspaceId}, ${p}, 'Secret')`
    for (const who of [ctx.actorId, sam.actorId]) {
      await tx`
        insert into conversation_member (id, workspace_id, conversation_id, actor_id, joined_at)
        values (${uuidv7()}, ${workspaceId}, ${room}, ${who}, now())`
    }
    await tx`
      insert into file (id, workspace_id, project_id, conversation_id, author_id, name, storage_key, size_bytes, uploaded_at)
      values (${fileId}, ${workspaceId}, ${p}, ${room}, ${ctx.actorId}, 'plan.pdf', ${`k/${fileId}`}, 10, now())`
  })
  const me = await bearerFor(ctx.actorId, workspaceId)
  const sent = await app.request(`/api/files/${fileId}/comments`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${me}` },
    body: JSON.stringify({ body: naming({ id: sam.actorId, label: 'Sam' }, { id: kim.actorId, label: 'Kim' }) }),
  })
  assert.ok(sent.status < 300, `comment: ${sent.status}`)
  assert.equal(await mentions(sam.actorId, fileId), 1, 'somebody in the room is told')
  assert.equal(await mentions(kim.actorId, fileId), 0, 'somebody on the project, outside the room, is not')
})

test('a comment tells its names once, and an edit only the names it added', async () => {
  const { ctx, workspaceId } = await makeOwner()
  const p = await makeProject(ctx, workspaceId, 'Acme')
  const sam = await addPerson(ctx, workspaceId, 'member', [p])
  const kim = await addPerson(ctx, workspaceId, 'member', [p])
  const id = await task(ctx.actorId, workspaceId, p, 'Hero image')
  const me = await bearerFor(ctx.actorId, workspaceId)
  const send = (path: string, method: string, body: unknown) =>
    app.request(path, {
      method,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${me}` },
      body: JSON.stringify({ body }),
    })

  const made = await send(`/api/tasks/${id}/comments`, 'POST', naming({ id: sam.actorId, label: 'Sam' }))
  assert.ok(made.status < 300, `comment: ${made.status}`)
  const { id: commentId } = (await made.json()) as { id: string }
  assert.equal(await mentions(sam.actorId, id), 1)

  /* Mark it read, so a second note — not a merged one — would show. */
  await withActor(sam.actorId, async (tx) => {
    await tx`update notification set read_at = now() where actor_id = ${sam.actorId} and object_id = ${id}`
  })
  const edited = await send(
    `/api/comments/${commentId}`,
    'PATCH',
    naming({ id: sam.actorId, label: 'Sam' }, { id: kim.actorId, label: 'Kim' }),
  )
  assert.equal(edited.status, 200)
  assert.equal(await mentions(kim.actorId, id), 1, 'the name the edit added is told')
  assert.equal(await mentions(sam.actorId, id), 1, 'the name it had is not told again')
})
