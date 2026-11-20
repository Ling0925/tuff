import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { app } from '../src/http/routes.js'
import { addPerson, bearerFor, closeDb, makeOwner } from './helpers.js'

after(async () => {
  await closeDb()
})

/*
 * An agent reads the files in what it reads, and names tasks by their
 * handles, the agents spec "Files" and
 * the text to task spec "A handle in Markdown".
 */
const json = async (r: Response) => (await r.json()) as Record<string, unknown>
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

type Result = { content: { type: string; text?: string; data?: string; mimeType?: string }[]; isError?: boolean }

async function setUp() {
  const owner = await makeOwner()
  const as = (token: string) => ({ 'content-type': 'application/json', authorization: `Bearer ${token}` })
  const project = async (name: string) => {
    const { id } = (await json(
      await app.request('/api/projects', { method: 'POST', headers: as(owner.token), body: JSON.stringify({ name }) }),
    )) as { id: string }
    const { key } = (await json(await app.request(`/api/projects/${id}`, { headers: as(owner.token) }))) as { key: string }
    return { id, key }
  }
  const shared = await project('Website')
  const elsewhere = await project('Payroll')
  const mobile = await project('Mobile')
  const ben = await addPerson(owner.ctx, owner.workspaceId, 'member', [shared.id, mobile.id])
  const benBearer = await bearerFor(ben.actorId, owner.workspaceId)
  const made = await app.request('/api/tokens', { method: 'POST', headers: as(benBearer), body: JSON.stringify({ name: 'Agent' }) })
  assert.equal(made.status, 201, JSON.stringify(await made.clone().json()))
  const token = (await json(made)).token as string
  let n = 0
  const tool = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await json(
      await app.request('/mcp', {
        method: 'POST',
        headers: { ...as(token), accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++n, method: 'tools/call', params: { name, arguments: args } }),
      }),
    )
    return r.result as Result
  }
  const ok = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await tool(name, args)
    assert.notEqual(r.isError, true, `${name}: ${r.content[0]?.text}`)
    return r
  }
  const rooms = (await json(await app.request('/api/conversations', { headers: as(owner.token) }))) as {
    conversations: { id: string; project_id?: string | null }[]
  }
  const main = rooms.conversations.find((r) => r.project_id === shared.id)!.id
  return { owner, as, shared, elsewhere, mobile, ben, benBearer, token, tool, ok, main }
}

/* A picture uploaded into a room, as the owner, through the room's own upload. */
async function uploadInto(room: string, token: string, name: string): Promise<string> {
  const form = new FormData()
  form.set('file', new File([Buffer.from(PNG, 'base64')], name, { type: 'image/png' }))
  const r = await app.request(`/api/conversations/${room}/uploads`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: form,
  })
  assert.equal(r.status, 201)
  return (await json(r)).id as string
}

const attachment = (fileId: string, name: string) => ({ type: 'attachment', attrs: { fileId, name, kind: 'image' } })

test('read_messages links a picture the agent may see, and not one from a chosen room it is not in', async () => {
  const { owner, as, shared, ben, ok, tool, main } = await setUp()

  // A picture the agent's person can see, sent in the project's room.
  const up = await ok('upload_file', { project_id: shared.id, name: 'bug.png', content_base64: PNG })
  const seen = (JSON.parse(up.content[0]!.text!) as { id: string }).id
  await ok('send_message', { conversation_id: main, body: `The menu:\n\n![bug.png](file:${seen})` })

  // A picture in a channel of chosen people the agent's person is not among,
  // named by its id in a message of the room they are both in.
  const secret = (
    (await json(
      await app.request(`/api/projects/${shared.id}/conversations`, {
        method: 'POST',
        headers: as(owner.token),
        body: JSON.stringify({ name: 'leads', member_ids: [owner.ctx.actorId] }),
      }),
    )) as { id: string }
  ).id
  const hidden = await uploadInto(secret, owner.token, 'salaries.png')
  const sent = await app.request(`/api/conversations/${main}/messages`, {
    method: 'POST',
    headers: as(owner.token),
    body: JSON.stringify({ body: { type: 'doc', content: [attachment(hidden, 'salaries.png')] } }),
  })
  assert.equal(sent.status, 201)

  const read = JSON.parse(
    /<user_content source="messages">\n([\s\S]*)\n<\/user_content>/.exec(
      (await ok('read_messages', { conversation_id: main })).content[0]!.text!,
    )![1]!,
  ) as { messages: { text: string; attachments?: { id: string; url: string }[] }[] }
  const withSeen = read.messages.find((m) => m.attachments?.some((a) => a.id === seen))
  assert.ok(withSeen, JSON.stringify(read))
  const link = withSeen.attachments!.find((a) => a.id === seen)!.url
  assert.ok(withSeen.text.includes(`![bug.png](${link})`), withSeen.text)
  // The link opens with nothing but itself, for the hour.
  const opened = await app.request(new URL(link).pathname + new URL(link).search)
  assert.equal(opened.status, 200)
  assert.deepEqual(Buffer.from(await opened.arrayBuffer()), Buffer.from(PNG, 'base64'))

  const withHidden = read.messages.find((m) => m.text.includes('salaries.png'))!
  assert.equal(withHidden.text, '[salaries.png — not available]')
  assert.equal(withHidden.attachments, undefined)

  // Nor is the chosen room read at all.
  const inSecret = await tool('read_messages', { conversation_id: secret })
  assert.ok(inSecret.isError || !inSecret.content[0]!.text!.includes('salaries'), inSecret.content[0]!.text ?? '')

  // A mention with both in it carries the link to the one, and not the other.
  const mentioned = await app.request(`/api/conversations/${main}/messages`, {
    method: 'POST',
    headers: as(owner.token),
    body: JSON.stringify({
      body: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'mention', attrs: { id: ben.actorId, label: 'Ben' } },
              { type: 'text', text: ' look' },
            ],
          },
          attachment(seen, 'bug.png'),
          attachment(hidden, 'salaries.png'),
        ],
      },
    }),
  })
  assert.equal(mentioned.status, 201)
  const mentions = (await ok('my_mentions')).content[0]!.text!
  assert.ok(mentions.includes(`"id": "${seen}"`) && !mentions.includes(`"id": "${hidden}"`), mentions)

  // read_file shows the one it may see as an image, and not the other.
  const pic = await ok('read_file', { file_id: seen })
  assert.equal(pic.content[0]!.type, 'image')
  assert.equal(pic.content[0]!.mimeType, 'image/png')
  assert.equal(pic.content[0]!.data, PNG)
  assert.match(pic.content[1]!.text!, /bug\.png/)
  const refused = await tool('read_file', { file_id: hidden })
  assert.equal(refused.isError, true)
  assert.match(refused.content[0]!.text!, /not_found|404/)

  // A short text file comes back as its words.
  const notes = JSON.parse(
    (await ok('upload_file', { project_id: shared.id, name: 'notes.md', text: '# Notes\nShip it.' })).content[0]!.text!,
  )
  const words = (await ok('read_file', { file_id: notes.id })).content[0]!.text!
  assert.ok(words.includes('Ship it.') && words.startsWith('<user_content source="file">'), words)
})

test('the links are for a token only, and only for files the reader may see', async () => {
  const { owner, as, shared, benBearer, token, main } = await setUp()
  const mine = await uploadInto(main, benBearer, 'mine.png')
  const secret = (
    (await json(
      await app.request(`/api/projects/${shared.id}/conversations`, {
        method: 'POST',
        headers: as(owner.token),
        body: JSON.stringify({ name: 'leads', member_ids: [owner.ctx.actorId] }),
      }),
    )) as { id: string }
  ).id
  const hidden = await uploadInto(secret, owner.token, 'hidden.png')

  // A session — a window — is not handed a link that stands on its own.
  assert.equal((await app.request(`/api/file-links?ids=${mine}`, { headers: as(benBearer) })).status, 403)
  assert.equal((await app.request(`/api/files/${mine}/content`, { headers: as(benBearer) })).status, 403)

  const both = (await json(await app.request(`/api/file-links?ids=${mine},${hidden}`, { headers: as(token) }))) as {
    links: { id: string }[]
  }
  assert.deepEqual(
    both.links.map((l) => l.id),
    [mine],
  )
  assert.equal((await app.request(`/api/files/${hidden}/content`, { headers: as(token) })).status, 404)
  assert.equal((await app.request('/api/file-links?ids=nope', { headers: as(token) })).status, 400)
  const linked = async (id: string, with_ = token) =>
    ((await json(await app.request(`/api/file-links?ids=${id}`, { headers: as(with_) }))) as { links: { id: string }[] }).links.length

  // Another workspace's file, by its id, is nobody's here.
  const other = await makeOwner()
  const otherProject = (
    (await json(
      await app.request('/api/projects', { method: 'POST', headers: as(other.token), body: JSON.stringify({ name: 'Theirs' }) }),
    )) as { id: string }
  ).id
  const form = new FormData()
  form.set('file', new File([Buffer.from(PNG, 'base64')], 'x.png', { type: 'image/png' }))
  const across = (await json(
    await app.request(`/api/projects/${otherProject}/uploads`, {
      method: 'POST',
      headers: { authorization: `Bearer ${other.token}` },
      body: form,
    }),
  )) as { id: string }
  assert.equal(await linked(across.id), 0)
  assert.equal((await app.request(`/api/files/${across.id}/content`, { headers: as(token) })).status, 404)

  // A file in a direct conversation: for a token kept to projects, not there at all.
  const dm = (await json(
    await app.request('/api/conversations/direct', {
      method: 'POST',
      headers: as(benBearer),
      body: JSON.stringify({ actor_ids: [owner.ctx.actorId] }),
    }),
  )) as { id: string }
  const inDm = await uploadInto(dm.id, benBearer, 'dm.png')
  assert.equal(await linked(inDm), 1)
  const kept = (await json(
    await app.request('/api/tokens', {
      method: 'POST',
      headers: as(benBearer),
      body: JSON.stringify({ name: 'Kept', project_ids: [shared.id] }),
    }),
  )) as { token: string }
  assert.equal(await linked(inDm, kept.token), 0)
  assert.equal((await app.request(`/api/files/${inDm}/content`, { headers: as(kept.token) })).status, 404)
  assert.equal(await linked(mine, kept.token), 1)

  // A file in the bin, and one whose message was taken back, are linked no longer.
  const binned = await uploadInto(main, benBearer, 'binned.png')
  assert.equal((await app.request(`/api/files/${binned}`, { method: 'DELETE', headers: as(benBearer) })).status, 200)
  assert.equal(await linked(binned), 0)
  assert.equal((await app.request(`/api/files/${binned}/content`, { headers: as(token) })).status, 404)
  const shown = await uploadInto(main, benBearer, 'shown.png')
  const said = (await json(
    await app.request(`/api/conversations/${main}/messages`, {
      method: 'POST',
      headers: as(benBearer),
      body: JSON.stringify({ body: { type: 'doc', content: [attachment(shown, 'shown.png')] } }),
    }),
  )) as { id: string }
  assert.equal(await linked(shown), 1)
  assert.equal((await app.request(`/api/messages/${said.id}`, { method: 'DELETE', headers: as(benBearer) })).status, 200)
  assert.equal(await linked(shown), 0)
  assert.equal((await app.request(`/api/files/${shown}/content`, { headers: as(token) })).status, 404)
})

test('a handle in Markdown becomes the task, and only a task the writer can see', async () => {
  const { owner, as, shared, elsewhere, mobile, ben, ok, main } = await setUp()
  const task = JSON.parse((await ok('create_task', { project_id: shared.id, title: 'Fix the login' })).content[0]!.text!) as {
    id: string
    number: number
  }
  // A task in a project the agent's person is not on.
  const away = (await json(
    await app.request(`/api/projects/${elsewhere.id}/tasks`, {
      method: 'POST',
      headers: as(owner.token),
      body: JSON.stringify({ title: 'Run payroll' }),
    }),
  )) as { number: number }

  const handle = `${shared.key}-${task.number}`
  const body = `See ${handle}, ${shared.key}-99999, ISO-9001, \`${handle}\` and ${elsewhere.key}-${away.number}.\n\n\`\`\`\n${handle}\n\`\`\`\n\n[${handle}](https://example.com/${handle})`
  const { id } = JSON.parse((await ok('send_message', { conversation_id: main, body })).content[0]!.text!) as { id: string }

  const { messages } = (await json(await app.request(`/api/conversations/${main}/messages`, { headers: as(owner.token) }))) as {
    messages: { id: string; body: { content: { type: string; content?: Record<string, unknown>[] }[] } }[]
  }
  const stored = messages.find((m) => m.id === id)!.body
  const refs: Record<string, unknown>[] = []
  const words: string[] = []
  const walk = (n: Record<string, unknown>) => {
    if (n.type === 'taskref') refs.push(n.attrs as Record<string, unknown>)
    if (n.type === 'text') words.push(String(n.text))
    for (const k of (n.content as Record<string, unknown>[] | undefined) ?? []) walk(k)
  }
  walk(stored as unknown as Record<string, unknown>)
  assert.equal(refs.length, 1, JSON.stringify(stored))
  assert.deepEqual(refs[0], { id: task.id, projectId: shared.id, number: task.number, key: shared.key, title: 'Fix the login' })
  const said = words.join('')
  assert.ok(said.includes(`${shared.key}-99999`), said)
  assert.ok(said.includes('ISO-9001'), said)
  assert.ok(said.includes(`${elsewhere.key}-${away.number}`), 'a task out of sight stays its words')
  // In code, in a block of code and in a link, it is the words still.
  assert.equal(words.filter((w) => w === handle).length, 3, said)

  // Into another project's task the same handle stays words: a chip would
  // write the title where its readers may not be allowed to read it.
  const there = JSON.parse((await ok('create_task', { project_id: mobile.id, title: 'Ship the app' })).content[0]!.text!) as {
    id: string
  }
  await ok('comment', { object_type: 'task', object_id: there.id, body: `Waits on ${handle}.` })
  const thereRead = JSON.stringify(await json(await app.request(`/api/tasks/${there.id}`, { headers: as(owner.token) })))
  assert.ok(!thereRead.includes('"type":"taskref"') && thereRead.includes(`Waits on ${handle}.`), thereRead)
  const dm = (await json(
    await app.request('/api/conversations/direct', {
      method: 'POST',
      headers: as(owner.token),
      body: JSON.stringify({ actor_ids: [ben.actorId] }),
    }),
  )) as { id: string }
  const { id: inDm } = JSON.parse((await ok('send_message', { conversation_id: dm.id, body: `About ${handle}` })).content[0]!.text!) as {
    id: string
  }
  const dmRead = (await json(await app.request(`/api/conversations/${dm.id}/messages`, { headers: as(owner.token) }))) as {
    messages: { id: string; body: unknown }[]
  }
  // A direct conversation with the workspace's owner, who reads every project: the chip.
  const dmBody = JSON.stringify(dmRead.messages.find((m) => m.id === inDm)!.body)
  assert.ok(dmBody.includes('"type":"taskref"') && !dmBody.includes(`About ${handle}`), dmBody)
  // And a new task in the same project makes the chip.
  const same = JSON.parse(
    (await ok('create_task', { project_id: shared.id, title: 'Follow-up', description: `After ${handle}` })).content[0]!.text!,
  ) as { id: string }
  assert.ok(
    JSON.stringify(await json(await app.request(`/api/tasks/${same.id}`, { headers: as(owner.token) }))).includes('"type":"taskref"'),
  )

  // The same on a comment and an announcement.
  await ok('comment', { object_type: 'task', object_id: task.id, body: `Duplicate of ${handle}.` })
  const comments = JSON.stringify(await json(await app.request(`/api/tasks/${task.id}`, { headers: as(owner.token) })))
  assert.ok(comments.includes('"type":"taskref"'), comments)

  // And the endpoint answers only what is there and theirs.
  const looked = (await json(
    await app.request(`/api/task-handles?project=${shared.id}&handles=${handle},${elsewhere.key}-${away.number},ISO-9001`, {
      headers: as(owner.token),
    }),
  )) as { tasks: { handle: string }[] }
  assert.deepEqual(
    looked.tasks.map((t) => t.handle),
    [handle],
  )
  assert.equal((await app.request(`/api/task-handles?project=${shared.id}&handles=lower-1`, { headers: as(owner.token) })).status, 400)
  assert.equal((await app.request(`/api/task-handles?handles=${handle}`, { headers: as(owner.token) })).status, 400)
})

test('in a room outside every project a handle is the task only when everybody in the room may read it', async () => {
  const { owner, as, shared, elsewhere, main } = await setUp()
  const made = await app.request('/api/agents', {
    method: 'POST',
    headers: as(owner.token),
    body: JSON.stringify({ name: 'Grok', project_ids: [shared.id], reach: 'mcp' }),
  })
  assert.equal(made.status, 201, JSON.stringify(await made.clone().json()))
  const agent = (await json(made)) as { agent_id: string; token: string }
  let n = 0
  const send = async (conversation_id: string, body: string) => {
    const r = (
      await json(
        await app.request('/mcp', {
          method: 'POST',
          headers: { ...as(agent.token), accept: 'application/json, text/event-stream' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: ++n,
            method: 'tools/call',
            params: { name: 'send_message', arguments: { conversation_id, body } },
          }),
        }),
      )
    ).result as Result
    assert.notEqual(r.isError, true, String(r.content[0]?.text))
    return (JSON.parse(r.content[0]!.text!) as { id: string }).id
  }
  const newTask = async (project: string, title: string) =>
    (await json(
      await app.request(`/api/projects/${project}/tasks`, { method: 'POST', headers: as(owner.token), body: JSON.stringify({ title }) }),
    )) as { number: number }
  const handle = `${shared.key}-${(await newTask(shared.id, 'Fix the login')).number}`
  const other = `${elsewhere.key}-${(await newTask(elsewhere.id, 'Run payroll')).number}`

  const carol = await addPerson(owner.ctx, owner.workspaceId, 'member', [shared.id])
  const carolBearer = await bearerFor(carol.actorId, owner.workspaceId)
  const dave = await addPerson(owner.ctx, owner.workspaceId, 'member', [])
  const daveBearer = await bearerFor(dave.actorId, owner.workspaceId)
  const room = async (bearer: string, actor_ids: string[]) => {
    const r = await app.request('/api/conversations/direct', { method: 'POST', headers: as(bearer), body: JSON.stringify({ actor_ids }) })
    assert.ok(r.status === 201 || r.status === 200, JSON.stringify(await r.clone().json()))
    return ((await json(r)) as { id: string }).id
  }
  const chips = async (conversation: string, bearer: string, id: string) => {
    const { messages } = (await json(await app.request(`/api/conversations/${conversation}/messages`, { headers: as(bearer) }))) as {
      messages: { id: string; body: unknown }[]
    }
    return JSON.stringify(messages.find((m) => m.id === id)!.body).includes('"type":"taskref"')
  }

  // Both on the project: the chip.
  const withCarol = await room(carolBearer, [agent.agent_id])
  assert.equal(await chips(withCarol, carolBearer, await send(withCarol, `Done: ${handle}`)), true)
  // The person is not on it, although the agent is: the words.
  const withDave = await room(daveBearer, [agent.agent_id])
  assert.equal(await chips(withDave, daveBearer, await send(withDave, `Done: ${handle}`)), false)
  // Three of them, one not on it: the words.
  const three = await room(carolBearer, [agent.agent_id, dave.actorId])
  assert.equal(await chips(three, carolBearer, await send(three, `Done: ${handle}`)), false)

  const ask = async (bearer: string, q: string) => {
    const r = await app.request(`/api/task-handles?${q}`, { headers: as(bearer) })
    return { status: r.status, handles: ((await json(r)).tasks as { handle: string }[] | undefined)?.map((t) => t.handle) }
  }
  // A room the writer is not in is not answered about.
  assert.equal((await ask(owner.token, `conversation=${withCarol}&handles=${handle}`)).status, 404)
  assert.equal((await ask(owner.token, `conversation=${crypto.randomUUID()}&handles=${handle}`)).status, 404)
  // A project's room still takes that project's tasks only, though the writer reads both.
  assert.deepEqual((await ask(owner.token, `conversation=${main}&handles=${handle},${other}`)).handles, [handle])
  // Carol's room, asked by Carol, who cannot read the other project.
  assert.deepEqual((await ask(carolBearer, `conversation=${withCarol}&handles=${handle},${other}`)).handles, [handle])
  // A project and a room at once, or a room that is no id, is a question with no answer.
  assert.equal((await ask(owner.token, `project=${shared.id}&conversation=${main}&handles=${handle}`)).status, 400)
  assert.equal((await ask(owner.token, `conversation=nope&handles=${handle}`)).status, 400)
})
