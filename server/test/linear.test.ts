import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import postgres from 'postgres'
import { app } from '../src/http/routes.js'
import { importWork as linearWork } from '../src/importWork.js'
import { type Claimed, kitOf } from '../src/importKit.js'
import { Later } from '../src/importing.js'
import { createPool, setMarkdownPool } from '../src/mcp/markdownPool.js'
import { issueAccessToken } from '../src/auth/tokens.js'
import { issueApiToken } from '../src/auth/flows.js'
import { addPerson, bearerFor, closeDb, makeOwner, makeProject, withActor } from './helpers.js'

/* Nothing here talks to Linear: its API and
   its file store are answered below, as Linear answers them. */
const owner = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} })
after(async () => {
  globalThis.fetch = real
  await owner.end()
  await closeDb()
})

const KEY = 'lin_api_testkey0123456789abcdef'
const asked: { url: string; auth: string | null }[] = []
let colleagueEmail = ''
let colleagueId = ''
const TEAM = { id: 'team-eng', key: 'ENG', name: 'Engineering', issueCount: 3 }
const ISSUES = () => [
  {
    id: 'i3',
    number: 3,
    title: 'Parent work',
    description: 'The **plan**.\n\n![shot](https://uploads.linear.app/abc/shot.png)\n\n![away](https://evil.example/x.png)',
    priority: 2,
    estimate: 5,
    dueDate: '2026-12-01',
    createdAt: '2026-10-01T10:00:00Z',
    completedAt: null,
    canceledAt: null,
    state: { id: 's-started' },
    assignee: { email: colleagueEmail, name: 'Cole League' },
    creator: { email: 'stranger@else.example', name: 'Stranger' },
    labels: { nodes: [{ name: 'Bug' }] },
    cycle: { id: 'c1' },
    parent: null,
    project: { name: 'Website' },
    comments: {
      nodes: [
        { body: 'From someone not here', createdAt: '2026-10-02T10:00:00Z', user: { email: 'gone@else.example', name: 'Gone Person' } },
        { body: 'From a colleague who is here', createdAt: '2026-10-02T11:00:00Z', user: { email: colleagueEmail, name: 'Cole League' } },
      ],
      pageInfo: { hasNextPage: false, endCursor: null },
    },
  },
  {
    id: 'i8',
    number: 8,
    title: 'A part of a part',
    description: null,
    priority: 0,
    estimate: null,
    dueDate: null,
    createdAt: '2026-10-04T10:00:00Z',
    completedAt: null,
    canceledAt: null,
    archivedAt: null,
    state: { id: 's-todo' },
    assignee: null,
    creator: null,
    labels: { nodes: [] },
    cycle: null,
    parent: { number: 7, team: { id: 'team-eng' } },
    project: null,
    comments: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
  },
  {
    id: 'i9',
    number: 9,
    title: 'Put away in Linear',
    description: null,
    priority: 0,
    estimate: null,
    dueDate: null,
    createdAt: '2026-09-01T10:00:00Z',
    completedAt: null,
    canceledAt: '2026-09-02T10:00:00Z',
    archivedAt: '2026-09-03T10:00:00Z',
    state: { id: 's-done' },
    assignee: null,
    creator: null,
    labels: { nodes: [] },
    cycle: null,
    parent: null,
    project: null,
    comments: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
  },
  {
    id: 'i7',
    number: 7,
    title: 'A part',
    description: null,
    priority: 0,
    estimate: null,
    dueDate: null,
    createdAt: '2026-10-03T10:00:00Z',
    completedAt: '2026-10-05T10:00:00Z',
    canceledAt: null,
    state: { id: 's-done' },
    assignee: null,
    creator: null,
    labels: { nodes: [] },
    cycle: null,
    parent: { number: 3, team: { id: 'team-eng' } },
    project: null,
    comments: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
  },
]
const real = globalThis.fetch
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input)
  const host = new URL(url).hostname
  if (host !== 'api.linear.app' && host !== 'uploads.linear.app' && host !== 'evil.example') return real(input, init)
  const auth = new Headers(init?.headers).get('authorization')
  asked.push({ url, auth })
  if (host === 'evil.example') return new Response('x', { status: 200, headers: { 'content-type': 'image/png' } })
  if (auth !== KEY)
    return new Response(JSON.stringify({ errors: [{ message: 'no', extensions: { code: 'AUTHENTICATION_ERROR' } }] }), { status: 401 })
  if (host === 'uploads.linear.app') {
    // As Linear answers a picture: bytes, said to be nothing in particular.
    return new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]), {
      status: 200,
      headers: { 'content-type': 'application/octet-stream' },
    })
  }
  const q = JSON.parse(String(init?.body)) as { query: string }
  const json = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200, headers: { 'content-type': 'application/json' } })
  if (q.query.includes('teams(')) {
    return json({
      teams: {
        nodes: [
          TEAM,
          { id: 'team-ops', key: 'OPS', name: 'Ops', issueCount: 0 },
          { id: 'team-core', key: 'CORE', name: 'Core Platform', issueCount: 2 },
        ],
      },
    })
  }
  if (q.query.includes('states(')) {
    return json({
      team: {
        states: {
          nodes: [
            { id: 's-triage', name: 'Triage', type: 'triage', position: 0 },
            { id: 's-todo', name: 'Todo', type: 'unstarted', position: 1 },
            { id: 's-started', name: 'In Progress', type: 'started', position: 2 },
            { id: 's-done', name: 'Done', type: 'completed', position: 3 },
          ],
        },
        cycles: { nodes: [{ id: 'c1', number: 1, name: null, startsAt: '2026-10-01T00:00:00Z', endsAt: '2026-10-14T00:00:00Z' }] },
      },
    })
  }
  if (q.query.includes('issues(')) return json({ team: { issues: { nodes: ISSUES(), pageInfo: { hasNextPage: false, endCursor: null } } } })
  return json({})
}) as typeof fetch

const call = (path: string, token: string, body?: unknown) =>
  app.request(`/api${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

async function untilDone(id: string) {
  for (let i = 0; i < 10; i++) {
    await linearWork()
    const [r] = await owner<{ state: string }[]>`select state from linear_import where id = ${id}`
    if (r?.state !== 'running') return r?.state
  }
  return 'running'
}

test('a team comes across with its numbers, lists, people, comments, parts and pictures', async () => {
  const me = await makeOwner()
  /* A colleague in the workspace with an account, whose Linear comment
     comes across: the database refused a comment made theirs. */
  const colleague = await makeOwner()
  colleagueId = colleague.ctx.actorId
  colleagueEmail = (await owner<{ email: string }[]>`select email::text from app_user where actor_id = ${colleague.ctx.actorId}`)[0]!.email
  await owner`insert into membership (id, workspace_id, actor_id, role, joined_at) values (gen_random_uuid(), ${me.workspaceId}, ${colleague.ctx.actorId}, 'member', now())`
  const teams = await call('/import/linear/teams', me.token, { key: KEY })
  assert.equal(teams.status, 200)
  assert.deepEqual(
    ((await teams.json()) as { teams: { key: string }[] }).teams.map((t) => t.key),
    ['ENG', 'OPS', 'CORE'],
  )

  // A team the key cannot see is not brought, whatever the request named.
  const started = await call('/import/linear', me.token, { key: KEY, teams: ['team-eng', 'team-elsewhere'] })
  assert.equal(started.status, 202)
  const { id } = (await started.json()) as { id: string }
  assert.equal((await call('/import/linear', me.token, { key: KEY, teams: ['team-eng'] })).status, 409)
  assert.equal(await untilDone(id), 'done')

  const [project] = await owner<{ id: string; key: string; name: string }[]>`select id, key, name from project where import_id = ${id}`
  assert.equal(project!.key, 'ENG')
  const tasks = await owner<
    {
      number: number
      title: string
      body: unknown
      priority: string | null
      parent_id: string | null
      id: string
      assignee_ids: string[]
      completed_at: Date | null
      list: string
      cycle: string | null
      author_id: string
    }[]
  >`
    select t.number, t.title, t.body, t.priority::text, t.parent_id, t.id, t.assignee_ids, t.completed_at, l.name as list, c.name as cycle, t.author_id
    from task t left join task_list l on l.id = t.list_id left join cycle c on c.id = t.cycle_id
    where t.project_id = ${project!.id} order by t.number`
  assert.deepEqual(
    tasks.map((t) => t.number),
    [3, 7, 8],
  )
  const [parent, part, deeper] = tasks
  // Linear nests parts in parts; here a part is one level deep, so a part of
  // a part is a part of the top of its chain.
  assert.equal(deeper!.parent_id, parent!.id)
  assert.equal(parent!.priority, 'high')
  assert.equal(parent!.list, 'In Progress')
  assert.equal(parent!.cycle, 'Sprint 1')
  // Linear's Triage is this project's triage, first.
  const [first] = await owner<{ name: string; intake: boolean }[]>`
    select name, intake from task_list where project_id = ${project!.id} and deleted_at is null order by sort_key limit 1`
  assert.deepEqual(first, { name: 'Triage', intake: true })
  // Given to the colleague with that email, who is put on the project.
  assert.deepEqual(parent!.assignee_ids, [colleagueId])
  // Somebody who is not here is not anybody here.
  assert.equal(parent!.author_id, me.ctx.actorId)
  assert.equal(part!.parent_id, parent!.id)
  assert.equal(part!.list, 'Done')
  assert.ok(part!.completed_at)
  const body = JSON.stringify(parent!.body)
  assert.match(body, /Estimate: 5/)
  // Linear's author is named in the words, not given the task.
  assert.match(body, /Created in Linear by Stranger/)
  assert.match(body, /"attachment"/)
  // Kept as the picture it is, with a name a computer opens.
  const [picture] = await owner<{ name: string; content_type: string }[]>`
    select name, content_type from file where project_id = ${project!.id} and storage_key is not null`
  assert.equal(picture!.content_type, 'image/png')
  assert.match(picture!.name, /\.png$/)
  // And drawn as one: the body's node says what the file is.
  assert.match(body, /"kind":"image"/)
  assert.match(body, /"name":"shot\.png"/)
  // Only Linear's own store was asked for a picture, and only with the key.
  assert.ok(!asked.some((a) => a.url.includes('evil.example')))
  assert.ok(asked.filter((a) => a.url.includes('uploads.linear.app')).every((a) => a.auth === KEY))
  const labels = await owner<{ name: string }[]>`
    select l.name::text from task_label tl join label l on l.id = tl.label_id where tl.task_id = ${parent!.id} order by l.name`
  assert.deepEqual(
    labels.map((l) => l.name),
    ['Bug', 'Project: Website'],
  )
  const comments = await owner<{ said_as: string | null; origin: string; author_id: string }[]>`
    select said_as, origin::text, author_id from comment where object_id = ${parent!.id} order by created_at`
  // Each under the name Linear gave, none made a colleague's own.
  assert.deepEqual(
    comments.map((c) => [c.said_as, c.origin, c.author_id]),
    [
      ['Gone Person', 'import', me.ctx.actorId],
      ['Cole League', 'import', me.ctx.actorId],
    ],
  )
  // The next task made here comes after the last number brought.
  const seq = await owner<{ task_seq: number }[]>`select task_seq from project where id = ${project!.id}`
  assert.equal(seq[0]!.task_seq, 8)
  // And the key is gone with the import.
  const [row] = await owner<{ key_enc: string | null }[]>`select key_enc from linear_import where id = ${id}`
  assert.equal(row!.key_enc, null)
})

/* The key is somebody's whole Linear account. */
test('the key is never answered back, and the application cannot read it', async () => {
  const me = await makeOwner()
  const started = await call('/import/linear', me.token, { key: KEY, teams: ['team-ops'] })
  const { id } = (await started.json()) as { id: string }
  const listed = await (await call('/import/linear', me.token)).text()
  assert.ok(!listed.includes('key_enc') && !listed.includes(KEY))
  await assert.rejects(
    withActor(me.ctx.actorId, (tx) => tx`select key_enc from linear_import where id = ${id}`),
    /permission denied/,
  )
  await untilDone(id)
})

test('only the owner starts one, never a token', async () => {
  const me = await makeOwner()
  const member = await addPerson(me.ctx, me.workspaceId, 'member')
  await withActor(
    me.ctx.actorId,
    (tx) => tx`update workspace set settings = settings || '{"who_creates_projects":"owner"}' where id = ${me.workspaceId}`,
  )
  assert.equal((await call('/import/linear/teams', await bearerFor(member.actorId, me.workspaceId), { key: KEY })).status, 403)
  const token = await issueApiToken(me.ctx.actorId, me.workspaceId, 'agent')
  assert.equal((await call('/import/linear', token, { key: KEY, teams: ['team-eng'] })).status, 403)
  assert.equal((await call('/import/linear/teams', me.token, { key: 'not-a-key' })).status, 400)
  assert.equal((await call('/import/linear/teams', me.token, { key: 'lin_api_wrongkey0000000000000000' })).status, 400)
})

/* The import's doors take nothing from anybody else: a person's own session
   cannot give a task a number, and an import's token writes only into the
   projects that same import made. */
test('an import’s doors are its own, and only into what it made', async () => {
  const me = await makeOwner()
  const theirs = await makeProject(me.ctx, me.workspaceId, 'Not imported')
  const page = {
    project_id: theirs,
    issues: [
      {
        number: 1,
        title: 'x',
        body: '',
        priority: 0,
        dueDate: null,
        createdAt: '2026-10-01T00:00:00Z',
        completedAt: null,
        state: null,
        assignee: null,
        creator: null,
        labels: [],
        cycle: null,
        parent: null,
        comments: [],
      },
    ],
  }
  assert.equal((await call('/import/linear/issues', me.token, page)).status, 403)

  const started = await call('/import/linear', me.token, { key: KEY, teams: ['team-ops'] })
  const { id } = (await started.json()) as { id: string }
  const as = await issueAccessToken({ sub: me.ctx.actorId, workspace_id: me.workspaceId, via: 'import', imp: id })
  assert.equal((await call('/import/linear/issues', as, page)).status, 403)
  // Somebody else's import, even in the same workspace, is not this one.
  const other = await makeOwner()
  const forged = await issueAccessToken({ sub: other.ctx.actorId, workspace_id: other.workspaceId, via: 'import', imp: id })
  assert.equal(
    (await call('/import/linear/project', forged, { team: { id: 'x', key: 'X', name: 'X' }, states: [], cycles: [] })).status,
    403,
  )
  await untilDone(id)
  // Ended, its token opens nothing.
  assert.equal((await call('/import/linear/project', as, { team: { id: 'x', key: 'X', name: 'X' }, states: [], cycles: [] })).status, 403)
})

/* While a project's issues are coming, a task made by hand would take a
   number a page still to come needs. And a key that may not be a key here,
   or one somebody has, is not taken: the project is named another way. */
test('nobody makes a task in a project still being imported, and a key that cannot be one is not taken', async () => {
  const me = await makeOwner()
  const started = await call('/import/linear', me.token, { key: KEY, teams: ['team-core'] })
  const { id } = (await started.json()) as { id: string }
  const as = await issueAccessToken({ sub: me.ctx.actorId, workspace_id: me.workspaceId, via: 'import', imp: id })
  const made = await call('/import/linear/project', as, {
    team: { id: 'team-core', key: 'CORE', name: 'Core Platform' },
    states: [],
    cycles: [],
  })
  assert.equal(made.status, 200)
  const { project_id } = (await made.json()) as { project_id: string }
  const [p] = await owner<{ key: string }[]>`select key from project where id = ${project_id}`
  assert.notEqual(p!.key, 'CORE')
  assert.equal((await call(`/projects/${project_id}/tasks`, me.token, { title: 'By hand' })).status, 409)
  // Nor by any other way a task is made: refused where its number is given.
  await assert.rejects(
    withActor(
      me.ctx.actorId,
      (tx) => tx`
      insert into task (id, workspace_id, project_id, author_id, title, sort_key)
      values (gen_random_uuid(), ${me.workspaceId}, ${project_id}, ${me.ctx.actorId}, 'Sideways', 'a0')`,
    ),
    /project_importing/,
  )
  // Asked twice for the same team, it is the same project.
  const again = await call('/import/linear/project', as, {
    team: { id: 'team-core', key: 'CORE', name: 'Core Platform' },
    states: [],
    cycles: [],
  })
  assert.equal(((await again.json()) as { project_id: string }).project_id, project_id)
  // What is there already is said, so nothing is brought for it twice.
  const have = await call('/import/linear/have', as, { project_id, numbers: [3, 7, 99] })
  assert.deepEqual(((await have.json()) as { have: number[] }).have, [])
  await untilDone(id)
  const after = await call(
    '/import/linear/have',
    await issueAccessToken({ sub: me.ctx.actorId, workspace_id: me.workspaceId, via: 'import', imp: id }),
    { project_id, numbers: [3] },
  )
  assert.equal(after.status, 403)
  assert.equal((await call(`/projects/${project_id}/tasks`, me.token, { title: 'By hand' })).status, 201)
})

test('the key of a project somebody has already is not taken', async () => {
  const me = await makeOwner()
  const mine = await makeProject(me.ctx, me.workspaceId, 'Engines')
  await owner`update project set key = 'ENG' where id = ${mine}`
  const started = await call('/import/linear', me.token, { key: KEY, teams: ['team-eng'] })
  const { id } = (await started.json()) as { id: string }
  assert.equal(await untilDone(id), 'done')
  const [p] = await owner<{ key: string }[]>`select key from project where import_id = ${id}`
  assert.ok(p && p.key !== 'ENG')
})

/* An import that stopped left its project; the next one takes it up and
   brings only what is missing, rather than a second project of the team. */
test('an import after one that stopped takes up its project', async () => {
  const me = await makeOwner()
  const first = (await (await call('/import/linear', me.token, { key: KEY, teams: ['team-eng'] })).json()) as { id: string }
  const as = await issueAccessToken({ sub: me.ctx.actorId, workspace_id: me.workspaceId, via: 'import', imp: first.id })
  const made = (await (
    await call('/import/linear/project', as, { team: { id: 'team-eng', key: 'ENG', name: 'Engineering' }, states: [], cycles: [] })
  ).json()) as { project_id: string }
  await owner`update linear_import set state = 'failed', key_enc = null where id = ${first.id}`
  const second = (await (await call('/import/linear', me.token, { key: KEY, teams: ['team-eng'] })).json()) as { id: string }
  assert.equal(await untilDone(second.id), 'done')
  const projects = await owner<
    { id: string }[]
  >`select id from project where workspace_id = ${me.workspaceId} and imported_from = 'linear:team-eng'`
  assert.deepEqual(
    projects.map((p) => p.id),
    [made.project_id],
  )
})

/* An import is stopped by whoever started it, and by nobody else: the key
   goes at once, and the worker's next write is refused. */
test('an import is stopped by its own person, and the key goes with it', async () => {
  const me = await makeOwner()
  const { id } = (await (await call('/import/linear', me.token, { key: KEY, teams: ['team-ops'] })).json()) as { id: string }
  const other = await makeOwner()
  assert.equal((await call(`/import/linear/${id}/stop`, other.token, {})).status, 404)
  assert.equal((await call(`/import/linear/${id}/stop`, me.token, {})).status, 200)
  const [row] = await owner<{ state: string; key_enc: string | null }[]>`select state, key_enc from linear_import where id = ${id}`
  assert.deepEqual(row, { state: 'failed', key_enc: null })
  const as = await issueAccessToken({ sub: me.ctx.actorId, workspace_id: me.workspaceId, via: 'import', imp: id })
  assert.equal(
    (await call('/import/linear/project', as, { team: { id: 'team-ops', key: 'OPS', name: 'Ops' }, states: [], cycles: [] })).status,
    403,
  )
})

/* Each body is bounded on its own, and a page of bounded bodies was not:
   links over italics, a paragraph each, came to a megabyte a body.
   Past what a page may write, the rest are kept as their plain words: the
   import's worker takes any refusal as the end of the import. */
test('a page of bodies too large to write keeps the last ones as plain words, and goes in', async () => {
  const me = await makeOwner()
  const { id } = (await (await call('/import/linear', me.token, { key: KEY, teams: ['team-core'] })).json()) as { id: string }
  const as = await issueAccessToken({ sub: me.ctx.actorId, workspace_id: me.workspaceId, via: 'import', imp: id })
  const made = await call('/import/linear/project', as, { team: { id: 'team-core', key: 'CORE', name: 'Core' }, states: [], cycles: [] })
  const { project_id } = (await made.json()) as { project_id: string }
  const amplifier = '[' + '*a*b'.repeat(75) + '](https://e.co/' + 'x'.repeat(1987) + ')\n\n'
  const issue = (number: number, body: string) => ({
    number,
    title: `Issue ${number}`,
    body,
    priority: 0,
    dueDate: null,
    createdAt: '2026-10-01T00:00:00Z',
    completedAt: null,
    state: null,
    assignee: null,
    creator: null,
    labels: [],
    cycle: null,
    parent: null,
    comments: [],
  })
  const heavy = amplifier.repeat(Math.floor(100_000 / amplifier.length))
  const page = await call('/import/linear/issues', as, { project_id, issues: Array.from({ length: 40 }, (_, k) => issue(k + 1, heavy)) })
  assert.deepEqual(await page.json(), { written: 40 })
  const rows = await owner<{ number: number; size: number; marked: boolean }[]>`
    select number, length(body::text) as size, body::text like '%"marks"%' as marked
    from task where project_id = ${project_id} order by number`
  assert.equal(rows.length, 40)
  assert.ok(rows[0]!.marked, 'the first is read as Markdown')
  assert.ok(!rows[39]!.marked, 'the last is its plain words')
  const total = rows.reduce((s, r) => s + r.size, 0)
  assert.ok(total < 20_000_000 + 40 * heavy.length, `${total} bytes`)
  // An ordinary page goes in as before.
  const fine = await call('/import/linear/issues', as, { project_id, issues: [issue(41, 'The **plan**, and [a link](https://e.co/x).')] })
  assert.deepEqual(await fine.json(), { written: 1 })
  await untilDone(id)
})

/* A busy pool is a wait, and a body the parser fails on is its plain
   words: neither ends an import, whose worker takes three errors in a row
   as the end. */
test('a busy pool is waited out, and a body the parser fails on goes in as its words', async () => {
  const me = await makeOwner()
  const { id } = (await (await call('/import/linear', me.token, { key: KEY, teams: ['team-core'] })).json()) as { id: string }
  const as = await issueAccessToken({ sub: me.ctx.actorId, workspace_id: me.workspaceId, via: 'import', imp: id })
  const made = await call('/import/linear/project', as, { team: { id: 'team-core', key: 'CORE', name: 'Core' }, states: [], cycles: [] })
  const { project_id } = (await made.json()) as { project_id: string }
  const issue = (number: number, body: string) => ({
    number,
    title: `Issue ${number}`,
    body,
    priority: 0,
    dueDate: null,
    createdAt: '2026-10-01T00:00:00Z',
    completedAt: null,
    state: null,
    assignee: null,
    creator: null,
    labels: [],
    cycle: null,
    parent: null,
    comments: [],
  })
  const HOSTILE = new URL('./markdown-hostile-worker.ts', import.meta.url)
  try {
    await setMarkdownPool(createPool({ file: HOSTILE, size: 1, maxQueue: 0 }))
    const busy = await call('/import/linear/issues', as, { project_id, issues: [issue(1, 'words')] })
    assert.equal(busy.status, 503)
    assert.equal(busy.headers.get('retry-after'), '5')
    const kit = kitOf({ id, actor_id: me.ctx.actorId, workspace_id: me.workspaceId } as Claimed)
    await assert.rejects(kit.ours('/import/linear/issues', { project_id, issues: [issue(1, 'words')] }), Later)

    await setMarkdownPool(createPool({ file: HOSTILE, size: 1 }))
    const page = await call('/import/linear/issues', as, { project_id, issues: [issue(1, 'throw'), issue(2, '**fine**')] })
    assert.deepEqual(await page.json(), { written: 2 })
    const rows = await owner<
      { number: number; body: unknown }[]
    >`select number, body from task where project_id = ${project_id} order by number`
    assert.deepEqual(rows[0]!.body, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'throw' }] }] })
    assert.match(JSON.stringify(rows[1]!.body), /"bold"/)
  } finally {
    await setMarkdownPool(null)
  }
  await untilDone(id)
})

/* ---------------------------------------------------------- Jira and Asana
   In this file and not one of their own:
   a test's worker takes whichever import is next, and in another process
   it would meet these with Linear's answers. */

const JIRA = { site: 'acme.atlassian.net', email: 'me@acme.example', token: 'ATATT3xFfGF0jiratoken0123456789' }
const ASANA = '2/1200000000000001/1200000000000002:abcdef0123456789abcdef'
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0])
const adf = (...content: unknown[]) => ({ type: 'doc', version: 1, content })
const para = (...content: unknown[]) => ({ type: 'paragraph', content })
let asanaEmail = ''
const linearFake = globalThis.fetch
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(String(input instanceof Request ? input.url : input))
  const auth = new Headers(init?.headers).get('authorization')
  const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } })
  if (url.hostname.endsWith('.atlassian.net')) {
    asked.push({ url: String(url), auth })
    if (auth !== `Basic ${Buffer.from(`${JIRA.email}:${JIRA.token}`).toString('base64')}`) return new Response('{}', { status: 401 })
    const path = url.pathname
    if (path === '/rest/api/3/project/search')
      return json({ values: [{ id: '10000', key: 'WEB', name: 'Website', insight: { totalIssueCount: 3 } }], isLast: true })
    if (path === '/rest/api/3/project/10000/statuses') {
      return json([
        {
          statuses: [
            { name: 'To Do', statusCategory: { key: 'new' } },
            { name: 'Done', statusCategory: { key: 'done' } },
            { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
            { name: 'Won’t Do', statusCategory: { key: 'done' } },
          ],
        },
      ])
    }
    if (path === '/rest/api/3/field')
      return json([{ id: 'summary' }, { id: 'customfield_10020', schema: { custom: 'com.pyxis.greenhopper.jira:gh-sprint' } }])
    if (path === '/rest/api/3/attachment/content/5') return new Response(PNG, { status: 200, headers: { 'content-type': 'image/png' } })
    if (path === '/rest/api/3/issue/10002/comment') {
      return json({
        total: 2,
        comments: [
          {
            body: adf(para({ type: 'text', text: 'Second word' })),
            created: '2026-10-03T10:00:00Z',
            author: { displayName: 'Gone Person' },
          },
        ],
      })
    }
    if (path === '/rest/api/3/search/jql') {
      const q = JSON.parse(String(init?.body)) as { nextPageToken?: string; jql: string }
      assert.equal(q.jql, 'project = 10000 ORDER BY created ASC')
      const epic = {
        id: '10001',
        key: 'WEB-1',
        fields: {
          summary: 'Big launch',
          issuetype: { hierarchyLevel: 1 },
          status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
          created: '2026-10-01T10:00:00Z',
        },
      }
      const story = {
        id: '10002',
        key: 'WEB-2',
        fields: {
          summary: 'The page',
          description: adf(
            para(
              { type: 'text', text: 'The ' },
              { type: 'text', text: 'plan', marks: [{ type: 'strong' }] },
              { type: 'text', text: ' and a ' },
              { type: 'text', text: 'trap', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] },
            ),
            { type: 'bulletList', content: [{ type: 'listItem', content: [para({ type: 'text', text: 'one' })] }] },
            { type: 'mediaSingle', content: [{ type: 'media', attrs: { id: 'abc', type: 'file' } }] },
          ),
          status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
          priority: { name: 'Highest' },
          assignee: { displayName: 'Cole League Jira' },
          reporter: { displayName: 'Stranger' },
          labels: ['frontend'],
          components: [{ name: 'Web' }],
          duedate: '2026-12-01',
          created: '2026-10-02T10:00:00Z',
          issuetype: { hierarchyLevel: 0 },
          parent: { key: 'WEB-1', fields: { summary: 'Big launch', issuetype: { hierarchyLevel: 1 } } },
          comment: {
            total: 2,
            comments: [
              {
                body: adf(para({ type: 'text', text: 'First word' })),
                created: '2026-10-02T11:00:00Z',
                author: { displayName: 'Stranger' },
              },
            ],
          },
          attachment: [
            { id: '5', filename: 'shot.png', mimeType: 'image/png', size: 8 },
            { id: '6', filename: 'huge.zip', size: 50_000_000 },
          ],
          customfield_10020: [{ name: 'Sprint 7', startDate: '2026-10-01T00:00:00Z', endDate: '2026-10-14T00:00:00Z' }],
        },
      }
      const sub = {
        id: '10003',
        key: 'WEB-3',
        fields: {
          summary: 'A part',
          issuetype: { hierarchyLevel: -1 },
          status: { name: 'Done', statusCategory: { key: 'done' } },
          resolutiondate: '2026-10-05T10:00:00Z',
          created: '2026-10-03T10:00:00Z',
          parent: { key: 'WEB-2', fields: { summary: 'The page', issuetype: { hierarchyLevel: 0 } } },
        },
      }
      // Two pages, by Jira's token.
      return q.nextPageToken === 'p2'
        ? json({ issues: [sub], isLast: true })
        : json({ issues: [epic, story], nextPageToken: 'p2', isLast: false })
    }
    return new Response('{}', { status: 404 })
  }
  if (url.hostname === 'app.asana.com') {
    asked.push({ url: String(url), auth })
    if (auth !== `Bearer ${ASANA}`) return new Response('{}', { status: 401 })
    const path = url.pathname.replace('/api/1.0', '')
    const task = (gid: string, more: Record<string, unknown>) => ({
      gid,
      name: `Task ${gid}`,
      completed: false,
      created_at: '2026-10-01T10:00:00Z',
      num_subtasks: 0,
      ...more,
    })
    if (path === '/workspaces') return json({ data: [{ gid: '111' }] })
    if (path === '/projects') return json({ data: [{ gid: '222', name: 'Launch' }], next_page: null })
    if (path === '/projects/222/task_counts') return json({ data: { num_tasks: 2 } })
    if (path === '/projects/222/sections')
      return json({
        data: [
          { gid: '901', name: 'To do' },
          { gid: '902', name: 'Doing' },
        ],
      })
    if (path === '/tasks') {
      return json({
        data: [
          task('301', {
            name: 'Plan the launch',
            html_notes:
              '<body>Plan <strong>this</strong> &amp; <a href="javascript:alert(1)">that</a><ul><li>one</li><li>two</li></ul></body>',
            assignee: { email: asanaEmail, name: 'Somebody' },
            tags: [{ name: 'Marketing' }],
            memberships: [{ project: { gid: '222' }, section: { name: 'Doing' } }],
            custom_fields: [{ name: 'Priority', enum_value: { name: 'High' } }],
            num_subtasks: 1,
            permalink_url: 'https://app.asana.com/0/222/301',
          }),
          // A part that is also in the project comes with its parent, once.
          task('401', { name: 'A part', parent: { gid: '301' } }),
          // A part whose parent lives in another project is a task of its own here.
          task('403', { name: 'A part from elsewhere', parent: { gid: '999' } }),
          task('302', {
            name: 'Shipped',
            completed: true,
            completed_at: '2026-10-04T10:00:00Z',
            memberships: [{ project: { gid: '222' }, section: { name: 'To do' } }],
          }),
        ],
        next_page: null,
      })
    }
    if (path === '/tasks/301') return json({ data: { memberships: [{ project: { gid: '222' } }] } })
    if (path === '/tasks/999') return json({ data: { memberships: [{ project: { gid: '555' } }] } })
    if (path === '/tasks/301/subtasks') return json({ data: [task('401', { name: 'A part', num_subtasks: 1 })] })
    if (path === '/tasks/401/subtasks') return json({ data: [task('402', { name: 'A part of a part' })] })
    if (/^\/tasks\/\d+\/stories$/.test(path)) {
      return json({
        data: path.includes('301')
          ? [
              { resource_subtype: 'section_changed', text: 'moved this to Doing', created_at: '2026-10-02T10:00:00Z' },
              {
                resource_subtype: 'comment_added',
                text: 'Looks good',
                created_at: '2026-10-02T11:00:00Z',
                created_by: { name: 'Gone Person' },
              },
            ]
          : [],
        next_page: null,
      })
    }
    if (path === '/attachments') {
      return json({
        data:
          url.searchParams.get('parent') === '301'
            ? [
                {
                  gid: 'a1',
                  name: 'shot.png',
                  host: 'asana',
                  download_url: 'https://asana-user-private-us-east-1.s3.amazonaws.com/assets/1?sig=x',
                },
                { gid: 'a2', name: 'doc', host: 'gdrive', download_url: 'https://evil.example/drive' },
                {
                  gid: 'a3',
                  name: 'trick.png',
                  host: 'asana',
                  download_url: 'https://asana-user-private-us-east-1.s3.amazonaws.com.evil.example/x',
                },
              ]
            : [],
      })
    }
    return new Response('{}', { status: 404 })
  }
  if (url.hostname.endsWith('.amazonaws.com')) {
    asked.push({ url: String(url), auth })
    return new Response(PNG, { status: 200, headers: { 'content-type': 'binary/octet-stream' } })
  }
  return linearFake(input, init)
}) as typeof fetch

test('a Jira project comes across with its numbers, epics, parts, sprints, comments and files', async () => {
  const me = await makeOwner()
  const colleague = await makeOwner()
  await owner`insert into membership (id, workspace_id, actor_id, role, joined_at) values (gen_random_uuid(), ${me.workspaceId}, ${colleague.ctx.actorId}, 'member', now())`
  // Jira hides the address, and a name is whatever somebody typed in Jira:
  // never given a task, nor the project, by it.
  await owner`update actor set name = 'Cole League Jira' where id = ${colleague.ctx.actorId}`

  // The site is Atlassian's, or the request goes nowhere.
  for (const site of ['evil.example', 'acme.atlassian.net.evil.example', 'acme.atlassian.net:8443', '127.0.0.1', 'x@acme.atlassian.net']) {
    assert.equal((await call('/import/jira/projects', me.token, { ...JIRA, site })).status, 400, site)
  }
  const listed = await call('/import/jira/projects', me.token, { ...JIRA, site: 'https://acme.atlassian.net/jira/your-work' })
  assert.equal(listed.status, 200)
  assert.deepEqual(
    ((await listed.json()) as { teams: { key: string }[] }).teams.map((t) => t.key),
    ['WEB'],
  )
  assert.equal((await call('/import/jira/projects', me.token, { ...JIRA, token: 'ATATT3xFfGF0wrongtoken0000000' })).status, 400)

  const started = await call('/import/jira', me.token, { ...JIRA, teams: ['10000', '99999'] })
  assert.equal(started.status, 202)
  const { id } = (await started.json()) as { id: string }
  assert.equal(await untilDone(id), 'done')

  const [project] = await owner<{ id: string; key: string }[]>`select id, key from project where import_id = ${id}`
  assert.equal(project!.key, 'WEB')
  const lists = await owner<{ name: string; finishes: boolean }[]>`
    select name, finishes from task_list where project_id = ${project!.id} and deleted_at is null order by sort_key`
  assert.deepEqual(
    lists.map((l) => l.name),
    ['To Do', 'In Progress', 'Done', 'Won’t Do'],
  )
  const tasks = await owner<
    {
      id: string
      number: number
      parent_id: string | null
      list: string
      priority: string | null
      assignee_ids: string[]
      cycle: string | null
      body: unknown
      completed_at: Date | null
    }[]
  >`
    select t.id, t.number, t.parent_id, l.name as list, t.priority::text, t.assignee_ids, c.name as cycle, t.body, t.completed_at
    from task t left join task_list l on l.id = t.list_id left join cycle c on c.id = t.cycle_id
    where t.project_id = ${project!.id} order by t.number`
  assert.deepEqual(
    tasks.map((t) => t.number),
    [1, 2, 3],
  )
  const [epic, story, sub] = tasks
  // An epic is a task; what is under it says so as a label.
  assert.equal(epic!.parent_id, null)
  assert.equal(story!.parent_id, null)
  assert.equal(sub!.parent_id, story!.id)
  assert.equal(sub!.list, 'Done')
  assert.ok(sub!.completed_at)
  assert.equal(story!.priority, 'urgent')
  assert.deepEqual(story!.assignee_ids, [])
  const members = await owner<{ actor_id: string }[]>`select actor_id from project_member where project_id = ${project!.id}`
  assert.deepEqual(
    members.map((m) => m.actor_id),
    [me.ctx.actorId],
  )
  assert.equal(story!.cycle, 'Sprint 7')
  const labels = await owner<{ name: string }[]>`
    select l.name::text from task_label tl join label l on l.id = tl.label_id where tl.task_id = ${story!.id} order by l.name`
  assert.deepEqual(
    labels.map((l) => l.name),
    ['Component: Web', 'Epic: Big launch', 'frontend'],
  )
  const body = JSON.stringify(story!.body)
  assert.match(body, /Created in Jira by Stranger/)
  assert.match(body, /Assigned in Jira to Cole League Jira/)
  // A file too large to bring is said, not dropped in silence.
  assert.match(body, /Not brought from Jira: huge\.zip/)
  assert.match(body, /"bold"/)
  // A link that is not to the web or an address is its words and no link.
  assert.ok(!body.includes('javascript'))
  assert.match(body, /"kind":"image"/)
  const comments = await owner<{ said_as: string }[]>`select said_as from comment where object_id = ${story!.id} order by created_at`
  assert.deepEqual(
    comments.map((c) => c.said_as),
    ['Stranger', 'Gone Person'],
  )
  // Only the site, and its file asked for as itself — no redirect to follow.
  const files = asked.filter((a) => a.url.includes('/attachment/content/'))
  assert.deepEqual(
    files.map((a) => a.url),
    ['https://acme.atlassian.net/rest/api/3/attachment/content/5?redirect=false'],
  )
  const [row] = await owner<{ key_enc: string | null; source: string }[]>`select key_enc, source from linear_import where id = ${id}`
  assert.deepEqual(row, { key_enc: null, source: 'jira' })
})

test('an Asana project comes across numbered, with sections, sub-tasks, comments and only Asana’s own files', async () => {
  const me = await makeOwner()
  const colleague = await makeOwner()
  await owner`insert into membership (id, workspace_id, actor_id, role, joined_at) values (gen_random_uuid(), ${me.workspaceId}, ${colleague.ctx.actorId}, 'member', now())`
  asanaEmail = (await owner<{ email: string }[]>`select email::text from app_user where actor_id = ${colleague.ctx.actorId}`)[0]!.email
  assert.equal((await call('/import/asana/projects', me.token, { token: 'not a token' })).status, 400)
  const listed = await call('/import/asana/projects', me.token, { token: ASANA })
  assert.deepEqual(((await listed.json()) as { teams: { id: string; issues: number }[] }).teams, [
    { id: '222', key: '', name: 'Launch', issues: 2 },
  ])
  // A project the token cannot see, or not an id at all, is not brought.
  assert.equal((await call('/import/asana', me.token, { token: ASANA, teams: ['../../x'] })).status, 400)
  const started = await call('/import/asana', me.token, { token: ASANA, teams: ['222'] })
  assert.equal(started.status, 202)
  const { id } = (await started.json()) as { id: string }
  assert.equal(await untilDone(id), 'done')

  const [project] = await owner<{ id: string; name: string }[]>`select id, name from project where import_id = ${id}`
  assert.equal(project!.name, 'Launch')
  const tasks = await owner<
    {
      id: string
      number: number
      title: string
      parent_id: string | null
      list: string
      priority: string | null
      assignee_ids: string[]
      body: unknown
      completed_at: Date | null
    }[]
  >`
    select t.id, t.number, t.title, t.parent_id, l.name as list, t.priority::text, t.assignee_ids, t.body, t.completed_at
    from task t left join task_list l on l.id = t.list_id
    where t.project_id = ${project!.id} order by t.number`
  // Each task and then its parts, numbered in that order.
  assert.deepEqual(
    tasks.map((t) => [t.number, t.title]),
    [
      [1, 'Plan the launch'],
      [2, 'A part'],
      [3, 'A part of a part'],
      [4, 'A part from elsewhere'],
      [5, 'Shipped'],
    ],
  )
  const [plan, part, deeper, elsewhere, shipped] = tasks
  assert.equal(elsewhere!.parent_id, null)
  assert.equal(part!.parent_id, plan!.id)
  assert.equal(deeper!.parent_id, plan!.id)
  assert.equal(plan!.list, 'Doing')
  assert.equal(plan!.priority, 'high')
  assert.deepEqual(plan!.assignee_ids, [colleague.ctx.actorId])
  assert.equal(shipped!.list, 'Done')
  assert.ok(shipped!.completed_at)
  const body = JSON.stringify(plan!.body)
  assert.match(body, /Imported from Asana/)
  assert.match(body, /"bold"/)
  assert.match(body, /&/)
  assert.ok(!body.includes('javascript'))
  assert.match(body, /"kind":"image"/)
  // A comment comes; a story of what moved stays in Asana.
  const comments = await owner<{ said_as: string }[]>`select said_as from comment where object_id = ${plan!.id}`
  assert.deepEqual(
    comments.map((c) => c.said_as),
    ['Gone Person'],
  )
  // Asana's own bucket only, with no token sent there; Drive and a lookalike host never asked.
  const outside = asked.filter(
    (a) => !a.url.startsWith('https://app.asana.com/') && !a.url.includes('atlassian') && !a.url.includes('linear.app'),
  )
  assert.deepEqual(
    outside.map((a) => [new URL(a.url).hostname, a.auth]),
    [['asana-user-private-us-east-1.s3.amazonaws.com', null]],
  )
  assert.equal(
    asked.filter((a) => a.url.startsWith('https://app.asana.com/')).every((a) => a.auth === `Bearer ${ASANA}`),
    true,
  )

  // Again is not twice: the same project is taken up and nothing comes again —
  // known by Asana's ids, not by where they stood.
  const files = (await owner<{ n: number }[]>`select count(*)::int as n from file where project_id = ${project!.id}`)[0]!.n
  const again = (await (await call('/import/asana', me.token, { token: ASANA, teams: ['222'] })).json()) as { id: string }
  assert.equal(await untilDone(again.id), 'done')
  const count = await owner<{ n: number }[]>`select count(*)::int as n from task where project_id = ${project!.id}`
  assert.equal(count[0]!.n, 5)
  assert.equal((await owner<{ n: number }[]>`select count(*)::int as n from file where project_id = ${project!.id}`)[0]!.n, files)
  assert.equal(
    (
      await owner<
        { n: number }[]
      >`select count(*)::int as n from project where workspace_id = ${me.workspaceId} and imported_from = 'asana:222'`
    )[0]!.n,
    1,
  )
})
