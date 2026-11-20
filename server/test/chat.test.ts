import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { closeDb, withActor, uuidv7, makeOwner, addPerson, makeProject, bearerFor } from './helpers.js'
import { app } from '../src/http/routes.js'
import { closeRealtime, publish, subscribe } from '../src/realtime.js'

after(async () => {
  await closeRealtime()
  await closeDb()
})

const doc = (t: string) => ({ type: 'doc', content: [{ type: 'text', text: t }] })

async function channel(ownerId: string, ws: string, project: string | null, name: string) {
  const id = uuidv7()
  await withActor(ownerId, async (tx) => {
    await tx`
      insert into conversation (id, workspace_id, project_id, name)
      values (${id}, ${ws}, ${project}, ${name})`
  })
  return id
}

async function say(actorId: string, ws: string, conversation: string, text: string, parent?: string) {
  const id = uuidv7()
  await withActor(actorId, async (tx) => {
    await tx`
      insert into message (id, workspace_id, conversation_id, author_id, parent_id, body)
      values (${id}, ${ws}, ${conversation}, ${actorId}, ${parent ?? null},
              ${tx.json(doc(text) as never)})`
  })
  return id
}

test('a thread hangs off a message, not off the channel', async () => {
  const { ctx, workspaceId } = await makeOwner()
  const p = await makeProject(ctx, workspaceId, 'Acme')
  const room = await channel(ctx.actorId, workspaceId, p, 'Team')
  const root = await say(ctx.actorId, workspaceId, room, 'shall we move the launch')
  await say(ctx.actorId, workspaceId, room, 'yes', root)
  await say(ctx.actorId, workspaceId, room, 'unrelated')

  const top = await withActor(ctx.actorId, async (tx) => {
    const rows = await tx<{ id: string }[]>`
      select id from message
      where conversation_id = ${room} and parent_id is null and deleted_at is null`
    return rows.length
  })
  // The channel is not one flat river: a reply is inside its thread, so the
  // top level stays readable.
  assert.equal(top, 2)
})

test('a direct conversation belongs to its members, not to a project', async () => {
  const { ctx, workspaceId } = await makeOwner()
  const p = await makeProject(ctx, workspaceId, 'Acme')
  const sam = await addPerson(ctx, workspaceId, 'member', [p])
  const outsider = await addPerson(ctx, workspaceId, 'member', [p])

  const dm = await channel(ctx.actorId, workspaceId, null, null as unknown as string)
  await withActor(ctx.actorId, async (tx) => {
    for (const a of [ctx.actorId, sam.actorId]) {
      await tx`
        insert into conversation_member (id, workspace_id, conversation_id, actor_id, joined_at)
        values (${uuidv7()}, ${workspaceId}, ${dm}, ${a}, now())`
    }
  })
  await say(ctx.actorId, workspaceId, dm, 'just between us')

  const bySam = await withActor(sam.actorId, async (tx) => tx<{ id: string }[]>`select id from message where conversation_id = ${dm}`)
  const byOutsider = await withActor(
    outsider.actorId,
    async (tx) => tx<{ id: string }[]>`select id from message where conversation_id = ${dm}`,
  )
  assert.equal(bySam.length, 1)
  // Being in the same workspace, and even the same project, is not membership
  // of somebody else's conversation.
  assert.equal(byOutsider.length, 0)
})

test('realtime goes through the database, not through this process', async () => {
  const seen: unknown[] = []
  const off = await subscribe('conversation:test-topic', (e) => seen.push(e.payload))
  await publish('conversation:test-topic', 'message', { id: 'abc' })

  // Published through Postgres and heard back: with two API instances a
  // broadcast from inside one process never reaches sockets held by the other,
  // which is the failure that only appears in production.
  for (let i = 0; i < 40 && seen.length === 0; i++) {
    await new Promise((r) => setTimeout(r, 50))
  }
  off()
  assert.deepEqual(seen, [{ id: 'abc' }])
})

test('a deleted project takes its channels out of the list', async () => {
  const { ctx, workspaceId } = await makeOwner()
  const projectId = await makeProject(ctx, workspaceId, 'Doomed')
  await channel(ctx.actorId, workspaceId, projectId, 'Doomed team')

  const listed = async () =>
    withActor(
      ctx.actorId,
      (tx) =>
        tx<{ name: string | null }[]>`
        select c.name from conversation c
        left join project p on p.id = c.project_id
        where c.deleted_at is null and (c.project_id is null or p.id is not null)`,
    )

  assert.ok(
    (await listed()).some((c) => c.name === 'Doomed team'),
    'not there to begin with',
  )

  await withActor(ctx.actorId, (tx) => tx`update project set deleted_at = now() where id = ${projectId}`)

  // Leaving the room listed is how a sidebar fills with conversations about
  // work nobody can reach any more.
  assert.equal(
    (await listed()).some((c) => c.name === 'Doomed team'),
    false,
    'a channel outlived its project',
  )
})

test('a channel made for some of the project is closed to the rest of it', async () => {
  const { ctx, workspaceId } = await makeOwner()
  const p = await makeProject(ctx, workspaceId, 'Acme')
  const sam = await addPerson(ctx, workspaceId, 'member', [p])
  const nour = await addPerson(ctx, workspaceId, 'member', [p])

  await channel(ctx.actorId, workspaceId, p, 'Team')
  const few = await channel(ctx.actorId, workspaceId, p, 'Just us')
  await withActor(ctx.actorId, async (tx) => {
    for (const who of [ctx.actorId, sam.actorId]) {
      await tx`
        insert into conversation_member (id, workspace_id, conversation_id, actor_id, joined_at)
        values (${uuidv7()}, ${workspaceId}, ${few}, ${who}, now())`
    }
  })

  const rooms = async (actorId: string) =>
    withActor(actorId, async (tx) => {
      const rows = await tx<{ name: string }[]>`
        select name from conversation where project_id = ${p} and deleted_at is null order by name`
      return rows.map((r) => r.name)
    })

  // The project's own channel belongs to the project; the other one does not.
  assert.deepEqual(await rooms(sam.actorId), ['Just us', 'Team'])
  assert.deepEqual(await rooms(nour.actorId), ['Team'])

  /*
   * And what was said in it is not readable either.
   *
   * Worth asserting separately: the room being hidden and its messages being
   * hidden are two policies, and a product that hides the door while leaving
   * the contents addressable has not hidden anything.
   */
  await say(ctx.actorId, workspaceId, few, 'Only for the two of us')
  const heard = await withActor(nour.actorId, async (tx) => {
    const rows = await tx<{ id: string }[]>`
      select id from message where conversation_id = ${few} and deleted_at is null`
    return rows.length
  })
  assert.equal(heard, 0)
})

test('reading an open channel does not close it around the reader', async () => {
  const { ctx, workspaceId } = await makeOwner()
  const p = await makeProject(ctx, workspaceId, 'Acme')
  const sam = await addPerson(ctx, workspaceId, 'member', [p])
  const nour = await addPerson(ctx, workspaceId, 'member', [p])
  const team = await channel(ctx.actorId, workspaceId, p, 'Team')

  /*
   * The trap this schema was one column away from.
   *
   * `mark_read` writes a membership row so it has somewhere to put the read
   * mark. If that row also meant "is a member", the first person to open a
   * channel everybody could see would close it behind them — and nobody would
   * get an error, the room would just go quiet for the rest of the project.
   */
  await withActor(sam.actorId, (tx) => tx`select mark_read(${team}, ${sam.actorId}, ${workspaceId})`)

  const stillThere = await withActor(nour.actorId, async (tx) => {
    const rows = await tx<{ id: string }[]>`
      select id from conversation where id = ${team} and deleted_at is null`
    return rows.length
  })
  assert.equal(stillThere, 1)
})

/**
 * The count that could never be anything but zero.
 *
 * A project's own channel is made with no member rows at all — everybody
 * reaches it through the project. The unread count joined
 * `conversation_member` to find the reader's mark, so for the three people on
 * a project a channel with ten new messages reported none, for ever.
 */
test('a project channel counts unread for everybody on the project', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const project = await makeProject(ctx, workspaceId, 'Acme')
  const sam = await addPerson(ctx, workspaceId, 'member', [project], [])

  /* The channel a project is made with, in the shape the endpoint makes it:
     a row with a project and no members at all. */
  const roomId = uuidv7()
  await withActor(
    ctx.actorId,
    (tx) =>
      tx`insert into conversation (id, workspace_id, project_id, name)
       values (${roomId}, ${workspaceId}, ${project}, ${'Team'})`,
  )
  const room = { id: roomId }
  const members = await withActor(
    ctx.actorId,
    (tx) =>
      tx<{ n: number }[]>`
      select count(*)::int as n from conversation_member
      where conversation_id = ${room.id} and deleted_at is null`,
  )
  // The shape this is about: nobody is a member of it, and it is still theirs.
  assert.equal(members[0]?.n, 0)

  const say = (who: string) =>
    app.request(`/api/conversations/${room.id}/messages`, {
      method: 'POST',
      headers: { authorization: `Bearer ${who}`, 'content-type': 'application/json' },
      body: JSON.stringify({ body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Anything' }] }] } }),
    })
  const samToken = await bearerFor(sam.actorId, workspaceId)
  assert.equal((await say(samToken)).status, 201)
  assert.equal((await say(samToken)).status, 201)

  const unread = async (who: string) => {
    const r = await app.request('/api/conversations', { headers: { authorization: `Bearer ${who}` } })
    const { conversations } = (await r.json()) as { conversations: { id: string; unread: string }[] }
    return Number(conversations.find((c) => c.id === room.id)?.unread ?? -1)
  }
  assert.equal(await unread(token), 2)
  // Never your own words: a room does not become unread because you spoke in it.
  assert.equal(await unread(samToken), 0)

  /*
   * Fetching them is not reading them. The sidebar fetches a room's first
   * page when the pointer passes over it, and while that was the mark,
   * running the mouse down the list cleared every count on it.
   */
  const fetched = await app.request(`/api/conversations/${room.id}/messages`, {
    headers: { authorization: `Bearer ${token}` },
  })
  assert.equal(fetched.status, 200)
  assert.equal(await unread(token), 2)

  /*
   * Opening the room is, and it clears the count. `last_read_at` had no
   * writer anywhere in the product, so a count could appear and could never
   * go away — which is worse than no count, because a number that does not
   * clear is one people learn to stop seeing.
   */
  const read = await app.request(`/api/conversations/${room.id}/read`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
  })
  assert.equal(read.status, 200)
  assert.equal(await unread(token), 0)

  // And something said after that counts again.
  assert.equal((await say(samToken)).status, 201)
  assert.equal(await unread(token), 1)
})

/*
 * A mention read in the room is read in the inbox too. It is one thing said
 * once, and a count that stays on Notifications after the room has been
 * opened is a second count for it — the one that never clears.
 */
test('a room is read up to its last word, not up to the clock', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const project = await makeProject(ctx, workspaceId, 'Acme')
  const sam = await addPerson(ctx, workspaceId, 'member', [project], [])
  const room = await channel(ctx.actorId, workspaceId, project, 'Team')

  /*
   * A message dated after the server's clock.
   *
   * `mark_read` wrote `now()` and the count is "newer than the mark", so
   * one of these was unread the instant after it had been read — for ever.
   * The badge sat on a room that had just been opened and opening it again
   * did nothing, because opening it again wrote `now()` again. Found in a
   * channel filled with demo data written a few hours into the day; it is
   * also what clock skew between two app servers does, and that one does
   * not announce itself.
   */
  await withActor(
    sam.actorId,
    (tx) =>
      tx`insert into message (id, workspace_id, conversation_id, author_id, body, created_at)
       values (${uuidv7()}, ${workspaceId}, ${room}, ${sam.actorId},
               ${tx.json(doc('From the future') as never)}, now() + interval '5 minutes')`,
  )
  await say(sam.actorId, workspaceId, room, 'And one from now')

  const unread = async () => {
    const r = await app.request('/api/conversations', {
      headers: { authorization: `Bearer ${token}` },
    })
    const { conversations } = (await r.json()) as { conversations: { id: string; unread: string }[] }
    return Number(conversations.find((c) => c.id === room)?.unread ?? -1)
  }
  assert.equal(await unread(), 2)

  const read = await app.request(`/api/conversations/${room}/read`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
  })
  assert.equal(read.status, 200)
  // Reading a room means having seen everything in it, whatever the
  // timestamps say: the screen draws them all, newest at the bottom.
  assert.equal(await unread(), 0)

  /* And the mark never walks backwards. Opening an old room again would
     otherwise move it from the last message to now, which is the same thing
     in a quiet room and loses a message in a busy one. */
  const back = await withActor(
    ctx.actorId,
    (tx) =>
      tx<{ at: string }[]>`
      select last_read_at::text as at from conversation_member
      where conversation_id = ${room} and actor_id = ${ctx.actorId} and deleted_at is null`,
  )
  await app.request(`/api/conversations/${room}/read`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
  })
  const again = await withActor(
    ctx.actorId,
    (tx) =>
      tx<{ at: string }[]>`
      select last_read_at::text as at from conversation_member
      where conversation_id = ${room} and actor_id = ${ctx.actorId} and deleted_at is null`,
  )
  assert.equal(again[0]?.at, back[0]?.at)
})

test('opening a room reads what the inbox holds about it', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const project = await makeProject(ctx, workspaceId, 'Acme')
  const sam = await addPerson(ctx, workspaceId, 'member', [project], [])
  const room = await channel(ctx.actorId, workspaceId, project, 'Team')
  const other = await channel(ctx.actorId, workspaceId, project, 'Launch')
  const samToken = await bearerFor(sam.actorId, workspaceId)

  const mention = (where: string) =>
    app.request(`/api/conversations/${where}/messages`, {
      method: 'POST',
      headers: { authorization: `Bearer ${samToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ body: doc(`@${ctx.actorId} have a look`) }),
    })
  assert.equal((await mention(room)).status, 201)
  assert.equal((await mention(other)).status, 201)

  const unread = async () => {
    const r = await app.request('/api/inbox?unread=1', { headers: { authorization: `Bearer ${token}` } })
    const { notifications } = (await r.json()) as { notifications: { object_id: string }[] }
    return notifications.map((n) => n.object_id)
  }
  assert.deepEqual((await unread()).sort(), [room, other].sort())

  const read = await app.request(`/api/conversations/${room}/read`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
  })
  assert.equal(read.status, 200)
  // Only that room's: the other one has not been opened.
  assert.deepEqual(await unread(), [other])
})

/*
 * The sender names the row, so the screen can draw it before sending it.
 *
 * Both halves matter and the second is the one that makes the first safe: an
 * id is a name and not a permission, so taking one that exists has to be
 * refused rather than overwrite what is there.
 */
test('a message can carry the id its sender chose, and cannot take one twice', async () => {
  const { ctx, workspaceId } = await makeOwner()
  const p = await makeProject(ctx, workspaceId, 'Acme')
  const room = await channel(ctx.actorId, workspaceId, p, 'Team')
  const token = await bearerFor(ctx.actorId, workspaceId)

  const chosen = uuidv7()
  const post = (id: string, text: string) =>
    app.request(`/api/conversations/${room}/messages`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ id, body: doc(text) }),
    })

  const made = await post(chosen, 'drawn before it was sent')
  assert.equal(made.status, 201)
  // The id came back as given, which is what the optimistic row is keyed on.
  assert.equal(((await made.json()) as { id: string }).id, chosen)

  const listed = await app.request(`/api/conversations/${room}/messages`, {
    headers: { authorization: `Bearer ${token}` },
  })
  const { messages } = (await listed.json()) as { messages: { id: string }[] }
  assert.equal(messages.filter((m) => m.id === chosen).length, 1)

  /*
   * And the same id again is refused, with the first message left alone.
   *
   * Without this the endpoint would be a way to overwrite a message by
   * naming it — which is the whole of the argument against a client-chosen
   * key, and the primary key is the whole of the answer.
   */
  const again = await post(chosen, 'a different thing entirely')
  assert.equal(again.status, 409)

  const after = await app.request(`/api/conversations/${room}/messages`, {
    headers: { authorization: `Bearer ${token}` },
  })
  const { messages: still } = (await after.json()) as {
    messages: { id: string; body: unknown }[]
  }
  assert.equal(still.filter((m) => m.id === chosen).length, 1)
  assert.deepEqual(still.find((m) => m.id === chosen)?.body, doc('drawn before it was sent'))
})

/* And the server still names it when the sender does not — every other
   client, and the MCP layer, send no id at all. */
test('a message with no id given is still made', async () => {
  const { ctx, workspaceId } = await makeOwner()
  const p = await makeProject(ctx, workspaceId, 'Acme')
  const room = await channel(ctx.actorId, workspaceId, p, 'Team')
  const token = await bearerFor(ctx.actorId, workspaceId)

  const r = await app.request(`/api/conversations/${room}/messages`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ body: doc('named by the server') }),
  })
  assert.equal(r.status, 201)
  const { id } = (await r.json()) as { id: string }
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-/)
})

/* `docs/specs/chat-threads.md`. */
test('a reaction is one per person per emoji, listed with who put it there', async () => {
  const { ctx, workspaceId } = await makeOwner()
  const p = await makeProject(ctx, workspaceId, 'Acme')
  const sam = await addPerson(ctx, workspaceId, 'member', [p])
  const room = await channel(ctx.actorId, workspaceId, p, 'Team')
  const said = await say(ctx.actorId, workspaceId, room, 'shipped')
  const mine = await bearerFor(ctx.actorId, workspaceId)
  const his = await bearerFor(sam.actorId, workspaceId)

  const react = (token: string, method: 'PUT' | 'DELETE', emoji: string, id = said) =>
    app.request(`/api/messages/${id}/reactions/${encodeURIComponent(emoji)}`, {
      method,
      headers: { authorization: `Bearer ${token}` },
    })
  const listed = async () => {
    const r = await app.request(`/api/conversations/${room}/messages`, {
      headers: { authorization: `Bearer ${mine}` },
    })
    const { messages } = (await r.json()) as {
      messages: { id: string; reactions: { emoji: string; actors: string[] }[] }[]
    }
    return messages.find((m) => m.id === said)!.reactions
  }

  assert.equal((await react(mine, 'PUT', '🎉')).status, 204)
  // Twice is once.
  assert.equal((await react(mine, 'PUT', '🎉')).status, 204)
  assert.equal((await react(his, 'PUT', '🎉')).status, 204)
  assert.equal((await react(his, 'PUT', '👍')).status, 204)
  assert.deepEqual(await listed(), [
    { emoji: '🎉', actors: [ctx.actorId, sam.actorId] },
    { emoji: '👍', actors: [sam.actorId] },
  ])

  // Taking one back takes only your own.
  assert.equal((await react(mine, 'DELETE', '🎉')).status, 204)
  assert.deepEqual(await listed(), [
    { emoji: '🎉', actors: [sam.actorId] },
    { emoji: '👍', actors: [sam.actorId] },
  ])

  // Words are not an emoji.
  assert.equal((await react(mine, 'PUT', 'lol')).status, 400)
  // And a message nobody here can see answers as if it were not there.
  assert.equal((await react(mine, 'PUT', '👍', uuidv7())).status, 404)
})

test('a reaction is closed to somebody who cannot read the room', async () => {
  const { ctx, workspaceId } = await makeOwner()
  const p = await makeProject(ctx, workspaceId, 'Acme')
  const other = await makeProject(ctx, workspaceId, 'Elsewhere')
  const outsider = await addPerson(ctx, workspaceId, 'member', [other])
  const room = await channel(ctx.actorId, workspaceId, p, 'Team')
  const said = await say(ctx.actorId, workspaceId, room, 'not for everyone')
  const token = await bearerFor(outsider.actorId, workspaceId)

  const r = await app.request(`/api/messages/${said}/reactions/${encodeURIComponent('👀')}`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${token}` },
  })
  assert.equal(r.status, 404)
})

test('a message made into a task lands in the first list, at its head', async () => {
  const { ctx, workspaceId } = await makeOwner()
  const p = await makeProject(ctx, workspaceId, 'Acme')
  const room = await channel(ctx.actorId, workspaceId, p, 'Team')
  const first = uuidv7()
  await withActor(ctx.actorId, async (tx) => {
    await tx`
      insert into task_list (id, workspace_id, project_id, author_id, name, sort_key)
      values (${first}, ${workspaceId}, ${p}, ${ctx.actorId}, 'Backlog', 'a0'),
             (${uuidv7()}, ${workspaceId}, ${p}, ${ctx.actorId}, 'Done', 'a1')`
    await tx`
      insert into task (id, workspace_id, project_id, author_id, list_id, title, sort_key)
      values (${uuidv7()}, ${workspaceId}, ${p}, ${ctx.actorId}, ${first}, 'Already here', 'a0')`
  })
  const said = await say(ctx.actorId, workspaceId, room, 'move the launch to Friday')
  const token = await bearerFor(ctx.actorId, workspaceId)

  const r = await app.request(`/api/messages/${said}/promote`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ to: 'task', title: 'Move the launch to Friday' }),
  })
  assert.equal(r.status, 201)
  const { id } = (await r.json()) as { id: string }
  const [row] = await withActor(
    ctx.actorId,
    (tx) => tx<{ list_id: string | null; sort_key: string }[]>`select list_id, sort_key from task where id = ${id}`,
  )
  // Somewhere to be: it was made in no list, which is no column and no heading.
  assert.equal(row!.list_id, first)
  assert.ok(row!.sort_key < 'a0')
})

/* `docs/specs/message-edit.md`. */
test('a message is edited by its author alone, and says so', async () => {
  const { ctx, workspaceId } = await makeOwner()
  const p = await makeProject(ctx, workspaceId, 'Acme')
  const sam = await addPerson(ctx, workspaceId, 'member', [p])
  const room = await channel(ctx.actorId, workspaceId, p, 'Team')
  const mine = await say(sam.actorId, workspaceId, room, 'teh launch')
  const samToken = await bearerFor(sam.actorId, workspaceId)
  const ownerToken = await bearerFor(ctx.actorId, workspaceId)

  const edit = (token: string, text: string) =>
    app.request(`/api/messages/${mine}`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ body: doc(text) }),
    })
  assert.equal((await edit(samToken, 'the launch')).status, 200)
  // Not even the owner rewrites somebody's words.
  assert.equal((await edit(ownerToken, 'something else')).status, 403)

  const r = await app.request(`/api/conversations/${room}/messages`, {
    headers: { authorization: `Bearer ${ownerToken}` },
  })
  const { messages } = (await r.json()) as { messages: { id: string; body: unknown; edited_at: string | null }[] }
  const m = messages.find((x) => x.id === mine)!
  assert.deepEqual(m.body, doc('the launch'))
  assert.ok(m.edited_at)
})

test('a message is deleted by its author, or in a project room by whoever runs it', async () => {
  const { ctx, workspaceId } = await makeOwner()
  const p = await makeProject(ctx, workspaceId, 'Acme')
  const sam = await addPerson(ctx, workspaceId, 'member', [p])
  const robin = await addPerson(ctx, workspaceId, 'member', [p])
  const room = await channel(ctx.actorId, workspaceId, p, 'Team')
  const lonely = await say(sam.actorId, workspaceId, room, 'nobody answers this')
  const answered = await say(sam.actorId, workspaceId, room, 'shall we ship')
  await say(robin.actorId, workspaceId, room, 'yes', answered)
  const samToken = await bearerFor(sam.actorId, workspaceId)
  const robinToken = await bearerFor(robin.actorId, workspaceId)
  const ownerToken = await bearerFor(ctx.actorId, workspaceId)

  const del = (token: string, id: string) =>
    app.request(`/api/messages/${id}`, { method: 'DELETE', headers: { authorization: `Bearer ${token}` } })

  // A member does not delete what somebody else said.
  assert.equal((await del(robinToken, lonely)).status, 403)
  assert.equal((await del(samToken, lonely)).status, 200)
  // The owner may, in a project's room.
  assert.equal((await del(ownerToken, answered)).status, 200)
  // Gone is gone: a second time is a message that is not there.
  assert.equal((await del(samToken, lonely)).status, 404)

  const r = await app.request(`/api/conversations/${room}/messages`, {
    headers: { authorization: `Bearer ${samToken}` },
  })
  const { messages } = (await r.json()) as {
    messages: { id: string; body: unknown; deleted?: boolean; replies: string | number }[]
  }
  // Without answers it is gone; with them it is a line that says nothing.
  assert.equal(
    messages.some((m) => m.id === lonely),
    false,
  )
  const stone = messages.find((m) => m.id === answered)!
  assert.equal(stone.deleted, true)
  assert.equal(stone.body, null)
  assert.equal(Number(stone.replies), 1)
})

/* What a room can name. */
test('a direct conversation names the tasks of projects all its people share', async () => {
  const { ctx, workspaceId } = await makeOwner()
  const shared = await makeProject(ctx, workspaceId, 'Shared')
  const mine = await makeProject(ctx, workspaceId, 'Mine only')
  const sam = await addPerson(ctx, workspaceId, 'member', [shared])
  const dm = await channel(ctx.actorId, workspaceId, null, null as unknown as string)
  await withActor(ctx.actorId, async (tx) => {
    for (const a of [ctx.actorId, sam.actorId]) {
      await tx`
        insert into conversation_member (id, workspace_id, conversation_id, actor_id, joined_at)
        values (${uuidv7()}, ${workspaceId}, ${dm}, ${a}, now())`
    }
  })
  const made = async (project: string, title: string) => {
    const id = uuidv7()
    await withActor(
      ctx.actorId,
      (tx) =>
        tx`insert into task (id, workspace_id, project_id, author_id, title, sort_key)
         values (${id}, ${workspaceId}, ${project}, ${ctx.actorId}, ${title}, 'a0')`,
    )
    return id
  }
  const both = await made(shared, 'Both can open this')
  await made(mine, 'Only I can open this')
  const token = await bearerFor(ctx.actorId, workspaceId)
  const ask = async (q: string) => {
    const r = await app.request(`/api/conversations/${dm}/tasks?q=${encodeURIComponent(q)}`, {
      headers: { authorization: `Bearer ${token}` },
    })
    return ((await r.json()) as { tasks: { id: string; number: number; project_key: string }[] }).tasks
  }
  const all = await ask('')
  assert.deepEqual(
    all.map((t) => t.id),
    [both],
  )
  // By its handle, written either way, and by its number.
  const t = all[0]!
  assert.deepEqual(
    (await ask(`${t.project_key}-${t.number}`)).map((x) => x.id),
    [both],
  )
  assert.deepEqual(
    (await ask(`${t.project_key.toLowerCase()}${t.number}`)).map((x) => x.id),
    [both],
  )
  assert.deepEqual(
    (await ask(String(t.number))).map((x) => x.id),
    [both],
  )
  assert.deepEqual(
    (await ask('open this')).map((x) => x.id),
    [both],
  )
  // And by the start of it, as it is being typed.
  assert.deepEqual(
    (await ask(t.project_key)).map((x) => x.id),
    [both],
  )
  assert.deepEqual(
    (await ask(`${t.project_key.toLowerCase()}-`)).map((x) => x.id),
    [both],
  )
})

/*
 * How loud a room is, person by person. A
 * name said in it is counted red on the room until it is read; turned to
 * nothing, the room stops telling them anything, named or not.
 */
test('a room counts the times you were named, and can be told to say nothing', async () => {
  const { ctx, workspaceId } = await makeOwner()
  const sam = await addPerson(ctx, workspaceId, 'member')
  const me = await bearerFor(ctx.actorId, workspaceId)
  const them = await bearerFor(sam.actorId, workspaceId)
  const req = (method: string, path: string, token: string, body?: unknown) =>
    app.request(path, {
      method,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  const { id } = (await (await req('POST', '/api/conversations/direct', me, { actor_ids: [sam.actorId] })).json()) as { id: string }
  const named = {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'mention', attrs: { id: sam.actorId, label: 'Sam' } }] }],
  }
  const room = async () =>
    (
      (await (await req('GET', '/api/conversations', them)).json()) as {
        conversations: { id: string; notify: string; mentions: string }[]
      }
    ).conversations.find((r) => r.id === id)!

  assert.equal((await req('POST', `/api/conversations/${id}/messages`, me, { body: named })).status, 201)
  assert.equal(Number((await room()).mentions), 1)
  assert.equal((await room()).notify, 'all')

  // Read, and the red goes.
  await req('POST', `/api/conversations/${id}/read`, them)
  assert.equal(Number((await room()).mentions), 0)

  // Nothing: named again, and nothing arrives.
  assert.equal((await req('PUT', `/api/conversations/${id}/notify`, them, { notify: 'none' })).status, 200)
  assert.equal((await room()).notify, 'none')
  await req('POST', `/api/conversations/${id}/messages`, me, { body: named })
  assert.equal(Number((await room()).mentions), 0)

  // Mentions only lets a name through.
  await req('PUT', `/api/conversations/${id}/notify`, them, { notify: 'mentions' })
  await req('POST', `/api/conversations/${id}/messages`, me, { body: named })
  assert.equal(Number((await room()).mentions), 1)
})

/*
 * Turning a room down keeps what is unread in it — the row made to hold the
 * setting starts reading where the list already counted from, not at the
 * moment it was made.
 */
test('turning a channel down does not mark it read', async () => {
  const { ctx, workspaceId } = await makeOwner()
  const p = await makeProject(ctx, workspaceId, 'Acme')
  const sam = await addPerson(ctx, workspaceId, 'member', [p])
  const room = await channel(ctx.actorId, workspaceId, p, 'Team')
  await say(ctx.actorId, workspaceId, room, 'one')
  await say(ctx.actorId, workspaceId, room, 'two')
  const them = await bearerFor(sam.actorId, workspaceId)
  const unread = async () => {
    const r = await app.request('/api/conversations', { headers: { authorization: `Bearer ${them}` } })
    const all = ((await r.json()) as { conversations: { id: string; unread: string }[] }).conversations
    return Number(all.find((c) => c.id === room)!.unread)
  }
  assert.equal(await unread(), 2)
  const put = await app.request(`/api/conversations/${room}/notify`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${them}` },
    body: JSON.stringify({ notify: 'none' }),
  })
  assert.equal(put.status, 200)
  assert.equal(await unread(), 2)
})

test('messaging somebody you already talk to opens that conversation, not a second', async () => {
  const { ctx, workspaceId } = await makeOwner()
  const bruno = await addPerson(ctx, workspaceId, 'member')
  const ada = await addPerson(ctx, workspaceId, 'member')
  const me = await bearerFor(ctx.actorId, workspaceId)
  const open = async (ids: string[]) =>
    (
      (await (
        await app.request('/api/conversations/direct', {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${me}` },
          body: JSON.stringify({ actor_ids: ids }),
        })
      ).json()) as { id: string }
    ).id
  const first = await open([bruno.actorId])
  assert.equal(await open([bruno.actorId]), first)
  // The same people exactly: with Ada too is another conversation.
  const three = await open([bruno.actorId, ada.actorId])
  assert.notEqual(three, first)
  assert.equal(await open([ada.actorId, bruno.actorId]), three)
})

/*
 * A room put away, and one that comes back out when somebody speaks in it
 * — `docs/specs/sidebar-hide.md`.
 */
test('a room can be put away, and comes back to the head of the list when spoken in', async () => {
  const { ctx, workspaceId } = await makeOwner()
  const bruno = await addPerson(ctx, workspaceId, 'member')
  const farid = await addPerson(ctx, workspaceId, 'member')
  const me = await bearerFor(ctx.actorId, workspaceId)
  const them = await bearerFor(bruno.actorId, workspaceId)
  const req = (method: string, path: string, token: string, body?: unknown) =>
    app.request(path, {
      method,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  const dm = async (who: string) =>
    ((await (await req('POST', '/api/conversations/direct', me, { actor_ids: [who] })).json()) as { id: string }).id
  const withBruno = await dm(bruno.actorId)
  const withFarid = await dm(farid.actorId)
  const list = async () =>
    (
      (await (await req('GET', '/api/conversations', me)).json()) as {
        conversations: { id: string; hidden: boolean }[]
      }
    ).conversations

  assert.equal((await req('PUT', `/api/conversations/${withBruno}/hidden`, me, { hidden: true })).status, 200)
  assert.equal((await list()).find((r) => r.id === withBruno)!.hidden, true)

  // Bruno says something: it is out again, and first.
  const said = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hi' }] }] }
  await req('POST', `/api/conversations/${withBruno}/messages`, them, { body: said })
  const after = await list()
  assert.equal(after.find((r) => r.id === withBruno)!.hidden, false)
  assert.equal(after[0]!.id, withBruno)

  // Arranging the list takes that over: dragged under Farid, it stays there.
  assert.equal((await req('POST', `/api/conversations/${withBruno}/place`, me, { after: withFarid })).status, 200)
  const ids = (await list()).map((r) => r.id)
  assert.ok(ids.indexOf(withBruno) > ids.indexOf(withFarid))
})

/*
 * A file sent where there is no project. The
 * room's people can open it; somebody outside the room cannot learn it is
 * there.
 */
test('a file can be sent in a direct conversation, and only its people can open it', async () => {
  const { ctx, workspaceId } = await makeOwner()
  const bruno = await addPerson(ctx, workspaceId, 'member')
  const ada = await addPerson(ctx, workspaceId, 'member')
  const me = await bearerFor(ctx.actorId, workspaceId)
  const him = await bearerFor(bruno.actorId, workspaceId)
  const her = await bearerFor(ada.actorId, workspaceId)
  const { id: room } = (await (
    await app.request('/api/conversations/direct', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${me}` },
      body: JSON.stringify({ actor_ids: [bruno.actorId] }),
    })
  ).json()) as { id: string }

  const form = new FormData()
  form.append('file', new File([new Uint8Array([104, 105])], 'note.txt', { type: 'text/plain' }))
  const sent = await app.request(`/api/conversations/${room}/uploads`, {
    method: 'POST',
    headers: { authorization: `Bearer ${me}` },
    body: form,
  })
  assert.equal(sent.status, 201)
  const { id } = (await sent.json()) as { id: string }

  const open = (token: string) => app.request(`/api/files/${id}/url`, { headers: { authorization: `Bearer ${token}` } })
  assert.equal((await open(him)).status, 200)
  assert.equal((await open(her)).status, 404)
})

/*
 * A direct message reaches the phone. It is a
 * notification of its own (`messaged`), a few seconds late so an open
 * window reads it first, kept out of the inbox, and read with the room.
 */
test('a direct message is a notification for the push, not for the inbox', async () => {
  const { ctx, workspaceId } = await makeOwner()
  const sam = await addPerson(ctx, workspaceId, 'member')
  const me = await bearerFor(ctx.actorId, workspaceId)
  const them = await bearerFor(sam.actorId, workspaceId)
  const req = (method: string, path: string, token: string, body?: unknown) =>
    app.request(path, {
      method,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  const { id } = (await (await req('POST', '/api/conversations/direct', me, { actor_ids: [sam.actorId] })).json()) as { id: string }
  const plain = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Lunch?' }] }] }
  assert.equal((await req('POST', `/api/conversations/${id}/messages`, me, { body: plain })).status, 201)

  const notes = async () =>
    withActor(
      sam.actorId,
      (tx) =>
        tx<{ reason: string; read_at: string | null; late: boolean }[]>`
        select reason, read_at, deliver_after > created_at + interval '5 seconds' as late
        from notification where object_id = ${id} and actor_id = ${sam.actorId}`,
    )
  const [n] = await notes()
  assert.equal(n?.reason, 'messaged')
  assert.equal(n?.late, true)
  // Not the inbox's.
  const inbox = (await (await req('GET', '/api/inbox', them)).json()) as { notifications: { object_id: string }[] }
  assert.equal(
    inbox.notifications.some((x) => x.object_id === id),
    false,
  )
  // Read with the room.
  await req('POST', `/api/conversations/${id}/read`, them)
  assert.ok((await notes())[0]?.read_at)
})

/* Said in chat is not yet agreed to: with Triage on, a message made a task
   waits there. */
test('a message made into a task waits in Triage when the project has it', async () => {
  const { ctx, workspaceId } = await makeOwner()
  const p = await makeProject(ctx, workspaceId, 'Acme')
  const room = await channel(ctx.actorId, workspaceId, p, 'Team')
  const intake = uuidv7()
  await withActor(
    ctx.actorId,
    (tx) => tx`
    insert into task_list (id, workspace_id, project_id, author_id, name, sort_key, intake)
    values (${uuidv7()}, ${workspaceId}, ${p}, ${ctx.actorId}, 'Backlog', 'a0', false),
           (${intake}, ${workspaceId}, ${p}, ${ctx.actorId}, 'Triage', 'a5', true)`,
  )
  const said = await say(ctx.actorId, workspaceId, room, 'can we look at the export')
  const r = await app.request(`/api/messages/${said}/promote`, {
    method: 'POST',
    headers: { authorization: `Bearer ${await bearerFor(ctx.actorId, workspaceId)}`, 'content-type': 'application/json' },
    body: JSON.stringify({ to: 'task', title: 'Look at the export' }),
  })
  const { id } = (await r.json()) as { id: string }
  const [row] = await withActor(ctx.actorId, (tx) => tx<{ list_id: string }[]>`select list_id from task where id = ${id}`)
  assert.equal(row!.list_id, intake)
})
