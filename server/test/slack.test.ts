import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import postgres from 'postgres'

/* The app's own, before anything reads the environment. */
process.env.SLACK_CLIENT_ID = '111.222'
process.env.SLACK_CLIENT_SECRET = 'slack-secret'
process.env.SLACK_SIGNING_SECRET = 'sign-secret'
/* And where it is: a server of one's own without `APP_URL` has no address
   to send Slack back to or link from (`publicUrl.ts`), so the test names one
   — the service would fall back to its own, and the answers are the same. */
process.env.APP_URL ??= 'https://tuff.example.org'

const { app } = await import('../src/http/routes.js')
const { slackOut, slackUnfurl } = await import('../src/slackWork.js')
const { env } = await import('../src/env.js')
const { createHmac } = await import('node:crypto')
const { escape, excerpt, messageOf } = await import('../src/slack.js')
const { addManager, addPerson, bearerFor, closeDb, makeOwner, makeProject, withActor, uuidv7 } = await import('./helpers.js')

/* As the database's owner, to look at rows nobody in the product may read. */
const db = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} })

after(async () => {
  await closeDb()
  await db.end()
})

/*
 * A fake Slack: what is asked of slack.com is answered here and written
 * down. Each test's workspace is its own Slack team, by the code it trades.
 */
type Sent = { method: string; params: Record<string, string>; token: string | null }
const sent: Sent[] = []
/* Per token: the channels Slack lists, and whether it has been revoked. */
const teams = new Map<string, { channels: { id: string; name: string; is_private: boolean }[]; dead?: string }>()
/* Channels Slack says are archived. */
const archived = new Set<string>()
const real = globalThis.fetch
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (!url.startsWith('https://slack.com/api/')) return real(input, init)
  const method = url.slice('https://slack.com/api/'.length)
  const params = Object.fromEntries(new URLSearchParams(String(init?.body ?? '')))
  const token = new Headers(init?.headers).get('authorization')?.replace(/^Bearer /, '') ?? null
  sent.push({ method, params, token })
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } })
  if (method === 'oauth.v2.access') {
    if (params.client_secret !== 'slack-secret' || !params.code?.startsWith('code-')) return json({ ok: false, error: 'invalid_code' })
    const wide = params.code.endsWith('-wide')
    const team = params.code.slice('code-'.length).replace(/-wide$/, '')
    const t = `xoxb-${team}`
    if (!teams.has(t)) {
      teams.set(t, {
        channels: [
          { id: `C${team}A`, name: 'eng', is_private: false },
          { id: `G${team}B`, name: 'leadership', is_private: true },
        ],
      })
    }
    return json({
      ok: true,
      token_type: 'bot',
      access_token: t,
      bot_user_id: `UBOT${team}`,
      scope: `chat:write,chat:write.public,channels:read,groups:read,links:read,links:write${wide ? ',users:read' : ''}`,
      team: { id: `T${team}`, name: `Team ${team}` },
    })
  }
  const team = token ? teams.get(token) : undefined
  if (!team) return json({ ok: false, error: 'not_authed' })
  if (team.dead) return json({ ok: false, error: team.dead })
  if (method === 'conversations.list') return json({ ok: true, channels: team.channels, response_metadata: { next_cursor: '' } })
  if (method === 'chat.postMessage')
    return json(archived.has(params.channel!) ? { ok: false, error: 'is_archived' } : { ok: true, ts: '1.2' })
  if (method === 'chat.unfurl') return json({ ok: true })
  if (method === 'auth.revoke') {
    team.dead = 'token_revoked'
    return json({ ok: true, revoked: true })
  }
  return json({ ok: false, error: 'unknown_method' })
}) as typeof fetch

const call = (path: string, token: string, method = 'GET', body?: unknown) =>
  app.request(path, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

/** A short team name, upper case as Slack's ids are. */
const team = () => uuidv7().replace(/-/g, '').slice(-10).toUpperCase()

/** The owner through Slack's screen and back, as the browser does it. */
async function connect(token: string, code: string): Promise<Response> {
  const start = (await (await call('/api/slack/start', token, 'POST')).json()) as { url: string }
  const state = new URL(start.url).searchParams.get('state')!
  return call('/api/slack', token, 'POST', { code, state })
}

/* ------------------------------------------------------------- the text */

test('somebody’s words cannot ping a channel or draw a link as ours', () => {
  const m = messageOf({
    kind: 'commented',
    actor_name: '<!channel> Eve',
    project_key: 'ENG',
    project_slug: 'web',
    workspace_slug: 'acme',
    number: 41,
    title: 'Sign-in <https://evil.example|ENG-1> & co',
    list_name: null,
    list_icon: null,
    said: 'See <!here> and <@U123>',
  })
  assert.ok(!m.includes('<!'), 'no mention survives')
  assert.ok(!m.includes('<https://evil'), 'no link of theirs')
  assert.equal((m.match(/</g) ?? []).length, 1, 'the one link is ours')
  assert.match(
    m,
    /^\*&lt;!channel&gt; Eve\* commented on <https?:\/\/[^|]+\/acme\/web\/tasks\/41\|ENG-41 Sign-in &lt;https:\/\/evil\.example\|ENG-1&gt; &amp; co>/,
  )
  assert.match(m, /\n>See &lt;!here&gt; and &lt;@U123&gt;$/)
  assert.equal(escape('&lt;'), '&amp;lt;', 'an escape is not undone')
  assert.equal(excerpt('word '.repeat(100)).length <= 301, true)
  assert.ok(excerpt('word '.repeat(100)).endsWith('…'))
})

/* ---------------------------------------------------------- connecting */

test('Slack is connected by the owner who started it, and by nobody else', async () => {
  const owner = await makeOwner()
  const other = await makeOwner()
  const t = team()

  // The way back: a state that is not ours goes home, and ours goes into the app.
  assert.equal((await app.request('/auth/slack/callback?code=x&state=nope')).headers.get('location'), '/')
  const start = (await (await call('/api/slack/start', owner.token, 'POST')).json()) as { url: string }
  const u = new URL(start.url)
  assert.equal(u.origin + u.pathname, 'https://slack.com/oauth/v2/authorize')
  assert.equal(u.searchParams.get('scope'), 'chat:write,chat:write.public,channels:read,groups:read,links:read,links:write')
  const state = u.searchParams.get('state')!
  const back = await app.request(`/auth/slack/callback?code=code-${t}&state=${encodeURIComponent(state)}`)
  assert.match(back.headers.get('location') ?? '', /^\/ws-[^/]+\/settings\?slack=connected&code=code-/)

  // Another owner holding this state cannot finish it in their workspace.
  assert.equal((await call('/api/slack', other.token, 'POST', { code: `code-${t}`, state })).status, 400)
  // A state with its signature changed is nobody's.
  assert.equal((await call('/api/slack', owner.token, 'POST', { code: `code-${t}`, state: `${state}x` })).status, 400)
  // Nor is somebody who is not the owner.
  const member = await addPerson(owner.ctx, owner.workspaceId, 'member')
  assert.equal((await call('/api/slack/start', await bearerFor(member.actorId, owner.workspaceId), 'POST')).status, 403)

  assert.equal((await call('/api/slack', owner.token, 'POST', { code: `code-${t}`, state })).status, 201)
  const hello = (await (await call('/api/slack', owner.token)).json()) as { connection: { team_name: string; broken: boolean } }
  assert.deepEqual(hello.connection, { team_name: `Team ${t}`, broken: false, previews: true })
  // The token is never answered.
  assert.ok(!JSON.stringify(hello).includes('xoxb'))

  // A state is spent by its first return: the same address again finishes nothing.
  assert.equal((await call('/api/slack', owner.token, 'POST', { code: `code-${t}`, state })).status, 400)

  // The same Slack for a second workspace: refused — and the token, which
  // is the first workspace's too, left alone.
  sent.length = 0
  const again = await connect(other.token, `code-${t}`)
  assert.equal(again.status, 409)
  assert.ok(!sent.some((x) => x.method === 'auth.revoke'), 'not revoked for the one that has it')
  assert.equal(teams.get(`xoxb-${t}`)!.dead, undefined)

  // A token with more than the scopes asked is not taken.
  const wider = await makeOwner()
  assert.equal((await connect(wider.token, `code-${team()}-wide`)).status, 400)
})

test('a tool cannot connect Slack or choose a channel', async () => {
  const owner = await makeOwner()
  const project = await makeProject(owner.ctx, owner.workspaceId, 'Tooled')
  const made = (await (await call('/api/tokens', owner.token, 'POST', { name: 'agent' })).json()) as { token: string }
  assert.equal((await call('/api/slack/start', made.token, 'POST')).status, 403)
  assert.equal((await call('/api/slack/channels', made.token)).status, 403)
  assert.equal((await call(`/api/projects/${project}/slack`, made.token, 'PUT', { channel_id: 'CABC' })).status, 403)
  assert.equal((await call('/api/slack', made.token, 'DELETE')).status, 403)
})

/* ------------------------------------------------------ choosing a channel */

test('a channel is one Slack lists for this workspace, and private ones are the owner’s', async () => {
  const owner = await makeOwner()
  const project = await makeProject(owner.ctx, owner.workspaceId, 'Channels')
  const t = team()
  assert.equal((await connect(owner.token, `code-${t}`)).status, 201)
  const admin = await addManager(owner.ctx, owner.workspaceId, [project])
  const adminToken = await bearerFor(admin.actorId, owner.workspaceId)

  const listed = (await (await call('/api/slack/channels', owner.token)).json()) as { channels: { id: string; private: boolean }[] }
  assert.deepEqual(listed.channels.map((c) => c.id).sort(), [`C${t}A`, `G${t}B`].sort())
  const theirs = (await (await call('/api/slack/channels', adminToken)).json()) as { channels: { id: string }[] }
  assert.deepEqual(
    theirs.channels.map((c) => c.id),
    [`C${t}A`],
    'a private channel’s name is the owner’s',
  )

  // Another Slack's channel, by its id: not in this token's list.
  assert.equal((await call(`/api/projects/${project}/slack`, owner.token, 'PUT', { channel_id: 'CSOMEONEELSE' })).status, 400)
  // A private channel by the project's admin: refused.
  assert.equal((await call(`/api/projects/${project}/slack`, adminToken, 'PUT', { channel_id: `G${t}B` })).status, 400)
  // Somebody on the project who may not change its tools: refused.
  const plain = await addPerson(owner.ctx, owner.workspaceId, 'member', [project])
  assert.equal(
    (await call(`/api/projects/${project}/slack`, await bearerFor(plain.actorId, owner.workspaceId), 'PUT', { channel_id: `C${t}A` }))
      .status,
    403,
  )

  const put = await call(`/api/projects/${project}/slack`, adminToken, 'PUT', { channel_id: `C${t}A` })
  assert.equal(put.status, 200)
  const link = (await (await call(`/api/projects/${project}/slack`, owner.token)).json()) as { link: { channel_name: string } }
  assert.equal(link.link.channel_name, 'eng')

  // The owner chooses a private one: its name is not the admin's to read, here or in the feed.
  assert.equal((await call(`/api/projects/${project}/slack`, owner.token, 'PUT', { channel_id: `G${t}B` })).status, 200)
  const seen = (await (await call(`/api/projects/${project}/slack`, adminToken)).json()) as {
    link: { channel_name: string; private: boolean }
  }
  assert.deepEqual([seen.link.channel_name, seen.link.private], ['', true])
  const [fed] = await db<{ meta: Record<string, unknown> }[]>`
    select meta from activity_event where project_id = ${project} and action = 'project.slack' order by id desc limit 1`
  assert.deepEqual(fed!.meta, {})
  assert.equal((await call('/api/projects/not-a-project/slack', owner.token)).status, 404)
})

/* ----------------------------------------------------------- what is posted */

test('four things reach the channel, in order, and nothing else does', async () => {
  const owner = await makeOwner()
  const project = await makeProject(owner.ctx, owner.workspaceId, 'Posted')
  const t = team()
  assert.equal((await connect(owner.token, `code-${t}`)).status, 201)
  assert.equal((await call(`/api/projects/${project}/slack`, owner.token, 'PUT', { channel_id: `C${t}A` })).status, 200)
  const [open, done] = [uuidv7(), uuidv7()]
  await withActor(owner.ctx.actorId, async (tx) => {
    await tx`insert into task_list (id, workspace_id, project_id, author_id, name, icon, sort_key, finishes)
             values (${open}, ${owner.workspaceId}, ${project}, ${owner.ctx.actorId}, 'Todo', 'open', 'a0', false),
                    (${done}, ${owner.workspaceId}, ${project}, ${owner.ctx.actorId}, 'Done', 'done', 'a1', true)`
  })

  const made = (await (
    await call(`/api/projects/${project}/tasks`, owner.token, 'POST', { title: '<!channel> Sign-in on iPad', list_id: open })
  ).json()) as { id: string }
  // A part of a task is not news.
  assert.equal((await call(`/api/tasks/${made.id}/steps`, owner.token, 'POST', { title: 'A step' })).status, 201)
  // Nor a rename.
  assert.equal((await call(`/api/tasks/${made.id}`, owner.token, 'PATCH', { title: '<!channel> Sign-in on iPads' })).status, 200)
  assert.equal(
    (
      await call(`/api/tasks/${made.id}/comments`, owner.token, 'POST', {
        body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Works on 17, not 18.' }] }] },
      })
    ).status,
    201,
  )
  assert.equal((await call(`/api/tasks/${made.id}`, owner.token, 'PATCH', { list_id: done })).status, 200)
  assert.equal(
    (
      await call(`/api/projects/${project}/posts`, owner.token, 'POST', {
        title: 'Launch moves to Friday',
        publish: true,
        body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Because of the review.' }] }] },
      })
    ).status,
    201,
  )
  // A draft is not an announcement.
  assert.equal(
    (
      await call(`/api/projects/${project}/posts`, owner.token, 'POST', {
        title: 'Draft',
        publish: false,
        body: { type: 'doc', content: [] },
      })
    ).status,
    201,
  )

  sent.length = 0
  // One a channel a pass: as many passes as there are messages, and one more that finds nothing.
  for (let i = 0; i < 6; i++) await slackOut(20)
  const posts = sent.filter((s) => s.method === 'chat.postMessage' && s.params.channel === `C${t}A`)
  assert.equal(posts.length, 4)
  assert.ok(posts.every((p) => p.token === `xoxb-${t}` && p.params.unfurl_links === 'false' && p.params.parse === 'none'))
  const texts = posts.map((p) => p.params.text!)
  assert.match(
    texts[0]!,
    /created <[^|]+\/tasks\/\d+\|[A-Z]+\d*-\d+ &lt;!channel&gt; Sign-in on iPads> in _Todo_$/,
    'its title now, and the list it went into',
  )
  assert.match(texts[1]!, /commented on .*\n>Works on 17, not 18\.$/)
  assert.match(texts[2]!, /finished <[^|]+\/tasks\/\d+\|/)
  assert.match(texts[3]!, /announced <[^|]+\/posts\/\d+\|Launch moves to Friday>\n>Because of the review\.$/)
  assert.ok(texts.every((x) => !x.includes('<!')))
})

test('a revoked token stops the posting and says so, and disconnecting revokes it', async () => {
  const owner = await makeOwner()
  const project = await makeProject(owner.ctx, owner.workspaceId, 'Revoked')
  const t = team()
  assert.equal((await connect(owner.token, `code-${t}`)).status, 201)
  assert.equal((await call(`/api/projects/${project}/slack`, owner.token, 'PUT', { channel_id: `C${t}A` })).status, 200)

  teams.get(`xoxb-${t}`)!.dead = 'token_revoked'
  await call(`/api/projects/${project}/tasks`, owner.token, 'POST', { title: 'First' })
  await call(`/api/projects/${project}/tasks`, owner.token, 'POST', { title: 'Second' })
  sent.length = 0
  for (let i = 0; i < 3; i++) await slackOut(20)
  const tried = sent.filter((s) => s.method === 'chat.postMessage' && s.token === `xoxb-${t}`)
  assert.equal(tried.length, 1, 'tried once, then stopped')
  const hello = (await (await call('/api/slack', owner.token)).json()) as { connection: { broken: boolean } }
  assert.equal(hello.connection.broken, true)
  // Nothing more is queued while it is broken.
  const before = await db<{ n: number }[]>`select count(*)::int as n from slack_out where project_id = ${project}`
  await call(`/api/projects/${project}/tasks`, owner.token, 'POST', { title: 'Third' })
  const now = await db<{ n: number }[]>`select count(*)::int as n from slack_out where project_id = ${project}`
  assert.equal(now[0]!.n, before[0]!.n)

  // Connected again to the same Slack: the channel is kept, and what waited is sent.
  delete teams.get(`xoxb-${t}`)!.dead
  assert.equal((await connect(owner.token, `code-${t}`)).status, 201)
  sent.length = 0
  for (let i = 0; i < 3; i++) await slackOut(20)
  assert.equal(sent.filter((s) => s.method === 'chat.postMessage' && s.params.channel === `C${t}A`).length, 2)

  // Disconnected: revoked at Slack, the channel gone, and the token gone from the row.
  sent.length = 0
  assert.equal((await call('/api/slack', owner.token, 'DELETE')).status, 204)
  assert.ok(sent.some((s) => s.method === 'auth.revoke' && s.token === `xoxb-${t}`))
  assert.equal(((await (await call(`/api/projects/${project}/slack`, owner.token)).json()) as { link: unknown }).link, null)
  const rows = await db<
    { empty: boolean }[]
  >`select token_enc = '' as empty from slack_connection where workspace_id = ${owner.workspaceId}`
  assert.ok(rows.length > 0 && rows.every((r) => r.empty))
})

test('a channel archived stops its project, and a restored task is not news again', async () => {
  const owner = await makeOwner()
  const project = await makeProject(owner.ctx, owner.workspaceId, 'Archived')
  const t = team()
  assert.equal((await connect(owner.token, `code-${t}`)).status, 201)
  assert.equal((await call(`/api/projects/${project}/slack`, owner.token, 'PUT', { channel_id: `C${t}A` })).status, 200)
  const made = (await (await call(`/api/projects/${project}/tasks`, owner.token, 'POST', { title: 'Once' })).json()) as { id: string }
  assert.equal((await call(`/api/tasks/${made.id}`, owner.token, 'DELETE')).status, 200)
  assert.equal((await call(`/api/tasks/${made.id}/restore`, owner.token, 'POST')).status, 200)
  const [n] = await db<{ n: number }[]>`select count(*)::int as n from slack_out where project_id = ${project}`
  assert.equal(n!.n, 1, 'made once, restored without a second message')

  archived.add(`C${t}A`)
  sent.length = 0
  for (let i = 0; i < 2; i++) await slackOut(20)
  const link = (await (await call(`/api/projects/${project}/slack`, owner.token)).json()) as { link: { stopped: string } }
  assert.equal(link.link.stopped, 'is_archived')
  // Stopped, nothing more is queued for it.
  await call(`/api/projects/${project}/tasks`, owner.token, 'POST', { title: 'After' })
  const [m] = await db<{ n: number }[]>`select count(*)::int as n from slack_out where project_id = ${project}`
  assert.equal(m!.n, 1)
})

test('the application role cannot read a Slack token', async () => {
  const owner = await makeOwner()
  await assert.rejects(
    withActor(owner.ctx.actorId, (tx) => tx`select token_enc from slack_connection`),
    /permission denied/,
  )
  await assert.rejects(
    withActor(owner.ctx.actorId, (tx) => tx`select * from slack_out_claim(1)`),
    /permission denied/,
  )
})

test('what an import brings is not news', async () => {
  const { issueAccessToken } = await import('../src/auth/tokens.js')
  const owner = await makeOwner()
  const project = await makeProject(owner.ctx, owner.workspaceId, 'Imported')
  const t = team()
  assert.equal((await connect(owner.token, `code-${t}`)).status, 201)
  assert.equal((await call(`/api/projects/${project}/slack`, owner.token, 'PUT', { channel_id: `C${t}A` })).status, 200)
  const imp = uuidv7()
  await db`insert into linear_import (id, workspace_id, actor_id, key_enc, teams, source)
           values (${imp}, ${owner.workspaceId}, ${owner.ctx.actorId}, null, '[]', 'jira')`
  /* With no key, so no worker of another test takes it up. */
  const as = await issueAccessToken({ sub: owner.ctx.actorId, workspace_id: owner.workspaceId, via: 'import', imp })
  const r = await call(`/api/projects/${project}/tasks`, as, 'POST', { title: 'From Jira' })
  assert.equal(r.status, 201)
  const [n] = await db<{ n: number }[]>`select count(*)::int as n from slack_out where project_id = ${project}`
  assert.equal(n!.n, 0)
  await db`update linear_import set state = 'failed', key_enc = null where id = ${imp}`
})

/* ------------------------------------------------------------- previews */

/** A request as Slack signs it, with the app's signing secret. */
function fromSlack(body: unknown, opts: { secret?: string; at?: number; retry?: boolean } = {}) {
  const raw = JSON.stringify(body)
  const ts = String(Math.floor((opts.at ?? Date.now()) / 1000))
  const sig = `v0=${createHmac('sha256', opts.secret ?? 'sign-secret')
    .update(`v0:${ts}:${raw}`)
    .digest('hex')}`
  return app.request('/hooks/slack', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-slack-request-timestamp': ts,
      'x-slack-signature': sig,
      ...(opts.retry ? { 'x-slack-retry-num': '1' } : {}),
    },
    body: raw,
  })
}

let msg = 1000
/** Somebody pasted these addresses in a channel of that Slack. */
const pasted = (t: string, channel: string, urls: string[], extra: Record<string, unknown> = {}) => ({
  type: 'event_callback',
  team_id: `T${t}`,
  authorizations: [{ team_id: `T${t}` }],
  event: {
    type: 'link_shared',
    channel,
    user: 'UPERSON',
    message_ts: `${++msg}.000100`,
    source: 'conversations_history',
    links: urls.map((url) => ({ url, domain: new URL(env.appUrl).host })),
    ...extra,
  },
})

const queued = async (channel: string) =>
  (await db<{ n: number }[]>`select count(*)::int as n from slack_unfurl where channel_id = ${channel}`)[0]!.n

test('only Slack can call the events door', async () => {
  const body = { type: 'url_verification', challenge: 'abc' }
  assert.equal((await app.request('/hooks/slack', { method: 'POST', body: JSON.stringify(body) })).status, 403)
  assert.equal((await fromSlack(body, { secret: 'another-app' })).status, 403)
  assert.equal((await fromSlack(body, { at: Date.now() - 10 * 60_000 })).status, 403, 'a request caught ten minutes ago')
  const ok = await fromSlack(body)
  assert.equal(ok.status, 200)
  assert.deepEqual(await ok.json(), { challenge: 'abc' })
})

test('a link pasted in its project’s channel is previewed, and nothing else is', async () => {
  const owner = await makeOwner()
  const project = await makeProject(owner.ctx, owner.workspaceId, 'Previewed')
  const elsewhere = await makeProject(owner.ctx, owner.workspaceId, 'Elsewhere')
  const t = team()
  assert.equal((await connect(owner.token, `code-${t}`)).status, 201)
  assert.equal((await call(`/api/projects/${project}/slack`, owner.token, 'PUT', { channel_id: `C${t}A` })).status, 200)
  const [here] = await db<{ ws: string; p: string; e: string; key: string }[]>`
    select w.slug::text as ws, p.slug::text as p, e.slug::text as e, p.key from project p
    join workspace w on w.id = p.workspace_id join project e on e.id = ${elsewhere} where p.id = ${project}`
  const base = `${env.appUrl}/${here!.ws}`

  const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
  const task = (await (
    await call(`/api/projects/${project}/tasks`, owner.token, 'POST', {
      title: '<!channel> Sign-in on iPad',
      body: doc('The keyboard covers <@U1> the button.'),
    })
  ).json()) as { id: string }
  const other = (await (await call(`/api/projects/${elsewhere}/tasks`, owner.token, 'POST', { title: 'Not this channel’s' })).json()) as {
    id: string
  }
  const step = (await (await call(`/api/tasks/${task.id}/steps`, owner.token, 'POST', { title: 'A step' })).json()) as { id: string }
  const post = (await (
    await call(`/api/projects/${project}/posts`, owner.token, 'POST', { title: 'Launch moves', publish: true, body: doc('Friday.') })
  ).json()) as { id: string }
  const draft = (await (
    await call(`/api/projects/${project}/posts`, owner.token, 'POST', { title: 'Draft', publish: false, body: doc('Secret.') })
  ).json()) as { id: string }
  const file = (await (
    await call(`/api/projects/${project}/files`, owner.token, 'POST', { name: 'Spec', body: doc('What we build.') })
  ).json()) as { id: string }
  const n = async (table: 'task' | 'post' | 'file', id: string) =>
    (await db<{ number: number }[]>`select number from ${db(table)} where id = ${id}`)[0]!.number

  const want = {
    task: `${base}/${here!.p}/tasks/${await n('task', task.id)}`,
    post: `${base}/${here!.p}/posts/${await n('post', post.id)}`,
    file: `${base}/${here!.p}/files/${await n('file', file.id)}`,
    project: `${base}/${here!.p}/activity`,
  }
  const not = [
    `${base}/${here!.p}/posts/${await n('post', draft.id)}`,
    `${base}/${here!.e}/tasks/${await n('task', other.id)}`,
    `${base}/${here!.p}/tasks/${await n('task', step.id)}`,
    `https://elsewhere.example/${here!.ws}/${here!.p}/tasks/1`,
  ]
  // Five addresses a message at most: these go in two messages.
  sent.length = 0
  assert.equal((await fromSlack(pasted(t, `C${t}A`, Object.values(want)))).status, 200)
  assert.equal((await fromSlack(pasted(t, `C${t}A`, not))).status, 200)
  for (let i = 0; i < 2; i++) await slackUnfurl(20)
  const answers = sent.filter((s) => s.method === 'chat.unfurl')
  assert.equal(answers.length, 1, 'the message with nothing to preview is not answered')
  const a = answers[0]!
  assert.equal(a.token, `xoxb-${t}`)
  assert.equal(a.params.channel, `C${t}A`)
  const unfurls = JSON.parse(a.params.unfurls!) as Record<string, { blocks: { text?: { text: string }; elements?: { text: string }[] }[] }>
  assert.deepEqual(Object.keys(unfurls).sort(), Object.values(want).sort())
  const text = (u: string) => unfurls[u]!.blocks[0]!.text!.text
  assert.match(text(want.task), new RegExp(`^\\*<${want.task}\\|${here!.key}-\\d+ &lt;!channel&gt; Sign-in on iPad>\\*`))
  assert.match(text(want.task), /The keyboard covers &lt;@U1&gt; the button\.$/)
  assert.match(text(want.post), /Launch moves>\*\n.+\nFriday\.$/)
  assert.match(text(want.file), /Spec>\*\nDoc · .+\nWhat we build\.$/)
  assert.ok(Object.values(unfurls).every((u) => !JSON.stringify(u).includes('<!') && !JSON.stringify(u).includes('<@')))
  assert.equal(unfurls[want.project]!.blocks[1]!.elements![0]!.text, 'Tuff · Previewed')

  // A channel no project posts to, a retry of a message kept, a message
  // Tuff posted and one still being written: none of them is kept again.
  const once = pasted(t, `C${t}A`, [want.task])
  await fromSlack(once)
  const before = await queued(`C${t}A`)
  await fromSlack(once, { retry: true })
  await fromSlack(pasted(t, `C${t}Z`, [want.task]))
  await fromSlack(pasted(t, `C${t}A`, [want.task], { user: `UBOT${t}` }))
  await fromSlack(pasted(t, `C${t}A`, [want.task], { source: 'composer' }))
  assert.equal(await queued(`C${t}Z`), 0)
  assert.equal(await queued(`C${t}A`), before)

  // Edited to add an address, the same message is answered again.
  await slackUnfurl(20)
  sent.length = 0
  await fromSlack({ ...once, event: { ...once.event, links: [{ url: want.task }, { url: want.post }] } })
  await slackUnfurl(20)
  assert.deepEqual(
    Object.keys(JSON.parse(sent.find((x) => x.method === 'chat.unfurl')!.params.unfurls!)).sort(),
    [want.task, want.post].sort(),
  )

  // A link in Docs shows its host, not its address, which may be the access itself.
  const shared = (await (
    await call(`/api/projects/${project}/files`, owner.token, 'POST', {
      name: 'Brief',
      url: 'https://docs.example.com/d/SECRET-TOKEN/edit',
    })
  ).json()) as { id: string }
  sent.length = 0
  await fromSlack(pasted(t, `C${t}A`, [`${base}/${here!.p}/files/${await n('file', shared.id)}`]))
  await slackUnfurl(20)
  const linked = sent.find((x) => x.method === 'chat.unfurl')!.params.unfurls!
  assert.match(linked, /Link to docs\.example\.com/)
  assert.ok(!linked.includes('SECRET-TOKEN'))

  // A connection deleted with its workspace takes its queued previews with it.
  await fromSlack(pasted(t, `C${t}A`, [want.task]))
  const [conn] = await db<
    { id: string }[]
  >`select id from slack_connection where workspace_id = ${owner.workspaceId} and deleted_at is null`
  await db
    .begin(async (tx) => {
      await tx`delete from slack_out where link_id in (select id from slack_link where connection_id = ${conn!.id})`
      await tx`delete from slack_link where connection_id = ${conn!.id}`
      await tx`delete from slack_connection where id = ${conn!.id}`
      assert.equal((await tx<{ n: number }[]>`select count(*)::int as n from slack_unfurl where connection_id = ${conn!.id}`)[0]!.n, 0)
      throw new Error('rolled back')
    })
    .catch((e: Error) => assert.equal(e.message, 'rolled back'))

  // Stopped, the channel previews nothing.
  const kept = await queued(`C${t}A`)
  assert.equal((await call(`/api/projects/${project}/slack`, owner.token, 'DELETE')).status, 204)
  await fromSlack(pasted(t, `C${t}A`, [want.task]))
  assert.equal(await queued(`C${t}A`), kept)
})

test('another company’s channel never previews this one’s task', async () => {
  const a = await makeOwner()
  const b = await makeOwner()
  const pa = await makeProject(a.ctx, a.workspaceId, 'Ours')
  const pb = await makeProject(b.ctx, b.workspaceId, 'Theirs')
  const [ta, tb] = [team(), team()]
  assert.equal((await connect(a.token, `code-${ta}`)).status, 201)
  assert.equal((await connect(b.token, `code-${tb}`)).status, 201)
  assert.equal((await call(`/api/projects/${pa}/slack`, a.token, 'PUT', { channel_id: `C${ta}A` })).status, 200)
  assert.equal((await call(`/api/projects/${pb}/slack`, b.token, 'PUT', { channel_id: `C${tb}A` })).status, 200)
  const made = (await (await call(`/api/projects/${pa}/tasks`, a.token, 'POST', { title: 'Ours alone' })).json()) as { id: string }
  const [r] = await db<{ ws: string; p: string; number: number }[]>`
    select w.slug::text as ws, p.slug::text as p, t.number from task t
    join project p on p.id = t.project_id join workspace w on w.id = p.workspace_id where t.id = ${made.id}`
  const url = `${env.appUrl}/${r!.ws}/${r!.p}/tasks/${r!.number}`

  sent.length = 0
  // Pasted in the other company's linked channel, from its own Slack.
  await fromSlack(pasted(tb, `C${tb}A`, [url]))
  // Or claiming to be our Slack with their channel, or theirs with ours.
  await fromSlack(pasted(ta, `C${tb}A`, [url]))
  await fromSlack(pasted(tb, `C${ta}A`, [url]))
  for (let i = 0; i < 2; i++) await slackUnfurl(20)
  assert.equal(sent.filter((s) => s.method === 'chat.unfurl').length, 0)
  assert.ok(!sent.some((s) => s.params.unfurls?.includes('Ours alone')))
})

test('the application role cannot read a preview, and a connection before previews is told to connect again', async () => {
  const owner = await makeOwner()
  await assert.rejects(
    withActor(owner.ctx.actorId, (tx) => tx`select * from slack_preview(gen_random_uuid(), 'a', 'b', 'task', 1)`),
    /permission denied/,
  )
  await assert.rejects(
    withActor(owner.ctx.actorId, (tx) => tx`select * from slack_unfurl_claim(1)`),
    /permission denied/,
  )
  await assert.rejects(
    withActor(owner.ctx.actorId, (tx) => tx`select * from slack_unfurl`),
    /permission denied|row-level/,
  )

  const t = team()
  assert.equal((await connect(owner.token, `code-${t}`)).status, 201)
  await db`update slack_connection set scopes = 'chat:write,chat:write.public,channels:read,groups:read' where workspace_id = ${owner.workspaceId} and deleted_at is null`
  const hello = (await (await call('/api/slack', owner.token)).json()) as { connection: { previews: boolean } }
  assert.equal(hello.connection.previews, false)
})
