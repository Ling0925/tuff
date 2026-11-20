import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { app } from '../src/http/routes.js'
import { emit } from '../src/webhooks.js'
import { asWorker, closeDb, makeOwner, makeProject, uuidv7, withActor, withoutActor } from './helpers.js'

after(async () => {
  await closeDb()
})

/*
 * The queues are claimed and cleared — `124_the_queues_are_cleared_and_claimed.sql`.
 */
test('a delivery is claimed by the pass that reads it, and given up after ten tries', async () => {
  const { ctx, workspaceId } = await makeOwner()
  await withActor(ctx.actorId, async (tx) => {
    await tx`
      insert into webhook (id, workspace_id, url, secret_enc, created_by)
      values (${uuidv7()}, ${workspaceId}, 'https://example.com/hook', 'whs_x', ${ctx.actorId})`
    await emit(tx, workspaceId, 'task.create', {})
    await emit(tx, workspaceId, 'task.update', {})
  })
  const due = () => withoutActor((tx) => tx<{ id: string }[]>`select id from due_webhook_deliveries(10, ${workspaceId})`)
  const first = await due()
  assert.equal(first.length, 2)
  assert.equal((await due()).length, 0, 'a second pass finds them taken')

  await withoutActor((tx) => tx`update webhook_delivery set deliver_after = now(), attempts = 10 where workspace_id = ${workspaceId}`)
  assert.equal((await due()).length, 0, 'ten tries is enough')
})

test('old notifications and deliveries are cleared, new ones kept', async () => {
  const { ctx, workspaceId } = await makeOwner()
  const project = await makeProject(ctx, workspaceId, 'Queues')
  const note = (read: string | null, made: string) =>
    withActor(
      ctx.actorId,
      (tx) => tx`
        insert into notification (id, workspace_id, actor_id, reason, object_type, object_id, read_at, created_at)
        values (${uuidv7()}, ${workspaceId}, ${ctx.actorId}, 'subscribed', 'project', ${project},
                ${read ? tx`now() - ${read}::interval` : null}, now() - ${made}::interval)`,
    )
  await note('100 days', '120 days') // read long ago: goes
  await note(null, '200 days') // unread but half a year old: goes
  await note('1 day', '120 days') // read yesterday: stays
  await note(null, '1 day') // new: stays
  await asWorker((tx) => tx`select purge_queues()`)
  const [left] = await withActor(
    ctx.actorId,
    (tx) => tx<{ n: number }[]>`select count(*)::int as n from notification where workspace_id = ${workspaceId}`,
  )
  assert.equal(left!.n, 2)
})

test('a file is read without where its bytes are kept', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const project = await makeProject(ctx, workspaceId, 'Keys')
  const id = uuidv7()
  await withActor(
    ctx.actorId,
    (tx) => tx`
    insert into file (id, workspace_id, project_id, author_id, name, storage_key, size_bytes, uploaded_at)
    values (${id}, ${workspaceId}, ${project}, ${ctx.actorId}, 'a.pdf', ${`${workspaceId}/${id}`}, 10, now())`,
  )
  const r = await app.request(`/api/files/${id}`, { headers: { authorization: `Bearer ${token}` } })
  const { file } = (await r.json()) as { file: Record<string, unknown> }
  assert.equal(file.upload, true)
  assert.ok(!('storage_key' in file) && !('display_key' in file))
})

/* The worker's functions take ids from whoever calls them. As the role every
   request runs as, an injection anywhere could have read anybody's GitHub
   token or stopped another company's link — migration 153. */
test('the worker’s functions are the worker’s: the application role is refused them', async () => {
  const someone = await makeOwner()
  for (const call of [
    () => withoutActor((tx) => tx`select github_out_claim(1)`),
    () => withoutActor((tx) => tx`select * from github_people(${someone.workspaceId})`),
    () => withoutActor((tx) => tx`select github_link_stop(${uuidv7()}, 'x')`),
    () => withoutActor((tx) => tx`select purge_queues()`),
    () => withoutActor((tx) => tx`select end_gifts()`),
  ]) {
    await assert.rejects(call(), /permission denied/)
  }
  // The worker may.
  await asWorker((tx) => tx`select github_out_claim(0)`)
  // A GitHub token by person: as the application, only the asker's own.
  const other = await makeOwner()
  await withActor(
    someone.ctx.actorId,
    (tx) => tx`
    insert into github_person (actor_id, github_id, login, token_enc)
    values (${someone.ctx.actorId}, ${Math.floor(Math.random() * 1e9)}, 'w', 'sealed')`,
  )
  const asOther = await withActor(other.ctx.actorId, (tx) => tx`select * from github_person_token(${someone.ctx.actorId})`)
  assert.equal(asOther.length, 0)
  const asThem = await withActor(someone.ctx.actorId, (tx) => tx`select * from github_person_token(${someone.ctx.actorId})`)
  assert.equal(asThem.length, 1)
  // The worker asks only for a workspace and a project the person is still
  // in (`github_person_token_in`, migration 292); this one is not its.
  await assert.rejects(
    asWorker((tx) => tx`select * from github_person_token(${someone.ctx.actorId})`),
    /permission denied/,
  )
  const project = await makeProject(someone.ctx, someone.workspaceId, 'Tokens')
  const asWorkerIn = await asWorker(
    (tx) => tx`select * from github_person_token_in(${someone.ctx.actorId}, ${someone.workspaceId}, ${project})`,
  )
  assert.equal(asWorkerIn.length, 1)
  const elsewhere = await asWorker(
    (tx) => tx`select * from github_person_token_in(${someone.ctx.actorId}, ${other.workspaceId}, ${project})`,
  )
  assert.equal(elsewhere.length, 0)
})
