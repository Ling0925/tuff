import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import postgres from 'postgres'
import { app } from '../src/http/routes.js'
import { closeDb, makeOwner, makeProject } from './helpers.js'

/**
 * A project's tasks come open work first — `GET /api/projects/:id/tasks`,
 * `docs/api.md`. A project of two hundred and ten drew its first page of
 * two hundred and then, a second later, the in-progress card the page
 * boundary had cut, because finished tasks sat before it in `sort_key`.
 */
const owner = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} })
after(async () => {
  await owner.end()
  await closeDb()
})

type Page = { tasks: { id: string; completed_at: string | null; sort_key: string }[]; next_cursor: string | null }
const get = async (path: string, token: string) => {
  const r = await app.request(path, { headers: { authorization: `Bearer ${token}` } })
  assert.equal(r.status, 200)
  return (await r.json()) as Page
}

test('open tasks come before finished ones, and the pages miss and repeat nothing', async () => {
  const me = await makeOwner()
  const project = await makeProject(me.ctx, me.workspaceId, 'Open first')
  const made: string[] = []
  for (let i = 0; i < 30; i++) {
    const r = await app.request(`/api/projects/${project}/tasks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${me.token}` },
      body: JSON.stringify({ title: `Task ${i}` }),
    })
    assert.equal(r.status, 201)
    made.push(((await r.json()) as { id: string }).id)
  }
  /* The first twenty-four finished, so in `sort_key` alone the open six
     would be the last rows of the project. */
  await owner`update task set completed_at = now() where id = any(${made.slice(0, 24)})`

  const first = await get(`/api/projects/${project}/tasks?limit=10`, me.token)
  assert.equal(first.tasks.length, 10)
  assert.equal(first.tasks.filter((t) => !t.completed_at).length, 6, 'every open task is on the first page')
  assert.ok(
    first.tasks.slice(0, 6).every((t) => !t.completed_at),
    'and before any finished one',
  )
  assert.match(first.next_cursor ?? '', /^d:/)

  const seen = [...first.tasks.map((t) => t.id)]
  let cursor = first.next_cursor
  while (cursor) {
    const page = await get(`/api/projects/${project}/tasks?limit=10&cursor=${encodeURIComponent(cursor)}`, me.token)
    assert.ok(
      page.tasks.every((t) => t.completed_at),
      'after the open ones, only finished',
    )
    seen.push(...page.tasks.map((t) => t.id))
    cursor = page.next_cursor
  }
  assert.equal(seen.length, 30)
  assert.equal(new Set(seen).size, 30, 'nothing repeated')
  assert.deepEqual([...seen].sort(), [...made].sort(), 'nothing missed')

  /* A cursor from a client older than the open-first order — `key|id` with
     no side — still answers, read as among the open. */
  const old = `${first.tasks[0]!.sort_key}|${first.tasks[0]!.id}`
  const r = await app.request(`/api/projects/${project}/tasks?limit=10&cursor=${encodeURIComponent(old)}`, {
    headers: { authorization: `Bearer ${me.token}` },
  })
  assert.equal(r.status, 200)
})
