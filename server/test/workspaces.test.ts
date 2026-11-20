import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { closeDb, makeOwner, addPerson, bearerFor, stamp } from './helpers.js'
import { app } from '../src/http/routes.js'
import { closeRealtime } from '../src/realtime.js'
import { issueApiToken, planNewWorkspace, registerUser } from '../src/auth/flows.js'
import { withActor } from '../src/db.js'

after(async () => {
  await closeRealtime()
  await closeDb()
})

const make = (bearer: string, name: unknown) =>
  app.request('/api/workspaces', {
    method: 'POST',
    headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  })

const mine = async (bearer: string) => {
  const r = await app.request('/api/workspaces', { headers: { authorization: `Bearer ${bearer}` } })
  return ((await r.json()) as { workspaces: { id: string; name: string; slug: string; role: string }[] }).workspaces
}

/*
 * Somebody already here makes another, owns it, and is answered with a way
 * in — the same answer `enter` gives, so the client has one thing to do
 * after either.
 */
test('somebody signed in makes another workspace and owns it', async () => {
  const { token, workspaceId } = await makeOwner()
  const name = `Side ${stamp().slice(0, 6)}`

  const r = await make(token, name)
  assert.equal(r.status, 201)
  const made = (await r.json()) as { access_token: string; workspace_id: string; slug: string }
  assert.notEqual(made.workspace_id, workspaceId)
  assert.ok(made.slug.startsWith('side-'))

  const listed = (await mine(token)).find((w) => w.id === made.workspace_id)
  assert.equal(listed?.role, 'owner')
  assert.equal(listed?.name, name)

  // The session it hands back is a session in the new one, not the old one.
  const inside = await app.request('/api/me', { headers: { authorization: `Bearer ${made.access_token}` } })
  assert.equal(inside.status, 200)
  const me = (await inside.json()) as { workspace: { id: string } }
  assert.equal(me.workspace.id, made.workspace_id)
})

/*
 * Slugs are unique across every workspace, so the server picks the next free
 * one rather than refusing a name somebody else's company already has — a
 * refusal there would say that company exists.
 */
test('the same name twice gets two addresses, and a name with no letters still gets one', async () => {
  const { token } = await makeOwner()
  /*
   * The whole stamp, not the first six characters of it.
   *
   * Those six are the top of a uuidv7's millisecond clock and only move
   * every few hours, so every run inside that window asked for the same
   * name — and the second run found `twin-…` and `twin-…-2` already taken
   * and was handed `-7` and `-8`. The mechanism being checked is that the
   * second of two identical names gets `-2`, and it can only be checked
   * against a name nobody has used.
   */
  const name = `Twin ${stamp()}`
  const a = (await (await make(token, name)).json()) as { slug: string }
  const b = (await (await make(token, name)).json()) as { slug: string }
  assert.notEqual(a.slug, b.slug)
  assert.equal(b.slug, `${a.slug}-2`)

  const odd = await make(token, '!!!')
  assert.equal(odd.status, 201)
  assert.match(((await odd.json()) as { slug: string }).slug, /^workspace(-\d+)?$/)
})

test('a role where you are is no bar to making your own', async () => {
  const { ctx, workspaceId } = await makeOwner()
  const member = await addPerson(ctx, workspaceId, 'member', [], [])
  const r = await make(await bearerFor(member.actorId, workspaceId), `Mine ${stamp().slice(0, 6)}`)
  assert.equal(r.status, 201)
})

test('an empty name is refused', async () => {
  const { token } = await makeOwner()
  assert.equal((await make(token, '   ')).status, 400)
  assert.equal((await make(token, undefined)).status, 400)
})

/*
 * A token is a narrower key than a session. Answering it with a session for
 * a workspace it made would turn the one into the other.
 */
test('a token cannot make one', async () => {
  const { ctx, workspaceId } = await makeOwner()
  const tok = await issueApiToken(ctx.actorId, workspaceId, 'agent')
  const before = (await mine(tok)).length
  assert.equal((await make(tok, 'Through a token')).status, 403)
  assert.equal((await mine(tok)).length, before)
})

/* Made with its plan, address and mark. */
test('a workspace is made with the address and mark chosen, and an address is free or not', async () => {
  const { token } = await makeOwner()
  const want = `own-${stamp().slice(-10).toLowerCase()}`
  const ask = async (q: string) =>
    (await (await app.request(`/api/workspaces/address?${q}`, { headers: { authorization: `Bearer ${token}` } })).json()) as {
      slug: string
      free: boolean
      suggestion: string
    }

  assert.equal((await ask(`want=${want}`)).free, true)
  // The app's own pages are not addresses, and a shape that cannot be one is not free.
  assert.equal((await ask('want=welcome')).free, false)
  assert.equal((await ask('want=no')).free, false)
  // A name alone gets the address it would be given.
  assert.match((await ask(`name=${encodeURIComponent('Acme Studio')}`)).slug, /^acme-studio(-\d+)?$/)

  const r = await app.request('/api/workspaces', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Chosen', slug: want, plan: 'team', mark_icon: 'flag', mark_tint: 3 }),
  })
  assert.equal(r.status, 201)
  const made = (await r.json()) as { slug: string; access_token: string }
  assert.equal(made.slug, want)
  const me = (await (await app.request('/api/me', { headers: { authorization: `Bearer ${made.access_token}` } })).json()) as {
    workspace: { mark_icon: string; mark_tint: number }
  }
  assert.equal(me.workspace.mark_icon, 'flag')
  assert.equal(me.workspace.mark_tint, 3)

  // Taken now: said, with the nearest free one, and not bent into it.
  const taken = await ask(`want=${want}`)
  assert.equal(taken.free, false)
  assert.equal(taken.suggestion, `${want}-2`)
  const again = await app.request('/api/workspaces', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Again', slug: want }),
  })
  assert.equal(again.status, 409)
  const reserved = await app.request('/api/workspaces', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Api', slug: 'api' }),
  })
  assert.equal(reserved.status, 409)
})

/*
 * Your own server puts a workspace made by signing up on `unlimited`.
 * It was written as an update with no actor,
 * which the owner-only update policy matched to nothing, so every such
 * workspace stayed on `solo` without a word. Asked of the function with the
 * community edition's plan, since the service's edition makes it a no-op.
 */
test('a workspace made by signing up lands on the plan the edition gives', async () => {
  const s = stamp()
  const session = await registerUser({
    email: `planned${s}@example.com`,
    password: 'correct-horse-battery-staple',
    name: `Planned ${s.slice(0, 4)}`,
    workspace_name: `Planned ${s.slice(0, 4)}`,
    workspace_slug: `planned-${s}`,
  })
  await planNewWorkspace(session.actor_id, session.workspace_id, 'unlimited')
  const [w] = await withActor(
    session.actor_id,
    session.workspace_id,
    (tx) => tx<{ plan: string }[]>`select plan from workspace where id = ${session.workspace_id}`,
  )
  assert.equal(w?.plan, 'unlimited')
})
