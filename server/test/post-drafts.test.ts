import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import type postgres from 'postgres'
import { app } from '../src/http/routes.js'
import { closeRealtime, subscribe } from '../src/realtime.js'
import { bounded } from '../src/db.js'
import { addPerson, asTableOwner, bearerFor, closeDb, makeOwner, makeProject, uuidv7, withActor } from './helpers.js'

/*
 * An announcement can wait as its author's draft,
 * Every way an announcement reaches somebody, asked as somebody who
 * is not its author while it is a draft; then what publishing sends, once.
 */

after(async () => {
  await closeRealtime()
  await closeDb()
})

type Res = { status: number; body: Record<string, unknown> }
async function call(token: string, method: string, path: string, body?: unknown): Promise<Res> {
  const r = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, unknown> }
}
const para = (...parts: unknown[]) => ({ type: 'doc', content: [{ type: 'paragraph', content: parts }] })
const text = (t: string) => ({ type: 'text', text: t })
const mention = (id: string) => ({ type: 'mention', attrs: { id, label: 'x' } })
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Ann writes, Ben and Cara are on the project, the owner runs everything, an agent is on it. */
async function studio() {
  const owner = await makeOwner()
  const project = await makeProject(owner.ctx, owner.workspaceId, 'Studio')
  const ann = await addPerson(owner.ctx, owner.workspaceId, 'member', [project])
  const ben = await addPerson(owner.ctx, owner.workspaceId, 'member', [project])
  const cara = await addPerson(owner.ctx, owner.workspaceId, 'member', [project])
  const t = {
    owner: owner.token,
    ann: await bearerFor(ann.actorId, owner.workspaceId),
    ben: await bearerFor(ben.actorId, owner.workspaceId),
    cara: await bearerFor(cara.actorId, owner.workspaceId),
  }
  const agent = await call(owner.token, 'POST', '/api/agents', { name: 'Scout', project_ids: [project], reach: 'mcp' })
  assert.equal(agent.status, 201, JSON.stringify(agent.body))
  /* The owner's own token: a tool acting for a person. */
  const own = await call(owner.token, 'POST', '/api/tokens', { name: 'Script' })
  assert.equal(own.status, 201, JSON.stringify(own.body))
  /* A webhook for the workspace, which hears every event. */
  await asTableOwner()`
    insert into webhook (id, workspace_id, url, secret_enc, created_by)
    values (${uuidv7()}, ${owner.workspaceId}, 'https://example.com/hook', 'whs_x', ${owner.ctx.actorId})`
  return {
    owner,
    project,
    ann,
    ben,
    cara,
    t,
    agentId: agent.body.agent_id as string,
    agentToken: agent.body.token as string,
    ownToken: own.body.token as string,
  }
}

async function draft(token: string, project: string, title: string, body: unknown = para(text(title))): Promise<string> {
  const made = await call(token, 'POST', `/api/projects/${project}/posts`, { title, body, audience: 'author' })
  assert.equal(made.status, 201, JSON.stringify(made.body))
  return made.body.id as string
}
type Card = { id: string; audience?: string; created_at: string }
const listed = async (token: string, project: string, drafts = false) => {
  const r = await call(token, 'GET', `/api/projects/${project}/posts${drafts ? '?drafts=1' : ''}`)
  assert.equal(r.status, 200)
  return { posts: r.body.posts as Card[], drafts: r.body.drafts as Card[] | undefined }
}
const found = async (token: string, word: string, id: string) => {
  const r = await call(token, 'GET', `/api/search?q=${encodeURIComponent(word)}&type=post`)
  return ((r.body.results ?? []) as { id: string }[]).some((x) => x.id === id)
}
const inFeed = async (token: string, project: string, id: string) => {
  const r = await call(token, 'GET', `/api/activity?project=${project}`)
  return ((r.body.events ?? []) as { object_id: string; action: string }[]).filter((e) => e.object_id === id).map((e) => e.action)
}
const notes = async (actorId: string, id: string) =>
  (
    await asTableOwner()<{ reason: string }[]>`
      select reason::text from notification where actor_id = ${actorId} and object_id = ${id} order by created_at, reason`
  ).map((r) => r.reason)
const deliveries = async (workspaceId: string, id: string) =>
  (
    await asTableOwner()<{ event: string }[]>`
      select event from webhook_delivery where workspace_id = ${workspaceId} and payload->>'object_id' = ${id} order by created_at`
  ).map((r) => r.event)
const lines = async (id: string) =>
  (await asTableOwner()<{ action: string }[]>`select action from activity_event where object_id = ${id} order by at`).map((r) => r.action)

test('a draft is its author’s alone, and nothing is said of it: list, read, search, feed, notes, socket, webhook, replies', async () => {
  const w = await studio()
  const heard: { kind: string; id: unknown }[] = []
  const stop = await subscribe(`project:${w.project}`, (e) =>
    heard.push({ kind: e.kind, id: (e.payload as { object_id?: unknown }).object_id }),
  )
  try {
    const word = `marmot${uuidv7().slice(-6)}`
    /* Naming Ben, who must not hear of it. */
    const id = await draft(w.t.ann, w.project, `Plan ${word}`, para(text(`about ${word} `), mention(w.ben.actorId)))
    assert.equal((await call(w.t.ann, 'PATCH', `/api/posts/${id}`, { body: para(text(`more ${word}`)) })).status, 200)
    assert.equal((await call(w.t.ann, 'PATCH', `/api/posts/${id}`, { title: `Plan ${word} two` })).status, 200)

    /* Ann: in her drafts, not among the published, read whole, found. */
    const mine = await listed(w.t.ann, w.project, true)
    assert.equal(
      mine.posts.find((p) => p.id === id),
      undefined,
      'a draft is not among the published, its author’s included',
    )
    assert.equal(mine.drafts?.find((p) => p.id === id)?.audience, 'author')
    const read = await call(w.t.ann, 'GET', `/api/posts/${id}`)
    assert.equal(read.status, 200)
    assert.equal((read.body.post as { audience: string }).audience, 'author')
    assert.equal((read.body.post as { published_at: string | null }).published_at, null)
    assert.equal(await found(w.t.ann, word, id), true)
    /* A client that does not ask is handed no draft at all. */
    const old = await listed(w.t.ann, w.project)
    assert.equal(old.drafts, undefined)
    assert.equal(
      old.posts.find((p) => p.id === id),
      undefined,
    )

    /* Nobody else — a member, the owner, the agent, the owner's own token. */
    for (const [who, token] of [
      ['ben', w.t.ben],
      ['owner', w.t.owner],
      ['agent', w.agentToken],
      ['the owner’s token', w.ownToken],
    ] as const) {
      const l = await listed(token, w.project, true)
      assert.equal(
        l.posts.find((p) => p.id === id),
        undefined,
        `${who} lists it`,
      )
      assert.equal(
        l.drafts?.find((p) => p.id === id),
        undefined,
        `${who} lists it as a draft`,
      )
      assert.equal((await call(token, 'GET', `/api/posts/${id}`)).status, 404, `${who} reads it`)
      assert.equal((await call(token, 'GET', `/api/posts/${id}/comments`)).status, 404, `${who} reads its replies`)
      assert.equal(await found(token, word, id), false, `${who} finds it`)
      assert.deepEqual(await inFeed(token, w.project, id), [], `${who} sees it in the feed`)
      assert.equal((await call(token, 'POST', `/api/posts/${id}/subscription`)).status, 404, `${who} follows it`)
      assert.equal((await call(token, 'POST', `/api/posts/${id}/comments`, { body: para(text('hi')) })).status, 404, `${who} replies`)
      assert.equal((await call(token, 'PATCH', `/api/posts/${id}`, { title: 'Mine now' })).status, 404, `${who} changes it`)
      assert.equal((await call(token, 'DELETE', `/api/posts/${id}`)).status, 404, `${who} deletes it`)
      assert.equal((await call(token, 'PUT', `/api/posts/${id}/audience`, { audience: 'project' })).status, 404, `${who} publishes it`)
    }
    /* Its address, by number, opens nothing for anybody else either. */
    const [{ number }] = await asTableOwner()<[{ number: number }]>`select number from post where id = ${id}`
    const at = await call(w.t.ben, 'GET', `/api/projects/${w.project}/at/${number}?kind=post`)
    assert.notEqual(at.body.id, id, 'its number does not resolve to it for Ben')

    /* No reply on a draft, its author's included: there is nobody to reply. */
    const reply = await call(w.t.ann, 'POST', `/api/posts/${id}/comments`, { body: para(text('note to self')) })
    assert.equal(reply.status, 409)
    assert.equal((reply.body.error as { code: string }).code, 'not_published')

    /* Nothing was said. */
    for (const p of [w.ben, w.cara]) assert.deepEqual(await notes(p.actorId, id), [], 'nobody was told')
    assert.deepEqual(await notes(w.owner.ctx.actorId, id), [])
    assert.deepEqual(await lines(id), [], 'no line in the feed, not even its author’s')
    assert.deepEqual(await deliveries(w.owner.workspaceId, id), [], 'no webhook was queued')
    await pause(300)
    assert.deepEqual(
      heard.filter((e) => e.id === id),
      [],
      'the project’s socket heard nothing of it',
    )
  } finally {
    await stop()
  }
})

test('publishing is the author’s press and sends what posting sends, once, at the moment it is pressed', async () => {
  const w = await studio()
  const heard: { kind: string; id: unknown }[] = []
  const stop = await subscribe(`project:${w.project}`, (e) =>
    heard.push({ kind: e.kind, id: (e.payload as { object_id?: unknown }).object_id }),
  )
  try {
    const word = `lynx${uuidv7().slice(-6)}`
    const id = await draft(w.t.ann, w.project, `Launch ${word}`, para(text('soon')))
    /* Ann names Cara while it is a draft: the words as they are when it is
       published are what tell. */
    assert.equal(
      (await call(w.t.ann, 'PATCH', `/api/posts/${id}`, { body: para(text(`launch ${word} `), mention(w.cara.actorId)) })).status,
      200,
    )
    /* Somebody else posts meanwhile: the draft was started first. */
    const other = await call(w.t.ben, 'POST', `/api/projects/${w.project}/posts`, { title: 'In between', body: para(text('x')) })
    assert.equal(other.status, 201)

    /* Not through a token, Ann's or an agent's; not by a body that says anything else. */
    const annsTool = await call(w.t.ann, 'PUT', `/api/posts/${id}/audience`, { audience: 'author' })
    assert.equal(annsTool.status, 400, 'never back to a draft, and not a way to say publish')
    assert.equal((await call(w.t.ann, 'PUT', `/api/posts/${id}/audience`, {})).status, 400)
    assert.equal((await call(w.t.ann, 'PUT', `/api/posts/${id}/audience`, { audience: 'project', extra: 1 })).status, 400)
    assert.equal((await call(w.t.ann, 'GET', `/api/posts/${id}?publish=1`)).status, 200)
    assert.equal((await call(w.t.ann, 'GET', `/api/projects/${w.project}/posts?drafts=1&publish=1`)).status, 200)
    assert.deepEqual(await notes(w.ben.actorId, id), [], 'opening it, or a parameter, publishes nothing')

    const before = Date.now()
    const out = await call(w.t.ann, 'PUT', `/api/posts/${id}/audience`, { audience: 'project' })
    assert.equal(out.status, 200, JSON.stringify(out.body))
    assert.equal(out.body.audience, 'project')
    assert.ok(Date.parse(out.body.published_at as string) >= before - 1000)

    /* Everybody on the project, once. */
    assert.deepEqual(await notes(w.ben.actorId, id), ['posted'])
    assert.deepEqual(await notes(w.cara.actorId, id), ['mentioned'], 'named in its words now, Cara is told so')
    assert.deepEqual(await notes(w.ann.actorId, id), [], 'not its author')
    const agentNotes = await notes(w.agentId, id)
    assert.ok(agentNotes.length <= 1)
    assert.deepEqual(await lines(id), ['post.create'], 'one line, the posting')
    assert.deepEqual(await deliveries(w.owner.workspaceId, id), ['post.create'])
    await pause(300)
    assert.deepEqual(
      heard.filter((e) => e.id === id).map((e) => e.kind),
      ['post.create'],
    )
    /* Read by everybody now, and found. */
    assert.equal((await call(w.t.ben, 'GET', `/api/posts/${id}`)).status, 200)
    assert.equal((await call(w.agentToken, 'GET', `/api/posts/${id}`)).status, 200)
    assert.equal(await found(w.t.cara, word, id), true)
    assert.ok((await inFeed(w.t.ben, w.project, id)).includes('post.create'))
    /* Its place is the moment it was published: above what was posted meanwhile. */
    const l = await listed(w.t.ben, w.project)
    assert.deepEqual(
      l.posts.slice(0, 2).map((p) => p.id),
      [id, other.body.id],
    )
    assert.equal(l.posts[0]?.audience, 'project')
    assert.ok(Date.parse(l.posts[0]!.created_at) >= before - 1000, 'its date is when it was published')
    assert.equal((await listed(w.t.ann, w.project, true)).drafts?.length, 0, 'out of its author’s drafts')
    /* Replies are open. */
    assert.equal((await call(w.t.ben, 'POST', `/api/posts/${id}/comments`, { body: para(text('great')) })).status, 201)

    /* Pressed again: answered the same, nothing sent again. */
    const again = await call(w.t.ann, 'PUT', `/api/posts/${id}/audience`, { audience: 'project' })
    assert.equal(again.status, 200)
    assert.deepEqual(await notes(w.ben.actorId, id).then((n) => n.filter((r) => r === 'posted')), ['posted'])
    assert.deepEqual(
      (await lines(id)).filter((a) => a === 'post.create'),
      ['post.create'],
    )
  } finally {
    await stop()
  }
})

test('a token never makes or publishes a draft, and the old shape still posts at once', async () => {
  const w = await studio()
  /* Asked for through a token — the owner's own, an agent's — refused, either way it is asked. */
  for (const [who, token] of [
    ['the owner’s token', w.ownToken],
    ['agent', w.agentToken],
  ] as const) {
    for (const ask of [{ audience: 'author' }, { publish: false }]) {
      const r = await call(token, 'POST', `/api/projects/${w.project}/posts`, { title: 'Not yet', body: para(text('x')), ...ask })
      assert.equal(r.status, 403, `${who} made a draft with ${JSON.stringify(ask)}`)
    }
  }
  /* The owner's own draft, which their token reads as theirs — and cannot publish. */
  const id = await draft(w.t.owner, w.project, 'Owner’s draft')
  assert.equal((await call(w.ownToken, 'GET', `/api/posts/${id}`)).status, 200, 'a person’s token reads their own draft')
  assert.equal((await call(w.ownToken, 'PUT', `/api/posts/${id}/audience`, { audience: 'project' })).status, 403)
  assert.equal((await asTableOwner()<{ audience: string }[]>`select audience from post where id = ${id}`)[0]?.audience, 'author')
  /* Both said at once, disagreeing: no question at all. */
  assert.equal(
    (await call(w.t.ann, 'POST', `/api/projects/${w.project}/posts`, { title: 'x', audience: 'project', publish: false })).status,
    400,
  )

  /* The shape every client sent until now — a token's, an old app's — posts at once. */
  for (const token of [w.agentToken, w.ownToken, w.t.ann]) {
    const made = await call(token, 'POST', `/api/projects/${w.project}/posts`, { title: 'Now', body: para(text('y')) })
    assert.equal(made.status, 201)
    const pid = made.body.id as string
    const [row] = await asTableOwner()<{ audience: string; published: boolean }[]>`
      select audience, published_at is not null as published from post where id = ${pid}`
    assert.deepEqual({ ...row }, { audience: 'project', published: true })
    assert.deepEqual(await notes(w.ben.actorId, pid), ['posted'])
    assert.equal((await call(w.t.ben, 'GET', `/api/posts/${pid}`)).status, 200)
  }
  /* `publish: false` from a person in the product is a draft now, not a row
     everybody reads unannounced. */
  const quiet = await call(w.t.ann, 'POST', `/api/projects/${w.project}/posts`, { title: 'Quiet', body: para(text('z')), publish: false })
  assert.equal(quiet.status, 201)
  assert.equal((await call(w.t.ben, 'GET', `/api/posts/${quiet.body.id}`)).status, 404)
})

test('the schema holds it, not only the handler: policies, trigger, definer functions, replies', async () => {
  const w = await studio()
  const word = `okapi${uuidv7().slice(-6)}`
  const id = await draft(w.t.ann, w.project, `Note ${word}`)
  const ws = w.owner.workspaceId
  /* Read and write as Ben and as the owner, under the policies alone. */
  for (const who of [w.ben.actorId, w.owner.ctx.actorId]) {
    const r = await withActor(who, async (tx) => {
      await tx`select set_config('app.workspace_id', ${ws}, true)`
      const seen = await tx`select id from post where id = ${id}`
      const changed = await tx`update post set title = 'taken' where id = ${id} returning id`
      const searched = await tx`select id from search_posts(${word}, null)`
      const [{ may }] = await tx<[{ may: boolean }]>`select may_read(${who}, 'post', ${id}) as may`
      const told = await tx`select actor_id from post_audience(${id})`
      return { seen: seen.length, changed: changed.length, searched: searched.length, may, told: told.length }
    })
    assert.deepEqual(r, { seen: 0, changed: 0, searched: 0, may: false, told: 0 }, who)
  }
  /* Ann reads her own, and `may_read` says so of her alone. */
  const mine = await withActor(w.ann.actorId, async (tx) => {
    await tx`select set_config('app.workspace_id', ${ws}, true)`
    const [{ may }] = await tx<[{ may: boolean }]>`select may_read(${w.ann.actorId}, 'post', ${id}) as may`
    const [{ apart }] = await tx<[{ apart: boolean }]>`select post_apart(${id}) as apart`
    return { seen: (await tx`select id from post where id = ${id}`).length, may, apart }
  })
  assert.deepEqual(mine, { seen: 1, may: true, apart: true })

  /* A reply written straight into the table, its author's included, is refused by the policy. */
  await assert.rejects(
    withActor(
      w.ann.actorId,
      (tx) => tx`
      insert into comment (id, workspace_id, project_id, object_type, object_id, author_id, body)
      values (${uuidv7()}, ${ws}, ${w.project}, 'post', ${id}, ${w.ann.actorId}, '{}'::jsonb)`,
    ),
    /row-level security/,
  )
  /* Somebody else publishing it — even where the row is in reach, as the
     table's owner acting for Ben — is refused by the trigger. */
  await assert.rejects(
    asTableOwner().begin(async (tx) => {
      await tx`select set_config('app.actor_id', ${w.ben.actorId}, true)`
      await tx`update post set audience = 'project' where id = ${id}`
    }),
    /Only its author publishes a draft/,
  )
  /* Published, never a draft again — not even by its author, not even in SQL. */
  assert.equal((await call(w.t.ann, 'PUT', `/api/posts/${id}/audience`, { audience: 'project' })).status, 200)
  await assert.rejects(
    withActor(w.ann.actorId, async (tx) => {
      await tx`select set_config('app.workspace_id', ${ws}, true)`
      await tx`update post set audience = 'author' where id = ${id}`
    }),
    /not made a draft again/,
  )
  /* Every announcement from before is the project's: the column's default. */
  const [{ n }] = await asTableOwner()<[{ n: number }]>`
    select count(*)::int as n from post where audience = 'author' and published_at is not null`
  assert.equal(n, 0, 'no published announcement is a draft')
})

test('deleting a draft says nothing, and a file it named first does not name it', async () => {
  const w = await studio()
  /* A link in the project's Files, put into the draft: the draft becomes the place it was first put. */
  const link = await call(w.t.ann, 'POST', `/api/projects/${w.project}/files`, { name: 'Brief', url: 'https://example.com/brief' })
  assert.equal(link.status, 201, JSON.stringify(link.body))
  const fileId = link.body.id as string
  const id = await draft(w.t.ann, w.project, 'With a file', {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [text('see')] },
      { type: 'attachment', attrs: { fileId, name: 'Brief' } },
    ],
  })
  const [{ origin }] = await asTableOwner()<[{ origin: string | null }]>`select origin_id as origin from file where id = ${fileId}`
  assert.equal(origin, id, 'first put in the draft')
  /* Ann reads where it was first put; Ben is not given the draft's id. */
  assert.equal(((await call(w.t.ann, 'GET', `/api/files/${fileId}`)).body.file as { origin_id: string | null }).origin_id, id)
  assert.equal(((await call(w.t.ben, 'GET', `/api/files/${fileId}`)).body.file as { origin_id: string | null }).origin_id, null)
  const row = (
    (await call(w.t.ben, 'GET', `/api/projects/${w.project}/files`)).body.files as { id: string; origin_id: string | null }[]
  ).find((f) => f.id === fileId)
  assert.equal(row?.origin_id, null)
  /* What the draft points at is not said to Ben either. */
  const links = await call(w.t.ben, 'GET', `/api/links/post/${id}`)
  assert.deepEqual(links.body.links ?? [], [])

  /* Deleted by its author: gone from their drafts, nothing in the feed, back on Undo. */
  assert.equal((await call(w.t.ann, 'DELETE', `/api/posts/${id}`)).status, 200)
  assert.equal((await listed(w.t.ann, w.project, true)).drafts?.length, 0)
  assert.equal((await call(w.t.ann, 'POST', `/api/posts/${id}/restore`)).status, 200)
  assert.equal((await listed(w.t.ann, w.project, true)).drafts?.length, 1)
  assert.deepEqual(await lines(id), [], 'the project never heard of it')
  assert.deepEqual(await deliveries(w.owner.workspaceId, id), [])
})

test('a draft is never copied by the check-ins run, and has no schedule', async () => {
  const w = await studio()
  /* Asked for with a schedule, a draft is refused: a timer would publish it. */
  const scheduled = await call(w.t.owner, 'POST', `/api/projects/${w.project}/posts`, {
    title: 'Weekly',
    body: para(text('x')),
    audience: 'author',
    schedule: 'FREQ=WEEKLY',
  })
  assert.equal(scheduled.status, 400)
  /* One with a schedule anyway — written by hand — is not copied for the
     owner who runs the check-ins, whose own draft it is. */
  const word = `quagga${uuidv7().slice(-6)}`
  const id = await draft(w.t.owner, w.project, `Draft check-in ${word}`)
  await asTableOwner()`update post set schedule = 'FREQ=WEEKLY' where id = ${id}`
  const live = await call(w.t.owner, 'POST', `/api/projects/${w.project}/posts`, {
    title: `Live check-in ${word}`,
    body: para(text('y')),
    schedule: 'FREQ=WEEKLY',
  })
  assert.equal(live.status, 201)
  const ran = await call(w.t.owner, 'POST', '/api/checkins/run')
  assert.equal(ran.status, 200, JSON.stringify(ran.body))
  const copies = await asTableOwner()<{ title: string; audience: string; published: boolean }[]>`
    select title, audience, published_at is not null as published from post
    where workspace_id = ${w.owner.workspaceId} and schedule is null and title like ${`%check-in ${word}`}`
  assert.deepEqual(
    copies.map((r) => ({ ...r })),
    [{ title: `Live check-in ${word}`, audience: 'project', published: true }],
    'the published check-in is copied, the draft is not',
  )
})

test('publishing links what its words point at now', async () => {
  const w = await studio()
  const task = await call(w.t.ann, 'POST', `/api/projects/${w.project}/tasks`, { title: 'Ship it' })
  assert.equal(task.status, 201)
  const id = await draft(w.t.ann, w.project, 'Plan', para(text('first words')))
  /* Rewritten while a draft to name the task, then published. */
  const named = await call(w.t.ann, 'PATCH', `/api/posts/${id}`, {
    body: para(text('see '), { type: 'taskref', attrs: { id: task.body.id } }),
  })
  assert.equal(named.status, 200)
  assert.equal((await call(w.t.ann, 'PUT', `/api/posts/${id}/audience`, { audience: 'project' })).status, 200)
  const out = await call(w.t.ben, 'GET', `/api/links/post/${id}`)
  assert.ok(
    ((out.body.links ?? []) as { id: string }[]).some((l) => l.id === task.body.id),
    JSON.stringify(out.body),
  )
  const back = await call(w.t.ben, 'GET', `/api/links/task/${task.body.id}`)
  assert.ok(
    ((back.body.links ?? []) as { id: string }[]).some((l) => l.id === id),
    'the task says the announcement points at it',
  )
})

test('the database refuses a tool a draft: made through one, or published through one', async () => {
  const w = await studio()
  const ws = w.owner.workspaceId
  const insert = (tx: postgres.TransactionSql, audience: string) => tx`
    insert into post (id, workspace_id, project_id, author_id, title, audience)
    values (${uuidv7()}, ${ws}, ${w.project}, ${w.ann.actorId}, 'Straight in', ${audience})`
  const asAnn = (fn: (tx: postgres.TransactionSql) => Promise<unknown>) =>
    withActor(w.ann.actorId, async (tx) => {
      await tx`select set_config('app.workspace_id', ${ws}, true)`
      await fn(tx)
    })
  const asTool = <T>(fn: () => Promise<T>) => bounded({ actorId: w.ann.actorId, tokenProjectIds: [], viaMcp: true }, fn)
  /* In person, Ann may write her own draft straight into the table. */
  await asAnn((tx) => insert(tx, 'author'))
  /* Through a token — any tool — the policy refuses a draft, and lets one the project has through. */
  await assert.rejects(
    asTool(() => asAnn((tx) => insert(tx, 'author'))),
    /row-level security/,
  )
  await asTool(() => asAnn((tx) => insert(tx, 'project')))
  /* And publishing her own draft through one is refused by the row's trigger. */
  const id = await draft(w.t.ann, w.project, 'Mine, kept')
  await assert.rejects(
    asTool(() => asAnn((tx) => tx`update post set audience = 'project' where id = ${id}`)),
    /in person, not through a tool/,
  )
  assert.equal((await asTableOwner()<{ audience: string }[]>`select audience from post where id = ${id}`)[0]?.audience, 'author')
})
