import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { closeDb, withActor, makeOwner, makeProject } from './helpers.js'
import { app } from '../src/http/routes.js'
import { closeRealtime } from '../src/realtime.js'

after(async () => {
  await closeRealtime()
  await closeDb()
})

type Found = { type: string; id: string; number: number; title: string; snippet: string | null }

/**
 * Search finds a task by its handle and by the words inside it —
 * `docs/specs/palette.md`.
 */
test('a task is found by its handle, its number, and the words in its description', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const project = await makeProject(ctx, workspaceId, 'Hoists')
  const [found] = await withActor(ctx.actorId, (tx) => tx<{ key: string }[]>`select key from project where id = ${project}`)
  const key = found!.key
  const make = async (title: string, words?: string) => {
    const r = await app.request(`/api/projects/${project}/tasks`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        title,
        ...(words ? { body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: words }] }] } } : {}),
      }),
    })
    assert.equal(r.status, 201)
    const { id } = (await r.json()) as { id: string }
    const [row] = await withActor(ctx.actorId, (tx) => tx<{ number: number }[]>`select number from task where id = ${id}`)
    return { id, number: row!.number }
  }
  const cable = await make('Replace the hoist cable')
  const ropes = await make('Order parts', 'The inspector wants the counterweight ropes swapped before the quarterly certificate is signed.')
  const find = async (q: string) =>
    (
      (await (await app.request(`/api/search?q=${encodeURIComponent(q)}`, { headers: { authorization: `Bearer ${token}` } })).json()) as {
        results: Found[]
      }
    ).results

  // By the handle, written any of the ways it is written.
  for (const said of [`${key}-${cable.number}`, `${key.toLowerCase()}${cable.number}`, `${key}-${cable.number}`]) {
    const hits = await find(said)
    assert.equal(hits[0]?.id, cable.id, said)
  }
  // And by the number alone — two digits at least, as every search is.
  await withActor(ctx.actorId, (tx) => tx`update project set task_seq = 40 where id = ${project}`)
  const later = await make('Grease the guide rails')
  assert.equal(later.number, 41)
  assert.ok((await find('41')).some((h) => h.id === later.id))
  assert.ok(
    (await find(`${key}-4`)).some((h) => h.id === later.id),
    'a handle typed on the way to it',
  )

  // By words that are only in the description, with where they were said.
  const words = await find('counterweight ropes')
  const hit = words.find((h) => h.id === ropes.id)
  assert.ok(hit, 'the words inside a description were not found')
  assert.match(hit.snippet ?? '', /counterweight ropes/)

  // A title that matches stands above a description that does.
  await make('Counterweight ropes', 'Nothing else.')
  const ordered = await find('counterweight ropes')
  assert.equal(ordered[0]?.title, 'Counterweight ropes')
  assert.equal(ordered[0]?.snippet, null)

  // And the column the index reads never reaches a client.
  const opened = (await (await app.request(`/api/tasks/${ropes.id}`, { headers: { authorization: `Bearer ${token}` } })).json()) as {
    task: Record<string, unknown>
  }
  assert.ok(!('said' in opened.task))
})

/* Search runs in definer functions so the trigram
   indexes are used, and they must say exactly what the policies say —
   this workspace, the projects and rooms the asker can see. */
test('search through its own functions finds nothing another company, project or room keeps', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const other = await makeOwner()
  const mine = await makeProject(ctx, workspaceId, 'Mine')
  const theirs = await makeProject(other.ctx, other.workspaceId, 'Theirs')
  const word = `zebrafish${Date.now() % 100000}`
  await withActor(
    ctx.actorId,
    (tx) => tx`
    insert into task (id, workspace_id, project_id, author_id, title, sort_key)
    values (gen_random_uuid(), ${workspaceId}, ${mine}, ${ctx.actorId}, ${`Feed the ${word}`}, 'a0')`,
  )
  await withActor(
    other.ctx.actorId,
    (tx) => tx`
    insert into task (id, workspace_id, project_id, author_id, title, sort_key)
    values (gen_random_uuid(), ${other.workspaceId}, ${theirs}, ${other.ctx.actorId}, ${`Their ${word}`}, 'a0')`,
  )
  // A project of this company the member is not on.
  const { addPerson, bearerFor } = await import('./helpers.js')
  const member = await addPerson(ctx, workspaceId, 'member', [])
  const asMember = await bearerFor(member.actorId, workspaceId)

  const ask = async (t: string) =>
    (
      (await (await app.request(`/api/search?q=${word}`, { headers: { authorization: `Bearer ${t}` } })).json()) as { results: Found[] }
    ).results.map((r) => r.title)
  assert.deepEqual(await ask(token), [`Feed the ${word}`])
  assert.deepEqual(await ask(other.token), [`Their ${word}`])
  assert.deepEqual(await ask(asMember), [])
})

/*
 * Messages in search: what was said in the
 * rooms somebody may read, and nothing from a room they may not.
 */
test('a message is found in the rooms its reader is in, and only there', async () => {
  const { addPerson, bearerFor } = await import('./helpers.js')
  const { ctx, workspaceId, token } = await makeOwner()
  const project = await makeProject(ctx, workspaceId, 'Bridges')
  const word = `girder${Date.now().toString(36)}`
  const ask = async (t: string, q: string, type = 'message', projectId?: string) =>
    (
      (await (
        await app.request(`/api/search?q=${encodeURIComponent(q)}&type=${type}${projectId ? `&project=${projectId}` : ''}`, {
          headers: { authorization: `Bearer ${t}` },
        })
      ).json()) as { results: (Found & { conversation_id?: string; parent_id?: string | null; author_name?: string })[] }
    ).results
  const call = async (t: string, path: string, body: unknown) => {
    const r = await app.request(path, {
      method: 'POST',
      headers: { authorization: `Bearer ${t}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    assert.ok(r.status < 300, `${path}: ${r.status}`)
    return (await r.json()) as { id: string }
  }
  const say = (t: string, room: string, text: string, parent?: string) =>
    call(t, `/api/conversations/${room}/messages`, {
      body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
      ...(parent ? { parent_id: parent } : {}),
    })

  const onProject = await addPerson(ctx, workspaceId, 'member', [project])
  const offProject = await addPerson(ctx, workspaceId, 'member', [])
  const third = await addPerson(ctx, workspaceId, 'member', [])
  const [tOn, tOff, tThird] = await Promise.all([
    bearerFor(onProject.actorId, workspaceId),
    bearerFor(offProject.actorId, workspaceId),
    bearerFor(third.actorId, workspaceId),
  ])

  // The project's channel, which everybody on the project reads.
  const channel = await call(token, `/api/projects/${project}/conversations`, { name: `steel-${Date.now().toString(36)}` })
  const head = await say(token, channel.id, `Order the ${word} before Friday`)
  const reply = await say(tOn, channel.id, `The ${word} supplier says Monday`, head.id)
  // A direct conversation between two other people.
  const direct = await call(tOff, '/api/conversations/direct', { actor_ids: [third.actorId] })
  await say(tOff, direct.id, `Between us: the ${word} is late`)

  const mine = await ask(token, word)
  assert.deepEqual(new Set(mine.map((r) => r.id)), new Set([head.id, reply.id]))
  const found = mine.find((r) => r.id === reply.id)!
  assert.equal(found.type, 'message')
  assert.equal(found.conversation_id, channel.id)
  assert.equal(found.parent_id, head.id)
  assert.match(found.snippet ?? '', new RegExp(word))
  // Somebody on the project reads its channel; somebody not on it does not,
  // and nobody outside a direct conversation reads it.
  assert.equal((await ask(tOn, word)).length, 2)
  assert.deepEqual(
    (await ask(tOff, word)).map((r) => r.conversation_id),
    [direct.id],
  )
  assert.deepEqual(
    (await ask(tThird, word)).map((r) => r.conversation_id),
    [direct.id],
  )
  // Narrowed to the project, its channel and nothing else.
  assert.deepEqual((await ask(tOff, word, 'message', project)).length, 0)
  assert.equal((await ask(token, word, 'message', project)).length, 2)
  // Three letters at least; and an app that names no type gets none.
  assert.deepEqual(await ask(token, word.slice(0, 2)), [])
  assert.equal((await ask(token, word, '')).filter((r) => r.type === 'message').length, 0)
  // Nobody in another company finds any of it.
  const other = await makeOwner()
  assert.deepEqual(await ask(other.token, word), [])
})

/*
 * The two ways a message is found: among the
 * newest twenty thousand first, and older than those through the words'
 * index, so a common word answers from the newest and a rare old one is
 * still found.
 */
test('an old message is found behind twenty thousand newer ones, and a common word answers newest first', async () => {
  const postgres = (await import('postgres')).default
  const owner = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} })
  try {
    const { ctx, workspaceId, token } = await makeOwner()
    const project = await makeProject(ctx, workspaceId, 'Archive')
    const r = await app.request(`/api/projects/${project}/conversations`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ name: `old-${Date.now().toString(36)}` }),
    })
    const room = ((await r.json()) as { id: string }).id
    const rare = `obelisk${Date.now().toString(36)}`
    const doc = (t: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] })
    await owner`
      insert into message (id, workspace_id, conversation_id, author_id, body, created_at)
      values (gen_random_uuid(), ${workspaceId}, ${room}, ${ctx.actorId}, ${owner.json(doc(`The ${rare} was moved`))}, now() - interval '2 days')`
    await owner`
      insert into message (id, workspace_id, conversation_id, author_id, body, created_at)
      select gen_random_uuid(), ${workspaceId}, ${room}, ${ctx.actorId},
             jsonb_build_object('type', 'doc', 'content', jsonb_build_array(jsonb_build_object('type', 'paragraph',
               'content', jsonb_build_array(jsonb_build_object('type', 'text', 'text', 'Standup notes ' || i))))),
             now() - (i || ' seconds')::interval
      from generate_series(1, 20005) i`
    const ask = async (q: string) =>
      (
        (await (
          await app.request(`/api/search?q=${encodeURIComponent(q)}&type=message`, { headers: { authorization: `Bearer ${token}` } })
        ).json()) as { results: { snippet: string; created_at: string }[] }
      ).results
    const old = await ask(rare)
    assert.equal(old.length, 1)
    assert.match(old[0]!.snippet, new RegExp(rare))
    const common = await ask('standup')
    assert.equal(common.length, 20)
    assert.match(common[0]!.snippet, /Standup notes 1$/)
    const times = common.map((c) => c.created_at)
    assert.deepEqual([...times].sort().reverse(), times)

    // And the room's own magnifier, the same two ways — `docs/specs/find.md`.
    const inRoom = async (q: string) =>
      (
        (await (
          await app.request(`/api/conversations/${room}/messages?q=${encodeURIComponent(q)}`, {
            headers: { authorization: `Bearer ${token}` },
          })
        ).json()) as { messages: { created_at: string }[] }
      ).messages
    assert.equal((await inRoom(rare)).length, 1)
    const page = await inRoom('standup')
    assert.equal(page.length, 30)
    const at = page.map((m) => m.created_at)
    assert.deepEqual([...at].sort().reverse(), at)
  } finally {
    await owner.end()
  }
})
