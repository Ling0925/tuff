import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { app } from '../src/http/routes.js'
import { joinByProvider } from '../src/http/access.js'
import { issueApiToken } from '../src/auth/flows.js'
import { outbox } from '../src/mail.js'
import { addPerson, bearerFor, closeDb, makeOwner, makeProject, stamp, withActor, withoutActor } from './helpers.js'

after(closeDb)

const PASSWORD = 'correct-horse-battery-staple'
const call = async (method: string, path: string, token: string, body?: unknown) => {
  const r = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, unknown> }
}
const owners = (workspaceId: string, as: string) =>
  withActor(
    as,
    (tx) => tx<{ actor_id: string }[]>`
    select actor_id from membership where workspace_id = ${workspaceId} and role = 'owner' and deleted_at is null`,
  )

test('the owner hands the workspace over with their password, and stays on every project', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const kept = await makeProject(ctx, workspaceId, 'Not theirs')
  const sam = await addPerson(ctx, workspaceId, 'member')
  await withoutActor(
    (tx) => tx`
    insert into app_user (actor_id, email, password_hash, timezone, email_verified_at)
    values (${sam.actorId}, ${`sam-${sam.actorId}@example.com`}, 'x', 'UTC', now())`,
  )

  // Not without the password, not to nobody, not by a member.
  assert.equal((await call('POST', '/api/workspace/transfer', token, { to: sam.actorId, password: 'wrong-password-here' })).status, 403)
  assert.equal((await call('POST', '/api/workspace/transfer', token, { to: ctx.actorId, password: PASSWORD })).status, 400)
  const asSam = await bearerFor(sam.actorId, workspaceId)
  assert.equal((await call('POST', '/api/workspace/transfer', asSam, { to: sam.actorId })).status, 403)
  const tool = await issueApiToken(ctx.actorId, workspaceId, 'agent')
  assert.equal((await call('POST', '/api/workspace/transfer', tool, { to: sam.actorId, password: PASSWORD })).status, 403)

  const handed = await call('POST', '/api/workspace/transfer', token, { to: sam.actorId, password: PASSWORD })
  assert.equal(handed.status, 200)
  assert.deepEqual(
    (await owners(workspaceId, sam.actorId)).map((r) => r.actor_id),
    [sam.actorId],
  )
  // The one who handed it over is a member, still on the project they owned.
  const me = await call('GET', '/api/me', token)
  assert.equal(me.body.role, 'member')
  const [on] = await withActor(
    ctx.actorId,
    (tx) => tx<{ n: number }[]>`
    select count(*)::int as n from project_member where project_id = ${kept} and actor_id = ${ctx.actorId} and deleted_at is null`,
  )
  assert.equal(on!.n, 1)
  assert.ok(outbox.some((m) => m.to === `sam-${sam.actorId}@example.com` && /owner/.test(m.subject)))
  // And they cannot take it back by themselves.
  assert.equal((await call('POST', '/api/workspace/transfer', token, { to: ctx.actorId, password: PASSWORD })).status, 403)
})

test('nobody is made an owner from a card, and one owner is all the database holds', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const sam = await addPerson(ctx, workspaceId, 'member')
  assert.equal((await call('PATCH', `/api/people/${sam.actorId}`, token, { role: 'owner' })).status, 400)
  await assert.rejects(
    withActor(
      ctx.actorId,
      (tx) => tx`update membership set role = 'owner' where workspace_id = ${workspaceId} and actor_id = ${sam.actorId}`,
    ),
  )
})

test('somebody new joins through Google by the invitation alone, with no workspace of their own', async () => {
  const { token, workspaceId } = await makeOwner()
  const link = async () => ((await call('POST', '/api/invites', token, { rights: [] })).body as { token: string }).token
  const email = `nia${stamp()}@example.com`
  const subject = `g-${stamp()}`

  const made = await joinByProvider('google', await link(), subject, email, true, 'Nia')
  assert.ok(made && typeof made === 'object')
  assert.equal(made.workspaceId, workspaceId)
  const [n] = await withActor(
    made.actorId,
    (tx) => tx<{ n: number }[]>`
    select count(*)::int as n from membership where actor_id = ${made.actorId} and deleted_at is null`,
  )
  assert.equal(n!.n, 1, 'the invited workspace and nothing else')

  // Known by that provider: joins again by another link, as themselves.
  const { token: elsewhere } = await makeOwner()
  const again = ((await call('POST', '/api/invites', elsewhere, { rights: [] })).body as { token: string }).token
  const back = await joinByProvider('google', again, subject, email, true, 'Nia')
  assert.ok(back && typeof back === 'object')
  assert.equal(back.actorId, made.actorId)

  // An address the provider does not vouch for is not handed the account;
  // a spent link joins nobody.
  assert.equal(await joinByProvider('google', await link(), `g-${stamp()}`, email, false, 'Nia'), 'conflict')
  const spent = (await call('POST', '/api/invites', token, { rights: [] })).body as { id: string; token: string }
  assert.equal((await call('POST', `/api/invites/${spent.id}/revoke`, token, {})).status, 200)
  assert.equal(await joinByProvider('google', spent.token, `g-${stamp()}`, `other${stamp()}@example.com`, true, 'O'), 'gone')
})
