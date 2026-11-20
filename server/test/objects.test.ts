import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { closeDb, withActor, uuidv7, makeOwner, addPerson, makeProject } from './helpers.js'

after(async () => {
  await closeDb()
})

const doc = (t: string) => ({ type: 'doc', content: [{ type: 'text', text: t }] })

async function post(ownerId: string, ws: string, project: string, title: string) {
  const id = uuidv7()
  await withActor(ownerId, async (tx) => {
    await tx`
      insert into post (id, workspace_id, project_id, author_id, title, body)
      values (${id}, ${ws}, ${project}, ${ownerId}, ${title}, ${tx.json(doc(title) as never)})`
  })
  return id
}

test('a comment on anything uses the same schema', async () => {
  const { ctx, workspaceId } = await makeOwner()
  const p = await makeProject(ctx, workspaceId, 'Acme')
  const postId = await post(ctx.actorId, workspaceId, p, 'Kickoff')
  const taskId = uuidv7()
  await withActor(ctx.actorId, async (tx) => {
    await tx`
      insert into task (id, workspace_id, project_id, author_id, title, sort_key)
      values (${taskId}, ${workspaceId}, ${p}, ${ctx.actorId}, 'Do the thing', 'a0')`
    for (const [type, target] of [
      ['post', postId],
      ['task', taskId],
    ] as const) {
      await tx`
        insert into comment
          (id, workspace_id, project_id, object_type, object_id, author_id, body)
        values (${uuidv7()}, ${workspaceId}, ${p}, ${type}::object_kind, ${target},
                ${ctx.actorId}, ${tx.json(doc('same shape') as never)})`
    }
  })
  const n = await withActor(ctx.actorId, async (tx) => {
    const [row] = await tx<{ n: string }[]>`select count(*) as n from comment`
    return Number(row!.n)
  })
  // Adding a fifth commentable thing must not be a migration, which is why the
  // target is a pair rather than four nullable columns.
  assert.equal(n, 2)
})

test("a task is several people's, in order, the first readable on its own", async () => {
  const { ctx, workspaceId } = await makeOwner()
  const p = await makeProject(ctx, workspaceId, 'Acme')
  const sam = await addPerson(ctx, workspaceId, 'member', [p])
  const id = uuidv7()
  await withActor(ctx.actorId, async (tx) => {
    await tx`
      insert into task (id, workspace_id, project_id, author_id, title, sort_key, assignee_ids)
      values (${id}, ${workspaceId}, ${p}, ${ctx.actorId}, 'Mine', 'a0', array[${ctx.actorId}]::uuid[])`
  })
  /*
   * A list again, as the design first had it. The
   * order is the order people were put on, and `assignee_id` is the first,
   * worked out by the database for the apps that draw one face: it cannot be
   * written, so it cannot disagree with the list.
   */
  await withActor(ctx.actorId, (tx) => tx`update task set assignee_ids = array[${sam.actorId}, ${ctx.actorId}]::uuid[] where id = ${id}`)
  const [row] = await withActor(
    ctx.actorId,
    (tx) => tx<{ assignee_id: string | null; assignee_ids: string[] }[]>`select assignee_id, assignee_ids from task where id = ${id}`,
  )
  assert.deepEqual(row!.assignee_ids, [sam.actorId, ctx.actorId])
  assert.equal(row!.assignee_id, sam.actorId)
  /* Nobody twice: the same person put on again is a mistake, not a weight. */
  await assert.rejects(
    withActor(ctx.actorId, (tx) => tx`update task set assignee_ids = array[${sam.actorId}, ${sam.actorId}]::uuid[] where id = ${id}`),
  )
})

test('one row is the list, the board card and the calendar event', async () => {
  const { ctx, workspaceId } = await makeOwner()
  const p = await makeProject(ctx, workspaceId, 'Acme')
  const id = uuidv7()
  const listId = uuidv7()
  await withActor(ctx.actorId, async (tx) => {
    await tx`
      insert into task_list (id, workspace_id, project_id, author_id, name, sort_key)
      values (${listId}, ${workspaceId}, ${p}, ${ctx.actorId}, 'Doing', 'a1')`
    await tx`
      insert into task (id, workspace_id, project_id, author_id, title, sort_key,
                        list_id, starts_at, ends_at)
      values (${id}, ${workspaceId}, ${p}, ${ctx.actorId}, 'Everything at once', 'a0',
              ${listId}, now(), now() + interval '1 hour')`
  })
  const t = await withActor(ctx.actorId, async (tx) => {
    const [row] = await tx<{ list_id: string; starts_at: string; sort_key: string }[]>`
      select list_id, starts_at, sort_key from task where id = ${id}`
    return row!
  })
  /* Switching views cannot lose anything, because there is nothing to lose:
     the list reads sort_key, the board draws the same lists as its columns,
     the calendar reads starts_at, and they are the same row. The board's
     column used to be a field of its own that could disagree with the list. */
  assert.ok(t.list_id && t.starts_at && t.sort_key)
})

/**
 * Absent and null are two different answers about a list's colour.
 *
 * Everything else on that row is written with `coalesce`, which reads null
 * as "leave it alone" — right for a name, wrong for the one field whose
 * null means something. Null is not the absence of a colour here: it is the
 * mark deciding, which is what it did before anybody could choose.
 */
test('a list keeps its colour through a patch that says nothing about it', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const project = await makeProject(ctx, workspaceId, 'Rebrand')
  const { app } = await import('../src/http/routes.js')
  const send = async (path: string, method: string, body: unknown) => {
    const r = await app.request(path, {
      method,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    })
    return { status: r.status, body: (await r.json()) as Record<string, unknown> }
  }
  const colourOf = async (id: string) => {
    const [row] = await withActor(ctx.actorId, (tx) => tx<{ color: string | null }[]>`select color from task_list where id = ${id}`)
    return row?.color ?? null
  }

  // Made without one: the mark decides, which is the default and not a gap.
  const made = await send(`/api/projects/${project}/lists`, 'POST', { name: 'Backlog' })
  const id = made.body['id'] as string
  assert.equal(await colourOf(id), null)

  assert.equal((await send(`/api/lists/${id}`, 'PATCH', { color: 'orange' })).status, 200)
  assert.equal(await colourOf(id), 'orange')

  // Renaming it says nothing about the colour, so the colour stays.
  assert.equal((await send(`/api/lists/${id}`, 'PATCH', { name: 'Later' })).status, 200)
  assert.equal(await colourOf(id), 'orange')

  // And null is a thing somebody can say: give the mark its own back.
  assert.equal((await send(`/api/lists/${id}`, 'PATCH', { color: null })).status, 200)
  assert.equal(await colourOf(id), null)

  // Not any colour: ten the eye can name, checked by the schema and again by
  // the database.
  assert.equal((await send(`/api/lists/${id}`, 'PATCH', { color: 'beige' })).status, 400)
})
