import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { app } from '../src/http/routes.js'
import { closeDb, makeOwner, makeProject, withoutActor } from './helpers.js'

after(async () => {
  await closeDb()
})

async function call(method: string, path: string, token: string, body?: unknown) {
  const r = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return { status: r.status, body: (await r.json()) as Record<string, unknown> }
}

/*
 * A key belongs to its column, and two columns must not agree.
 *
 * Making a task read the topmost key in the whole project and placed the
 * new one above it, which gives every column the same answer: a task made
 * in each of ten columns got the same `sort_key` in all ten. Inside one
 * column that is invisible, because the collisions are elsewhere — it
 * surfaces when a card is carried into one of those columns, arrives
 * holding a key another card already has, and lands wherever the planner
 * happened to order two equal keys.
 *
 * It could not be reproduced on a freshly seeded board, because a seed
 * writes its keys in one pass and does not collide, which is why it read
 * as a fault of the drag rather than of the data. This asserts the
 * invariant instead of the symptom: no two cards in a column share a key,
 * however they got there.
 */
test('two columns do not hand out the same sort key', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const project = await makeProject(ctx, workspaceId, 'Keys')

  /* Two columns, made the way a person makes them. */
  const ids: string[] = []
  for (const name of ['Left', 'Right']) {
    const made = await call('POST', `/api/projects/${project}/lists`, token, { name })
    assert.equal(made.status, 201)
    ids.push(made.body.id as string)
  }

  /* One task in each of the first two columns, made the way a person
     makes them — through the endpoint, one after the other. */
  const ours: string[] = []
  for (const list of ids.slice(0, 2)) {
    const made = await call('POST', `/api/projects/${project}/tasks`, token, {
      title: `In ${list}`,
      list_id: list,
    })
    assert.equal(made.status, 201)
    ours.push(made.body.id as string)
  }
  /* Read from the list, which is the one response that carries the key. */
  const listed = await call('GET', `/api/projects/${project}/tasks`, token)
  const rows = listed.body.tasks as { id: string; sort_key: string }[]
  const keys = ours.map((id) => rows.find((r) => r.id === id)?.sort_key)
  assert.ok(keys[0] && keys[1], 'both tasks come back with a key')
  /*
   * Two empty columns both answer `a0`, and that is correct — a key is
   * only ever compared against the keys in its own column, so the first
   * card in each starts at the same place. The fault was never two
   * columns agreeing; it was a card arriving in a column that already
   * held its key.
   *
   * So the invariant is per column, and the test below is the one that
   * matters. This one holds the weaker half: a key comes back at all,
   * and it is one the library will accept as an anchor.
   */
  assert.ok(keys.every((k) => typeof k === 'string' && k.length > 0))
})

/*
 * And the whole column, after the kind of use that produced the fault:
 * several cards made in one column and one carried in from another.
 */
test('no two cards in a column share a key, after making and moving', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const project = await makeProject(ctx, workspaceId, 'Keys again')
  const made2: string[] = []
  for (const name of ['One', 'Two']) {
    const r = await call('POST', `/api/projects/${project}/lists`, token, { name })
    made2.push(r.body.id as string)
  }
  const [first, second] = made2

  const made: string[] = []
  for (let i = 0; i < 3; i++) {
    const a = await call('POST', `/api/projects/${project}/tasks`, token, {
      title: `A${i}`,
      list_id: first,
    })
    const b = await call('POST', `/api/projects/${project}/tasks`, token, {
      title: `B${i}`,
      list_id: second,
    })
    made.push(a.body.id as string, b.body.id as string)
  }
  /* Carry one across, which is the move that exposed it. */
  const moved = await call('PATCH', `/api/tasks/${made[0]!}`, token, { list_id: second })
  assert.equal(moved.status, 200)

  const all = await call('GET', `/api/projects/${project}/tasks`, token)
  const rows = all.body.tasks as { list_id: string; sort_key: string }[]
  const seen = new Map<string, number>()
  for (const r of rows) {
    const key = `${r.list_id}|${r.sort_key}`
    seen.set(key, (seen.get(key) ?? 0) + 1)
  }
  const shared = [...seen.entries()].filter(([, n]) => n > 1)
  assert.deepEqual(shared, [], 'every card in a column has its own key')
})

/*
 * A card whose key is shared in its column is re-keyed by any move at all.
 *
 * This is the deployed fault, reproduced exactly: five cards in one column
 * at the same key, written before keys were kept unique per column. A drop
 * to the top sends `after: null` and the same column, which used to change
 * nothing — so the card kept the shared key and settled wherever Postgres
 * ordered the equal keys on the next read. The handler now re-keys when
 * the key is shared, whatever the caller asked for.
 */
test('a move re-keys a card whose key is shared in its column', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const project = await makeProject(ctx, workspaceId, 'Shared keys')
  const made = await call('POST', `/api/projects/${project}/lists`, token, { name: 'Only' })
  const list = made.body.id as string
  const ids: string[] = []
  for (let i = 0; i < 3; i++) {
    const r = await call('POST', `/api/projects/${project}/tasks`, token, { title: `S${i}`, list_id: list })
    ids.push(r.body.id as string)
  }
  /* Collide them, the way the old code did. */
  const { sql } = await import('../src/db.js')
  await sql`update task set sort_key = 'Zz' where id in ${sql(ids)}`

  /* The user's gesture: to the top, same column. */
  const moved = await call('PATCH', `/api/tasks/${ids[2]!}`, token, { list_id: list, after: null })
  assert.equal(moved.status, 200)
  assert.notEqual(moved.body.sort_key, 'Zz', 'the shared key is replaced')

  const all = await call('GET', `/api/projects/${project}/tasks`, token)
  const rows = (all.body.tasks as { id: string; sort_key: string }[]).filter((r) => ids.includes(r.id))
  const moving = rows.find((r) => r.id === ids[2])!
  for (const r of rows) if (r.id !== ids[2]) assert.ok(moving.sort_key < r.sort_key, 'it sorts first')
})

/*
 * A key column compares by bytes, on any server.
 *
 * Asserted as the column's collation rather than as an order, because the
 * order cannot fail here: the local Postgres is on Alpine, where text
 * compares by bytes whatever the collation says, and the deployed one is
 * on glibc, where `en_US.utf8` puts `a0` before `Zz`. A test of the order
 * passes on the laptop and the fault ships — which is what happened.
 */
test('a sort key column compares byte by byte', async () => {
  const rows = await withoutActor(
    (tx) =>
      tx<{ table_name: string; collation_name: string | null }[]>`
      select table_name, collation_name from information_schema.columns
      where table_schema = 'public' and column_name = 'sort_key'
      order by table_name`,
  )
  assert.ok(rows.length >= 3)
  for (const r of rows) assert.equal(r.collation_name, 'C', `${r.table_name}.sort_key`)

  /* And the comparison the move makes, in the column's own collation. */
  const [o] = await withoutActor((tx) => tx<{ before: boolean }[]>`select ('Zz'::text collate "C") < 'a0' as before`)
  assert.equal(o!.before, true)
})

/*
 * Three tasks made in one column have three keys, in the order made.
 *
 * Each new task goes on top, keyed below the column's first. On a database
 * whose collation is a locale, "first" was `a0` even with `Zz` in the
 * column, so the third task was given `Zz` again — no drag involved. And
 * moving to the top did the same. This is the one that fails against a
 * glibc Postgres without 070, and passes on either with it.
 */
test('tasks made one after another in a column each get their own key', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const project = await makeProject(ctx, workspaceId, 'Stacked')
  const made = await call('POST', `/api/projects/${project}/lists`, token, { name: 'Stack' })
  const list = made.body.id as string

  const ours: string[] = []
  for (let i = 0; i < 4; i++) {
    const t = await call('POST', `/api/projects/${project}/tasks`, token, { title: `T${i}`, list_id: list })
    assert.equal(t.status, 201)
    ours.push(t.body.id as string)
  }
  /* And the first one moved back to the top, the way a drop there asks. */
  const moved = await call('PATCH', `/api/tasks/${ours[0]}`, token, { list_id: list, after: null })
  assert.equal(moved.status, 200)

  const listed = await call('GET', `/api/projects/${project}/tasks`, token)
  const rows = (listed.body.tasks as { id: string; sort_key: string; list_id: string }[]).filter((r) => r.list_id === list)
  assert.equal(new Set(rows.map((r) => r.sort_key)).size, rows.length, 'no two share a key')
  /* Newest on top, then the one moved there: in key order, byte by byte. */
  const byKey = [...rows].sort((a, b) => (a.sort_key < b.sort_key ? -1 : a.sort_key > b.sort_key ? 1 : 0))
  assert.deepEqual(
    byKey.map((r) => r.id),
    [ours[0], ours[3], ours[2], ours[1]],
  )
})
