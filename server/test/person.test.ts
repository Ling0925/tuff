import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { app } from '../src/http/routes.js'
import { addPerson, asTableOwner, bearerFor, closeDb, withActor, withoutActor, uuidv7, makeOwner, makeProject } from './helpers.js'

after(async () => {
  await closeDb()
})

async function get(path: string, token: string) {
  const r = await app.request(path, { headers: { authorization: `Bearer ${token}` } })
  return { status: r.status, body: (await r.json()) as Record<string, unknown> }
}

async function task(
  ownerId: string,
  ws: string,
  project: string,
  title: string,
  extra: { due?: string; assignee?: string; done?: boolean } = {},
) {
  const id = uuidv7()
  await withActor(ownerId, async (tx) => {
    await tx`
      insert into task (id, workspace_id, project_id, author_id, title, sort_key,
                        due_on, assignee_ids, completed_at)
      values (${id}, ${ws}, ${project}, ${ownerId}, ${title}, ${'a' + title.length},
              ${extra.due ?? null}, ${extra.assignee ? [extra.assignee] : []}::uuid[],
              ${extra.done ? tx`now()` : null})`
  })
  return id
}

/*
 * `/members/:actorId` was an address that drew a name, a role and three ways
 * to administer somebody, and said nothing about what they were doing —
 * which is the question anybody opening a colleague's name is asking.
 */
test('a person answers with their projects and what is open on them', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const one = await makeProject(ctx, workspaceId, 'Acme')
  const two = await makeProject(ctx, workspaceId, 'Website')
  const sam = await addPerson(ctx, workspaceId, 'member', [one, two])

  await task(ctx.actorId, workspaceId, one, 'Late', { assignee: sam.actorId, due: '2020-01-01' })
  await task(ctx.actorId, workspaceId, one, 'Soon', { assignee: sam.actorId, due: '2099-01-01' })
  await task(ctx.actorId, workspaceId, two, 'Undated', { assignee: sam.actorId })
  // Finished late is history, not a problem — one definition of overdue.
  await task(ctx.actorId, workspaceId, one, 'Done late', {
    assignee: sam.actorId,
    due: '2020-01-01',
    done: true,
  })
  await task(ctx.actorId, workspaceId, one, 'Somebody else', { assignee: ctx.actorId })

  const r = await get(`/api/people/${sam.actorId}`, token)
  assert.equal(r.status, 200)
  const open = r.body.open as { title: string; overdue: boolean }[]
  // Dated first, in date order, and the undated after them.
  assert.deepEqual(
    open.map((t) => t.title),
    ['Late', 'Soon', 'Undated'],
  )
  assert.deepEqual(
    open.map((t) => t.overdue),
    [true, false, false],
  )
  assert.deepEqual((r.body.projects as { name: string }[]).map((p) => p.name).sort(), ['Acme', 'Website'])
})

test('what is on somebody is bounded by what the asker can see', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const shared = await makeProject(ctx, workspaceId, 'Shared')
  const apart = await makeProject(ctx, workspaceId, 'Apart')

  const sam = await addPerson(ctx, workspaceId, 'member', [shared, apart])
  // On the shared one only, so half of Sam's work is not theirs to read.
  const robin = await addPerson(ctx, workspaceId, 'member', [shared])
  const robinToken = await bearerFor(robin.actorId, workspaceId)

  await task(ctx.actorId, workspaceId, shared, 'Both see this', { assignee: sam.actorId })
  await task(ctx.actorId, workspaceId, apart, 'Only the owner sees this', { assignee: sam.actorId })

  const mine = await get(`/api/people/${sam.actorId}`, token)
  assert.deepEqual((mine.body.open as { title: string }[]).map((t) => t.title).sort(), ['Both see this', 'Only the owner sees this'])

  /*
   * Not a filter in the endpoint: the query runs as the asker under
   * row-level security, so the row is not there to leave out. The screen is
   * a slice and says so rather than implying it is everything.
   */
  const theirs = await get(`/api/people/${sam.actorId}`, robinToken)
  assert.equal(theirs.status, 200)
  assert.deepEqual(
    (theirs.body.open as { title: string }[]).map((t) => t.title),
    ['Both see this'],
  )
  assert.deepEqual(
    (theirs.body.projects as { name: string }[]).map((p) => p.name),
    ['Shared'],
  )
})

test('somebody in another workspace is not there at all', async () => {
  const mine = await makeOwner()
  const theirs = await makeOwner()
  const r = await get(`/api/people/${theirs.ctx.actorId}`, mine.token)
  // 404 and not 403: that the person exists is information about somebody
  // else's company.
  assert.equal(r.status, 404)
})

/* `docs/specs/person-card.md`. */
test('a colleague shows their email, zone and title, and the work you share', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const shared = await makeProject(ctx, workspaceId, 'Shared')
  const theirs = await makeProject(ctx, workspaceId, 'Theirs only')
  const sam = await addPerson(ctx, workspaceId, 'member', [shared, theirs])
  const samToken = await bearerFor(sam.actorId, workspaceId)
  await asTableOwner().begin(async (tx) => {
    await tx`
      insert into app_user (actor_id, email, password_hash, timezone)
      values (${sam.actorId}, ${`sam-${sam.actorId}@example.com`}, 'x', 'Europe/Lisbon')`
  })
  // Their title is theirs to set.
  const set = await app.request('/api/me', {
    method: 'PATCH',
    headers: { authorization: `Bearer ${samToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ title: '  Designer  ' }),
  })
  assert.equal(set.status, 200)

  await task(ctx.actorId, workspaceId, shared, 'Open', { assignee: sam.actorId })
  await task(ctx.actorId, workspaceId, shared, 'Late', { assignee: sam.actorId, due: '2020-01-01' })
  await task(ctx.actorId, workspaceId, shared, 'Done', { assignee: sam.actorId, done: true })

  // The owner leaves the second project: they can still see it, but it is
  // not work they share, and the card is about that.
  await withActor(
    ctx.actorId,
    (tx) =>
      tx`update project_member set deleted_at = now()
       where project_id = ${theirs} and actor_id = ${ctx.actorId}`,
  )
  await task(sam.actorId, workspaceId, theirs, 'Elsewhere', { assignee: sam.actorId })

  const r = await get(`/api/people/${sam.actorId}`, token)
  assert.equal(r.status, 200)
  const person = r.body.person as { email: string; timezone: string; title: string }
  assert.equal(person.email, `sam-${sam.actorId}@example.com`)
  assert.equal(person.timezone, 'Europe/Lisbon')
  assert.equal(person.title, 'Designer')
  assert.deepEqual(
    (r.body.shared as { name: string; open: number; overdue: number; done: number }[]).map(({ name, open, overdue, done }) => ({
      name,
      open,
      overdue,
      done,
    })),
    [{ name: 'Shared', open: 2, overdue: 1, done: 1 }],
  )
})

test('a task answers as a card, and not to somebody who cannot see it', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const mine = await makeProject(ctx, workspaceId, 'Acme')
  const other = await makeProject(ctx, workspaceId, 'Elsewhere')
  const sam = await addPerson(ctx, workspaceId, 'member', [other])
  const id = await task(ctx.actorId, workspaceId, mine, 'Ship the homepage', { assignee: ctx.actorId, due: '2099-01-01' })

  const r = await get(`/api/tasks/${id}/card`, token)
  assert.equal(r.status, 200)
  const card = r.body.card as { title: string; number: number; project_key: string; due_on: string; assignee_id: string }
  assert.equal(card.title, 'Ship the homepage')
  assert.ok(card.project_key)
  assert.equal(card.assignee_id, ctx.actorId)

  const samToken = await bearerFor(sam.actorId, workspaceId)
  assert.equal((await get(`/api/tasks/${id}/card`, samToken)).status, 404)
})

/*
 * The fourth switch closes the Members screen and not the people in it.
 * A colleague's weeks, days, hours and
 * projects are the page's; who they are and the work two people share is the
 * card's, and the card is on every face.
 */
test("a closed Members screen keeps a colleague's page and leaves their card", async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const acme = await makeProject(ctx, workspaceId, 'Acme')
  const sam = await addPerson(ctx, workspaceId, 'member', [acme])
  const ann = await addPerson(ctx, workspaceId, 'member', [acme])
  await task(ctx.actorId, workspaceId, acme, 'On Sam', { assignee: sam.actorId })
  await withActor(
    ctx.actorId,
    (tx) => tx`update workspace set settings = settings || '{"who_sees_members":"owner"}' where id = ${workspaceId}`,
  )
  const annToken = await bearerFor(ann.actorId, workspaceId)

  const theirs = await get(`/api/people/${sam.actorId}`, annToken)
  assert.equal(theirs.status, 200)
  assert.equal((theirs.body.person as { name: string }).name, 'member')
  assert.deepEqual(
    (theirs.body.open as { title: string }[]).map((t) => t.title),
    ['On Sam'],
  )
  assert.equal((theirs.body.shared as unknown[]).length, 1)
  for (const page of ['projects', 'weeks', 'days', 'hours']) {
    assert.deepEqual(theirs.body[page], [], page)
  }

  // One's own numbers whatever the switch says: My tasks reads them here.
  const own = await get(`/api/people/${ann.actorId}`, annToken)
  assert.equal((own.body.weeks as unknown[]).length, 12)
  assert.equal((own.body.projects as unknown[]).length, 1)

  // The owner keeps the screen; everyone keeps the people.
  const owners = await get(`/api/people/${sam.actorId}`, token)
  assert.equal((owners.body.weeks as unknown[]).length, 12)
  assert.equal((owners.body.projects as unknown[]).length, 1)
  const roster = await get('/api/people', annToken)
  assert.equal(roster.status, 200)
  assert.equal((roster.body.people as unknown[]).length, 3)

  const me = await get('/api/me', annToken)
  assert.equal((me.body.can as string[]).includes('members.read'), false)
  assert.equal((me.body.can as string[]).includes('people.read'), true)
})

/*
 * Late is the day it was due having ended where the reader is, not in
 * Greenwich — `server/src/day.ts`. Kiritimati and Pago Pago are twenty-five
 * hours apart, so their calendars are a day or two apart at any moment: a
 * task due the day before Kiritimati's today is late there and still today
 * or ahead in Pago Pago, whatever the hour the test runs.
 */
test('overdue is decided on the reader’s calendar', async () => {
  const { ctx, workspaceId } = await makeOwner()
  const one = await makeProject(ctx, workspaceId, 'Acme')
  const [edge] = await withoutActor(
    (tx) => tx<{ day: string }[]>`select to_char((now() at time zone 'Pacific/Kiritimati')::date - 1, 'YYYY-MM-DD') as day`,
  )
  await task(ctx.actorId, workspaceId, one, 'Edge', { assignee: ctx.actorId, due: edge!.day })

  /* Asked by somebody on the project whose account holds that zone. */
  const lateIn = async (zone: string) => {
    const reader = await addPerson(ctx, workspaceId, 'member', [one])
    await asTableOwner().begin(
      (tx) => tx`
      insert into app_user (actor_id, email, password_hash, timezone)
      values (${reader.actorId}, ${`r-${reader.actorId}@example.com`}, 'x', ${zone})`,
    )
    const r = await get(`/api/people/${ctx.actorId}`, await bearerFor(reader.actorId, workspaceId))
    return (r.body.open as { title: string; overdue: boolean }[]).find((t) => t.title === 'Edge')!.overdue
  }
  assert.equal(await lateIn('Pacific/Kiritimati'), true)
  assert.equal(await lateIn('Pacific/Pago_Pago'), false)
})

/* Somebody removed still has a face on what they said; pressing it says they
   are gone, with their name, and nothing else of theirs. */
test('a removed person answers as removed, with their name and nothing more', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const kit = await addPerson(ctx, workspaceId, 'member', [])
  const peer = await addPerson(ctx, workspaceId, 'member', [])
  const asPeer = await bearerFor(peer.actorId, workspaceId)
  const r = await app.request(`/api/people/${kit.actorId}`, { method: 'DELETE', headers: { authorization: `Bearer ${token}` } })
  assert.ok(r.status < 300, String(r.status))
  for (const t of [token, asPeer]) {
    const { status, body } = await get(`/api/people/${kit.actorId}`, t)
    assert.equal(status, 410)
    assert.equal((body.error as { code: string }).code, 'removed')
    const person = body.person as Record<string, unknown>
    assert.ok(person.name)
    assert.deepEqual(Object.keys(person).sort(), ['actor_id', 'avatar_url', 'name'].sort())
  }
  // Somebody who was never here is still nobody.
  const stranger = await makeOwner()
  assert.equal((await get(`/api/people/${stranger.ctx.actorId}`, token)).status, 404)
})
