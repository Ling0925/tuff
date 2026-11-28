import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import postgres from 'postgres'
import { app } from '../src/http/routes.js'
import { addPerson, bearerFor, closeDb, makeOwner, makeProject } from './helpers.js'

after(async () => {
  await closeDb()
})

/*
 * An agent elsewhere connects by OAuth and talks to /mcp.
 * The whole of what ChatGPT does, in order:
 * find the metadata, register, have the person allow it, trade the code,
 * call a tool, renew the token.
 */
const json = async (r: Response) => (await r.json()) as Record<string, unknown>
const back = 'https://agent.example/callback'

function pkce() {
  const verifier = randomBytes(32).toString('base64url')
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') }
}

async function register() {
  const r = await app.request('/oauth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: 'ChatGPT', redirect_uris: [back] }),
  })
  assert.equal(r.status, 201)
  return (await json(r)).client_id as string
}

async function allowed(token: string, clientId: string, challenge: string) {
  const r = await app.request('/api/oauth/authorize', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({
      client_id: clientId,
      redirect_uri: back,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state: 'xyz',
    }),
  })
  assert.equal(r.status, 200)
  const to = new URL((await json(r)).redirect as string)
  assert.equal(to.origin + to.pathname, back)
  assert.equal(to.searchParams.get('state'), 'xyz')
  return to.searchParams.get('code')!
}

const trade = (form: Record<string, string>) =>
  app.request('/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
  })

const mcp = (token: string | null, body: unknown) =>
  app.request('/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })

test('the metadata says where to sign in, and /mcp with no token points there', async () => {
  const meta = await json(await app.request('/.well-known/oauth-authorization-server'))
  assert.match(meta.token_endpoint as string, /\/oauth\/token$/)
  assert.deepEqual(meta.code_challenge_methods_supported, ['S256'])
  const res = await json(await app.request('/.well-known/oauth-protected-resource'))
  assert.match(res.resource as string, /\/mcp$/)

  const no = await mcp(null, { jsonrpc: '2.0', id: 1, method: 'tools/list' })
  assert.equal(no.status, 401)
  assert.match(no.headers.get('www-authenticate') ?? '', /resource_metadata=".*\/\.well-known\/oauth-protected-resource"/)
})

test('a client may only be sent back over TLS or to the machine it runs on', async () => {
  for (const uri of ['http://agent.example/cb', 'myapp://cb', 'https://agent.example/cb#x']) {
    const r = await app.request('/oauth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ redirect_uris: [uri] }),
    })
    assert.equal(r.status, 400, uri)
  }
})

test('an agent is allowed, trades its code, uses the tools, and renews once', async () => {
  const owner = await makeOwner()
  await makeProject(owner.ctx, owner.workspaceId, 'Connected')
  const clientId = await register()

  // The page asks who is asking, and refuses an address it was not given.
  const who = await app.request(`/api/oauth/client?client_id=${clientId}&redirect_uri=${encodeURIComponent(back)}`, {
    headers: { authorization: `Bearer ${owner.token}` },
  })
  assert.equal((await json(who)).name, 'ChatGPT')
  const elsewhere = await app.request(
    `/api/oauth/client?client_id=${clientId}&redirect_uri=${encodeURIComponent('https://evil.example/cb')}`,
    { headers: { authorization: `Bearer ${owner.token}` } },
  )
  assert.equal(elsewhere.status, 400)

  const { verifier, challenge } = pkce()
  const code = await allowed(owner.token, clientId, challenge)

  // The wrong verifier spends the code, and the right one cannot use it after.
  const wrong = await trade({
    grant_type: 'authorization_code',
    code,
    redirect_uri: back,
    client_id: clientId,
    code_verifier: pkce().verifier,
  })
  assert.equal(wrong.status, 400)
  assert.equal((await json(wrong)).error, 'invalid_grant')
  const late = await trade({ grant_type: 'authorization_code', code, redirect_uri: back, client_id: clientId, code_verifier: verifier })
  assert.equal(late.status, 400)

  const second = pkce()
  const code2 = await allowed(owner.token, clientId, second.challenge)
  const got = await trade({
    grant_type: 'authorization_code',
    code: code2,
    redirect_uri: back,
    client_id: clientId,
    code_verifier: second.verifier,
  })
  assert.equal(got.status, 200)
  const pairOne = await json(got)
  assert.match(pairOne.access_token as string, /^tok_/)
  assert.match(pairOne.refresh_token as string, /^ref_/)

  // The tools, over HTTP, as the person.
  const init = await mcp(pairOne.access_token as string, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } },
  })
  assert.equal(init.status, 200)
  // What it is told on connecting: links come from url, never made up.
  const hello = (await json(init)).result as { instructions?: string; serverInfo?: { name: string; version: string } }
  assert.match(hello.instructions ?? '', /Never build or guess an address/)
  // The release it says it is, the one /health reports — never a number of its own.
  const health = await json(await app.request('/health'))
  assert.equal(hello.serverInfo?.version, health.version)
  const listed = await json(await mcp(pairOne.access_token as string, { jsonrpc: '2.0', id: 2, method: 'tools/list' }))
  const names = (listed.result as { tools: { name: string }[] }).tools.map((t) => t.name)
  assert.ok(names.includes('list_projects') && names.includes('create_task'))
  // Every tool says what it is, for the agent and for a directory's review.
  const tools = (listed.result as { tools: { name: string; title?: string; annotations?: Record<string, boolean> }[] }).tools
  assert.ok(tools.every((t) => t.title && t.annotations && t.annotations.openWorldHint === false))
  assert.equal(tools.find((t) => t.name === 'list_projects')!.annotations!.readOnlyHint, true)
  assert.equal(tools.find((t) => t.name === 'create_task')!.annotations!.readOnlyHint, false)
  const called = await json(
    await mcp(pairOne.access_token as string, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'list_projects', arguments: {} },
    }),
  )
  const said = (called.result as { content: { text: string }[] }).content[0]!.text
  assert.ok(said.includes('Connected'), 'the project is listed, read through the REST API')

  // And it is a token: it may not manage tokens.
  const minting = await app.request('/api/tokens', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${pairOne.access_token}` },
    body: JSON.stringify({ name: 'more' }),
  })
  assert.equal(minting.status, 403)

  // Renewed: a new pair, the old token dead, the old refresh token spent.
  const renewed = await trade({ grant_type: 'refresh_token', refresh_token: pairOne.refresh_token as string, client_id: clientId })
  assert.equal(renewed.status, 200)
  const pairTwo = await json(renewed)
  assert.notEqual(pairTwo.access_token, pairOne.access_token)
  assert.equal((await mcp(pairOne.access_token as string, { jsonrpc: '2.0', id: 4, method: 'tools/list' })).status, 401)
  assert.equal((await mcp(pairTwo.access_token as string, { jsonrpc: '2.0', id: 5, method: 'tools/list' })).status, 200)
  const again = await trade({ grant_type: 'refresh_token', refresh_token: pairOne.refresh_token as string, client_id: clientId })
  assert.equal(again.status, 400)

  // Revoked in Account, it is disconnected: no refresh left in it.
  const tokens = (await json(await app.request('/api/tokens', { headers: { authorization: `Bearer ${owner.token}` } }))).tokens as {
    id: string
    name: string
    revoked_at: string | null
  }[]
  const live = tokens.find((t) => t.name === 'ChatGPT' && !t.revoked_at)!
  await app.request(`/api/tokens/${live.id}/revoke`, { method: 'POST', headers: { authorization: `Bearer ${owner.token}` } })
  const dead = await trade({ grant_type: 'refresh_token', refresh_token: pairTwo.refresh_token as string, client_id: clientId })
  assert.equal(dead.status, 400)
})

test('a token cannot connect another agent', async () => {
  const owner = await makeOwner()
  const clientId = await register()
  const made = await app.request('/api/tokens', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${owner.token}` },
    body: JSON.stringify({ name: 'mine' }),
  })
  const token = (await json(made)).token as string
  const r = await app.request('/api/oauth/authorize', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ client_id: clientId, redirect_uri: back, code_challenge: pkce().challenge, code_challenge_method: 'S256' }),
  })
  assert.equal(r.status, 403)
})

/*
 * The loop an agent in a terminal runs: what is on me, read one by its
 * handle, move it along, say what was done.
 */
test('an agent finds its task, reads it by handle, moves it and comments', async () => {
  const owner = await makeOwner()
  const as = (token: string) => ({ 'content-type': 'application/json', authorization: `Bearer ${token}` })
  // Through the API, which gives a project its lists.
  const project = (
    await json(await app.request('/api/projects', { method: 'POST', headers: as(owner.token), body: JSON.stringify({ name: 'Terminal' }) }))
  ).id as string
  const said = await json(await app.request(`/api/projects/${project}/lists`, { headers: as(owner.token) }))
  const lists = (said.lists ?? said) as { id: string; name: string }[]
  const made = await json(
    await app.request(`/api/projects/${project}/tasks`, {
      method: 'POST',
      headers: as(owner.token),
      body: JSON.stringify({ title: 'Wire the export', assignee_id: owner.ctx.actorId, list_id: lists[0]!.id }),
    }),
  )
  await app.request(`/api/tasks/${made.id}/comments`, {
    method: 'POST',
    headers: as(owner.token),
    body: JSON.stringify({
      body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Use the CSV shape.' }] }] },
    }),
  })
  const token = (
    await json(
      await app.request('/api/tokens', { method: 'POST', headers: as(owner.token), body: JSON.stringify({ name: 'Claude Code' }) }),
    )
  ).token as string
  let id = 0
  const tool = async (name: string, args: Record<string, unknown>) => {
    const r = await json(await mcp(token, { jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } }))
    const result = r.result as { content: { text: string }[]; isError?: boolean }
    assert.notEqual(result.isError, true, result.content[0]!.text)
    return result.content[0]!.text
  }

  const mine = await tool('my_tasks', {})
  const handle = /"handle": "([A-Z0-9]+-\d+)"/.exec(mine)?.[1]
  assert.ok(handle, mine)
  assert.ok(mine.includes('Wire the export') && mine.includes(`"list_name": "${lists[0]!.name}"`))
  // And where it opens, as the app's own address says it.
  assert.match(mine, /"url": "https?:\/\/[^"]+\/[a-z0-9-]+\/terminal\/tasks\/\d+"/)

  const read = await tool('read_task', { task: handle! })
  assert.ok(read.includes('Wire the export') && read.includes('Use the CSV shape.'), 'the task and what was said on it')
  assert.ok(read.includes(lists[1]!.id), 'and the lists to move it to')
  assert.match(read, /"url": "https?:\/\/[^"]+\/terminal\/tasks\/\d+"/)
  assert.ok(!read.includes('"files"'), 'not the signed links')

  await tool('update_task', { task_id: made.id, list_id: lists[1]!.id })
  const done = JSON.parse(await tool('comment', { object_type: 'tasks', object_id: made.id, body: 'Done: the export writes CSV.' })) as {
    id: string
  }
  // And answered under that comment, in its thread, not beside it.
  const answer = JSON.parse(
    await tool('comment', { object_type: 'tasks', object_id: made.id, body: 'And the headers too.', reply_to: done.id }),
  ) as { id: string }
  const thread = await tool('read_task', { task: made.id })
  const body = JSON.parse(thread.slice(thread.indexOf('{'), thread.lastIndexOf('}') + 1)) as {
    comments: { id: string; parent_id: string | null }[]
  }
  assert.equal(body.comments.find((c) => c.id === answer.id)?.parent_id, done.id)
  const after = await tool('my_tasks', {})
  assert.ok(after.includes(`"list_name": "${lists[1]!.name}"`), after)

  const nothing = await json(
    await mcp(token, { jsonrpc: '2.0', id: 99, method: 'tools/call', params: { name: 'read_task', arguments: { task: 'ZZZ-99999' } } }),
  )
  assert.equal((nothing.result as { isError?: boolean }).isError, true)
})

/* What was said in chat, found and read around. */
test('an agent finds a message in chat and reads the thread it is in', async () => {
  const owner = await makeOwner()
  const as = (token: string) => ({ 'content-type': 'application/json', authorization: `Bearer ${owner.token}` })
  const post = async (path: string, body: unknown) =>
    json(await app.request(path, { method: 'POST', headers: as(owner.token), body: JSON.stringify(body) }))
  const project = (await post('/api/projects', { name: 'Talk' })).id as string
  const word = `rivet${Date.now().toString(36)}`
  const room = (await post(`/api/projects/${project}/conversations`, { name: `talk-${Date.now().toString(36)}` })).id as string
  const text = (t: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] })
  const head = (await post(`/api/conversations/${room}/messages`, { body: text('Which fasteners?') })).id as string
  const reply = (await post(`/api/conversations/${room}/messages`, { body: text(`The ${word} kind, stainless`), parent_id: head }))
    .id as string
  const token = (await post('/api/tokens', { name: 'Agent' })).token as string
  let id = 0
  const tool = async (name: string, args: Record<string, unknown>) => {
    const r = await json(await mcp(token, { jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } }))
    const result = r.result as { content: { text: string }[]; isError?: boolean }
    assert.notEqual(result.isError, true, result.content[0]!.text)
    return result.content[0]!.text
  }

  const found = await tool('search', { q: word })
  assert.ok(found.includes(`"id": "${reply}"`), found)
  assert.ok(found.includes(`"thread_id": "${head}"`) && found.includes(`"conversation_id": "${room}"`))
  assert.match(found, new RegExp(`"room": "[^"]*talk-`))
  assert.match(found, new RegExp(`"url": "https?://[^"]+/chat/${room}/${head}/${reply}"`))
  const thread = await tool('read_messages', { conversation_id: room, thread_id: head })
  assert.ok(thread.includes(`The ${word} kind`), thread)
})

/*
 * Every project's channel is called `main`, so messages found across the
 * workspace all said they were "in main". A project's channel is named with
 * its project, and a direct conversation still by the people in it.
 */
test('a message found in search names its room with its project, and a direct one with the people', async () => {
  const owner = await makeOwner()
  const sam = await addPerson(owner.ctx, owner.workspaceId, 'member')
  const as = { 'content-type': 'application/json', authorization: `Bearer ${owner.token}` }
  const post = async (path: string, body: unknown) =>
    json(await app.request(path, { method: 'POST', headers: as, body: JSON.stringify(body) }))
  const word = `grommet${Date.now().toString(36)}`
  const text = (t: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] })
  const convs = async () =>
    (await json(await app.request('/api/conversations', { headers: as }))).conversations as {
      id: string
      name: string | null
      project_id: string | null
    }[]
  const rooms: Record<string, string> = {}
  for (const name of ['Website', 'Shop']) {
    const project = (await post('/api/projects', { name })).id as string
    const main = (await convs()).find((c) => c.project_id === project && c.name === 'main')!
    rooms[name] = main.id
    await post(`/api/conversations/${main.id}/messages`, { body: text(`${name} needs a ${word}`) })
  }
  const direct = (await post('/api/conversations/direct', { actor_ids: [sam.actorId] })).id as string
  await post(`/api/conversations/${direct}/messages`, { body: text(`One ${word} for you`) })
  const token = (await post('/api/tokens', { name: 'Agent' })).token as string
  const r = await json(
    await mcp(token, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'search', arguments: { q: word, type: 'message' } } }),
  )
  const found = (r.result as { content: { text: string }[] }).content[0]!.text
  const results = (
    JSON.parse(found.replace(/^<user_content[^>]*>\n|\n<\/user_content>$/g, '')) as {
      results: { conversation_id: string; room: string }[]
    }
  ).results
  const roomOf = (id: string) => results.find((m) => m.conversation_id === id)?.room
  assert.equal(roomOf(rooms.Website!), 'Website · main', found)
  assert.equal(roomOf(rooms.Shop!), 'Shop · main', found)
  assert.equal(roomOf(direct), 'member', found)
})

/*
 * A brief belongs in Docs and a task's requirements in the task — and both
 * arrive as the Markdown a model writes, drawn as headings and lists.
 */
test('an agent writes a document and a task description in Markdown, where each belongs', async () => {
  const owner = await makeOwner()
  const as = { 'content-type': 'application/json', authorization: `Bearer ${owner.token}` }
  const project = (await json(await app.request('/api/projects', { method: 'POST', headers: as, body: JSON.stringify({ name: 'Brief' }) })))
    .id as string
  const token = (await json(await app.request('/api/tokens', { method: 'POST', headers: as, body: JSON.stringify({ name: 'ChatGPT' }) })))
    .token as string
  let id = 0
  const tool = async (name: string, args: Record<string, unknown>) => {
    const r = await json(await mcp(token, { jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } }))
    const result = r.result as { content: { text: string }[]; isError?: boolean }
    assert.notEqual(result.isError, true, result.content[0]!.text)
    return result.content[0]!.text
  }

  const doc = await tool('create_doc', {
    project_id: project,
    title: 'Product brief',
    body: '# What it is\n\nA **flat-priced** tracker.\n\n- Tasks\n- Chat',
  })
  /* A receipt, not the document read back: the editor's JSON of a long
     brief was thousands of lines in the agent's context to say "done". */
  const madeDoc = JSON.parse(doc) as { id: string; number: number; url: string }
  assert.deepEqual(Object.keys(madeDoc).sort(), ['id', 'number', 'url'])
  assert.match(madeDoc.url, /^https?:\/\/[^"]+\/brief\/files\/\d+$/)
  assert.ok(!doc.includes('flat-priced'), doc)
  const docId = madeDoc.id
  const file = (await json(await app.request(`/api/files/${docId}`, { headers: as }))).file as {
    name: string
    body: { content: { type: string }[] }
  }
  assert.equal(file.name, 'Product brief')
  assert.deepEqual(
    file.body.content.map((n) => n.type),
    ['heading', 'paragraph', 'bulletList'],
  )
  /* From a template, with its own words after it;
     and a GitHub alert is a callout. */
  const fromTemplate = JSON.parse(
    await tool('create_doc', { project_id: project, template: 'meeting', body: '> [!NOTE]\n> Bring the numbers.' }),
  )
  const minutes = (await json(await app.request(`/api/files/${fromTemplate.id}`, { headers: as }))).file as {
    name: string
    body: { content: { type: string }[] }
  }
  assert.match(minutes.name, /^Meeting notes \d/)
  assert.equal(minutes.body.content.at(-1)?.type, 'callout')
  const updated = JSON.parse(await tool('update_doc', { doc_id: docId, body: '## Scope\n\nOnly the first version.' }))
  // With the revision to pass as base_rev next.
  assert.deepEqual(Object.keys(updated).sort(), ['id', 'ok', 'rev', 'version'])
  assert.equal(updated.id, docId)
  const changed = (await json(await app.request(`/api/files/${docId}`, { headers: as }))).file as {
    body: { content: { type: string; attrs?: { level?: number } }[] }
    version: number
  }
  assert.equal(changed.body.content[0]!.attrs?.level, 2)

  const made = JSON.parse(
    await tool('create_task', {
      project_id: project,
      title: 'Export',
      description: '## Goal\n\nExport tasks.\n\n## Acceptance\n\n1. A CSV\n2. Every task',
    }),
  ) as { id: string; url: string }
  assert.match(made.url, /\/brief\/tasks\/\d+$/)
  const task = (await json(await app.request(`/api/tasks/${made.id}`, { headers: as }))).task as {
    body: { content: { type: string }[] }
  }
  assert.deepEqual(
    task.body.content.map((n) => n.type),
    ['heading', 'paragraph', 'heading', 'orderedList'],
  )
  await tool('update_task', { task_id: made.id, description: 'Just this.' })
  const after = (await json(await app.request(`/api/tasks/${made.id}`, { headers: as }))).task as {
    body: { content: { type: string; content?: { text: string }[] }[] }
  }
  assert.equal(after.body.content[0]!.content![0]!.text, 'Just this.')
})

/*
 * Everything a person may do that a token may too — people, chat, the
 * feed, subtasks, labels, sprints, announcements, comments, files — each
 * tried once through the tools.
 */
test('the rest of what a person does is there for an agent too', async () => {
  const owner = await makeOwner()
  const as = { 'content-type': 'application/json', authorization: `Bearer ${owner.token}` }
  const project = (
    await json(await app.request('/api/projects', { method: 'POST', headers: as, body: JSON.stringify({ name: 'Everything' }) }))
  ).id as string
  const token = (await json(await app.request('/api/tokens', { method: 'POST', headers: as, body: JSON.stringify({ name: 'Agent' }) })))
    .token as string
  let id = 0
  const tool = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await json(await mcp(token, { jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } }))
    const result = r.result as { content: { text: string }[]; isError?: boolean }
    assert.notEqual(result.isError, true, `${name}: ${result.content[0]!.text}`)
    return result.content[0]!.text
  }
  const idIn = (said: string) => /"id": ?"([0-9a-f-]{36})"/.exec(said)![1]!

  assert.ok((await tool('list_people')).includes(owner.ctx.actorId))

  // Chat: find the project's room, say something, answer in its thread, read it back, change it.
  const rooms = await tool('list_conversations')
  const room = new RegExp(`"id": "([0-9a-f-]{36})"[^}]*?"project_id": "${project}"`, 's').exec(rooms)?.[1] ?? idIn(rooms)
  const said = JSON.parse(await tool('send_message', { conversation_id: room, body: 'Kick-off is **Monday**.' })) as { id: string }
  await tool('send_message', { conversation_id: room, body: 'Works for me.', thread_id: said.id })
  const read = await tool('read_messages', { conversation_id: room })
  assert.ok(read.includes('Kick-off is **Monday**.') && read.includes('"replies": 1'), read)
  assert.ok((await tool('read_messages', { conversation_id: room, thread_id: said.id })).includes('Works for me.'))
  await tool('update_message', { message_id: said.id, body: 'Kick-off is Tuesday.' })
  assert.ok((await tool('read_messages', { conversation_id: room })).includes('Kick-off is Tuesday.'))

  // A task with a subtask, a label and a sprint.
  const task = JSON.parse(await tool('create_task', { project_id: project, title: 'Ship it' })) as { id: string }
  const part = JSON.parse(await tool('create_subtask', { task_id: task.id, title: 'Write the notes' })) as { id: string }
  await tool('update_task', { task_id: part.id, completed: true })
  const label = JSON.parse(await tool('create_label', { project_id: project, name: 'Launch' })) as { id: string }
  assert.ok((await tool('list_labels', { project_id: project })).includes('Launch'))
  const cycle = JSON.parse(
    await tool('create_cycle', { project_id: project, name: 'Week 1', starts_on: '2026-11-02', ends_on: '2026-11-08' }),
  ) as { id: string }
  assert.ok((await tool('list_cycles', { project_id: project })).includes('Week 1'))
  await tool('update_task', { task_id: task.id, label_ids: [label.id], cycle_id: cycle.id })
  const whole = await tool('read_task', { task: task.id })
  assert.ok(whole.includes('Write the notes') && whole.includes('Launch') && whole.includes(cycle.id), whole)

  // An announcement, changed, and a comment on it, changed.
  const post = JSON.parse(await tool('create_post', { project_id: project, title: 'Launch day', body: 'Soon.' })) as { id: string }
  await tool('update_post', { post_id: post.id, body: 'On the 9th.' })
  await tool('comment', { object_type: 'posts', object_id: post.id, body: 'Great.' })
  const withComment = await tool('read_post', { post_id: post.id })
  assert.ok(withComment.includes('On the 9th.') && withComment.includes('Great.'), withComment)
  const commentId = /"comments": \[\s*\{\s*"id": "([0-9a-f-]{36})"/.exec(withComment)?.[1]
  assert.ok(commentId, withComment)
  await tool('update_comment', { comment_id: commentId, body: 'Great, thanks.' })
  assert.ok((await tool('read_post', { post_id: post.id })).includes('Great, thanks.'))

  // A file, and the feed that saw all of it.
  const file = await tool('upload_file', { project_id: project, name: 'notes.md', text: '# Notes\n' })
  assert.ok(file.includes('notes.md') && /\/everything\/files\/\d+/.test(file), file)

  // Every write answers with a receipt — what it made or changed and where — never the thing read back.
  const keys = (said: string) => Object.keys(JSON.parse(said) as object).sort()
  assert.deepEqual(keys(file), ['id', 'name', 'number', 'url'])
  assert.deepEqual(keys(await tool('create_post', { project_id: project, title: 'Again', body: 'More.' })), ['id', 'number', 'url'])
  assert.deepEqual(keys(await tool('create_subtask', { task_id: task.id, title: 'Another part' })), ['id', 'number', 'url'])
  assert.deepEqual(keys(await tool('update_task', { task_id: task.id, title: 'Ship it now' })), ['id', 'ok'])
  assert.deepEqual(keys(await tool('update_post', { post_id: post.id, title: 'Launch day!' })), ['id', 'ok'])
  assert.deepEqual(keys(await tool('send_message', { conversation_id: room, body: 'Done.' })), ['id', 'url'])
  const started = JSON.parse(await tool('create_project', { name: 'Receipts' })) as Record<string, unknown>
  assert.deepEqual(Object.keys(started).sort(), ['id', 'key', 'name', 'slug', 'url'])
  assert.match(started.url as string, /\/receipts$/)
  /* A copy of a task in that project, with what it left off said in the
     answer. */
  const copied = JSON.parse(await tool('copy_task', { task_id: task.id, project_id: started.id })) as Record<string, unknown>
  assert.match(copied.url as string, /\/receipts\/tasks\/\d+$/)
  assert.deepEqual(copied.labels_dropped, ['Launch'])
  /* What the agent spent, on the task by its id. */
  const spent = JSON.parse(
    await tool('record_spend', { task: task.id, client: 'Claude Code', tokens: 52000, cost_usd: 0.31, session: 'run-1' }),
  ) as Record<string, unknown>
  assert.deepEqual(Object.keys(spent).sort(), ['id', 'ok', 'task_id'])
  await tool('record_spend', { task: task.id, client: 'Claude Code', tokens: 90000, cost_usd: 0.5, session: 'run-1' })
  const withSpend = await tool('read_task', { task: task.id })
  assert.ok(withSpend.includes('"tokens": 90000') && !withSpend.includes('"tokens": 52000'), withSpend)
  /* A reminder for the person the agent acts for, read in their zone and
     answered as a receipt. */
  const reminded = JSON.parse(await tool('remind_me', { task: task.id, preset: 'tomorrow' })) as {
    reminder: { at: string } | null
  }
  assert.ok(reminded.reminder && Date.parse(reminded.reminder.at) > Date.now(), JSON.stringify(reminded))
  assert.ok((await tool('read_task', { task: task.id })).includes(`"at": "${reminded.reminder!.at}"`))
  assert.equal((JSON.parse(await tool('remind_me', { task: task.id, clear: true })) as { reminder: null }).reminder, null)
  assert.ok((await tool('read_task', { task: task.id })).includes('"my_reminder": null'))
  const feed = await tool('read_activity', { project_id: project })
  assert.ok(feed.includes('Ship it'), feed)
  assert.ok(!feed.includes('remind'), 'a reminder is nobody’s news')
})

/*
 * A picture an agent uploads goes into a task, a comment or anything else
 * it writes — as the editor's own attachment, with its name and its pixels,
 * and only a file the person can see.
 */
test('an agent puts a picture it uploaded into a task and a comment', async () => {
  const owner = await makeOwner()
  const as = { 'content-type': 'application/json', authorization: `Bearer ${owner.token}` }
  const project = (
    await json(await app.request('/api/projects', { method: 'POST', headers: as, body: JSON.stringify({ name: 'Pictures' }) }))
  ).id as string
  const token = (
    await json(await app.request('/api/tokens', { method: 'POST', headers: as, body: JSON.stringify({ name: 'Claude Code' }) }))
  ).token as string
  let id = 0
  const tool = async (name: string, args: Record<string, unknown>) => {
    const r = await json(await mcp(token, { jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } }))
    return r.result as { content: { text: string }[]; isError?: boolean }
  }
  const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
  const up = await tool('upload_file', { project_id: project, name: 'bug.png', content_base64: PNG })
  assert.notEqual(up.isError, true, up.content[0]!.text)
  const fileId = (JSON.parse(up.content[0]!.text) as { id: string }).id

  const made = await tool('create_task', {
    project_id: project,
    title: 'The menu overlaps',
    description: 'On a phone:\n\n![The overlap](file:' + fileId + ')',
  })
  assert.notEqual(made.isError, true, made.content[0]!.text)
  const taskId = (JSON.parse(made.content[0]!.text) as { id: string }).id
  const task = (await json(await app.request(`/api/tasks/${taskId}`, { headers: as }))).task as {
    body: { content: { type: string; attrs?: Record<string, unknown> }[] }
  }
  const pic = task.body.content.find((n) => n.type === 'attachment')!
  assert.equal(pic.attrs!.fileId, fileId)
  assert.equal(pic.attrs!.kind, 'image')
  assert.equal(pic.attrs!.name, 'bug.png')
  assert.equal(pic.attrs!.pixelWidth, 1)

  // Added to what a task says, without rewriting it — and not twice: the
  // file is already in the description, so nothing is appended for it.
  assert.notEqual((await tool('update_task', { task_id: taskId, attachments: [fileId] })).isError, true)
  const again = (await json(await app.request(`/api/tasks/${taskId}`, { headers: as }))).task as {
    body: { content: { type: string }[] }
  }
  assert.deepEqual(
    again.body.content.map((n) => n.type),
    ['paragraph', 'attachment'],
  )

  assert.notEqual(
    (await tool('comment', { object_type: 'tasks', object_id: taskId, body: 'Same on tablet.', attachments: [fileId] })).isError,
    true,
  )
  /* Written out in the markdown and passed in `attachments` both — as the
     tool says it may be — the picture is in the comment once, not twice. */
  assert.notEqual(
    (
      await tool('comment', {
        object_type: 'tasks',
        object_id: taskId,
        body: 'Here:\n\n![bug](file:' + fileId + ')',
        attachments: [fileId, fileId],
      })
    ).isError,
    true,
  )
  const comments = (await json(await app.request(`/api/tasks/${taskId}/comments`, { headers: as }))) as {
    comments: { body: { content: { type: string }[] } }[]
  }
  const last = comments.comments[comments.comments.length - 1]!
  assert.equal(last.body.content.filter((n) => n.type === 'attachment').length, 1, JSON.stringify(last.body.content.map((n) => n.type)))
  const bogus = await tool('comment', {
    object_type: 'tasks',
    object_id: taskId,
    body: 'x',
    attachments: ['01a0ec91-07c7-708e-a580-53538431be93'],
  })
  assert.equal(bogus.isError, true)
  assert.match(bogus.content[0]!.text, /upload_file/)
})

/* A refresh spent once simply stopped working: a stolen one used first kept
   the thief's chain alive for ninety days, and the agent it was stolen from
   connected again none the wiser. Presented again — past the moment a
   client retrying a lost answer would — it ends the whole connection. */
test('a refresh token presented twice ends the connection it came from', async () => {
  const owner = await makeOwner()
  const clientId = await register()
  const { verifier, challenge } = pkce()
  const code = await allowed(owner.token, clientId, challenge)
  const first = await json(
    await trade({ grant_type: 'authorization_code', code, redirect_uri: back, client_id: clientId, code_verifier: verifier }),
  )
  // The thief renews first.
  const thief = await json(await trade({ grant_type: 'refresh_token', refresh_token: first.refresh_token as string, client_id: clientId }))
  assert.equal((await mcp(thief.access_token as string, { jsonrpc: '2.0', id: 1, method: 'tools/list' })).status, 200)

  // A retry a moment later is a retry: refused, and nothing else ended.
  assert.equal(
    (await trade({ grant_type: 'refresh_token', refresh_token: first.refresh_token as string, client_id: clientId })).status,
    400,
  )
  assert.equal((await mcp(thief.access_token as string, { jsonrpc: '2.0', id: 2, method: 'tools/list' })).status, 200)

  // The robbed agent, later, with the refresh it still holds.
  const db = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} })
  try {
    await db`update oauth_refresh_spent set spent_at = now() - interval '1 minute'
             where hash = ${createHash('sha256')
               .update(first.refresh_token as string)
               .digest('base64url')}`
  } finally {
    await db.end()
  }
  assert.equal(
    (await trade({ grant_type: 'refresh_token', refresh_token: first.refresh_token as string, client_id: clientId })).status,
    400,
  )
  assert.equal((await mcp(thief.access_token as string, { jsonrpc: '2.0', id: 3, method: 'tools/list' })).status, 401)
  assert.equal(
    (await trade({ grant_type: 'refresh_token', refresh_token: thief.refresh_token as string, client_id: clientId })).status,
    400,
  )
})

/*
 * A document's lines made into tasks by an agent:
 * nothing made that cannot be placed, a line said twice placed twice, a
 * thread's line becoming the chip, and an edit made meanwhile kept.
 */
test('tasks_from_doc makes only what it can place, and merges with what was written meanwhile', async () => {
  const owner = await makeOwner()
  const as = { 'content-type': 'application/json', authorization: `Bearer ${owner.token}` }
  const project = (await json(await app.request('/api/projects', { method: 'POST', headers: as, body: JSON.stringify({ name: 'Lines' }) })))
    .id as string
  const token = (await json(await app.request('/api/tokens', { method: 'POST', headers: as, body: JSON.stringify({ name: 'Agent' }) })))
    .token as string
  let id = 0
  const call = async (name: string, args: Record<string, unknown>) => {
    const r = await json(await mcp(token, { jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } }))
    return r.result as { content: { text: string }[]; isError?: boolean }
  }
  const p = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] })
  const doc = (
    await json(
      await app.request(`/api/projects/${project}/files`, {
        method: 'POST',
        headers: as,
        body: JSON.stringify({
          name: 'Notes',
          body: { type: 'doc', content: [p('Call the printer'), p('Call the printer'), p('Agree the wording'), p('Untouched.')] },
        }),
      }),
    )
  ).id as string
  const tasksNow = async () =>
    ((await json(await app.request(`/api/projects/${project}/tasks`, { headers: as }))).tasks as unknown[]).length
  // A thread on the third line.
  assert.equal(
    (
      await app.request(`/api/files/${doc}/comments`, {
        method: 'POST',
        headers: as,
        body: JSON.stringify({ body: { type: 'doc', content: [p('ok?')] }, anchor: { text: 'Agree the wording' } }),
      })
    ).status,
    201,
  )

  // A line not there: refused, and no task made.
  const before = await tasksNow()
  const no = await call('tasks_from_doc', { doc_id: doc, lines: ['Call the printer', 'Not in it'] })
  assert.equal(no.isError, true)
  assert.equal(await tasksNow(), before)

  const read = (await json(await app.request(`/api/files/${doc}`, { headers: as }))).file as { rev: number; may_edit: boolean }
  assert.equal(read.may_edit, true)
  const ok = await call('tasks_from_doc', { doc_id: doc, lines: ['Call the printer', 'Call the printer', 'Agree the wording'] })
  assert.notEqual(ok.isError, true, ok.content[0]!.text)
  assert.equal(await tasksNow(), before + 3)
  const after = (await json(await app.request(`/api/files/${doc}`, { headers: as }))).file as {
    body: { content: { content: { type: string }[] }[] }
  }
  assert.deepEqual(
    after.body.content.map((b) => b.content.map((k) => k.type).join()),
    ['taskref', 'taskref', 'taskref', 'text'],
  )

  // Somebody who may make tasks but not edit the owner's document: told before any task is made.
  assert.equal(
    (await app.request('/api/workspace', { method: 'PATCH', headers: as, body: JSON.stringify({ edit_others_content: 'own_only' }) }))
      .status,
    200,
  )
  const kim = await addPerson(owner.ctx, owner.workspaceId, 'member', [project], ['task.create'])
  const kimAs = { 'content-type': 'application/json', authorization: `Bearer ${await bearerFor(kim.actorId, owner.workspaceId)}` }
  const kimToken = (
    await json(await app.request('/api/tokens', { method: 'POST', headers: kimAs, body: JSON.stringify({ name: 'Kim agent' }) }))
  ).token as string
  const fresh = (
    await json(
      await app.request(`/api/projects/${project}/files`, {
        method: 'POST',
        headers: as,
        body: JSON.stringify({ name: 'Owner only', body: { type: 'doc', content: [p('Book the hall')] } }),
      }),
    )
  ).id as string
  const counted = await tasksNow()
  const refused = (
    await json(
      await mcp(kimToken, {
        jsonrpc: '2.0',
        id: ++id,
        method: 'tools/call',
        params: { name: 'tasks_from_doc', arguments: { doc_id: fresh, lines: ['Book the hall'] } },
      }),
    )
  ).result as { isError?: boolean; content: { text: string }[] }
  assert.equal(refused.isError, true, refused.content[0]!.text)
  assert.equal(await tasksNow(), counted)
})
