import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { app } from '../src/http/routes.js'
import { closeDb, withActor, uuidv7, makeOwner, makeProject, addPerson, bearerFor } from './helpers.js'

after(closeDb)

type Picture = { file_id: string; thumb_url: string; width: number | null; height: number | null }
type Page = { tasks: { id: string; title: string; picture?: Picture }[]; next_cursor: string | null }

async function read(token: string, path: string): Promise<Page> {
  const r = await app.request(`/api${path}`, { headers: { authorization: `Bearer ${token}` } })
  assert.equal(r.status, 200, `${path} answered ${r.status}`)
  return (await r.json()) as Page
}

/** Every page of an order, followed by its cursor to the end. */
async function walk(token: string, path: string): Promise<string[]> {
  const seen: string[] = []
  let cursor: string | null = null
  for (let i = 0; i < 20; i++) {
    const page: Page = await read(token, `${path}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`)
    seen.push(...page.tasks.map((t) => t.title))
    cursor = page.next_cursor
    if (!cursor) break
  }
  return seen
}

/**
 * Newest first, and paged without losing or repeating a row — even two made
 * in the same instant, which stand by their ids.
 */
test('tasks ordered by when they were made come newest first, a page at a time', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const project = await makeProject(ctx, workspaceId, 'Ordered')
  /* Ids made in order, so the two twins are told apart by them. Written with
     their own times, out of the order they were put in. */
  const made = [
    { title: 'Monday', at: '2026-11-02 09:00:00.000001+00' },
    { title: 'Friday', at: '2026-11-06 09:00:00+00' },
    { title: 'Twin one', at: '2026-11-04 09:00:00.123456+00' },
    { title: 'Twin two', at: '2026-11-04 09:00:00.123456+00' },
    { title: 'Tuesday', at: '2026-11-03 09:00:00+00' },
  ]
  await withActor(ctx.actorId, async (tx) => {
    for (const [i, m] of made.entries()) {
      await tx`
        insert into task (id, workspace_id, project_id, author_id, title, sort_key, created_at)
        values (${uuidv7()}, ${workspaceId}, ${project}, ${ctx.actorId}, ${m.title}, ${`a${i}`}, ${m.at}::timestamptz)`
    }
  })
  const newest = ['Friday', 'Twin two', 'Twin one', 'Tuesday', 'Monday']
  assert.deepEqual(await walk(token, `/projects/${project}/tasks?order=created&limit=2`), newest)
  assert.deepEqual(await walk(token, `/projects/${project}/tasks?order=created&dir=asc&limit=2`), [...newest].reverse())
  // A page boundary between the twins, which share a time to the microsecond.
  assert.deepEqual(await walk(token, `/projects/${project}/tasks?order=created&limit=1`), newest)

  // Absent, it is the order they were put in, as every client already reads.
  assert.deepEqual(
    await walk(token, `/projects/${project}/tasks?limit=2`),
    made.map((m) => m.title),
  )

  // A cursor that is not one is refused, not cast into a server error.
  const bad = await app.request(`/api/projects/${project}/tasks?order=created&cursor=yesterday|nobody`, {
    headers: { authorization: `Bearer ${token}` },
  })
  assert.equal(bad.status, 400)
})

/**
 * A card's picture: the first in the description, else the first in the
 * comments; only a file that is a picture; and only one the reader may open.
 */
test('a task answers its first picture only when asked, and only one its reader may open', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const project = await makeProject(ctx, workspaceId, 'Pictured')
  const elsewhere = await makeProject(ctx, workspaceId, 'Somebody else’s')
  const member = await addPerson(ctx, workspaceId, 'member', [project])
  const memberToken = await bearerFor(member.actorId, workspaceId)

  const [shown, copied, pdf, hidden, inComment, notUsed] = [uuidv7(), uuidv7(), uuidv7(), uuidv7(), uuidv7(), uuidv7()]
  const [first, fromComments, onlyHidden, bare] = [uuidv7(), uuidv7(), uuidv7(), uuidv7()]
  const node = (fileId: string, extra: Record<string, unknown> = {}) => ({
    type: 'attachment',
    attrs: { fileId, name: 'p.png', kind: 'image', ...extra },
  })
  await withActor(ctx.actorId, async (tx) => {
    const file = (id: string, p: string, type: string, more: { display?: string; w?: number; h?: number } = {}) => tx`
      insert into file (id, workspace_id, project_id, author_id, name, storage_key, display_key, content_type,
                        size_bytes, uploaded_at, pixel_width, pixel_height)
      values (${id}, ${workspaceId}, ${p}, ${ctx.actorId}, 'p.png', ${`${workspaceId}/${id}`},
              ${more.display ?? null}, ${type}, 1, now(), ${more.w ?? null}, ${more.h ?? null})`
    await file(shown, project, 'image/png', { w: 1200, h: 800 })
    await file(copied, project, 'image/jpeg', { display: `${workspaceId}/${copied}-display` })
    await file(pdf, project, 'application/pdf')
    await file(hidden, elsewhere, 'image/png', { w: 10, h: 10 })
    await file(inComment, project, 'image/webp')
    await file(notUsed, project, 'image/png')
    const task = (id: string, title: string, key: string, content: unknown[]) => tx`
      insert into task (id, workspace_id, project_id, author_id, title, sort_key, body)
      values (${id}, ${workspaceId}, ${project}, ${ctx.actorId}, ${title}, ${key},
              ${tx.json({ type: 'doc', content } as never)})`
    /* A PDF marked as a picture first, then two pictures: the PDF is
       skipped and the first picture is the card's, inside a paragraph. */
    await task(first, 'First', 'a0', [
      node(pdf),
      { type: 'paragraph', content: [{ type: 'text', text: 'see' }, node(shown, { pixelWidth: 1, pixelHeight: 1 })] },
      node(copied),
    ])
    /* No picture in the description; two comments, the older one's wins. */
    await task(fromComments, 'From comments', 'a1', [{ type: 'paragraph', content: [{ type: 'text', text: 'none here' }] }])
    for (const [i, f] of [inComment, notUsed].entries()) {
      await tx`
        insert into comment (id, workspace_id, project_id, object_type, object_id, author_id, body, created_at)
        values (${uuidv7()}, ${workspaceId}, ${project}, 'task', ${fromComments}, ${ctx.actorId},
                ${tx.json({ type: 'doc', content: [node(f, { pixelWidth: 640, pixelHeight: 480 })] } as never)},
                now() - ${`${10 - i} minutes`}::interval)`
    }
    /* A picture from a project the member is not on, then one they can open. */
    await task(onlyHidden, 'Hidden first', 'a2', [node(hidden), node(copied)])
    await task(bare, 'Bare', 'a3', [])
  })

  // Not asked, not there: a client that draws no picture pays for none.
  const plain = await read(token, `/projects/${project}/tasks`)
  assert.ok(plain.tasks.every((t) => !('picture' in t)))

  const owner = new Map((await read(token, `/projects/${project}/tasks?pictures=1`)).tasks.map((t) => [t.title, t.picture]))
  // The file's own size wins over the one written on the node.
  assert.equal(owner.get('First')?.file_id, shown)
  assert.equal(owner.get('First')?.width, 1200)
  assert.equal(owner.get('First')?.height, 800)
  // Signed for this reader, through the blob route; the key itself does not leave.
  assert.match(owner.get('First')?.thumb_url ?? '', /^\/api\/blob\/.+\?for=me&token=\d+\.[0-9a-f]+$/)
  // From the comments, the oldest first, sized from the node.
  assert.equal(owner.get('From comments')?.file_id, inComment)
  assert.equal(owner.get('From comments')?.width, 640)
  // The owner may open the other project's file, so it is theirs to see.
  assert.equal(owner.get('Hidden first')?.file_id, hidden)
  assert.equal(owner.get('Bare'), undefined)

  // The member is not on that project: the picture is not there for them,
  // and the next one is — the copy for showing, with no size known.
  const theirs = new Map((await read(memberToken, `/projects/${project}/tasks?pictures=1`)).tasks.map((t) => [t.title, t.picture]))
  assert.equal(theirs.get('Hidden first')?.file_id, copied)
  assert.equal(theirs.get('Hidden first')?.width, null)
  assert.equal(theirs.get('Hidden first')?.height, null)
  assert.ok(!JSON.stringify([...theirs.values()]).includes(hidden))
  // Signed over the copy for showing, not the original.
  const copyLink = theirs.get('Hidden first')?.thumb_url ?? ''
  assert.ok(copyLink.includes(encodeURIComponent(`${copied}-display`)) || copyLink.includes(`${copied}-display`))
})
