import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { app } from '../src/http/routes.js'
import { registerUser } from '../src/auth/flows.js'
import { outbox } from '../src/mail.js'
import { closeDb, makeOwner, stamp, withActor, uuidv7 } from './helpers.js'

after(async () => {
  await closeDb()
})

/* The third audit: what somebody with a
   script and a grudge could do. */

const PASSWORD = 'correct-horse-battery-staple'
const from = (ip: string, extra: Record<string, string> = {}) => ({
  'content-type': 'application/json',
  // What Railway writes: who connected, then its own edge.
  'x-forwarded-for': `${ip}, 10.0.0.1`,
  ...extra,
})
const login = (email: string, password: string, ip: string, extra: Record<string, string> = {}) =>
  app.request('/auth/login', { method: 'POST', headers: from(ip, extra), body: JSON.stringify({ email, password }) })
const as = (token: string, path: string, init: { method?: string; body?: unknown } = {}) =>
  app.request(path, {
    method: init.method ?? 'GET',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  })

async function someone(tag: string) {
  const email = `${tag}${stamp()}@example.com`
  return { email, ...(await registerUser({ email, password: PASSWORD, name: 'Vic', workspace_name: `${tag} ws` })) }
}

test('wrong guesses lock out the guesser, not the person they are guessing at', async () => {
  const victim = await someone('locked')
  const attacker = `203.0.113.${(Number.parseInt(stamp().slice(-2), 16) % 200) + 1}`
  for (let i = 0; i < 10; i++) assert.equal((await login(victim.email, 'not-the-password', attacker)).status, 401)
  // The attacker's address waits, even with the right password.
  assert.equal((await login(victim.email, PASSWORD, attacker)).status, 429)
  // The person, from where they are, does not.
  assert.equal((await login(victim.email, PASSWORD, '198.51.100.7')).status, 200)
  // And signed in, they can still change their address: the door's count is not theirs.
  const moved = await as(victim.access_token, '/api/me/email', {
    method: 'POST',
    body: { email: `elsewhere${stamp()}@example.com`, password: PASSWORD },
  })
  assert.equal(moved.status, 202)
})

test('a guess spread over many machines stops at the account, except on a device it knows', async () => {
  const victim = await someone('spread')
  // The laptop they always use, signed in once before.
  const device = `laptop-${stamp()}`
  assert.equal((await login(victim.email, PASSWORD, '198.51.100.8', { 'x-device': device })).status, 200)
  // Fifty wrong answers from five addresses.
  for (let m = 0; m < 5; m++) {
    for (let i = 0; i < 10; i++) await login(victim.email, 'nope-nope-nope', `192.0.2.${10 + m}`)
  }
  // A machine nobody has seen is refused; their own laptop is let in.
  assert.equal((await login(victim.email, PASSWORD, '192.0.2.99')).status, 429)
  assert.equal((await login(victim.email, PASSWORD, '192.0.2.98', { 'x-device': device })).status, 200)
})

test('invitation mail has a ceiling per address and per sender, and workspaces one per day', async () => {
  const sender = await someone('mailer')
  const target = `target${stamp()}@example.com`
  const mailed: boolean[] = []
  // Each invitation from a fresh workspace, which is what the old ceiling missed.
  for (let i = 0; i < 7; i++) {
    const ws = await as(sender.access_token, '/api/workspaces', { method: 'POST', body: { name: `Bulk ${i}` } })
    assert.equal(ws.status, 201, `workspace ${i}`)
    const { access_token } = (await ws.json()) as { access_token: string }
    const r = await as(access_token, '/api/invites', { method: 'POST', body: { role: 'member', email: target, rights: [] } })
    mailed.push(((await r.json()) as { mailed: boolean }).mailed)
  }
  assert.deepEqual(mailed, [true, true, true, true, true, false, false])
  assert.equal(outbox.filter((m) => m.to === target).length, 5)
  // Ten new workspaces a day: seven made above, three more, then no.
  for (let i = 0; i < 3; i++) {
    assert.equal((await as(sender.access_token, '/api/workspaces', { method: 'POST', body: { name: `More ${i}` } })).status, 201)
  }
  assert.equal((await as(sender.access_token, '/api/workspaces', { method: 'POST', body: { name: 'One too many' } })).status, 429)
})

test('a nonsense page size is the default, not a 500; the importer is closed', async () => {
  const owner = await makeOwner()
  for (const limit of ['abc', '-3', '0', '1e9']) {
    assert.equal((await as(owner.token, `/api/inbox?limit=${limit}`)).status, 200, `limit=${limit}`)
  }
  assert.equal((await as(owner.token, '/api/import/trello', { method: 'POST', body: {} })).status, 410)
})

test('a copied project keeps its parts under their parents and moves its dates', async () => {
  const owner = await makeOwner()
  const made = (await (await as(owner.token, '/api/projects', { method: 'POST', body: { name: 'Plan', template: 'launch' } })).json()) as {
    id: string
  }
  // A part under the first task, and two dates a week apart.
  const [first] = await withActor(
    owner.ctx.actorId,
    (tx) => tx<{ id: string; list_id: string }[]>`select id, list_id from task where project_id = ${made.id} order by sort_key limit 1`,
  )
  await withActor(owner.ctx.actorId, async (tx) => {
    await tx`
      insert into task (id, workspace_id, project_id, author_id, parent_id, list_id, title, sort_key)
      values (${uuidv7()}, ${owner.workspaceId}, ${made.id}, ${owner.ctx.actorId}, ${first!.id}, ${first!.list_id}, 'A part', 'a0')`
    await tx`update task set due_on = '2026-01-01' where id = ${first!.id}`
    await tx`update task set due_on = '2026-01-08' where project_id = ${made.id} and title = 'Set the launch date'`
  })
  const copied = await as(owner.token, `/api/projects/${made.id}/copy`, {
    method: 'POST',
    body: { name: 'Plan again', starts_on: '2026-03-02' },
  })
  assert.equal(copied.status, 201)
  const { id } = (await copied.json()) as { id: string }
  const rows = await withActor(
    owner.ctx.actorId,
    (tx) =>
      tx<{ title: string; due_on: string | null; parent: string | null }[]>`
      select t.title, to_char(t.due_on, 'YYYY-MM-DD') as due_on, p.title as parent
      from task t left join task p on p.id = t.parent_id
      where t.project_id = ${id}`,
  )
  assert.equal(rows.length, 8)
  assert.equal(rows.find((r) => r.title === 'A part')?.parent, 'Write the launch brief')
  assert.equal(rows.find((r) => r.title === 'Write the launch brief')?.due_on, '2026-03-02')
  assert.equal(rows.find((r) => r.title === 'Set the launch date')?.due_on, '2026-03-09')
})

/*
 * A burst sent at once — the review of ways to sign in. Each guess was
 * peeked at, checked and counted only when wrong, so every request of a
 * burst passed the peek before any counted, and the ceiling of ten was
 * however many arrived together. Counted first now, given back when right.
 */
test('a burst of guesses at once is counted like the same guesses one by one', async () => {
  const victim = await someone('burst')
  const attacker = `203.0.113.${(Number.parseInt(stamp().slice(-2), 16) % 200) + 1}`
  const said = await Promise.all(Array.from({ length: 30 }, () => login(victim.email, 'not-the-password', attacker)))
  const statuses = said.map((r) => r.status)
  assert.equal(statuses.filter((s) => s === 401).length, 10, statuses.join(' '))
  assert.equal(statuses.filter((s) => s === 429).length, 20)
  // The refused ones were not counted against the person: from where they are, they are in.
  assert.equal((await login(victim.email, PASSWORD, '198.51.100.9')).status, 200)
})

test('a burst at a signed-in re-ask stops at ten, and a right answer is given back', async () => {
  const me = await someone('reburst')
  const move = (password: string) =>
    as(me.access_token, '/api/me/email', { method: 'POST', body: { email: `away${stamp()}@example.com`, password } })
  // Nine wrong, then right ones: the right ones do not use up what is left.
  for (let i = 0; i < 9; i++) assert.equal((await move(`wrong-${i}`)).status, 403)
  for (let i = 0; i < 3; i++) assert.equal((await move(PASSWORD)).status, 202)
  // The tenth wrong one is still a wrong answer; after it, the door waits.
  assert.equal((await move('wrong-last')).status, 403)
  assert.equal((await move(PASSWORD)).status, 429)

  // And all at once, on somebody else, the same ten.
  const other = await someone('reburst2')
  const said = await Promise.all(
    Array.from({ length: 30 }, (_, i) =>
      as(other.access_token, '/api/me/password', { method: 'POST', body: { current: `wrong-${i}`, password: 'a-new-password-here' } }),
    ),
  )
  const statuses = said.map((r) => r.status)
  assert.equal(statuses.filter((s) => s === 403).length, 10, statuses.join(' '))
  assert.equal(statuses.filter((s) => s === 429).length, 20)
})
