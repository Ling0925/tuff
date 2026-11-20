import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import * as Y from 'yjs'
import type { WSContext } from 'hono/ws'
import { closeDb, makeOwner, addPerson, makeProject, bearerFor, asTableOwner } from './helpers.js'
import { app } from '../src/http/routes.js'
import { closeRealtime } from '../src/realtime.js'
import { join, leave, heard } from '../src/coedit.js'
import { FRAGMENT, bodyOf, carryRich, markThread, stateFrom, stretchOf, threadsIn, toElement } from '../src/yjson.js'

/*
 * Comments on words in a document.
 * The anchor is a mark the server writes into the shared state; it rides
 * other people's edits, goes with the words it is on, and is a comment's
 * to make: whoever may comment may anchor, nobody else.
 */

after(async () => {
  await closeRealtime()
  await closeDb()
})

const para = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] })
const doc = (...lines: string[]) => ({ type: 'doc', content: lines.map(para) })
const said = (text: string) => ({ type: 'doc', content: [para(text)] })
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))
const b64 = (u: Uint8Array) => Buffer.from(u).toString('base64')

const call = (token: string) => (method: string, path: string, body?: unknown) =>
  app.request(path, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

async function tokenOf(actorId: string, workspaceId: string): Promise<string> {
  return bearerFor(actorId, workspaceId)
}

async function aDocument(token: string, projectId: string, ...lines: string[]): Promise<string> {
  const made = await call(token)('POST', `/api/projects/${projectId}/files`, { name: 'Brief', body: doc(...lines) })
  assert.equal(made.status, 201)
  return ((await made.json()) as { id: string }).id
}

async function stored(fileId: string): Promise<{ body: unknown; version: number }> {
  const [r] = await asTableOwner()<{ body: unknown; version: number }[]>`select body, version from file where id = ${fileId}`
  return r!
}

/** The state as the server keeps it, rows folded. */
async function stateOf(fileId: string): Promise<Y.Doc> {
  const rows = await asTableOwner()<{ bytes: Uint8Array }[]>`select bytes from file_yjs where file_id = ${fileId}`
  const d = new Y.Doc()
  Y.applyUpdate(d, Y.mergeUpdates(rows.map((r) => new Uint8Array(r.bytes))))
  return d
}

/** A text's words without its formatting. */
const plainOf = (t: Y.XmlText) => (t.toDelta() as { insert: unknown }[]).map((d) => (typeof d.insert === 'string' ? d.insert : '')).join('')

/** Two relative positions over `words` in the first paragraph that has them, as a page would take them. */
function positions(d: Y.Doc, words: string): { from: string; to: string } {
  for (const block of d.getXmlFragment(FRAGMENT).toArray()) {
    const t = (block as Y.XmlElement).get(0)
    if (!(t instanceof Y.XmlText)) continue
    const at = plainOf(t).indexOf(words)
    if (at < 0) continue
    return {
      from: b64(Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(t, at))),
      to: b64(Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(t, at + words.length))),
    }
  }
  throw new Error(`no "${words}"`)
}

/** The words a thread's mark covers in a body. */
function marked(body: unknown, id: string): string {
  let out = ''
  const walk = (n: { type?: string; text?: string; marks?: { type: string; attrs?: { ids?: string } }[]; content?: unknown[] }) => {
    if (n.type === 'text' && n.marks?.some((m) => m.type === 'comment' && (m.attrs?.ids ?? '').split(' ').includes(id))) out += n.text
    for (const k of n.content ?? []) walk(k as never)
  }
  walk(body as never)
  return out
}

/** A socket as the room sees one. */
function socket() {
  const said: { t: string; u?: string }[] = []
  const ws = { send: (f: string) => said.push(JSON.parse(f)), close: () => {}, readyState: 1 } as unknown as WSContext
  return { ws, said }
}

test('a comment on words marks them, keeps them as its quote, and moves no version', async () => {
  const { ctx: owner, workspaceId, token } = await makeOwner()
  const p = await makeProject(owner, workspaceId, 'Acme')
  const id = await aDocument(token, p, 'The launch is on Monday.', 'Nothing else.')
  const before = (await stored(id)).version

  // Opened once: the state exists, as it does for a page.
  const s = socket()
  const seat = await join(owner, id, s.ws)
  assert.ok(seat)
  const r = await call(token)('POST', `/api/files/${id}/comments`, {
    body: said('Is it Monday or Tuesday?'),
    anchor: positions(await stateOf(id), 'on Monday'),
  })
  assert.equal(r.status, 201)
  const made = (await r.json()) as { id: string; quote: string }
  assert.equal(made.quote, 'on Monday')

  const now = await stored(id)
  assert.equal(marked(now.body, made.id), 'on Monday')
  assert.equal(now.version, before)
  // The page in the document hears the mark as an update.
  await pause(200)
  assert.ok(s.said.some((m) => m.t === 'u'))

  // Read back with its quote and where it stands.
  const read = (await (await call(token)('GET', `/api/files/${id}`)).json()) as {
    comments: { id: string; quote: string | null; resolved_at: string | null; on_deleted_text?: boolean }[]
  }
  const c = read.comments.find((x) => x.id === made.id)!
  assert.equal(c.quote, 'on Monday')
  assert.equal(c.resolved_at, null)
  assert.equal(c.on_deleted_text, false)
  await leave(seat)
})

test('the mark rides other people’s typing and goes with the words it is on', async () => {
  const { ctx: owner, workspaceId, token } = await makeOwner()
  const p = await makeProject(owner, workspaceId, 'Acme')
  const id = await aDocument(token, p, 'Ship the new pricing page.')
  const s = socket()
  const seat = await join(owner, id, s.ws)
  assert.ok(seat)
  const anchor = positions(await stateOf(id), 'pricing page')

  // Somebody types before the words between the selection and the request.
  const page = new Y.Doc()
  Y.applyUpdate(page, Y.encodeStateAsUpdate(await stateOf(id)))
  const sent: Uint8Array[] = []
  page.on('update', (u: Uint8Array) => sent.push(u))
  const text = (page.getXmlFragment(FRAGMENT).get(0) as Y.XmlElement).get(0) as Y.XmlText
  text.insert(0, 'Please ')
  heard(seat, JSON.stringify({ t: 'u', u: b64(Y.mergeUpdates(sent)) }))
  await seat.queue

  const r = await call(token)('POST', `/api/files/${id}/comments`, { body: said('Which page?'), anchor })
  assert.equal(r.status, 201)
  const { id: thread } = (await r.json()) as { id: string }
  assert.equal(marked((await stored(id)).body, thread), 'pricing page')

  // Typed after it, and inside it: the edge is not the mark's, the inside is.
  const live = await stateOf(id)
  sent.length = 0
  Y.applyUpdate(page, Y.encodeStateAsUpdate(live, Y.encodeStateVector(page)))
  const t2 = (page.getXmlFragment(FRAGMENT).get(0) as Y.XmlElement).get(0) as Y.XmlText
  const at = plainOf(t2).indexOf('pricing page')
  // In the browser a keystroke inside takes the marks around it; here it says so.
  t2.insert(at + 'pricing'.length, ' new', { comment: { ids: thread } })
  heard(seat, JSON.stringify({ t: 'u', u: b64(Y.mergeUpdates(sent)) }))
  await seat.queue
  await leave(seat)
  assert.equal(marked((await stored(id)).body, thread), 'pricing new page')

  // The words deleted: the thread is on deleted text, and says what it was on.
  const r2 = await call(token)('PATCH', `/api/files/${id}`, { body: doc('Please ship the new one.') })
  assert.equal(r2.status, 200)
  const read = (await (await call(token)('GET', `/api/files/${id}`)).json()) as {
    comments: { id: string; quote: string; on_deleted_text?: boolean }[]
  }
  const c = read.comments.find((x) => x.id === thread)!
  assert.equal(c.on_deleted_text, true)
  assert.equal(c.quote, 'pricing page')
})

test('an agent anchors by the words, and a body sent back without the marks keeps them', async () => {
  const { ctx: owner, workspaceId, token } = await makeOwner()
  const p = await makeProject(owner, workspaceId, 'Acme')
  // Never opened: the state is made by the anchor itself.
  const id = await aDocument(token, p, 'First paragraph stays.', 'Second paragraph changes.')
  const r = await call(token)('POST', `/api/files/${id}/comments`, { body: said('Keep this.'), anchor: { text: 'paragraph stays' } })
  assert.equal(r.status, 201)
  const { id: thread } = (await r.json()) as { id: string }
  assert.equal(marked((await stored(id)).body, thread), 'paragraph stays')

  // An agent rewrites the second line from Markdown, which has no marks.
  const r2 = await call(token)('PATCH', `/api/files/${id}`, { body: doc('First paragraph stays.', 'Second paragraph, rewritten.') })
  assert.equal(r2.status, 200)
  const now = (await stored(id)).body
  assert.equal(marked(now, thread), 'paragraph stays')
  assert.ok(threadsIn(now).has(thread))

  // Words that are not there, a reply with an anchor, and an upload: refused.
  assert.equal((await call(token)('POST', `/api/files/${id}/comments`, { body: said('x'), anchor: { text: 'not in it' } })).status, 409)
  assert.equal(
    (await call(token)('POST', `/api/files/${id}/comments`, { body: said('x'), parent_id: thread, anchor: { text: 'First' } })).status,
    400,
  )
})

test('carryRich puts the marks back on the words they were on, and never takes back an edit', () => {
  const c = (text: string, ids = 'a1') => ({ type: 'text', text, marks: [{ type: 'comment', attrs: { ids } }] })
  const base = {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'We ship ' }, c('Friday'), { type: 'text', text: ' not later.' }] },
      para('Other.'),
    ],
  }
  // The same words back from Markdown: the mark is carried onto them.
  const same = carryRich(base, doc('We ship Friday not later.', 'Other, changed.')) as { content: unknown[] }
  assert.deepEqual(same.content[0], {
    type: 'paragraph',
    content: [{ type: 'text', text: 'We ship ' }, c('Friday'), { type: 'text', text: ' not later.' }],
  })
  assert.deepEqual(same.content[1], para('Other, changed.'))

  // The review's four edits, each kept as the caller wrote it.
  // 1. Case and punctuation: the words are the caller's; the mark stays on Friday.
  const shout = carryRich(base, doc('We ship Friday, NOT later!')) as { content: { content: unknown[] }[] }
  assert.deepEqual(shout.content[0]!.content, [{ type: 'text', text: 'We ship ' }, c('Friday'), { type: 'text', text: ', NOT later!' }])
  // 2. A heading's level changed: the incoming level stands.
  const h = (level: number, ...content: unknown[]) => ({ type: 'doc', content: [{ type: 'heading', attrs: { level }, content }] })
  const lifted = carryRich(h(2, c('Plan')), h(1, { type: 'text', text: 'Plan' })) as {
    content: { attrs: { level: number }; content: unknown[] }[]
  }
  assert.equal(lifted.content[0]!.attrs.level, 1)
  assert.deepEqual(lifted.content[0]!.content, [c('Plan')])
  // 3. A link's address changed: the new address stands.
  const link = (href: string, ...more: unknown[]) => ({ type: 'text', text: 'site', marks: [{ type: 'link', attrs: { href } }, ...more] })
  const moved = carryRich(
    { type: 'doc', content: [{ type: 'paragraph', content: [link('https://old.example', { type: 'comment', attrs: { ids: 'a1' } })] }] },
    { type: 'doc', content: [{ type: 'paragraph', content: [link('https://new.example')] }] },
  ) as { content: { content: { marks: { attrs: { href?: string } }[] }[] }[] }
  assert.equal(moved.content[0]!.content[0]!.marks[0]!.attrs.href, 'https://new.example')
  // 4. Numbers changed around a chip: the incoming words stand, the chip is not forced back.
  const chip = { type: 'taskref', attrs: { id: 't1', number: 12, key: 'ACM', title: 'Plan Q3-2026' } }
  const renumbered = carryRich(
    { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'See ' }, chip] }] },
    doc('See #13 Plan Q4-2027'),
  )
  assert.deepEqual(renumbered, doc('See #13 Plan Q4-2027'))
  // Changed words carry nothing.
  assert.deepEqual(carryRich(base, doc('We ship Monday.')), doc('We ship Monday.'))
})

test('carryRich never moves a mark or a chip to another line, nor onto part of a word', () => {
  const c = (text: string) => ({ type: 'text', text, marks: [{ type: 'comment', attrs: { ids: 'a1' } }] })
  // A thread on "the" in a line rewritten without it does not land on "the" in another line.
  const base = {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Launch ' }, c('the'), { type: 'text', text: ' site' }] },
      para('Read the brief'),
    ],
  }
  assert.deepEqual(carryRich(base, doc('Launch postponed', 'Read the brief')), doc('Launch postponed', 'Read the brief'))
  // Moved down a line, it still finds its own sentence.
  const moved = carryRich(base, doc('New first line', 'Launch the site', 'Read the brief')) as { content: unknown[] }
  assert.deepEqual(moved.content[1], base.content[0])
  assert.deepEqual(moved.content[2], para('Read the brief'))

  // A chip titled "fix" whose line was deleted does not become "Pre[chip] the header".
  const chip = { type: 'taskref', attrs: { id: 't1', number: 3, key: 'ACM', title: 'fix' } }
  const withChip = { type: 'doc', content: [{ type: 'paragraph', content: [chip] }, para('Prefix the header')] }
  assert.deepEqual(carryRich(withChip, doc('Prefix the header')), doc('Prefix the header'))
  // A line that is the chip's words alone, where the chip stood, is the chip again.
  assert.deepEqual(carryRich(withChip, doc('ACM-3 fix', 'Prefix the header')), withChip)
  // Inside a word is not the words.
  assert.deepEqual(
    carryRich({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Ship ' }, c('it')] }] }, doc('Ship item')),
    doc('Ship item'),
  )
})

test('who may comment may anchor and resolve; nobody outside may do either', async () => {
  const { ctx: owner, workspaceId, token } = await makeOwner()
  const p = await makeProject(owner, workspaceId, 'Acme')
  const elsewhere = await makeProject(owner, workspaceId, 'Elsewhere')
  const id = await aDocument(token, p, 'A sentence to agree.')

  // A member who may not edit somebody else's document may still comment on its words.
  assert.equal((await call(token)('PATCH', '/api/workspace', { edit_others_content: 'own_only' })).status, 200)
  const kim = await addPerson(owner, workspaceId, 'member', [p], [])
  const kimToken = await tokenOf(kim.actorId, workspaceId)
  assert.equal((await call(kimToken)('PATCH', `/api/files/${id}`, { body: doc('Changed by Kim.') })).status, 403)
  const r = await call(kimToken)('POST', `/api/files/${id}/comments`, { body: said('Agree?'), anchor: { text: 'to agree' } })
  assert.equal(r.status, 201)
  const { id: thread } = (await r.json()) as { id: string }
  // The words are as they were; only the mark is new.
  const now = (await stored(id)).body as { content: { content: { text: string }[] }[] }
  assert.equal(now.content[0]!.content.map((t) => t.text).join(''), 'A sentence to agree.')

  // The owner resolves Kim's thread; Kim reopens it; again is no change.
  const resolve = (t: string, resolved: boolean) => call(t)('PUT', `/api/comments/${thread}/resolved`, { resolved })
  assert.equal((await resolve(token, true)).status, 200)
  let read = (await (await call(token)('GET', `/api/files/${id}`)).json()) as {
    comments: { id: string; resolved_at: string | null; resolved_by: string | null; resolved_by_name: string | null }[]
  }
  let c = read.comments.find((x) => x.id === thread)!
  assert.ok(c.resolved_at)
  assert.equal(c.resolved_by, owner.actorId)
  assert.equal((await resolve(token, true)).status, 200)
  assert.equal((await resolve(kimToken, false)).status, 200)
  read = (await (await call(token)('GET', `/api/files/${id}`)).json()) as typeof read
  c = read.comments.find((x) => x.id === thread)!
  assert.equal(c.resolved_at, null)
  assert.equal(c.resolved_by, null)

  // Kim's own comment was not edited by resolving it.
  const [row] = await asTableOwner()<{ updated: boolean }[]>`select updated_at > created_at as updated from comment where id = ${thread}`
  assert.equal(row?.updated, false)

  // Somebody on another project: the document and the thread are not there.
  const outsider = await addPerson(owner, workspaceId, 'member', [elsewhere])
  const outToken = await tokenOf(outsider.actorId, workspaceId)
  assert.equal((await call(outToken)('POST', `/api/files/${id}/comments`, { body: said('x'), anchor: { text: 'sentence' } })).status, 404)
  assert.equal((await resolve(outToken, true)).status, 404)

  // Another workspace: nothing.
  const stranger = await makeOwner()
  assert.equal((await resolve(stranger.token, true)).status, 404)
  assert.equal(
    (await call(stranger.token)('POST', `/api/files/${id}/comments`, { body: said('x'), anchor: { text: 'sentence' } })).status,
    404,
  )

  // A comment with no anchor is not resolved.
  const plain = (await (await call(token)('POST', `/api/files/${id}/comments`, { body: said('On the whole thing.') })).json()) as {
    id: string
  }
  assert.equal((await call(token)('PUT', `/api/comments/${plain.id}/resolved`, { resolved: true })).status, 409)

  // A task's comment cannot carry an anchor, by the database too.
  await assert.rejects(
    asTableOwner()`update comment set quote = 'x', parent_id = ${thread} where id = ${plain.id}`,
    /comment_anchor_starts_a_thread/,
  )
})

test('a reader by link gets the body without the threads', async () => {
  const { ctx: owner, workspaceId, token } = await makeOwner()
  const p = await makeProject(owner, workspaceId, 'Acme')
  const id = await aDocument(token, p, 'Shared words here.')
  assert.equal((await call(token)('POST', `/api/files/${id}/comments`, { body: said('Hm.'), anchor: { text: 'words' } })).status, 201)
  const { token: link } = (await (await call(token)('PUT', `/api/files/${id}/public`, { public: true })).json()) as { token: string }
  const pub = (await (await app.request(`/api/public/docs/${link}`)).json()) as { body: unknown }
  assert.equal(JSON.stringify(pub.body).includes('comment'), false, JSON.stringify(pub))
  assert.equal(JSON.stringify(pub.body).includes('Shared words here.'), true, JSON.stringify(pub))
})

test('two threads on overlapping words both keep their stretch', () => {
  const d = new Y.Doc()
  Y.applyUpdate(d, stateFrom(doc('one two three four')))
  markThread(d, stretchOf(d, 'one two')!, 'a')
  markThread(d, stretchOf(d, 'two three')!, 'b')
  const body = bodyOf(d)
  assert.equal(marked(body, 'a'), 'one two')
  assert.equal(marked(body, 'b'), 'two three')
  assert.deepEqual([...threadsIn(body)].sort(), ['a', 'b'])
})

/* That the first two are answered without the wait — at once, not after
   the second the third may be given — is timed in `bench/documents.bench.ts`. */
test('an anchor that cannot be read is refused; one still on its way is waited for, outside the lock', async () => {
  const { ctx: owner, workspaceId, token } = await makeOwner()
  const p = await makeProject(owner, workspaceId, 'Acme')
  const id = await aDocument(token, p, 'Words that will go away.')
  const s = socket()
  const seat = await join(owner, id, s.ws)
  assert.ok(seat)

  // Garbage.
  const junk = { from: Buffer.from('not a position at all').toString('base64'), to: 'AAAA' }
  assert.equal((await call(token)('POST', `/api/files/${id}/comments`, { body: said('x'), anchor: junk })).status, 409)

  // Positions over words the state has and has since deleted.
  const gone = positions(await stateOf(id), 'will go away')
  assert.equal((await call(token)('PATCH', `/api/files/${id}`, { body: doc('Other words now.') })).status, 200)
  assert.equal((await call(token)('POST', `/api/files/${id}/comments`, { body: said('x'), anchor: gone })).status, 409)

  // Words typed on a page and not yet sent: the request waits for them, and lands.
  const page = new Y.Doc()
  Y.applyUpdate(page, Y.encodeStateAsUpdate(await stateOf(id)))
  const sent: Uint8Array[] = []
  page.on('update', (u: Uint8Array) => sent.push(u))
  const text = (page.getXmlFragment(FRAGMENT).get(0) as Y.XmlElement).get(0) as Y.XmlText
  text.insert(plainOf(text).length, ' Fresh words.')
  const at = plainOf(text).indexOf('Fresh words')
  const fresh = {
    from: b64(Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(text, at))),
    to: b64(Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(text, at + 'Fresh words'.length))),
  }
  const asked = call(token)('POST', `/api/files/${id}/comments`, { body: said('New?'), anchor: fresh })
  await pause(250)
  heard(seat, JSON.stringify({ t: 'u', u: b64(Y.mergeUpdates(sent)) }))
  await seat.queue
  const r = await asked
  assert.equal(r.status, 201)
  assert.equal(((await r.json()) as { quote: string }).quote, 'Fresh words')
  await leave(seat)
})

test('marking words keeps the clock Docs is ordered by; only a written document is anchored; a link reader sees no ids', async () => {
  const { ctx: owner, workspaceId, token } = await makeOwner()
  const p = await makeProject(owner, workspaceId, 'Acme')
  const id = await aDocument(token, p, 'Settle the wording.')
  const clock = async () => (await asTableOwner()<{ at: string }[]>`select updated_at::text as at from file where id = ${id}`)[0]!.at
  const before = await clock()
  await pause(50)
  assert.equal((await call(token)('POST', `/api/files/${id}/comments`, { body: said('Ok?'), anchor: { text: 'wording' } })).status, 201)
  assert.equal(await clock(), before)
  // An edit of the words still moves it.
  assert.equal((await call(token)('PATCH', `/api/files/${id}`, { body: doc('Settle the words.') })).status, 200)
  assert.notEqual(await clock(), before)

  // A link is a file and not a written document: the database refuses an anchor on it.
  const link = (
    (await (await call(token)('POST', `/api/projects/${p}/files`, { name: 'Site', url: 'https://example.com' })).json()) as { id: string }
  ).id
  const plain = ((await (await call(token)('POST', `/api/files/${link}/comments`, { body: said('Nice.') })).json()) as { id: string }).id
  await assert.rejects(asTableOwner()`update comment set quote = 'x' where id = ${plain}`, /an anchor is on a written document/)

  // A reader by link: another document named in it is its title, no ids.
  const other = await aDocument(token, p, 'Other.')
  const named = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'See ' },
          { type: 'docref', attrs: { id: other, projectId: p, title: 'The plan' } },
        ],
      },
    ],
  }
  assert.equal((await call(token)('PATCH', `/api/files/${id}`, { body: named })).status, 200)
  const { token: shared } = (await (await call(token)('PUT', `/api/files/${id}/public`, { public: true })).json()) as { token: string }
  const pub = (await (await app.request(`/api/public/docs/${shared}`)).json()) as { body: unknown }
  assert.deepEqual(pub.body, doc('See The plan'))
})

test('an anchor writes only its mark into the stored body, not the live words around it', async () => {
  const { ctx: owner, workspaceId, token } = await makeOwner()
  const p = await makeProject(owner, workspaceId, 'Acme')
  const id = await aDocument(token, p, 'Stored words here.')
  const s = socket()
  const seat = await join(owner, id, s.ws)
  assert.ok(seat)
  // Somebody is typing a second line the stored body does not have yet.
  const page = new Y.Doc()
  Y.applyUpdate(page, Y.encodeStateAsUpdate(await stateOf(id)))
  const sent: Uint8Array[] = []
  page.on('update', (u: Uint8Array) => sent.push(u))
  page.getXmlFragment(FRAGMENT).insert(1, [toElement(para('Typed live.'))])
  heard(seat, JSON.stringify({ t: 'u', u: b64(Y.mergeUpdates(sent)) }))
  await seat.queue
  const before = await stored(id)
  const r = await call(token)('POST', `/api/files/${id}/comments`, { body: said('Hm.'), anchor: { text: 'words' } })
  assert.equal(r.status, 201)
  const { id: thread } = (await r.json()) as { id: string }
  const now = await stored(id)
  assert.equal(marked(now.body, thread), 'words')
  assert.equal(JSON.stringify(now.body).includes('Typed live.'), false)
  assert.equal(now.version, before.version)
  await leave(seat)
})
