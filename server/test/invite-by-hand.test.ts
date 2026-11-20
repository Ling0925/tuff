import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import postgres from 'postgres'
import { app } from '../src/http/routes.js'
import { edition } from '../src/edition.js'
import { edition as community } from '../src/edition.js'
import { env } from '../src/env.js'
import { outbox } from '../src/mail.js'
import { handsOver } from '../src/http/invites.js'
import { addPerson, bearerFor, closeDb, makeOwner, makeProject, stamp } from './helpers.js'

/*
 * An invitation handed over by hand.
 *
 * On a server of one's own that sends no mail, an invitation to an address
 * comes back with its own link for the inviter to pass on, and following it
 * proves the address as the mailed one does. Everywhere else the link that
 * proves an address goes to that address only, and the inviter never holds it.
 *
 * The community edition is put in the service's place in this process for
 * the tests that need it — `edition` is one object every module reads when
 * it asks, as `instance.test.ts` does — and put back after each. Mail is
 * whatever `env` says at the moment of asking, so it is cleared or pointed
 * at a port nothing listens on, and put back too. Each test file is its own
 * process, so none of this reaches another file.
 */
/* The service's edition, where this tree has it. The edition's own tree
   has only the community's (`edition.ts` is it there), so the service is
   stood in for by the same with a server's rules off — which is all these
   tests ask of it: sign-up open, nobody owning the server. */
/* Copied first: in the edition's own tree it is the same object as
   `edition`, which `helpers.ts` has turned the server's rules off on. */
const theCommunity = { ...community, instance: true }
const service = { ...edition, ...(edition.instance ? { instance: false } : {}) }
Object.assign(edition, service)
const mail = { resendApiKey: env.resendApiKey, smtp: env.smtp }
function asCommunity(withMail: boolean) {
  Object.assign(edition, theCommunity)
  env.resendApiKey = ''
  env.smtp = withMail ? { url: 'smtp://127.0.0.1:1', from: { name: 'Tuff', address: 'tuff@example.com' } } : null
}
function asService() {
  Object.assign(edition, service)
  Object.assign(env, mail)
}

/* As the table owner: what the application role may not read — `by_hand`
   is granted to nobody — and the test's own broom for an expiry. */
const db = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} })

after(async () => {
  asService()
  await db.end()
  await closeDb()
})

const PASSWORD = 'correct-horse-battery-staple'

async function call(path: string, token: string | null, body?: unknown) {
  const r = await app.request(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const text = await r.text()
  return { status: r.status, body: (text ? JSON.parse(text) : {}) as Record<string, any> }
}

const login = (email: string) => call('/auth/login', null, { email, password: PASSWORD })

/** An invitation to `email` from this owner, made on a server of one's own without mail. */
async function handed(token: string, email: string, project_ids: string[] = []) {
  asCommunity(false)
  try {
    const made = await call('/api/invites', token, { role: 'member', email, project_ids, rights: [] })
    assert.equal(made.status, 200, JSON.stringify(made.body))
    return made.body as { id: string; token: string; mailed: boolean }
  } finally {
    asService()
  }
}

test('the link is handed over only on a server of one’s own with no mail', () => {
  assert.equal(handsOver(true, false), true)
  assert.equal(handsOver(true, true), false, 'mail works: it is mailed')
  assert.equal(handsOver(false, false), false, 'the service, even with no mail key')
  assert.equal(handsOver(false, true), false)
})

test('on the service an invitation to an address never comes back with its link', async () => {
  const { token } = await makeOwner()
  const to = `service-${stamp()}@example.com`
  const made = await call('/api/invites', token, { role: 'member', email: to, rights: [] })
  assert.equal(made.status, 200)
  assert.equal(made.body.mailed, true)
  assert.equal(made.body.token, '', 'the link went to the address, and only there')
  /* The mailed link is still the one that works. */
  assert.ok(
    outbox
      .filter((m) => m.to === to)
      .at(-1)
      ?.text.includes('/invite/'),
  )
  /* A link with no address is the inviter's to pass on, as before. */
  const link = await call('/api/invites', token, { role: 'member', rights: [] })
  assert.match(link.body.token, /^inv_/)
})

test('where mail is set up, a server of one’s own mails it and shows no link — even when that send fails', async () => {
  const { token } = await makeOwner()
  asCommunity(true)
  try {
    const made = await call('/api/invites', token, { role: 'member', email: `smtp-${stamp()}@example.com`, rights: [] })
    assert.equal(made.status, 200)
    assert.equal(made.body.mailed, false, 'nothing listens on the port')
    assert.equal(made.body.token, '')
  } finally {
    asService()
  }
})

test('without mail the inviter gets the link, and following it confirms the address and lands in the workspace', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const project = await makeProject(ctx, workspaceId, 'Handed')
  const to = `handed-${stamp()}@example.com`
  const sentBefore = outbox.length
  const made = await handed(token, to, [project])
  assert.equal(made.mailed, false)
  assert.match(made.token, /^inv_/)
  assert.equal(outbox.slice(sentBefore).filter((m) => m.to === to).length, 0, 'nothing was sent anywhere')

  /* Kept as a hash only, and marked as handed over. */
  const [row] = await db<{ by_hand: boolean; email: string }[]>`
    select by_hand, email::text from invite where id = ${made.id}`
  assert.equal(row?.by_hand, true)
  const listed = await call('/api/invites', token)
  assert.equal(JSON.stringify(listed.body).includes(made.token), false, 'never listed again')

  /* The preview names the address, and the page fills it in. */
  const preview = await call(`/auth/invite/${made.token}`, null)
  assert.equal(preview.body.state, 'open')
  assert.equal(preview.body.email, to)

  const joined = await call(`/auth/invite/${made.token}/accept`, null, { name: 'Hana', email: to, password: PASSWORD })
  assert.equal(joined.status, 200, JSON.stringify(joined.body))
  assert.equal(joined.body.created_account, true)
  assert.equal(joined.body.workspace_id, workspaceId)
  const me = await call('/api/me', joined.body.access_token)
  assert.equal(me.body.workspace.id, workspaceId)
  /* Confirmed: signing in again works, with no mail ever sent. */
  assert.equal((await login(to)).status, 200)
  assert.equal(outbox.slice(sentBefore).filter((m) => m.to === to).length, 0, 'no confirmation link was needed')
})

test('a handed link is spent once, expires, and is for its own address', async () => {
  const { workspaceId, token } = await makeOwner()

  /* Reused. */
  const once = `once-${stamp()}@example.com`
  const a = await handed(token, once)
  assert.equal((await call(`/auth/invite/${a.token}/accept`, null, { name: 'Once', email: once, password: PASSWORD })).status, 200)
  const again = await call(`/auth/invite/${a.token}/accept`, null, { name: 'Once', email: once, password: PASSWORD })
  assert.equal(again.status, 404)

  /* Expired. */
  const late = `late-${stamp()}@example.com`
  const b = await handed(token, late)
  await db`update invite set expires_at = now() - interval '1 minute' where id = ${b.id}`
  const expired = await call(`/auth/invite/${b.token}/accept`, null, { name: 'Late', email: late, password: PASSWORD })
  assert.equal(expired.status, 404)
  assert.equal((await call(`/auth/invite/${b.token}`, null)).body.state, 'expired')

  /* Another address: refused, and left unspent for the address it names. */
  const meant = `meant-${stamp()}@example.com`
  const c = await handed(token, meant)
  const other = `other-${stamp()}@example.com`
  const wrong = await call(`/auth/invite/${c.token}/accept`, null, { name: 'Other', email: other, password: PASSWORD })
  assert.equal(wrong.status, 403)
  assert.equal(wrong.body.error.code, 'wrong_email')
  assert.equal(wrong.body.access_token, undefined)
  const [none] = await db<{ n: number }[]>`select count(*)::int as n from app_user where email = ${other}`
  assert.equal(none?.n, 0, 'no account was made for the other address')
  /* Signed in as somebody else, pressing join: refused the same way. */
  const stranger = await makeOwner()
  const pressed = await call(`/api/invite/${encodeURIComponent(c.token)}/join`, stranger.token, {})
  assert.equal(pressed.status, 403)
  assert.equal(pressed.body.error.code, 'wrong_email')
  /* Through a provider, a new account at another address: the same, said on the way back. */
  const { joinByProvider } = await import('../src/http/access.js')
  assert.equal(await joinByProvider('google', c.token, `g-${stamp()}`, `prov-${stamp()}@example.com`, true, 'Prov'), 'elsewhere')
  assert.equal((await call(`/auth/invite/${c.token}`, null)).body.state, 'open')
  const right = await call(`/auth/invite/${c.token}/accept`, null, { name: 'Meant', email: meant.toUpperCase(), password: PASSWORD })
  assert.equal(right.status, 200, 'the address it names, in any case')

  /* Another workspace: the link takes them into its own and nowhere else. */
  const [into] = await db<{ ws: string[] }[]>`
    select array_agg(m.workspace_id::text) as ws from membership m
    where m.actor_id = ${right.body.actor_id} and m.deleted_at is null`
  assert.deepEqual(into?.ws, [workspaceId])
  const elsewhere = await call(`/api/invite/${encodeURIComponent(c.token)}/join`, stranger.token, {})
  assert.equal(elsewhere.status, 404, 'spent: no second workspace is reached through it')
})

test('a mailed invitation is unchanged: its link still lets whoever holds it in with another address', async () => {
  const { outbox: sent } = await import('../src/mail.js')
  const { token } = await makeOwner()
  const to = `mailed-${stamp()}@example.com`
  await call('/api/invites', token, { role: 'member', email: to, rights: [] })
  const letter = sent.filter((m) => m.to === to).at(-1)!
  const link = /\/invite\/([^\s"<]+)/.exec(letter.text)![1]!
  const typed = `forwarded-${stamp()}@example.com`
  const joined = await call(`/auth/invite/${decodeURIComponent(link)}/accept`, null, { name: 'Fwd', email: typed, password: PASSWORD })
  assert.equal(joined.status, 200, 'in, as before')
  assert.equal((await login(typed)).status, 403, 'but the typed address still waits for its own link')
})

test('somebody who may not invite gets no link', async () => {
  const owner = await makeOwner()
  const member = await addPerson(owner.ctx, owner.workspaceId, 'member')
  const bearer = await bearerFor(member.actorId, owner.workspaceId)
  asCommunity(false)
  try {
    const r = await call('/api/invites', bearer, { role: 'member', email: `nope-${stamp()}@example.com`, rights: [] })
    assert.equal(r.status, 403)
    assert.equal(r.body.token, undefined)
  } finally {
    asService()
  }
  /* And nothing was written for it. */
  const [n] = await db<{ n: number }[]>`
    select count(*)::int as n from invite where workspace_id = ${owner.workspaceId} and created_by = ${member.actorId}`
  assert.equal(n?.n, 0)
})

/*
 * A review: a handed link is a weak proof. The inviter follows it
 * with a password of their own and has a confirmed account at somebody
 * else's address; when the address's owner arrives through Google, the
 * account is theirs, and the inviter's password and sessions are gone.
 */
test('an address proved only by a handed link is taken by a provider that vouches for it, password and all', async () => {
  const { joinByProvider } = await import('../src/http/access.js')
  const mallory = await makeOwner()
  const victim = `bob-${stamp()}@corp.example`
  const made = await handed(mallory.token, victim)
  const squat = await call(`/auth/invite/${made.token}/accept`, null, { name: 'Bob', email: victim, password: PASSWORD })
  assert.equal(squat.status, 200)
  /* Signing in by password works, as for any confirmed account. */
  assert.equal((await login(victim)).status, 200)
  const [weak] = await db<{ by_hand: boolean }[]>`select email_by_hand as by_hand from app_user where actor_id = ${squat.body.actor_id}`
  assert.equal(weak?.by_hand, true)

  /* Bob, invited elsewhere by a link with no address, arrives through Google. */
  const other = await makeOwner()
  const link = await call('/api/invites', other.token, { role: 'member', rights: [] })
  const bob = await joinByProvider('google', link.body.token, `g-${stamp()}`, victim, true, 'Bob')
  assert.equal(typeof bob, 'object')
  assert.equal((await login(victim)).status, 401, 'Mallory’s password no longer opens it')
  assert.equal((await call('/auth/refresh', null, { refresh_token: squat.body.refresh_token })).status, 401, 'nor her session')
  const [strong] = await db<{ by_hand: boolean; hash: string | null }[]>`
    select email_by_hand as by_hand, password_hash as hash from app_user where actor_id = ${squat.body.actor_id}`
  assert.equal(strong?.by_hand, false, 'the provider’s word is a real proof')
  assert.equal(strong?.hash, null)
})

test('a squatter’s own provider sign-in and open tickets go with the weak proof (migration 211)', async () => {
  const { joinByProvider } = await import('../src/http/access.js')
  const mallory = await makeOwner()
  const victim = `ann-${stamp()}@corp.example`
  const made = await handed(mallory.token, victim)
  const squat = await call(`/auth/invite/${made.token}/accept`, null, { name: 'Ann', email: victim, password: PASSWORD })
  assert.equal(squat.status, 200)
  const actor = squat.body.actor_id as string
  /* While the account is hers, Mallory links her own Apple sign-in and asks
     for an address change she can follow later. */
  const hers = `apple-mallory-${stamp()}`
  await db`select auth_identity_link(${actor}, 'apple', ${hers}, ${'mallory@else.example'})`
  await db`insert into auth_ticket (token_hash, kind, actor_id, expires_at)
           values (${`squat-${stamp()}`}, 'email', ${actor}, now() + interval '1 day')`

  const other = await makeOwner()
  const link = await call('/api/invites', other.token, { role: 'member', rights: [] })
  const ann = `g-ann-${stamp()}`
  assert.equal(typeof (await joinByProvider('google', link.body.token, ann, victim, true, 'Ann')), 'object')

  const ways = await db<{ provider: string; subject: string }[]>`
    select provider, subject from auth_identity where actor_id = ${actor}`
  assert.deepEqual(
    ways.map((w) => w.subject),
    [ann],
    'only the owner’s own Google is left',
  )
  const [open] = await db<{ n: number }[]>`
    select count(*)::int as n from auth_ticket where actor_id = ${actor} and used_at is null`
  assert.equal(open?.n, 0, 'no ticket of hers is still good')
})

test('an address proved only by a handed link is not one a server is handed to', async () => {
  const mallory = await makeOwner()
  const victim = `admin-${stamp()}@corp.example`
  const made = await handed(mallory.token, victim)
  assert.equal((await call(`/auth/invite/${made.token}/accept`, null, { name: 'Admin', email: victim, password: PASSWORD })).status, 200)
  /* As an owner of the server, in a transaction put back: the shared
     database keeps no owner row of this test's. */
  const said = await db
    .begin(async (tx) => {
      await tx`insert into instance_owner (actor_id) values (${mallory.ctx.actorId})`
      await tx`select set_config('app.actor_id', ${mallory.ctx.actorId}, true)`
      const [r] = await tx<{ said: string }[]>`select instance_add_owner(${victim}::citext) as said`
      throw Object.assign(new Error('put back'), { said: r?.said })
    })
    .catch((e: { said?: string }) => e.said)
  assert.equal(said, 'unconfirmed')
})

test('the application role revokes an invitation and can change nothing else on it', async () => {
  const { ctx, token } = await makeOwner()
  const made = await call('/api/invites', token, { role: 'member', rights: [] })
  const { withActor } = await import('./helpers.js')
  for (const set of ['by_hand = true', 'used_at = now()', "expires_at = now() + interval '1 year'", "email = 'x@example.com'"]) {
    await assert.rejects(
      withActor(ctx.actorId, (tx) => tx.unsafe(`update invite set ${set} where id = $1`, [made.body.id])),
      /permission denied/,
      set,
    )
  }
  assert.equal((await call(`/api/invites/${made.body.id}/revoke`, token, {})).status, 200)
})
