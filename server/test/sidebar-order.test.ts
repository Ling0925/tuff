import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import postgres from 'postgres'
import { app } from '../src/http/routes.js'
import { closeDb, makeOwner, makeProject } from './helpers.js'

/* `docs/specs/sidebar-order.md`. */
const owner = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} })
after(async () => {
  await owner.end()
  await closeDb()
})
const call = (path: string, token: string, body?: unknown) =>
  app.request(`/api${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

/* The seed makes its projects in one moment. The first drag wrote the list
   down in an order that broke the tie its own way, not the one on the
   screen, and the project landed somewhere nobody dropped it. */
test('the first drag writes the list as it was shown, ties and all', async () => {
  const me = await makeOwner()
  const ids = [
    await makeProject(me.ctx, me.workspaceId, 'A'),
    await makeProject(me.ctx, me.workspaceId, 'B'),
    await makeProject(me.ctx, me.workspaceId, 'C'),
  ]
  await owner`update project set created_at = '2026-11-06T10:00:00Z' where id = any(${ids}::uuid[])`
  const list = async () =>
    ((await (await call('/projects', me.token)).json()) as { projects: { name: string; id: string }[] }).projects.filter((p) =>
      ids.includes(p.id),
    )
  const shown = await list()
  // The first dropped behind the last.
  assert.equal((await call(`/projects/${shown[0]!.id}/place`, me.token, { after: shown[2]!.id })).status, 200)
  assert.deepEqual(
    (await list()).map((p) => p.name),
    [shown[1]!.name, shown[2]!.name, shown[0]!.name],
  )
})
