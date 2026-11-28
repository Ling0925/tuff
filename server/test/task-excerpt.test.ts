import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { app } from '../src/http/routes.js'
import { closeDb, makeOwner, makeProject } from './helpers.js'

/* The row and the card carry what the description says, but not its
   document: one flat line of at most two hundred and forty characters. */
after(closeDb)

type Row = { id: string; title: string; excerpt: string | null }

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
const words = (...lines: (string | null)[]) => ({
  type: 'doc',
  content: lines.map((line) => ({
    type: 'paragraph',
    content: line === null ? undefined : [{ type: 'text', text: line }],
  })),
})

test('a task row carries its description flattened and shortened', async () => {
  const me = await makeOwner()
  const project = await makeProject(me.ctx, me.workspaceId, 'Excerpts')
  const list = await post(`/api/projects/${project}/lists`, me.token, { name: 'Doing' })

  const said = await post(`/api/projects/${project}/tasks`, me.token, {
    title: 'Said',
    list_id: list,
    body: words('  First line\nwith   space  ', 'Second line'),
  })
  const empty = await post(`/api/projects/${project}/tasks`, me.token, { title: 'Empty', list_id: list, body: words(null) })
  const long = await post(`/api/projects/${project}/tasks`, me.token, {
    title: 'Long',
    list_id: list,
    body: words(`${'x'.repeat(241)}tail`),
  })

  const page = await get<{ tasks: Row[] }>(`/api/projects/${project}/tasks`, me.token)
  const byId = new Map(page.tasks.map((t) => [t.id, t]))
  assert.equal(byId.get(said)?.excerpt, 'First line with space Second line', 'flattened in order, whitespace collapsed')
  assert.equal(byId.get(empty)?.excerpt, null, 'no words is null, not an empty string')
  assert.equal(byId.get(long)?.excerpt, 'x'.repeat(240), 'shortened before the row')

  const columns = await get<{ tasks: Row[] }>(`/api/projects/${project}/tasks?by=list`, me.token)
  assert.equal(columns.tasks.find((t) => t.id === said)?.excerpt, 'First line with space Second line', 'the board read carries it too')

  const changedBody = words('Now it says this')
  const patched = await call(`/api/tasks/${said}`, me.token, { method: 'PATCH', body: JSON.stringify({ body: changedBody }) })
  assert.equal(patched.status, 200)
  const change = (await patched.json()) as { task?: Row }
  assert.equal(change.task?.excerpt, 'Now it says this', 'the write answer carries the row again')
})
