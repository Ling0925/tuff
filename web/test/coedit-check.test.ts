import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as Y from 'yjs'
import { Schema } from '@tiptap/pm/model'
import { drawable, fits, strangerIn } from '../src/data/coeditCheck.js'

/*
 * What a page writing a document together will not take from the room.
 */

const schema = new Schema({
  nodes: { doc: { content: 'block+' }, paragraph: { group: 'block', content: 'text*' }, text: {} },
  marks: { bold: {} },
})

/** A page's update: whatever `write` does to a fresh copy of `base`. */
function updateOf(base: Y.Doc, write: (f: Y.XmlFragment) => void): Uint8Array {
  const copy = new Y.Doc()
  Y.applyUpdate(copy, Y.encodeStateAsUpdate(base))
  const sv = Y.encodeStateVector(copy)
  write(copy.getXmlFragment('default'))
  return Y.encodeStateAsUpdate(copy, sv)
}

test('an update with a block this editor does not know is caught before it lands', () => {
  const base = new Y.Doc()
  base.getXmlFragment('default').insert(0, [new Y.XmlElement('paragraph')])
  const known = updateOf(base, (f) => f.insert(1, [new Y.XmlElement('paragraph')]))
  const callout = updateOf(base, (f) => f.insert(1, [new Y.XmlElement('callout')]))
  assert.equal(strangerIn(known, schema), false)
  assert.equal(strangerIn(callout, schema), true)

  // A mark it does not know, too.
  const marked = updateOf(base, (f) => {
    const t = new Y.XmlText()
    t.applyDelta([{ insert: 'hi', attributes: { highlight: {} } }])
    ;(f.get(0) as Y.XmlElement).insert(0, [t])
  })
  assert.equal(strangerIn(marked, schema), true)

  // And the state as a whole, on the way in.
  Y.applyUpdate(base, callout)
  assert.equal(fits(base.getXmlFragment('default'), schema), false)
})

test('a caret that cannot be resolved is not drawn', () => {
  const doc = new Y.Doc()
  const f = doc.getXmlFragment('default')
  f.insert(0, [new Y.XmlElement('paragraph')])
  const at = JSON.parse(JSON.stringify(Y.createRelativePositionFromTypeIndex(f, 0)))
  assert.equal(drawable(doc, { cursor: { anchor: at, head: at } }), true)
  assert.equal(drawable(doc, { cursor: null }), true)
  assert.equal(drawable(doc, { cursor: {} }), false)
  assert.equal(drawable(doc, { cursor: { anchor: {}, head: {} } }), false)
  assert.equal(drawable(doc, { cursor: { anchor: 'x', head: at } }), false)
})
