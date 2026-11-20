import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { app } from '../src/http/routes.js'
import { closeDb, withActor, uuidv7, makeOwner, makeProject } from './helpers.js'

after(closeDb)

async function insert(table: 'task' | 'file', who: string, ws: string, project: string): Promise<{ id: string; number: number }> {
  const id = uuidv7()
  const [row] = await withActor(who, (tx) =>
    table === 'task'
      ? tx<{ number: number }[]>`
          insert into task (id, workspace_id, project_id, author_id, title, sort_key)
          values (${id}, ${ws}, ${project}, ${who}, 'A task', 'a0') returning number`
      : tx<{ number: number }[]>`
          insert into file (id, workspace_id, project_id, author_id, name, storage_key, size_bytes, uploaded_at)
          values (${id}, ${ws}, ${project}, ${who}, 'p.png', 'k', 1, now()) returning number`,
  )
  return { id, number: row!.number }
}

/**
 * A task's number is the next task's, whatever else was made in between.
 *
 * One counter for tasks, posts and files gave NEW-18 and then NEW-22 to two
 * tasks made a minute apart, because three pictures were pasted into a
 * description between them — and the key and number are shown only on
 * tasks, so the gaps were where people read the numbers as a run.
 */
test('tasks are numbered on their own, and a number names one thing of its kind', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const project = await makeProject(ctx, workspaceId, 'Counted')

  const first = await insert('task', ctx.actorId, workspaceId, project)
  const picture = await insert('file', ctx.actorId, workspaceId, project)
  await insert('file', ctx.actorId, workspaceId, project)
  const second = await insert('task', ctx.actorId, workspaceId, project)

  assert.equal(second.number, first.number + 1, 'files in between take no task number')

  // The same number can now be a task and a file; the kind says which.
  const ask = async (n: number, kind?: string) => {
    const r = await app.request(`/api/projects/${project}/at/${n}${kind ? `?kind=${kind}` : ''}`, {
      headers: { authorization: `Bearer ${token}` },
    })
    return r.status === 200 ? ((await r.json()) as { id: string; kind: string }) : null
  }
  assert.equal((await ask(first.number, 'task'))?.id, first.id)
  assert.equal((await ask(picture.number, 'file'))?.id, picture.id)
  // Unsaid, a task answers first: `KEY-1` is what a task is called.
  if (picture.number === first.number) assert.equal((await ask(first.number))?.kind, 'task')
})
