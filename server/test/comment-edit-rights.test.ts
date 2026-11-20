import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { app } from '../src/http/routes.js'
import { closeRealtime } from '../src/realtime.js'
import { issueApiToken } from '../src/auth/flows.js'
import { issueAccessToken } from '../src/auth/tokens.js'
import {
  addManager,
  addPerson,
  asTableOwner,
  bearerFor,
  closeDb,
  inWorkspace,
  makeOwner,
  makeProject,
  uuidv7,
  withActor,
} from './helpers.js'

after(async () => {
  await closeRealtime()
  await closeDb()
})

/*
 * Somebody else's comment is never changed through a token, as an
 * announcement is not. Rewriting a sentence into nothing is
 * deleting it, and no token deletes a comment. The scenario: whoever runs a
 * project gives a tool a token, and the tool empties somebody's comment.
 * One's own stays a token's to fix, which is what `update_comment` is for;
 * and a person signed in with the right to edit others' words still may.
 */
const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
const EMPTY = { type: 'doc', content: [] }

async function makeTask(ownerId: string, ws: string, project: string, title: string) {
  const id = uuidv7()
  await withActor(ownerId, async (tx) => {
    await tx`
      insert into task (id, workspace_id, project_id, author_id, title, sort_key)
      values (${id}, ${ws}, ${project}, ${ownerId}, ${title}, 'a0')`
  })
  return id
}

async function call(path: string, token: string, method = 'GET', body?: unknown) {
  const r = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, any> }
}

test('somebody else’s comment is not changed through any token; one’s own is; a session with the right still may', async () => {
  const { ctx, workspaceId, token: owner } = await makeOwner()
  const p = await makeProject(ctx, workspaceId, 'Acme')
  const t = await makeTask(ctx.actorId, workspaceId, p, 'Ship it')
  const writer = await addPerson(ctx, workspaceId, 'member', [p])
  const runner = await addManager(ctx, workspaceId, [p])
  const editor = await addPerson(ctx, workspaceId, 'member', [p], ['task.create', 'edit.any'])
  const made = await call('/api/agents', owner, 'POST', { name: 'Helper', project_ids: [p], reach: 'mcp' })
  assert.equal(made.status, 201, JSON.stringify(made.body))
  const as = {
    owner,
    writer: await bearerFor(writer.actorId, workspaceId),
    runner: await bearerFor(runner.actorId, workspaceId),
    editor: await bearerFor(editor.actorId, workspaceId),
    /* An agent's token — and agents hold `edit.any` on their projects. */
    agent: made.body.token as string,
    /* Whoever runs the project, through a personal token for every project… */
    personal: await issueApiToken(runner.actorId, workspaceId, 'tool'),
    /* …and through one held to this project. */
    limited: await issueApiToken(runner.actorId, workspaceId, 'For Acme', [p]),
    /* The owner, through a token of theirs. */
    ownerTool: await issueApiToken(ctx.actorId, workspaceId, 'owner tool'),
    /* GitHub acting as whoever runs the project. */
    github: await issueAccessToken({ sub: runner.actorId, workspace_id: workspaceId, via: 'github' }),
  }

  const say = async (who: keyof typeof as, text = 'Looks right') => {
    const r = await call(`/api/tasks/${t}/comments`, as[who], 'POST', { body: doc(text) })
    assert.equal(r.status, 201, `${who} comments: ${JSON.stringify(r.body)}`)
    return r.body.id as string
  }
  const edit = async (who: keyof typeof as, id: string, body: unknown = doc(`By ${who}`)) =>
    (await call(`/api/comments/${id}`, as[who], 'PATCH', { body })).status
  const reads = async (id: string) => {
    const comments = (await call(`/api/tasks/${t}`, as.owner)).body.comments as { id: string; body: any }[]
    return comments.find((x) => x.id === id)?.body.content[0]?.content[0]?.text
  }

  const theirs = await say('writer', 'Notes')

  // Every kind of token, against somebody else's comment: refused, and it is left as it was.
  for (const who of ['agent', 'personal', 'limited', 'ownerTool', 'github'] as const) {
    assert.equal(await edit(who, theirs), 403, `${who} rewrites the writer's comment`)
    assert.equal(await edit(who, theirs, EMPTY), 403, `${who} empties the writer's comment`)
  }
  assert.equal(await reads(theirs), 'Notes')

  // The same people, signed in rather than through a token, may.
  assert.equal(await edit('runner', theirs), 200)
  assert.equal(await reads(theirs), 'By runner')
  assert.equal(await edit('editor', theirs), 200)
  assert.equal(await edit('owner', theirs), 200)
  assert.equal(await reads(theirs), 'By owner')

  // And every token may still change its own person's comment — the agent its own.
  assert.equal(await edit('agent', await say('agent')), 200)
  const runners = await say('runner')
  for (const who of ['personal', 'limited', 'github'] as const) assert.equal(await edit(who, runners), 200, who)
  assert.equal(await reads(runners), 'By github')
  assert.equal(await edit('ownerTool', await say('owner')), 200)

  // The agent's own comment is still somebody else's to every other token.
  const agents = await say('agent')
  assert.equal(await edit('personal', agents), 403)
  assert.equal(await edit('ownerTool', agents), 403)

  /* Taking somebody else's back, signed in, takes it: the row policy let
     only the author update a comment, so this answered 200 and left it. */
  assert.equal((await call(`/api/comments/${agents}`, as.runner, 'DELETE')).status, 200)
  assert.equal(await reads(agents), undefined)
  assert.equal((await call(`/api/comments/${theirs}`, as.owner, 'DELETE')).status, 200)
  assert.equal(await reads(theirs), undefined)
})

/* ------------------------------------------------ the review of */

const plain = (body: any) => body?.content?.[0]?.content?.[0]?.text as string | undefined

/** The comment as the table holds it, past every policy. */
async function stored(id: string) {
  const [row] = await asTableOwner()<{ body: any; deleted_at: string | null }[]>`
    select body, deleted_at from comment where id = ${id}`
  return { text: plain(row?.body), deleted: row?.deleted_at !== null }
}

test('a comment on a file sent in a room with chosen people is not read, changed or taken back from outside the room', async () => {
  const { ctx, workspaceId, token: owner } = await makeOwner()
  const p = await makeProject(ctx, workspaceId, 'Acme')
  const runner = await addManager(ctx, workspaceId, [p])
  // A member who may make channels, in a room of their own on the project.
  const sam = await addPerson(ctx, workspaceId, 'member', [p], ['task.create', 'channel.create'])
  const samToken = await bearerFor(sam.actorId, workspaceId)
  const runnerToken = await bearerFor(runner.actorId, workspaceId)
  const room = await call(`/api/projects/${p}/conversations`, samToken, 'POST', { name: 'mine', member_ids: [sam.actorId] })
  assert.equal(room.status, 201, JSON.stringify(room.body))
  const fileId = uuidv7()
  await withActor(sam.actorId, async (tx) => {
    await tx`
      insert into file (id, workspace_id, project_id, conversation_id, author_id, name, storage_key, size_bytes, uploaded_at)
      values (${fileId}, ${workspaceId}, ${p}, ${room.body.id}, ${sam.actorId}, 'plan.pdf', ${`k/${fileId}`}, 10, now())`
  })
  const said = await call(`/api/files/${fileId}/comments`, samToken, 'POST', { body: doc('Only for me') })
  assert.equal(said.status, 201, JSON.stringify(said.body))
  const cid = said.body.id as string

  for (const [who, token] of [
    ['runner', runnerToken],
    ['owner', owner],
  ] as const) {
    assert.equal((await call(`/api/files/${fileId}`, token)).status, 404, `${who} reads the file`)
    assert.equal((await call(`/api/comments/${cid}`, token, 'PATCH', { body: EMPTY })).status, 404, `${who} empties it`)
    assert.equal((await call(`/api/comments/${cid}`, token, 'DELETE')).status, 404, `${who} deletes it`)
    assert.equal((await call(`/api/comments/${cid}/resolved`, token, 'PUT', { resolved: true })).status, 404, `${who} resolves it`)
  }
  assert.deepEqual(await stored(cid), { text: 'Only for me', deleted: false })

  // Nor is it read, under the comment's own policy.
  const seen = async (actorId: string) =>
    inWorkspace(actorId, workspaceId, (tx) => tx`select id from comment where id = ${cid}`).then((r) => r.length)
  assert.equal(await seen(runner.actorId), 0)
  assert.equal(await seen(ctx.actorId), 0)
  assert.equal(await seen(sam.actorId), 1)

  // Its author, in the room, still may.
  assert.equal((await call(`/api/comments/${cid}`, samToken, 'PATCH', { body: doc('Better') })).status, 200)
  assert.equal((await stored(cid)).text, 'Better')
})

test('an import, a token deleting, a plain member and a token held to another project — none changes somebody else’s comment', async () => {
  const { ctx, workspaceId } = await makeOwner()
  const a = await makeProject(ctx, workspaceId, 'Acme')
  const b = await makeProject(ctx, workspaceId, 'Beta')
  const t = await makeTask(ctx.actorId, workspaceId, a, 'Ship it')
  const writer = await addPerson(ctx, workspaceId, 'member', [a])
  const member = await addPerson(ctx, workspaceId, 'member', [a])
  const runner = await addManager(ctx, workspaceId, [a, b])
  const writerToken = await bearerFor(writer.actorId, workspaceId)
  const memberToken = await bearerFor(member.actorId, workspaceId)
  const runnerToken = await bearerFor(runner.actorId, workspaceId)
  const importing = await issueAccessToken({ sub: runner.actorId, workspace_id: workspaceId, via: 'import', imp: uuidv7() })
  const personal = await issueApiToken(runner.actorId, workspaceId, 'tool')
  const elsewhere = await issueApiToken(runner.actorId, workspaceId, 'For Beta', [b])

  const say = async (token: string, text: string) => {
    const r = await call(`/api/tasks/${t}/comments`, token, 'POST', { body: doc(text) })
    assert.equal(r.status, 201, JSON.stringify(r.body))
    return r.body.id as string
  }
  const theirs = await say(writerToken, 'Notes')
  const patch = async (token: string, id: string) => (await call(`/api/comments/${id}`, token, 'PATCH', { body: EMPTY })).status
  const del = async (token: string, id: string) => (await call(`/api/comments/${id}`, token, 'DELETE')).status

  // An import acting as whoever runs the project: neither changed nor taken back.
  assert.equal(await patch(importing, theirs), 403)
  assert.equal(await del(importing, theirs), 403)
  // A token deleting somebody else's.
  assert.equal(await del(personal, theirs), 403)
  // A plain member, signed in, without the right.
  assert.equal(await patch(memberToken, theirs), 403)
  assert.equal(await del(memberToken, theirs), 403)
  // A token held to another project does not see this one at all.
  assert.equal(await patch(elsewhere, theirs), 404)
  assert.equal(await del(elsewhere, theirs), 404)
  assert.deepEqual(await stored(theirs), { text: 'Notes', deleted: false })

  // The runner's own, through the token held elsewhere: still not here.
  const runners = await say(runnerToken, 'Mine')
  assert.equal(await patch(elsewhere, runners), 404)
  // And an import may change its own person's.
  assert.equal(await patch(importing, runners), 200)
})

test('an owner whose address is unproved is a member here too: somebody else’s comment is not theirs to change', async () => {
  const { ctx, workspaceId, token: owner } = await makeOwner()
  const p = await makeProject(ctx, workspaceId, 'Acme')
  const t = await makeTask(ctx.actorId, workspaceId, p, 'Ship it')
  const writer = await addPerson(ctx, workspaceId, 'member', [p])
  const made = await call(`/api/tasks/${t}/comments`, await bearerFor(writer.actorId, workspaceId), 'POST', { body: doc('Notes') })
  const cid = made.body.id as string
  const proved = await inWorkspace(ctx.actorId, workspaceId, (tx) => tx`select may_edit_said(${p}) as ok`)
  assert.equal(proved[0]?.ok, true)

  await asTableOwner()`update app_user set email_verified_at = null where actor_id = ${ctx.actorId}`
  try {
    const unproved = await inWorkspace(ctx.actorId, workspaceId, (tx) => tx`select may_edit_said(${p}) as ok`)
    assert.equal(unproved[0]?.ok, false, 'the row policy counts them a member')
    assert.equal((await call(`/api/comments/${cid}`, owner, 'PATCH', { body: EMPTY })).status, 403)
    assert.equal((await stored(cid)).text, 'Notes')
  } finally {
    await asTableOwner()`update app_user set email_verified_at = now() where actor_id = ${ctx.actorId}`
  }
})

test('a comment keeps its author, its place and its time, whoever may change its words', async () => {
  const { ctx, workspaceId } = await makeOwner()
  const p = await makeProject(ctx, workspaceId, 'Acme')
  const t = await makeTask(ctx.actorId, workspaceId, p, 'Ship it')
  const other = await makeTask(ctx.actorId, workspaceId, p, 'Elsewhere')
  const writer = await addPerson(ctx, workspaceId, 'member', [p])
  const made = await call(`/api/tasks/${t}/comments`, await bearerFor(writer.actorId, workspaceId), 'POST', { body: doc('Notes') })
  const cid = made.body.id as string

  const tries: Record<string, (tx: any) => Promise<unknown>> = {
    author: (tx) => tx`update comment set author_id = ${ctx.actorId} where id = ${cid}`,
    object: (tx) => tx`update comment set object_id = ${other} where id = ${cid}`,
    kind: (tx) => tx`update comment set object_type = 'post' where id = ${cid}`,
    project: (tx) => tx`update comment set project_id = null where id = ${cid}`,
    time: (tx) => tx`update comment set created_at = now() - interval '1 year' where id = ${cid}`,
  }
  for (const [what, change] of Object.entries(tries)) {
    // The owner, who may change its words, and its own author.
    await assert.rejects(inWorkspace(ctx.actorId, workspaceId, change), /keeps its author/, `the owner moves its ${what}`)
    await assert.rejects(inWorkspace(writer.actorId, workspaceId, change), /keeps its author/, `its author moves its ${what}`)
  }
  // Its words still change.
  await inWorkspace(ctx.actorId, workspaceId, (tx) => tx`update comment set body = ${tx.json(doc('Fixed') as never)} where id = ${cid}`)
  assert.equal((await stored(cid)).text, 'Fixed')
})
