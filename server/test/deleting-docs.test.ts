import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { app } from '../src/http/routes.js'
import { closeRealtime } from '../src/realtime.js'
import { issueApiToken } from '../src/auth/flows.js'
import { v7 as uuidv7 } from 'uuid'
import { addManager, addPerson, asTableOwner, bearerFor, closeDb, makeOwner, makeProject, stamp } from './helpers.js'

/* Deleting what is in Docs, and Undo. */
after(async () => {
  await closeRealtime()
  await closeDb()
})

const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })

async function call(path: string, token: string, method = 'GET', body?: unknown) {
  const r = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, any> }
}

async function world() {
  const { ctx, workspaceId, token: owner } = await makeOwner()
  const p = await makeProject(ctx, workspaceId, 'Acme')
  const writer = await addPerson(ctx, workspaceId, 'member', [p])
  /* Holds what joining gives: making tasks and channels, nothing else. */
  const plain = await addPerson(ctx, workspaceId, 'member', [p])
  /* Holds nothing at all on the project. */
  const bare = await addPerson(ctx, workspaceId, 'member', [p], [])
  const deleter = await addPerson(ctx, workspaceId, 'member', [p], ['task.delete'])
  const editor = await addPerson(ctx, workspaceId, 'member', [p], ['edit.any'])
  const runner = await addManager(ctx, workspaceId, [p])
  const offProject = await addPerson(ctx, workspaceId, 'member', [])
  const other = await makeOwner()
  const as = {
    owner,
    writer: await bearerFor(writer.actorId, workspaceId),
    plain: await bearerFor(plain.actorId, workspaceId),
    bare: await bearerFor(bare.actorId, workspaceId),
    deleter: await bearerFor(deleter.actorId, workspaceId),
    editor: await bearerFor(editor.actorId, workspaceId),
    runner: await bearerFor(runner.actorId, workspaceId),
    offProject: await bearerFor(offProject.actorId, workspaceId),
    stranger: other.token,
    /* The writer's own token, and the owner's. */
    writerTool: await issueApiToken(writer.actorId, workspaceId, 'tool'),
    ownerTool: await issueApiToken(ctx.actorId, workspaceId, 'owner tool'),
  }
  const make = async (who: keyof typeof as, what: Record<string, unknown>) => {
    const r = await call(`/api/projects/${p}/files`, as[who], 'POST', what)
    assert.equal(r.status, 201, JSON.stringify(r.body))
    return r.body.id as string
  }
  return { p, as, make, workspaceId, writerId: writer.actorId }
}

test('your own goes on one press; somebody else’s needs the right that deletes others’ tasks', async () => {
  const { as, make } = await world()
  const theirs = () => make('writer', { name: `Notes ${stamp()}`, body: doc('Mine') })

  /* Not told it is there: off the project, or in another workspace. */
  const one = await theirs()
  assert.equal((await call(`/api/files/${one}`, as.offProject, 'DELETE')).status, 404)
  assert.equal((await call(`/api/files/${one}`, as.stranger, 'DELETE')).status, 404)
  /* On the project, without the right — editing others' documents, by the
     switch or by `edit.any`, is not deleting them. */
  for (const who of ['plain', 'bare', 'editor'] as const) {
    assert.equal((await call(`/api/files/${one}`, as[who], 'DELETE')).status, 403, who)
  }
  /* Never through a token, one's own included. */
  assert.equal((await call(`/api/files/${one}`, as.writerTool, 'DELETE')).status, 403)
  assert.equal((await call(`/api/files/${one}`, as.ownerTool, 'DELETE')).status, 403)
  assert.equal((await call(`/api/files/${one}`, as.writer)).status, 200, 'still there')

  /* Its author, holding nothing. */
  const bares = await make('bare', { name: 'Bare draft', body: doc('x') })
  assert.equal((await call(`/api/files/${bares}`, as.bare, 'DELETE')).status, 200)
  assert.equal((await call(`/api/files/${one}`, as.writer, 'DELETE')).status, 200)
  assert.equal((await call(`/api/files/${one}`, as.writer)).status, 404, 'gone for its author too')
  assert.equal((await call(`/api/files/${one}`, as.writer, 'DELETE')).status, 404, 'and not deleted twice')

  /* `task.delete`, `manage`, the owner. */
  for (const who of ['deleter', 'runner', 'owner'] as const) {
    assert.equal((await call(`/api/files/${await theirs()}`, as[who], 'DELETE')).status, 200, who)
  }

  /* An upload's row and a link are rows like a document. */
  const link = await make('writer', { name: 'Site', url: 'https://example.com' })
  assert.equal((await call(`/api/files/${link}`, as.plain, 'DELETE')).status, 403)
  assert.equal((await call(`/api/files/${link}`, as.deleter, 'DELETE')).status, 200)
})

test('deleted, it is gone from the list, search, the templates and the web — and Undo puts it all back', async () => {
  const { p, as, make } = await world()
  const word = `quokka${stamp()}`
  const id = await make('writer', { name: `Brief ${word}`, body: doc(`The ${word} brief.`) })
  const link = await make('writer', { name: 'Figma', url: 'https://figma.com/file/x' })
  assert.equal((await call(`/api/files/${id}/pin`, as.writer, 'PUT', { pinned: true })).status, 200)
  assert.equal((await call(`/api/files/${id}/template`, as.writer, 'PUT', { template: true })).status, 200)
  const shared = await call(`/api/files/${id}/public`, as.writer, 'PUT', { public: true })
  const token = shared.body.token as string
  assert.equal((await app.request(`/api/public/docs/${token}`)).status, 200)
  assert.equal((await call(`/api/files/${id}/comments`, as.plain, 'POST', { body: doc('Looks good') })).status, 201)

  const listed = async () => ((await call(`/api/projects/${p}/files`, as.plain)).body.files as { id: string }[]).map((f) => f.id)
  const found = async () => ((await call(`/api/search?q=${word}`, as.plain)).body.results as { id: string }[]).some((r) => r.id === id)
  const templated = async () => ((await call('/api/doc-templates', as.plain)).body.templates as { id: string }[]).some((t) => t.id === id)
  assert.ok((await listed()).includes(id))
  assert.ok(await found())
  assert.ok(await templated())

  assert.equal((await call(`/api/files/${id}`, as.writer, 'DELETE')).status, 200)
  assert.equal((await call(`/api/files/${link}`, as.writer, 'DELETE')).status, 200)
  assert.ok(!(await listed()).includes(id))
  assert.ok(!(await listed()).includes(link))
  assert.ok(!(await found()))
  assert.ok(!(await templated()))
  assert.equal((await call(`/api/projects/${p}/files`, as.plain, 'POST', { template: id })).status, 404)
  assert.equal((await app.request(`/api/public/docs/${token}`)).status, 404, 'the public link stops at once')
  assert.equal((await call(`/api/files/${id}/comments`, as.plain)).status, 404)

  /* The feed names it as it was. */
  const feed = (await call(`/api/activity?project=${p}&object=${id}`, as.owner)).body
  const line = (feed.events as { action: string; object_title?: string }[]).find((e) => e.action === 'file.delete')
  assert.equal(line?.object_title, `Brief ${word}`)

  /* Undo: not by somebody who could not have deleted it, nor a token. */
  assert.equal((await call(`/api/files/${id}/restore`, as.plain, 'POST')).status, 403)
  assert.equal((await call(`/api/files/${id}/restore`, as.writerTool, 'POST')).status, 403)
  assert.equal((await call(`/api/files/${id}/restore`, as.stranger, 'POST')).status, 404)
  assert.equal((await call(`/api/files/${id}/restore`, as.offProject, 'POST')).status, 404)

  assert.equal((await call(`/api/files/${id}/restore`, as.writer, 'POST')).status, 200)
  assert.equal((await call(`/api/files/${link}/restore`, as.deleter, 'POST')).status, 200)
  assert.equal((await call(`/api/files/${id}/restore`, as.writer, 'POST')).status, 404, 'a standing one is not restored')
  const back = (await call(`/api/projects/${p}/files`, as.plain)).body.files as { id: string; pinned_at: string | null }[]
  assert.ok(back.some((f) => f.id === link))
  assert.ok(back.find((f) => f.id === id)?.pinned_at, 'back pinned')
  assert.ok(await found())
  assert.ok(await templated())
  assert.equal((await app.request(`/api/public/docs/${token}`)).status, 200, 'the same link answers again')
  const read = await call(`/api/files/${id}`, as.plain)
  assert.equal(read.status, 200)
  assert.equal((read.body.comments as unknown[]).length, 1, 'its comments come back with it')
})

test('the project’s list of what one may do says whether somebody else’s may be deleted', async () => {
  const { p, as } = await world()
  const can = async (who: keyof typeof as) => {
    const projects = (await call('/api/projects', as[who])).body.projects as { id: string; can: string[] }[]
    return projects.find((x) => x.id === p)?.can ?? []
  }
  assert.ok((await can('deleter')).includes('file.delete'))
  assert.ok((await can('runner')).includes('file.delete'))
  assert.ok(!(await can('plain')).includes('file.delete'))
  assert.ok(!(await can('editor')).includes('file.delete'))
})

/* The clear-out, when it takes the row thirty days later, takes what hangs
   on it by type and id: its comments, who follows it, links to and from it
   — migration 262. Its bytes were already queued by migration 101. */
test('a file that goes for good takes its comments, followers and links with it', async () => {
  const { as, make } = await world()
  const id = await make('writer', { name: 'Old notes', body: doc('x') })
  assert.equal((await call(`/api/files/${id}/comments`, as.plain, 'POST', { body: doc('Seen') })).status, 201)
  const count = async () => {
    const [r] = await asTableOwner()<{ c: number; s: number }[]>`
      select (select count(*)::int from comment where object_type = 'file' and object_id = ${id}) as c,
             (select count(*)::int from subscription where object_type = 'file' and object_id = ${id}) as s`
    return r!
  }
  const before = await count()
  assert.ok(before.c > 0 && before.s > 0)
  assert.equal((await call(`/api/files/${id}`, as.writer, 'DELETE')).status, 200)
  assert.deepEqual(await count(), before, 'soft: nothing goes until the clear-out')
  await asTableOwner()`delete from file where id = ${id}`
  assert.deepEqual(await count(), { c: 0, s: 0 })
})

/* Somebody's own file taken down by somebody else stays down: Undo is the
   deleter's, or whoever may delete anybody's — not the author's for thirty
   days, which would bring back a link a manager took off the web. */
test('a delete is undone by whoever made it or may delete anybody’s, not by the author after somebody else', async () => {
  const { as, make } = await world()
  const id = await make('writer', { name: 'Leaked brief', body: doc('x') })
  const token = (await call(`/api/files/${id}/public`, as.writer, 'PUT', { public: true })).body.token as string
  assert.equal((await call(`/api/files/${id}`, as.runner, 'DELETE')).status, 200)
  assert.equal((await call(`/api/files/${id}/restore`, as.writer, 'POST')).status, 403, 'not its author')
  assert.equal((await app.request(`/api/public/docs/${token}`)).status, 404)
  assert.equal((await call(`/api/files/${id}/restore`, as.deleter, 'POST')).status, 200, 'whoever may delete anybody’s')

  /* Its author's own delete is theirs to undo, holding nothing. */
  const mine = await make('bare', { name: 'Own draft', body: doc('x') })
  assert.equal((await call(`/api/files/${mine}`, as.bare, 'DELETE')).status, 200)
  assert.equal((await call(`/api/files/${mine}/restore`, as.plain, 'POST')).status, 403)
  assert.equal((await call(`/api/files/${mine}/restore`, as.bare, 'POST')).status, 200)
})

/* A file sent in a channel of chosen people is theirs: the project's feed
   and its webhooks never named it arriving, and do not name it going. */
test('deleting a file from a room of chosen people says nothing to the project', async () => {
  const { p, as, workspaceId, writerId } = await world()
  const room = uuidv7()
  await asTableOwner()`
    insert into conversation (id, workspace_id, project_id, name, channel)
    values (${room}, ${workspaceId}, ${p}, 'layoffs', true)`
  await asTableOwner()`
    insert into conversation_member (id, workspace_id, conversation_id, actor_id, joined_at)
    values (${uuidv7()}, ${workspaceId}, ${room}, ${writerId}, now())`
  const [cv] = await asTableOwner()<{ chosen: boolean }[]>`select chosen from conversation where id = ${room}`
  assert.equal(cv!.chosen, true)
  const form = new FormData()
  form.append('file', new File([new Uint8Array([104, 105])], 'severance-list.txt', { type: 'text/plain' }))
  const sent = await app.request(`/api/conversations/${room}/uploads`, {
    method: 'POST',
    headers: { authorization: `Bearer ${as.writer}` },
    body: form,
  })
  assert.equal(sent.status, 201)
  const { id } = (await sent.json()) as { id: string }

  assert.equal((await call(`/api/files/${id}`, as.plain, 'DELETE')).status, 404, 'not seen outside the room')
  assert.equal((await call(`/api/files/${id}`, as.writer, 'DELETE')).status, 200)
  assert.equal((await call(`/api/files/${id}/restore`, as.writer, 'POST')).status, 200)
  /* No line, so nothing for the feed to show nor a webhook to be sent:
     both are written by the one call that was not made. */
  const lines = await asTableOwner()<{ action: string }[]>`select action from activity_event where object_id = ${id}`
  assert.deepEqual(
    lines.map((l) => l.action),
    [],
  )
})
