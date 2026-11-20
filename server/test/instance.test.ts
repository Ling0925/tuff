import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/*
 * The instance owner, and sign-up closed on your own server.
 *
 * On a database of its own, made and migrated here and dropped at the end:
 * the settings row is one per database, and the rules it turns on would
 * refuse the sign-ups of every other test file running beside this one on
 * the shared database. A fresh one is also what a fresh server is — no
 * accounts, never claimed — so "the first account" means what it says.
 *
 * The service's edition first, then the community edition's, put in its
 * place in this process: `edition` is one object every module reads at the
 * moment it asks, and the database is told it is a server of one's own the
 * way a community server tells it, by `edition.migrated` after migrating.
 */
const serverDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const { migrate } = await import('../src/db/migrate.js')
const shared = process.env.DATABASE_URL!
const admin = postgres(shared, { max: 1, onnotice: () => {} })
const DB = `tracker_instance_${randomUUID().replace(/-/g, '').slice(0, 12)}`
const at = (url: string) => {
  const u = new URL(url)
  u.pathname = `/${DB}`
  return u.href
}
/* What the end puts back, filled in as it is made — registered before the
   database is, so a migration that throws still leaves nothing behind. */
const ends: (() => Promise<unknown>)[] = []
after(async () => {
  for (const end of ends.reverse()) await end().catch((e: unknown) => console.error('[instance.test] cleanup', e))
  await admin.unsafe(`drop database if exists ${DB} with (force)`)
  await admin.end()
})
await admin.unsafe(`create database ${DB}`)
await migrate(at(shared))
process.env.DATABASE_URL = at(shared)
process.env.DATABASE_URL_APP = at(process.env.DATABASE_URL_APP ?? shared)
if (process.env.DATABASE_URL_WORKER) process.env.DATABASE_URL_WORKER = at(process.env.DATABASE_URL_WORKER)
/* GitHub sign-in on, before anything reads the environment. */
process.env.GITHUB_SIGNIN_CLIENT_ID = 'signin-id'
process.env.GITHUB_SIGNIN_CLIENT_SECRET = 'signin-secret'

const { edition } = await import('../src/edition.js')
const { edition: community } = await import('../src/edition.js')
const { app } = await import('../src/http/routes.js')
const { registerUser, signUp, issueApiToken, firstWorkspace } = await import('../src/auth/flows.js')
const { whoIs, joinByProvider } = await import('../src/http/access.js')
const { SignUpClosed } = await import('../src/instance.js')
const { authenticate, allowedActions } = await import('../src/auth/context.js')
const { outbox } = await import('../src/mail.js')
const { generateToken, hashPassword, hashToken } = await import('../src/auth/crypto.js')
const { closeDb, withoutActor, withActor, inWorkspace, bearerFor, makeProject } = await import('./helpers.js')

/* The service's edition, where this tree has it. The edition's own tree
   has only the community's (`edition.ts` is it there), so the service is
   stood in for by the same with a server's rules off — which is all these
   tests ask of it: sign-up open, nobody owning the server. */
/* Copied first: in the edition's own tree it is the same object as
   `edition`, which `helpers.ts` has turned the server's rules off on. */
const theCommunity = { ...community, instance: true }
const service = { ...edition, ...(edition.instance ? { instance: false } : {}) }
Object.assign(edition, service)
const asCommunity = () => Object.assign(edition, theCommunity)

/* As the table owner of this test's database: the application role can do
   none of this, which is the point — and a test says so below. */
const owner = postgres(at(shared), { max: 1, onnotice: () => {} })
ends.push(
  async () => Object.assign(edition, service),
  () => closeDb(),
  () => owner.end(),
)
/** Back to a server nobody has claimed. `truncate`, which the last-owner
    trigger does not see: it is the test's broom, not a way the app has. */
async function unclaimed(): Promise<void> {
  await owner`truncate instance_owner, instance_applicant`
  await owner`update instance_setting set claimed_at = null, sign_up_open = false`
}

/** What a start logs, while it runs. */
async function logged(start: () => Promise<unknown>): Promise<string[]> {
  const lines: string[] = []
  const [log, error] = [console.log, console.error]
  console.log = (...a: unknown[]) => void lines.push(a.join(' '))
  console.error = (...a: unknown[]) => void lines.push(a.join(' '))
  try {
    await start()
  } finally {
    console.log = log
    console.error = error
  }
  return lines
}

async function call(path: string, init: { method?: string; token?: string | null; body?: unknown } = {}) {
  const r = await app.request(path, {
    method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
    headers: {
      'content-type': 'application/json',
      ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  })
  const text = await r.text()
  return { status: r.status, body: (text ? JSON.parse(text) : {}) as Record<string, any>, headers: r.headers }
}

const uid = () => randomUUID().replace(/-/g, '').slice(0, 16)
const registration = (s: string) => ({
  name: `Ines ${s.slice(0, 4)}`,
  email: `ines${s}@example.com`,
  password: 'correct-horse-battery-staple',
  workspace_name: `Inst ${s}`,
})
const register = (s: string) => call('/auth/register', { body: registration(s) })
const script = (s = uid()) => registerUser({ ...registration(s), workspace_slug: `ins-${s}` })

async function accountOf(email: string): Promise<string | null> {
  const [r] = await withoutActor((tx) => tx<{ actor_id: string }[]>`select actor_id from auth_lookup_user(${email})`)
  return r?.actor_id ?? null
}
async function bearerOf(actorId: string): Promise<string> {
  const ws = await firstWorkspace(actorId)
  assert.ok(ws)
  return bearerFor(actorId, ws)
}
const owners = async () =>
  (await owner<{ actor_id: string }[]>`select actor_id from instance_owner order by added_at`).map((r) => r.actor_id)
const claimed = async () => (await owner<{ c: string | null }[]>`select claimed_at as c from instance_setting`)[0]!.c !== null
/** The sign-up letter's link mailed to an address — the one that asks for
    a password. */
const chooseLinkFor = (email: string) => {
  const m = [...outbox].reverse().find((x) => x.to === email && /\/reset\/chs_/.test(x.text))
  assert.ok(m, `no sign-up letter mailed to ${email}`)
  return decodeURIComponent(/\/reset\/(chs_[^\s]+)/.exec(m.text)![1]!)
}
/** The letter followed, as the person would: a password chosen, which is
    what confirms the address now. */
const confirm = (email: string) =>
  call('/auth/password/reset', { body: { token: chooseLinkFor(email), password: 'correct-horse-battery-staple' } })
const confirmed = async (id: string) => (await withoutActor((tx) => tx<{ ok: boolean }[]>`select auth_email_confirmed(${id}) as ok`))[0]!.ok

/* -------------------------------------------------------- the service */

test('on the service nothing changes: sign-up open, no owners, /api/instance is 404', async () => {
  assert.equal(edition.instance, false)
  /* The oldest account on the database is the one `pnpm dev:account`
     makes, as on a developer's machine — the start below must pass it by. */
  await registerUser({ ...registration(uid()), email: 'dev@example.com', workspace_slug: `dev-${uid()}` })
  const someone = await script()
  /* Signing up and confirming, with a provider or a link: no claim. */
  const s = uid()
  assert.equal((await register(s)).status, 202)
  assert.equal((await confirm(`ines${s}@example.com`)).status, 200)
  const viaGoogle = await whoIs('google', `g-svc-${uid()}`, `svc${uid()}@example.com`, true, 'Svc')
  assert.ok(viaGoogle && viaGoogle !== 'conflict')
  assert.deepEqual(await owners(), [])
  assert.equal(await claimed(), false)
  assert.equal((await call('/auth/providers')).body.sign_up, true)

  /* Even somebody put in the table by hand is nobody here, and is not kept
     from deleting their account by it. */
  await owner`insert into instance_owner (actor_id) values (${someone.actor_id})`
  assert.equal((await call('/api/instance', { token: someone.access_token })).status, 404)
  assert.equal((await call('/api/instance', { method: 'PATCH', token: someone.access_token, body: { sign_up_open: true } })).status, 404)
  const ctx = await authenticate(`Bearer ${someone.access_token}`)
  assert.ok(ctx)
  assert.equal(allowedActions(ctx).includes('instance'), false)
  const [d] = await withActor(someone.actor_id, (tx) => tx<{ d: { why?: string } }[]>`select delete_my_account(true) as d`)
  assert.notEqual(d?.d.why, 'last_instance_owner')
  await owner`truncate instance_owner`
})

/* -------------------------------------------------- your own server */

test('the first community start on a database with accounts names its oldest confirmed member, not the dev account', async () => {
  asCommunity()
  const [oldest] = await owner<{ actor_id: string; email: string }[]>`
    select u.actor_id, u.email::text from app_user u
    where u.email_verified_at is not null and u.email <> 'dev@example.com'
      and exists (select 1 from membership m where m.actor_id = u.actor_id and m.deleted_at is null and m.joined_at is not null)
    order by u.created_at, u.actor_id limit 1`
  const lines = await logged(() => edition.migrated(owner))
  assert.deepEqual(await owners(), [oldest!.actor_id])
  assert.ok(
    lines.some((l) => l.includes(oldest!.email)),
    lines.join('\n'),
  )
  /* Asked again, it names nobody new. */
  await edition.migrated(owner)
  assert.equal((await owners()).length, 1)
})

test('a start with the flag unset sets it, and until then sign-up is closed', async () => {
  asCommunity()
  await owner`update instance_setting set community = false`
  /* The edition that is a server of its own takes an unset flag as closed. */
  assert.equal((await call('/auth/providers')).body.sign_up, false)
  assert.equal((await register(uid())).status, 403)
  await assert.rejects(whoIs('google', `g-unset-${uid()}`, `unset${uid()}@example.com`, true, 'U'), SignUpClosed)
  /* Before serving, every start — migrated then or not. */
  await edition.ready(owner)
  const [r] = await owner<{ c: boolean }[]>`select community as c from instance_setting`
  assert.equal(r?.c, true)
})

test('a restart with no owner who can sign in names nobody, and says so', async () => {
  asCommunity()
  await owner`truncate instance_owner`
  assert.equal(await claimed(), true)
  let lines = await logged(() => edition.ready(owner))
  assert.deepEqual(await owners(), [])
  assert.ok(
    lines.some((e) => /NO OWNER/.test(e) && /instance:owner/.test(e)),
    lines.join('\n'),
  )

  /* An owner row with no live workspace is no owner who can sign in. */
  const lone = randomUUID()
  await owner`insert into actor (id, name) values (${lone}, 'Lone')`
  await owner`insert into instance_owner (actor_id) values (${lone})`
  lines = await logged(() => edition.ready(owner))
  assert.ok(
    lines.some((e) => /NO OWNER/.test(e)),
    lines.join('\n'),
  )
  await owner`truncate instance_owner`

  /* The way back, as the command line takes it. */
  const someone = await script()
  const email = (await owner<{ e: string }[]>`select email::text as e from app_user where actor_id = ${someone.actor_id}`)[0]!.e
  const [r] = await owner<{ a: string | null }[]>`select instance_name_owner(${email}::citext, ${`recovery-${randomUUID()}`}) as a`
  assert.equal(r?.a, someone.actor_id)
  assert.deepEqual(await owners(), [someone.actor_id])
  lines = await logged(() => edition.ready(owner))
  assert.ok(!lines.some((e) => /NO OWNER/.test(e)), lines.join('\n'))
})

test('the application role cannot make itself an owner', async () => {
  asCommunity()
  await unclaimed()
  const old = await script()
  await assert.rejects(
    withoutActor((tx) => tx`insert into instance_owner (actor_id) values (${old.actor_id})`),
    /permission denied/,
  )
  await assert.rejects(
    withoutActor((tx) => tx`insert into instance_applicant (actor_id) values (${old.actor_id})`),
    /permission denied/,
  )
  await assert.rejects(
    withoutActor((tx) => tx`update instance_setting set sign_up_open = true`),
    /permission denied/,
  )
  await assert.rejects(
    withoutActor((tx) => tx`select * from instance_owner`),
    /permission denied/,
  )
  for (const f of ['instance_started(null, true)', `instance_name_owner('x@example.com', 'a-hash-of-twenty-or-more')`]) {
    await assert.rejects(
      withoutActor((tx) => tx.unsafe(`select ${f}`)),
      /permission denied/,
      f,
    )
  }
  /* Un-confirming an old account and confirming it again — which the app
     role may write, as the account itself — claims nothing: it never asked
     to sign up. */
  const undone = await withActor(old.actor_id, (tx) => tx`update app_user set email_verified_at = null where actor_id = ${old.actor_id}`)
  assert.equal(undone.count, 1, 'the account’s own row, written as the account')
  await withoutActor((tx) => tx`select auth_confirm_email(${old.actor_id})`)
  assert.equal(await confirmed(old.actor_id), true)
  /* Nor does somebody who is not an owner name one, or open sign-up. */
  const [said] = await withActor(
    old.actor_id,
    (tx) => tx<{ a: string; b: boolean }[]>`
    select instance_add_owner('x@example.com'::citext) as a, instance_set_sign_up(true) as b`,
  )
  assert.equal(said?.a, 'forbidden')
  assert.equal(said?.b, false)
  assert.deepEqual(await owners(), [])
  assert.equal(await claimed(), false)
})

test('an account made on somebody’s behalf never claims the server', async () => {
  asCommunity()
  await unclaimed()
  await script()
  /* Even made through `register_owner` itself, confirmed, by a script. */
  const id = randomUUID()
  await withoutActor(
    (tx) => tx`select register_owner(${id}, 'Script', ${`s${uid()}@example.com`}, null,
    ${randomUUID()}, 'Script', ${`scr-${uid()}`}, true, false)`,
  )
  assert.deepEqual(await owners(), [])
  assert.equal(await claimed(), false)
  assert.equal((await call('/auth/providers')).body.sign_up, true)
})

test('the server is claimed when the first address is confirmed, not when it signs up', async () => {
  asCommunity()
  await unclaimed()
  const a = uid()
  const b = uid()
  const c = uid()
  assert.equal((await register(a)).status, 202)
  assert.equal((await register(b)).status, 202)
  assert.equal((await register(c)).status, 202)
  /* Registered and not confirmed: nobody owns it, and sign-up is still open. */
  assert.deepEqual(await owners(), [])
  assert.equal((await call('/auth/providers')).body.sign_up, true)

  const first = await confirm(`ines${a}@example.com`)
  assert.equal(first.status, 200, JSON.stringify(first.body))
  const aId = (await accountOf(`ines${a}@example.com`))!
  assert.deepEqual(await owners(), [aId])
  assert.equal((await call('/auth/providers')).body.sign_up, false)

  /* Registered before the claim, confirmed after it: refused, still unconfirmed —
     by the link, and by a provider vouching for the address. */
  const late = await confirm(`ines${b}@example.com`)
  assert.equal(late.status, 403)
  assert.equal(late.body.error.code, 'sign_up_closed')
  const bId = (await accountOf(`ines${b}@example.com`))!
  assert.equal(await confirmed(bId), false)
  await assert.rejects(whoIs('google', `g-late-${b}`, `ines${b}@example.com`, true, 'B'), SignUpClosed)
  assert.equal(await confirmed(bId), false)
  /* Unless an invitation waits for that address. */
  const token = await bearerOf(aId)
  const ctx = await authenticate(`Bearer ${token}`)
  const ws = await firstWorkspace(aId)
  const project = await makeProject(ctx!, ws!, 'Inv')
  const made = await call('/api/invites', { token, body: { role: 'member', project_ids: [project], email: `ines${c}@example.com` } })
  assert.ok(made.status < 300, JSON.stringify(made.body))
  assert.equal((await confirm(`ines${c}@example.com`)).status, 200)
  assert.deepEqual(await owners(), [aId])
})

test('only a live invitation to that address lets a late applicant in', async () => {
  asCommunity()
  const [first] = await owners()
  const token = await bearerOf(first!)
  const ctx = await authenticate(`Bearer ${token}`)
  const ws = await firstWorkspace(first!)
  const project = await makeProject(ctx!, ws!, 'Late')
  /* Five who signed up while it was open, then it closed. */
  await owner`update instance_setting set sign_up_open = true`
  const [link, expired, used, gone, left] = Array.from({ length: 5 }, () => uid())
  for (const x of [link, expired, used, gone, left]) assert.equal((await register(x!)).status, 202)
  await owner`update instance_setting set sign_up_open = false`
  const invite = async (bearer: string, projectId: string, email?: string) => {
    const made = await call('/api/invites', {
      token: bearer,
      body: { role: 'member', project_ids: [projectId], ...(email ? { email } : {}) },
    })
    assert.ok(made.status < 300, JSON.stringify(made.body))
    return made.body.id as string
  }
  const refused = async (s: string) => {
    const r = await confirm(`ines${s}@example.com`)
    assert.equal(r.status, 403, `${s}: ${JSON.stringify(r.body)}`)
    assert.equal(r.body.error.code, 'sign_up_closed')
  }

  /* An invitation by link names no address: it does not count. */
  await invite(token, project)
  await refused(link!)
  /* Expired, or already used. */
  const e = await invite(token, project, `ines${expired}@example.com`)
  await owner`update invite set expires_at = now() - interval '1 day' where id = ${e}`
  await refused(expired!)
  const u = await invite(token, project, `ines${used}@example.com`)
  await owner`update invite set used_at = now() where id = ${u}`
  await refused(used!)
  /* In a workspace deleted since. */
  const other = await script()
  const otherCtx = await authenticate(`Bearer ${other.access_token}`)
  const otherWs = await firstWorkspace(other.actor_id)
  const otherProject = await makeProject(otherCtx!, otherWs!, 'Gone')
  await invite(other.access_token, otherProject, `ines${gone}@example.com`)
  await owner`update workspace set deleted_at = now() where id = ${otherWs}`
  await refused(gone!)
  /* From somebody no longer in the workspace. */
  const inviter = await script()
  const inviterWs = await firstWorkspace(inviter.actor_id)
  const inviterCtx = await authenticate(`Bearer ${inviter.access_token}`)
  const inviterProject = await makeProject(inviterCtx!, inviterWs!, 'Left')
  await invite(inviter.access_token, inviterProject, `ines${left}@example.com`)
  await owner`update membership set deleted_at = now() where actor_id = ${inviter.actor_id} and workspace_id = ${inviterWs}`
  await refused(left!)
  assert.deepEqual(await owners(), [first])
})

test('after the claim, sign-up is closed on every path', async () => {
  asCommunity()
  const [first] = await owners()
  assert.ok(first)
  const s = uid()
  const r = await register(s)
  assert.equal(r.status, 403)
  assert.equal(r.body.error.code, 'sign_up_closed')
  assert.equal(await accountOf(`ines${s}@example.com`), null)

  for (const p of ['google', 'apple', 'github'] as const) {
    const email = `${p}${uid()}@example.com`
    await assert.rejects(whoIs(p, `${p}-${uid()}`, email, true, 'New'), SignUpClosed)
    assert.equal(await accountOf(email), null)
  }
  /* `register_owner` called straight, as the application role: refused,
     and nothing made — the database's rule, not a route's. */
  const id = randomUUID()
  await assert.rejects(
    withoutActor(
      (tx) => tx`select register_owner(${id}, 'Direct', ${`d${uid()}@example.com`}, null,
      ${randomUUID()}, 'Direct', ${`dir-${uid()}`})`,
    ),
    /sign_up_closed/,
  )
  assert.equal((await owner`select 1 from actor where id = ${id}`).length, 0)
  /* A script is still let in, and is no owner. */
  await script()
  assert.deepEqual(await owners(), [first])
})

test('a new GitHub account is sent back with oauth=closed', async () => {
  asCommunity()
  const id = 8_000_000 + Math.floor(Math.random() * 1_000_000)
  const email = `octo${id}@example.com`
  const real = globalThis.fetch
  let challenge = ''
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const json = (b: unknown) => new Response(JSON.stringify(b), { headers: { 'content-type': 'application/json' } })
    if (url === 'https://github.com/login/oauth/access_token') {
      const f = Object.fromEntries(new URLSearchParams(String(init?.body ?? '')))
      const ok =
        createHash('sha256')
          .update(f.code_verifier ?? '')
          .digest('base64url') === challenge
      return json(ok ? { access_token: 'gho_x' } : { error: 'invalid_grant' })
    }
    if (url.startsWith('https://api.github.com/applications/')) return new Response(null, { status: 204 })
    if (url === 'https://api.github.com/user') return json({ id, login: `octo${id}`, name: 'Octo' })
    if (url === 'https://api.github.com/user/emails') return json([{ email, primary: true, verified: true }])
    return real(input, init)
  }) as typeof fetch
  try {
    const start = await app.request('/auth/oauth/github/start', { headers: { 'sec-fetch-site': 'same-origin' } })
    assert.equal(start.status, 302)
    const cookie = (start.headers.get('set-cookie') ?? '').split(';')[0]!
    const to = new URL(start.headers.get('location')!)
    challenge = to.searchParams.get('code_challenge')!
    const back = await app.request(`/auth/oauth/github/callback?code=c&state=${to.searchParams.get('state')}`, { headers: { cookie } })
    assert.equal(back.status, 302)
    assert.equal(back.headers.get('location'), '/signin?oauth=closed')
    assert.equal(await accountOf(email), null)
  } finally {
    globalThis.fetch = real
  }
})

test('an invitation still makes an account, with a password or a provider', async () => {
  asCommunity()
  const [first] = await owners()
  const token = await bearerOf(first!)
  const ws = await firstWorkspace(first!)
  const ctx = await authenticate(`Bearer ${token}`)
  const project = await makeProject(ctx!, ws!, `Inst ${uid().slice(0, 4)}`)
  const invite = async () => {
    const made = await call('/api/invites', { token, body: { role: 'member', project_ids: [project] } })
    assert.ok(made.status < 300, JSON.stringify(made.body))
    return made.body.token as string
  }
  const s = uid()
  const joined = await call(`/auth/invite/${await invite()}/accept`, {
    body: { name: 'Robin', email: `robin${s}@example.com`, password: 'correct-horse-battery-staple' },
  })
  assert.equal(joined.status, 200, JSON.stringify(joined.body))
  assert.equal(joined.body.created_account, true)
  const email = `prov${uid()}@example.com`
  const byProvider = await joinByProvider('google', await invite(), `g-inv-${uid()}`, email, true, 'Pat')
  assert.ok(byProvider && typeof byProvider === 'object')
  assert.equal(byProvider.workspaceId, ws)
  assert.deepEqual(await owners(), [first])
})

/*
 * finding 8: closed sign-up bounded the forms and not the other
 * door — any member could make a workspace, own it, and invite anybody.
 */
test('on a closed server only its owners make a workspace; with sign-up open anybody may', async () => {
  asCommunity()
  const [first] = await owners()
  const ownerToken = await bearerOf(first!)
  const other = await script()
  const make = (token: string) => call('/api/workspaces', { token, body: { name: `More ${uid().slice(0, 4)}` } })

  const ctx = await authenticate(`Bearer ${other.access_token}`)
  assert.ok(ctx && !allowedActions(ctx).includes('workspace.create'), 'the screen is told, as the server decides')
  const refused = await make(other.access_token)
  assert.equal(refused.status, 403)
  assert.equal(refused.body.error.code, 'owners_only')
  /* And the database, whatever a route forgets. */
  await assert.rejects(
    withoutActor((tx) => tx`select new_workspace(${other.actor_id}, ${randomUUID()}, 'Back door', null, 'solo', null, null)`),
    /sign_up_closed/,
  )
  const mine = await make(ownerToken)
  assert.equal(mine.status, 201)
  /* Put away again: the owner's one workspace is what the tests below are about. */
  await owner`update workspace set deleted_at = now() where slug = ${mine.body.slug as string}`

  /* Sign-up open is anybody's account, and so anybody's workspace. */
  await call('/api/instance', { method: 'PATCH', token: ownerToken, body: { sign_up_open: true } })
  try {
    assert.equal((await make(other.access_token)).status, 201)
  } finally {
    await call('/api/instance', { method: 'PATCH', token: ownerToken, body: { sign_up_open: false } })
  }
})

test('the owner opens sign-up, names and removes owners, never the last, and tests mail', async () => {
  asCommunity()
  const [first] = await owners()
  const token = await bearerOf(first!)
  const read = await call('/api/instance', { token })
  assert.equal(read.status, 200)
  assert.equal(read.body.sign_up_open, false)
  assert.deepEqual(
    read.body.owners.map((o: { actor_id: string }) => o.actor_id),
    [first],
  )
  const ctx = await authenticate(`Bearer ${token}`)
  assert.ok(ctx && allowedActions(ctx).includes('instance'))

  const other = await script()
  for (const [method, path, body] of [
    ['GET', '/api/instance', undefined],
    ['PATCH', '/api/instance', { sign_up_open: true }],
    ['POST', '/api/instance/owners', { email: 'x@example.com' }],
    ['DELETE', `/api/instance/owners/${first}`, undefined],
    ['POST', '/api/instance/test-letter', {}],
  ] as const) {
    assert.equal((await call(path, { method, token: other.access_token, body })).status, 404, `${method} ${path}`)
  }
  const ws = await firstWorkspace(first!)
  await owner`update workspace set plan = 'unlimited' where id = ${ws}`
  const tok = await issueApiToken(first!, ws!, 'agent')
  assert.equal((await call('/api/instance', { token: tok })).status, 404)

  /* The switch reopens sign-up, and closes it. */
  assert.equal((await call('/api/instance', { method: 'PATCH', token, body: { sign_up_open: true } })).body.sign_up_open, true)
  assert.equal((await call('/auth/providers')).body.sign_up, true)
  assert.equal((await register(uid())).status, 202)
  const viaGoogle = await whoIs('google', `g-open-${uid()}`, `open${uid()}@example.com`, true, 'Open')
  assert.ok(viaGoogle && viaGoogle !== 'conflict')
  await call('/api/instance', { method: 'PATCH', token, body: { sign_up_open: false } })
  assert.equal((await register(uid())).status, 403)

  const unknown = await call('/api/instance/owners', { token, body: { email: `nobody${uid()}@example.com` } })
  assert.equal(unknown.status, 404)
  /* An account whose address nobody proved is not handed the server. */
  const pending = uid()
  await call('/api/instance', { method: 'PATCH', token, body: { sign_up_open: true } })
  assert.equal((await register(pending)).status, 202)
  await call('/api/instance', { method: 'PATCH', token, body: { sign_up_open: false } })
  const unproved = await call('/api/instance/owners', { token, body: { email: `ines${pending}@example.com` } })
  assert.equal(unproved.status, 409)
  assert.equal(unproved.body.error.code, 'unconfirmed')
  const otherEmail = (await owner<{ e: string }[]>`select email::text as e from app_user where actor_id = ${other.actor_id}`)[0]!.e
  const added = await call('/api/instance/owners', { token, body: { email: otherEmail } })
  assert.equal(added.status, 201)
  assert.equal((await call('/api/instance', { token: other.access_token })).status, 200)
  const removed = await call(`/api/instance/owners/${other.actor_id}`, { method: 'DELETE', token })
  assert.equal(removed.status, 200)
  const last = await call(`/api/instance/owners/${first}`, { method: 'DELETE', token })
  assert.equal(last.status, 409)
  assert.equal(last.body.error.code, 'last_owner')

  /* Two owners removing each other at once leave one. */
  await call('/api/instance/owners', { token, body: { email: otherEmail } })
  const both = await Promise.all([
    call(`/api/instance/owners/${other.actor_id}`, { method: 'DELETE', token }),
    call(`/api/instance/owners/${first}`, { method: 'DELETE', token: other.access_token }),
  ])
  assert.equal(both.filter((r) => r.status === 200).length, 1, JSON.stringify(both.map((r) => r.status)))
  assert.equal((await owners()).length, 1)
  if ((await owners())[0] !== first) {
    await owner`truncate instance_owner`
    await owner`insert into instance_owner (actor_id) values (${first!})`
  }

  /* The last owner does not delete their account. */
  const [d] = await withActor(first!, (tx) => tx<{ d: { why?: string } }[]>`select delete_my_account(true) as d`)
  assert.equal(d?.d.why, 'last_instance_owner')

  /* A test letter, to the owner's own address and nobody else's. */
  const before = outbox.length
  const letter = await call('/api/instance/test-letter', { token, body: { to: 'stranger@example.com' } })
  assert.equal(letter.status, 200)
  const sent = outbox.slice(before)
  const mine = (await owner<{ e: string }[]>`select email::text as e from app_user where actor_id = ${first!}`)[0]!.e
  assert.deepEqual(
    sent.map((m) => m.to),
    [mine],
  )
})

test('the last owner who can sign in cannot delete their last workspace', async () => {
  asCommunity()
  const [first] = await owners()
  const token = await bearerOf(first!)
  const ws = await firstWorkspace(first!)
  const dry = await call('/api/workspace/delete', { token, body: { dry: true } })
  assert.equal(dry.status, 409, JSON.stringify(dry.body))
  assert.equal(dry.body.error.code, 'last_instance_owner')
  const [d] = await inWorkspace(first!, ws!, (tx) => tx<{ d: { ok: boolean; why?: string } }[]>`select delete_workspace(false) as d`)
  assert.equal(d?.d.why, 'last_instance_owner')
  const [still] = await owner<{ deleted_at: string | null }[]>`select deleted_at from workspace where id = ${ws}`
  assert.equal(still?.deleted_at, null)
  /* With another owner who can sign in, it is theirs to delete. */
  const other = await script()
  await owner`insert into instance_owner (actor_id) values (${other.actor_id})`
  assert.equal((await call('/api/workspace/delete', { token, body: { dry: true } })).status, 200)
  await owner`delete from instance_owner where actor_id = ${other.actor_id}`
})

test('two owners deleting their accounts at once leave one owner', async () => {
  asCommunity()
  const [first] = await owners()
  const a = await script()
  const b = await script()
  await owner`insert into instance_owner (actor_id) values (${a.actor_id}), (${b.actor_id})`
  /* Three owners; the first stays out of it. Take it out of the count. */
  await owner`delete from instance_owner where actor_id = ${first!}`
  const tries = await Promise.allSettled([
    withActor(a.actor_id, (tx) => tx<{ d: { ok: boolean; why?: string } }[]>`select delete_my_account(false) as d`),
    withActor(b.actor_id, (tx) => tx<{ d: { ok: boolean; why?: string } }[]>`select delete_my_account(false) as d`),
  ])
  const said = tries.map((t) => (t.status === 'fulfilled' ? t.value[0]!.d : { ok: false, why: String(t.reason) }))
  assert.equal(said.filter((d) => d.ok).length, 1, JSON.stringify(said))
  assert.ok(
    said.some((d) => d.why === 'last_instance_owner'),
    JSON.stringify(said),
  )
  assert.equal((await owners()).length, 1)

  /* And one removing the other while deleting their own account. */
  const [left] = await owners()
  const c = await script()
  await owner`insert into instance_owner (actor_id) values (${c.actor_id})`
  await Promise.allSettled([
    withActor(left!, (tx) => tx`select instance_remove_owner(${c.actor_id})`),
    withActor(left!, (tx) => tx`select delete_my_account(false)`),
  ])
  assert.ok((await owners()).length >= 1)

  /* Nor does any other way take the last one: a delete as the table owner,
     or the sweep of actors with nothing left. */
  await owner`truncate instance_owner`
  await owner`insert into instance_owner (actor_id) values (${first!})`
  await assert.rejects(owner`delete from instance_owner`, /last_owner/)
  const lone = randomUUID()
  await owner`insert into actor (id, name) values (${lone}, 'Lone')`
  await owner`insert into instance_owner (actor_id) values (${lone})`
  await owner`select purge_orphan_actors()`
  assert.ok((await owners()).includes(lone))
  await owner`delete from instance_owner where actor_id = ${lone}`
})

test('racing the first confirmation makes one owner, never two or none', async () => {
  asCommunity()
  await unclaimed()
  /* Six by email, registered while open, their links followed at once. */
  const tries = Array.from({ length: 6 }, () => uid())
  for (const s of tries) await signUp(registration(s))
  /* `signUp` mails nothing; confirm as the link does. */
  const ids = await Promise.all(tries.map((s) => accountOf(`ines${s}@example.com`)))
  const confirms = await Promise.allSettled(ids.map((id) => withoutActor((tx) => tx`select auth_confirm_email(${id!})`)))
  const won = confirms.findIndex((r) => r.status === 'fulfilled')
  assert.equal(confirms.filter((r) => r.status === 'fulfilled').length, 1)
  assert.ok(confirms.every((r) => r.status === 'fulfilled' || /sign_up_closed/.test(String(r.reason))))
  assert.deepEqual(await owners(), [ids[won]])
})

test('a provider never claims a server nobody owns: not a new account, not an applicant it vouches for', async () => {
  asCommunity()
  await unclaimed()
  /* The server's name is public as soon as it has a certificate, and
     anybody has a Google account. Six at once: every one refused, nothing
     made, nobody an owner. */
  const emails = Array.from({ length: 6 }, () => `prov${uid()}@example.com`)
  const results = await Promise.allSettled(emails.map((e) => whoIs('google', `g-prov-${uid()}`, e, true, 'Prov')))
  assert.ok(
    results.every((r) => r.status === 'rejected' && r.reason instanceof SignUpClosed),
    JSON.stringify(results.map((r) => r.status)),
  )
  for (const e of emails) assert.equal(await accountOf(e), null)
  for (const p of ['apple', 'github'] as const) {
    await assert.rejects(whoIs(p, `${p}-prov-${uid()}`, `prov${uid()}@example.com`, true, 'Prov'), SignUpClosed)
  }
  assert.deepEqual(await owners(), [])
  assert.equal(await claimed(), false)
  /* Sign-up stays open for the email form, which is how the owner comes in. */
  assert.equal((await call('/auth/providers')).body.sign_up, true)

  /* Signed up by email, then vouched for by Google before the link was
     followed: refused, still unconfirmed, still nobody's server. */
  const s = uid()
  assert.equal((await register(s)).status, 202)
  const id = (await accountOf(`ines${s}@example.com`))!
  await assert.rejects(whoIs('google', `g-app-${s}`, `ines${s}@example.com`, true, 'Ines'), SignUpClosed)
  assert.equal(await confirmed(id), false)
  assert.deepEqual(await owners(), [])

  /* The link claims it, as it always did — and after that a provider is
     refused for closed sign-up, and let in once the owner opens it. */
  assert.equal((await confirm(`ines${s}@example.com`)).status, 200)
  assert.deepEqual(await owners(), [id])
  await assert.rejects(whoIs('google', `g-after-${uid()}`, `after${uid()}@example.com`, true, 'After'), SignUpClosed)
  await owner`update instance_setting set sign_up_open = true`
  const later = await whoIs('google', `g-open2-${uid()}`, `open2${uid()}@example.com`, true, 'Open')
  assert.ok(later && later !== 'conflict')
  assert.deepEqual(await owners(), [id])
})

/* `pnpm --filter @tracker/server instance:owner <email>`, as the machine
   runs it, against this test's database. No terminal: `--yes`, or it asks
   nobody and refuses. */
function nameOwner(email: string, yes = true) {
  return spawnSync(process.execPath, ['--import', 'tsx', join(serverDir, 'src', 'instanceOwner.ts'), email, ...(yes ? ['--yes'] : [])], {
    cwd: serverDir,
    env: { ...process.env, APP_URL: 'https://tuff.example.com' },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}
const resetLink = (out: string) => {
  const m = /https:\/\/tuff\.example\.com\/reset\/(\S+)/.exec(out)
  assert.ok(m, `no reset link in: ${out}`)
  return decodeURIComponent(m[1]!)
}

test('a server with no mail is claimed from the command line, and a squatter’s password does not come with it', async () => {
  asCommunity()
  await unclaimed()
  /* The start says how, and gives no link. */
  let lines = await logged(() => edition.ready(owner))
  const told = lines.filter((l) => /No mail is set up/.test(l))
  assert.equal(told.length, 1, lines.join('\n'))
  assert.match(told[0]!, /Sign up, then run pnpm --filter @tracker\/server instance:owner you@example\.com/)
  assert.match(told[0]!, /server\/dist\/instanceOwner\.js you@example\.com/)
  assert.doesNotMatch(told[0]!, /reset|verify|http|token/i)

  /* A stranger signs up first with the admin's address; the admin signs up
     after, and is answered as everybody is. */
  const s = uid()
  const squatter = { ...registration(s), name: 'Squatter', password: 'the-squatters-own-password' }
  assert.equal((await call('/auth/register', { body: squatter })).status, 202)
  const admin = { ...registration(s), name: 'Admin' }
  assert.equal((await call('/auth/register', { body: admin })).status, 202)
  const login = (password: string) => call('/auth/login', { body: { email: admin.email, password } })
  /* Nothing they typed was kept: not even "confirm first". */
  assert.equal((await login(squatter.password)).status, 401, 'no password kept')

  /* Nobody at a terminal, no --yes: asks nobody, does nothing. */
  const asked = nameOwner(admin.email, false)
  assert.equal(asked.status, 1)
  assert.match(asked.stderr, /add --yes/)
  assert.deepEqual(await owners(), [])

  const r = nameOwner(admin.email)
  assert.equal(r.status, 0, r.stderr)
  /* Said back first: the address, the account's name and when it was made. */
  assert.match(r.stdout.split('\n')[0]!, new RegExp(`^The account ${admin.email.replace('.', '\\.')}, named "Squatter", made \\d{4}-`))
  const id = (await accountOf(admin.email))!
  assert.deepEqual(await owners(), [id])
  assert.equal(await claimed(), true)
  assert.equal(await confirmed(id), true)

  /* Whoever typed the password before cannot use it now. */
  const shut = await login(squatter.password)
  assert.ok(shut.status === 401 || shut.status === 403, `${shut.status} ${JSON.stringify(shut.body)}`)
  /* The link printed to the terminal is the way in. */
  const token = resetLink(r.stdout)
  const set = await call('/auth/password/reset', { body: { token, password: 'the-admins-new-password' } })
  assert.equal(set.status, 200, JSON.stringify(set.body))
  assert.equal((await login('the-admins-new-password')).status, 200)
  assert.equal((await login(squatter.password)).status, 401)
  const ctx = await authenticate(`Bearer ${await bearerOf(id)}`)
  assert.equal(ctx?.instanceOwner, true)
  /* Once. */
  assert.equal((await call('/auth/password/reset', { body: { token, password: 'a-third-password-here' } })).status, 410)

  /* Claimed now: the start says nothing more about it. */
  lines = await logged(() => edition.ready(owner))
  assert.ok(!lines.some((l) => /No mail is set up/.test(l)), lines.join('\n'))
})

test('the command refuses a claimed server, the service, the dev account and an account made on somebody’s behalf', async () => {
  asCommunity()
  /* Claimed, with an owner who can sign in: owners add owners in Server
     settings — an account made for somebody, and a late applicant, alike. */
  assert.equal(await claimed(), true)
  const before = await owners()
  const other = await script()
  const otherEmail = (await owner<{ e: string }[]>`select email::text as e from app_user where actor_id = ${other.actor_id}`)[0]!.e
  const refused = nameOwner(otherEmail)
  assert.equal(refused.status, 1)
  assert.match(refused.stderr, /already has an owner who can sign in/)
  assert.doesNotMatch(refused.stdout, /reset/)
  await owner`update instance_setting set sign_up_open = true`
  const late = uid()
  assert.equal((await register(late)).status, 202)
  await owner`update instance_setting set sign_up_open = false`
  assert.equal(nameOwner(`ines${late}@example.com`).status, 1)
  assert.deepEqual(await owners(), before)

  /* Not claimed: never one made on somebody's behalf, never the dev account. */
  await unclaimed()
  const made = nameOwner(otherEmail)
  assert.equal(made.status, 1)
  assert.match(made.stderr, /did not sign up itself/)
  const dev = await owner<{ e: string }[]>`select email::text as e from app_user where email = 'dev@example.com'`
  assert.equal(dev.length, 1, 'the first test made it')
  const devSaid = nameOwner('dev@example.com')
  assert.equal(devSaid.status, 1)
  assert.match(devSaid.stderr, /development account/)
  await assert.rejects(owner`select instance_name_owner('dev@example.com'::citext, ${`h-${randomUUID()}`})`, /dev_account/)
  assert.deepEqual(await owners(), [])

  /* The service's database: nothing, for anybody. */
  const applicant = uid()
  assert.equal((await register(applicant)).status, 202)
  await owner`update instance_setting set community = false`
  try {
    const service = nameOwner(`ines${applicant}@example.com`)
    assert.equal(service.status, 1)
    assert.match(service.stderr, /not a server of your own/)
    assert.deepEqual(await owners(), [])
  } finally {
    await owner`update instance_setting set community = true`
  }

  /* An address nobody has: said so, nothing done. */
  const nobody = nameOwner(`nobody${uid()}@example.com`)
  assert.equal(nobody.status, 1)
  assert.match(nobody.stderr, /No account has the address/)
})

/* ------------------------------------------- the owner named ahead */

const { readOwnerEmail } = await import('../src/env.js')
const { serverClaimed } = await import('../src/instance.js')

/** `OWNER_EMAIL` as the next start reads it, told to the database by that
    start — `edition.ready`, as the community edition does on every start. */
async function startWith(ownerEmail: string | undefined): Promise<string[]> {
  if (ownerEmail === undefined) delete process.env.OWNER_EMAIL
  else process.env.OWNER_EMAIL = ownerEmail
  return logged(() => edition.ready(owner))
}
const ownerEmailInDb = async () => (await owner<{ e: string | null }[]>`select owner_email::text as e from instance_setting`)[0]!.e
/** The reset link last mailed to an address — the letter that confirms
    and asks for a password in one step. */
const resetLinkFor = (email: string) => {
  const m = [...outbox].reverse().find((x) => x.to === email && /\/reset\//.test(x.text))
  assert.ok(m, `no reset link mailed to ${email}`)
  return decodeURIComponent(/\/reset\/([^\s]+)/.exec(m.text)![1]!)
}
const hasPassword = async (id: string) =>
  (await owner<{ p: boolean }[]>`select password_hash is not null as p from app_user where actor_id = ${id}`)[0]!.p
const providers = async () => {
  const p = (await call('/auth/providers')).body
  return { google: p.google, apple: p.apple, github: p.github, sign_up: p.sign_up }
}

test('OWNER_EMAIL is read as one address, trimmed and lowercased; empty is unset; anything else refuses to start', () => {
  assert.equal(readOwnerEmail(undefined), null)
  assert.equal(readOwnerEmail(''), null)
  assert.equal(readOwnerEmail('   '), null)
  assert.equal(readOwnerEmail('  Admin@Example.COM '), 'admin@example.com')
  /* What sign-up takes, and nothing it refuses. */
  assert.equal(readOwnerEmail("O'Brien@Example.com"), "o'brien@example.com")
  for (const bad of [
    'admin',
    'admin@',
    'a@b',
    'a b@example.com',
    'a@example.com, b@example.com',
    'Tuff <a@example.com>',
    'a..b@example.com',
    '.a@example.com',
    'a@example.c',
  ]) {
    assert.throws(() => readOwnerEmail(bad), /OWNER_EMAIL is not an email address/, bad)
  }
})

test('with OWNER_EMAIL set, a stranger cannot sign up on an unclaimed server, and only that address claims it, whatever its case', async () => {
  asCommunity()
  await unclaimed()
  /* Somebody who signed up before the address was set, and has not
     confirmed: the named address is the only one that claims now. */
  const early = uid()
  await startWith(undefined)
  assert.equal((await register(early)).status, 202)

  const s = uid()
  const lines = await startWith(`  Owner${s}@Example.COM `)
  assert.equal(await ownerEmailInDb(), `owner${s}@example.com`)
  assert.ok(
    lines.some((l) => l.includes(`Sign up as owner${s}@example.com`)),
    lines.join('\n'),
  )
  try {
    /* The form is still drawn — the owner comes in by it — but no
       provider's button: none of them can claim. */
    assert.deepEqual(await providers(), { google: false, apple: false, github: false, sign_up: true })
    assert.equal(await serverClaimed(), false)

    /* A stranger: refused in the words closed sign-up uses, nothing made. */
    const stranger = uid()
    const r = await register(stranger)
    assert.equal(r.status, 403)
    assert.equal(r.body.error.code, 'sign_up_closed')
    assert.match(r.body.error.message, /Sign-up is closed on this server/)
    assert.equal(await accountOf(`ines${stranger}@example.com`), null)
    /* Called straight, as the application role: the database's rule. */
    const id = randomUUID()
    await assert.rejects(
      withoutActor(
        (tx) => tx`select register_owner(${id}, 'Direct', ${`d${uid()}@example.com`}, ${'x'},
        ${randomUUID()}, 'Direct', ${`dir-${uid()}`}, false, true)`,
      ),
      /sign_up_closed/,
    )
    assert.equal((await owner`select 1 from actor where id = ${id}`).length, 0)
    /* The early applicant's link is refused, and leaves them unconfirmed. */
    const late = await confirm(`ines${early}@example.com`)
    assert.equal(late.status, 403)
    assert.equal(late.body.error.code, 'sign_up_closed')
    assert.equal(await confirmed((await accountOf(`ines${early}@example.com`))!), false)
    assert.deepEqual(await owners(), [])
    assert.equal(await claimed(), false)

    /* The owner, typing the address in another case: let in, and the link
       makes them the owner. */
    const asTyped = `OWNER${s}@example.Com`
    const mine = await call('/auth/register', { body: { ...registration(s), email: asTyped } })
    assert.equal(mine.status, 202, JSON.stringify(mine.body))
    /* Their sign-up keeps no password: the letter confirms and asks for
       one in one step (migration 209). */
    const ownerId = (await accountOf(`owner${s}@example.com`))!
    assert.equal(await hasPassword(ownerId), false)
    const set = await call('/auth/password/reset', {
      body: { token: resetLinkFor(`owner${s}@example.com`), password: 'the-owners-own-password' },
    })
    assert.equal(set.status, 200, JSON.stringify(set.body))
    assert.deepEqual(await owners(), [ownerId])
    assert.equal((await call('/auth/login', { body: { email: `owner${s}@example.com`, password: 'the-owners-own-password' } })).status, 200)
    assert.equal(await serverClaimed(), true)
    /* Claimed: the buttons come back, sign-up is closed as after any claim. */
    assert.deepEqual(await providers(), { google: false, apple: false, github: true, sign_up: false })
  } finally {
    await startWith(undefined)
  }
})

test('the database compares the named address without regard to case', async () => {
  asCommunity()
  await unclaimed()
  const s = uid()
  /* Told straight, in one case, and asked in another — no lowercasing
     on the way: `citext`'s. */
  await owner`select instance_started(${`Named${s}@Example.com`}::citext, true)`
  try {
    const id = randomUUID()
    await withoutActor(
      (tx) => tx`select register_owner(${id}, 'Named', ${`NAMED${s}@EXAMPLE.COM`}, ${'x'},
      ${randomUUID()}, 'Named', ${`nam-${uid()}`}, false, true)`,
    )
    await owner`update app_user set email_verified_at = now() where actor_id = ${id}`
    assert.deepEqual(await owners(), [id])
  } finally {
    await startWith(undefined)
  }
})

test('with OWNER_EMAIL empty the first confirmed sign-up claims the server, as before', async () => {
  asCommunity()
  await unclaimed()
  const lines = await startWith('')
  assert.equal(await ownerEmailInDb(), null)
  assert.ok(
    lines.some((l) => /No mail is set up\. Sign up, then run/.test(l)),
    lines.join('\n'),
  )
  assert.deepEqual(await providers(), { google: false, apple: false, github: false, sign_up: true })
  const s = uid()
  assert.equal((await register(s)).status, 202)
  assert.equal((await confirm(`ines${s}@example.com`)).status, 200)
  assert.deepEqual(await owners(), [(await accountOf(`ines${s}@example.com`))!])
  assert.equal((await providers()).github, true)
})

test('the command still names an owner on an unclaimed server with OWNER_EMAIL set', async () => {
  asCommunity()
  await unclaimed()
  /* Whoever holds the machine is the owner, as before: an applicant from
     before the address was set, named from the terminal. */
  const s = uid()
  await startWith(undefined)
  assert.equal((await register(s)).status, 202)
  await startWith(`other${uid()}@example.com`)
  try {
    const r = nameOwner(`ines${s}@example.com`)
    assert.equal(r.status, 0, r.stderr)
    assert.deepEqual(await owners(), [(await accountOf(`ines${s}@example.com`))!])
  } finally {
    await startWith(undefined)
  }
})

test('on the service OWNER_EMAIL changes nothing: sign-up open, every button drawn', async () => {
  await unclaimed()
  Object.assign(edition, service)
  process.env.OWNER_EMAIL = `named${uid()}@example.com`
  /* The service never tells the database anything; a row written by hand
     is not read either, since `community` is false. */
  await owner`update instance_setting set community = false, claimed_at = null, owner_email = ${process.env.OWNER_EMAIL}`
  try {
    assert.equal(await serverClaimed(), true)
    assert.deepEqual(await providers(), { google: false, apple: false, github: true, sign_up: true })
    const s = uid()
    assert.equal((await register(s)).status, 202)
    assert.equal((await confirm(`ines${s}@example.com`)).status, 200)
    assert.equal(await confirmed((await accountOf(`ines${s}@example.com`))!), true)
    assert.deepEqual(await owners(), [])
  } finally {
    delete process.env.OWNER_EMAIL
    await owner`update instance_setting set community = true, owner_email = null`
  }
})

test('a squatter’s password does not come with the claim when the owner follows the first link', async () => {
  asCommunity()
  await unclaimed()
  /* OWNER_EMAIL empty: the reviewer's scenario. A stranger signs up first
     with the admin's address, sending a password as an old app does; the
     admin follows the letter that sign-up sent. Since nothing the
     stranger typed was ever kept. */
  await startWith(undefined)
  const s = uid()
  const addr = `boss${s}@example.com`
  const squatter = 'the-squatters-own-password'
  assert.equal((await call('/auth/register', { body: { ...registration(s), email: addr, password: squatter } })).status, 202)
  const id = (await accountOf(addr))!
  assert.equal(await hasPassword(id), false)
  assert.equal((await call('/auth/login', { body: { email: addr, password: squatter } })).status, 401)
  const set = await call('/auth/password/reset', { body: { token: chooseLinkFor(addr), password: 'the-admins-own-password' } })
  assert.equal(set.status, 200, JSON.stringify(set.body))
  assert.deepEqual(await owners(), [id])
  assert.equal((await call('/auth/login', { body: { email: addr, password: 'the-admins-own-password' } })).status, 200)
  assert.equal((await call('/auth/login', { body: { email: addr, password: squatter } })).status, 401)
})

test('a confirmation link from before the password came after the proof claims the server and takes the squatter’s password', async () => {
  asCommunity()
  await unclaimed()
  await startWith(undefined)
  const s = uid()
  const addr = `legacyboss${s}@example.com`
  const squatter = 'the-squatters-own-password'
  /* An applicant as sign-up made one until now: a password typed into the
     form, and a confirmation link in the owner's inbox. */
  assert.equal((await call('/auth/register', { body: { ...registration(s), email: addr } })).status, 202)
  const id = (await accountOf(addr))!
  await owner`update app_user set password_hash = ${await hashPassword(squatter)} where actor_id = ${id}`
  const first = generateToken('vfy')
  await owner`insert into auth_ticket (token_hash, kind, actor_id, workspace_id, expires_at)
              values (${hashToken(first)}, 'verify', ${id}, null, now() + interval '1 day')`
  const followed = await call('/auth/verify', { body: { token: first } })
  assert.equal(followed.status, 200, JSON.stringify(followed.body))
  assert.deepEqual(await owners(), [id])
  /* No session, and a ticket to choose the password with. */
  assert.equal(followed.body.access_token, undefined)
  assert.equal(typeof followed.body.choose_password, 'string')
  /* The stranger's password is not a way in. */
  assert.equal(await hasPassword(id), false)
  assert.equal((await call('/auth/login', { body: { email: addr, password: squatter } })).status, 401)
  /* Whoever followed the link chooses it. */
  const set = await call('/auth/password/reset', { body: { token: followed.body.choose_password, password: 'the-admins-own-password' } })
  assert.equal(set.status, 200, JSON.stringify(set.body))
  assert.equal((await call('/auth/login', { body: { email: addr, password: 'the-admins-own-password' } })).status, 200)
  assert.equal((await call('/auth/login', { body: { email: addr, password: squatter } })).status, 401)
})

test('with OWNER_EMAIL set, a squatter on the owner’s address never has a password kept', async () => {
  asCommunity()
  await unclaimed()
  const s = uid()
  const addr = `chief${s}@example.com`
  await startWith(addr)
  try {
    const squatter = 'the-squatters-own-password'
    assert.equal((await call('/auth/register', { body: { ...registration(s), email: addr, password: squatter } })).status, 202)
    const id = (await accountOf(addr))!
    assert.equal(await hasPassword(id), false)
    assert.equal((await call('/auth/login', { body: { email: addr, password: squatter } })).status, 401)
    /* The letter in the owner's inbox is the one that asks for a password. */
    const set = await call('/auth/password/reset', { body: { token: resetLinkFor(addr), password: 'the-owners-own-password' } })
    assert.equal(set.status, 200, JSON.stringify(set.body))
    assert.deepEqual(await owners(), [id])
    assert.equal((await call('/auth/login', { body: { email: addr, password: squatter } })).status, 401)
  } finally {
    await startWith(undefined)
  }
})

test('migrating leaves OWNER_EMAIL as the last start wrote it, and a start that empties it on an unclaimed server says so', async () => {
  asCommunity()
  await unclaimed()
  const addr = `kept${uid()}@example.com`
  await startWith(addr)
  /* The migrate command, from a shell without the variable. */
  delete process.env.OWNER_EMAIL
  await edition.migrated(owner)
  assert.equal(await ownerEmailInDb(), addr)
  await assert.rejects(owner`select instance_started(${null}::citext)`, /function instance_started\(citext\) does not exist/)
  /* The server starting without it: cleared, loudly. */
  const lines = await startWith(undefined)
  assert.equal(await ownerEmailInDb(), null)
  assert.ok(
    lines.some((l) => /OWNER_EMAIL WAS SET AND IS EMPTY NOW/.test(l)),
    lines.join('\n'),
  )
  /* And only once: nothing to say the next time. */
  assert.ok(!(await startWith(undefined)).some((l) => /OWNER_EMAIL WAS SET/.test(l)))
})

test('the command names the account at OWNER_EMAIL on an unclaimed server even when it is not an applicant', async () => {
  asCommunity()
  await unclaimed()
  /* Made on somebody's behalf, confirmed — as an account from before 202
     would be. Not an applicant, so without the address it is refused. */
  const s = uid()
  const made = await script(s)
  const addr = `ines${s}@example.com`
  await startWith(undefined)
  assert.match(nameOwner(addr).stderr, /did not sign up itself/)
  await startWith(addr.toUpperCase())
  try {
    const r = nameOwner(addr)
    assert.equal(r.status, 0, r.stderr)
    assert.deepEqual(await owners(), [made.actor_id])
    assert.equal(await hasPassword(made.actor_id), false)
    assert.ok(resetLink(r.stdout))
    /* Anybody else at that stage still is not. */
    await unclaimed()
    const other = await script()
    const otherEmail = (await owner<{ e: string }[]>`select email::text as e from app_user where actor_id = ${other.actor_id}`)[0]!.e
    assert.match(nameOwner(otherEmail).stderr, /did not sign up itself/)
  } finally {
    await startWith(undefined)
  }
})

/* ------------------------------------------- a newer release */

test('owners hear of a newer release on Server settings and /api/me; nobody else, and not past the version they run', async () => {
  asCommunity()
  const { running } = await import('../src/updates.js')
  const wasVersion = running.version
  const wasCheck = process.env.UPDATE_CHECK
  await owner`update instance_setting set community = true`
  const mine = await script()
  await owner`insert into instance_owner (actor_id) values (${mine.actor_id}) on conflict do nothing`
  const token = await bearerOf(mine.actor_id)
  const other = await script()
  try {
    running.version = '1.2.0'
    delete process.env.UPDATE_CHECK
    await owner`update instance_setting set release_version = null, release_url = null, release_published_at = null,
                  release_security = false, release_checked_at = null`
    assert.equal((await owner<{ due: boolean }[]>`select instance_release_due() as due`)[0]!.due, true, 'never asked: due')

    /* Nothing heard yet: the version, and no notice. */
    let read = await call('/api/instance', { token })
    assert.equal(read.status, 200)
    assert.deepEqual(read.body.version, {
      current: '1.2.0',
      commit: read.body.version.commit,
      check: true,
      latest: null,
      updated: read.body.version.updated,
    })

    /* What the worker heard — a security release. */
    await owner`select instance_release_heard('1.3.0', 'https://github.com/usetuff/tuff/releases/tag/v1.3.0',
                  '2026-11-10T12:00:00Z'::timestamptz, true)`
    assert.equal((await owner<{ due: boolean }[]>`select instance_release_due() as due`)[0]!.due, false, 'asked: not due for a day')
    read = await call('/api/instance', { token })
    assert.equal(read.body.version.latest.version, '1.3.0')
    assert.equal(read.body.version.latest.url, 'https://github.com/usetuff/tuff/releases/tag/v1.3.0')
    assert.equal(read.body.version.latest.security, true)
    assert.ok(Date.parse(read.body.version.latest.published_at) === Date.parse('2026-11-10T12:00:00Z'))
    /* Every answer of the screen carries it, a write's too. */
    const patched = await call('/api/instance', { method: 'PATCH', token, body: { sign_up_open: false } })
    assert.equal(patched.body.version.latest.version, '1.3.0')
    const me = await call('/api/me', { token })
    assert.equal(me.body.server.latest.version, '1.3.0')
    assert.equal(me.body.server.latest.security, true)

    /* Anybody else: no key at all, and the screen is a wrong address. */
    const theirs = await call('/api/me', { token: other.access_token })
    assert.equal(theirs.status, 200)
    assert.equal('server' in theirs.body, false)
    assert.equal((await call('/api/instance', { token: other.access_token })).status, 404)
    /* Nor through a token, even the owner's own. */
    const ws = await firstWorkspace(mine.actor_id)
    await owner`update workspace set plan = 'unlimited' where id = ${ws}`
    const tok = await issueApiToken(mine.actor_id, ws!, 'agent')
    const viaToken = await call('/api/me', { token: tok })
    assert.equal(viaToken.status, 200)
    assert.equal('server' in viaToken.body, false)
    /* And the database answers nobody but an owner, whoever asks it. */
    const [asOther] = await withActor(other.actor_id, (tx) => tx<{ r: unknown }[]>`select instance_release() as r`)
    assert.equal(asOther!.r, null)

    /* The dot clears once the server runs it; a server past it is told nothing; nor is 0.0.0. */
    for (const v of ['1.3.0', '1.4.0', '0.0.0']) {
      running.version = v
      assert.equal((await call('/api/instance', { token })).body.version.latest, null, v)
      assert.equal((await call('/api/me', { token })).body.server.latest, null, v)
    }
    running.version = '1.2.0'

    /* Off: the screen says so. */
    process.env.UPDATE_CHECK = 'off'
    assert.equal((await call('/api/instance', { token })).body.version.check, false)

    /* A check that came to nothing keeps the last answer. */
    await owner`select instance_release_heard(null, null, null, null)`
    assert.equal((await owner<{ v: string }[]>`select release_version as v from instance_setting`)[0]!.v, '1.3.0')

    /* The database keeps only a plain version and a page under usetuff/tuff's releases. */
    await assert.rejects(
      owner`select instance_release_heard('1.4.0', 'https://evil.example.com/usetuff/tuff/releases/tag/v1.4.0', null, false)`,
      /check constraint/,
    )
    await assert.rejects(
      owner`select instance_release_heard('v1.4.0', 'https://github.com/usetuff/tuff/releases/tag/v1.4.0', null, false)`,
      /check constraint/,
    )
    /* And the application role cannot write it at all: the worker's alone. */
    await assert.rejects(
      withActor(
        mine.actor_id,
        (tx) => tx`select instance_release_heard('9.9.9', 'https://github.com/usetuff/tuff/releases/tag/v9.9.9', null, true)`,
      ),
      /permission denied/,
    )

    /* On the service: nothing, even for somebody in the table. */
    Object.assign(edition, service)
    const onService = await call('/api/me', { token })
    assert.equal('server' in onService.body, false)
    assert.equal((await call('/api/instance', { token })).status, 404)
  } finally {
    running.version = wasVersion
    if (wasCheck === undefined) delete process.env.UPDATE_CHECK
    else process.env.UPDATE_CHECK = wasCheck
    asCommunity()
    await owner`delete from instance_owner where actor_id = ${mine.actor_id}`.catch(() => {})
  }
})

/* ------------------------------------- after an update */

test('owners are told of an update, where its backup is, and dismiss it; nobody else sees it, and the service has none', async () => {
  asCommunity()
  const { noteVersion } = await import('../src/backup.js')
  await owner`update instance_setting set community = true, ran_version = null, update_to = null`
  const mine = await script()
  await owner`insert into instance_owner (actor_id) values (${mine.actor_id}) on conflict do nothing`
  const token = await bearerOf(mine.actor_id)
  const other = await script()
  const dump = '/backups/tuff-1.2.0-20261120-101500.dump'
  try {
    /* A first start remembers its version and tells nobody anything. */
    await noteVersion(owner, edition, '1.2.0')
    const [ran] = await owner<{ v: string; at: Date }[]>`select ran_version as v, ran_at as at from instance_setting`
    assert.equal(ran!.v, '1.2.0')
    assert.ok(ran!.at.getTime() > Date.now() - 60_000, 'and when, which tells a later backup it is stale')
    assert.equal((await call('/api/instance', { token })).body.version.updated, null)

    /* The migrating start of 1.3.0, then its serving start. */
    await owner`select instance_migrated('1.3.0', ${dump}, null, 3)`
    await noteVersion(owner, edition, '1.3.0')
    const read = await call('/api/instance', { token })
    assert.equal(read.status, 200)
    const u = read.body.version.updated
    assert.equal(u.from, '1.2.0')
    assert.equal(u.to, '1.3.0')
    assert.equal(u.backup, dump)
    assert.equal(u.no_backup, null)
    assert.equal(u.migrations, 3)
    assert.equal(u.notes, 'https://github.com/usetuff/tuff/releases/tag/v1.3.0')
    assert.ok(Date.parse(u.at) > Date.now() - 60_000)
    const me = await call('/api/me', { token })
    assert.equal(me.body.server.updated.backup, dump)

    /* Anybody else: nothing, and they cannot dismiss it either. */
    const theirs = await call('/api/me', { token: other.access_token })
    assert.equal('server' in theirs.body, false)
    assert.equal((await call('/api/instance', { token: other.access_token })).status, 404)
    assert.equal((await call('/api/instance/update', { method: 'DELETE', token: other.access_token })).status, 404)
    const [asOther] = await withActor(
      other.actor_id,
      (tx) => tx<{ u: unknown; ok: boolean }[]>`
      select instance_update() as u, instance_update_dismiss() as ok`,
    )
    assert.equal(asOther!.u, null)
    assert.equal(asOther!.ok, false)
    assert.equal((await call('/api/instance', { token })).body.version.updated.to, '1.3.0', 'still there')
    /* Nor can a request write one: the table owner's alone. */
    await assert.rejects(
      withActor(mine.actor_id, (tx) => tx`select instance_migrated('9.9.9', null, 'skipped', 1)`),
      /permission denied/,
    )
    await assert.rejects(
      withActor(mine.actor_id, (tx) => tx`select instance_ran('9.9.9')`),
      /permission denied/,
    )

    /* Dismissed, for every owner. */
    const dismissed = await call('/api/instance/update', { method: 'DELETE', token })
    assert.equal(dismissed.status, 200)
    assert.equal(dismissed.body.version.updated, null)
    assert.equal((await call('/api/me', { token })).body.server.updated, null)

    /* A new version with nothing to migrate is an update all the same: no backup, no changes. */
    await noteVersion(owner, edition, '1.4.0')
    let later = (await call('/api/instance', { token })).body.version.updated
    assert.deepEqual(
      { from: later.from, to: later.to, backup: later.backup, no_backup: later.no_backup, migrations: later.migrations },
      { from: '1.3.0', to: '1.4.0', backup: null, no_backup: null, migrations: 0 },
    )
    /* The same version again is not. */
    await call('/api/instance/update', { method: 'DELETE', token })
    await noteVersion(owner, edition, '1.4.0')
    assert.equal((await call('/api/instance', { token })).body.version.updated, null)

    /* Skipped, and a build that is not a release: no notes to link to. */
    await owner`select instance_migrated('0.0.0', null, 'not_a_volume', 2)`
    later = (await call('/api/instance', { token })).body.version.updated
    assert.equal(later.from, '1.4.0')
    assert.equal(later.no_backup, 'not_a_volume')
    assert.equal(later.backup, null)
    assert.equal(later.notes, null)

    /* Its definers keep pg_temp last on their path, as every definer must
       (definer-search-path.test.ts asks it of the shared database). */
    const paths = await owner<{ name: string; config: string }[]>`
      select p.proname as name, array_to_string(p.proconfig, ',') as config from pg_proc p
      where p.proname in ('instance_migrated', 'instance_ran', 'instance_update', 'instance_update_dismiss') and p.prosecdef`
    assert.equal(paths.length, 4)
    for (const p of paths) assert.match(p.config, /search_path=.*,\s*pg_temp$/, p.name)

    /* The database keeps versions as versions. */
    await assert.rejects(owner`select instance_migrated('v1.5.0', null, null, 1)`, /check constraint/)

    /* On the service: no screen, no key, and its starts write nothing. */
    Object.assign(edition, service)
    assert.equal((await call('/api/instance', { token })).status, 404)
    assert.equal('server' in (await call('/api/me', { token })).body, false)
    await owner`update instance_setting set update_to = null`
    await noteVersion(owner, edition, '2.0.0')
    const [row] = await owner<{ v: string; to: string | null }[]>`select ran_version as v, update_to as to from instance_setting`
    assert.equal(row!.v, '1.4.0', 'the service’s start does not even remember its version')
    assert.equal(row!.to, null)
  } finally {
    asCommunity()
    await owner`update instance_setting set ran_version = null, update_to = null`.catch(() => {})
    await owner`delete from instance_owner where actor_id = ${mine.actor_id}`.catch(() => {})
  }
})

test('every start of your own server says the database’s own rights again, which a restore without --create would lose', async () => {
  asCommunity()
  const temp = async () =>
    (
      await owner<{ app: boolean; worker: boolean; pub: boolean }[]>`
      select has_database_privilege('tracker_app', current_database(), 'TEMPORARY') as app,
             has_database_privilege('tracker_worker', current_database(), 'TEMPORARY') as worker,
             has_database_privilege('public', current_database(), 'TEMPORARY') as pub`
    )[0]!
  /* What a database made by `createdb` and restored into has: Postgres's defaults. */
  await owner.unsafe(`grant temporary on database ${DB} to public`)
  await owner`grant create on schema public to public`
  assert.equal((await temp()).app, true, 'the default lets the application make temporary tables')
  await logged(() => edition.ready(owner))
  assert.deepEqual({ ...(await temp()) }, { app: false, worker: false, pub: false })
  const [s] = await owner<{ create: boolean; connect: boolean }[]>`
    select has_schema_privilege('tracker_app', 'public', 'CREATE') as create,
           has_database_privilege('tracker_app', current_database(), 'CONNECT') as connect`
  assert.equal(s!.create, false)
  assert.equal(s!.connect, true)
  /* The owner of the tables keeps what its definers need. */
  const [mine] = await owner<{ t: boolean }[]>`select has_database_privilege(current_user, current_database(), 'TEMPORARY') as t`
  assert.equal(mine!.t, true)

  /* An ordinary start writes nothing: the database's row is left as it was. */
  const { sayDatabaseRights } = await import('../src/db/rights.js')
  const row = async () => (await owner<{ x: string }[]>`select xmin::text as x from pg_database where datname = current_database()`)[0]!.x
  const before = await row()
  await sayDatabaseRights(owner)
  assert.equal(await row(), before)

  /* Two starts at once, both finding something missing: neither fails. */
  await owner.unsafe(`grant temporary on database ${DB} to public`)
  const second = postgres(at(shared), { max: 1, onnotice: () => {} })
  try {
    await logged(() => Promise.all([sayDatabaseRights(owner), sayDatabaseRights(second), sayDatabaseRights(owner)]))
  } finally {
    await second.end()
  }
  assert.equal((await temp()).pub, false)
})

/* ------------------------------------------- nothing held back, no plans */

test('on your own server nothing names or holds to a plan: many workspaces a day, past a free plan’s people, agents and a feedback page', async () => {
  asCommunity()
  const { workspaceFull, fits, agentsHeld, feedbackHeld } = await import('../src/ceilings.js')
  const [first] = await owners()
  const ownerToken = await bearerOf(first!)
  const made: string[] = []
  try {
    /* As many workspaces as the owner likes: past the ten a day an account
       is held to on the service. */
    for (let i = 0; i < 12; i++) {
      const r = await call('/api/workspaces', { token: ownerToken, body: { name: `Many ${i} ${uid().slice(0, 4)}` } })
      assert.equal(r.status, 201, `workspace ${i + 1}: ${JSON.stringify(r.body)}`)
      made.push(r.body.slug as string)
    }

    /* No answer names a plan. */
    const me = await call('/api/me', { token: ownerToken })
    assert.equal(me.status, 200)
    assert.equal('plan' in me.body, false, '/api/me says no plan')
    const list = await call('/api/workspaces', { token: ownerToken })
    for (const w of list.body.workspaces as { plan?: string | null }[]) assert.ok(w.plan == null, 'no plan on a workspace in the list')

    /* A workspace on the database's default — a server from before — holds
       nothing back after the next start. */
    const [w] = await owner<{ id: string }[]>`select id from workspace where slug = ${made[0]!}`
    await owner`update workspace set plan = 'solo' where id = ${w!.id}`
    await logged(() => edition.ready(owner))
    const [moved] = await owner<{ plan: string }[]>`select plan from workspace where id = ${w!.id}`
    assert.equal(moved!.plan, 'unlimited')

    /* And one put back on it by hand is held to nothing the core asks:
       people, bytes, agents, a feedback page. */
    await owner`update workspace set plan = 'solo' where id = ${w!.id}`
    const ctx = await authenticate(`Bearer ${await bearerFor(first!, w!.id)}`)
    assert.ok(ctx)
    assert.equal(ctx.plan, 'solo')
    assert.equal(await withoutActor((tx) => workspaceFull(tx, w!.id)), false)
    assert.equal(await withoutActor((tx) => fits(tx, w!.id, 10 * 1024 ** 4)), true)
    assert.equal(agentsHeld(ctx), null)
    assert.equal(feedbackHeld(ctx), false)
    assert.ok(allowedActions(ctx).includes('agent.use'), 'can() is never told a plan here')

    /* The service, on the same row, holds it back, and says so — where
       this tree has the service (the edition's own has only itself). */
    if (service.ceilings) {
      Object.assign(edition, service)
      try {
        assert.equal(agentsHeld(ctx)?.error.code, 'plan')
        assert.equal(feedbackHeld(ctx), true)
      } finally {
        asCommunity()
      }
    }
    await logged(() => edition.ready(owner))

    /* Past two people, where the free plan stops on the service. */
    const into = await bearerFor(first!, w!.id)
    for (let i = 0; i < 4; i++) {
      const r = await call('/api/invites', { token: into, body: { email: `many${i}${uid()}@example.com`, rights: [] } })
      assert.ok(r.status === 200 || r.status === 201, `invitation ${i + 1}: ${r.status} ${JSON.stringify(r.body)}`)
    }
    /* An agent's token, made. */
    const t = await call('/api/tokens', { token: into, body: { name: 'An agent' } })
    assert.ok(t.status === 200 || t.status === 201, JSON.stringify(t.body))
    /* And a feedback page, which the service keeps for paid plans. */
    const projectId = await makeProject(ctx, w!.id, 'Asked for')
    const page = await call(`/api/projects/${projectId}/feedback`, { token: into })
    assert.equal(page.status, 200)
    assert.equal(page.body.paid, true)
    assert.equal(page.body.may, true)
  } finally {
    asCommunity()
    if (made.length) await owner`update workspace set deleted_at = now() where slug = any(${made})`
  }
})
