import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { app } from '../src/http/routes.js'
import { closeRealtime } from '../src/realtime.js'
import { issueApiToken } from '../src/auth/flows.js'
import { addManager, addPerson, bearerFor, closeDb, makeOwner, makeProject } from './helpers.js'

after(async () => {
  await closeRealtime()
  await closeDb()
})

/*
 * Who may change an announcement.
 * The same people who may take one away: its author, the owner and whoever
 * runs the project, not every member the workspace's edit switch (on by
 * default) lets touch others' documents. Somebody else's is never changed
 * through a token. Emptying one was deleting it by another door.
 */
const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
const EMPTY = { type: 'doc', content: [] }

async function call(path: string, token: string, method = 'GET', body?: unknown) {
  const r = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, any> }
}

test('an announcement is changed by its author, the owner or whoever runs the project — not by any member, nor somebody else’s through a token', async () => {
  const { ctx, workspaceId, token: owner } = await makeOwner()
  const p = await makeProject(ctx, workspaceId, 'Acme')
  const writer = await addPerson(ctx, workspaceId, 'member', [p])
  const member = await addPerson(ctx, workspaceId, 'member', [p])
  const runner = await addManager(ctx, workspaceId, [p])
  const stranger = await addPerson(ctx, workspaceId, 'member', [])
  const made = await call('/api/agents', owner, 'POST', { name: 'Helper', project_ids: [p], reach: 'mcp' })
  assert.equal(made.status, 201, JSON.stringify(made.body))
  const as = {
    owner,
    writer: await bearerFor(writer.actorId, workspaceId),
    member: await bearerFor(member.actorId, workspaceId),
    runner: await bearerFor(runner.actorId, workspaceId),
    stranger: await bearerFor(stranger.actorId, workspaceId),
    agent: made.body.token as string,
    /* Whoever runs the project, through a tool of theirs. */
    runnerTool: await issueApiToken(runner.actorId, workspaceId, 'tool'),
  }
  const post = async (who: keyof typeof as) => {
    const r = await call(`/api/projects/${p}/posts`, as[who], 'POST', { title: `Week ${Date.now()}`, body: doc('Notes') })
    assert.equal(r.status, 201, `${who} posts: ${JSON.stringify(r.body)}`)
    return r.body.id as string
  }
  const edit = async (who: keyof typeof as, id: string, change: unknown = { title: `By ${who}` }) =>
    (await call(`/api/posts/${id}`, as[who], 'PATCH', change)).status

  // The writer's own announcement, the one everybody else reaches for.
  const theirs = await post('writer')

  /* A plain member, with the default switch that lets them edit others'
     documents: not this — neither its title nor emptying it. And it is
     left as it was. */
  assert.equal(await edit('member', theirs), 403)
  assert.equal(await edit('member', theirs, { body: EMPTY }), 403)
  const kept = await call(`/api/posts/${theirs}`, as.writer)
  assert.equal(kept.body.post.body.content[0].content[0].text, 'Notes')
  assert.match(kept.body.post.title, /^Week /)

  // Somebody off the project is not told it is there.
  assert.equal(await edit('stranger', theirs), 404)

  // An agent on the project, through its token: somebody else's is not its to change.
  assert.equal(await edit('agent', theirs), 403)
  assert.equal(await edit('agent', theirs, { body: EMPTY }), 403)

  // Whoever runs the project may — but not through a tool acting for them.
  assert.equal(await edit('runner', theirs), 200)
  assert.equal(await edit('runnerTool', theirs), 403)

  // The owner may.
  assert.equal(await edit('owner', theirs), 200)
  assert.equal((await call(`/api/posts/${theirs}`, as.writer)).body.post.title, 'By owner')

  // And everybody may change their own, the agent through its token included.
  assert.equal(await edit('writer', theirs), 200)
  assert.equal(await edit('member', await post('member')), 200)
  assert.equal(await edit('agent', await post('agent')), 200)
  assert.equal(await edit('runner', await post('runner')), 200)
  assert.equal(await edit('owner', await post('owner')), 200)

  // Their own announcements are still not anybody else's: the member's, edited by the agent.
  const members = await post('member')
  assert.equal(await edit('agent', members), 403)
  assert.equal(await edit('writer', members), 403)
})

test('somebody holding `edit.any` on the project may change somebody else’s announcement — signed in, not through a token', async () => {
  const { ctx, workspaceId, token: owner } = await makeOwner()
  const p = await makeProject(ctx, workspaceId, 'Acme')
  const writer = await addPerson(ctx, workspaceId, 'member', [p])
  const editor = await addPerson(ctx, workspaceId, 'member', [p], ['task.create', 'edit.any'])
  const editorToken = await bearerFor(editor.actorId, workspaceId)
  const writerToken = await bearerFor(writer.actorId, workspaceId)

  const r = await call(`/api/projects/${p}/posts`, writerToken, 'POST', { title: 'Week 1', body: doc('Notes') })
  assert.equal(r.status, 201, JSON.stringify(r.body))
  const id = r.body.id as string

  assert.equal((await call(`/api/posts/${id}`, editorToken, 'PATCH', { title: 'Week one' })).status, 200)
  assert.equal((await call(`/api/posts/${id}`, editorToken, 'PATCH', { body: doc('Better notes') })).status, 200)
  const read = await call(`/api/posts/${id}`, owner)
  assert.equal(read.body.post.title, 'Week one')
  assert.equal(read.body.post.body.content[0].content[0].text, 'Better notes')

  // Through a tool of theirs, still not.
  const tool = await issueApiToken(editor.actorId, workspaceId, 'tool')
  assert.equal((await call(`/api/posts/${id}`, tool, 'PATCH', { title: 'By a tool' })).status, 403)
  assert.equal((await call(`/api/posts/${id}`, owner)).body.post.title, 'Week one')
})
