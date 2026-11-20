import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { app } from '../src/http/routes.js'
import { MAX_LIVE_TOKENS } from '../src/auth/flows.js'
import { PER_PERSON, stops } from '../src/http/limits.js'
import { addPerson, asTableOwner, bearerFor, closeDb, makeOwner } from './helpers.js'

after(async () => {
  await closeDb()
})

/*
 * One member could drain the workspace's allowance,
 * the seventh audit. Seventeen tokens of their own were seventeen
 * times three hundred a minute out of six thousand, and for that minute the
 * owner was refused even revoking them or removing the member.
 */

async function call(method: string, path: string, token: string, body?: unknown) {
  const r = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const text = await r.text()
  return { status: r.status, body: (text ? JSON.parse(text) : {}) as Record<string, any> }
}

/*
 * A counter filled to the brim for the minute it is in, as the table's owner
 * — the same window `rate_spend` counts in. Filled again right before each
 * refusal it is meant to cause, so a minute turning over in between can
 * only make a request pass that was expected to pass anyway.
 */
async function fill(key: string): Promise<void> {
  await asTableOwner()`
    insert into rate_window (key, window_start, hits)
    values (${key}, to_timestamp(floor(extract(epoch from now()) / 60) * 60), 1000000)
    on conflict (key, window_start) do update set hits = 1000000`
}

test('a person holds at most so many live tokens, and revoking one makes room', async () => {
  const o = await makeOwner()
  const m = await addPerson(o.ctx, o.workspaceId, 'member', [])
  const mB = await bearerFor(m.actorId, o.workspaceId)
  for (let i = 1; i <= MAX_LIVE_TOKENS; i++) {
    assert.equal((await call('POST', '/api/tokens', mB, { name: `t${i}` })).status, 201)
  }
  const over = await call('POST', '/api/tokens', mB, { name: 'one more' })
  assert.equal(over.status, 409)
  assert.equal(over.body.error.code, 'too_many_tokens')

  const listed = (await call('GET', '/api/tokens', mB)).body.tokens as { id: string; revoked_at: string | null }[]
  assert.equal(listed.filter((t) => !t.revoked_at).length, MAX_LIVE_TOKENS)
  assert.equal((await call('POST', `/api/tokens/${listed[0]!.id}/revoke`, mB)).status, 200)
  assert.equal((await call('POST', '/api/tokens', mB, { name: 'in its place' })).status, 201)

  // Somebody else's count is their own.
  assert.equal((await call('POST', '/api/tokens', o.token, { name: 'owner’s' })).status, 201)
})

test('a person’s tokens spend that person’s allowance, not only their own', async () => {
  const o = await makeOwner()
  const m = await addPerson(o.ctx, o.workspaceId, 'member', [])
  const mB = await bearerFor(m.actorId, o.workspaceId)
  const made = await call('POST', '/api/tokens', mB, { name: 'loop' })
  assert.equal(made.status, 201)
  const tok = made.body.token as string
  assert.equal((await call('GET', '/api/me', tok)).status, 200)

  // The person's twelve hundred spent — through a session or other tokens — and a token of theirs fresh to the minute.
  assert.ok(PER_PERSON > 0)
  await fill(`a:${m.actorId}`)
  assert.equal((await call('GET', '/api/me', tok)).status, 429)
  // The workspace's other people are not held by it.
  assert.equal((await call('GET', '/api/me', o.token)).status, 200)
})

test('the owner’s presses that stop somebody pass a spent workspace; nothing else does', async () => {
  const o = await makeOwner()
  const m = await addPerson(o.ctx, o.workspaceId, 'member', [])
  const mB = await bearerFor(m.actorId, o.workspaceId)
  const made = await call('POST', '/api/tokens', mB, { name: 'drain' })
  assert.equal(made.status, 201)
  const tok = made.body.token as string
  const tokenId = ((await call('GET', '/api/tokens', mB)).body.tokens as { id: string }[])[0]!.id

  await fill(`w:${o.workspaceId}`)
  assert.equal((await call('GET', '/api/me', o.token)).status, 429)
  // Not through a token, which is what is being stopped.
  await fill(`w:${o.workspaceId}`)
  assert.equal((await call('POST', `/api/tokens/${tokenId}/revoke`, tok)).status, 429)

  await fill(`w:${o.workspaceId}`)
  assert.equal((await call('POST', `/api/tokens/${tokenId}/revoke`, o.token)).status, 200)
  await fill(`w:${o.workspaceId}`)
  assert.equal((await call('DELETE', `/api/people/${m.actorId}`, o.token)).status, 200)
  // The token is ended, so it is nobody now.
  assert.equal((await call('GET', '/api/me', tok)).status, 401)

  // And the pass has an allowance of its own.
  await fill(`stop:${o.ctx.actorId}`)
  await fill(`w:${o.workspaceId}`)
  assert.equal((await call('DELETE', `/api/people/${m.actorId}`, o.token)).status, 429)
})

test('which presses stop somebody', () => {
  assert.equal(stops('POST', '/api/tokens/abc/revoke'), true)
  assert.equal(stops('DELETE', '/api/people/abc'), true)
  assert.equal(stops('DELETE', '/api/agents/abc'), true)
  assert.equal(stops('DELETE', '/api/agents/abc/connections/def'), true)
  assert.equal(stops('GET', '/api/me'), false)
  assert.equal(stops('POST', '/api/tokens'), false)
  assert.equal(stops('GET', '/api/people/abc'), false)
  assert.equal(stops('DELETE', '/api/people/abc/projects/def'), false)
  // And the lists those buttons are on.
  assert.equal(stops('GET', '/api/agents'), true)
  assert.equal(stops('GET', '/api/tokens'), true)
  assert.equal(stops('GET', '/api/people'), true)
  assert.equal(stops('POST', '/api/agents'), false)
})

/*
 * An agent's token spends its connector's allowance as its person's — the
 * review of: five agents of one member, each with twelve hundred of
 * its own, were the workspace's six thousand again.
 */
test('an agent’s token spends the allowance of whoever connected it', async () => {
  const o = await makeOwner()
  const m = await addPerson(o.ctx, o.workspaceId, 'member', [])
  const mB = await bearerFor(m.actorId, o.workspaceId)
  const p = await call('POST', '/api/projects', o.token, { name: `Agents ${Date.now().toString(36)}` })
  assert.equal(p.status, 201, JSON.stringify(p.body))
  const made = await call('POST', '/api/agents', o.token, { name: 'Loop', project_ids: [p.body.id], reach: 'mcp' })
  assert.equal(made.status, 201, JSON.stringify(made.body))
  const agentToken = made.body.token as string
  assert.equal((await call('GET', '/api/me', agentToken)).status, 200)

  await fill(`a:${o.ctx.actorId}`)
  assert.equal((await call('GET', '/api/me', agentToken)).status, 429)
  // Its own allowance, fresh, is not what it spends; and another person is not held by it.
  assert.equal((await call('GET', '/api/me', mB)).status, 200)
})

test('the lists the stopping presses are on open on a spent workspace, from a session only', async () => {
  const o = await makeOwner()
  const m = await addPerson(o.ctx, o.workspaceId, 'member', [])
  const mB = await bearerFor(m.actorId, o.workspaceId)
  const made = await call('POST', '/api/tokens', mB, { name: 'drain' })
  assert.equal(made.status, 201)
  for (const path of ['/api/agents', '/api/tokens', '/api/people']) {
    await fill(`w:${o.workspaceId}`)
    assert.equal((await call('GET', path, o.token)).status, 200, path)
  }
  await fill(`w:${o.workspaceId}`)
  assert.equal((await call('GET', '/api/people', made.body.token as string)).status, 429)
})
