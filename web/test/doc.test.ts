import { test } from 'node:test'
import assert from 'node:assert/strict'
import { asDoc, namedIn, plain, retext, type Named } from '../src/data/doc.js'

const sam: Named = { label: '@Sam', node: { type: 'mention', attrs: { id: 's', label: 'Sam' } } }
const samantha: Named = { label: '@Samantha', node: { type: 'mention', attrs: { id: 'sa', label: 'Samantha' } } }
const inline = (doc: unknown) => (doc as { content: { content: unknown[] }[] }).content[0]!.content

/* docs/specs/task-mentions.md — a name is matched whole, longest first. */
test('@Sam is not the start of @Samantha', () => {
  assert.deepEqual(inline(asDoc('@Samantha and @Sam', [], [sam, samantha])), [samantha.node, { type: 'text', text: ' and ' }, sam.node])
  assert.deepEqual(inline(asDoc('ask @Samantha', [], [sam])), [{ type: 'text', text: 'ask @Samantha' }])
})

test('an edit that leaves a name alone keeps the mention', () => {
  const body = asDoc('thanks @Sam for this', [], [sam])
  assert.equal(plain(body), 'thanks @Sam for this')
  const edited = retext(body, 'thanks @Sam for all this', namedIn(body))
  assert.deepEqual(inline(edited)[1], sam.node)
})
