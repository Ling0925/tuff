import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import postgres from 'postgres'
import { app } from '../src/http/routes.js'
import { closeRealtime } from '../src/realtime.js'
import { startSession } from '../src/auth/flows.js'
import { hashPassword } from '../src/auth/crypto.js'
import { closeDb, makeOwner, makeProject, stamp } from './helpers.js'

/*
 * A session in no workspace.
 * Somebody whose last workspace is behind them can sign in, see their
 * invitations, make a workspace or join one, and reach nothing else.
 */

const owner = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} })
after(async () => {
  await owner.end()
  await closeRealtime()
  await closeDb()
})

const PASSWORD = 'correct-horse-battery-staple'
async function send(method: string, path: string, token: string | null, body?: unknown) {
  const r = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, unknown> }
}
const code = (r: { body: Record<string, unknown> }) => (r.body.error as { code?: string } | undefined)?.code

function totp(secret: string, step = 0): string {
  const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const ch of secret) bits += B32.indexOf(ch).toString(2).padStart(5, '0')
  const bytes: number[] = []
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2))
  const buf = Buffer.alloc(8)
  buf.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 1000 / 30) + step))
  const mac = createHmac('sha1', Buffer.from(bytes)).update(buf).digest()
  const offset = mac[mac.length - 1]! & 0x0f
  return String((mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0')
}

/* Somebody who joined by an invitation, proved their address, and left: in no workspace. */
async function leftEverything(boss: Awaited<ReturnType<typeof makeOwner>>, name: string) {
  const email = `${name.toLowerCase()}${stamp()}@example.com`
  const invite = await send('POST', '/api/invites', boss.token, { role: 'member', project_ids: [], rights: [] })
  const joined = await send('POST', `/auth/invite/${invite.body.token as string}/accept`, null, { name, email, password: PASSWORD })
  assert.equal(joined.status, 200, JSON.stringify(joined.body))
  const actor = joined.body.actor_id as string
  await owner`update app_user set email_verified_at = now(), password_hash = ${await hashPassword(PASSWORD)} where actor_id = ${actor}`
  const session = await startSession(actor, boss.workspaceId, {}, null)
  return { email, actor, token: session.access_token }
}

test('an account in no workspace signs in, through the second factor, and reaches its own short list and nothing else', async () => {
  const boss = await makeOwner()
  const project = await makeProject(boss.ctx, boss.workspaceId, 'Theirs')
  const ray = await leftEverything(boss, 'Ray')
  // A second factor, so signing in goes through its step.
  const begun = await send('POST', '/api/2fa/begin', ray.token, { password: PASSWORD })
  assert.equal(begun.status, 200, JSON.stringify(begun.body))
  const secret = begun.body.secret as string
  const enabled = await send('POST', '/api/2fa/enable', ray.token, { code: totp(secret) })
  assert.equal(enabled.status, 200)
  const recovery = enabled.body.recovery_codes as string[]

  // Leaving the last workspace lands in none.
  const left = await send('POST', '/api/me/leave', ray.token)
  assert.equal(left.status, 200, JSON.stringify(left.body))
  assert.equal(left.body.workspace, null)
  const nowhere = left.body.session as { access_token: string; refresh_token: string; workspace_id: null; nowhere: true }
  assert.deepEqual([nowhere.workspace_id, nowhere.nowhere], [null, true])
  const t = nowhere.access_token

  const me = await send('GET', '/api/me', t)
  assert.equal(me.status, 200)
  assert.deepEqual([me.body.nowhere, me.body.workspace, me.body.role, me.body.email], [true, null, null, ray.email])
  assert.deepEqual(me.body.can, ['workspace.create'])

  // Every workspace route refuses it.
  for (const [method, path] of [
    ['GET', '/api/projects'],
    ['GET', `/api/projects/${project}`],
    ['POST', '/api/projects'],
    ['GET', `/api/projects/${project}/tasks`],
    ['GET', '/api/tasks/00000000-0000-7000-8000-000000000000'],
    ['GET', '/api/people'],
    ['GET', '/api/conversations'],
    ['GET', '/api/search?q=a'],
    ['GET', `/api/projects/${project}/files`],
    ['GET', '/api/tokens'],
    ['POST', '/api/tokens'],
    ['GET', '/api/agents'],
    ['GET', '/api/inbox'],
    ['GET', '/api/workspaces'],
    ['GET', '/api/me/export'],
    ['POST', `/api/workspaces/${boss.workspaceId}/enter`],
    ['POST', '/api/me/leave'],
  ] as const) {
    const r = await send(method, path, t, method === 'POST' ? {} : undefined)
    assert.deepEqual([r.status, code(r)], [403, 'no_workspace'], `${method} ${path}`)
  }

  // Signing in: the password, then the code, then — for a client that can
  // show the screen — a session for nowhere. One that cannot is told why.
  const pass = await send('POST', '/auth/login', null, { email: ray.email, password: PASSWORD, nowhere: true })
  assert.deepEqual([pass.status, code(pass)], [401, 'totp_required'])
  // Each code is taken once: the next one, then a recovery code.
  const app_ = await send('POST', '/auth/login', null, { email: ray.email, password: PASSWORD, totp: totp(secret, 1) })
  assert.deepEqual([app_.status, code(app_)], [403, 'no_workspace'])
  const web = await send('POST', '/auth/login', null, { email: ray.email, password: PASSWORD, totp: recovery[0], nowhere: true })
  assert.equal(web.status, 200, JSON.stringify(web.body))
  assert.deepEqual([web.body.workspace_id, web.body.nowhere], [null, true])
  // A wrong password learns nothing.
  const wrong = await send('POST', '/auth/login', null, { email: ray.email, password: 'not-the-password-at-all', nowhere: true })
  assert.equal(wrong.status, 401)

  // Renewed as it was.
  const renewed = await send('POST', '/auth/refresh', null, { refresh_token: nowhere.refresh_token })
  assert.equal(renewed.status, 200)
  assert.equal(renewed.body.nowhere, true)
  const t2 = renewed.body.access_token as string

  // Invited again, by address: the invitation waits on the screen.
  const again = await send('POST', '/api/invites', boss.token, { role: 'member', email: ray.email, project_ids: [], rights: [] })
  assert.ok(again.status < 300, JSON.stringify(again.body))
  const waiting = await send('GET', '/api/me/invitations', t2)
  const listed = waiting.body.invitations as { id: string; workspace_name: string; token_hash?: string }[]
  assert.equal(listed.length, 1)
  assert.equal(listed[0]!.token_hash, undefined)
  // Somebody else's invitation is not theirs to take.
  const other = await makeOwner()
  const elsewhere = await send('POST', '/api/invites', other.token, {
    role: 'member',
    email: `nobody${stamp()}@example.com`,
    project_ids: [],
    rights: [],
  })
  assert.equal((await send('POST', `/api/me/invitations/${elsewhere.body.id as string}/accept`, t2)).status, 404)

  // A workspace of their own, made from here, is entered, and the session
  // for nowhere it was made from ends — its renewal with it.
  const made = await send('POST', '/api/workspaces', t2, { name: `Ray ${stamp().slice(0, 4)}` })
  assert.equal(made.status, 201, JSON.stringify(made.body))
  const mine = await send('GET', '/api/me', made.body.access_token as string)
  assert.equal(mine.body.role, 'owner')
  assert.equal((await send('GET', '/api/me', t2)).status, 401)
  assert.equal((await send('POST', '/auth/refresh', null, { refresh_token: renewed.body.refresh_token })).status, 401)

  // And the invitation, taken from the other session for nowhere, enters
  // that one, and ends it too.
  const t3 = web.body.access_token as string
  const took = await send('POST', `/api/me/invitations/${listed[0]!.id}/accept`, t3)
  assert.equal(took.status, 200, JSON.stringify(took.body))
  assert.equal(took.body.workspace_id, boss.workspaceId)
  assert.equal((await send('GET', `/api/projects/${project}`, took.body.access_token as string)).status, 404)
  assert.equal((await send('GET', '/api/projects', took.body.access_token as string)).status, 200)
  assert.equal((await send('GET', '/api/me', t3)).status, 401)
})

test('a session for nowhere is held to the person’s ceiling, and asks only for deleting’s code', async () => {
  const boss = await makeOwner()
  const sam = await leftEverything(boss, 'Sam')
  const left = await send('POST', '/api/me/leave', sam.token)
  const t = (left.body.session as { access_token: string }).access_token
  // A password account is never mailed a code, whatever it asks it for.
  const asked = await send('POST', '/api/me/inbox-code', t, { for: 'twofa' })
  assert.equal(asked.status, 400)
  assert.equal((await send('GET', '/api/me', t)).status, 200)
  // The minute's allowance spent: refused, as any other request of theirs is.
  await owner`select count(*) from (select rate_spend(${`a:${sam.actor}`}, 1200) from generate_series(1, 1200)) x`
  const r = await send('GET', '/api/me', t)
  assert.deepEqual([r.status, code(r)], [429, 'rate_limited'])
})

test('an account deleted from no workspace cannot sign in again', async () => {
  const boss = await makeOwner()
  const zed = await leftEverything(boss, 'Zed')
  const left = await send('POST', '/api/me/leave', zed.token)
  const t = (left.body.session as { access_token: string }).access_token
  const asked = await send('POST', '/api/me/delete', t, { dry: true })
  assert.equal(asked.status, 200, JSON.stringify(asked.body))
  const gone = await send('POST', '/api/me/delete', t, { password: PASSWORD })
  assert.equal(gone.status, 200, JSON.stringify(gone.body))
  const back = await send('POST', '/auth/login', null, { email: zed.email, password: PASSWORD, nowhere: true })
  assert.equal(back.status, 401)
  assert.equal((await send('GET', '/api/me', t)).status, 401)
})

test('a workspace token cannot pass as a session for nowhere, nor the other way', async () => {
  const boss = await makeOwner()
  // A workspace session reaches the nowhere-only list as a 403, not a list.
  assert.equal((await send('GET', '/api/me/invitations', boss.token)).status, 404)
  const me = await send('GET', '/api/me', boss.token)
  assert.notEqual(me.body.nowhere, true)
})
