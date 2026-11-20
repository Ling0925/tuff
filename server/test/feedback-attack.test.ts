import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { app } from '../src/http/routes.js'
import { outbox } from '../src/mail.js'
import { closeRealtime } from '../src/realtime.js'
import { addPerson, bearerFor, closeDb, makeOwner, stamp, withActor, withoutActor } from './helpers.js'

/*
 * A feedback page, attacked — the review before it ships.
 * What a stranger types is words and nothing
 * else; the page's actor is nobody to pick; the mail is one we would sign.
 */
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

const somewhere = () => `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`
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

async function setUp(name = 'Acme') {
  const owner = await makeOwner()
  const me = as(owner.token)
  const project = (await json(await me('POST', '/projects', { name: `Mobile ${stamp().slice(0, 4)}` }))).id as string
  const slug = `atk-${stamp()}`.slice(0, 30)
  const on = await me('PUT', `/projects/${project}/feedback`, { live: true, slug, name })
  assert.equal(on.status, 200)
  return { ...owner, me, project, slug }
}

const mailTo = (to: string) => [...outbox].reverse().find((m) => m.to === to)
const linkIn = (to: string) => /\/confirm\/([A-Za-z0-9_-]{43})/.exec(mailTo(to)?.text ?? '')?.[1] ?? null

/** A request asked and confirmed; the task it became. */
async function filed(slug: string, project: string, ownerId: string, asked: { title: string; body?: string }) {
  const ask = asker()
  const email = `x-${stamp()}@example.com`
  assert.equal((await ask('POST', `/${slug}/requests`, { ...asked, email })).status, 200)
  assert.equal((await ask('POST', `/${slug}/confirm/${linkIn(email)!}`)).status, 200)
  const [t] = await withActor(
    ownerId,
    (tx) => tx<{ id: string; title: string }[]>`
    select id, title from task where project_id = ${project} and deleted_at is null order by created_at desc limit 1`,
  )
  return { task: t!, email }
}

test('a stranger’s words mention nobody and link nothing, whatever ids they spell out', async () => {
  const { ctx, workspaceId, project, slug, me } = await setUp()
  // Somebody on the project who does not follow the page.
  const ada = await addPerson(ctx, workspaceId, 'member', [project])
  const other = await json(await me('POST', `/projects/${project}/tasks`, { title: 'Existing' }))
  const { task } = await filed(slug, project, ctx.actorId, {
    title: 'Please look',
    body: `Hey @${ada.actorId} and @everyone — see /tasks/${other.id} and /posts/${ada.actorId}`,
  })
  const notes = await withActor(
    ada.actorId,
    (tx) => tx<{ n: number }[]>`
    select count(*)::int as n from notification where actor_id = ${ada.actorId} and object_id = ${task.id}`,
  )
  assert.equal(notes[0]!.n, 0, 'a stranger’s text mentioned a member by id')
  const links = await withActor(
    ctx.actorId,
    (tx) => tx<{ n: number }[]>`
    select count(*)::int as n from object_link where from_id = ${task.id} or to_id = ${task.id}`,
  )
  assert.equal(links[0]!.n, 0, 'a stranger’s text linked the task to another object')
})

test('a title is one line, and the mail’s only link is ours', async () => {
  const { slug } = await setUp()
  const email = `nl-${stamp()}@example.com`
  const r = await asker()('POST', `/${slug}/requests`, {
    title: 'Hi”\r\n\r\nConfirm request: https://evil.example/x\r\n\r\n“',
    email,
  })
  assert.equal(r.status, 200)
  const mail = mailTo(email)!
  // The only line that starts like the button's is the real one.
  const lines = mail.text.split('\n').filter((l) => l.startsWith('Confirm request:'))
  assert.equal(lines.length, 1)
  assert.match(lines[0]!, /\/confirm\//)
  const waiting = await json(await asker()('GET', `/${slug}/confirm/${linkIn(email)!}`))
  assert.ok(!/[\r\n]/.test(waiting.title))
})

test('a page’s name keeps to one line in the subject and the From', async () => {
  const { me, project, slug } = await setUp()
  const put = await me('PUT', `/projects/${project}/feedback`, { name: 'Acme\r\nBcc: victim@example.com' })
  // Refused, or kept to one line — never a line break into a header.
  if (put.status === 200) {
    const email = `hd-${stamp()}@example.com`
    await asker()('POST', `/${slug}/requests`, { title: 'x', email })
    const mail = mailTo(email)!
    assert.ok(!/[\r\n]/.test(mail.subject))
    assert.ok(!/[\r\n]/.test(mail.fromName ?? ''))
  } else {
    assert.equal(put.status, 400)
  }
})

test('the page’s actor is given no task and is in no room’s list of people', async () => {
  const { ctx, workspaceId, project, me } = await setUp()
  const [page] = await withActor(
    ctx.actorId,
    (tx) => tx<{ actor_id: string }[]>`
    select actor_id from feedback_page where project_id = ${project}`,
  )
  const made = await me('POST', `/projects/${project}/tasks`, { title: 'For the page', assignee_ids: [page!.actor_id] })
  assert.equal(made.status, 400, 'a task was given to the feedback page')
  void workspaceId

  const [room] = await withActor(
    ctx.actorId,
    (tx) => tx<{ id: string }[]>`
    select id from conversation where project_id = ${project} and deleted_at is null limit 1`,
  )
  const people = (await json(await me('GET', `/conversations/${room!.id}/members`))).members as Json[]
  assert.ok(!people.some((p) => p.actor_id === page!.actor_id), 'the page sits in the project’s room')
})

test('two presses at once file one task', async () => {
  const { ctx, project, slug } = await setUp()
  const ask = asker()
  const email = `twice-${stamp()}@example.com`
  await ask('POST', `/${slug}/requests`, { title: 'Once', email })
  const token = linkIn(email)!
  const answers = await Promise.all(Array.from({ length: 6 }, () => ask('POST', `/${slug}/confirm/${token}`)))
  assert.equal(answers.filter((a) => a.status === 200).length, 1)
  const tasks = await withActor(ctx.actorId, (tx) => tx`select 1 from task where project_id = ${project} and deleted_at is null`)
  assert.equal(tasks.length, 1)
})

test('the requester’s address reaches nobody who may not edit the task, and nothing but the task', async () => {
  const { ctx, workspaceId, project, slug, me } = await setUp()
  const { task, email } = await filed(slug, project, ctx.actorId, { title: 'Where is my address' })
  // The owner sees it.
  assert.equal((await json(await me('GET', `/tasks/${task.id}`))).feedback.email, email)

  // Somebody on the project who may not change others' tasks does not.
  const own = await withActor(
    ctx.actorId,
    (tx) => tx`
    update workspace set settings = settings || '{"edit_others_content":"own_only"}'::jsonb
    where id = ${workspaceId} returning id`,
  )
  assert.equal(own.length, 1)
  const bo = await addPerson(ctx, workspaceId, 'member', [project])
  const asBo = as(await bearerFor(bo.actorId, workspaceId))
  const read = await asBo('GET', `/tasks/${task.id}`)
  assert.equal(read.status, 200)
  const body = await read.text()
  assert.deepEqual((JSON.parse(body) as Json).feedback, { email: null })
  assert.ok(!body.includes(email), 'a member who may not edit read the address')

  // Nowhere else a team reads: the feed, the list, notifications, search.
  for (const path of [
    `/projects/${project}/activity`,
    `/projects/${project}/tasks`,
    '/notifications',
    `/search?q=${encodeURIComponent('Where is my address')}`,
  ]) {
    const r = await me('GET', path)
    assert.ok(!(await r.text()).includes(email), path)
  }
})

test('a project deleted for good takes its page and its requesters’ addresses with it', async () => {
  const { ctx, project, slug, me, workspaceId } = await setUp()
  const [page] = await withActor(
    ctx.actorId,
    (tx) => tx<{ actor_id: string }[]>`
    select actor_id from feedback_page where project_id = ${project}`,
  )
  const { task } = await filed(slug, project, ctx.actorId, { title: 'Gone with it' })
  await asker()('POST', `/${slug}/requests`, { title: 'Still waiting', email: `w-${stamp()}@example.com` })
  // A task filed from the page, deleted and cleared on its own.
  assert.equal((await me('DELETE', `/tasks/${task.id}`)).status < 300, true)
  assert.equal((await me('DELETE', `/projects/${project}`)).status < 300, true)
  const forever = await me('DELETE', `/projects/${project}/forever`)
  assert.equal(forever.status, 200, await forever.clone().text())
  const postgres = (await import('postgres')).default
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} })
  try {
    const [n] = await sql<{ n: number }[]>`
      select (select count(*) from feedback_page where project_id = ${project})
           + (select count(*) from feedback_person where project_id = ${project})
           + (select count(*) from feedback_item where project_id = ${project})
           + (select count(*) from feedback_follower where project_id = ${project}) as n`
    assert.equal(Number(n!.n), 0)
  } finally {
    await sql.end()
  }
  // And its address answers nothing.
  assert.equal((await app.request(`/api/f/${slug}`)).status, 404)
  // Its actor is not left behind as somebody: no seat, not in Members.
  const [seats] = await withoutActor((tx) => tx<{ n: number }[]>`select workspace_people(${workspaceId}) as n`)
  assert.equal(seats!.n, 1)
  const people = (await json(await me('GET', '/people'))).people as Json[]
  assert.ok(!people.some((p) => p.actor_id === page!.actor_id))
})

/* ---------------------------------------------- what the review left open */

test('the confirmation mail carries nothing the stranger wrote; the page it links to shows it', async () => {
  const { slug } = await setUp('Acme')
  const email = `nq-${stamp()}@example.com`
  const marker = `Visit evil dot example ${stamp()}`
  assert.equal((await asker()('POST', `/${slug}/requests`, { title: marker, body: `${marker} body`, email })).status, 200)
  const mail = mailTo(email)!
  assert.ok(!mail.subject.includes('evil') && !mail.text.includes('evil') && !mail.html.includes('evil'))
  assert.match(mail.text, /Acme/)
  const waiting = await json(await asker()('GET', `/${slug}/confirm/${linkIn(email)!}`))
  assert.equal(waiting.title, marker)
})

test('one workspace’s pages mail two thousand links a day, and no more', async () => {
  const { slug, workspaceId } = await setUp()
  const { spendOn } = await import('../src/http/limits.js')
  for (let i = 0; i < 2000; i += 100) {
    await Promise.all(Array.from({ length: 100 }, () => spendOn(`fb-ws-mail:${workspaceId}`, 2000, 86_400)))
  }
  const email = `ws-${stamp()}@example.com`
  const r = await asker()('POST', `/${slug}/requests`, { title: 'One more', email })
  // Held and answered as anybody is; nothing mailed.
  assert.equal(r.status, 200)
  assert.equal((await json(r)).status, 'check_email')
  assert.equal(mailTo(email), undefined)
})

test('a machine spread over an IPv6 /56 is one allowance, as a board’s starts are', async () => {
  const hex = (n: number, w: number) =>
    Math.floor(Math.random() * n)
      .toString(16)
      .padStart(w, '0')
  const net = `2001:db8:${hex(0xffff, 4)}:${hex(0xff, 2)}`
  const { slug } = await setUp()
  // Every request from a /64 of its own, all inside one /56.
  for (let i = 0; i < 30; i++) {
    const r = await asker(`${net}${i.toString(16).padStart(2, '0')}::1`)('POST', `/${slug}/requests`, {
      title: `Ask ${i}`,
      email: `six-${stamp()}@example.com`,
    })
    assert.equal(r.status, 200, `request ${i}`)
  }
  const past = await asker(`${net}ff::1`)('POST', `/${slug}/requests`, { title: 'Past it', email: `six-${stamp()}@example.com` })
  assert.equal(past.status, 429)
})

test('requests waiting for their link have a ceiling of their own, which never closes the page to the confirmed', async () => {
  const { slug } = await setUp()
  const ask = asker()
  const email = `wa-${stamp()}@example.com`
  await ask('POST', `/${slug}/requests`, { title: 'First', email })
  const { key } = await json(await ask('POST', `/${slug}/confirm/${linkIn(email)!}`))
  const { hashToken } = await import('../src/auth/crypto.js')
  const [page] = await withoutActor((tx) => tx<{ page_id: string }[]>`select page_id from feedback_page_by_slug(${slug})`)
  const hold = (who: { email?: string; key?: string }, waiting: number) =>
    withoutActor(
      (tx) => tx<{ full_today: boolean; pending_id: string | null }[]>`
      select * from feedback_hold(${page!.page_id}, ${who.email ?? null}, ${who.key ? hashToken(who.key) : null}, 'en',
                                  'x', '', ${who.email ? `t-${stamp()}` : null}, 48, 200, ${waiting})`,
    )
  // A ceiling of one waiting: the first stranger waits, the second is refused…
  assert.equal((await hold({ email: `s1-${stamp()}@example.com` }, 1))[0]!.full_today, false)
  assert.equal((await hold({ email: `s2-${stamp()}@example.com` }, 1))[0]!.full_today, true)
  // …and somebody who confirmed before still gets through.
  const keyed = (await hold({ key }, 1))[0]!
  assert.equal(keyed.full_today, false)
  assert.ok(keyed.pending_id)
})

test('a confirmation past the day’s ceiling files nothing, and its link still works tomorrow', async () => {
  const { slug } = await setUp()
  const ask = asker()
  const email = `cf-${stamp()}@example.com`
  await ask('POST', `/${slug}/requests`, { title: 'Late', email })
  const token = linkIn(email)!
  const { hashToken } = await import('../src/auth/crypto.js')
  const [page] = await withoutActor((tx) => tx<{ page_id: string }[]>`select page_id from feedback_page_by_slug(${slug})`)
  const [full] = await withoutActor(
    (tx) => tx<{ full_today: boolean; pending_id: string | null }[]>`
    select * from feedback_confirm(${page!.page_id}, ${hashToken(token)}, ${hashToken(`k-${stamp()}`)}, 0)`,
  )
  assert.equal(full!.full_today, true)
  assert.equal(full!.pending_id, null)
  assert.equal((await ask('GET', `/${slug}/confirm/${token}`)).status, 200)
})

test('a hold whose task was made is dropped, never let go: its link cannot file it twice', async () => {
  const { slug } = await setUp()
  const ask = asker()
  const email = `dr-${stamp()}@example.com`
  await ask('POST', `/${slug}/requests`, { title: 'Once', email })
  const token = linkIn(email)!
  const { hashToken } = await import('../src/auth/crypto.js')
  const [page] = await withoutActor((tx) => tx<{ page_id: string }[]>`select page_id from feedback_page_by_slug(${slug})`)
  const [claim] = await withoutActor(
    (tx) => tx<{ pending_id: string }[]>`
    select * from feedback_confirm(${page!.page_id}, ${hashToken(token)}, ${hashToken(`k-${stamp()}`)}, 200)`,
  )
  await withoutActor((tx) => tx`select feedback_drop(${claim!.pending_id})`)
  assert.equal((await ask('POST', `/${slug}/confirm/${token}`)).status, 410)
})

test('a page keeps its old address for thirty days, and two renames at once cannot share one', async () => {
  const a = await setUp()
  const b = await setUp()
  const base = `hold-${stamp()}`.slice(0, 28)
  assert.equal((await a.me('PUT', `/projects/${a.project}/feedback`, { slug: `${base}-1` })).status, 200)
  // Holding its first address, the page is not renamed again: that promise stands.
  const again = await a.me('PUT', `/projects/${a.project}/feedback`, { slug: `${base}-2` })
  assert.equal(again.status, 409)
  assert.equal((await json(again)).error.code, 'holding')
  assert.equal((await json(await b.me('GET', `/projects/${b.project}/feedback/slug/${a.slug}`))).free, false)
  assert.equal((await json(await app.request(`/api/f/${a.slug}`))).moved_to, `${base}-1`)
  // Back to the held address is taking it back.
  assert.equal((await a.me('PUT', `/projects/${a.project}/feedback`, { slug: a.slug })).status, 200)
  assert.equal((await json(await app.request(`/api/f/${a.slug}`))).moved_to, undefined)

  const c = await setUp()
  const race = `race-${stamp()}`.slice(0, 30)
  const both = await Promise.all([
    b.me('PUT', `/projects/${b.project}/feedback`, { slug: race }),
    c.me('PUT', `/projects/${c.project}/feedback`, { slug: race }),
  ])
  assert.deepEqual(both.map((r) => r.status).sort(), [200, 409])
  const owners = await withoutActor((tx) => tx`select page_id from feedback_page_by_slug(${race})`)
  assert.equal(owners.length, 1)
})

test('the confirmation mail is from Tuff with a plain subject, the page named only in its words', async () => {
  const { slug } = await setUp('Acme Support')
  const email = `fr-${stamp()}@example.com`
  await asker()('POST', `/${slug}/requests`, { title: 'x', email })
  const mail = mailTo(email)!
  assert.equal(mail.fromName, undefined)
  assert.equal(mail.subject, 'Confirm your request')
  assert.match(mail.text, /Acme Support/)
})

test('a page’s name and intro hold no web or email address', async () => {
  const { me, project } = await setUp()
  for (const name of ['https://evil.example', 'Sign in at www.evil', 'evil.com support', 'help@evil', 'PayPal.login']) {
    const r = await me('PUT', `/projects/${project}/feedback`, { name })
    assert.equal(r.status, 400, name)
    assert.match((await json(r)).error.message, /web or email addresses/)
  }
  assert.equal((await me('PUT', `/projects/${project}/feedback`, { intro: 'Write to us at hello@acme.io' })).status, 400)
  // Ordinary names and lines pass.
  assert.equal(
    (await me('PUT', `/projects/${project}/feedback`, { name: 'Acme 2.0', intro: 'Tell us what you need. Thanks!' })).status,
    200,
  )
})

test('a member on the project cannot rename the page or turn it on behind the route', async () => {
  const { project, ctx, workspaceId, slug } = await setUp()
  const sam = await addPerson(ctx, workspaceId, 'member', [project])
  const changed = await withActor(
    sam.actorId,
    (tx) =>
      tx`update feedback_page set slug = ${`stolen-${stamp()}`.slice(0, 30)}, live = false where project_id = ${project} returning id`,
  )
  assert.equal(changed.length, 0)
  assert.equal((await json(await app.request(`/api/f/${slug}`))).available, true)
})

test('the page’s actor files into its own project and no other', async () => {
  const { me, project, workspaceId, slug } = await setUp()
  const other = (await json(await me('POST', '/projects', { name: `Other ${stamp().slice(0, 4)}` }))).id as string
  const [page] = await withoutActor((tx) => tx<{ actor_id: string }[]>`select actor_id from feedback_page_by_slug(${slug})`)
  // Put on the other project too, as a mistake might: `can` still says no.
  const postgres = (await import('postgres')).default
  const owner = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} })
  try {
    await owner`
      insert into project_member (id, workspace_id, project_id, actor_id, added_by, rights)
      values (gen_random_uuid(), ${workspaceId}, ${other}, ${page!.actor_id}, ${page!.actor_id}, '{task.create}')`
  } finally {
    await owner.end()
  }
  const { issueAccessToken } = await import('../src/auth/tokens.js')
  const token = await issueAccessToken({ sub: page!.actor_id, workspace_id: workspaceId, via: 'feedback' })
  const there = await as(token)('POST', `/projects/${other}/tasks`, { title: 'Elsewhere' })
  assert.equal(there.status, 403)
  const here = await as(token)('POST', `/projects/${project}/tasks`, { title: 'Here' })
  assert.equal(here.status, 201)
})

test('in production, Turnstile’s answer has to say where it was solved', async () => {
  const { turnstileOk } = await import('../src/http/feedback.js')
  const real = globalThis.fetch
  const had = { secret: process.env.TURNSTILE_SECRET_KEY, env: process.env.NODE_ENV }
  let hostname: string | undefined
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ success: true, ...(hostname ? { hostname } : {}) }), {
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch
  process.env.TURNSTILE_SECRET_KEY = 'test-secret'
  try {
    process.env.NODE_ENV = 'production'
    assert.equal(await turnstileOk('solved', '10.0.0.1'), false)
    hostname = process.env.APP_URL ? new URL(process.env.APP_URL).hostname : 'usetuff.com'
    assert.equal(await turnstileOk('solved', '10.0.0.1'), true)
    process.env.NODE_ENV = 'test'
    hostname = undefined
    assert.equal(await turnstileOk('solved', '10.0.0.1'), true)
  } finally {
    globalThis.fetch = real
    process.env.NODE_ENV = had.env
    if (had.secret === undefined) delete process.env.TURNSTILE_SECRET_KEY
    else process.env.TURNSTILE_SECRET_KEY = had.secret
  }
})

test('one inbox is one inbox, however its address is spelled and on whichever page', async () => {
  const { inboxOf } = await import('../src/http/feedback.js')
  const pages = []
  for (let i = 0; i < 4; i++) pages.push(await setUp())
  const who = `vic${stamp()}`
  const inbox = `${who}@gmail.com`
  // The outbox keeps the last fifty: this inbox is new, so all of it is this test's.
  const reached = () => outbox.filter((m) => inboxOf(m.to) === inbox).length
  // Five spellings of one Gmail inbox on one page: three links.
  for (let i = 0; i < 5; i++) {
    const to = i % 2 ? `${who}+${i}@gmail.com` : `${who.slice(0, 2)}.${who.slice(2)}+${i}@googlemail.com`
    assert.equal((await asker()('POST', `/${pages[0]!.slug}/requests`, { title: 'x', email: to })).status, 200)
  }
  assert.equal(reached(), 3)
  // Across pages: ten a day, whatever the page.
  let n = 0
  for (const p of pages.slice(1)) {
    for (let i = 0; i < 4; i++) await asker()('POST', `/${p.slug}/requests`, { title: 'x', email: `${who}+p${n++}@gmail.com` })
  }
  assert.equal(reached(), 10)
})
