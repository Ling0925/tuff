import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { app } from '../src/http/routes.js'
import { closeRealtime } from '../src/realtime.js'
import { issueApiToken } from '../src/auth/flows.js'
import { addPerson, bearerFor, closeDb, makeOwner, makeProject, stamp, uuidv7, withActor, withoutActor } from './helpers.js'

after(async () => {
  await closeRealtime()
  await closeDb()
})

const asked = (token: string, path: string, method = 'GET', body?: unknown) =>
  app.request(`/api${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

test('a room takes its history from Slack: names kept, the known matched, threads kept', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const project = await makeProject(ctx, workspaceId, `Slack ${stamp().slice(0, 4)}`)
  const room = uuidv7()
  await withActor(
    ctx.actorId,
    (tx) => tx`insert into conversation (id, workspace_id, project_id, name) values (${room}, ${workspaceId}, ${project}, 'general')`,
  )
  const [me] = await withActor(ctx.actorId, (tx) => tx<{ email: string }[]>`select email from app_user where actor_id = ${ctx.actorId}`)

  const first = await asked(token, `/conversations/${room}/import`, 'POST', {
    messages: [
      { key: '1.0', name: 'Owner in Slack', email: me!.email.toUpperCase(), text: 'Shipped it', at: '2025-03-01T10:00:00Z' },
      { key: '2.0', name: 'Ana Slack', email: 'ana@nowhere.example', text: 'Nice', at: '2025-03-01T10:05:00Z', parent_key: '1.0' },
    ],
  })
  assert.equal(first.status, 200)
  const { ids } = (await first.json()) as { ids: Record<string, string> }
  const more = await asked(token, `/conversations/${room}/import`, 'POST', {
    messages: [{ key: '3.0', name: 'Ana Slack', text: 'Later reply', at: '2025-03-02T09:00:00Z', parent_id: ids['1.0'] }],
  })
  assert.equal(more.status, 200)

  const top = (await (await asked(token, `/conversations/${room}/messages`)).json()) as {
    messages: {
      id: string
      author_id: string | null
      author_name: string
      said_as?: string | null
      created_at: string
      replies: number | string
    }[]
  }
  assert.equal(top.messages.length, 1)
  assert.equal(top.messages[0]!.author_id, ctx.actorId, 'matched by email, whatever its case')
  assert.ok(top.messages[0]!.created_at.startsWith('2025-03-01'))
  assert.equal(Number(top.messages[0]!.replies), 2)
  const thread = (await (await asked(token, `/conversations/${room}/messages?thread=${ids['1.0']}`)).json()) as {
    messages: { author_id: string | null; author_name: string; said_as?: string | null }[]
  }
  assert.deepEqual(
    thread.messages.map((m) => [m.author_id, m.author_name, m.said_as]),
    [
      [null, 'Ana Slack', 'Ana Slack'],
      [null, 'Ana Slack', 'Ana Slack'],
    ],
  )

  // Not a member for it: no seat taken.
  const [n] = await withActor(
    ctx.actorId,
    (tx) => tx<{ n: number }[]>`
    select count(*)::int as n from membership where workspace_id = ${workspaceId} and deleted_at is null`,
  )
  assert.equal(n!.n, 1)

  // Not editable as the importer's own.
  const edit = await asked(token, `/messages/${ids['2.0']}`, 'PATCH', { body: { type: 'doc', content: [] } })
  assert.equal(edit.status, 403)
})

/* The third audit: a member put the owner's
   face on a line, dated last month, in a room the owner never saw. */
test('a line carries a colleague’s face only for whoever may speak for them, and only in a room they read', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const project = await makeProject(ctx, workspaceId, `Forge ${stamp().slice(0, 4)}`)
  const mallory = await addPerson(ctx, workspaceId, 'member', [project])
  const sam = await addPerson(ctx, workspaceId, 'member', [project])
  const email = (id: string) => `p-${id}@example.com`
  await withoutActor(async (tx) => {
    for (const p of [mallory, sam]) {
      await tx`insert into app_user (actor_id, email, password_hash, timezone) values (${p.actorId}, ${email(p.actorId)}, 'x', 'UTC')`
    }
  })
  const [owner] = await withActor(ctx.actorId, (tx) => tx<{ email: string }[]>`select email from app_user where actor_id = ${ctx.actorId}`)
  const asMallory = await bearerFor(mallory.actorId, workspaceId)
  const room = async (members: string[]) => {
    const id = uuidv7()
    await withActor(ctx.actorId, async (tx) => {
      await tx`insert into conversation (id, workspace_id, project_id, name) values (${id}, ${workspaceId}, ${members.length ? null : project}, ${members.length ? null : 'team'})`
      for (const a of members) {
        await tx`insert into conversation_member (id, workspace_id, conversation_id, actor_id, joined_at) values (${uuidv7()}, ${workspaceId}, ${id}, ${a}, now())`
      }
    })
    return id
  }
  const authors = async (as: string, id: string) =>
    (
      (await (await asked(as, `/conversations/${id}/messages`)).json()) as {
        messages: { author_id: string | null; said_as: string | null }[]
      }
    ).messages.map((m) => [m.author_id, m.said_as])

  // A member, in a direct room with Sam: their own line is theirs, the
  // owner's and Sam's are names.
  const dm = await room([mallory.actorId, sam.actorId])
  const forged = await asked(asMallory, `/conversations/${dm}/import`, 'POST', {
    messages: [
      { key: '1', name: 'Me', email: email(mallory.actorId), text: 'mine', at: '2026-10-01T10:00:00Z' },
      { key: '2', name: 'The owner', email: owner!.email, text: 'approved, pay it', at: '2026-10-01T10:01:00Z' },
      { key: '3', name: 'Sam', email: email(sam.actorId), text: 'agreed', at: '2026-10-01T10:02:00Z' },
    ],
  })
  assert.equal(forged.status, 200)
  assert.deepEqual(await authors(asMallory, dm), [
    [mallory.actorId, null],
    [null, 'The owner'],
    [null, 'Sam'],
  ])

  // The owner may speak for people — for the ones who can read the room.
  const team = await room([])
  const outside = await room([ctx.actorId, sam.actorId])
  for (const id of [team, outside]) {
    const r = await asked(token, `/conversations/${id}/import`, 'POST', {
      messages: [{ key: '1', name: 'Mallory', email: email(mallory.actorId), text: 'hello', at: '2026-10-01T10:00:00Z' }],
    })
    assert.equal(r.status, 200)
  }
  assert.deepEqual(await authors(token, team), [[mallory.actorId, null]], 'on the project: their face')
  assert.deepEqual(await authors(token, outside), [[null, 'Mallory']], 'not in the room: their name')

  // Nothing said after now, and no reply hung off another room's message.
  const later = new Date(Date.now() + 86_400_000).toISOString()
  const empty = await room([])
  assert.equal(
    (
      await asked(token, `/conversations/${empty}/import`, 'POST', {
        messages: [{ key: '1', name: 'X', text: 'from the future', at: later }],
      })
    ).status,
    400,
  )
  const [elsewhere] = await withActor(
    ctx.actorId,
    (tx) => tx<{ id: string }[]>`select id from message where conversation_id = ${team} limit 1`,
  )
  assert.equal(
    (
      await asked(token, `/conversations/${empty}/import`, 'POST', {
        messages: [{ key: '1', name: 'X', text: 'a reply', at: '2026-10-01T10:00:00Z', parent_id: elsewhere!.id }],
      })
    ).status,
    400,
  )
})

test('a room somebody has spoken in takes no import, and a token takes none at all', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const project = await makeProject(ctx, workspaceId, `Busy ${stamp().slice(0, 4)}`)
  const room = uuidv7()
  await withActor(ctx.actorId, async (tx) => {
    await tx`insert into conversation (id, workspace_id, project_id, name) values (${room}, ${workspaceId}, ${project}, 'general')`
  })
  const one = [{ key: '1', name: 'X', text: 'hi', at: '2025-01-01T00:00:00Z' }]
  const agent = await issueApiToken(ctx.actorId, workspaceId, 'agent')
  assert.equal((await asked(agent, `/conversations/${room}/import`, 'POST', { messages: one })).status, 403)

  assert.equal(
    (
      await asked(token, `/conversations/${room}/messages`, 'POST', {
        body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'here first' }] }] },
      })
    ).status < 300,
    true,
  )
  assert.equal((await asked(token, `/conversations/${room}/import`, 'POST', { messages: one })).status, 409)
})

test('a file is fetched only from Slack, and only for a room still being filled', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const project = await makeProject(ctx, workspaceId, `Files ${stamp().slice(0, 4)}`)
  const room = uuidv7()
  await withActor(
    ctx.actorId,
    (tx) => tx`insert into conversation (id, workspace_id, project_id, name) values (${room}, ${workspaceId}, ${project}, 'general')`,
  )
  for (const url of [
    'http://files.slack.com/x.png',
    'https://example.com/x.png',
    'https://files.slack.com.evil.example/x.png',
    'https://169.254.169.254/latest',
  ]) {
    const r = await asked(token, `/conversations/${room}/import/file`, 'POST', { url, name: 'x.png' })
    assert.equal(r.status, 400, url)
  }
  const agent = await issueApiToken(ctx.actorId, workspaceId, 'agent')
  assert.equal(
    (await asked(agent, `/conversations/${room}/import/file`, 'POST', { url: 'https://files.slack.com/x', name: 'x' })).status,
    403,
  )
})

test('a file brought with a message is drawn as a sent one is, by its fileId', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const project = await makeProject(ctx, workspaceId, `Pics ${stamp().slice(0, 4)}`)
  const room = uuidv7()
  const file = uuidv7()
  await withActor(ctx.actorId, async (tx) => {
    await tx`insert into conversation (id, workspace_id, project_id, name) values (${room}, ${workspaceId}, ${project}, 'general')`
    await tx`insert into file (id, workspace_id, project_id, author_id, name, storage_key, content_type, size_bytes, uploaded_at)
             values (${file}, ${workspaceId}, ${project}, ${ctx.actorId}, 'a.png', ${'test/' + stamp()}, 'image/png', 1, now())`
  })
  const r = await asked(token, `/conversations/${room}/import`, 'POST', {
    messages: [
      {
        key: '1',
        name: 'Ana',
        text: '',
        at: '2025-01-01T00:00:00Z',
        files: [{ id: file, name: 'a.png', kind: 'image', pixelWidth: 10, pixelHeight: 20 }],
      },
    ],
  })
  assert.equal(r.status, 200)
  const listed = (await (await asked(token, `/conversations/${room}/messages`)).json()) as {
    messages: { body: { content: { type: string; attrs?: Record<string, unknown> }[] } }[]
  }
  assert.deepEqual(listed.messages[0]!.body.content, [
    { type: 'attachment', attrs: { fileId: file, name: 'a.png', kind: 'image', pixelWidth: 10, pixelHeight: 20 } },
  ])
})

test('the feed names a room only to who may see it, and a removed task by its name', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const project = await makeProject(ctx, workspaceId, `Feed ${stamp().slice(0, 4)}`)
  const open = await asked(token, `/projects/${project}/conversations`, 'POST', { name: 'design' })
  assert.equal(open.status, 201)
  const t = await asked(token, `/projects/${project}/tasks`, 'POST', { title: 'Short-lived' })
  const task = ((await t.json()) as { id: string }).id
  assert.equal((await asked(token, `/tasks/${task}`, 'DELETE')).status, 200)

  const feed = (await (await asked(token, `/activity?project=${project}`)).json()) as {
    events: { action: string; object_title: string | null }[]
  }
  const said = Object.fromEntries(feed.events.map((e) => [e.action, e.object_title]))
  assert.equal(said['conversation.create'], 'design')
  assert.equal(said['task.delete'], 'Short-lived')
})

test('a private channel leaves nothing in the feed of somebody not in it', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const project = await makeProject(ctx, workspaceId, `Quiet ${stamp().slice(0, 4)}`)
  const other = await addPerson(ctx, workspaceId, 'member', [project])
  const made = await asked(token, `/projects/${project}/conversations`, 'POST', { name: 'secret', member_ids: [ctx.actorId] })
  assert.equal(made.status, 201)
  const theirs = (await (await asked(await bearerFor(other.actorId, workspaceId), `/activity?project=${project}`)).json()) as {
    events: { action: string; object_title: string | null }[]
  }
  assert.ok(!theirs.events.some((e) => e.action.startsWith('conversation.')), 'nothing about the room')
  const mine = (await (await asked(token, `/activity?project=${project}`)).json()) as {
    events: { action: string; object_title: string | null }[]
  }
  assert.ok(mine.events.some((e) => e.action === 'conversation.create' && e.object_title === 'secret'))
})
