import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import * as Y from 'yjs'
import type { WSContext } from 'hono/ws'
import { app } from '../src/http/routes.js'
import { closeRealtime } from '../src/realtime.js'
import { budgetOf, heard, join, leave, type Seat } from '../src/coedit.js'
import { FRAGMENT, toElement } from '../src/yjson.js'
import { asTableOwner, closeDb, makeOwner, makeProject } from '../test/helpers.js'
import { tookAsync } from './time.js'

/*
 * What a document written together costs in time — the budgets of
 * `co-editing.test.ts` and `selection-comments.test.ts`, out of `pnpm check`.
 * The tests keep what happens: refused, measured once, answered
 * without waiting. How long it took is held here, on a quiet machine.
 */

after(async () => {
  await closeRealtime()
  await closeDb()
})

const para = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] })
const doc = (...lines: string[]) => ({ type: 'doc', content: lines.map(para) })
const b64 = (u: Uint8Array) => Buffer.from(u).toString('base64')
const call = (token: string) => (method: string, path: string, body?: unknown) =>
  app.request(path, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

async function aDocument(token: string, projectId: string, ...lines: string[]): Promise<string> {
  const made = await call(token)('POST', `/api/projects/${projectId}/files`, { name: 'Brief', body: doc(...lines) })
  assert.equal(made.status, 201)
  return ((await made.json()) as { id: string }).id
}

function socket() {
  const said: { t: string; u?: string }[] = []
  const ws = { send: (f: string) => said.push(JSON.parse(f)), close: () => {}, readyState: 1 } as unknown as WSContext
  return { ws, said }
}

/** A page on the server's words, and the update that adds a line to it. */
function page(sync: { u?: string }) {
  const d = new Y.Doc()
  Y.applyUpdate(d, new Uint8Array(Buffer.from(sync.u ?? '', 'base64')))
  return {
    add(text: string): string {
      let out: Uint8Array | null = null
      const grab = (u: Uint8Array) => {
        out = u
      }
      d.on('update', grab)
      const f = d.getXmlFragment(FRAGMENT)
      f.insert(f.length, [toElement(para(text))])
      d.off('update', grab)
      return b64(out!)
    },
  }
}

async function send(seat: Seat, u: string) {
  heard(seat, JSON.stringify({ t: 'u', u }))
  await seat.queue
}

const bytesOf = async (fileId: string) =>
  (await asTableOwner()<{ n: number }[]>`select coalesce(sum(length(bytes)), 0)::int as n from file_yjs where file_id = ${fileId}`)[0]!.n
const noise = (n: number) => Array.from({ length: n }, (_, i) => String.fromCharCode(97 + ((i * 7919) % 26))).join('')

/** A document filled to within a few bytes of its cap: ever smaller pieces until none fits. */
async function fill(seat: Seat, a: { said: { t: string; u?: string }[] }, id: string): Promise<void> {
  for (const n of [1_000_000, 100_000, 10_000, 1000, 100, 10]) {
    for (;;) {
      const was = await bytesOf(id)
      await send(seat, page(a.said.filter((m) => m.t === 'sync').at(-1)!).add(noise(n)))
      if ((await bytesOf(id)) === was) break
      a.said.push({ t: 'sync', u: b64(Y.encodeStateAsUpdate(seat.room.doc)) })
    }
  }
}

test('a hundred keystrokes into a full document are refused in under 200 ms together', async (t) => {
  const { ctx: owner, workspaceId, token } = await makeOwner()
  const p = await makeProject(owner, workspaceId, 'Acme')
  const id = await aDocument(token, p, 'Start.')
  const a = socket()
  const seat = await join(owner, id, a.ws)
  assert.ok(seat)
  budgetOf(owner.actorId, id).bytes = { add: () => 0 } as never
  await fill(seat, a, id)
  const last = a.said.filter((m) => m.t === 'sync').at(-1)!
  /* Each made beforehand, so only the server's answer is timed. */
  const keys = Array.from({ length: 100 }, () => page(last).add('x'))
  let ms = 0
  for (const u of keys) ms += await tookAsync(() => seat.room.take(seat, u))
  t.diagnostic(`100 updates into a full ${(seat.room.size / 1e6).toFixed(2)} MB document: ${ms.toFixed(0)} ms`)
  assert.ok(ms < 200, `took ${ms} ms`)
  await leave(seat)
})

/** Two relative positions over `words` in the first paragraph that has them. */
function positions(d: Y.Doc, words: string): { from: string; to: string } {
  for (const block of d.getXmlFragment(FRAGMENT).toArray()) {
    const t = (block as Y.XmlElement).get(0)
    if (!(t instanceof Y.XmlText)) continue
    const plain = (t.toDelta() as { insert: unknown }[]).map((x) => (typeof x.insert === 'string' ? x.insert : '')).join('')
    const at = plain.indexOf(words)
    if (at < 0) continue
    return {
      from: b64(Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(t, at))),
      to: b64(Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(t, at + words.length))),
    }
  }
  throw new Error(`no "${words}"`)
}

async function stateOf(fileId: string): Promise<Y.Doc> {
  const rows = await asTableOwner()<{ bytes: Uint8Array }[]>`select bytes from file_yjs where file_id = ${fileId}`
  const d = new Y.Doc()
  Y.applyUpdate(d, Y.mergeUpdates(rows.map((r) => new Uint8Array(r.bytes))))
  return d
}

test('an anchor that cannot be read is refused at once, not after the wait for words on their way', async () => {
  const { ctx: owner, workspaceId, token } = await makeOwner()
  const p = await makeProject(owner, workspaceId, 'Acme')
  const id = await aDocument(token, p, 'Words that will go away.')
  const seat = await join(owner, id, socket().ws)
  assert.ok(seat)
  const comment = (anchor: unknown) => call(token)('POST', `/api/files/${id}/comments`, { body: doc('x'), anchor })

  const junk = { from: Buffer.from('not a position at all').toString('base64'), to: 'AAAA' }
  let status = 0
  const garbage = await tookAsync(async () => {
    status = (await comment(junk)).status
  })
  assert.equal(status, 409)
  assert.ok(garbage < 300, `garbage anchor answered in ${Math.round(garbage)} ms`)

  const gone = positions(await stateOf(id), 'will go away')
  assert.equal((await call(token)('PATCH', `/api/files/${id}`, { body: doc('Other words now.') })).status, 200)
  const deleted = await tookAsync(async () => {
    status = (await comment(gone)).status
  })
  assert.equal(status, 409)
  assert.ok(deleted < 300, `deleted words answered in ${Math.round(deleted)} ms`)
  await leave(seat)
})
