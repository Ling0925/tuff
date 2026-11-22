import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { app } from '../src/http/routes.js'
import { closeDb, withActor, makeOwner, makeProject, stamp } from './helpers.js'
import type { Session } from '../src/auth/flows.js'

after(async () => {
  await closeDb()
})

/**
 * The one path where the person on the other end cannot report a fault.
 *
 * `accept_invite` is plpgsql and security definer, so its body is checked
 * when it runs and not when it is created. Migration 033 took a column off
 * `invite` and left the function reading it; every test passed, the endpoint
 * that lists invites passed, and following a link 500'd — for somebody with
 * no account, who has nobody to tell. Nothing here had ever accepted one.
 */
/** The link mailed to an address — the only place an invitation to an address puts it. */
async function mailedLink(to: string): Promise<string> {
  const { outbox } = await import('../src/mail.js')
  const m = outbox.filter((x) => x.to === to).at(-1)
  assert.ok(m, `nothing mailed to ${to}`)
  return decodeURIComponent(/\/invite\/([^\s"<]+)/.exec(m.text)![1]!)
}

async function send(path: string, token: string | null, body?: unknown) {
  const r = await app.request(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return { status: r.status, body: (await r.json()) as Record<string, unknown> }
}

test('an invite carries what the person may do, and they arrive holding it', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const project = await makeProject(ctx, workspaceId, 'Acme')

  const made = await send('/api/invites', token, {
    role: 'member',
    project_ids: [project],
    rights: ['task.create', 'task.delete'],
  })
  assert.equal(made.status, 200)
  const link = made.body.token as string

  // The list is served through the application role, whose SELECT on this
  // table is granted column by column. A column added and not granted is a
  // 500 on every request, which has happened twice.
  const listed = await send('/api/invites', token)
  assert.equal(listed.status, 200)
  assert.deepEqual((listed.body.invites as { rights: string[] }[])[0]!.rights, ['task.create', 'task.delete'])

  // What a stranger is told before they have an account: the workspace's
  // name and nothing about who else is in it.
  const preview = await send(`/auth/invite/${link}`, null)
  assert.equal(preview.status, 200)
  assert.equal(preview.body.state, 'open')

  const s = stamp()
  const joined = await send(`/auth/invite/${link}/accept`, null, {
    name: 'Robin',
    email: `robin${s}@example.com`,
    password: 'correct-horse-battery-staple',
  })
  assert.equal(joined.status, 200)
  assert.equal(joined.body.created_account, true)

  const newcomer = joined.body.actor_id as string
  const [row] = await withActor(
    ctx.actorId,
    (tx) =>
      tx<{ rights: string[] }[]>`
      select rights from project_member
      where project_id = ${project} and actor_id = ${newcomer}
        and deleted_at is null`,
  )
  assert.deepEqual(
    row?.rights,
    ['task.create', 'task.delete'],
    'the rights on the invite are the rights on the project, with no window in between',
  )
})

test('a spent link is spent, and says the same thing a wrong one says', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const project = await makeProject(ctx, workspaceId, 'Acme')

  const made = await send('/api/invites', token, { role: 'member', project_ids: [project] })
  const link = made.body.token as string

  const s = stamp()
  const first = await send(`/auth/invite/${link}/accept`, null, {
    name: 'First',
    email: `first${s}@example.com`,
    password: 'correct-horse-battery-staple',
  })
  assert.equal(first.status, 200)

  const second = await send(`/auth/invite/${link}/accept`, null, {
    name: 'Second',
    email: `second${s}@example.com`,
    password: 'correct-horse-battery-staple',
  })
  assert.equal(second.status, 404)
})

test('permissions without a project are refused, not quietly dropped', async () => {
  const { token } = await makeOwner()
  const r = await send('/api/invites', token, {
    role: 'member',
    project_ids: [],
    rights: ['task.create'],
  })
  assert.equal(r.status, 400)
})

/**
 * Signing out, which for the whole life of this endpoint did not.
 *
 * `logout` revoked the row by matching `token_hash`, a column the
 * application role may not read — so the statement was refused and
 * `POST /auth/logout` answered 500 to every request ever made to it. It
 * looked like it worked, because the browser drops its own copy and goes to
 * the sign-in screen; what did not happen is that the token stopped working.
 *
 * Asserted on the token afterwards rather than on the response, because the
 * response was `{ ok: true }` throughout.
 */
test('signing out ends the session, not just this browser', async () => {
  const s = stamp()
  const { registerUser, refresh } = await import('../src/auth/flows.js')
  const session = await registerUser({
    email: `out${s}@example.com`,
    password: 'correct-horse-battery-staple',
    name: 'Out',
    workspace_name: `WS ${s.slice(0, 4)}`,
    workspace_slug: `ws-${s}`,
  })

  const out = await app.request('/auth/logout', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refresh_token: session.refresh_token }),
  })
  assert.equal(out.status, 200, 'the endpoint itself answered 500 for its whole life')

  assert.equal(await refresh(session.refresh_token), null, 'a copy of the token kept working after the person signed out')
})

/**
 * A refresh comes back to the workspace it left.
 *
 * `refresh_session` held who, not where, so the workspace was picked by
 * hand: the caller's oldest membership. One account in two workspaces,
 * working in the second, the access token expires, the client refreshes —
 * and comes back holding a session in the *first*.
 *
 * Row-level security then does exactly what it should, and the screen is
 * the lie: a project's lists and its tasks are both read in the wrong
 * workspace, so both answer 200 with nothing in them. No error anywhere,
 * and a project with five tasks in it saying "Nothing here yet."
 */
test('a refresh comes back to the workspace the session was in', async () => {
  const s = stamp()
  const { registerUser, refresh, newWorkspace } = await import('../src/auth/flows.js')
  const first = await registerUser({
    email: `two${s}@example.com`,
    password: 'correct-horse-battery-staple',
    name: 'Two',
    workspace_name: `First ${s.slice(0, 4)}`,
    workspace_slug: `first-${s}`,
  })
  // A second workspace, made from inside the first.
  const second = await newWorkspace(first.actor_id, `Second ${s.slice(0, 4)}`)
  assert.notEqual(second.workspace_id, first.workspace_id)

  const back = (await refresh(second.refresh_token)) as Session | null
  assert.notEqual(back, null)
  assert.equal(
    back!.workspace_id,
    second.workspace_id,
    'the refresh moved the session to another workspace, where this person sees nothing',
  )

  // And the first one still refreshes into the first one.
  const home = (await refresh(first.refresh_token)) as Session | null
  assert.equal(home?.workspace_id, first.workspace_id)
})

/**
 * A refresh token is spent when it is used.
 *
 * The same statement that failed to sign anybody out was how rotation
 * revoked the old token — so it never did, and a refresh token could be
 * replayed for as long as it lived. That is the exact property
 * rotate-on-use exists to provide, and nothing here asked for it.
 *
 * The assertion is about the *old* token, not about getting a new one.
 * Getting a new one worked throughout, which is why this went unnoticed.
 */
test('a refresh token is spent once, and a replay of it is refused', async () => {
  const s = stamp()
  const { registerUser, refresh, refreshGrace } = await import('../src/auth/flows.js')
  const session = await registerUser({
    email: `spin${s}@example.com`,
    password: 'correct-horse-battery-staple',
    name: 'Spin',
    workspace_name: `WS ${s.slice(0, 4)}`,
    workspace_slug: `ws-${s}`,
  })

  /* Past the few seconds a spent token is answered again for
     (`refresh-grace.test.ts`). */
  const grace = refreshGrace.seconds
  refreshGrace.seconds = 0
  try {
    const next = (await refresh(session.refresh_token)) as Session | null
    assert.notEqual(next, null, 'the first use hands back a session')
    assert.notEqual(next!.refresh_token, session.refresh_token, 'and a different token')

    assert.equal(await refresh(session.refresh_token), null, 'the spent one kept working for its whole life')
    // The new one is the live one, and is itself spent when it is used.
    assert.notEqual(await refresh(next!.refresh_token), null)
    assert.equal(await refresh(next!.refresh_token), null)
  } finally {
    refreshGrace.seconds = grace
  }
})

/*
 * An invitation to an email that already has an account joins that account
 * — and only with its password. It did not ask: whoever held a link could
 * type somebody else's address and was handed their session.
 */
test('an existing account joins by an invite only with its own password', async () => {
  // Somebody with an account, made the way any account is.
  const first = await makeOwner()
  const firstProject = await makeProject(first.ctx, first.workspaceId, 'Acme')
  const s = stamp()
  const email = `sam${s}@example.com`
  // Sent to Sam's address, so the account it makes is confirmed.
  await send('/api/invites', first.token, { role: 'member', project_ids: [firstProject], email })
  const joined = await send(`/auth/invite/${await mailedLink(email)}/accept`, null, {
    name: 'Sam',
    email,
    password: 'correct-horse-battery-staple',
  })
  assert.equal(joined.status, 200)

  // A second workspace invites anyone; somebody types Sam's address.
  const other = await makeOwner()
  const otherProject = await makeProject(other.ctx, other.workspaceId, 'Elsewhere')
  const link = (await send('/api/invites', other.token, { role: 'member', project_ids: [otherProject] })).body.token as string
  const taken = await send(`/auth/invite/${link}/accept`, null, {
    name: 'Not Sam',
    email,
    password: 'a-different-password-entirely',
  })
  assert.equal(taken.status, 401)
  assert.equal(taken.body.access_token, undefined)

  // The link was not spent by the refusal, and Sam can use it.
  const real = await send(`/auth/invite/${link}/accept`, null, {
    name: 'Sam',
    email,
    password: 'correct-horse-battery-staple',
  })
  assert.equal(real.status, 200)
  assert.equal(real.body.created_account, false)
  assert.equal(real.body.actor_id, joined.body.actor_id)
})

/* An invitation with an address on it is mailed there. */
test('an invitation with an email address is sent to it, with the link', async () => {
  const { outbox } = await import('../src/mail.js')
  const { token } = await makeOwner()
  const to = `asked-${stamp()}@example.com`
  const made = await send('/api/invites', token, { role: 'member', email: to, rights: [] })
  assert.equal(made.status, 200)
  assert.equal(made.body.mailed, true)
  /* The link went to the address and only there: whoever sent it does not
     hold it too, or they could join as that address. */
  assert.equal(made.body.token, '')
  const mail = outbox.filter((m) => m.to === to).at(-1)
  assert.ok(mail, 'mailed')
  assert.match(mail.text, /\/invite\/inv_/)
})

/* An invitation is a note from a person — from their name, answered
   to them, a few lines and one link — or Gmail files it under Promotions. */
test('an invitation reads as a note from the person who sent it', async () => {
  const { outbox, fromPerson } = await import('../src/mail.js')
  const { ctx, workspaceId, token } = await makeOwner()
  const project = await makeProject(ctx, workspaceId, 'Website')
  const to = `noted-${stamp()}@example.com`
  const made = await send('/api/invites', token, { role: 'member', email: to, project_ids: [project], rights: [] })
  assert.equal(made.status, 200)
  const mail = outbox.filter((m) => m.to === to).at(-1)!
  assert.ok(mail.fromName, 'from the person')
  assert.match(mail.replyTo ?? '', /@/, 'answered to the person')
  assert.equal(mail.headers, undefined, 'nothing a list carries')
  assert.doesNotMatch(mail.subject, /invited/i)
  assert.ok(mail.text.includes('“Website”'), 'names the project')
  assert.ok(mail.html.includes('“Website”'))
  assert.equal((mail.html.match(/<a /g) ?? []).length, 1, 'one link')
  assert.doesNotMatch(mail.html, /<img|<table|background|border-radius/, 'no layout, no button, no image')

  assert.equal(fromPerson('Ana Lee', 'Tuff <hello@usetuff.com>'), '"Ana Lee via Tuff" <hello@usetuff.com>')
  assert.equal(fromPerson('"Tuff" <x@evil.com>', 'Tuff <hello@usetuff.com>'), '"Tuff x evil.com via Tuff" <hello@usetuff.com>')
  assert.equal(fromPerson('  ', 'Tuff <hello@usetuff.com>'), 'Tuff <hello@usetuff.com>')
})

/*
 * An account made by following an invitation is confirmed only when the
 * invitation was sent to its address.
 */
test('joining by an invitation sent to the address confirms it; by a link handed round it asks', async () => {
  const { outbox } = await import('../src/mail.js')
  const { token } = await makeOwner()
  const login = (email: string) =>
    app.request('/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'correct-horse-battery-staple' }),
    })

  // Sent to the address, and accepted with it: confirmed.
  const asked = `invited-${stamp()}@example.com`
  await send('/api/invites', token, { role: 'member', email: asked, rights: [] })
  const one = await send(`/auth/invite/${await mailedLink(asked)}/accept`, null, {
    name: 'Ivy',
    email: asked,
    password: 'correct-horse-battery-staple',
  })
  assert.equal(one.status, 200)
  assert.equal((await login(asked)).status, 200)

  // A link with no address: in now, but the address waits for its link.
  const typed = `typed-${stamp()}@example.com`
  const link = await send('/api/invites', token, { role: 'member', rights: [] })
  const two = await send(`/auth/invite/${link.body.token as string}/accept`, null, {
    name: 'Tom',
    email: typed,
    password: 'correct-horse-battery-staple',
  })
  assert.equal(two.status, 200)
  assert.ok(two.body.access_token, 'the holder of the link is let in')
  const letter = outbox.filter((m) => m.to === typed).at(-1)?.text ?? ''
  assert.ok(/\/reset\/chs_/.test(letter), 'the letter that asks for a password went')
  assert.equal((await login(typed)).status, 403)
})

/* A link with no address, followed
   with somebody else's — the holder is in the workspace, and holds nothing
   that survives the address's owner proving it. */
test('a link with no address, followed with somebody else’s, leaves the owner of the address nothing to undo', async () => {
  const { outbox } = await import('../src/mail.js')
  const owner = await makeOwner()
  const other = await makeOwner()
  const victim = `victim-${stamp()}@example.com`
  const link = await send('/api/invites', owner.token, { role: 'member', rights: [] })
  const took = await send(`/auth/invite/${link.body.token as string}/accept`, null, {
    name: 'Not Victim',
    email: victim,
    password: 'the-strangers-password',
  })
  assert.equal(took.status, 200)
  const strangers = took.body.access_token as string
  // Unconfirmed: no second factor (a way in, in `ways-in.test.ts`), and no
  // invitation taken as that address — the invitation left as it was.
  assert.equal((await send('/api/2fa/begin', strangers, {})).status, 403)
  const mailed = await send('/api/invites', other.token, { role: 'member', rights: [] })
  const joined = await send(`/api/invite/${encodeURIComponent(mailed.body.token as string)}/join`, strangers, {})
  assert.equal(joined.status, 403)
  assert.equal((joined.body.error as { code: string }).code, 'email_unverified')
  assert.equal((await send(`/auth/invite/${encodeURIComponent(mailed.body.token as string)}`, null)).body.state, 'open')
  // Their password signs nobody in while the address is unproved.
  const tried = await app.request('/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: victim, password: 'the-strangers-password' }),
  })
  assert.equal(tried.status, 403)

  // The owner of the address follows the letter and chooses a password.
  const letter = outbox.filter((m) => m.to === victim).at(-1)!.text
  const token = decodeURIComponent(/\/reset\/(chs_[^\s"<]+)/.exec(letter)![1]!)
  const chose = await app.request('/auth/password/reset', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token, password: 'the-real-owners-password' }),
  })
  assert.equal(chose.status, 200)
  const login = (password: string) =>
    app.request('/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: victim, password }),
    })
  assert.equal((await login('the-strangers-password')).status, 401)
  assert.equal((await login('the-real-owners-password')).status, 200)
  // And the stranger's session is over.
  assert.equal((await send('/api/me', strangers)).status, 401)
})

/* Somebody already in Tuff, signed in, joins with
   one press; a member pressing their own link is shown the way in. */
test('somebody signed in joins by a link with one press, and a member’s press spends nothing', async () => {
  const owner = await makeOwner()
  const other = await makeOwner()
  const link = async () => ((await send('/api/invites', owner.token, { rights: [] })).body as { token: string }).token

  const first = await link()
  const read = await send(`/api/invite/${encodeURIComponent(first)}`, other.token)
  assert.equal(read.status, 200)
  assert.equal(read.body.state, 'open')
  assert.equal(read.body.member, false)
  assert.ok((read.body.you as { email: string }).email.includes('@'))

  const joined = await send(`/api/invite/${encodeURIComponent(first)}/join`, other.token, {})
  assert.equal(joined.status, 200)
  const into = (await send('/api/me', joined.body.access_token as string)).body as { workspace: { id: string }; role: string }
  assert.equal(into.workspace.id, owner.workspaceId)
  assert.equal(into.role, 'member')
  // Spent, for anybody after.
  assert.equal((await send(`/auth/invite/${encodeURIComponent(first)}`, null)).body.state, 'used')
  assert.equal((await send(`/api/invite/${encodeURIComponent(first)}/join`, other.token, {})).status, 404)

  // The owner opening their own link is in already, and leaves it open.
  const second = await link()
  const own = await send(`/api/invite/${encodeURIComponent(second)}`, owner.token)
  assert.equal(own.body.member, true)
  assert.equal(own.body.workspace_id, owner.workspaceId)
  assert.equal((await send(`/auth/invite/${encodeURIComponent(second)}`, null)).body.state, 'open')
})

test('an invitation makes a member, never an owner', async () => {
  const { token } = await makeOwner()
  const r = await send('/api/invites', token, { role: 'owner', rights: [] })
  assert.equal(r.status, 400)
})

/*
 * Whoever sent an invitation hears when it is followed — `docs/specs/inbox.md`
 * — by a new account and by somebody signed in pressing join, and the note
 * opens the person who arrived.
 */
test('the person who sent an invitation is told when it is followed', async () => {
  const owner = await makeOwner()
  const other = await makeOwner()
  const link = async () => ((await send('/api/invites', owner.token, { rights: [] })).body as { token: string }).token
  const joins = async () =>
    (await send('/api/inbox', owner.token)).body as {
      notifications: { reason: string; object_type: string; object_id: string; title: string }[]
      unread: { joined: string }
    }

  assert.equal((await joins()).unread.joined, '0')

  const s = stamp()
  const fresh = await send(`/auth/invite/${await link()}/accept`, null, {
    name: 'Robin',
    email: `robin-told${s}@example.com`,
    password: 'correct-horse-battery-staple',
  })
  assert.equal(fresh.status, 200)
  await send(`/api/invite/${encodeURIComponent(await link())}/join`, other.token, {})

  const told = await joins()
  const notes = told.notifications.filter((n) => n.reason === 'joined')
  assert.equal(told.unread.joined, '2')
  assert.deepEqual(
    notes.map((n) => [n.object_type, n.object_id]).sort(),
    [
      ['actor', fresh.body.actor_id as string],
      ['actor', other.ctx.actorId],
    ].sort(),
  )
  assert.ok(
    notes.some((n) => n.title === 'Robin'),
    'the note says who, by name',
  )
  // The person who joined is told nothing about themself.
  const theirs = (await send('/api/inbox', other.token)).body as { notifications: { reason: string }[] }
  assert.equal(theirs.notifications.filter((n) => n.reason === 'joined').length, 0)
})

/*
 * Sending one again: a new
 * link in place of the old, which stops; mailed again to an address and
 * never handed to whoever sent it; a link with no address handed back
 * new. Not by a member, not through a token, not once it is revoked.
 */
test('an invitation is sent again with a new link, and the old link stops', async () => {
  const { outbox } = await import('../src/mail.js')
  const { addPerson, bearerFor } = await import('./helpers.js')
  const { issueApiToken } = await import('../src/auth/flows.js')
  const { ctx, workspaceId, token } = await makeOwner()
  const project = await makeProject(ctx, workspaceId, 'Again')
  const to = `again-${stamp()}@example.com`

  const made = await send('/api/invites', token, { role: 'member', email: to, project_ids: [project], rights: ['task.create'] })
  assert.equal(made.status, 200)
  const first = await mailedLink(to)
  const before = outbox.filter((m) => m.to === to).length

  // Not by a member, not through a token, not an id that is not one.
  const member = await addPerson(ctx, workspaceId, 'member', [project])
  assert.equal((await send(`/api/invites/${made.body.id as string}/resend`, await bearerFor(member.actorId, workspaceId), {})).status, 403)
  const tool = await issueApiToken(ctx.actorId, workspaceId, 'tool')
  assert.equal((await send(`/api/invites/${made.body.id as string}/resend`, tool, {})).status, 403)
  assert.equal((await send('/api/invites/nope/resend', token, {})).status, 404)

  const again = await send(`/api/invites/${made.body.id as string}/resend`, token, {})
  assert.equal(again.status, 200, JSON.stringify(again.body))
  assert.equal(again.body.mailed, true)
  // The link went to the address, not back to the sender.
  assert.equal(again.body.token, '')
  assert.notEqual(again.body.id, made.body.id)
  assert.equal(outbox.filter((m) => m.to === to).length, before + 1)
  const second = await mailedLink(to)
  assert.notEqual(second, first)

  // The old link stops; the new one is open and holds what the old one held.
  assert.equal((await send(`/auth/invite/${encodeURIComponent(first)}`, null)).body.state, 'invalid')
  assert.equal((await send(`/auth/invite/${encodeURIComponent(second)}`, null)).body.state, 'open')
  const listed = (await send('/api/invites', token)).body.invites as {
    id: string
    email: string | null
    project_ids: string[]
    rights: string[]
    deleted_at: string | null
  }[]
  const now = listed.find((i) => i.id === again.body.id)!
  assert.deepEqual([now.email, now.project_ids, now.rights, now.deleted_at], [to, [project], ['task.create'], null])
  assert.ok(listed.find((i) => i.id === made.body.id)!.deleted_at)
  // The old one is not sent again.
  assert.equal((await send(`/api/invites/${made.body.id as string}/resend`, token, {})).status, 404)

  // A link with no address comes back new, and the old one stops.
  const link = await send('/api/invites', token, { role: 'member', rights: [] })
  const fresh = await send(`/api/invites/${link.body.id as string}/resend`, token, {})
  assert.equal(fresh.status, 200)
  assert.match(fresh.body.token as string, /^inv_/)
  assert.notEqual(fresh.body.token, link.body.token)
  assert.equal(fresh.body.mailed, false)
  assert.equal((await send(`/auth/invite/${encodeURIComponent(link.body.token as string)}`, null)).body.state, 'invalid')
  assert.equal((await send(`/auth/invite/${encodeURIComponent(fresh.body.token as string)}`, null)).body.state, 'open')

  // A revoked one is not sent again either.
  await send(`/api/invites/${fresh.body.id as string}/revoke`, token, {})
  assert.equal((await send(`/api/invites/${fresh.body.id as string}/resend`, token, {})).status, 404)
})

/* Past the mail ceiling the link that was out stays out, and working. */
test('sending again past the ceiling to an address is refused, and the old link still works', async () => {
  const { token } = await makeOwner()
  const to = `ceiling-${stamp()}@example.com`
  let id = (await send('/api/invites', token, { role: 'member', email: to, rights: [] })).body.id as string
  // Five a day to one address: the first send and four more.
  for (let i = 0; i < 4; i++) {
    const again = await send(`/api/invites/${id}/resend`, token, {})
    assert.equal(again.status, 200, JSON.stringify(again.body))
    id = again.body.id as string
  }
  const link = await mailedLink(to)
  const sixth = await send(`/api/invites/${id}/resend`, token, {})
  assert.equal(sixth.status, 429)
  assert.equal((await send(`/auth/invite/${encodeURIComponent(link)}`, null)).body.state, 'open')
  const listed = (await send('/api/invites', token)).body.invites as { id: string; deleted_at: string | null }[]
  assert.equal(listed.find((i) => i.id === id)?.deleted_at, null)
})

/* Two presses at once make one invitation, not two. */
test('two sends again at once: one takes it, the other finds it gone', async () => {
  const { token } = await makeOwner()
  const made = await send('/api/invites', token, { role: 'member', rights: [] })
  const both = await Promise.all([
    send(`/api/invites/${made.body.id as string}/resend`, token, {}),
    send(`/api/invites/${made.body.id as string}/resend`, token, {}),
  ])
  assert.deepEqual(both.map((r) => r.status).sort(), [200, 404])
  const listed = (await send('/api/invites', token)).body.invites as { deleted_at: string | null }[]
  assert.equal(listed.filter((i) => i.deleted_at === null).length, 1)
})
