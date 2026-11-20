import { test, after } from 'node:test'
import postgres from 'postgres'
import assert from 'node:assert/strict'
import { closeDb, withActor, inWorkspace, uuidv7, makeOwner, addPerson, makeProject, bearerFor } from './helpers.js'
import { app } from '../src/http/routes.js'
import { closeRealtime } from '../src/realtime.js'
import { fromSlack, safeHref, type SlackDoc } from '../src/slackIn.js'
import { HOOK_PER_MINUTE } from '../src/http/hooks.js'
import { worstSlack } from './hostile.js'

/*
 * Incoming webhooks into a room, in Slack's shape.
 * Who may make one, the secret, the rate, every malformed body, and what
 * the converter may and may not produce.
 */

/* As the database's owner, for what no request may do: unprove an address. */
const owner = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} })

after(async () => {
  await owner.end()
  await closeRealtime()
  await closeDb()
})

/* ------------------------------------------------------------ helpers */

const call = (token: string | null, method: string, path: string, body?: unknown) =>
  app.request(path, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })

/** Posted from outside, with nobody signed in. */
const deliver = (url: string, body: string, type = 'application/json') =>
  app.request(new URL(url).pathname, { method: 'POST', headers: { 'content-type': type }, body })

async function world() {
  const { ctx, workspaceId, token } = await makeOwner()
  const p = await makeProject(ctx, workspaceId, 'Acme')
  const room = uuidv7()
  await withActor(
    ctx.actorId,
    (tx) =>
      tx`insert into conversation (id, workspace_id, project_id, name, channel) values (${room}, ${workspaceId}, ${p}, 'deploys', true)`,
  )
  return { ctx, workspaceId, token, p, room }
}

async function makeHook(token: string, room: string, name = 'Deploys') {
  const r = await call(token, 'POST', `/api/conversations/${room}/hooks`, { name })
  assert.equal(r.status, 201)
  return (await r.json()) as { id: string; name: string; url: string }
}

type Listed = {
  id: string
  body: SlackDoc
  author_id: string | null
  author_name: string
  said_as: string | null
  hook_id: string | null
  origin: string
}
async function roomSays(token: string, room: string): Promise<Listed[]> {
  const r = await call(token, 'GET', `/api/conversations/${room}/messages`)
  return ((await r.json()) as { messages: Listed[] }).messages
}

/** Every node type and mark a document holds. */
function kinds(doc: unknown): { nodes: Set<string>; marks: Set<string>; hrefs: string[] } {
  const nodes = new Set<string>()
  const marks = new Set<string>()
  const hrefs: string[] = []
  const walk = (n: unknown) => {
    const x = n as { type?: string; marks?: { type: string; attrs?: { href?: string } }[]; content?: unknown[] }
    if (x.type) nodes.add(x.type)
    for (const m of x.marks ?? []) {
      marks.add(m.type)
      if (m.attrs?.href) hrefs.push(m.attrs.href)
    }
    for (const c of x.content ?? []) walk(c)
  }
  walk(doc)
  return { nodes, marks, hrefs }
}

const ok = (payload: unknown): SlackDoc => {
  const r = fromSlack(payload)
  if ('refused' in r) throw new Error(`refused: ${r.refused}`)
  return r.doc
}
const words = (doc: SlackDoc) => JSON.stringify(doc)

/* --------------------------------------------------------- converter */

test('mrkdwn becomes the product’s own marks and blocks', () => {
  const doc = ok({
    text: '*Deploy* _finished_ ~maybe~ `v1.2`\n> quoted line\n```npm run build\nok```\nsee <https://example.com/run/1|the run> & <https://example.com>',
  })
  const k = kinds(doc)
  assert.deepEqual([...k.marks].sort(), ['bold', 'code', 'italic', 'link', 'strike'])
  assert.ok(k.nodes.has('blockquote'))
  assert.ok(k.nodes.has('codeBlock'))
  assert.deepEqual(k.hrefs, ['https://example.com/run/1', 'https://example.com'])
  assert.ok(words(doc).includes('the run'))
  assert.ok(words(doc).includes('npm run build\\nok'))
})

test('a link that is not http(s) or mail is words, never a link', () => {
  for (const bad of [
    'javascript:alert(1)',
    'data:text/html,<b>x</b>',
    '/relative',
    'vbscript:x',
    'file:///etc/passwd',
    'https://exa mple.com',
  ]) {
    const doc = ok({ text: `<${bad}|press me>` })
    assert.equal(kinds(doc).hrefs.length, 0, bad)
    assert.ok(words(doc).includes('press me'), bad)
  }
  assert.equal(safeHref('JAVASCRIPT:alert(1)'), null)
  assert.equal(safeHref('https://ok.example/path?q=1'), 'https://ok.example/path?q=1')
  assert.equal(safeHref('mailto:ops@example.com'), 'mailto:ops@example.com')
  /* And a button or a picture pointing there is dropped or words. */
  const doc = ok({
    blocks: [
      { type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: 'Run' }, url: 'javascript:alert(1)' }] },
      { type: 'section', text: { type: 'mrkdwn', text: 'still here' } },
    ],
  })
  assert.equal(kinds(doc).hrefs.length, 0)
})

test('somebody named, a channel, @channel: words, never a mention that tells anybody', () => {
  const doc = ok({ text: 'hey <!channel> and <!here>, <@U123ABC> look at <#C999|ops> <!subteam^S1|@oncall>' })
  const k = kinds(doc)
  assert.ok(!k.nodes.has('mention'))
  assert.ok(!k.nodes.has('taskRef'))
  const said = words(doc)
  for (const w of ['@channel', '@here', '@U123ABC', '#ops', '@oncall']) assert.ok(said.includes(w), w)
})

test('Block Kit: sections, fields, a header, context, a divider, buttons as links, a picture as a link', () => {
  const doc = ok({
    text: 'fallback that is not drawn',
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: 'Build #42' } },
      { type: 'section', text: { type: 'mrkdwn', text: '*main* passed' }, fields: [{ type: 'mrkdwn', text: '*Time*\n3m' }] },
      { type: 'divider' },
      {
        type: 'context',
        elements: [
          { type: 'mrkdwn', text: 'by ci' },
          { type: 'image', image_url: 'https://x/y.png', alt_text: 'ci' },
        ],
      },
      {
        type: 'actions',
        elements: [
          { type: 'button', text: { type: 'plain_text', text: 'Open' }, url: 'https://ci.example/42' },
          { type: 'button', text: { type: 'plain_text', text: 'Approve' }, action_id: 'approve' },
        ],
      },
      { type: 'image', image_url: 'https://ci.example/graph.png', alt_text: 'graph' },
      { type: 'video', title: { type: 'plain_text', text: 'x' } },
    ],
  })
  const said = words(doc)
  assert.ok(!said.includes('fallback that is not drawn'))
  assert.ok(said.includes('Build #42'))
  assert.ok(said.includes('Open'))
  assert.ok(!said.includes('Approve'), 'a button with no address does something in Slack, and is left out')
  assert.deepEqual(kinds(doc).hrefs, ['https://ci.example/42', 'https://ci.example/graph.png'])
  assert.ok(!kinds(doc).nodes.has('image'), 'a picture is never drawn from somebody else’s address')
})

test('rich_text, and the old attachments', () => {
  const doc = ok({
    blocks: [
      {
        type: 'rich_text',
        elements: [
          {
            type: 'rich_text_section',
            elements: [
              { type: 'text', text: 'bold', style: { bold: true } },
              { type: 'emoji', name: 'tada', unicode: '1f389' },
            ],
          },
          {
            type: 'rich_text_list',
            style: 'ordered',
            elements: [{ type: 'rich_text_section', elements: [{ type: 'text', text: 'one' }] }],
          },
          { type: 'rich_text_preformatted', elements: [{ type: 'text', text: 'code here' }] },
        ],
      },
    ],
    attachments: [
      {
        pretext: 'Payment',
        title: 'Invoice 7',
        title_link: 'https://pay.example/7',
        text: 'Paid in full',
        fields: [{ title: 'Amount', value: '$40' }],
        footer: 'Stripe',
        color: '#36a64f',
        actions: [{ type: 'button', text: 'View', url: 'https://pay.example/7/view' }],
      },
    ],
  })
  const k = kinds(doc)
  assert.ok(k.nodes.has('orderedList'))
  assert.ok(k.nodes.has('codeBlock'))
  assert.ok(k.nodes.has('blockquote'))
  assert.ok(words(doc).includes('🎉'))
  assert.ok(words(doc).includes('Amount'))
  assert.deepEqual(k.hrefs, ['https://pay.example/7', 'https://pay.example/7/view'])
})

test('only the nodes and marks the product draws, whatever arrives', () => {
  const hostile = {
    text: '<javascript:x|a> *<https://ok.example|b>* ```x``` > y',
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: { nested: 'object' } }, accessory: { type: 'image', image_url: 'https://x/p.png' } },
      {
        type: 'rich_text',
        elements: [
          {
            type: 'rich_text_section',
            elements: [
              { type: 'mention', id: 'x' },
              { type: 'link', url: 'data:x', text: 'd' },
            ],
          },
        ],
      },
      { type: 'file', external_id: 'x' },
      { type: 'input', element: {} },
    ],
    attachments: [{ blocks: [{ type: 'header', text: { type: 'plain_text', text: 'h' } }] }, 'not an object', null],
  }
  const doc = ok(hostile)
  const k = kinds(doc)
  for (const n of k.nodes)
    assert.ok(['doc', 'paragraph', 'text', 'blockquote', 'codeBlock', 'bulletList', 'orderedList', 'listItem'].includes(n), n)
  for (const m of k.marks) assert.ok(['bold', 'italic', 'strike', 'code', 'link'].includes(m), m)
  for (const h of k.hrefs) assert.match(h, /^(https?:|mailto:)/)
})

test('what Slack refuses is refused here, in its words', () => {
  const cases: [unknown, string][] = [
    [null, 'invalid_payload'],
    [[], 'invalid_payload'],
    ['text', 'invalid_payload'],
    [{ text: { a: 1 } }, 'invalid_payload'],
    [{}, 'no_text'],
    [{ text: '   ' }, 'no_text'],
    [{ blocks: [{ type: 'divider' }] }, 'no_text'],
    [{ text: 'x'.repeat(40_001) }, 'msg_too_long'],
    [{ blocks: 'nope' }, 'invalid_blocks'],
    [{ blocks: Array.from({ length: 51 }, () => ({ type: 'divider' })) }, 'invalid_blocks'],
    [{ blocks: [{ notype: true }] }, 'invalid_blocks'],
    [{ text: 'x', attachments: 'nope' }, 'invalid_payload'],
    [{ text: 'x', attachments: Array.from({ length: 101 }, () => ({ text: 'a' })) }, 'too_many_attachments'],
  ]
  for (const [payload, refused] of cases) assert.deepEqual(fromSlack(payload), { refused }, JSON.stringify(payload)?.slice(0, 60))
})

/** Nodes in a document, every one. */
const nodes = (n: unknown): number => {
  const x = n as { content?: unknown[] }
  return 1 + (x.content ?? []).reduce<number>((a, c) => a + nodes(c), 0)
}

/* The worst a webhook can send (`hostile.ts`) stops at two thousand
   nodes. What each costs in time is `bench/parsers.bench.ts`. */
test('the worst a webhook can send stops at two thousand nodes', () => {
  for (const payload of worstSlack) {
    const size = JSON.stringify(payload).length
    assert.ok(size <= 64 * 1024, `${size} bytes is past the body limit`)
    const r = fromSlack(payload)
    if ('doc' in r) assert.ok(nodes(r.doc) <= 2_100, `${nodes(r.doc)} nodes`)
  }
})

test('the converter writes nothing about where a link goes: that is drawn when it is read', () => {
  /* A label written into the words could be typed into them too. */
  const doc = ok({ text: 'log in at <https://evil.example/login|bank.com (bank.com)>' })
  const said = JSON.stringify(doc)
  assert.ok(!said.includes('(evil.example)'))
  assert.deepEqual(kinds(doc).hrefs, ['https://evil.example/login'])
})

/* --------------------------------------------------------------- rights */

test('who may make a room’s webhook is can()’s: the room’s runners, in person, in a channel', async () => {
  const { ctx, workspaceId, token, p, room } = await world()
  const runner = await addPerson(ctx, workspaceId, 'member', [p], ['channel.create'])
  const plain = await addPerson(ctx, workspaceId, 'member', [p], ['task.create'])
  const elsewhere = await addPerson(ctx, workspaceId, 'member', [await makeProject(ctx, workspaceId, 'Other')])
  const stranger = await makeOwner()

  await makeHook(await bearerFor(runner.actorId, workspaceId), room, 'By the runner')
  assert.equal(
    (await call(await bearerFor(plain.actorId, workspaceId), 'POST', `/api/conversations/${room}/hooks`, { name: 'x' })).status,
    403,
  )
  assert.equal((await call(await bearerFor(plain.actorId, workspaceId), 'GET', `/api/conversations/${room}/hooks`)).status, 403)
  assert.equal(
    (await call(await bearerFor(elsewhere.actorId, workspaceId), 'POST', `/api/conversations/${room}/hooks`, { name: 'x' })).status,
    404,
  )
  assert.equal((await call(stranger.token, 'POST', `/api/conversations/${room}/hooks`, { name: 'x' })).status, 404)

  /* Never through a token, the owner's own included. */
  const made = await call(token, 'POST', '/api/tokens', { name: 'agent' })
  const pat = ((await made.json()) as { token: string }).token
  assert.equal((await call(pat, 'POST', `/api/conversations/${room}/hooks`, { name: 'x' })).status, 403)

  /* The room's list says who may. */
  const listed = (await (await call(token, 'GET', '/api/conversations')).json()) as { conversations: { id: string; can: string[] }[] }
  assert.ok(listed.conversations.find((r) => r.id === room)!.can.includes('hooks'))
  const theirs = (await (await call(await bearerFor(plain.actorId, workspaceId), 'GET', '/api/conversations')).json()) as {
    conversations: { id: string; can: string[] }[]
  }
  assert.ok(!theirs.conversations.find((r) => r.id === room)!.can.includes('hooks'))
  assert.equal((await call(pat, 'GET', `/api/conversations/${room}/hooks`)).status, 403)
  void ctx
})

test('a direct conversation takes no webhook', async () => {
  const { ctx, workspaceId, token } = await world()
  const dm = uuidv7()
  await withActor(ctx.actorId, async (tx) => {
    await tx`insert into conversation (id, workspace_id, name) values (${dm}, ${workspaceId}, null)`
    await tx`insert into conversation_member (id, workspace_id, conversation_id, actor_id, joined_at) values (${uuidv7()}, ${workspaceId}, ${dm}, ${ctx.actorId}, now())`
  })
  assert.equal((await call(token, 'POST', `/api/conversations/${dm}/hooks`, { name: 'x' })).status, 403)
})

test('the secret is shown once and never readable again, not even by the database’s app role', async () => {
  const { ctx, token, room } = await world()
  const hook = await makeHook(token, room)
  assert.match(hook.url, /\/hooks\/rooms\/[0-9a-f-]{36}\/[A-Za-z0-9_-]{43}$/)
  const listed = await (await call(token, 'GET', `/api/conversations/${room}/hooks`)).text()
  assert.ok(!listed.includes(hook.url.split('/').pop()!))
  assert.ok(!listed.includes('secret'))
  await assert.rejects(
    withActor(ctx.actorId, (tx) => tx`select secret_hash from room_hook where id = ${hook.id}`),
    /permission denied/,
  )
})

/* -------------------------------------------------------------- posting */

test('a post lands in the room under the hook’s name, as nobody’s own, telling nobody', async () => {
  const { ctx, workspaceId, token, p, room } = await world()
  const lee = await addPerson(ctx, workspaceId, 'member', [p])
  const hook = await makeHook(token, room, 'GitHub Actions')
  const r = await deliver(
    hook.url,
    JSON.stringify({
      text: 'Build *passed* for <@U1> <!channel>',
      username: 'Owner Person',
      icon_url: 'https://evil.example/x.png',
      channel: '#elsewhere',
    }),
  )
  assert.equal(r.status, 200)
  assert.equal(await r.text(), 'ok')
  const [m] = await roomSays(token, room)
  assert.ok(m)
  assert.equal(m.author_name, 'GitHub Actions', 'its own name, never the payload’s username')
  assert.equal(m.said_as, 'GitHub Actions')
  assert.equal(m.author_id, null)
  assert.equal(m.hook_id, hook.id)
  assert.equal(m.origin, 'system')
  assert.ok(!JSON.stringify(m).includes('evil.example'))
  /* Nobody is told: no notification for anybody in the room. */
  const notes = await withActor(lee.actorId, (tx) => tx`select id from notification where actor_id = ${lee.actorId}`)
  assert.equal(notes.length, 0)
  /* And nobody edits it as their own — the maker included. */
  assert.equal((await call(token, 'PATCH', `/api/messages/${m.id}`, { body: { type: 'doc', content: [] } })).status, 403)
})

test('a form with a payload field is taken as Slack takes it', async () => {
  const { token, room } = await world()
  const hook = await makeHook(token, room)
  const form = new URLSearchParams({ payload: JSON.stringify({ text: 'from a form' }) })
  const r = await deliver(hook.url, form.toString(), 'application/x-www-form-urlencoded')
  assert.equal(r.status, 200)
  assert.ok(JSON.stringify((await roomSays(token, room))[0]!.body).includes('from a form'))
  assert.equal((await deliver(hook.url, new URLSearchParams({ text: 'x' }).toString(), 'application/x-www-form-urlencoded')).status, 400)
})

test('malformed bodies are refused, in Slack’s words', async () => {
  const { token, room } = await world()
  const hook = await makeHook(token, room)
  const cases: [string, number, string][] = [
    ['not json', 400, 'invalid_payload'],
    ['[1,2]', 400, 'invalid_payload'],
    ['{"text": 7}', 400, 'invalid_payload'],
    ['{}', 400, 'no_text'],
    [JSON.stringify({ blocks: 'x' }), 400, 'invalid_blocks'],
    [JSON.stringify({ text: 'x'.repeat(40_001) }), 400, 'msg_too_long'],
  ]
  for (const [body, status, said] of cases) {
    const r = await deliver(hook.url, body)
    assert.equal(r.status, status, body.slice(0, 40))
    assert.equal(await r.text(), said, body.slice(0, 40))
  }
  /* Past the size a webhook needs: refused before it is read. */
  assert.equal((await deliver(hook.url, JSON.stringify({ text: 'x'.repeat(300 * 1024) }))).status, 413)
  assert.equal((await deliver(hook.url, JSON.stringify({ blocks: [], text: 'x'.repeat(39_000), pad: 'y'.repeat(30 * 1024) }))).status, 413)
  assert.equal((await roomSays(token, room)).length, 0)
})

test('a wrong secret, an unknown hook and a malformed address are the same answer', async () => {
  const { token, room } = await world()
  const hook = await makeHook(token, room)
  const base = new URL(hook.url)
  const [, , , id] = base.pathname.split('/')
  for (const path of [
    `/hooks/rooms/${id}/${'A'.repeat(43)}`,
    `/hooks/rooms/${uuidv7()}/${hook.url.split('/').pop()}`,
    `/hooks/rooms/not-a-uuid/${'A'.repeat(43)}`,
    `/hooks/rooms/${id}/short`,
  ]) {
    const r = await app.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"text":"x"}' })
    assert.equal(r.status, 404, path)
    assert.equal(await r.text(), 'no_service', path)
  }
  assert.equal((await roomSays(token, room)).length, 0)
})

test('a new URL stops the old one at once; a removed hook takes nothing', async () => {
  const { token, room } = await world()
  const hook = await makeHook(token, room)
  const turned = await call(token, 'POST', `/api/hooks/${hook.id}/turn`)
  assert.equal(turned.status, 200)
  const next = ((await turned.json()) as { url: string }).url
  assert.notEqual(next, hook.url)
  assert.equal((await deliver(hook.url, '{"text":"old"}')).status, 404)
  assert.equal((await deliver(next, '{"text":"new"}')).status, 200)
  assert.equal((await call(token, 'DELETE', `/api/hooks/${hook.id}`)).status, 200)
  assert.equal((await deliver(next, '{"text":"gone"}')).status, 404)
  const listed = (await (await call(token, 'GET', `/api/conversations/${room}/hooks`)).json()) as { hooks: unknown[] }
  assert.equal(listed.hooks.length, 0)
})

test('a hook rides its maker’s rights: losing them stops it, taking them off the project ends it for good', async () => {
  const { ctx, workspaceId, p, room, token } = await world()
  const maker = await addPerson(ctx, workspaceId, 'member', [p], ['channel.create'])
  const hook = await makeHook(await bearerFor(maker.actorId, workspaceId), room)
  assert.equal((await deliver(hook.url, '{"text":"while on it"}')).status, 200)
  const rights = (r: string[]) =>
    withActor(ctx.actorId, (tx) => tx`update project_member set rights = ${r} where project_id = ${p} and actor_id = ${maker.actorId}`)

  /* Still in the room, no longer running it: the hook is not theirs to keep. */
  await rights(['task.create'])
  assert.equal(await (await deliver(hook.url, '{"text":"without the right"}')).text(), 'no_service')
  await rights(['channel.create'])
  assert.equal((await deliver(hook.url, '{"text":"with it again"}')).status, 200)

  /* Taken off the project: gone, and putting them back does not bring it back. */
  await withActor(
    ctx.actorId,
    (tx) => tx`update project_member set deleted_at = now() where project_id = ${p} and actor_id = ${maker.actorId}`,
  )
  assert.equal(await (await deliver(hook.url, '{"text":"after"}')).text(), 'no_service')
  await withActor(
    ctx.actorId,
    (tx) => tx`update project_member set deleted_at = null where project_id = ${p} and actor_id = ${maker.actorId}`,
  )
  assert.equal(await (await deliver(hook.url, '{"text":"back"}')).text(), 'no_service')
  const listed = (await (await call(token, 'GET', `/api/conversations/${room}/hooks`)).json()) as { hooks: unknown[] }
  assert.equal(listed.hooks.length, 0)
  assert.equal((await roomSays(token, room)).length, 2)
})

test('whoever gives a hook a new URL answers for it from then on, and it goes when they go', async () => {
  const { ctx, workspaceId, p, room, token } = await world()
  const maker = await addPerson(ctx, workspaceId, 'member', [p], ['channel.create'])
  const turner = await addPerson(ctx, workspaceId, 'member', [p], ['channel.create'])
  const hook = await makeHook(await bearerFor(maker.actorId, workspaceId), room)
  const turned = await call(await bearerFor(turner.actorId, workspaceId), 'POST', `/api/hooks/${hook.id}/turn`)
  const url = ((await turned.json()) as { url: string }).url
  const listed = (await (await call(token, 'GET', `/api/conversations/${room}/hooks`)).json()) as {
    hooks: { created_by: string; turned_at: string | null }[]
  }
  assert.equal(listed.hooks[0]!.created_by, turner.actorId)
  assert.ok(listed.hooks[0]!.turned_at)

  /* The first maker leaving changes nothing now. */
  await withActor(
    ctx.actorId,
    (tx) => tx`update membership set deleted_at = now() where workspace_id = ${workspaceId} and actor_id = ${maker.actorId}`,
  )
  assert.equal((await deliver(url, '{"text":"still"}')).status, 200)
  /* The one who turned it leaving ends it. */
  await withActor(
    ctx.actorId,
    (tx) => tx`update membership set deleted_at = now() where workspace_id = ${workspaceId} and actor_id = ${turner.actorId}`,
  )
  assert.equal(await (await deliver(url, '{"text":"gone"}')).text(), 'no_service')
  /* And coming back does not revive it. */
  await withActor(
    ctx.actorId,
    (tx) => tx`update membership set deleted_at = null where workspace_id = ${workspaceId} and actor_id = ${turner.actorId}`,
  )
  assert.equal(await (await deliver(url, '{"text":"back"}')).text(), 'no_service')
})

test('a webhook’s message is deleted by whoever manages the room’s webhooks, outside every project too', async () => {
  const { ctx, workspaceId, token } = await world()
  const member = await addPerson(ctx, workspaceId, 'member', [])
  const bystander = await addPerson(ctx, workspaceId, 'member', [])
  await withActor(
    ctx.actorId,
    (tx) => tx`update membership set may_create_channels = false where workspace_id = ${workspaceId} and actor_id = ${bystander.actorId}`,
  )
  const room = uuidv7()
  await withActor(ctx.actorId, async (tx) => {
    await tx`insert into conversation (id, workspace_id, name, channel) values (${room}, ${workspaceId}, 'ops', true)`
    for (const who of [ctx.actorId, member.actorId, bystander.actorId]) {
      await tx`insert into conversation_member (id, workspace_id, conversation_id, actor_id, joined_at) values (${uuidv7()}, ${workspaceId}, ${room}, ${who}, now())`
    }
  })
  const hook = await makeHook(token, room)
  await deliver(hook.url, '{"text":"one"}')
  await deliver(hook.url, '{"text":"two"}')
  const [a, b] = (await roomSays(token, room)).map((m) => m.id)
  const bystanderToken = await bearerFor(bystander.actorId, workspaceId)
  assert.equal((await call(bystanderToken, 'DELETE', `/api/messages/${a}`)).status, 403)
  assert.equal((await call(await bearerFor(member.actorId, workspaceId), 'DELETE', `/api/messages/${a}`)).status, 200)
  assert.equal((await call(token, 'DELETE', `/api/messages/${b}`)).status, 200)
  assert.equal((await roomSays(token, room)).length, 0)
})

test('taken out of a channel, a person’s hooks there go, and coming back does not bring them', async () => {
  const { ctx, workspaceId, token } = await world()
  const maker = await addPerson(ctx, workspaceId, 'member', [])
  const room = uuidv7()
  await withActor(ctx.actorId, async (tx) => {
    await tx`insert into conversation (id, workspace_id, name, channel, created_by) values (${room}, ${workspaceId}, 'ops', true, ${ctx.actorId})`
    for (const who of [ctx.actorId, maker.actorId]) {
      await tx`insert into conversation_member (id, workspace_id, conversation_id, actor_id, joined_at) values (${uuidv7()}, ${workspaceId}, ${room}, ${who}, now())`
    }
  })
  const hook = await makeHook(await bearerFor(maker.actorId, workspaceId), room)
  assert.equal((await deliver(hook.url, '{"text":"in"}')).status, 200)
  assert.equal((await call(token, 'PUT', `/api/conversations/${room}/members`, { member_ids: [ctx.actorId] })).status, 200)
  assert.equal(await (await deliver(hook.url, '{"text":"out"}')).text(), 'no_service')
  assert.equal((await call(token, 'PUT', `/api/conversations/${room}/members`, { member_ids: [ctx.actorId, maker.actorId] })).status, 200)
  assert.equal(await (await deliver(hook.url, '{"text":"back"}')).text(), 'no_service')
})

test('a hook whose maker’s address is no longer proved posts nothing, the owner’s included', async () => {
  const { ctx, token, room } = await world()
  const hook = await makeHook(token, room)
  assert.equal((await deliver(hook.url, '{"text":"proved"}')).status, 200)
  await owner`update app_user set email_verified_at = null where actor_id = ${ctx.actorId}`
  assert.equal(await (await deliver(hook.url, '{"text":"unproved"}')).text(), 'no_service')
  await owner`update app_user set email_verified_at = now() where actor_id = ${ctx.actorId}`
  assert.equal((await deliver(hook.url, '{"text":"proved again"}')).status, 200)
})

test('twenty a room, even asked for all at once', async () => {
  const { token, room } = await world()
  const all = await Promise.all(
    Array.from({ length: 26 }, (_, i) => call(token, 'POST', `/api/conversations/${room}/hooks`, { name: `h${i}` })),
  )
  assert.equal(all.filter((r) => r.status === 201).length, 20)
  assert.equal(all.filter((r) => r.status === 409).length, 6)
})

test('last used is when it last took a post, not when it was last asked', async () => {
  const { ctx, token, room } = await world()
  const hook = await makeHook(token, room)
  const used = async () =>
    (
      await inWorkspace(
        ctx.actorId,
        ctx.workspaceId,
        (tx) => tx<{ at: string | null }[]>`select last_used_at as at from room_hook where id = ${hook.id}`,
      )
    )[0]!.at
  await deliver(hook.url, '{}')
  await deliver(hook.url, '{"blocks":[{"type":"divider"}]}')
  assert.equal(await used(), null)
  await deliver(hook.url, '{"text":"taken"}')
  assert.ok(await used())
})

test('sixty a minute a hook, then Slack’s 429', async () => {
  const { token, room } = await world()
  const hook = await makeHook(token, room)
  /* The count is a window on the clock's minute (`rate_spend`): sixty-one
     posts that straddle its turn are two windows, and the last was let in
     about one run in ten. Begun with fifteen seconds of the minute left at
     least — the posts take three to nine. */
  const left = 60_000 - (Date.now() % 60_000)
  if (left < 15_000) await new Promise((r) => setTimeout(r, left + 100))
  for (let i = 0; i < HOOK_PER_MINUTE; i++) assert.equal((await deliver(hook.url, `{"text":"n${i}"}`)).status, 200, `post ${i}`)
  const r = await deliver(hook.url, '{"text":"one too many"}')
  assert.equal(r.status, 429)
  assert.equal(await r.text(), 'rate_limited')
  assert.ok(r.headers.get('retry-after'))
})
