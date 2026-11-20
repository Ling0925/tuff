import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { BYTE_BUDGET, bytesFor, fromMarkdown, NODE_BUDGET, TABLE_ROWS } from '../src/mcp/markdown.js'
import { corpus } from './markdown-corpus.js'
import { amplifier, attacks, head, N } from './hostile.js'

/**
 * What one body may cost.
 * A body is somebody else's text read on the server's one thread:
 * an agent's, a GitHub issue's, an import's, a scratch board's. Each
 * attack here once took seconds or minutes, or most of a gigabyte. What
 * each may cost in time is `bench/parsers.bench.ts`, out of the gate: a
 * budget in milliseconds is a fact about the machine as much as the code.
 */

type Node = { type: string; content?: Node[]; text?: string }
const count = (n: Node): number => 1 + (n.content ?? []).reduce((s, c) => s + count(c), 0)

for (const [name, body] of attacks) {
  test(`read within the budget: ${name}`, () => {
    const doc = fromMarkdown(body)
    assert.ok(count(doc) <= NODE_BUDGET + 16, `${name}: ${count(doc)} nodes`)
    const size = JSON.stringify(doc).length
    assert.ok(size <= bytesFor(body), `${name}: ${size} bytes`)
  })
}

/* Structure is charged as well as words: sixty-four empty cells a row were
   1.36 MB of JSON from 4 000 characters, a budget that counted only runs
   of words never seeing them. */
test('a short body of wide empty rows comes to its byte budget, not its node budget', () => {
  const body = head + '||\n'.repeat(Math.floor((4_000 - head.length) / 3))
  const size = JSON.stringify(fromMarkdown(body)).length
  assert.ok(size <= bytesFor(body), `${size} bytes for ${body.length} characters`)
})

/* Nodes charged less than they cost: an empty quote's paragraph was not
   charged at all, a heading and a callout's attributes too little — 1.79,
   1.70, 1.62 and 1.10 MB against a megabyte's budget. Each is within it
   now, and still read as what it is. */
const fill = (unit: string) => unit.repeat(Math.floor(N / unit.length))
for (const [name, body, first] of [
  ['empty quotes', fill('>\n\n'), 'blockquote'],
  ['empty headings', fill('# \n'), 'heading'],
  ['empty callouts', fill('> [!NOTE]\n\n'), 'callout'],
  ['empty folds', fill('<details>\n</details>\n'), 'details'],
] as const) {
  test(`a body of ${name} comes to at most its byte budget`, () => {
    const doc = fromMarkdown(body)
    const size = JSON.stringify(doc).length
    assert.ok(size <= bytesFor(body), `${size} bytes against ${bytesFor(body)}`)
    assert.equal((doc.content as Node[])[0]!.type, first)
  })
}

test('past the budget the rest of the body is one plain paragraph of its words', () => {
  const doc = fromMarkdown('- **a**\n'.repeat(30_000) + '\nlast *words*')
  const blocks = doc.content as Node[]
  assert.equal(blocks.length, 2)
  assert.equal(blocks[0]!.type, 'bulletList')
  const tail = blocks[1]!
  assert.equal(tail.type, 'paragraph')
  assert.equal(tail.content?.length, 1)
  assert.ok(tail.content?.[0]?.text?.startsWith('- **a** - **a**'))
  assert.ok(tail.content?.[0]?.text?.endsWith('last *words*'))
})

test('quotes inside quotes share one budget', () => {
  const doc = fromMarkdown('> > > - a\n'.repeat(40_000))
  assert.ok(count(doc) <= NODE_BUDGET + 16, String(count(doc)))
})

test(`a table holds ${TABLE_ROWS} rows, and the rows past them are their words`, () => {
  const rows = Array.from({ length: 1500 }, (_, k) => `| ${k} | v |`).join('\n')
  const doc = fromMarkdown(`| k | v |\n|---|---|\n${rows}\n\nafter`)
  const [table, past, after] = doc.content as Node[]
  assert.equal(table!.type, 'table')
  assert.equal(table!.content?.length, TABLE_ROWS + 1)
  assert.equal(past!.type, 'paragraph')
  assert.ok(past!.content?.[0]?.text?.startsWith(`| ${TABLE_ROWS} | v | | ${TABLE_ROWS + 1} | v |`))
  assert.equal(after!.content?.[0]?.text, 'after')
})

/* A link's address is on every run of words inside it: a link over a
   hundred and fifty italics carried its two thousand characters a hundred
   and fifty times — 26.86 MB from 198 230 characters. How long
   it takes is `bench/parsers.bench.ts`. */

test('a body comes to at most its byte budget, however its links are marked', () => {
  for (const body of [amplifier.repeat(Math.floor(N / amplifier.length)), `${amplifier}\n\n`.repeat(Math.floor(N / amplifier.length))]) {
    const size = JSON.stringify(fromMarkdown(body)).length
    assert.ok(size <= BYTE_BUDGET + body.length + 400_000, `${size} bytes`)
  }
})

test('past the byte budget the rest of the body is its own words', () => {
  const doc = fromMarkdown(`${amplifier}\n\n`.repeat(20) + 'last *words*')
  const blocks = doc.content as Node[]
  const tail = blocks[blocks.length - 1]!
  assert.ok(blocks.length > 2 && blocks.length < 20, String(blocks.length))
  assert.equal(tail.content?.length, 1)
  assert.ok(tail.content?.[0]?.text?.endsWith('last *words*'))
})

/* Every body below was read by the parser before it had limits, and its
   document written to `markdown-regression.json`: the limits change
   nothing an ordinary body becomes. */
test('ordinary bodies read exactly as they did before the limits', () => {
  const before = JSON.parse(readFileSync(new URL('./markdown-regression.json', import.meta.url), 'utf8')) as Record<string, unknown>
  assert.deepEqual(Object.keys(before).sort(), Object.keys(corpus).sort())
  for (const [name, body] of Object.entries(corpus)) assert.deepEqual(fromMarkdown(body), before[name], name)
})
