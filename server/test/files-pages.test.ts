import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { app } from '../src/http/routes.js'
import { closeRealtime } from '../src/realtime.js'
import { addPerson, asTableOwner, bearerFor, closeDb, makeOwner, makeProject, stamp, uuidv7 } from './helpers.js'

/* A project's Files read in pages. */
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

type Row = { id: string; name: string; kind: string; pinned_at: string | null; thumb_url: string | null; preview?: any }

async function world() {
  const { ctx, workspaceId, token: owner } = await makeOwner()
  const p = await makeProject(ctx, workspaceId, `Pages ${stamp()}`)
  const writer = await addPerson(ctx, workspaceId, 'member', [p])
  const as = { owner, writer: await bearerFor(writer.actorId, workspaceId) }
  const make = async (who: keyof typeof as, what: Record<string, unknown>) => {
    const r = await call(`/api/projects/${p}/files`, as[who], 'POST', what)
    assert.equal(r.status, 201, JSON.stringify(r.body))
    return r.body.id as string
  }
  /* Every page, walked by its cursor. */
  const walk = async (who: keyof typeof as, query: string) => {
    const seen: Row[] = []
    let cursor: string | null = null
    let pages = 0
    do {
      const r: { status: number; body: Record<string, any> } = await call(
        `/api/projects/${p}/files?${query}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
        as[who],
      )
      assert.equal(r.status, 200, JSON.stringify(r.body))
      if (pages === 0) assert.ok(Array.isArray(r.body.kinds), 'a first page says which kinds hold anything')
      else assert.equal(r.body.kinds, undefined, 'only the first page says')
      seen.push(...(r.body.files as Row[]))
      cursor = r.body.next_cursor
      pages++
    } while (cursor && pages < 100)
    return { seen, pages }
  }
  return { p, as, make, walk, workspaceId, writerId: writer.actorId, ownerId: ctx.actorId }
}

test('pages walk every row once, pinned first, rows of one moment included', async () => {
  const { p, as, make, walk, workspaceId, ownerId } = await world()
  const made: string[] = []
  for (let i = 0; i < 5; i++) made.push(await make('owner', { name: `Doc ${i}`, body: doc(`d${i}`) }))
  /* Seven written in one statement: one `now()`, so only the id orders them. */
  const together = Array.from({ length: 7 }, () => uuidv7())
  await asTableOwner()`
    insert into file (id, workspace_id, project_id, author_id, name, body)
    select x, ${workspaceId}, ${p}, ${ownerId}, 'Together', '{"type":"doc","content":[]}'::jsonb
    from unnest(${together}::uuid[]) x`
  /* Two pinned, at one moment too. */
  await asTableOwner()`update file set pinned_at = now() where id in (${made[1]!}, ${made[3]!})`

  const { seen, pages } = await walk('owner', 'limit=2')
  assert.equal(pages, 6)
  const ids = seen.map((r) => r.id)
  assert.equal(new Set(ids).size, ids.length, 'nothing twice')
  assert.equal(ids.length, 12, 'nothing skipped')
  assert.deepEqual(new Set(ids.slice(0, 2)), new Set([made[1], made[3]]), 'pinned first')
  assert.ok(ids.slice(2).every((id) => id !== made[1] && id !== made[3]))
  /* The same rows as one page of all of them, in the same order. */
  const one = await call(`/api/projects/${p}/files?limit=500`, as.owner)
  assert.deepEqual(
    (one.body.files as Row[]).map((r) => r.id),
    ids,
  )
  assert.equal(one.body.next_cursor, null)

  /* A row changed between pages moves to the head and is not read twice. */
  const first = await call(`/api/projects/${p}/files?limit=4`, as.owner)
  const later = (first.body.files as Row[]).map((r) => r.id)
  const moved = ids[ids.length - 1]!
  await asTableOwner()`update file set name = 'Moved' where id = ${moved}`
  let cursor = first.body.next_cursor as string | null
  while (cursor) {
    const r = await call(`/api/projects/${p}/files?limit=4&cursor=${encodeURIComponent(cursor)}`, as.owner)
    later.push(...(r.body.files as Row[]).map((x) => x.id))
    cursor = r.body.next_cursor
  }
  assert.equal(new Set(later).size, later.length)
})

test('asked with neither limit nor cursor, every row, as the installed apps read it', async () => {
  const { p, as, make } = await world()
  const a = await make('owner', { name: 'First', body: doc('a') })
  const b = await make('owner', { name: 'Second', url: 'https://example.com/b' })
  const c = await make('owner', { name: 'Third', body: doc('c') })
  /* Changing the first keeps it last here: the newest added leads. */
  assert.equal((await call(`/api/files/${a}`, as.owner, 'PATCH', { name: 'First again' })).status, 200)
  const r = await call(`/api/projects/${p}/files`, as.owner)
  assert.equal(r.status, 200)
  assert.deepEqual(
    (r.body.files as Row[]).map((x) => x.id),
    [c, b, a],
  )
  assert.equal(r.body.next_cursor, null)
  assert.equal(r.body.kinds, undefined)
  /* A page is in the order things last changed. */
  const page = await call(`/api/projects/${p}/files?limit=100`, as.owner)
  assert.deepEqual(
    (page.body.files as Row[]).map((x) => x.id),
    [a, c, b],
  )
})

test('kind, whose and words narrow the rows the cursor walks', async () => {
  const { p, as, make, walk, workspaceId, ownerId } = await world()
  const mine = await make('owner', { name: 'Gazebo plans', body: doc('x') })
  const theirs = await make('writer', { name: 'Shed plans', body: doc('y') })
  const link = await make('writer', { name: 'Pagoda', url: 'https://example.com/pagoda' })
  const picture = uuidv7()
  const upload = uuidv7()
  await asTableOwner()`
    insert into file (id, workspace_id, project_id, author_id, name, storage_key, content_type, size_bytes, uploaded_at)
    values (${picture}, ${workspaceId}, ${p}, ${ownerId}, 'shot.png', ${`${workspaceId}/pages-${picture}`}, 'image/png', 10, now()),
           (${upload}, ${workspaceId}, ${p}, ${ownerId}, 'notes.pdf', ${`${workspaceId}/pages-${upload}`}, 'application/pdf', 10, now())`
  for (let i = 0; i < 4; i++) await make('owner', { name: `Filler ${i}`, url: `https://example.com/${i}` })

  const ids = async (query: string) => (await walk('owner', query)).seen.map((r) => r.id)
  assert.deepEqual(new Set(await ids('limit=1&kind=docs')), new Set([mine, theirs]))
  assert.deepEqual(await ids('limit=1&kind=images'), [picture])
  assert.deepEqual(await ids('limit=1&kind=uploads'), [upload])
  assert.equal((await ids('limit=2&kind=links')).length, 5)
  assert.deepEqual(await ids('limit=1&kind=docs&whose=mine'), [mine])
  assert.deepEqual(await ids('limit=1&kind=docs&whose=others'), [theirs])
  assert.deepEqual(await ids('limit=1&kind=links&whose=others'), [link])
  /* Words: the name, a link's address, and who put it there. */
  assert.deepEqual(await ids('limit=1&q=gazebo'), [mine])
  assert.deepEqual(await ids('limit=1&q=example.com%2Fpagoda'), [link])
  const writerName = (
    await asTableOwner()<{ name: string }[]>`select a.name from actor a join file f on f.author_id = a.id where f.id = ${theirs}`
  )[0]!.name
  assert.deepEqual(new Set(await ids(`limit=1&kind=docs&q=${encodeURIComponent(writerName)}`)), new Set([theirs]))
  /* A % is a percent sign, not a wildcard. */
  assert.deepEqual(await ids('limit=5&q=%25'), [])

  /* Which kinds hold anything, whoever's. */
  const first = await call(`/api/projects/${p}/files?limit=1&kind=links&whose=mine`, as.writer)
  assert.deepEqual(first.body.kinds, ['docs', 'images', 'uploads', 'links'])
  /* Without `limit` the filters still apply. */
  const all = await call(`/api/projects/${p}/files?kind=images`, as.owner)
  assert.deepEqual(
    (all.body.files as Row[]).map((r) => r.id),
    [picture],
  )
  assert.ok((all.body.files as Row[])[0]!.thumb_url, 'its picture signed')
})

test('a page lists only what the reader may read, and refuses what it cannot read', async () => {
  const { p, as, make } = await world()
  const draft = await make('owner', { name: 'Draft', body: doc('d'), audience: 'author' })
  const shared = await make('owner', { name: 'Shared', body: doc('s') })
  const page = await call(`/api/projects/${p}/files?limit=100`, as.writer)
  const ids = (page.body.files as Row[]).map((r) => r.id)
  assert.ok(ids.includes(shared))
  assert.ok(!ids.includes(draft), 'a draft is its author’s alone')
  assert.deepEqual(page.body.kinds, ['docs'])

  assert.equal((await call(`/api/projects/${p}/files?limit=10&cursor=nonsense`, as.owner)).status, 400)
  assert.equal((await call(`/api/projects/${p}/files?limit=10&kind=folders`, as.owner)).status, 400)
  assert.equal((await call(`/api/projects/${p}/files?limit=10&whose=everybody`, as.owner)).status, 400)
  /* A project somebody is not on answers nothing, as before. */
  const other = await makeOwner()
  const theirs = await call(`/api/projects/${p}/files?limit=10`, other.token)
  assert.deepEqual(theirs.body.files ?? [], [])
})

test('a pinned document’s page carries its first picture, signed for the reader', async () => {
  const { p, as, make, workspaceId, ownerId } = await world()
  const picture = uuidv7()
  await asTableOwner()`
    insert into file (id, workspace_id, project_id, author_id, name, storage_key, content_type, size_bytes, uploaded_at)
    values (${picture}, ${workspaceId}, ${p}, ${ownerId}, 'cover.png', ${`${workspaceId}/pages-${picture}`}, 'image/png', 10, now())`
  const plan = await make('owner', { name: 'Plan', body: doc('What we ship') })
  await asTableOwner()`
    update file set body = ${asTableOwner().json({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'What we ship' }] },
        { type: 'attachment', attrs: { fileId: picture, kind: 'image', name: 'cover.png' } },
      ],
    })}, pinned_at = now() where id = ${plan}`
  /* Docs alone: the picture is not among the page's rows. */
  const page = await call(`/api/projects/${p}/files?limit=100&kind=docs`, as.writer)
  const row = (page.body.files as Row[]).find((r) => r.id === plan)!
  assert.equal(row.preview.picture, picture)
  assert.match(String(row.preview.picture_url), /pages-/)
  /* Gone, it has no link. */
  await asTableOwner()`update file set deleted_at = now() where id = ${picture}`
  const again = await call(`/api/projects/${p}/files?limit=100&kind=docs`, as.writer)
  assert.equal((again.body.files as Row[]).find((r) => r.id === plan)!.preview.picture_url, null)
})
