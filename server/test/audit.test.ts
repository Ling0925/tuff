import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import postgres from 'postgres'
import { app } from '../src/http/routes.js'
import { closeRealtime } from '../src/realtime.js'
import { withActor } from '../src/db.js'
import { addPerson, bearerFor, closeDb, makeOwner, makeProject } from './helpers.js'
import { issueApiToken } from '../src/auth/flows.js'
import { issueAccessToken } from '../src/auth/tokens.js'

/* As the tables' owner, for what only a fixture writes. */
const owner = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} })

after(async () => {
  await owner.end()
  await closeRealtime()
  await closeDb()
})

async function send(method: string, path: string, token: string | null, body?: unknown) {
  const r = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, unknown> }
}
type Line = {
  id: string
  kind: string
  actor_name: string | null
  subject_id: string | null
  subject_name: string | null
  project_name: string | null
}
const lines = (b: Record<string, unknown>) => b.events as Line[]

/*
 * Who did what across the workspace, for its owner.
 */
test('the audit log reads the security record and the workspace’s own actions as one list, for the owner alone', async () => {
  const boss = await makeOwner()
  const project = await makeProject(boss.ctx, boss.workspaceId, 'Bridge')
  const sam = await addPerson(boss.ctx, boss.workspaceId, 'member', [project])
  await owner`update actor set name = 'Sam' where id = ${sam.actorId}`

  // Rights, a switch, a project taken off and put in the bin, Sam taken out.
  assert.equal((await send('PATCH', `/api/people/${sam.actorId}`, boss.token, { may_create_projects: false })).status, 200)
  assert.equal((await send('PATCH', '/api/workspace', boss.token, { who_invites_people: 'members' })).status, 200)
  assert.equal((await send('DELETE', `/api/projects/${project}/members/${sam.actorId}`, boss.token)).status, 200)
  assert.equal((await send('DELETE', `/api/people/${sam.actorId}`, boss.token)).status, 200)
  assert.equal((await send('DELETE', `/api/projects/${project}`, boss.token)).status, 200)
  // And the work itself, which is the project's history and not the log's.
  await owner`
    insert into activity_event (id, workspace_id, project_id, actor_id, action)
    values (gen_random_uuid(), ${boss.workspaceId}, ${project}, ${boss.ctx.actorId}, 'task.update')`

  const all = await send('GET', '/api/audit', boss.token)
  assert.equal(all.status, 200)
  const kinds = lines(all.body).map((l) => l.kind)
  for (const k of ['register', 'people.rights', 'workspace.settings', 'project.member.remove', 'people.remove', 'project.delete']) {
    assert.ok(kinds.includes(k), `${k} is in the log: ${kinds.join(', ')}`)
  }
  assert.ok(!kinds.includes('task.update'), 'the work is not')

  // Said with whom it was done to, and the project by name — in the bin.
  const removed = lines(all.body).find((l) => l.kind === 'people.remove')!
  assert.equal(removed.subject_id, sam.actorId)
  assert.equal(removed.subject_name, 'Sam')
  assert.equal(lines(all.body).find((l) => l.kind === 'project.delete')!.project_name, 'Bridge')
  assert.equal(lines(all.body).find((l) => l.kind === 'project.member.remove')!.subject_name, 'Sam')

  // Narrowed by kind.
  const rights = await send('GET', '/api/audit?type=rights', boss.token)
  assert.deepEqual(
    lines(rights.body).map((l) => l.kind),
    ['people.rights'],
  )
  const deletions = await send('GET', '/api/audit?type=deletions', boss.token)
  assert.deepEqual(
    lines(deletions.body).map((l) => l.kind),
    ['project.delete'],
  )

  // Narrowed to a person: what was done to Sam, though Sam did nothing.
  const aboutSam = await send('GET', `/api/audit?who=${sam.actorId}`, boss.token)
  assert.deepEqual(
    lines(aboutSam.body)
      .map((l) => l.kind)
      .sort(),
    ['people.remove', 'people.rights', 'project.member.remove'],
  )

  // Sam is still someone it can be narrowed to, said as gone.
  const people = await send('GET', '/api/audit/people', boss.token)
  const listed = (people.body.people as { actor_id: string; here: boolean }[]).find((p) => p.actor_id === sam.actorId)
  assert.equal(listed?.here, false)

  // Asked wrongly, refused.
  assert.equal((await send('GET', '/api/audit?type=everything', boss.token)).status, 400)
  assert.equal((await send('GET', '/api/audit?who=sam', boss.token)).status, 400)
  assert.equal((await send('GET', '/api/audit?cursor=yesterday', boss.token)).status, 400)

  // A member is not shown it, by the server or by the database.
  const kim = await addPerson(boss.ctx, boss.workspaceId, 'member', [])
  const kimToken = await bearerFor(kim.actorId, boss.workspaceId)
  assert.equal((await send('GET', '/api/audit', kimToken)).status, 403)
  assert.equal((await send('GET', '/api/audit/people', kimToken)).status, 403)
  const asKim = await withActor(kim.actorId, boss.workspaceId, (tx) => tx`select * from audit_page(null, null, null, null, 50)`)
  assert.equal(asKim.length, 0)

  // Another workspace's owner reads their own and nothing of this one.
  const other = await makeOwner()
  const theirs = await send('GET', '/api/audit', other.token)
  assert.ok(lines(theirs.body).every((l) => !lines(all.body).some((m) => m.id === l.id)))
})

test('the audit log is read in a person’s own session, never through a token', async () => {
  const boss = await makeOwner()
  // The owner's own MCP token, and the tokens GitHub's and an import's work act under.
  const tool = await issueApiToken(boss.ctx.actorId, boss.workspaceId, 'agent')
  const github = await issueAccessToken({ sub: boss.ctx.actorId, workspace_id: boss.workspaceId, via: 'github' })
  const imported = await issueAccessToken({
    sub: boss.ctx.actorId,
    workspace_id: boss.workspaceId,
    via: 'import',
    imp: '01900000-0000-7000-8000-000000000001',
  })
  for (const token of [tool, github, imported]) {
    assert.equal((await send('GET', '/api/audit', token)).status, 403)
    assert.equal((await send('GET', '/api/audit/people', token)).status, 403)
  }
  assert.equal((await send('GET', '/api/audit', boss.token)).status, 200)
  // Nor can one of them be traded for a session that could.
  const other = await makeOwner()
  await owner`
    insert into membership (id, workspace_id, actor_id, role, joined_at)
    values (gen_random_uuid(), ${other.workspaceId}, ${boss.ctx.actorId}, 'member', now())`
  for (const token of [tool, github, imported]) {
    assert.equal((await send('POST', `/api/workspaces/${other.workspaceId}/enter`, token)).status, 403)
  }
  // A session that names none — signed by us, from no sign-in — is refused too.
  const bare = await bearerFor(boss.ctx.actorId, boss.workspaceId)
  assert.equal((await send('GET', '/api/audit', bare)).status, 403)
  assert.equal((await send('POST', `/api/workspaces/${other.workspaceId}/enter`, bare)).status, 403)

  // A cursor that is not one this answered with is refused, not a 500.
  for (const bad of ['1', 'yesterday', '2026-11-09T10:00:00Z_x', '2026-13-45T99:99:99Z', '2026-11-09T10:00:00Z_a_b']) {
    assert.equal((await send('GET', `/api/audit?cursor=${encodeURIComponent(bad)}`, boss.token)).status, 400, bad)
  }
})

test('taking an invitation is a sign-in written in the workspace it is to, once', async () => {
  const boss = await makeOwner()
  const into = await send('POST', '/api/invites', boss.token, { role: 'member', project_ids: [], rights: [] })
  const s = Date.now().toString(36)
  const joined = await send('POST', `/auth/invite/${into.body.token as string}/accept`, null, {
    name: 'Ivy',
    email: `ivy${s}@example.com`,
    password: 'correct-horse-battery-staple',
  })
  assert.equal(joined.status, 200, JSON.stringify(joined.body))
  const lines = await owner<{ workspace_id: string }[]>`
    select workspace_id from security_event
    where actor_id = ${joined.body.actor_id as string} and kind = 'login' and meta->>'method' = 'invite'`
  assert.deepEqual(
    lines.map((l) => l.workspace_id),
    [boss.workspaceId],
  )
})

test('an owner of two workspaces reads only the one their session is in, sign-ins included', async () => {
  const a = await makeOwner()
  const b = await makeOwner()
  // A's owner is handed B as well — a fixture, so they own both.
  await owner`update membership set role = 'member' where workspace_id = ${b.workspaceId} and actor_id = ${b.ctx.actorId}`
  await owner`
    insert into membership (id, workspace_id, actor_id, role, joined_at)
    values (gen_random_uuid(), ${b.workspaceId}, ${a.ctx.actorId}, 'owner', now())`

  // Signing in opens A; entering B is a session opened there, written there.
  const entered = await send('POST', `/api/workspaces/${b.workspaceId}/enter`, a.token)
  assert.equal(entered.status, 200)
  const inB = entered.body.access_token as string

  const readA = lines((await send('GET', '/api/audit?type=sign_ins', a.token)).body)
  const readB = lines((await send('GET', '/api/audit?type=sign_ins', inB)).body)
  // Every line A's session reads is A's, and every line B's is B's.
  const [wrong] = await owner<{ n: number }[]>`
    select count(*)::int as n from security_event
    where (id = any(${readA.map((l) => l.id)}::uuid[]) and workspace_id <> ${a.workspaceId})
       or (id = any(${readB.map((l) => l.id)}::uuid[]) and workspace_id <> ${b.workspaceId})`
  assert.equal(wrong!.n, 0)
  // And the session opened into B is B's sign-in line, not A's.
  type Signed = Line & { actor_id: string; meta: { method?: string } | null }
  const switched = (l: Line) => l.kind === 'login' && (l as Signed).actor_id === a.ctx.actorId && (l as Signed).meta?.method === 'switch'
  assert.equal(readB.filter(switched).length, 1, JSON.stringify(readB))
  assert.equal(readA.filter(switched).length, 0, JSON.stringify(readA))

  // Asked of the database directly by somebody who owns neither, nothing.
  const kim = await addPerson(b.ctx, b.workspaceId, 'member', [])
  const asKim = await withActor(kim.actorId, b.workspaceId, (tx) => tx`select * from audit_page(null, null, null, null, 50)`)
  assert.equal(asKim.length, 0)
})

test('the audit log pages by cursor without skipping or repeating lines written in one moment', async () => {
  const boss = await makeOwner()
  // Twenty-five lines, five to a moment.
  await owner`
    insert into security_event (id, workspace_id, actor_id, kind, at)
    select gen_random_uuid(), ${boss.workspaceId}, ${boss.ctx.actorId}, 'login',
           now() - ((i / 5) || ' seconds')::interval
    from generate_series(0, 24) i`
  const seen: string[] = []
  let cursor: string | null = null
  for (let turn = 0; turn < 10; turn++) {
    const r = await send('GET', `/api/audit?type=sign_ins&limit=4${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, boss.token)
    assert.equal(r.status, 200)
    seen.push(...lines(r.body).map((l) => l.id))
    cursor = (r.body.next_cursor as string | null) ?? null
    if (!cursor) break
  }
  // The twenty-five, and registering's own sign-in line if it wrote one.
  const [counted] = await owner<{ n: number }[]>`
    select count(*)::int as n from security_event where workspace_id = ${boss.workspaceId}
      and kind = any(${['login', 'register', 'password_changed', 'password_reset', 'email_changed', 'token_issued', 'token_revoked']})`
  assert.equal(seen.length, counted!.n)
  assert.equal(new Set(seen).size, seen.length)
})
