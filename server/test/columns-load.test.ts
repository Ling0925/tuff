import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { app } from '../src/http/routes.js'
import { addPerson, bearerFor, closeDb, makeOwner, makeProject } from './helpers.js'

/**
 * A board reads each list on its own — `GET /api/projects/:id/tasks?by=list`
 * and `?list=`. A Done column of a hundred and
 * sixty cards drawn at once ended the page on a phone.
 */
after(closeDb)

type Row = { id: string; list_id: string | null; parent_id: string | null; sort_key: string }
type ByList = { tasks: Row[]; lists: { id: string; total: number; next_cursor: string | null }[] }
type OneList = { tasks: Row[]; next_cursor: string | null; total: number }

const call = (path: string, token: string, init: RequestInit = {}) =>
  app.request(path, {
    ...init,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
  })
const get = async <T>(path: string, token: string): Promise<T> => {
  const r = await call(path, token)
  assert.equal(r.status, 200, `${path} answered ${r.status}`)
  return (await r.json()) as T
}
const post = async (path: string, token: string, body: unknown): Promise<string> => {
  const r = await call(path, token, { method: 'POST', body: JSON.stringify(body) })
  assert.equal(r.status, 201, `${path} answered ${r.status}`)
  return ((await r.json()) as { id: string }).id
}
/* The list's own order: the key byte by byte, then the id. */
const inOrder = (a: Row, b: Row) => (a.sort_key < b.sort_key ? -1 : a.sort_key > b.sort_key ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

test('every list’s head with its count, then the rest of one list page by page, missing and repeating nothing', async () => {
  const me = await makeOwner()
  const project = await makeProject(me.ctx, me.workspaceId, 'By list')
  const a = await post(`/api/projects/${project}/lists`, me.token, { name: 'Lots' })
  const b = await post(`/api/projects/${project}/lists`, me.token, { name: 'Few', finishes: true })

  const inA: string[] = []
  for (let i = 0; i < 23; i++) inA.push(await post(`/api/projects/${project}/tasks`, me.token, { title: `A ${i}`, list_id: a }))
  const inB: string[] = []
  for (let i = 0; i < 3; i++) inB.push(await post(`/api/projects/${project}/tasks`, me.token, { title: `B ${i}`, list_id: b }))
  /* Parts are not cards: not counted, not paged, and handed with their
     parent wherever it falls. */
  const parent = inA[22]!
  const parts = [
    await post(`/api/projects/${project}/tasks`, me.token, { title: 'Part 1', parent_id: parent }),
    await post(`/api/projects/${project}/tasks`, me.token, { title: 'Part 2', parent_id: parent }),
  ]

  const head = await get<ByList>(`/api/projects/${project}/tasks?by=list&limit=10&pictures=1`, me.token)
  const lots = head.lists.find((l) => l.id === a)!
  const few = head.lists.find((l) => l.id === b)!
  assert.equal(lots.total, 23, 'the count leaves the parts out')
  assert.ok(lots.next_cursor, 'more behind the first ten')
  assert.equal(few.total, 3)
  assert.equal(few.next_cursor, null, 'a list read whole has no cursor')

  const topA = head.tasks.filter((t) => t.list_id === a && !t.parent_id)
  assert.equal(topA.length, 10)
  assert.deepEqual(topA, [...topA].sort(inOrder), 'in the list’s own order')
  assert.equal(head.tasks.filter((t) => t.list_id === b && !t.parent_id).length, 3)

  /* Page through the rest of the long one. */
  const seen = topA.map((t) => t.id)
  const partsSeen = new Set(head.tasks.filter((t) => t.parent_id).map((t) => t.id))
  let cursor: string | null = lots.next_cursor
  let last = topA[topA.length - 1]!
  while (cursor) {
    const page: OneList = await get<OneList>(
      `/api/projects/${project}/tasks?list=${a}&limit=10&cursor=${encodeURIComponent(cursor)}`,
      me.token,
    )
    assert.equal(page.total, 23)
    const top = page.tasks.filter((t) => !t.parent_id)
    assert.ok(
      top.every((t) => t.list_id === a),
      'only that list',
    )
    assert.ok(inOrder(last, top[0]!) < 0, 'a page starts after the one before it')
    assert.deepEqual(top, [...top].sort(inOrder))
    for (const t of page.tasks.filter((t) => t.parent_id)) partsSeen.add(t.id)
    seen.push(...top.map((t) => t.id))
    last = top[top.length - 1]!
    cursor = page.next_cursor
  }
  assert.equal(seen.length, 23)
  assert.equal(new Set(seen).size, 23, 'nothing repeated')
  assert.deepEqual([...seen].sort(), [...inA].sort(), 'nothing missed')
  assert.deepEqual([...partsSeen].sort(), [...parts].sort(), 'the parts came with their parent')
})

test('a list of another project, or out of sight, is not there', async () => {
  const me = await makeOwner()
  const project = await makeProject(me.ctx, me.workspaceId, 'Mine')
  const other = await makeProject(me.ctx, me.workspaceId, 'Other')
  const there = await post(`/api/projects/${other}/lists`, me.token, { name: 'Elsewhere' })
  const here = await post(`/api/projects/${project}/lists`, me.token, { name: 'Here' })
  await post(`/api/projects/${project}/tasks`, me.token, { title: 'Secret', list_id: here })

  /* Another project's list, asked of this one. */
  assert.equal((await call(`/api/projects/${project}/tasks?list=${there}`, me.token)).status, 404)

  /* Somebody in the workspace and not on the project. */
  const outsider = await addPerson(me.ctx, me.workspaceId, 'member', [other])
  const token = await bearerFor(outsider.actorId, me.workspaceId)
  assert.equal((await call(`/api/projects/${project}/tasks?list=${here}`, token)).status, 404)
  const blind = await get<ByList>(`/api/projects/${project}/tasks?by=list`, token)
  assert.deepEqual(blind.tasks, [], 'nothing of a project out of sight')

  /* Another company. */
  const stranger = await makeOwner()
  assert.equal((await call(`/api/projects/${project}/tasks?list=${here}`, stranger.token)).status, 404)

  /* What is malformed is refused, not guessed at. */
  assert.equal((await call(`/api/projects/${project}/tasks?list=nope`, me.token)).status, 400)
  assert.equal((await call(`/api/projects/${project}/tasks?list=${here}&cursor=nope`, me.token)).status, 400)
  assert.equal((await call(`/api/projects/${project}/tasks?by=list&order=created`, me.token)).status, 400)
})
