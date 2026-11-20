import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { app } from '../src/http/routes.js'
import { linkMentionedObjects } from '../src/notify.js'
import { addManager, addPerson, bearerFor, closeDb, withActor, uuidv7, makeOwner, makeProject } from './helpers.js'

after(async () => {
  await closeDb()
})

/**
 * The first test in this repository that goes through the HTTP layer.
 *
 * Everything else calls the functions underneath, which is why `GET
 * /api/links/:type/:id` could select a column that does not exist and answer
 * 500 to every request ever made to it without a single test noticing. The
 * query was right about what it wanted and wrong about where it lived, and
 * nothing between the function and the browser ever ran it.
 *
 * Hono answers `app.request` without a socket, so this costs no server.
 */
async function get(path: string, token: string) {
  const r = await app.request(path, { headers: { authorization: `Bearer ${token}` } })
  return { status: r.status, body: (await r.json()) as Record<string, unknown> }
}

async function task(ownerId: string, ws: string, project: string, title: string, body?: unknown) {
  const id = uuidv7()
  await withActor(ownerId, async (tx) => {
    await tx`
      insert into task (id, workspace_id, project_id, author_id, title, body, sort_key)
      values (${id}, ${ws}, ${project}, ${ownerId}, ${title},
              ${body ? tx.json(body as never) : null}, ${'a' + Math.random().toString(36).slice(2)})`
  })
  return id
}

test('what points at an object comes back with its name and its project', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const project = await makeProject(ctx, workspaceId, 'Acme')

  const target = await task(ctx.actorId, workspaceId, project, 'The one being pointed at')
  const source = await task(ctx.actorId, workspaceId, project, 'The one doing the pointing', {
    type: 'doc',
    content: [{ type: 'text', text: `see /tasks/${target}` }],
  })
  await withActor(ctx.actorId, (tx) =>
    linkMentionedObjects(
      tx,
      ctx,
      { type: 'task', id: source },
      {
        type: 'doc',
        content: [{ type: 'text', text: `see /tasks/${target}` }],
      },
    ),
  )

  const forward = await get(`/api/links/task/${source}`, token)
  assert.equal(forward.status, 200)
  assert.deepEqual(
    (forward.body.links as { title: string; project_id: string }[]).map((l) => [l.title, l.project_id]),
    [['The one being pointed at', project]],
  )

  // Both directions are written at once, so the thing pointed at knows too.
  const back = await get(`/api/links/task/${target}`, token)
  assert.equal(back.status, 200)
  assert.deepEqual(
    (back.body.links as { title: string }[]).map((l) => l.title),
    ['The one doing the pointing'],
  )
})

test('an object nothing points at answers with nothing, not with an error', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const project = await makeProject(ctx, workspaceId, 'Acme')
  const lonely = await task(ctx.actorId, workspaceId, project, 'Nobody mentions me')

  const r = await get(`/api/links/task/${lonely}`, token)
  assert.equal(r.status, 200)
  assert.deepEqual(r.body.links, [])
})

/**
 * The permission that locks behind whoever gives it up.
 *
 * `manage` is what lets somebody decide who may do what here, so handing it
 * back takes away the ability to take it again — and if they were the only
 * one holding it, nobody can. Refused on yourself for that reason, and on an
 * owner because there is nobody above them to undo it.
 */
test('nobody edits their own permissions, and an owner has none to edit', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const project = await makeProject(ctx, workspaceId, 'Acme')
  const sam = await addPerson(ctx, workspaceId, 'member', [project])

  const give = (actorId: string, rights: string[]) =>
    app.request(`/api/projects/${project}/members/${actorId}`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ rights }),
    })

  assert.equal((await give(ctx.actorId, [])).status, 400, 'edited their own')
  assert.equal((await give(sam.actorId, ['task.create', 'task.delete'])).status, 200)

  // Whoever runs the project may not edit the owner's — there is one owner,
  // and nobody beneath them decides what they may do.
  const runner = await addManager(ctx, workspaceId, [project])
  const asRunner = await bearerFor(runner.actorId, workspaceId)
  const byRunner = await app.request(`/api/projects/${project}/members/${ctx.actorId}`, {
    method: 'PATCH',
    headers: { authorization: `Bearer ${asRunner}`, 'content-type': 'application/json' },
    body: JSON.stringify({ rights: [] }),
  })
  assert.equal(byRunner.status, 400, 'edited an owner')

  // And what was given is what comes back.
  const { body } = await get(`/api/projects/${project}/members`, token)
  const them = (body.members as { actor_id: string; rights: string[] }[]).find((m) => m.actor_id === sam.actorId)
  assert.deepEqual(them?.rights.sort(), ['task.create', 'task.delete'])
})

/**
 * What an admin was, asked of one project.
 *
 * The powers were about a project — archive it, switch its tools, edit what
 * somebody else wrote in it — and a role said somebody may do all of that to
 * every project there is. They are permissions on one project now, held one
 * at a time.
 */
test('a permission is held on one project and not on the next', async () => {
  const { ctx, workspaceId } = await makeOwner()
  const theirs = await makeProject(ctx, workspaceId, 'Rebrand')
  const other = await makeProject(ctx, workspaceId, 'Internal wiki')
  const sam = await addManager(ctx, workspaceId, [theirs])
  await withActor(ctx.actorId, async (tx) => {
    await tx`
      insert into project_member (id, workspace_id, project_id, actor_id, added_by)
      values (${uuidv7()}, ${workspaceId}, ${other}, ${sam.actorId}, ${ctx.actorId})`
  })

  const { can } = await import('@tracker/shared-schema')
  const asSam = (projectId: string) => ({
    role: sam.role,
    settings: ctx.settings,
    inProject: true,
    rights: sam.rights[projectId] ?? [],
  })
  for (const action of ['project.archive', 'project.tools', 'time.any'] as const) {
    assert.equal(can(action, asSam(theirs)), true, `${action} on the one they run`)
    assert.equal(can(action, asSam(other)), false, `${action} on the one they do not`)
  }

  // And the owner runs both without being on either.
  const asOwner = { role: ctx.role, settings: ctx.settings, inProject: false }
  assert.equal(can('project.archive', asOwner), true)
})

/**
 * A log line has to be able to say what it was.
 *
 * Eight rows in a row reading "Dev changed the project" and holding no detail
 * at all is what started this: the project screen saves what is in its fields,
 * `coalesce` means a field set to the value it already had still updates the
 * row, and every save wrote an entry that recorded that something happened and
 * nothing else. Nothing had happened.
 */
test('a save that changes nothing writes nothing into the log', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const project = await makeProject(ctx, workspaceId, 'Acme')
  const patch = (body: unknown) =>
    app.request(`/api/projects/${project}`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  const lines = () =>
    withActor(
      ctx.actorId,
      (tx) =>
        tx<{ action: string; meta: Record<string, unknown> | null }[]>`
        select action, meta from activity_event
        where project_id = ${project} and action like ${'project.%'}
        order by at`,
    )

  // The name it already has, the description it already has: a save, not a change.
  const same = await patch({ name: 'Acme', description: '' })
  assert.equal(same.status, 200)
  assert.equal((await lines()).length, 0)

  // A real rename says both names, so the line reads without the database.
  assert.equal((await patch({ name: 'Acme Inc' })).status, 200)
  const after = await lines()
  assert.equal(after.length, 1)
  assert.equal(after[0]?.action, 'project.update')
  assert.deepEqual(after[0]?.meta, { renamed: 'Acme Inc', was: 'Acme' })

  // And the description, separately, because "changed the project" is not what
  // changed either.
  assert.equal((await patch({ description: 'Lifts and conveyors' })).status, 200)
  const third = (await lines())[1]
  assert.deepEqual(third?.meta, { described: true })
})

/**
 * The mark is chosen, and null is a choice.
 *
 * Not sent and sent as null are the same thing to `coalesce` and opposite
 * things here: one leaves the mark alone, the other puts it back to what the
 * id says. The whole feature is one column that has to tell those apart.
 */
test('a project is given a mark, keeps it through other saves, and can give it back', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const project = await makeProject(ctx, workspaceId, 'Acme')
  const patch = (body: unknown) =>
    app.request(`/api/projects/${project}`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  const mark = async () => {
    const r = await get(`/api/projects`, token)
    const all = r.body.projects as { id: string; mark_icon: string | null; mark_tint: number | null }[]
    const one = all.find((p) => p.id === project)
    return [one?.mark_icon ?? null, one?.mark_tint ?? null]
  }

  assert.deepEqual(await mark(), [null, null])

  assert.equal((await patch({ mark_icon: 'folder' })).status, 200)
  assert.deepEqual(await mark(), ['folder', null])

  // The two halves are chosen separately: a colour arrives without taking the
  // glyph away, which is the whole reason they are two columns.
  assert.equal((await patch({ mark_tint: 3 })).status, 200)
  assert.deepEqual(await mark(), ['folder', 3])

  // A save of something else leaves both where they are.
  assert.equal((await patch({ name: 'Acme Inc' })).status, 200)
  assert.deepEqual(await mark(), ['folder', 3])

  // And null is the way back, one half at a time.
  assert.equal((await patch({ mark_tint: null })).status, 200)
  assert.deepEqual(await mark(), ['folder', null])
  assert.equal((await patch({ mark_icon: null })).status, 200)
  assert.deepEqual(await mark(), [null, null])

  // A glyph the product does not draw is refused rather than stored: a blank
  // square in a sidebar is found by looking, which is to say not found.
  assert.equal((await patch({ mark_icon: 'unicorn' })).status, 400)
  assert.equal((await patch({ mark_tint: 10 })).status, 400)
  assert.deepEqual(await mark(), [null, null])
})

/**
 * And the log says which half moved, or says nothing.
 */
test('the log names the half of the mark that changed, and skips the one that did not', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const project = await makeProject(ctx, workspaceId, 'Acme')
  const patch = (body: unknown) =>
    app.request(`/api/projects/${project}`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  const lines = () =>
    withActor(
      ctx.actorId,
      (tx) =>
        tx<{ meta: Record<string, unknown> | null }[]>`
        select meta from activity_event
        where project_id = ${project} and action = ${'project.update'}
        order by at`,
    )

  assert.equal((await patch({ mark_tint: 7 })).status, 200)
  assert.deepEqual((await lines())[0]?.meta, { mark_tint: 7 })

  // Picking the colour it already is is not a change.
  assert.equal((await patch({ mark_tint: 7 })).status, 200)
  assert.equal((await lines()).length, 1)
})

/** The same, on a task — where "Dev changed a task" has the same emptiness. */
test('a task saved unchanged writes nothing, and ticking it says so', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const project = await makeProject(ctx, workspaceId, 'Acme')
  const id = await task(ctx.actorId, workspaceId, project, 'Replace the hoist cable')
  const patch = (body: unknown) =>
    app.request(`/api/tasks/${id}`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  const lines = () =>
    withActor(
      ctx.actorId,
      (tx) =>
        tx<{ meta: Record<string, unknown> }[]>`
        select meta from activity_event
        where object_id = ${id} and action = ${'task.update'} order by at`,
    )

  // The title it already has: the editor saving its fields, not a change.
  assert.equal((await patch({ title: 'Replace the hoist cable' })).status, 200)
  assert.equal((await lines()).length, 0)

  // Ticked, and that is a thing that happened — with a word for it.
  assert.equal((await patch({ completed: true })).status, 200)
  assert.deepEqual((await lines())[0]?.meta, { finished: true })

  // Ticked again, when it is already ticked.
  assert.equal((await patch({ completed: true })).status, 200)
  assert.equal((await lines()).length, 1)
})

/**
 * Priority is a word, and absent is not the same answer as null.
 *
 * The same shape the assignee has: a patch that does not mention it leaves it
 * alone, and one that sends `null` takes it off. `coalesce` cannot tell those
 * two apart, which is why neither field is written with it.
 */
test('a task carries a priority, and taking it off is not the same as not saying', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const project = await makeProject(ctx, workspaceId, 'Acme')
  const made = await app.request(`/api/projects/${project}/tasks`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Replace the hoist cable', priority: 'urgent' }),
  })
  assert.equal(made.status, 201)
  const id = ((await made.json()) as { id: string }).id

  const patch = (body: unknown) =>
    app.request(`/api/tasks/${id}`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  const priority = async () =>
    (await withActor(ctx.actorId, (tx) => tx<{ priority: string | null }[]>`select priority from task where id = ${id}`))[0]?.priority

  assert.equal(await priority(), 'urgent')

  // A patch about something else leaves it where it is.
  assert.equal((await patch({ title: 'Replace the hoist cable and shackles' })).status, 200)
  assert.equal(await priority(), 'urgent')

  assert.equal((await patch({ priority: 'low' })).status, 200)
  assert.equal(await priority(), 'low')

  // Null is the answer "none", not "say nothing".
  assert.equal((await patch({ priority: null })).status, 200)
  assert.equal(await priority(), null)

  // Not a word of its own choosing: the column is an enum and so is the schema.
  assert.equal((await patch({ priority: 'blocker' })).status, 400)

  /* The due date the same way: null clears it. It was a coalesce, and a
     date cleared on the web or the phone came back on the next read. */
  const due = async () =>
    (await withActor(ctx.actorId, (tx) => tx<{ due: string | null }[]>`select due_on::text as due from task where id = ${id}`))[0]?.due
  assert.equal((await patch({ due_on: '2026-12-01' })).status, 200)
  assert.equal(await due(), '2026-12-01')
  assert.equal((await patch({ title: 'Replace the hoist cable, shackles and all' })).status, 200)
  assert.equal(await due(), '2026-12-01')
  assert.equal((await patch({ due_on: null })).status, 200)
  assert.equal(await due(), null)

  /* And the log says which, because "Dev changed a task" is the thing the
     log was fixed of. */
  const said = await withActor(
    ctx.actorId,
    (tx) =>
      tx<{ meta: Record<string, unknown> }[]>`
      select meta from activity_event
      where object_id = ${id} and action = ${'task.update'} order by at`,
  )
  // The rename is in there too; these are the lines that mention a priority.
  assert.deepEqual(
    said.filter((e) => 'priority' in e.meta).map((e) => e.meta.priority),
    ['low', null],
  )
})

/**
 * A name taken by a project in the bin, or by one this person is not on, is
 * still taken: the key and the slug step past it rather than answering 500.
 * The triggers that choose them ran under row-level security and could not
 * see either. `migrations/100`.
 */
test('a new project steps past the keys and slugs of projects it cannot see', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const make = async (bearer: string, name: string) => {
    const r = await app.request('/api/projects', {
      method: 'POST',
      headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    return { status: r.status, said: (await r.json()) as { id: string; slug: string; key: string } }
  }
  const first = await make(token, 'Website')
  assert.equal(first.status, 201)
  const binned = await app.request(`/api/projects/${first.said.id}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${token}` },
  })
  assert.equal(binned.status, 200)

  const again = await make(token, 'Website')
  assert.equal(again.status, 201)
  assert.notEqual(again.said.key, first.said.key)
  assert.notEqual(again.said.slug, first.said.slug)

  // And a member who is not on the owner's project makes one of the same name.
  const member = await addPerson(ctx, workspaceId, 'member')
  const third = await make(await bearerFor(member.actorId, workspaceId), 'Website')
  assert.equal(third.status, 201)
})

/**
 * A name in Cyrillic still gets an address somebody can read.
 *
 * `slugify` kept `[a-z0-9]` and threw the rest away, so a project called
 * «Лифты и конвейеры» had nothing left to make a slug from and fell to the
 * word `project`, with `PRJ` for a key. The second such project was
 * `project2` and `PRJ2`, which is the opposite of an address being readable.
 */
test('a project named in Cyrillic is given a Latin address, and it comes back at once', async () => {
  const { token } = await makeOwner()
  const made = await app.request('/api/projects', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Лифты и конвейеры' }),
  })
  assert.equal(made.status, 201)
  const said = (await made.json()) as { id: string; slug: string; key: string }

  assert.equal(said.slug, 'lifty-i-konveyery')
  assert.equal(said.key, 'LIF')

  /*
   * And both came back from the one request. They are filled by a trigger —
   * what is free depends on what is already there — so the only place that
   * knows them is the statement that wrote the row, and a caller that wanted
   * to open what it had just made had to fetch it again to learn where that
   * was.
   */
  assert.ok(said.slug && said.key)

  // The fallback is still there for a name with nothing in it to use.
  const odd = await app.request('/api/projects', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ name: '!!!' }),
  })
  const fell = (await odd.json()) as { slug: string; key: string }
  assert.equal(fell.slug, 'project')
  assert.equal(fell.key, 'PRJ')

  /* And a name that is one of the app's own screens steps aside: `more` is
     a phone's More tab at `/:ws/more`. */
  const more = await app.request('/api/projects', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'More' }),
  })
  assert.equal(((await more.json()) as { slug: string }).slug, 'more-2')
})

/**
 * Words on a task.
 *
 * Lists say where a task is and priority says how urgent; nothing said what
 * kind of thing it is, which is the question that crosses projects.
 */
test('a task carries labels, the same name twice is one label, and the log says which', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const project = await makeProject(ctx, workspaceId, 'Acme')
  const id = await task(ctx.actorId, workspaceId, project, 'Replace the hoist cable')

  const make = (name: string) =>
    app.request(`/api/projects/${project}/labels`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    })
  /* `Bug` is one of the three a project starts with, and `name` is
     citext — so this finds the starter rather than making a second one,
     which is the behaviour being tested one line below. */
  const bug = (await (await make('bug')).json()) as { id: string; name: string }
  assert.equal(bug.name, 'Bug')
  /* Two people typing the same word a minute apart must not end with two
     labels called bug, which is the fault every tool with labels has. The
     unique index decides it, not a read-then-write that both can win. */
  const again = (await (await make('Bug')).json()) as { id: string }
  assert.equal(again.id, bug.id)
  const client = (await (await make('client')).json()) as { id: string }

  const patch = (body: unknown) =>
    app.request(`/api/tasks/${id}`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  const on = async () => {
    const r = await app.request(`/api/projects/${project}/tasks`, {
      headers: { authorization: `Bearer ${token}` },
    })
    const { tasks } = (await r.json()) as { tasks: { id: string; labels: { name: string }[] }[] }
    return (tasks.find((t) => t.id === id)?.labels ?? []).map((l) => l.name).sort()
  }

  assert.deepEqual(await on(), [])
  assert.equal((await patch({ labels: [bug.id, client.id] })).status, 200)
  assert.deepEqual(await on(), ['Bug', 'client'])

  /* The whole set, not an add and a remove: what is sent is what is true
     afterwards. */
  assert.equal((await patch({ labels: [client.id] })).status, 200)
  assert.deepEqual(await on(), ['client'])
  assert.equal((await patch({ labels: [] })).status, 200)
  assert.deepEqual(await on(), [])

  // And a save that changes nothing writes nothing into the log.
  const lines = async () =>
    withActor(
      ctx.actorId,
      (tx) =>
        tx<{ meta: Record<string, unknown> }[]>`
        select meta from activity_event
        where object_id = ${id} and action = ${'task.update'} order by at`,
    )
  const before = (await lines()).length
  assert.equal((await patch({ labels: [] })).status, 200)
  assert.equal((await lines()).length, before)

  // What the log kept: the words, not that something happened.
  const said = (await lines()).filter((l) => 'labelled' in l.meta).map((l) => l.meta.labelled)
  assert.deepEqual(said, [['Bug', 'client'], ['client'], []])
})

/**
 * And a task can be made with its words already on it.
 *
 * `labels` was in the create schema and was dropped: the request answered
 * 201, the task had none, and a caller cannot tell that from success. The
 * handler that makes a *part* of a task had written them since it was added,
 * so one of the two ways to make a task worked and the other did not —
 * silently, in the direction every client and the MCP layer use.
 *
 * The test above covers `PATCH` and did not catch this, because the task it
 * patches is made by a helper that writes the row straight into the table
 * rather than going through the endpoint. Both ways in are exercised here.
 */
test('a task can be made with labels already on it, by either way in', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const project = await makeProject(ctx, workspaceId, 'Acme')

  const head = { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
  const label = async (name: string) => {
    const r = await app.request(`/api/projects/${project}/labels`, { method: 'POST', headers: head, body: JSON.stringify({ name }) })
    return ((await r.json()) as { id: string }).id
  }
  const bug = await label('Bug')
  const client = await label('client')

  const wordsOn = async (id: string) => {
    const r = await app.request(`/api/projects/${project}/tasks?limit=200`, {
      headers: { authorization: `Bearer ${token}` },
    })
    const { tasks } = (await r.json()) as { tasks: { id: string; labels: { name: string }[] }[] }
    return (tasks.find((t) => t.id === id)?.labels ?? []).map((l) => l.name).sort()
  }

  // A task, which is the way that was broken.
  const made = await app.request(`/api/projects/${project}/tasks`, {
    method: 'POST',
    headers: head,
    body: JSON.stringify({ title: 'Replace the hoist cable', labels: [bug, client] }),
  })
  assert.equal(made.status, 201)
  const { id } = (await made.json()) as { id: string }
  assert.deepEqual(await wordsOn(id), ['Bug', 'client'])

  // And a part of it, which was not.
  const part = await app.request(`/api/tasks/${id}/steps`, {
    method: 'POST',
    headers: head,
    body: JSON.stringify({ title: 'Order the cable', labels: [bug] }),
  })
  assert.equal(part.status, 201)
  const { id: partId } = (await part.json()) as { id: string }
  assert.deepEqual(await wordsOn(partId), ['Bug'])

  // Saying nothing about labels is not the same as saying none, and both
  // are allowed: most tasks are made without any.
  const bare = await app.request(`/api/projects/${project}/tasks`, {
    method: 'POST',
    headers: head,
    body: JSON.stringify({ title: 'Nothing on this one' }),
  })
  assert.equal(bare.status, 201)
  assert.deepEqual(await wordsOn(((await bare.json()) as { id: string }).id), [])
})

/**
 * A project starts with a few words of its own, and they can be taken away.
 *
 * An empty picker teaches nothing: somebody opens it, finds nothing, and
 * either invents a label nobody else will reuse or decides labels are not for
 * them. A starter nobody can delete is a vocabulary imposed rather than
 * offered, so the two belong in one test. And they are the project's: two
 * projects each have their own three, and taking one from the first leaves
 * the second's alone.
 */
test('a new project comes with three labels of its own, and one can be removed', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const first = await makeProject(ctx, workspaceId, 'First')
  const second = await makeProject(ctx, workspaceId, 'Second')
  const all = async (project: string) => {
    const r = await app.request(`/api/projects/${project}/labels`, {
      headers: { authorization: `Bearer ${token}` },
    })
    const { labels } = (await r.json()) as {
      labels: { id: string; name: string; color: string | null; project_id: string }[]
    }
    return labels
  }
  /* Bug, Feature, Improvement — the kinds of work, in the colours those
     words already carry. */
  const started = await all(first)
  assert.deepEqual(started.map((l) => l.name).sort(), ['Bug', 'Feature', 'Improvement'])
  assert.deepEqual(
    started.sort((a, b) => a.name.localeCompare(b.name)).map((l) => l.color),
    ['red', 'blue', 'purple'],
  )
  assert.ok(started.every((l) => l.project_id === first))
  const others = await all(second)
  assert.equal(others.length, 3)
  assert.ok(
    others.every((l) => !started.some((s) => s.id === l.id)),
    'not the same rows',
  )

  const gone = await app.request(`/api/labels/${started[0]!.id}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${token}` },
  })
  assert.equal(gone.status, 200)
  assert.equal((await all(first)).length, 2)
  assert.equal((await all(second)).length, 3)
})

/*
 * A task carries only its own project's words. An id from another project's
 * vocabulary is refused — on making a task, a part of one, and on a patch —
 * rather than kept and drawn as a word the project does not have.
 */
test('a label from another project is refused on a task', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const here = await makeProject(ctx, workspaceId, 'Here')
  const there = await makeProject(ctx, workspaceId, 'There')
  const head = { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
  const theirs = (
    (await (await app.request(`/api/projects/${there}/labels`, { headers: head })).json()) as {
      labels: { id: string }[]
    }
  ).labels[0]!.id
  const ours = (
    (await (await app.request(`/api/projects/${here}/labels`, { headers: head })).json()) as {
      labels: { id: string }[]
    }
  ).labels[0]!.id

  const made = await app.request(`/api/projects/${here}/tasks`, {
    method: 'POST',
    headers: head,
    body: JSON.stringify({ title: 'Wrong word', labels: [theirs] }),
  })
  assert.equal(made.status, 400)

  const ok = await app.request(`/api/projects/${here}/tasks`, {
    method: 'POST',
    headers: head,
    body: JSON.stringify({ title: 'Right word', labels: [ours] }),
  })
  assert.equal(ok.status, 201)
  const { id } = (await ok.json()) as { id: string }
  const part = await app.request(`/api/tasks/${id}/steps`, {
    method: 'POST',
    headers: head,
    body: JSON.stringify({ title: 'Part', labels: [theirs] }),
  })
  assert.equal(part.status, 400)
  const patched = await app.request(`/api/tasks/${id}`, {
    method: 'PATCH',
    headers: head,
    body: JSON.stringify({ labels: [ours, theirs], title: 'Renamed' }),
  })
  assert.equal(patched.status, 400)
  /* Refused before anything was written — the title did not change either. */
  const list = (await (await app.request(`/api/projects/${here}/tasks?limit=200`, { headers: head })).json()) as {
    tasks: { id: string; title: string }[]
  }
  assert.equal(list.tasks.find((t) => t.id === id)?.title, 'Right word')
})

test('a workspace registered without an address gets the next free one from its name', async () => {
  const stamp = Date.now().toString(36)
  const make = async (email: string) => {
    const r = await app.request('/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'correct-horse-battery-staple', name: 'Ann', workspace_name: `Studio ${stamp}` }),
    })
    return r.status
  }
  assert.equal(await make(`a${stamp}@example.com`), 202)
  // The same name again is a second workspace with its own address, not a refusal.
  assert.equal(await make(`b${stamp}@example.com`), 202)
})
