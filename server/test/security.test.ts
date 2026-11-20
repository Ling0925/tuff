import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { app } from '../src/http/routes.js'
import postgres from 'postgres'
import { closeDb, makeOwner, addPerson, makeProject, bearerFor, withActor, withoutActor, uuidv7 } from './helpers.js'
import { closeRealtime } from '../src/realtime.js'
import { issueApiToken } from '../src/auth/flows.js'
import { outbox } from '../src/mail.js'

/* As the tables' owner, for the columns the application may not touch. */
const owner = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} })

after(async () => {
  await owner.end()
  await closeRealtime()
  await closeDb()
})

const req = (method: string, path: string, token: string, body?: unknown) =>
  app.request(path, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

test('a member not on a project cannot put anybody on it, themselves included', async () => {
  const { ctx, workspaceId } = await makeOwner()
  const secret = await makeProject(ctx, workspaceId, 'Private')
  const m = await addPerson(ctx, workspaceId, 'member')
  const token = await bearerFor(m.actorId, workspaceId)
  const r = await req('POST', `/api/projects/${secret}/members`, token, { actor_id: m.actorId })
  assert.equal(r.status, 404)
  const tasks = (await (await req('GET', `/api/projects/${secret}/tasks`, token)).json()) as { tasks?: unknown[] }
  assert.equal((tasks.tasks ?? []).length, 0)
})

test('an invitation cannot carry a project the inviter is not on, nor rights only its runner gives', async () => {
  const { ctx, workspaceId } = await makeOwner()
  const theirs = await makeProject(ctx, workspaceId, 'Not mine')
  const mine = await makeProject(ctx, workspaceId, 'Mine')
  /* Members may invite here, so the switch is not what stops it. */
  await req('PATCH', '/api/workspace', await bearerFor(ctx.actorId, workspaceId), { who_invites_people: 'members' })
  const m = await addPerson(ctx, workspaceId, 'member', [mine])
  const token = await bearerFor(m.actorId, workspaceId)
  const off = await req('POST', '/api/invites', token, { role: 'member', project_ids: [theirs], rights: [] })
  assert.equal(off.status, 404)
  const runs = await req('POST', '/api/invites', token, { role: 'member', project_ids: [mine], rights: ['manage'] })
  assert.equal(runs.status, 403)
})

test("the feed shows a project's history only to somebody who can see the project", async () => {
  const { ctx, workspaceId, token: owner } = await makeOwner()
  const secret = await makeProject(ctx, workspaceId, 'Hush')
  await req('POST', `/api/projects/${secret}/tasks`, owner, { title: 'Codename Falcon' })
  const m = await addPerson(ctx, workspaceId, 'member')
  const token = await bearerFor(m.actorId, workspaceId)
  const feed = (await (await req('GET', `/api/activity?project=${secret}`, token)).json()) as { events?: unknown[] }
  assert.equal((feed.events ?? []).length, 0)
})

/* The third audit. */
test('a task is given only to somebody on its project, not to an id from anywhere', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const project = await makeProject(ctx, workspaceId, 'Given')
  const on = await addPerson(ctx, workspaceId, 'member', [project])
  const off = await addPerson(ctx, workspaceId, 'member')
  const elsewhere = await makeOwner()
  for (const [who, status] of [
    [on.actorId, 201],
    [ctx.actorId, 201],
    [off.actorId, 400],
    [elsewhere.ctx.actorId, 400],
  ] as const) {
    const r = await req('POST', `/api/projects/${project}/tasks`, token, { title: `For ${who}`, assignee_id: who })
    assert.equal(r.status, status, who)
  }
  const made = (await (await req('POST', `/api/projects/${project}/tasks`, token, { title: 'Moved on' })).json()) as { id: string }
  assert.equal((await req('PATCH', `/api/tasks/${made.id}`, token, { assignee_id: elsewhere.ctx.actorId })).status, 400)
  assert.equal((await req('PATCH', `/api/tasks/${made.id}`, token, { assignee_id: on.actorId })).status, 200)
})

test('a token removes nothing somebody said, and turns no notifications on', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const project = await makeProject(ctx, workspaceId, 'Kept')
  const tool = await issueApiToken(ctx.actorId, workspaceId, 'agent')
  const post = (await (
    await req('POST', `/api/projects/${project}/posts`, token, {
      title: 'Plan',
      body: { type: 'doc', content: [] },
    })
  ).json()) as { id: string }
  const task = (await (await req('POST', `/api/projects/${project}/tasks`, token, { title: 'Talked about' })).json()) as { id: string }
  const comment = (await (
    await req('POST', `/api/tasks/${task.id}/comments`, token, {
      body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'mine' }] }] },
    })
  ).json()) as { id: string }
  assert.equal((await req('DELETE', `/api/posts/${post.id}`, tool)).status, 403)
  assert.equal((await req('DELETE', `/api/comments/${comment.id}`, tool)).status, 403)
  assert.equal(
    (
      await req('POST', '/api/push', tool, {
        endpoint: 'https://fcm.googleapis.com/fcm/send/x',
        keys: { p256dh: 'p', auth: 'a' },
      })
    ).status,
    403,
  )
  // The person themselves, signed in, still can.
  assert.equal((await req('DELETE', `/api/comments/${comment.id}`, token)).status, 200)
  assert.equal((await req('DELETE', `/api/posts/${post.id}`, token)).status, 200)
})

/* ------------------------------------------------ the fourth audit */

const upload = async (path: string, token: string, name: string) => {
  const form = new FormData()
  form.append('file', new File([new Uint8Array([104, 105])], name, { type: 'text/plain' }))
  const r = await app.request(path, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form })
  assert.equal(r.status, 201, path)
  return ((await r.json()) as { id: string }).id
}

/* A channel with chosen people, as the room screen makes one. */
async function chosen(ownerId: string, ws: string, project: string, people: string[]) {
  const id = uuidv7()
  await withActor(ownerId, async (tx) => {
    await tx`insert into conversation (id, workspace_id, project_id, name) values (${id}, ${ws}, ${project}, 'Just us')`
    for (const who of people) {
      await tx`
        insert into conversation_member (id, workspace_id, conversation_id, actor_id, joined_at)
        values (${uuidv7()}, ${ws}, ${id}, ${who}, now())`
    }
  })
  return id
}

test("a shared document hands out its own project's pictures, and nothing else in the workspace", async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const mine = await makeProject(ctx, workspaceId, 'Mine')
  const other = await makeProject(ctx, workspaceId, 'Other')
  const room = await chosen(ctx.actorId, workspaceId, mine, [ctx.actorId])
  const own = await upload(`/api/projects/${mine}/uploads`, token, 'own.txt')
  const elsewhere = await upload(`/api/projects/${other}/uploads`, token, 'elsewhere.txt')
  const said = await upload(`/api/conversations/${room}/uploads`, token, 'said.txt')
  const node = (fileId: string) => ({ type: 'attachment', attrs: { kind: 'image', fileId } })
  const { id } = (await (
    await req('POST', `/api/projects/${mine}/files`, token, {
      name: 'Shared',
      body: { type: 'doc', content: [node(own), node(elsewhere), node(said)] },
    })
  ).json()) as { id: string }
  const { token: link } = (await (await req('PUT', `/api/files/${id}/public`, token, { public: true })).json()) as { token: string }
  const page = (await (await app.request(`/api/public/docs/${link}`)).json()) as { pictures: Record<string, unknown> }
  assert.deepEqual(Object.keys(page.pictures), [own])
})

test("a file sent in a channel with chosen people is theirs, not the whole project's", async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const p = await makeProject(ctx, workspaceId, 'Acme')
  const sam = await addPerson(ctx, workspaceId, 'member', [p])
  const nour = await addPerson(ctx, workspaceId, 'member', [p])
  const samT = await bearerFor(sam.actorId, workspaceId)
  const nourT = await bearerFor(nour.actorId, workspaceId)
  const few = await chosen(ctx.actorId, workspaceId, p, [ctx.actorId, sam.actorId])
  const contract = await upload(`/api/conversations/${few}/uploads`, token, 'contract.txt')

  const open = (t: string) => req('GET', `/api/files/${contract}/url`, t)
  assert.equal((await open(samT)).status, 200)
  assert.equal((await open(nourT)).status, 404)
  const listed = async (t: string) =>
    ((await (await req('GET', `/api/projects/${p}/files`, t)).json()) as { files: { id: string }[] }).files.map((f) => f.id)
  assert.ok((await listed(samT)).includes(contract))
  assert.ok(!(await listed(nourT)).includes(contract))
  const found = (await (await req('GET', '/api/search?q=contract', nourT)).json()) as Record<string, unknown>
  assert.ok(!JSON.stringify(found).includes(contract))

  // A room nobody is chosen for is the whole project's, as it was.
  const team = uuidv7()
  await withActor(
    ctx.actorId,
    (tx) => tx`insert into conversation (id, workspace_id, project_id, name) values (${team}, ${workspaceId}, ${p}, 'Team')`,
  )
  const brief = await upload(`/api/conversations/${team}/uploads`, token, 'brief.txt')
  assert.equal((await req('GET', `/api/files/${brief}/url`, nourT)).status, 200)

  // And @everyone in the closed one tells its people, not the project.
  const told = await withActor(ctx.actorId, (tx) => tx<{ actor_id: string }[]>`select actor_id from room_people(${few})`)
  assert.deepEqual(told.map((r) => r.actor_id).sort(), [ctx.actorId, sam.actorId].sort())
})

test('a token takes a document off the web but never puts one on it', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const p = await makeProject(ctx, workspaceId, 'Acme')
  const tool = await issueApiToken(ctx.actorId, workspaceId, 'agent')
  const { id } = (await (
    await req('POST', `/api/projects/${p}/files`, token, {
      name: 'Notes',
      body: { type: 'doc', content: [] },
    })
  ).json()) as { id: string }
  assert.equal((await req('PUT', `/api/files/${id}/public`, tool, { public: true })).status, 403)
  assert.equal((await req('PUT', `/api/files/${id}/public`, token, { public: true })).status, 200)
  assert.equal((await req('PUT', `/api/files/${id}/public`, tool, { public: false })).status, 200)
})

test("where the owner keeps Members to themselves, a colleague's history and hours are too", async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const p = await makeProject(ctx, workspaceId, 'Acme')
  const sam = await addPerson(ctx, workspaceId, 'member', [p])
  const samT = await bearerFor(sam.actorId, workspaceId)
  await req('POST', '/api/time', token, { project_id: p, minutes: 30, spent_on: new Date().toISOString().slice(0, 10) })
  await req('POST', '/api/time', samT, { project_id: p, minutes: 15, spent_on: new Date().toISOString().slice(0, 10) })
  await withActor(
    ctx.actorId,
    (tx) => tx`update workspace set settings = settings || '{"who_sees_members":"owner"}' where id = ${workspaceId}`,
  )

  assert.equal((await req('GET', `/api/activity?actor=${ctx.actorId}`, samT)).status, 403)
  assert.equal((await req('GET', `/api/activity?actor=${ctx.actorId}&project=${p}`, samT)).status, 200)
  assert.equal((await req('GET', `/api/activity?actor=${sam.actorId}`, samT)).status, 200)
  const hours = (await (await req('GET', '/api/time', samT)).json()) as { time: { actor_id: string }[] }
  assert.deepEqual([...new Set(hours.time.map((r) => r.actor_id))], [sam.actorId])
  const project = (await (await req('GET', `/api/time?project=${p}`, samT)).json()) as { time: { actor_id: string }[] }
  assert.equal(new Set(project.time.map((r) => r.actor_id)).size, 2)
})

test('an address proved by its owner takes back the factor, tokens and phones its earlier holder made', async () => {
  const { ctx, workspaceId } = await makeOwner()
  await owner`update app_user set email_verified_at = null, totp_enabled = true, totp_secret_enc = 'sealed' where actor_id = ${ctx.actorId}`
  await owner`insert into recovery_code (id, actor_id, code_hash) values (${uuidv7()}, ${ctx.actorId}, 'h')`
  const tool = await issueApiToken(ctx.actorId, workspaceId, 'agent')
  await owner`
    insert into push_subscription (id, workspace_id, actor_id, endpoint, p256dh, auth)
    values (${uuidv7()}, ${workspaceId}, ${ctx.actorId}, ${`https://fcm.googleapis.com/fcm/send/${uuidv7()}`}, 'p', 'a')`

  await withoutActor((tx) => tx`select auth_claim_email(${ctx.actorId})`)

  const [u] = await owner<{ totp_enabled: boolean; totp_secret_enc: string | null; verified: boolean }[]>`
    select totp_enabled, totp_secret_enc, email_verified_at is not null as verified from app_user where actor_id = ${ctx.actorId}`
  assert.deepEqual(u, { totp_enabled: false, totp_secret_enc: null, verified: true })
  assert.equal((await owner`select 1 from recovery_code where actor_id = ${ctx.actorId}`).length, 0)
  assert.equal((await owner`select 1 from push_subscription where actor_id = ${ctx.actorId}`).length, 0)
  assert.equal((await req('GET', '/api/me', tool)).status, 401)
})

test('a device stops hearing the account when its last session ends', async () => {
  const { ctx, workspaceId } = await makeOwner()
  const device = `dev-${uuidv7()}`
  await owner`update refresh_session set device = ${device} where actor_id = ${ctx.actorId}`
  const push = (d: string | null) => owner`
    insert into push_subscription (id, workspace_id, actor_id, endpoint, p256dh, auth, device)
    values (${uuidv7()}, ${workspaceId}, ${ctx.actorId}, ${`https://fcm.googleapis.com/fcm/send/${uuidv7()}`}, 'p', 'a', ${d})`
  await push(device)
  await push(`other-${uuidv7()}`)
  const left = async () =>
    (await owner<{ device: string }[]>`select device from push_subscription where actor_id = ${ctx.actorId}`).map((r) => r.device)

  // Ended from Account, every session of that browser.
  const [s] = await owner<{ id: string }[]>`select id from refresh_session where actor_id = ${ctx.actorId} limit 1`
  await withoutActor((tx) => tx`select auth_revoke_session(${ctx.actorId}, ${s!.id})`)
  const after = await left()
  assert.ok(!after.includes(device))
  assert.equal(after.length, 1, 'another device, still signed in elsewhere or not ours to judge, is left')
})

test('an account with nothing to type hands its workspace over only with a code from its inbox', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const kit = await addPerson(ctx, workspaceId, 'member')
  await owner`update app_user set password_hash = null where actor_id = ${ctx.actorId}`
  const hand = (code?: string) => req('POST', '/api/workspace/transfer', token, { to: kit.actorId, ...(code ? { code } : {}) })

  // A session alone is a laptop left open.
  assert.equal((await hand()).status, 403)
  assert.equal((await req('POST', '/api/me/inbox-code', token, {})).status, 202)
  const [me] = await owner<{ email: string }[]>`select email::text from app_user where actor_id = ${ctx.actorId}`
  const mail = [...outbox].reverse().find((m) => m.to === me!.email)!
  const code = /(\d{6}) is your Tuff code/.exec(mail.subject)![1]!
  assert.equal((await hand(code === '000000' ? '111111' : '000000')).status, 403)
  assert.equal((await hand(code)).status, 200)
})
