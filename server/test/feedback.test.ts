import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { can } from '@tracker/shared-schema'
import { app } from '../src/http/routes.js'
import { outbox } from '../src/mail.js'
import { closeRealtime } from '../src/realtime.js'
import { issueApiToken } from '../src/auth/flows.js'
import { closeDb, makeOwner, stamp, withActor, withoutActor } from './helpers.js'

/* A project's feedback page, phase 1: asking. */
after(async () => {
  await closeRealtime()
  await closeDb()
})

type Json = Record<string, any>
const json = async (r: Response) => (await r.json()) as Json

const as = (token: string) => (method: string, path: string, body?: unknown) =>
  app.request(`/api${path}`, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

/** Somewhere unique to come from, so a limit counts only this run. */
const somewhere = () => `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`

/** What the page's own press sends: JSON, from this site. */
const asker =
  (from = somewhere()) =>
  (method: string, path: string, body?: unknown, key?: string) =>
    app.request(`/api/f${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost',
        host: 'localhost',
        'x-forwarded-for': `${from}, 10.0.0.1`,
        ...(key ? { authorization: `Feedback ${key}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })

/** An owner on Team, a project made the way the app makes one, Triage on and a page live. */
async function setUp() {
  const owner = await makeOwner()
  const me = as(owner.token)
  const made = await json(await me('POST', '/projects', { name: `Mobile ${stamp().slice(0, 4)}` }))
  const project = made.id as string
  assert.equal((await me('PUT', `/projects/${project}/triage`, { on: true })).status, 200)
  const slug = `acme-${stamp()}`.slice(0, 30)
  const on = await me('PUT', `/projects/${project}/feedback`, { live: true, slug, name: 'Acme' })
  assert.equal(on.status, 200)
  return { ...owner, me, project, slug }
}

const linkIn = (to: string) => {
  const mail = [...outbox].reverse().find((m) => m.to === to)
  return mail ? (/\/confirm\/([A-Za-z0-9_-]{43})/.exec(mail.text)?.[1] ?? null) : null
}

test('turned on, the page is read with no session, and says nothing of the workspace', async () => {
  const { me, project, slug, workspaceId } = await setUp()
  const settings = await json(await me('GET', `/projects/${project}/feedback`))
  assert.equal(settings.page.slug, slug)
  assert.equal(settings.page.live, true)
  assert.equal(settings.may, true)
  assert.equal(settings.paid, true)
  assert.equal(settings.triage, true)
  // Whoever turned it on follows it from the start.
  assert.equal(settings.following, true)

  const read = await app.request(`/api/f/${slug}`)
  assert.equal(read.status, 200)
  assert.equal(read.headers.get('x-robots-tag'), 'noindex')
  assert.equal(read.headers.get('cache-control'), 'private, no-store')
  const text = await read.text()
  const page = JSON.parse(text) as Json
  assert.equal(page.name, 'Acme')
  assert.equal(page.available, true)
  assert.ok(page.mark.icon && Number.isInteger(page.mark.tint))
  // No ids, no workspace, no address of anybody's.
  assert.ok(!text.includes(project) && !text.includes(workspaceId))
  assert.ok(!text.includes('@'))

  // Off: still found, and not available.
  await me('PUT', `/projects/${project}/feedback`, { live: false })
  assert.equal((await json(await app.request(`/api/f/${slug}`))).available, false)
  assert.equal((await asker()('POST', `/${slug}/requests`, { title: 'x', email: 'a@example.com' })).status, 404)
  // A slug nobody has.
  assert.equal((await app.request('/api/f/nobody-has-this-one')).status, 404)
})

test('a request is nothing until its address is confirmed, by a press and not by opening the link', async () => {
  const { me, project, slug, ctx, workspaceId } = await setUp()
  const ask = asker()
  const email = `ana-${stamp()}@example.com`

  // An address, or a key, is needed.
  assert.equal((await ask('POST', `/${slug}/requests`, { title: 'Dark mode' })).status, 400)
  assert.equal((await ask('POST', `/${slug}/requests`, { title: '', email })).status, 400)

  const sent = await ask('POST', `/${slug}/requests`, { title: 'Dark mode', body: 'For the night.\n\nPlease.', email })
  assert.equal(sent.status, 200)
  assert.equal((await json(sent)).status, 'check_email')

  const tasks = async () =>
    withActor(
      ctx.actorId,
      (tx) => tx<{ id: string; title: string; intake: boolean; author: string }[]>`
      select t.id, t.title, l.intake, a.name as author from task t
      join task_list l on l.id = t.list_id join actor a on a.id = t.author_id
      where t.project_id = ${project} and t.deleted_at is null`,
    )
  assert.equal((await tasks()).length, 0)

  const token = linkIn(email)
  assert.ok(token, 'a link was mailed')
  const mail = [...outbox].reverse().find((m) => m.to === email)!
  // From Tuff, with a plain subject: the page is named in the words only.
  assert.equal(mail.subject, 'Confirm your request')
  assert.equal(mail.fromName, undefined)
  assert.match(mail.text, /Acme/)

  // Opening it shows what it would confirm, and does nothing.
  const looked = await ask('GET', `/${slug}/confirm/${token}`)
  assert.equal(looked.status, 200)
  const waiting = await json(looked)
  assert.equal(waiting.title, 'Dark mode')
  assert.equal(waiting.email, email)
  assert.equal((await tasks()).length, 0)

  // The press files it — in Triage, by the page's own actor.
  const pressed = await ask('POST', `/${slug}/confirm/${token}`)
  assert.equal(pressed.status, 200)
  const { key } = await json(pressed)
  assert.match(key, /^[A-Za-z0-9_-]{43}$/)
  const filed = await tasks()
  assert.equal(filed.length, 1)
  assert.equal(filed[0]!.title, 'Dark mode')
  assert.equal(filed[0]!.intake, true)
  assert.equal(filed[0]!.author, 'Acme feedback')

  // Pressed again, it files nothing more.
  assert.equal((await ask('POST', `/${slug}/confirm/${token}`)).status, 410)
  assert.equal((await ask('GET', `/${slug}/confirm/${token}`)).status, 410)
  assert.equal((await tasks()).length, 1)

  // The task says who asked — to whoever may change it.
  const read = await json(await me('GET', `/tasks/${filed[0]!.id}`))
  assert.equal(read.feedback.email, email)
  assert.match(JSON.stringify(read.task.body), /For the night/)
  // An agent reading it sees that it came from the page, and not who.
  const tok = await issueApiToken(ctx.actorId, workspaceId, 'agent')
  const byAgent = await json(await as(tok)('GET', `/tasks/${filed[0]!.id}`))
  assert.deepEqual(byAgent.feedback, { email: null })

  // The follower heard of it.
  const notes = await withActor(
    ctx.actorId,
    (tx) => tx<{ what: string | null }[]>`
    select what from notification where actor_id = ${ctx.actorId} and object_id = ${filed[0]!.id}`,
  )
  assert.equal(notes.length, 1)
  assert.equal(notes[0]!.what, 'New request from the feedback page')

  // With the key the page handed back, the next request needs no mail.
  const before = outbox.length
  const known = await json(await ask('GET', `/${slug}/me`, undefined, key))
  assert.equal(known.email, email)
  const again = await ask('POST', `/${slug}/requests`, { title: 'Export to CSV' }, key)
  assert.equal((await json(again)).status, 'sent')
  assert.equal(outbox.length, before)
  assert.equal((await tasks()).length, 2)

  // A key this page never handed out is refused, so the page asks for an address.
  const wrong = 'A'.repeat(43)
  assert.equal((await ask('POST', `/${slug}/requests`, { title: 'x' }, wrong)).status, 401)
  assert.equal((await ask('GET', `/${slug}/me`, undefined, wrong)).status, 401)
})

test('a request comes from the page, as JSON, past Turnstile when there is a key for it', async () => {
  const { slug } = await setUp()
  const email = `bo-${stamp()}@example.com`
  // Not from this site.
  const elsewhere = await app.request(`/api/f/${slug}/requests`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://evil.example', host: 'localhost' },
    body: JSON.stringify({ title: 'x', email }),
  })
  assert.equal(elsewhere.status, 403)
  // A form, not JSON.
  const form = await app.request(`/api/f/${slug}/requests`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'http://localhost', host: 'localhost' },
    body: 'title=x',
  })
  assert.equal(form.status, 403)

  /* With a secret, Cloudflare is asked; its answer decides. */
  const had = process.env.TURNSTILE_SECRET_KEY
  const real = globalThis.fetch
  let says = false
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).startsWith('https://challenges.cloudflare.com/')) {
      assert.match(String(init?.body), /response=solved/)
      return new Response(JSON.stringify({ success: says }), { headers: { 'content-type': 'application/json' } })
    }
    return real(url, init)
  }) as typeof fetch
  process.env.TURNSTILE_SECRET_KEY = 'test-secret'
  try {
    const ask = asker()
    assert.equal((await ask('POST', `/${slug}/requests`, { title: 'x', email })).status, 400)
    assert.equal((await ask('POST', `/${slug}/requests`, { title: 'x', email, turnstile: 'solved' })).status, 400)
    says = true
    assert.equal((await ask('POST', `/${slug}/requests`, { title: 'x', email, turnstile: 'solved' })).status, 200)
  } finally {
    globalThis.fetch = real
    if (had === undefined) delete process.env.TURNSTILE_SECRET_KEY
    else process.env.TURNSTILE_SECRET_KEY = had
  }
})

test('one machine sends ten requests an hour, and one address is mailed three links a day', async () => {
  const { slug } = await setUp()
  const ask = asker()
  const email = `cy-${stamp()}@example.com`
  for (let i = 0; i < 10; i++) {
    assert.equal((await ask('POST', `/${slug}/requests`, { title: `Ask ${i}`, email })).status, 200)
  }
  assert.equal((await ask('POST', `/${slug}/requests`, { title: 'One more', email })).status, 429)
  // Ten were held; only three links went to the one address.
  assert.equal(outbox.filter((m) => m.to === email).length, 3)
})

test('an address is one page’s, and a changed one points to its page for a while', async () => {
  const one = await setUp()
  const two = await setUp()
  // Taken by another page.
  const taken = await two.me('PUT', `/projects/${two.project}/feedback`, { slug: one.slug })
  assert.equal(taken.status, 409)
  assert.equal((await json(await two.me('GET', `/projects/${two.project}/feedback/slug/${one.slug}`))).free, false)
  // Not an address.
  assert.equal((await two.me('PUT', `/projects/${two.project}/feedback`, { slug: 'No Spaces' })).status, 400)
  // A reserved word, as a workspace's is.
  assert.equal((await two.me('PUT', `/projects/${two.project}/feedback`, { slug: 'admin' })).status, 409)

  const moved = `${one.slug}-new`.slice(0, 40)
  assert.equal((await one.me('PUT', `/projects/${one.project}/feedback`, { slug: moved })).status, 200)
  const old = await json(await app.request(`/api/f/${one.slug}`))
  assert.equal(old.moved_to, moved)
  // And nobody else may take the old one while it points there.
  assert.equal((await two.me('PUT', `/projects/${two.project}/feedback`, { slug: one.slug })).status, 409)
})

test('the page’s actor is nobody to pick, count or give anything to', async () => {
  const { me, project, ctx, workspaceId } = await setUp()
  const people = (await json(await me('GET', '/people'))).people as Json[]
  assert.ok(!people.some((p) => p.name === 'Acme feedback'))
  const members = (await json(await me('GET', `/projects/${project}/members`))).members as Json[]
  assert.ok(!members.some((p) => p.name === 'Acme feedback'))
  const [seats] = await withoutActor((tx) => tx<{ n: number }[]>`select workspace_people(${workspaceId}) as n`)
  assert.equal(seats!.n, 1)
  void ctx

  // And `can` gives it a task to file and nothing else.
  const page = {
    role: 'member' as const,
    settings: {
      who_creates_projects: 'members',
      who_invites_people: 'owner',
      edit_others_content: 'documents_too',
      who_sees_members: 'members',
    } as const,
    feedbackPage: true,
    rights: ['manage'],
    inProject: true,
    onItsPage: true,
  }
  assert.equal(can('task.create', page), true)
  for (const a of ['task.delete', 'content.edit.any', 'project.tools', 'feedback.manage', 'people.invite', 'project.member.add'] as const) {
    assert.equal(can(a, page), false, a)
  }
})

test('a page’s rows are its workspace’s alone', async () => {
  const one = await setUp()
  const two = await setUp()
  // Another company's page, by its project, is not there.
  assert.equal((await two.me('GET', `/projects/${one.project}/feedback`)).status, 404)
  assert.equal((await two.me('PUT', `/projects/${one.project}/feedback`, { live: false })).status, 404)
  const seen = await withActor(two.ctx.actorId, (tx) => tx`select id from feedback_page where project_id = ${one.project}`)
  assert.equal(seen.length, 0)
})

test('a workspace cleared takes its page, its people and what they asked with it', async () => {
  const { slug, workspaceId } = await setUp()
  const ask = asker()
  const email = `di-${stamp()}@example.com`
  await ask('POST', `/${slug}/requests`, { title: 'Kept?', email })
  const token = linkIn(email)!
  assert.equal((await ask('POST', `/${slug}/confirm/${token}`)).status, 200)
  await ask('POST', `/${slug}/requests`, { title: 'Still waiting', email: `ed-${stamp()}@example.com` })
  const postgres = (await import('postgres')).default
  const owner = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} })
  try {
    await owner`select purge_workspace(${workspaceId})`
    const left = await owner<{ n: number }[]>`
      select (select count(*) from feedback_page where workspace_id = ${workspaceId})
           + (select count(*) from feedback_person where workspace_id = ${workspaceId})
           + (select count(*) from feedback_pending where workspace_id = ${workspaceId})
           + (select count(*) from feedback_item where workspace_id = ${workspaceId}) as n`
    assert.equal(Number(left[0]!.n), 0)
  } finally {
    await owner.end()
  }
  assert.equal((await app.request(`/api/f/${slug}`)).status, 404)
})

test('a page’s day counts what was filed as well as what waits', async () => {
  const { slug } = await setUp()
  const ask = asker()
  const email = `fa-${stamp()}@example.com`
  await ask('POST', `/${slug}/requests`, { title: 'First', email })
  const { key } = await json(await ask('POST', `/${slug}/confirm/${linkIn(email)!}`))
  const { hashToken } = await import('../src/auth/crypto.js')
  const [page] = await withoutActor((tx) => tx<{ page_id: string }[]>`select page_id from feedback_page_by_slug(${slug})`)
  // A ceiling of one: the request filed a moment ago is that one.
  const [held] = await withoutActor(
    (tx) => tx<{ full_today: boolean; pending_id: string | null }[]>`
    select * from feedback_hold(${page!.page_id}, null, ${hashToken(key)}, 'en', 'Second', '', null, 48, 1, 500)`,
  )
  assert.equal(held!.full_today, true)
  assert.equal(held!.pending_id, null)
})

test('turning the page on adds Triage where there is none, and turning it off leaves Triage be', async () => {
  const owner = await makeOwner()
  const me = as(owner.token)
  const intakes = async (project: string) =>
    withActor(
      owner.ctx.actorId,
      (tx) => tx<{ id: string }[]>`
      select id from task_list where project_id = ${project} and intake and deleted_at is null`,
    )

  // No Triage: the page brings one, and says so in its settings.
  const bare = (await json(await me('POST', '/projects', { name: `Bare ${stamp().slice(0, 4)}` }))).id as string
  assert.equal((await intakes(bare)).length, 0)
  assert.equal((await json(await me('GET', `/projects/${bare}/feedback`))).triage, false)
  assert.equal((await me('PUT', `/projects/${bare}/feedback`, { live: true, slug: `bare-${stamp()}`.slice(0, 30) })).status, 200)
  const made = await intakes(bare)
  assert.equal(made.length, 1)
  assert.equal((await json(await me('GET', `/projects/${bare}/feedback`))).triage, true)
  // At the head of the project, as the switch puts it.
  const [first] = await withActor(
    owner.ctx.actorId,
    (tx) => tx<{ intake: boolean }[]>`
    select intake from task_list where project_id = ${bare} and deleted_at is null order by sort_key limit 1`,
  )
  assert.equal(first!.intake, true)

  // Off: Triage stays. On again: the same one, not a second.
  assert.equal((await me('PUT', `/projects/${bare}/feedback`, { live: false })).status, 200)
  assert.deepEqual(await intakes(bare), made)
  assert.equal((await me('PUT', `/projects/${bare}/feedback`, { live: true })).status, 200)
  assert.deepEqual(await intakes(bare), made)

  // A project that had Triage keeps the one it had.
  const had = (await json(await me('POST', '/projects', { name: `Had ${stamp().slice(0, 4)}` }))).id as string
  const { list_id } = await json(await me('PUT', `/projects/${had}/triage`, { on: true }))
  assert.equal((await me('PUT', `/projects/${had}/feedback`, { live: true, slug: `had-${stamp()}`.slice(0, 30) })).status, 200)
  assert.deepEqual(
    (await intakes(had)).map((l) => l.id),
    [list_id],
  )

  // Saving the page without turning it on adds nothing.
  const quiet = (await json(await me('POST', '/projects', { name: `Quiet ${stamp().slice(0, 4)}` }))).id as string
  assert.equal((await me('PUT', `/projects/${quiet}/feedback`, { slug: `quiet-${stamp()}`.slice(0, 30) })).status, 200)
  assert.equal((await intakes(quiet)).length, 0)
})
