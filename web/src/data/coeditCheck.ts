import * as Y from 'yjs'
import type { Schema } from '@tiptap/pm/model'

/*
 * What a page writing a document together will not take from the room.
 * Apart from the session and the editor so the
 * tests can ask them without either.
 */

type CaretState = Record<string, unknown>

/**
 * Whether a caret from the room can be drawn: a cursor whose two ends are
 * positions this document can resolve, or no cursor. One that cannot — a
 * page sending `{ cursor: {} }` — would throw inside the editor's caret
 * plugin on every redraw, for everybody; it is dropped here instead.
 * The server rebuilds carets too (`cleanCaret` in `server/src/coedit.ts`).
 */
export function drawable(doc: Y.Doc, s: CaretState): boolean {
  try {
    const cursor = s.cursor as { anchor?: unknown; head?: unknown } | null | undefined
    if (cursor === null || cursor === undefined) return true
    if (typeof cursor !== 'object') return false
    for (const end of [cursor.anchor, cursor.head]) {
      if (typeof end !== 'object' || end === null) return false
      const rel = Y.createRelativePositionFromJSON(end)
      if (rel.type === null && rel.item === null && rel.tname === null) return false
      Y.createAbsolutePositionFromRelativePosition(rel, doc)
    }
    return true
  } catch {
    return false
  }
}

/**
 * Whether every node and mark the state holds is one this editor knows.
 * One it does not — an old tab across a deploy that added a block — would
 * be deleted by the binding as invalid, and the deletion sent to everybody.
 */
export function fits(fragment: Y.XmlFragment, schema: Schema): boolean {
  const walk = (item: unknown): boolean => {
    if (item instanceof Y.XmlElement) {
      if (!schema.nodes[item.nodeName]) return false
      return item.toArray().every(walk)
    }
    if (item instanceof Y.XmlText) {
      return (item.toDelta() as { attributes?: Record<string, unknown> }[]).every((d) =>
        Object.keys(d.attributes ?? {}).every((name) => Boolean(schema.marks[name.replace(/--[a-zA-Z0-9+/=]{8}$/, '')])),
      )
    }
    return true
  }
  return fragment.toArray().every(walk)
}

/**
 * Whether an update brings a node or a mark this editor does not know —
 * asked before it is applied, so the page stops writing before the binding
 * sees the node and deletes it as invalid. An old tab open across a deploy
 * would otherwise delete, for everybody, the first new block somebody
 * wrote into the document while it was open.
 */
export function strangerIn(update: Uint8Array, schema: Schema): boolean {
  const { structs } = Y.decodeUpdate(update)
  for (const s of structs) {
    if (!(s instanceof Y.Item)) continue
    const c = s.content
    if (c instanceof Y.ContentType && c.type instanceof Y.XmlElement && !schema.nodes[c.type.nodeName]) return true
    if (c instanceof Y.ContentFormat && c.value !== null && !schema.marks[c.key.replace(/--[a-zA-Z0-9+/=]{8}$/, '')]) return true
  }
  return false
}
