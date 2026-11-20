import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { closeDb, withActor, inWorkspace, uuidv7, makeOwner, addPerson, makeProject } from './helpers.js'

after(async () => {
  await closeDb()
})

test('one workspace never sees another', async () => {
  const a = await makeOwner()
  const b = await makeOwner()
  await makeProject(a.ctx, a.workspaceId, 'Theirs')

  // The design asks for the bound to be in the query, not in a controller.
  // This is the test of that claim: a handler that forgot a WHERE clause
  // returns nothing rather than everything.
  const seen = await withActor(b.ctx.actorId, async (tx) => {
    const rows = await tx<{ name: string }[]>`select name from project where deleted_at is null`
    return rows.map((r) => r.name)
  })
  assert.deepEqual(seen, [])
})

test('a member sees only the projects they are on', async () => {
  const { ctx, workspaceId } = await makeOwner()
  const theirs = await makeProject(ctx, workspaceId, 'Theirs')
  await makeProject(ctx, workspaceId, 'Not theirs')

  const sam = await addPerson(ctx, workspaceId, 'member', [theirs])
  const seen = await withActor(sam.actorId, async (tx) => {
    const rows = await tx<{ name: string }[]>`select name from project where deleted_at is null`
    return rows.map((r) => r.name)
  })
  assert.deepEqual(seen, ['Theirs'])
})

test('an owner runs every project without joining it', async () => {
  // Otherwise administering a workspace means adding yourself to everything,
  // which is a worse default than the one it guards against.
  const { ctx, workspaceId } = await makeOwner()
  const other = await addPerson(ctx, workspaceId, 'member')
  const p = uuidv7()
  await withActor(ctx.actorId, async (tx) => {
    await tx`insert into project (id, workspace_id, name) values (${p}, ${workspaceId}, 'Solo')`
  })
  const seen = await withActor(other.actorId, async (tx) => {
    const rows = await tx<{ id: string }[]>`select id from project where deleted_at is null`
    return rows.map((r) => r.id)
  })
  // A member sees nothing they were not added to; the owner is the exception
  // and the exception is the point.
  assert.deepEqual(seen, [], 'a member saw a project nobody put them on')
  const mine = await withActor(ctx.actorId, async (tx) => {
    const rows = await tx<{ id: string }[]>`select id from project where deleted_at is null`
    return rows.map((r) => r.id)
  })
  assert.deepEqual(mine, [p], 'the owner could not see a project nobody joined')
})

test('a secret is not merely policy-protected, it is not selectable', async () => {
  const { ctx } = await makeOwner()
  await assert.rejects(
    () => withActor(ctx.actorId, (tx) => tx`select password_hash from app_user`),
    /permission denied/i,
    'the application role can read a password hash',
  )
  await assert.rejects(() => withActor(ctx.actorId, (tx) => tx`select token_hash from api_token`), /permission denied/i)
})

test('nobody may delete anything, ever', async () => {
  const { ctx, workspaceId } = await makeOwner()
  const p = await makeProject(ctx, workspaceId, 'Doomed')
  // Deletion is soft with a restore window, so DELETE is granted nowhere. This
  // is the database refusing rather than every handler remembering.
  await assert.rejects(() => withActor(ctx.actorId, (tx) => tx`delete from project where id = ${p}`), /permission denied/i)
})

/*
 * One person, two workspaces.
 *
 * Every account had exactly one workspace until the day one had two, and on
 * that day My tasks listed the other company's work and the palette searched
 * it. Nothing had changed in those queries: they leant on row-level security
 * to bound them, and row-level security is about the person, who was a member
 * of both. The session knows which workspace it is in, so now the policies do
 * — `044_session_workspace.sql`.
 *
 * This is written against the plain query with no WHERE clause, because that
 * is the handler this is protecting: the one that forgot.
 */
test('a session sees one workspace, even when the person has two', async () => {
  const here = await makeOwner()
  const there = await makeOwner()

  await makeProject(here.ctx, here.workspaceId, 'This one')
  const other = await makeProject(there.ctx, there.workspaceId, 'The other one')
  // The same person in both, which is what an agency's consultant looks
  // like: a member there, on its project — a workspace has one owner.
  await withActor(there.ctx.actorId, async (tx) => {
    await tx`
      insert into membership (id, workspace_id, actor_id, role, invited_by, joined_at)
      values (${uuidv7()}, ${there.workspaceId}, ${here.ctx.actorId}, 'member', ${there.ctx.actorId}, now())`
  })
  await withActor(
    there.ctx.actorId,
    (tx) => tx`
    insert into project_member (id, workspace_id, project_id, actor_id, added_by)
    values (${uuidv7()}, ${there.workspaceId}, ${other}, ${here.ctx.actorId}, ${there.ctx.actorId})`,
  )

  const names = (rows: { name: string }[]) => rows.map((r) => r.name).sort()

  const inHere = await inWorkspace(
    here.ctx.actorId,
    here.workspaceId,
    (tx) => tx<{ name: string }[]>`select name from project where deleted_at is null`,
  )
  assert.deepEqual(names(inHere), ['This one'])

  const inThere = await inWorkspace(
    here.ctx.actorId,
    there.workspaceId,
    (tx) => tx<{ name: string }[]>`select name from project where deleted_at is null`,
  )
  assert.deepEqual(names(inThere), ['The other one'])

  // And unbounded is still unbounded, for the switcher that has to see both.
  const everywhere = await withActor(here.ctx.actorId, (tx) => tx<{ name: string }[]>`select name from project where deleted_at is null`)
  assert.deepEqual(names(everywhere), ['The other one', 'This one'])
})
