import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { app } from '../src/http/routes.js'
import { startSession } from '../src/auth/flows.js'
import { addPerson, closeDb, withActor, uuidv7, makeOwner, makeProject, inWorkspace } from './helpers.js'
import type { Tx } from '../src/db.js'

after(async () => {
  await closeDb()
})

/**
 * The four permissions, asked of the endpoints rather than of `can`.
 *
 * They were stored, shown in the project's settings and handed out for a
 * while, and no endpoint consulted any of them: creating a task asked the
 * general `content.create`, and deleting one asked whether you could edit.
 * So a box somebody had deliberately left unticked decided nothing, and the
 * screen said otherwise. The unit test for `can` would have passed
 * throughout — which is why this one goes through HTTP.
 */
async function call(method: string, path: string, token: string, body?: unknown): Promise<number> {
  const r = await app.request(path, {
    method,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return r.status
}

async function tokenFor(actorId: string, workspaceId: string): Promise<string> {
  const s = await startSession(actorId, workspaceId, {}, null)
  return s.access_token
}

test('making a task is its own permission, on the project it is about', async () => {
  const { ctx, workspaceId } = await makeOwner()
  const here = await makeProject(ctx, workspaceId, 'Rebrand')
  const there = await makeProject(ctx, workspaceId, 'Wiki')

  // On both projects; allowed to make tasks on one of them.
  const sam = await addPerson(ctx, workspaceId, 'member', [here], ['task.create'])
  await withActor(ctx.actorId, async (tx) => {
    await tx`
      insert into project_member (id, workspace_id, project_id, actor_id, added_by, rights)
      values (${uuidv7()}, ${workspaceId}, ${there}, ${sam.actorId}, ${ctx.actorId}, ${[]})`
  })
  const token = await tokenFor(sam.actorId, workspaceId)

  assert.equal(await call('POST', `/api/projects/${here}/tasks`, token, { title: 'Yes' }), 201)
  assert.equal(await call('POST', `/api/projects/${there}/tasks`, token, { title: 'No' }), 403)

  // A list is where tasks go, so it is the same permission. Without this, a
  // person who may make tasks and not the list to put them in can only ever
  // add to somebody else's arrangement.
  assert.equal(await call('POST', `/api/projects/${here}/lists`, token, { name: 'Round one' }), 201)
  assert.equal(await call('POST', `/api/projects/${there}/lists`, token, { name: 'Nope' }), 403)
})

test("your own task is yours; somebody else's needs the permission", async () => {
  const { ctx, workspaceId } = await makeOwner()
  const project = await makeProject(ctx, workspaceId, 'Rebrand')
  const sam = await addPerson(ctx, workspaceId, 'member', [project], ['task.create'])
  const token = await tokenFor(sam.actorId, workspaceId)

  /* Each written by its own author. The insert policy requires it, which is
     the schema saying the same thing this test is about. */
  const mine = uuidv7()
  const theirs = uuidv7()
  for (const [id, author] of [
    [mine, sam.actorId],
    [theirs, ctx.actorId],
  ] as const) {
    await withActor(
      author,
      (tx) =>
        tx`insert into task (id, workspace_id, project_id, author_id, title, sort_key)
         values (${id}, ${workspaceId}, ${project}, ${author}, 'A task', ${'a' + id.slice(0, 6)})`,
    )
  }

  // Throwing away a typo made a second ago is not a permission anybody
  // should have to be given.
  assert.equal(await call('DELETE', `/api/tasks/${mine}`, token), 200)
  assert.equal(await call('DELETE', `/api/tasks/${theirs}`, token), 403)

  // Given it, the other one goes too — and separately from making them.
  await withActor(
    ctx.actorId,
    (tx) =>
      tx`update project_member set rights = ${['task.delete']}
       where project_id = ${project} and actor_id = ${sam.actorId}`,
  )
  const after = await tokenFor(sam.actorId, workspaceId)
  assert.equal(await call('DELETE', `/api/tasks/${theirs}`, after), 200)
  assert.equal(
    await call('POST', `/api/projects/${project}/tasks`, after, { title: 'Not any more' }),
    403,
    'deleting was given and making was taken away — two permissions, not one',
  )
})

test('a channel is made and thrown away by two separate permissions', async () => {
  const { ctx, workspaceId } = await makeOwner()
  const project = await makeProject(ctx, workspaceId, 'Rebrand')
  const sam = await addPerson(ctx, workspaceId, 'member', [project], ['channel.create'])
  const token = await tokenFor(sam.actorId, workspaceId)

  const made = await app.request(`/api/projects/${project}/conversations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ name: 'Launch' }),
  })
  assert.equal(made.status, 201)
  const { id } = (await made.json()) as { id: string }

  // Making one does not carry throwing it away. This is the pair the
  // settings screen shows as two boxes, so it has to be two answers.
  assert.equal(await call('DELETE', `/api/conversations/${id}`, token), 403)

  await withActor(
    ctx.actorId,
    (tx) =>
      tx`update project_member set rights = ${['channel.create', 'channel.delete']}
       where project_id = ${project} and actor_id = ${sam.actorId}`,
  )
  const after = await tokenFor(sam.actorId, workspaceId)
  assert.equal(await call('DELETE', `/api/conversations/${id}`, after), 200)

  // Marked, not removed — the clear-out in the worker is what finally takes
  // it, and until then the room can be brought back by hand.
  const [row] = await withActor(
    ctx.actorId,
    (tx) => tx<{ deleted_at: string | null }[]>`select deleted_at from conversation where id = ${id}`,
  )
  assert.notEqual(row?.deleted_at, null)
})

test('a direct conversation is left, not deleted', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const mate = await addPerson(ctx, workspaceId, 'member', [])

  const made = await app.request('/api/conversations/direct', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ actor_ids: [mate.actorId] }),
  })
  assert.equal(made.status, 201)
  const { id } = (await made.json()) as { id: string }

  /* Refused for the owner too, who may do everything else. It is not a room
     anybody owns: leaving it for the other person is not a thing one of two
     people gets to decide. */
  assert.equal(await call('DELETE', `/api/conversations/${id}`, token), 400)
})

/**
 * A list goes, and where its tasks go is asked rather than assumed.
 *
 * Renaming asked for nothing at all: the row was reachable by anybody in the
 * workspace whose project it was, so somebody given everything except
 * `task.create` could still rename the columns of a board. The screen hid the
 * control, which is not the same as the server refusing it.
 */
test('a list is renamed with one right and removed with another', async () => {
  const { ctx, workspaceId, token: owner } = await makeOwner()
  const project = await makeProject(ctx, workspaceId, 'Rebrand')

  const made = await app.request(`/api/projects/${project}/lists`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${owner}` },
    body: JSON.stringify({ name: 'Backlog' }),
  })
  const { id: list } = (await made.json()) as { id: string }
  const other = await app.request(`/api/projects/${project}/lists`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${owner}` },
    body: JSON.stringify({ name: 'Doing' }),
  })
  const { id: doing } = (await other.json()) as { id: string }

  // On the project, allowed to make tasks and not to remove them.
  const sam = await addPerson(ctx, workspaceId, 'member', [project], ['task.create'])
  const theirs = await tokenFor(sam.actorId, workspaceId)
  assert.equal(await call('PATCH', `/api/lists/${list}`, theirs, { name: 'Later' }), 200)
  assert.equal(await call('DELETE', `/api/lists/${list}?into=nowhere`, theirs), 403)

  // And somebody on the project with neither cannot rename it either.
  const dana = await addPerson(ctx, workspaceId, 'member', [project], [])
  const hers = await tokenFor(dana.actorId, workspaceId)
  assert.equal(await call('PATCH', `/api/lists/${list}`, hers, { name: 'Nope' }), 403)

  /*
   * The work in it has to be somewhere, and the server will not choose.
   *
   * A list quietly emptied into nowhere is a board that lost a column and an
   * afternoon spent working out where the tasks went — so a list holding
   * anything is refused until the caller says.
   */
  const task = await app.request(`/api/projects/${project}/tasks`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${owner}` },
    body: JSON.stringify({ title: 'Stray', list_id: list }),
  })
  const { id: stray } = (await task.json()) as { id: string }

  assert.equal(await call('DELETE', `/api/lists/${list}`, owner), 409)
  // A destination that is not a live list here is refused rather than read as
  // "nowhere": losing the tasks to a typo is the fault this is all about.
  assert.equal(await call('DELETE', `/api/lists/${list}?into=${uuidv7()}`, owner), 400)
  assert.equal(await call('DELETE', `/api/lists/${list}?into=${doing}`, owner), 200)

  const [moved] = await withActor(ctx.actorId, (tx) => tx<{ list_id: string | null }[]>`select list_id from task where id = ${stray}`)
  assert.equal(moved?.list_id, doing)

  // Marked, not removed: the list comes back until the clear-out. Where its
  // tasks were does not, which is why that is the question it asks.
  const [row] = await withActor(
    ctx.actorId,
    (tx) => tx<{ deleted_at: string | null }[]>`select deleted_at from task_list where id = ${list}`,
  )
  assert.notEqual(row?.deleted_at, null)

  // An empty one goes on the press, because there is nothing to ask.
  const spare = await app.request(`/api/projects/${project}/lists`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${owner}` },
    body: JSON.stringify({ name: 'Spare' }),
  })
  const { id: empty } = (await spare.json()) as { id: string }
  assert.equal(await call('DELETE', `/api/lists/${empty}`, owner), 200)
})

/*
 * What one person may start — `docs/specs/member-rights.md`.
 *
 * The owner's word about somebody, asked of the endpoints: the switch says
 * "members may make projects" and the flag says "not this one"; a project
 * hands out channels and the flag says "nowhere". Each word is checked in
 * both directions, and against the person it was not said about.
 */
test('the owner says, person by person, who may start projects and channels', async () => {
  const { ctx, workspaceId, token: owner } = await makeOwner()
  const room = await makeProject(ctx, workspaceId, 'Studio')
  const ann = await addPerson(ctx, workspaceId, 'member', [room], ['task.create', 'channel.create'])
  const ben = await addPerson(ctx, workspaceId, 'member', [room], ['task.create', 'channel.create'])
  const annT = await tokenFor(ann.actorId, workspaceId)
  const benT = await tokenFor(ben.actorId, workspaceId)
  const project = (n: string) => ({ name: n })
  const channel = (n: string) => ({ name: n })

  // Nothing said yet: the switch decides projects, the project decides channels.
  assert.equal(await call('POST', '/api/projects', annT, project('Ann one')), 201)
  assert.equal(await call('POST', `/api/projects/${room}/conversations`, annT, channel('ann-one')), 201)

  // Only the owner says it, and not about the owner.
  assert.equal(await call('PATCH', `/api/people/${ben.actorId}`, annT, { may_create_projects: false }), 403)
  assert.equal(await call('PATCH', `/api/people/${ctx.actorId}`, owner, { may_create_projects: false }), 403)

  assert.equal(
    await call('PATCH', `/api/people/${ann.actorId}`, owner, {
      may_create_projects: false,
      may_create_channels: false,
    }),
    200,
  )
  assert.equal(await call('POST', '/api/projects', annT, project('Ann two')), 403)
  assert.equal(await call('POST', `/api/projects/${room}/conversations`, annT, channel('ann-two')), 403)
  // Ben was not the one it was said about.
  assert.equal(await call('POST', '/api/projects', benT, project('Ben one')), 201)
  assert.equal(await call('POST', `/api/projects/${room}/conversations`, benT, channel('ben-one')), 201)

  // The roster says what each of them may start.
  const roster = await app.request('/api/people', { headers: { authorization: `Bearer ${owner}` } })
  const people = ((await roster.json()) as { people: { actor_id: string; creates_projects: boolean; may_create_channels: boolean }[] })
    .people
  const a = people.find((p) => p.actor_id === ann.actorId)!
  assert.equal(a.creates_projects, false)
  assert.equal(a.may_create_channels, false)

  // A word for somebody beats the switch the other way too.
  await withActor(
    ctx.actorId,
    (tx) => tx`update workspace set settings = settings || '{"who_creates_projects":"owner"}' where id = ${workspaceId}`,
  )
  assert.equal(await call('POST', '/api/projects', benT, project('Ben two')), 403)
  assert.equal(
    await call('PATCH', `/api/people/${ann.actorId}`, owner, {
      may_create_projects: true,
      may_create_channels: true,
    }),
    200,
  )
  assert.equal(await call('POST', '/api/projects', annT, project('Ann three')), 201)
  assert.equal(await call('POST', `/api/projects/${room}/conversations`, annT, channel('ann-three')), 201)

  // Null hands the decision back to the switch.
  assert.equal(await call('PATCH', `/api/people/${ann.actorId}`, owner, { may_create_projects: null }), 200)
  assert.equal(await call('POST', '/api/projects', annT, project('Ann four')), 403)
})

/*
 * A channel outside every project, and a channel's name and people changed
 * after it was made.
 */
test('a channel can stand outside a project, be renamed, and say who is in it', async () => {
  const { ctx, workspaceId, token: owner } = await makeOwner()
  const room = await makeProject(ctx, workspaceId, 'Studio')
  const ann = await addPerson(ctx, workspaceId, 'member', [room], ['task.create', 'channel.create'])
  const ben = await addPerson(ctx, workspaceId, 'member', [room], ['task.create'])
  const annT = await tokenFor(ann.actorId, workspaceId)
  const benT = await tokenFor(ben.actorId, workspaceId)
  const req = (method: string, path: string, token: string, body?: unknown) =>
    app.request(path, {
      method,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  const rooms = async (token: string) =>
    (
      (await (await req('GET', '/api/conversations', token)).json()) as {
        conversations: { id: string; name: string; channel: boolean; project_slug: string | null; can: string[] }[]
      }
    ).conversations

  // Made for two, written the way Slack writes a name.
  const made = await req('POST', '/api/conversations/channels', annT, { name: '# Off Site', member_ids: [ctx.actorId] })
  assert.equal(made.status, 201)
  const { id } = (await made.json()) as { id: string }
  const seen = (await rooms(annT)).find((r) => r.id === id)!
  assert.equal(seen.name, 'off-site')
  assert.equal(seen.channel, true)
  /* And its incoming webhooks, as whoever may rename it. */
  /* And leaving it, anybody's in person. */
  assert.deepEqual(seen.can.sort(), ['delete', 'edit', 'hooks', 'leave'])
  assert.equal(
    (await rooms(benT)).some((r) => r.id === id),
    false,
  )

  // Ben is brought in, then the room is renamed by somebody in it.
  assert.equal(
    (await req('PUT', `/api/conversations/${id}/members`, annT, { member_ids: [ann.actorId, ctx.actorId, ben.actorId] })).status,
    200,
  )
  assert.equal(
    (await rooms(benT)).some((r) => r.id === id),
    true,
  )
  assert.equal((await req('PATCH', `/api/conversations/${id}`, benT, { name: 'Offsite 2027' })).status, 200)
  assert.equal((await rooms(annT)).find((r) => r.id === id)!.name, 'offsite-2027')
  // Ben did not make it, so Ben does not throw it away; Ann did.
  assert.equal((await req('DELETE', `/api/conversations/${id}`, benT)).status, 403)

  // Whoever changes the room cannot take themselves out of it.
  assert.equal((await req('PUT', `/api/conversations/${id}/members`, annT, { member_ids: [ctx.actorId, ben.actorId] })).status, 200)
  assert.equal(
    (await rooms(annT)).some((r) => r.id === id),
    true,
  )

  // Taken out again, Ben loses the way in.
  assert.equal((await req('PUT', `/api/conversations/${id}/members`, annT, { member_ids: [ann.actorId, ctx.actorId] })).status, 200)
  assert.equal(
    (await rooms(benT)).some((r) => r.id === id),
    false,
  )
  assert.equal((await req('DELETE', `/api/conversations/${id}`, annT)).status, 200)

  // Everyone, left out, is everybody in the workspace.
  const all = (await (await req('POST', '/api/conversations/channels', annT, { name: 'general' })).json()) as { id: string }
  assert.equal(
    (await rooms(benT)).some((r) => r.id === all.id),
    true,
  )

  // The owner keeping somebody from channels keeps them from these too.
  await req('PATCH', `/api/people/${ann.actorId}`, owner, { may_create_channels: false })
  assert.equal((await req('POST', '/api/conversations/channels', annT, { name: 'nope' })).status, 403)

  // A project's channel: renamed by whoever may open one there, and its
  // people chosen and handed back to the project.
  const projMade = await req('POST', `/api/projects/${room}/conversations`, owner, { name: 'main' })
  const proj = (await projMade.json()) as { id: string }
  assert.equal((await req('PATCH', `/api/conversations/${proj.id}`, benT, { name: 'x' })).status, 403)
  assert.equal((await req('PUT', `/api/conversations/${proj.id}/members`, owner, { member_ids: [ctx.actorId] })).status, 200)
  assert.equal(
    (await rooms(benT)).some((r) => r.id === proj.id),
    false,
  )
  assert.equal((await req('PUT', `/api/conversations/${proj.id}/members`, owner, { member_ids: null })).status, 200)
  assert.equal(
    (await rooms(benT)).some((r) => r.id === proj.id),
    true,
  )
})

/*
 * And whom one person sees and brings in — `docs/specs/member-rights.md`.
 * Each word against its switch, in both directions, and against the person
 * it was not said about.
 */
test('the owner says, person by person, who sees Members and who invites', async () => {
  const { ctx, workspaceId, token: owner } = await makeOwner()
  const room = await makeProject(ctx, workspaceId, 'Studio')
  const ann = await addPerson(ctx, workspaceId, 'member', [room])
  const ben = await addPerson(ctx, workspaceId, 'member', [room])
  const annT = await tokenFor(ann.actorId, workspaceId)
  const benT = await tokenFor(ben.actorId, workspaceId)
  const can = async (token: string) => {
    const r = await app.request('/api/me', { headers: { authorization: `Bearer ${token}` } })
    return ((await r.json()) as { can: string[] }).can
  }

  // Nothing said: the switches decide — Members open, inviting the owner's.
  assert.equal((await can(annT)).includes('members.read'), true)
  assert.equal(await call('POST', '/api/invites', annT, { rights: [] }), 403)

  // Only the owner says it.
  assert.equal(await call('PATCH', `/api/people/${ben.actorId}`, annT, { may_invite_people: true }), 403)
  assert.equal(
    await call('PATCH', `/api/people/${ann.actorId}`, owner, {
      may_see_members: false,
      may_invite_people: true,
    }),
    200,
  )
  assert.equal((await can(annT)).includes('members.read'), false)
  assert.equal(await call('POST', '/api/invites', annT, { rights: [] }), 200)
  // A colleague's page is the card for her now, and the people are all still there.
  const page = await app.request(`/api/people/${ben.actorId}`, { headers: { authorization: `Bearer ${annT}` } })
  assert.deepEqual(((await page.json()) as { weeks: unknown[] }).weeks, [])
  assert.equal(await call('GET', '/api/people', annT), 200)
  // Ben was not the one it was said about.
  assert.equal((await can(benT)).includes('members.read'), true)
  assert.equal(await call('POST', '/api/invites', benT, { rights: [] }), 403)

  // The roster says the answers.
  const roster = await app.request('/api/people', { headers: { authorization: `Bearer ${owner}` } })
  const people = ((await roster.json()) as { people: { actor_id: string; sees_members: boolean; invites_people: boolean }[] }).people
  const a = people.find((p) => p.actor_id === ann.actorId)!
  assert.equal(a.sees_members, false)
  assert.equal(a.invites_people, true)

  // A word beats the switch the other way too, and null hands it back.
  await withActor(
    ctx.actorId,
    (tx) => tx`update workspace set settings = settings || '{"who_sees_members":"owner"}' where id = ${workspaceId}`,
  )
  assert.equal((await can(benT)).includes('members.read'), false)
  assert.equal(await call('PATCH', `/api/people/${ben.actorId}`, owner, { may_see_members: true }), 200)
  assert.equal((await can(benT)).includes('members.read'), true)
  assert.equal(await call('PATCH', `/api/people/${ann.actorId}`, owner, { may_invite_people: null }), 200)
  assert.equal(await call('POST', '/api/invites', annT, { rights: [] }), 403)
})

/*
 * Taking somebody off a project asked `project.member.add`, and the
 * row's policy under the update asked whether the caller runs the project:
 * a member who may add and does not run it was answered 200 and nobody
 * left.
 */
test('taking somebody off a project is running it, and a removal that removed nobody is not a 200', async () => {
  const { ctx, workspaceId, token: owner } = await makeOwner()
  const here = await makeProject(ctx, workspaceId, 'Rebrand')
  const sam = await addPerson(ctx, workspaceId, 'member', [here])
  const pat = await addPerson(ctx, workspaceId, 'member', [here])
  const mo = await addPerson(ctx, workspaceId, 'member', [here], ['manage'])
  const samT = await tokenFor(sam.actorId, workspaceId)
  const moT = await tokenFor(mo.actorId, workspaceId)
  const on = async (actorId: string) => {
    const [row] = await withActor(
      ctx.actorId,
      (tx) =>
        tx<{ n: number }[]>`select count(*)::int as n from project_member
        where project_id = ${here} and actor_id = ${actorId} and deleted_at is null`,
    )
    return row!.n === 1
  }
  const canHere = async (token: string) => {
    const r = await app.request('/api/projects', { headers: { authorization: `Bearer ${token}` } })
    const all = ((await r.json()) as { projects: { id: string; can: string[] }[] }).projects
    return all.find((p) => p.id === here)!.can
  }

  // Sam may add people here and may not take them off — refused, and the
  // screen is told so before anybody presses anything.
  assert.equal((await canHere(samT)).includes('project.member.add'), true)
  assert.equal((await canHere(samT)).includes('project.member.remove'), false)
  assert.equal(await call('DELETE', `/api/projects/${here}/members/${pat.actorId}`, samT), 403)
  assert.equal(await on(pat.actorId), true, 'refused, and Pat is still there')

  // Whoever runs it may, and it really happens.
  assert.equal((await canHere(moT)).includes('project.member.remove'), true)
  assert.equal(await call('DELETE', `/api/projects/${here}/members/${pat.actorId}`, moT), 200)
  assert.equal(await on(pat.actorId), false, 'answered 200 and Pat was not taken off')

  // Twice is not a success, nor is somebody who was never here.
  assert.equal(await call('DELETE', `/api/projects/${here}/members/${pat.actorId}`, moT), 404)
  const stranger = await addPerson(ctx, workspaceId, 'member')
  assert.equal(await call('DELETE', `/api/projects/${here}/members/${stranger.actorId}`, moT), 404)

  // The owner does it without being on the project.
  assert.equal(await call('DELETE', `/api/projects/${here}/members/${ctx.actorId}`, owner), 200)
  assert.equal(await call('DELETE', `/api/projects/${here}/members/${sam.actorId}`, owner), 200)
  assert.equal(await on(sam.actorId), false)
})

/*
 * A member may take themselves off a project on their own — and the
 * row's policy lets them end their own row and nothing more.
 */
test('a member leaves a project on their own, and only themselves, and only that', async () => {
  const { ctx, workspaceId, token: owner } = await makeOwner()
  const here = await makeProject(ctx, workspaceId, 'Rebrand')
  // Sam holds nothing here: leaving asks for nothing.
  const sam = await addPerson(ctx, workspaceId, 'member', [here], [])
  const pat = await addPerson(ctx, workspaceId, 'member', [here])
  const kim = await addPerson(ctx, workspaceId, 'member', [here])
  const samT = await tokenFor(sam.actorId, workspaceId)
  const patT = await tokenFor(pat.actorId, workspaceId)
  const isOn = async (actorId: string) => {
    const [row] = await withActor(
      ctx.actorId,
      (tx) =>
        tx<{ n: number }[]>`select count(*)::int as n from project_member
        where project_id = ${here} and actor_id = ${actorId} and deleted_at is null`,
    )
    return row!.n === 1
  }
  const canHere = async (token: string) => {
    const r = await app.request('/api/projects', { headers: { authorization: `Bearer ${token}` } })
    const all = ((await r.json()) as { projects: { id: string; can: string[] }[] }).projects
    return all.find((p) => p.id === here)?.can ?? null
  }

  // The screen is told before anybody presses anything.
  assert.equal((await canHere(samT))!.includes('project.leave'), true)
  assert.equal((await canHere(samT))!.includes('project.member.remove'), false)

  // Not somebody else.
  assert.equal(await call('DELETE', `/api/projects/${here}/members/${pat.actorId}`, samT), 403)
  assert.equal(await isOn(pat.actorId), true)

  /* Nor by going round the endpoint. As Sam, in Sam's session: somebody
     else's row is not his to end, his own is not his to rewrite on the way
     out, and an ended row is not his to put back. */
  const asSam = <T>(fn: (tx: Tx) => Promise<T>) => inWorkspace(sam.actorId, workspaceId, fn)
  const others = await asSam(
    (tx) => tx`
    update project_member set deleted_at = now()
    where project_id = ${here} and actor_id = ${pat.actorId} and deleted_at is null returning id`,
  )
  assert.equal(others.length, 0, 'ended somebody else’s row')
  await assert.rejects(
    asSam(
      (tx) => tx`
      update project_member set rights = ${['manage']}, deleted_at = now()
      where project_id = ${here} and actor_id = ${sam.actorId} and deleted_at is null`,
    ),
    /leaving_changes_only_the_end/,
  )
  await assert.rejects(
    asSam(
      (tx) => tx`
      update project_member set rights = ${['manage']}
      where project_id = ${here} and actor_id = ${sam.actorId} and deleted_at is null`,
    ),
    /row-level security|leaving_changes_only_the_end/,
  )
  assert.equal(await isOn(sam.actorId), true, 'a refused statement took Sam off')

  // His own way out, through the door.
  assert.equal(await call('DELETE', `/api/projects/${here}/members/${sam.actorId}`, samT), 200)
  assert.equal(await isOn(sam.actorId), false, 'answered 200 and Sam is still there')
  assert.equal(await canHere(samT), null, 'the project is still on his list')
  assert.equal(await call('GET', `/api/projects/${here}`, samT), 404)
  const [line] = await withActor(
    ctx.actorId,
    (tx) =>
      tx<{ action: string }[]>`select action from activity_event
      where project_id = ${here} and actor_id = ${sam.actorId} order by id desc limit 1`,
  )
  assert.equal(line?.action, 'project.leave')

  // Twice is not a success, and an ended row does not come back.
  assert.equal(await call('DELETE', `/api/projects/${here}/members/${sam.actorId}`, samT), 404)
  const back = await asSam(
    (tx) => tx`
    update project_member set deleted_at = null
    where project_id = ${here} and actor_id = ${sam.actorId} returning id`,
  )
  assert.equal(back.length, 0, 'put himself back')

  /* The last of the people on it may leave too: the owner runs every
     project, on its list or not, and can put it back together. */
  assert.equal(await call('DELETE', `/api/projects/${here}/members/${pat.actorId}`, patT), 200)
  assert.equal(await call('DELETE', `/api/projects/${here}/members/${kim.actorId}`, await tokenFor(kim.actorId, workspaceId)), 200)

  // And the owner, who still sees it afterwards and has nothing left to leave.
  assert.equal((await canHere(owner))!.includes('project.leave'), true)
  assert.equal(await call('DELETE', `/api/projects/${here}/members/${ctx.actorId}`, owner), 200)
  assert.equal(await call('GET', `/api/projects/${here}`, owner), 200)
  assert.equal((await canHere(owner))!.includes('project.leave'), false)
  assert.equal(await call('POST', `/api/projects/${here}/members`, owner, { actor_id: sam.actorId }), 200)
})
