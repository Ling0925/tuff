import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import * as Y from 'yjs'
import type { WSContext } from 'hono/ws'
import { closeDb, withActor, makeOwner, addPerson, makeProject, bearerFor, asTableOwner, uuidv7 } from './helpers.js'
import { app } from '../src/http/routes.js'
import { closeRealtime } from '../src/realtime.js'
import { authenticate, type AuthContext } from '../src/auth/context.js'
import {
  budgetOf,
  BYTES_EACH,
  FRAMES_EACH,
  Refused,
  STATE_MOST,
  cleanCaret,
  heard,
  join,
  leave,
  mergeBody,
  openRooms,
  type Seat,
} from '../src/coedit.js'
import { fromMarkdown } from '../src/mcp/markdown.js'
import { FRAGMENT, bodyOf, mergeInto, stateFrom, toElement } from '../src/yjson.js'
import { inWorkspace } from './helpers.js'

/*
 * Writing a document together. What the
 * server takes from a document's socket, from whom, and what it does with
 * an edit that arrives through the API while people are in the document.
 */

after(async () => {
  await closeRealtime()
  await closeDb()
})

const doc = (...lines: string[]) => ({
  type: 'doc',
  content: lines.map((t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })),
})
const words = (body: unknown) =>
  ((body as { content?: { content?: { text?: string }[] }[] }).content ?? []).map((p) => (p.content ?? []).map((t) => t.text).join(''))
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

const call = (token: string) => (method: string, path: string, body?: unknown) =>
  app.request(path, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

async function ctxOf(actorId: string, workspaceId: string): Promise<AuthContext> {
  const ctx = await authenticate(`Bearer ${await bearerFor(actorId, workspaceId)}`)
  assert.ok(ctx)
  return ctx
}

/** A socket as the room sees one: what it was told, and how it was closed. */
function socket() {
  const said: { t: string; u?: string; sv?: string; write?: boolean; version?: number; c?: number; s?: unknown }[] = []
  const closed: { code?: number } = {}
  const ws = {
    send: (f: string) => said.push(JSON.parse(f)),
    close: (code: number) => {
      closed.code = code
    },
    readyState: 1,
  } as unknown as WSContext
  return { ws, said, closed }
}

/**
 * A page: the server's state, and the update that adds a line to it.
 *
 * Its client id is drawn from the ids that take five bytes to write. Yjs
 * draws any 32-bit number, and one in sixteen is written in four bytes or
 * fewer, so two pages adding the same line to the same state sent updates
 * a few bytes apart — and a test that filled a document to within one
 * line of its cap found, once in a dozen runs, a keystroke short enough
 * to fit.
 */
function page(sync: { u?: string }) {
  const d = new Y.Doc()
  d.clientID = 2 ** 28 + Math.floor(Math.random() * (2 ** 32 - 2 ** 28))
  Y.applyUpdate(d, new Uint8Array(Buffer.from(sync.u ?? '', 'base64')))
  return {
    doc: d,
    add(text: string): string {
      let out: Uint8Array | null = null
      const grab = (u: Uint8Array) => {
        out = u
      }
      d.on('update', grab)
      const f = d.getXmlFragment(FRAGMENT)
      f.insert(f.length, [toElement({ type: 'paragraph', content: [{ type: 'text', text }] })])
      d.off('update', grab)
      return Buffer.from(out!).toString('base64')
    },
  }
}

async function send(seat: Seat, u: string) {
  heard(seat, JSON.stringify({ t: 'u', u }))
  await seat.queue
}

async function rowsBy(actorId: string, fileId: string): Promise<number> {
  const [r] = await asTableOwner()<
    { n: number }[]
  >`select count(*)::int as n from file_yjs where file_id = ${fileId} and actor_id = ${actorId}`
  return r?.n ?? 0
}

async function stored(fileId: string): Promise<{ body: unknown; version: number }> {
  const [r] = await asTableOwner()<{ body: unknown; version: number }[]>`select body, version from file where id = ${fileId}`
  return r!
}

async function aDocument(token: string, projectId: string, ...lines: string[]): Promise<string> {
  const made = await call(token)('POST', `/api/projects/${projectId}/files`, { name: 'Brief', body: doc(...lines) })
  assert.equal(made.status, 201)
  return ((await made.json()) as { id: string }).id
}

/* --------------------------------------------------------------- the shape */

test('a body goes into Yjs and comes back as the same body', () => {
  const body = {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Plan' }] },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Read ' },
          { type: 'text', text: 'this', marks: [{ type: 'bold' }, { type: 'link', attrs: { href: 'https://example.com', target: null } }] },
          { type: 'mention', attrs: { id: 'a1', label: 'Sam' } },
          { type: 'text', text: ' first.' },
        ],
      },
      { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'One' }] }] }] },
      { type: 'attachment', attrs: { fileId: 'f1', name: 'a.png', uploadId: null } },
    ],
  }
  const d = new Y.Doc()
  Y.applyUpdate(d, stateFrom(body))
  const back = bodyOf(d)
  assert.deepEqual(back.content[0], body.content[0])
  // A mark's attributes are kept as written, nulls and all, as the browser's binding keeps them.
  assert.deepEqual(back.content[1], body.content[1])
  assert.deepEqual(back.content[2], body.content[2])
  // A node's null attribute is the schema's default, and left out.
  assert.deepEqual(back.content[3], { type: 'attachment', attrs: { fileId: 'f1', name: 'a.png' } })
})

test('a callout and a toggle go into Yjs and come back whole', () => {
  /* Blocks that hold blocks, one with attributes. */
  const body = {
    type: 'doc',
    content: [
      {
        type: 'callout',
        attrs: { emoji: '⚠️', tone: 'yellow' },
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Heads ' },
              { type: 'text', text: 'up', marks: [{ type: 'bold' }] },
            ],
          },
          {
            type: 'bulletList',
            content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Inside' }] }] }],
          },
        ],
      },
      {
        type: 'details',
        content: [
          { type: 'detailsSummary', content: [{ type: 'text', text: 'More' }] },
          { type: 'detailsContent', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Folded words' }] }] },
        ],
      },
      /* A toggle with nothing on its line yet. */
      { type: 'details', content: [{ type: 'detailsSummary' }, { type: 'detailsContent', content: [{ type: 'paragraph' }] }] },
    ],
  }
  const d = new Y.Doc()
  Y.applyUpdate(d, stateFrom(body))
  assert.deepEqual(bodyOf(d), body)
  const f = d.getXmlFragment(FRAGMENT)
  assert.equal((f.get(0) as Y.XmlElement).nodeName, 'callout')
  assert.equal((f.get(0) as Y.XmlElement).getAttribute('tone'), 'yellow')
  assert.equal(((f.get(1) as Y.XmlElement).get(0) as Y.XmlElement).nodeName, 'detailsSummary')
  /* And an outside edit beside them leaves them as they were. */
  assert.equal(mergeInto(d, body, { ...body, content: [...body.content, doc('After').content[0]] }).changed, true)
  assert.deepEqual(bodyOf(d).content.slice(0, 3), body.content)
})

test('a picture still on its way up is not written into the stored body', () => {
  const d = new Y.Doc()
  d.getXmlFragment(FRAGMENT).insert(0, [
    toElement({ type: 'attachment', attrs: { name: 'going.png', uploadId: 'u1' } }),
    toElement({ type: 'attachment', attrs: { name: 'landed.png', fileId: 'f2', uploadId: 'u2' } }),
  ])
  assert.deepEqual(bodyOf(d).content, [{ type: 'attachment', attrs: { name: 'landed.png', fileId: 'f2' } }])
})

test('an outside edit replaces what it changed and keeps what the people changed', () => {
  const base = doc('One', 'Two', 'Three', 'Four')
  const live = () => {
    const d = new Y.Doc()
    Y.applyUpdate(d, stateFrom(base))
    return d
  }

  // The people added a line at the end; the caller changed the second.
  let d = live()
  let f = d.getXmlFragment(FRAGMENT)
  f.insert(4, [toElement(doc('Five').content[0]!)])
  assert.equal(mergeInto(d, base, doc('One', 'Two, better', 'Three', 'Four')).changed, true)
  assert.deepEqual(words(bodyOf(d)), ['One', 'Two, better', 'Three', 'Four', 'Five'])

  // The people changed the first; the caller added a line at the end.
  d = live()
  f = d.getXmlFragment(FRAGMENT)
  f.delete(0, 1)
  f.insert(0, [toElement(doc('One, live').content[0]!)])
  mergeInto(d, base, doc('One', 'Two', 'Three', 'Four', 'From the agent'))
  assert.deepEqual(words(bodyOf(d)), ['One, live', 'Two', 'Three', 'Four', 'From the agent'])

  // Both changed the third: the people's stays, and the caller is told.
  d = live()
  f = d.getXmlFragment(FRAGMENT)
  f.delete(2, 1)
  f.insert(2, [toElement(doc('Three, live').content[0]!)])
  assert.equal(mergeInto(d, base, doc('One', 'Two', 'Three, agent', 'Four')).conflicts, 1)
  assert.deepEqual(words(bodyOf(d)), ['One', 'Two', 'Three, live', 'Four'])

  // Nothing changed is nothing written.
  d = live()
  assert.equal(mergeInto(d, base, doc('One', 'Two', 'Three', 'Four')).changed, false)
})

/* ------------------------------------------------------------ the socket */

test("a writer's update is kept as them, passed on, and written to the body", async () => {
  const { ctx: owner, workspaceId, token } = await makeOwner()
  const p = await makeProject(owner, workspaceId, 'Acme')
  const sam = await addPerson(owner, workspaceId, 'member', [p])
  const id = await aDocument(token, p, 'The brief.')
  const before = (await stored(id)).version

  const a = socket()
  const b = socket()
  const mine = await join(owner, id, a.ws)
  const theirs = await join(await ctxOf(sam.actorId, workspaceId), id, b.ws)
  assert.ok(mine && theirs)
  assert.equal(a.said[0]?.t, 'sync')
  assert.equal(a.said[0]?.write, true)

  const me = page(a.said[0]!)
  await send(mine, me.add('Typed by the owner.'))
  assert.equal(await rowsBy(owner.actorId, id), 1)
  // The other page hears it; the one that sent it is not sent it back.
  const heardThere = b.said.filter((m) => m.t === 'u')
  assert.equal(heardThere.length, 1)
  assert.equal(a.said.filter((m) => m.t === 'u').length, 0)
  const there = page(b.said[0]!)
  Y.applyUpdate(there.doc, new Uint8Array(Buffer.from(heardThere[0]!.u!, 'base64')))
  assert.deepEqual(words(bodyOf(there.doc)), ['The brief.', 'Typed by the owner.'])

  // Written: the body, and the version moved once for the session's first write.
  await mine.room.save(false)
  let now = await stored(id)
  assert.deepEqual(words(now.body), ['The brief.', 'Typed by the owner.'])
  assert.equal(now.version, before + 1)
  // Another write inside five minutes does not move it again…
  await send(theirs, page(b.said[0]!).add('And by Sam.'))
  await mine.room.save(false)
  now = await stored(id)
  assert.equal(now.version, before + 1)
  assert.ok(words(now.body).includes('And by Sam.'))
  // …and the last one out does.
  await send(theirs, page(b.said[0]!).add('Last words.'))
  await leave(mine)
  await leave(theirs)
  now = await stored(id)
  assert.equal(now.version, before + 2)
  assert.ok(words(now.body).includes('Last words.'))
  // Folded: one row now stands for every update.
  const [rows] = await asTableOwner()<{ n: number }[]>`select count(*)::int as n from file_yjs where file_id = ${id}`
  assert.equal(rows?.n, 1)
  // Each who edited has a line in the activity.
  const lines = await asTableOwner()<{ actor_id: string }[]>`
    select actor_id from activity_event where object_id = ${id} and action = 'file.update'`
  assert.ok(lines.some((l) => l.actor_id === owner.actorId))
  assert.ok(lines.some((l) => l.actor_id === sam.actorId))
})

test("a reader's update is refused, not kept, and heard by nobody", async () => {
  const { ctx: owner, workspaceId, token } = await makeOwner()
  const p = await makeProject(owner, workspaceId, 'Acme')
  assert.equal((await call(token)('PATCH', '/api/workspace', { edit_others_content: 'own_only' })).status, 200)
  const lee = await addPerson(owner, workspaceId, 'member', [p])
  const id = await aDocument(token, p, 'Only mine to change.')

  const a = socket()
  const b = socket()
  const mine = await join(await ctxOf(owner.actorId, workspaceId), id, a.ws)
  const reader = await join(await ctxOf(lee.actorId, workspaceId), id, b.ws)
  assert.ok(mine && reader)
  // Let in to read, and told so.
  assert.equal(b.said[0]?.t, 'sync')
  assert.equal(b.said[0]?.write, false)

  await send(reader, page(b.said[0]!).add('Not mine to write.'))
  assert.equal(await rowsBy(lee.actorId, id), 0)
  assert.equal(a.said.filter((m) => m.t === 'u').length, 0)
  // Told it was refused, and put back to the server's words.
  const after = b.said.slice(1).map((m) => m.t)
  assert.deepEqual(after, ['ro', 'sync'])
  assert.deepEqual(words(bodyOf(page(b.said[2]!).doc)), ['Only mine to change.'])

  // And the owner's edits still reach the reader as they are made.
  await send(mine, page(a.said[0]!).add('Mine.'))
  assert.equal(b.said.filter((m) => m.t === 'u').length, 1)
  await leave(mine)
  await leave(reader)
})

test('an edit right taken away is refused once the rights are read again', async () => {
  const { ctx: owner, workspaceId, token } = await makeOwner()
  const p = await makeProject(owner, workspaceId, 'Acme')
  assert.equal((await call(token)('PATCH', '/api/workspace', { edit_others_content: 'own_only' })).status, 200)
  const kim = await addPerson(owner, workspaceId, 'member', [p], ['edit.any'])
  const id = await aDocument(token, p, 'Draft.')

  const b = socket()
  const seat = await join(await ctxOf(kim.actorId, workspaceId), id, b.ws)
  assert.ok(seat)
  assert.equal(b.said[0]?.write, true)
  await send(seat, page(b.said[0]!).add('Allowed.'))
  assert.equal(await rowsBy(kim.actorId, id), 1)

  await asTableOwner()`update project_member set rights = '{}' where actor_id = ${kim.actorId} and project_id = ${p}`
  // The reading is more than five seconds old.
  seat.read = 0
  await send(seat, page(b.said[0]!).add('No longer allowed.'))
  assert.equal(await rowsBy(kim.actorId, id), 1)
  assert.ok(b.said.some((m) => m.t === 'ro'))
  await leave(seat)
})

test('somebody taken off the project is refused by the database itself', async () => {
  const { ctx: owner, workspaceId, token } = await makeOwner()
  const p = await makeProject(owner, workspaceId, 'Acme')
  const jo = await addPerson(owner, workspaceId, 'member', [p])
  const id = await aDocument(token, p, 'Draft.')

  const b = socket()
  const seat = await join(await ctxOf(jo.actorId, workspaceId), id, b.ws)
  assert.ok(seat)
  assert.equal(b.said[0]?.write, true)
  await asTableOwner()`update project_member set deleted_at = now() where actor_id = ${jo.actorId} and project_id = ${p}`
  // The context still says they are on it; the insert does not agree.
  seat.read = Date.now()
  seat.ctx.rights[p] = ['edit.any']
  await send(seat, page(b.said[0]!).add('After leaving.'))
  assert.equal(await rowsBy(jo.actorId, id), 0)
  assert.equal(b.closed.code, 4404)
  await leave(seat)
})

test('another workspace, another project or an upload is not let in at all', async () => {
  const { ctx: owner, workspaceId, token } = await makeOwner()
  const p = await makeProject(owner, workspaceId, 'Acme')
  const elsewhere = await makeProject(owner, workspaceId, 'Elsewhere')
  const id = await aDocument(token, p, 'Ours.')

  const stranger = (await makeOwner()).ctx
  const s = socket()
  assert.equal(await join(stranger, id, s.ws), null)
  assert.equal(s.said.length, 0)

  // In the workspace, on another project.
  const outsider = await addPerson(owner, workspaceId, 'member', [elsewhere])
  assert.equal(await join(await ctxOf(outsider.actorId, workspaceId), id, socket().ws), null)

  // A token held to the other project.
  assert.equal(await join({ ...(await ctxOf(owner.actorId, workspaceId)), tokenProjectIds: [elsewhere] }, id, socket().ws), null)

  // A link is not a written document, and an id is a uuid.
  const link = (
    (await (await call(token)('POST', `/api/projects/${p}/files`, { name: 'Site', url: 'https://example.com' })).json()) as {
      id: string
    }
  ).id
  assert.equal(await join(owner, link, socket().ws), null)
  assert.equal(await join(owner, 'not-an-id', socket().ws), null)
  assert.equal(openRooms(), 0)
})

/* ------------------------------------------------------- an edit from outside */

test('an API edit during a session is merged, not lost', async () => {
  const { ctx: owner, workspaceId, token } = await makeOwner()
  const p = await makeProject(owner, workspaceId, 'Acme')
  const sam = await addPerson(owner, workspaceId, 'member', [p])
  const id = await aDocument(token, p, 'One.', 'Two.')

  const a = socket()
  const b = socket()
  const mine = await join(owner, id, a.ws)
  const theirs = await join(await ctxOf(sam.actorId, workspaceId), id, b.ws)
  assert.ok(mine && theirs)
  // Typed in the page and not yet written to the body.
  await send(mine, page(a.said[0]!).add('Typed live.'))
  assert.deepEqual(words((await stored(id)).body), ['One.', 'Two.'])

  // An agent read the body a moment ago and appends to what it read.
  const r = await call(token)('PATCH', `/api/files/${id}`, { body: doc('One.', 'Two, edited by the agent.') })
  assert.equal(r.status, 200)
  const now = await stored(id)
  assert.deepEqual(words(now.body), ['One.', 'Two, edited by the agent.', 'Typed live.'])

  // The pages hear the agent's edit and the version it moved to.
  await pause(400)
  const there = page(b.said[0]!)
  for (const m of b.said.filter((x) => x.t === 'u')) Y.applyUpdate(there.doc, new Uint8Array(Buffer.from(m.u!, 'base64')))
  assert.deepEqual(words(bodyOf(there.doc)), ['One.', 'Two, edited by the agent.', 'Typed live.'])
  assert.ok(b.said.some((m) => m.t === 'saved' && m.version === now.version))
  await leave(mine)
  await leave(theirs)
  assert.deepEqual(words((await stored(id)).body), ['One.', 'Two, edited by the agent.', 'Typed live.'])
})

test('a document nobody has opened is written by the API as it always was', async () => {
  const { ctx: owner, workspaceId, token } = await makeOwner()
  const p = await makeProject(owner, workspaceId, 'Acme')
  const id = await aDocument(token, p, 'Old.')
  const r = await call(token)('PATCH', `/api/files/${id}`, { body: doc('New.') })
  assert.equal(r.status, 200)
  assert.deepEqual(words((await stored(id)).body), ['New.'])
  const [rows] = await withActor(owner.actorId, (tx) => tx<{ n: number }[]>`select count(*)::int as n from file_yjs where file_id = ${id}`)
  assert.equal(rows?.n, 0)
})

/* ------------------------------------------------------ what the review found */

/** Every frame since, of a kind. */
const of = (said: { t: string }[], t: string) => said.filter((m) => m.t === t)
const bytesOf = async (fileId: string) =>
  (await asTableOwner()<{ n: number }[]>`select coalesce(sum(length(bytes)), 0)::int as n from file_yjs where file_id = ${fileId}`)[0]!.n
/** Letters nobody would type twice, so nothing about them is small. */
const noise = (n: number) => Array.from({ length: n }, (_, i) => String.fromCharCode(97 + ((i * 7919) % 26))).join('')

/** A document filled until not even a line of one letter fits: ever smaller pieces until none does.
    A piece taken grows the room's count of its state (`size`), which is
    read here rather than the stored rows: two queries a piece were most of
    what filling cost. What was kept is asserted by the tests themselves.
    It stopped at ten letters once, and the room that left — up to fifty
    bytes — took a keystroke now and then, as it should. */
async function fill(seat: Seat, a: { said: { t: string; u?: string }[] }): Promise<void> {
  for (const n of [1_000_000, 100_000, 10_000, 1000, 100, 10, 1]) {
    for (;;) {
      const was = seat.room.size
      await send(seat, page(a.said.filter((m) => m.t === 'sync').at(-1)!).add(noise(n)))
      if (seat.room.size === was) break
      a.said.push({ t: 'sync', u: Buffer.from(Y.encodeStateAsUpdate(seat.room.doc)).toString('base64') })
    }
  }
}

test('S1: an outside edit of one block leaves the people’s edits of two others alone', () => {
  const base = doc('a', 'b', 'c', 'd')
  const d = new Y.Doc()
  Y.applyUpdate(d, stateFrom(base))
  const f = d.getXmlFragment(FRAGMENT)
  f.delete(3, 1)
  f.insert(3, [toElement(doc('d, live').content[0]!)])
  f.delete(0, 1)
  f.insert(0, [toElement(doc('a, live').content[0]!)])
  assert.equal(mergeInto(d, base, doc('a', 'b', 'c, agent', 'd')).changed, true)
  assert.deepEqual(words(bodyOf(d)), ['a, live', 'b', 'c, agent', 'd, live'])
})

test('S2: what Markdown does not carry is not counted as the caller’s change', () => {
  /* As the editor writes it: every attribute, the link's too, and words in runs. */
  const base = {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 2, textAlign: null }, content: [{ type: 'text', text: 'Plan' }] },
      {
        type: 'paragraph',
        attrs: { textAlign: null },
        content: [
          { type: 'text', text: 'Read ' },
          {
            type: 'text',
            text: 'this',
            marks: [{ type: 'link', attrs: { href: 'https://example.com', target: '_blank', rel: 'noreferrer noopener', class: null } }],
          },
          { type: 'text', text: ' first.' },
        ],
      },
      { type: 'paragraph', attrs: { textAlign: null }, content: [{ type: 'text', text: 'Old ending.' }] },
    ],
  }
  const d = new Y.Doc()
  Y.applyUpdate(d, stateFrom(base))
  // The people change the paragraph with the link.
  const f = d.getXmlFragment(FRAGMENT)
  f.delete(1, 1)
  f.insert(1, [toElement({ type: 'paragraph', content: [{ type: 'text', text: 'Read this first, and twice.' }] })])
  // The agent read it, and wrote back Markdown changing only the ending.
  const theirs = fromMarkdown('## Plan\n\nRead [this](https://example.com) first.\n\nNew ending.')
  mergeInto(d, base, theirs, true)
  assert.deepEqual(words(bodyOf(d)), ['Plan', 'Read this first, and twice.', 'New ending.'])
})

test('a document’s state stops at its cap, takes deletions past it, and folds small once emptied', async () => {
  const { ctx: owner, workspaceId, token } = await makeOwner()
  const p = await makeProject(owner, workspaceId, 'Acme')
  const id = await aDocument(token, p, 'Start.')
  const a = socket()
  const seat = await join(owner, id, a.ws)
  assert.ok(seat)
  // The byte budget is its own test; here every megabyte is let through it.
  budgetOf(owner.actorId, id).bytes = { add: () => 0 } as never
  const me = page(a.said[0]!)
  let accepted = 0
  for (let i = 0; i < 8; i++) {
    await send(seat, me.add(noise(1_000_000)))
    if (of(a.said, 'full').length === 0) accepted++
  }
  const stored = await bytesOf(id)
  console.log(`  cap: ${accepted} of 8 one-megabyte updates taken, ${(stored / 1e6).toFixed(2)} MB kept`)
  assert.ok(accepted < 8)
  assert.ok(stored <= STATE_MOST + 1_100_000, `kept ${stored}`)
  assert.equal(of(a.said, 'full').length, 1)

  // Taking everything out is still taken.
  const fresh = page(a.said.filter((m) => m.t === 'sync').at(-1)!)
  let out: Uint8Array | null = null
  fresh.doc.on('update', (u: Uint8Array) => {
    out = u
  })
  const f = fresh.doc.getXmlFragment(FRAGMENT)
  f.delete(0, f.length)
  const before = await bytesOf(id)
  await send(seat, Buffer.from(out!).toString('base64'))
  assert.ok((await bytesOf(id)) > before, 'the deletion was kept')

  // And folded with garbage collected, the state is what is left, not what was ever written.
  await seat.room.save(false)
  const folded = await bytesOf(id)
  console.log(`  emptied and folded: ${(before / 1e6).toFixed(2)} MB → ${folded} bytes`)
  assert.ok(folded < 50_000, `folded to ${folded}`)
  await leave(seat)
})

test('an edit taken while a write that moves the version is under way is written by the next one', async () => {
  const { ctx: owner, workspaceId, token } = await makeOwner()
  const p = await makeProject(owner, workspaceId, 'Acme')
  const id = await aDocument(token, p, 'The brief.')
  const before = (await stored(id)).version
  const a = socket()
  const seat = await join(owner, id, a.ws)
  assert.ok(seat)
  const me = page(a.said[0]!)
  await send(seat, me.add('Before the write.'))
  /*
   * The write is held after it has read the rows and before it writes the
   * body — the test holds the file's row, as a slow write of a large
   * document holds itself — and an edit lands meanwhile. Under load the
   * timer's write of a five-megabyte document did this, and the deletion
   * that followed was never written or folded: the write let its editor
   * go, and the next found nobody to write as. The row is held
   * for no-key update, so the new update's own insert, which only needs
   * the file to exist, is not held with it.
   */
  let release!: () => void
  const held = new Promise<void>((r) => {
    release = r
  })
  let blocked!: () => void
  const waiting = new Promise<void>((r) => {
    blocked = r
  })
  let first: Promise<void> | null = null
  const holding = asTableOwner().begin(async (tx) => {
    await tx`select 1 from file where id = ${id} for no key update`
    first = seat.room.save(false)
    // Until the write is waiting on this transaction: it has read the rows by then.
    for (;;) {
      const [w] = await tx<{ n: number }[]>`
        select count(*)::int as n from pg_stat_activity where pg_backend_pid() = any (pg_blocking_pids(pid))`
      if (w!.n > 0) break
      await pause(10)
    }
    blocked()
    await held
  })
  await waiting
  await send(seat, me.add('During the write.'))
  release()
  await holding
  await first
  let now = await stored(id)
  assert.equal(now.version, before + 1, 'the first write moved the version')
  assert.deepEqual(words(now.body), ['The brief.', 'Before the write.'], 'and wrote what it had read')
  // The next write is somebody's, and takes what came during the first.
  await seat.room.save(false)
  now = await stored(id)
  assert.deepEqual(words(now.body), ['The brief.', 'Before the write.', 'During the write.'])
  const [rows] = await asTableOwner()<{ n: number }[]>`select count(*)::int as n from file_yjs where file_id = ${id}`
  assert.equal(rows?.n, 1, 'folded')
  // And it is still a change since the version: the last one out moves it again.
  await leave(seat)
  assert.equal((await stored(id)).version, before + 2)
})

test('a full document refuses typing without measuring itself each time', async () => {
  const { ctx: owner, workspaceId, token } = await makeOwner()
  const p = await makeProject(owner, workspaceId, 'Acme')
  const id = await aDocument(token, p, 'Start.')
  const a = socket()
  const seat = await join(owner, id, a.ws)
  assert.ok(seat)
  budgetOf(owner.actorId, id).bytes = { add: () => 0 } as never
  await fill(seat, a)
  assert.ok(of(a.said, 'full').length >= 1, 'it filled')
  const last = a.said.filter((m) => m.t === 'sync').at(-1)!
  /* A hundred keystrokes from pages on the server's words. Each is refused,
     and the state is encoded and measured once among them at most — never a
     keystroke each, which was 226 ms an update on a 5.8 MB document. How
     long the hundred take is `bench/documents.bench.ts`. */
  const keys = Array.from({ length: 100 }, () => page(last).add('x'))
  const room = seat.room as unknown as { size: number; measuredAt: number }
  const size = room.size
  const kept = await bytesOf(id)
  let measured = 0
  for (const u of keys) {
    const at = room.measuredAt
    await seat.room.take(seat, u)
    if (room.measuredAt !== at) measured++
  }
  assert.ok(measured <= 1, `measured ${measured} times`)
  assert.equal(room.size, size, 'nothing was taken')
  assert.equal(await bytesOf(id), kept, 'nothing was kept')
  await leave(seat)
})

test('a comment whose mark would take a full document past its cap is refused', async () => {
  const { ctx: owner, workspaceId, token } = await makeOwner()
  const p = await makeProject(owner, workspaceId, 'Acme')
  const id = await aDocument(token, p, 'Start here.')
  const a = socket()
  const seat = await join(owner, id, a.ws)
  assert.ok(seat)
  budgetOf(owner.actorId, id).bytes = { add: () => 0 } as never
  await fill(seat, a)
  const r = await call(token)('POST', `/api/files/${id}/comments`, { body: doc('Hm.'), anchor: { text: 'Start here' } })
  assert.equal(r.status, 413)
  assert.equal(((await r.json()) as { error: { code: string } }).error.code, 'too_large')
  const [n] = await asTableOwner()<{ n: number }[]>`select count(*)::int as n from comment where object_id = ${id}`
  assert.equal(n?.n, 0)
  await leave(seat)
})

test('an API edit that would take a document past its cap is refused', async () => {
  const { ctx: owner, workspaceId, token } = await makeOwner()
  const p = await makeProject(owner, workspaceId, 'Acme')
  const id = await aDocument(token, p, 'Start.')
  const a = socket()
  const seat = await join(owner, id, a.ws)
  assert.ok(seat)
  budgetOf(owner.actorId, id).bytes = { add: () => 0 } as never
  const me = page(a.said[0]!)
  for (let i = 0; i < 4; i++) await send(seat, me.add(noise(1_000_000)))
  await seat.room.save(false)
  const now = await stored(id)
  const theirs = { type: 'doc', content: [...(now.body as { content: unknown[] }).content, ...doc(noise(1_500_000)).content] }
  await assert.rejects(
    inWorkspace(owner.actorId, workspaceId, (tx) => mergeBody(tx, owner, id, theirs)),
    (e: unknown) => e instanceof Refused && e.code === 'too_large',
  )
  await leave(seat)
})

test('a socket over its byte budget is closed', async () => {
  const { ctx: owner, workspaceId, token } = await makeOwner()
  const p = await makeProject(owner, workspaceId, 'Acme')
  const id = await aDocument(token, p, 'Start.')
  const a = socket()
  const seat = await join(owner, id, a.ws)
  assert.ok(seat)
  const me = page(a.said[0]!)
  await send(seat, me.add(noise(700_000)))
  await send(seat, me.add(noise(700_000)))
  assert.equal(a.closed.code, undefined)
  await send(seat, me.add(noise(700_000)))
  assert.equal(a.closed.code, 4429)
  console.log(`  byte budget: closed past ${(BYTES_EACH / 1e6).toFixed(1)} MB in ten seconds`)
  await leave(seat)
})

test('a caret that is not one is dropped, and never reaches anybody', async () => {
  assert.equal(cleanCaret({ cursor: {} }), undefined)
  assert.equal(cleanCaret({ cursor: { anchor: {}, head: {} } }), undefined)
  assert.equal(cleanCaret('x'), undefined)
  const at = { type: { client: 1, clock: 2 }, tname: null, item: { client: 3, clock: 4 }, assoc: 0 }
  assert.deepEqual(cleanCaret({ cursor: { anchor: at, head: at }, evil: 1 }), { cursor: { anchor: at, head: at } })

  const { ctx: owner, workspaceId, token } = await makeOwner()
  const p = await makeProject(owner, workspaceId, 'Acme')
  assert.equal((await call(token)('PATCH', '/api/workspace', { edit_others_content: 'own_only' })).status, 200)
  const lee = await addPerson(owner, workspaceId, 'member', [p])
  const id = await aDocument(token, p, 'Words.')
  const a = socket()
  const b = socket()
  const mine = await join(owner, id, a.ws)
  const reader = await join(await ctxOf(lee.actorId, workspaceId), id, b.ws)
  assert.ok(mine && reader)
  heard(reader, JSON.stringify({ t: 'aw', c: 7, s: { cursor: {} } }))
  heard(reader, JSON.stringify({ t: 'aw', c: 8, s: { cursor: { anchor: 'x', head: null } } }))
  assert.equal(of(a.said, 'aw').length, 0)
  // Nor to somebody who comes in after.
  const c = socket()
  const late = await join(owner, id, c.ws)
  assert.ok(late)
  assert.equal(of(c.said, 'aw').length, 0)
  // A real one goes through, rebuilt, under the server's name.
  heard(reader, JSON.stringify({ t: 'aw', c: 9, s: { cursor: { anchor: at, head: at }, user: { name: 'Owner' } } }))
  const got = of(a.said, 'aw')[0] as unknown as { s: { user: { id: string } } }
  assert.equal(got.s.user.id, lee.actorId)
  for (const s of [mine, reader, late]) await leave(s)
})

test('carets and settles are held to a rate, and a flood closes the socket', async () => {
  const { ctx: owner, workspaceId, token } = await makeOwner()
  const p = await makeProject(owner, workspaceId, 'Acme')
  const id = await aDocument(token, p, 'Words.')
  const a = socket()
  const b = socket()
  const mine = await join(owner, id, a.ws)
  const other = await join(owner, id, b.ws)
  assert.ok(mine && other)
  const at = { type: null, tname: 'default', item: null, assoc: 0 }
  const started = Date.now()
  for (let i = 0; i < 3000; i++) heard(mine, JSON.stringify({ t: 'aw', c: 11, s: { cursor: { anchor: at, head: at } } }))
  const passed = of(b.said, 'aw').length
  console.log(`  3000 caret frames in ${Date.now() - started} ms: ${passed} passed on, socket closed ${a.closed.code}`)
  assert.ok(passed <= 10, `passed ${passed}`)
  assert.equal(a.closed.code, 4429)
  assert.ok(FRAMES_EACH < 3000)

  // Settle after settle writes the body no more than once a second.
  const c = socket()
  const writer = await join(owner, id, c.ws)
  assert.ok(writer)
  const me = page(c.said[0]!)
  const revBefore = (await asTableOwner()<{ rev: number }[]>`select rev from file where id = ${id}`)[0]!.rev
  for (let i = 0; i < 20; i++) {
    await send(writer, me.add(`Line ${i}.`))
    heard(writer, JSON.stringify({ t: 'settle' }))
    await writer.queue
    await pause(20)
  }
  await pause(1600)
  const revAfter = (await asTableOwner()<{ rev: number }[]>`select rev from file where id = ${id}`)[0]!.rev
  console.log(`  20 edits each followed by a settle, over ${20 * 20} ms: ${revAfter - revBefore} writes of the body`)
  assert.ok(revAfter - revBefore <= 3, `${revAfter - revBefore} writes`)
  for (const s of [mine, other, writer]) await leave(s)
})

test('an API edit merges against the revision its caller read, and a stale one is refused', async () => {
  const { ctx: owner, workspaceId, token } = await makeOwner()
  const p = await makeProject(owner, workspaceId, 'Acme')
  const id = await aDocument(token, p, 'One.', 'Two.', 'Three.')
  const a = socket()
  const seat = await join(owner, id, a.ws)
  assert.ok(seat)
  // The agent reads the document now.
  const read = (await (await call(token)('GET', `/api/files/${id}`)).json()) as { file: { rev: number } }
  // The people change the first line, and it is written to the stored body.
  const me = page(a.said[0]!)
  let out: Uint8Array | null = null
  me.doc.on('update', (u: Uint8Array) => {
    out = u
  })
  const f = me.doc.getXmlFragment(FRAGMENT)
  me.doc.transact(() => {
    f.delete(0, 1)
    f.insert(0, [toElement(doc('One, live.').content[0]!)])
  })
  await send(seat, Buffer.from(out!).toString('base64'))
  await seat.room.save(false)
  assert.deepEqual(words((await stored(id)).body), ['One, live.', 'Two.', 'Three.'])

  // Its edit of the third line, against what it read: the first line stays the people's.
  const r = await call(token)('PATCH', `/api/files/${id}`, { body: doc('One.', 'Two.', 'Three, agent.'), base_rev: read.file.rev })
  assert.equal(r.status, 200)
  assert.deepEqual(words((await stored(id)).body), ['One, live.', 'Two.', 'Three, agent.'])

  // A revision nobody kept is stale.
  const stale = await call(token)('PATCH', `/api/files/${id}`, { body: doc('x'), base_rev: 99_999 })
  assert.equal(stale.status, 409)
  assert.equal(((await stale.json()) as { error: { code: string } }).error.code, 'stale')
  await leave(seat)
})

test('a room that opens on a body left behind writes it from the state', async () => {
  const { ctx: owner, workspaceId, token } = await makeOwner()
  const p = await makeProject(owner, workspaceId, 'Acme')
  const id = await aDocument(token, p, 'Before.')
  const a = socket()
  const seat = await join(owner, id, a.ws)
  assert.ok(seat)
  await send(seat, page(a.said[0]!).add('Typed before the crash.'))
  // The process goes down before writing: the body is behind, the state is not.
  await asTableOwner()`update file set body = ${asTableOwner().json(doc('Before.') as never)} where id = ${id}`
  seat.gone = true
  seat.room.seats.delete(seat)
  seat.room.dispose()
  const b = socket()
  const back = await join(owner, id, b.ws)
  assert.ok(back)
  await pause(400)
  assert.deepEqual(words((await stored(id)).body), ['Before.', 'Typed before the crash.'])
  await leave(back)
})

test('the application folds a document’s rows only through the fold, and deletes none itself', async () => {
  const { ctx: owner, workspaceId, token } = await makeOwner()
  const p = await makeProject(owner, workspaceId, 'Acme')
  const id = await aDocument(token, p, 'Words.')
  const a = socket()
  const seat = await join(owner, id, a.ws)
  assert.ok(seat)
  await leave(seat)
  await assert.rejects(withActor(owner.actorId, (tx) => tx`delete from file_yjs where file_id = ${id}`))
  // And another workspace cannot fold this one's.
  const stranger = (await makeOwner()).ctx
  await assert.rejects(withActor(stranger.actorId, (tx) => tx`select file_yjs_fold(${id}, '{}'::uuid[], '\x00'::bytea)`))
})

/* ------------------------------------------------- what the second review found */

/** An update that deletes a thousand characters nobody here ever had. */
function deletesOfNothing(): string {
  const elsewhere = new Y.Doc()
  const t = elsewhere.getText('x')
  t.insert(0, noise(1000))
  t.delete(0, 1000)
  return Buffer.from(Y.encodeStateAsUpdate(elsewhere, Y.encodeStateVector(elsewhere))).toString('base64')
}

test('an update that deletes what the document never had is not kept, and a fold drops what waits on nothing', async () => {
  const { ctx: owner, workspaceId, token } = await makeOwner()
  const p = await makeProject(owner, workspaceId, 'Acme')
  const id = await aDocument(token, p, 'Words.')
  const a = socket()
  const seat = await join(owner, id, a.ws)
  assert.ok(seat)
  const before = await bytesOf(id)
  for (let i = 0; i < 20; i++) await send(seat, deletesOfNothing())
  assert.equal(await bytesOf(id), before, 'nothing of them was kept')
  assert.equal(of(a.said, 'reset').length, 1)
  // Put there some other way, a fold leaves them out.
  for (let i = 0; i < 20; i++) {
    await asTableOwner()`insert into file_yjs (id, workspace_id, file_id, bytes) values (${uuidv7()}, ${workspaceId}, ${id}, ${Buffer.from(deletesOfNothing(), 'base64')})`
  }
  await send(seat, page(a.said[0]!).add('More.'))
  const grown = await bytesOf(id)
  await seat.room.save(false)
  const folded = await bytesOf(id)
  console.log(`  20 deletions of nothing refused; 20 put in directly: ${grown} bytes → folded ${folded}`)
  assert.ok(folded < before + 500, `folded ${folded}`)
  await leave(seat)
})

test('the byte budget is a person’s in a document, not a socket’s', async () => {
  const { ctx: owner, workspaceId, token } = await makeOwner()
  const p = await makeProject(owner, workspaceId, 'Acme')
  const id = await aDocument(token, p, 'Start.')
  const a = socket()
  const first = await join(owner, id, a.ws)
  assert.ok(first)
  await send(first, page(a.said[0]!).add(noise(700_000)))
  await send(first, page(a.said[0]!).add(noise(700_000)))
  await leave(first)
  // A new socket, the same person, the same ten seconds.
  const b = socket()
  const second = await join(owner, id, b.ws)
  assert.ok(second)
  await send(second, page(b.said[0]!).add(noise(700_000)))
  assert.equal(b.closed.code, 4429)
  await leave(second)
})

test('a merge does not write twice what is already there: a retry, a base_rev used twice, a fix made by both', () => {
  const base = doc('a', 'b', 'c', 'd')
  const d = new Y.Doc()
  Y.applyUpdate(d, stateFrom(base))
  mergeInto(d, base, doc('a', 'B1', 'c', 'd'))
  mergeInto(d, base, doc('a', 'B1', 'c', 'D2'))
  const again = mergeInto(d, base, doc('a', 'B1', 'c', 'D2'))
  assert.deepEqual(words(bodyOf(d)), ['a', 'B1', 'c', 'D2'])
  assert.equal(again.changed, false)

  const typo = doc('teh cat')
  const t = new Y.Doc()
  Y.applyUpdate(t, stateFrom(typo))
  const f = t.getXmlFragment(FRAGMENT)
  t.transact(() => {
    f.delete(0, 1)
    f.insert(0, [toElement(doc('the cat').content[0]!)])
  })
  assert.deepEqual(mergeInto(t, typo, doc('the cat')), { changed: false, conflicts: 0 })
  assert.deepEqual(words(bodyOf(t)), ['the cat'])
})

test('a block added before one the people changed lands before it; JSON is compared strictly', () => {
  const base = doc('a', 'b', 'c')
  const d = new Y.Doc()
  Y.applyUpdate(d, stateFrom(base))
  const f = d.getXmlFragment(FRAGMENT)
  d.transact(() => {
    f.delete(1, 1)
    f.insert(1, [toElement(doc('b edited').content[0]!)])
  })
  mergeInto(d, base, doc('a', 'NEW', 'b', 'c'))
  assert.deepEqual(words(bodyOf(d)), ['a', 'NEW', 'b edited', 'c'])

  // A change Markdown cannot say, sent as JSON, is a change.
  const plain = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Centre me' }] }] }
  const centred = {
    type: 'doc',
    content: [{ type: 'paragraph', attrs: { textAlign: 'center' }, content: [{ type: 'text', text: 'Centre me' }] }],
  }
  const e = new Y.Doc()
  Y.applyUpdate(e, stateFrom(plain))
  assert.equal(mergeInto(e, plain, centred).changed, true)
  assert.deepEqual(bodyOf(e).content[0]?.attrs, { textAlign: 'center' })
  // Sent as Markdown, it is not.
  const g = new Y.Doc()
  Y.applyUpdate(g, stateFrom(centred))
  assert.equal(mergeInto(g, centred, plain, true).changed, false)
})

test('the revision moves with versions and API writes, not with every debounced write, and its bodies are kept to a budget', async () => {
  const { ctx: owner, workspaceId, token } = await makeOwner()
  const p = await makeProject(owner, workspaceId, 'Acme')
  const id = await aDocument(token, p, 'One.')
  const revOf = async () => (await asTableOwner()<{ rev: number }[]>`select rev from file where id = ${id}`)[0]!.rev
  const a = socket()
  const seat = await join(owner, id, a.ws)
  assert.ok(seat)
  const me = page(a.said[0]!)
  await send(seat, me.add('Two.'))
  await seat.room.save(false)
  const afterFirst = await revOf()
  for (let i = 0; i < 5; i++) {
    await send(seat, me.add(`Line ${i}.`))
    await seat.room.save(false)
  }
  assert.equal(await revOf(), afterFirst, 'five debounced writes, no new revision')
  // A PATCH is an API write: it moves, and answers the revision.
  const r = (await (await call(token)('PATCH', `/api/files/${id}`, { body: doc('Replaced.') })).json()) as { rev: number }
  assert.equal(r.rev, afterFirst + 1)
  for (let i = 0; i < 12; i++) await call(token)('PATCH', `/api/files/${id}`, { body: doc(`Version ${i}.`) })
  const [kept] = await asTableOwner()<{ n: number }[]>`select count(*)::int as n from file_rev where file_id = ${id}`
  console.log(`  after 13 API writes: rev ${await revOf()}, ${kept!.n} bodies kept`)
  assert.ok(kept!.n <= 10)
  await leave(seat)
})

test('a document with no state refuses a base_rev that is not its revision', async () => {
  const { ctx: owner, workspaceId, token } = await makeOwner()
  const p = await makeProject(owner, workspaceId, 'Acme')
  const id = await aDocument(token, p, 'One.')
  const first = (await (await call(token)('PATCH', `/api/files/${id}`, { body: doc('Two.'), base_rev: 0 })).json()) as { rev: number }
  assert.equal(first.rev, 1)
  const stale = await call(token)('PATCH', `/api/files/${id}`, { body: doc('Three.'), base_rev: 0 })
  assert.equal(stale.status, 409)
  const said = (await stale.json()) as { rev: number; body: unknown }
  assert.equal(said.rev, 1)
  assert.deepEqual(words(said.body), ['Two.'])
  assert.deepEqual(words((await stored(id)).body), ['Two.'])
  const [rows] = await withActor(owner.actorId, (tx) => tx<{ n: number }[]>`select count(*)::int as n from file_yjs where file_id = ${id}`)
  assert.equal(rows?.n, 0)
})

test('nobody folds a document without having been asked whether they may edit it, and a reader’s first look writes as its editor', async () => {
  const { ctx: owner, workspaceId, token } = await makeOwner()
  const p = await makeProject(owner, workspaceId, 'Acme')
  assert.equal((await call(token)('PATCH', '/api/workspace', { edit_others_content: 'own_only' })).status, 200)
  const lee = await addPerson(owner, workspaceId, 'member', [p])
  const id = await aDocument(token, p, 'Before.')
  // The owner may see it and edit it, and still cannot fold it from a bare transaction.
  await assert.rejects(withActor(owner.actorId, (tx) => tx`select file_yjs_fold(${id}, '{}'::uuid[], '\x00'::bytea)`))
  await assert.rejects(
    withActor(
      owner.actorId,
      (tx) => tx`insert into file_rev (workspace_id, file_id, rev, body) values (${workspaceId}, ${id}, 99, '{}'::jsonb)`,
    ),
  )

  // The owner types; the process goes down before the body is written.
  const a = socket()
  const seat = await join(owner, id, a.ws)
  assert.ok(seat)
  await send(seat, page(a.said[0]!).add('Typed before the crash.'))
  seat.gone = true
  seat.room.seats.delete(seat)
  seat.room.dispose()
  const revBefore = (await asTableOwner()<{ rev: number }[]>`select rev from file where id = ${id}`)[0]!.rev
  // A reader opens it first: the body is written, as the owner, the revision unmoved.
  const b = socket()
  const reader = await join(await ctxOf(lee.actorId, workspaceId), id, b.ws)
  assert.ok(reader)
  await pause(400)
  assert.deepEqual(words((await stored(id)).body), ['Before.', 'Typed before the crash.'])
  assert.equal((await asTableOwner()<{ rev: number }[]>`select rev from file where id = ${id}`)[0]!.rev, revBefore)
  await leave(reader)
})

test('a block the caller says twice is written twice, not dropped as already there', () => {
  const base = doc('A', 'B')
  const d = new Y.Doc()
  Y.applyUpdate(d, stateFrom(base))
  // The people put one empty paragraph after A.
  d.getXmlFragment(FRAGMENT).insert(1, [toElement({ type: 'paragraph' })])
  // The caller put two there, on purpose.
  const theirs = { type: 'doc', content: [doc('A').content[0], { type: 'paragraph' }, { type: 'paragraph' }, doc('B').content[0]] }
  mergeInto(d, base, theirs)
  assert.deepEqual(
    bodyOf(d).content.map((b) => b.type + ((b.content as { text?: string }[] | undefined)?.[0]?.text ?? '')),
    ['paragraphA', 'paragraph', 'paragraph', 'paragraphB'],
  )
})
