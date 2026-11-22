import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { app } from '../src/http/routes.js'
import { outbox } from '../src/mail.js'
import { hashToken } from '../src/auth/crypto.js'
import { whoIs, joinByProvider } from '../src/http/access.js'
import { asAuth, asTableOwner, closeDb, makeOwner, stamp, uuidv7, withActor } from './helpers.js'

/*
 * What following an invitation proves about an address,
 * migration 313.
 *
 * The application role inserts invitations, so SQL run as it (an
 * injection, a bug) could plant one to somebody's address with a token it
 * knew. Following it made a confirmed account at that address, and when
 * the address's owner later arrived through Google the account was let
 * into with the planter's password still working. An invitation now
 * proves an address only when the server delivered its link there — by
 * mail, or (weakly) handed over where there is no mail — which only the
 * sign-in role writes on the row.
 */

after(closeDb)

const PASSWORD = 'correct-horse-battery-staple'
const refused = (e: unknown) => (e as { code?: string }).code === '42501'

async function call(path: string, token: string | null, body?: unknown) {
  const r = await app.request(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const text = await r.text()
  return { status: r.status, body: (text ? JSON.parse(text) : {}) as Record<string, any> }
}

const login = (email: string, password = PASSWORD) => call('/auth/login', null, { email, password })

/** An invitation written as the application role — what an injection can do — with a token it chose. */
async function planted(actorId: string, workspaceId: string, email: string): Promise<string> {
  const token = `inv_planted_${stamp()}`
  await withActor(
    actorId,
    (tx) => tx`
      insert into invite (id, workspace_id, role, project_ids, email, rights, token_hash, created_by, expires_at)
      values (${uuidv7()}, ${workspaceId}, 'member'::role_kind, '{}', ${email}, '{}', ${hashToken(token)},
              ${actorId}, now() + interval '1 day')`,
  )
  return token
}

async function account(email: string) {
  const [u] = await asTableOwner()<{ confirmed: boolean; by_hand: boolean; hash: string | null }[]>`
    select email_verified_at is not null as confirmed, email_by_hand as by_hand, password_hash as hash
    from app_user where email = ${email}`
  return u
}

test('an invitation written as the application role, never delivered, confirms nothing', async () => {
  const mallory = await makeOwner()
  const victim = `victim-${stamp()}@corp.example`
  const token = await planted(mallory.ctx.actorId, mallory.workspaceId, victim)
  const before = outbox.length

  const joined = await call(`/auth/invite/${token}/accept`, null, { name: 'Victim', email: victim, password: PASSWORD })
  /* In, as a link with no address lets its holder in: one session. */
  assert.equal(joined.status, 200, JSON.stringify(joined.body))
  assert.equal(joined.body.created_account, true)

  const u = await account(victim)
  assert.equal(u?.confirmed, false, 'the address is not proved by a row anybody could write')
  assert.equal(u?.by_hand, false)
  assert.equal((await login(victim)).status, 403, 'signing in by password waits for the address’s own letter')
  /* And the letter that proves it went to the address, not to the planter. */
  assert.ok(
    outbox.slice(before).some((m) => m.to === victim),
    'the choose-a-password letter went to the address',
  )
})

test('the application role writes neither a delivery nor a following on an invitation, and runs no delivery', async () => {
  const { ctx, workspaceId } = await makeOwner()
  for (const [column, value] of [
    ['by_hand', 'true'],
    ['mailed_to', "'x@example.com'"],
    ['used_at', 'now()'],
    ['used_by', `'${ctx.actorId}'`],
  ] as const) {
    await assert.rejects(
      withActor(ctx.actorId, (tx) =>
        tx.unsafe(
          `insert into invite (id, workspace_id, role, token_hash, created_by, expires_at, ${column})
           values ($1, $2, 'member', $3, $4, now() + interval '1 day', ${value})`,
          [uuidv7(), workspaceId, `h-${stamp()}`, ctx.actorId],
        ),
      ),
      /permission denied/,
      column,
    )
    await assert.rejects(
      withActor(ctx.actorId, (tx) => tx.unsafe(`update invite set ${column} = ${value} where workspace_id = $1`, [workspaceId])),
      /permission denied/,
      `update ${column}`,
    )
  }
  const token = await planted(ctx.actorId, workspaceId, `who-${stamp()}@example.com`)
  await assert.rejects(
    withActor(ctx.actorId, (tx) => tx`select auth_invite_delivered(${hashToken(token)}, ${'who@example.com'}::citext, false)`),
    refused,
  )
})

test('an invitation the server mailed confirms the address it was mailed to, in any case', async () => {
  const { token } = await makeOwner()
  const to = `mailed-${stamp()}@example.com`
  const made = await call('/api/invites', token, { role: 'member', email: to, rights: [] })
  assert.equal(made.body.mailed, true)
  const [row] = await asTableOwner()<{ mailed_to: string | null; by_hand: boolean }[]>`
    select mailed_to::text, by_hand from invite where id = ${made.body.id}`
  assert.equal(row?.mailed_to, to, 'stamped by the sign-in role when the letter went')
  assert.equal(row?.by_hand, false)

  const letter = outbox.filter((m) => m.to === to).at(-1)!
  const link = decodeURIComponent(/\/invite\/([^\s"<]+)/.exec(letter.text)![1]!)
  const joined = await call(`/auth/invite/${link}/accept`, null, { name: 'Mai', email: to.toUpperCase(), password: PASSWORD })
  assert.equal(joined.status, 200, JSON.stringify(joined.body))
  const u = await account(to)
  assert.equal(u?.confirmed, true)
  assert.equal(u?.by_hand, false, 'a real proof, not a handed one')
  assert.equal((await login(to)).status, 200, 'the password typed with the mailed link is kept')
})

test('a resent invitation is stamped for its new link, and the old one never was', async () => {
  const { token } = await makeOwner()
  const to = `again-${stamp()}@example.com`
  const made = await call('/api/invites', token, { role: 'member', email: to, rights: [] })
  const again = await call(`/api/invites/${made.body.id}/resend`, token, {})
  assert.equal(again.status, 200, JSON.stringify(again.body))
  const rows = await asTableOwner()<{ id: string; mailed_to: string | null }[]>`
    select id, mailed_to::text from invite where id in (${made.body.id}, ${again.body.id})`
  assert.equal(rows.find((r) => r.id === again.body.id)?.mailed_to, to)
  const letter = outbox.filter((m) => m.to === to).at(-1)!
  const link = decodeURIComponent(/\/invite\/([^\s"<]+)/.exec(letter.text)![1]!)
  assert.equal((await call(`/auth/invite/${link}/accept`, null, { name: 'Ag', email: to, password: PASSWORD })).status, 200)
  assert.equal((await login(to)).status, 200)
})

test('a delivery is marked once, for the invitation’s own address and token, while it is open', async () => {
  const { ctx, workspaceId } = await makeOwner()
  const to = `once-${stamp()}@example.com`
  const token = await planted(ctx.actorId, workspaceId, to)
  const deliver = (hash: string, email: string, hand = false) =>
    asAuth(async (tx) => (await tx<{ ok: boolean }[]>`select auth_invite_delivered(${hash}, ${email}::citext, ${hand}) as ok`)[0]!.ok)
  assert.equal(await deliver(hashToken(token), `other-${stamp()}@example.com`), false, 'another address')
  assert.equal(await deliver(hashToken(`inv_${stamp()}`), to), false, 'a token nobody made')
  assert.equal(await deliver(hashToken(token), to.toUpperCase()), true)
  assert.equal(await deliver(hashToken(token), to, true), false, 'once: a mailed one is not then handed over')
  assert.equal(await deliver(hashToken(token), to), false)
})

/*
 * The takeover the review named: before 313 the planted invitation made a
 * confirmed account, and Google, vouching for the address, signed its owner
 * into it with the planter's password and sessions still good.
 */
test('a provider vouching for the address takes the planted account, password and sessions', async () => {
  const mallory = await makeOwner()
  const victim = `bob-${stamp()}@gmail.com`
  const token = await planted(mallory.ctx.actorId, mallory.workspaceId, victim)
  const squat = await call(`/auth/invite/${token}/accept`, null, { name: 'Bob', email: victim, password: PASSWORD })
  assert.equal(squat.status, 200)

  /* Bob signs in with Google, which owns gmail.com addresses. */
  const bob = await whoIs('google', `g-${stamp()}`, victim, true, 'Bob', true)
  assert.equal(typeof bob, 'object')
  assert.equal((bob as { actorId: string }).actorId, squat.body.actor_id, 'the account at his address is his')
  const u = await account(victim)
  assert.equal(u?.confirmed, true)
  assert.equal(u?.hash, null, 'Mallory’s password is gone')
  assert.equal((await login(victim)).status, 401)
  assert.equal((await call('/auth/refresh', null, { refresh_token: squat.body.refresh_token })).status, 401, 'and her session')
})

test('and arriving by another invitation through a provider, the same', async () => {
  const mallory = await makeOwner()
  const victim = `ann-${stamp()}@gmail.com`
  const token = await planted(mallory.ctx.actorId, mallory.workspaceId, victim)
  const squat = await call(`/auth/invite/${token}/accept`, null, { name: 'Ann', email: victim, password: PASSWORD })
  assert.equal(squat.status, 200)
  const other = await makeOwner()
  const link = await call('/api/invites', other.token, { role: 'member', rights: [] })
  const ann = await joinByProvider('google', link.body.token, `g-${stamp()}`, victim, true, 'Ann')
  assert.equal(typeof ann, 'object')
  assert.equal((await login(victim)).status, 401, 'the planter’s password no longer opens it')
})

test('a provider that does not own the address links nothing to the planted account', async () => {
  const mallory = await makeOwner()
  const victim = `cy-${stamp()}@corp.example`
  const token = await planted(mallory.ctx.actorId, mallory.workspaceId, victim)
  assert.equal((await call(`/auth/invite/${token}/accept`, null, { name: 'Cy', email: victim, password: PASSWORD })).status, 200)
  /* Google on a company domain without `hd`, or GitHub: seen, not owned. */
  assert.equal(await whoIs('google', `g-${stamp()}`, victim, true, 'Cy', false), 'conflict')
  assert.equal(await whoIs('github', `gh-${stamp()}`, victim, true, 'Cy', false), 'conflict')
})

/*
 * The independent review's L1: `citext` folds by the database's locale, so
 * a letter to a look-alike address — a dotted capital I, the Kelvin sign —
 * equalled the real one. Compared as ASCII now.
 */
test('a look-alike address is not the address: no delivery mark, no confirmation', async () => {
  const { ctx, workspaceId } = await makeOwner()
  const n = stamp()
  for (const [lookalike, real] of [
    [`vİctim-${n}@corp.example`, `victim-${n}@corp.example`],
    [`Kim-${n}@corp.example`, `kim-${n}@corp.example`],
  ] as const) {
    const token = await planted(ctx.actorId, workspaceId, lookalike)
    const deliver = (email: string) =>
      asAuth(
        async (tx) =>
          (await tx<{ ok: boolean }[]>`select auth_invite_delivered(${hashToken(token)}, ${email}::citext, false) as ok`)[0]!.ok,
      )
    assert.equal(await deliver(real), false, `${real} is not ${lookalike}`)
    /* Delivered to the look-alike, as if a letter had gone there; followed with the real address. */
    assert.equal(await deliver(lookalike), true)
    const joined = await call(`/auth/invite/${token}/accept`, null, { name: 'Vic', email: real, password: PASSWORD })
    assert.equal(joined.status, 200, JSON.stringify(joined.body))
    assert.equal((await account(real))?.confirmed, false, `a letter to ${lookalike} does not prove ${real}`)
  }
})

test('sending again mails only an address sending first would take', async () => {
  const owner = await makeOwner()
  const odd = `vİctim-${stamp()}@corp.example`
  await planted(owner.ctx.actorId, owner.workspaceId, odd)
  const [row] = await asTableOwner()<{ id: string }[]>`select id from invite where email::text = ${odd}`
  const again = await call(`/api/invites/${row!.id}/resend`, owner.token, {})
  assert.equal(again.status, 400)
  assert.equal(again.body.error.code, 'invalid')
  assert.equal(
    outbox.some((m) => m.to === odd),
    false,
    'nothing was mailed',
  )
  const [still] = await asTableOwner()<{ open: boolean }[]>`select deleted_at is null as open from invite where id = ${row!.id}`
  assert.equal(still?.open, true, 'and the one that was out is untouched')
})

test('the application role does not choose when an invitation was made', async () => {
  const { ctx, workspaceId } = await makeOwner()
  for (const column of ['created_at', 'updated_at']) {
    await assert.rejects(
      withActor(ctx.actorId, (tx) =>
        tx.unsafe(
          `insert into invite (id, workspace_id, role, token_hash, created_by, expires_at, ${column})
           values ($1, $2, 'member', $3, $4, now() + interval '1 day', now() - interval '1 year')`,
          [uuidv7(), workspaceId, `h-${stamp()}`, ctx.actorId],
        ),
      ),
      /permission denied/,
      column,
    )
  }
})
