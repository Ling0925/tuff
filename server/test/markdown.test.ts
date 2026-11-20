import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fromMarkdown } from '../src/mcp/markdown.js'

/**
 * Markdown from an agent or from a GitHub issue, as the editor's document.
 * Both are somebody else's text, read on the
 * server's one thread.
 */
test('the marks a model writes become the editor’s marks', () => {
  const doc = fromMarkdown('**bold** and [link](https://example.com) `code` _it_ ~~gone~~ [bad](javascript:void)')
  const marks = (doc.content?.[0]?.content ?? []).map((n) => [n.text, (n.marks ?? []).map((m) => m.type).join()])
  assert.deepEqual(marks, [
    ['bold', 'bold'],
    [' and ', ''],
    ['link', 'link'],
    [' ', ''],
    ['code', 'code'],
    [' ', ''],
    ['it', 'italic'],
    [' ', ''],
    ['gone', 'strike'],
    [' bad', ''],
  ])
})

/* Unbounded, every `[` was tried against the whole rest of the text: 256 KB
   of `[a` was twenty seconds, five megabytes hours. How long each takes is
   `bench/parsers.bench.ts`; here, that each is read as a document. */
test('text made to be slow to read is read', () => {
  for (const attack of ['[a', '![a', '**a', '*a ', '`a', '_a ', '~~a']) {
    assert.equal(fromMarkdown(attack.repeat(200_000 / attack.length)).type, 'doc', attack)
  }
})

/* A heading of a few thousand spaces held the thread for minutes, and a
   thousand `>` ran the stack out. */
test('a heading of spaces and a quote a thousand deep are read', () => {
  const d = fromMarkdown('# a' + ' '.repeat(16_000) + 'x')
  assert.equal(d.content?.[0]?.type, 'heading')
  assert.equal(fromMarkdown('## Title ##').content?.[0]?.content?.[0]?.text, 'Title')
  assert.equal(fromMarkdown('# C#').content?.[0]?.content?.[0]?.text, 'C#')
  assert.equal(fromMarkdown('# ' + '#'.repeat(200_000) + 'x').type, 'doc')
  assert.equal(fromMarkdown('> '.repeat(5000) + 'deep').content?.[0]?.type, 'blockquote')
})

/* An address an agent pastes is a link, wherever it stands. */
const links = (md: string) =>
  (fromMarkdown(md).content?.[0]?.content ?? []).map((n) => [n.text, (n.marks ?? []).find((m) => m.type === 'link')?.attrs?.href ?? null])

test('a bare address is a link, and the sentence’s punctuation is not part of it', () => {
  assert.deepEqual(links('See https://example.com/a.'), [
    ['See ', null],
    ['https://example.com/a', 'https://example.com/a'],
    ['.', null],
  ])
  assert.deepEqual(links('(https://example.com/a), then http://x.io/b?c=1!'), [
    ['(', null],
    ['https://example.com/a', 'https://example.com/a'],
    ['), then ', null],
    ['http://x.io/b?c=1', 'http://x.io/b?c=1'],
    ['!', null],
  ])
  /* A bracket the address opened is its own. */
  assert.deepEqual(links('https://en.wikipedia.org/wiki/Heat_(1995_film)'), [
    ['https://en.wikipedia.org/wiki/Heat_(1995_film)', 'https://en.wikipedia.org/wiki/Heat_(1995_film)'],
  ])
  /* Underscores and stars inside an address are not emphasis. */
  assert.deepEqual(links('go to https://x.com/a_b_c/*d*'), [
    ['go to ', null],
    ['https://x.com/a_b_c/*d', 'https://x.com/a_b_c/*d'],
    ['*', null],
  ])
})

test('www. is a link to https, and a word with www in it is not', () => {
  assert.deepEqual(links('at www.example.com, not awww.example.com or me@www.example.com'), [
    ['at ', null],
    ['www.example.com', 'https://www.example.com'],
    [', not awww.example.com or me@www.example.com', null],
  ])
  assert.deepEqual(links('just https:// or www.x'), [['just https:// or www.x', null]])
})

test('code is never linked, and a written link keeps its own words', () => {
  assert.deepEqual(links('`https://example.com` and [https://a.com](https://b.com)'), [
    ['https://example.com', null],
    [' and ', null],
    ['https://a.com', 'https://b.com'],
  ])
  const block = fromMarkdown('```\nhttps://example.com\n```').content?.[0]
  assert.equal(block?.type, 'codeBlock')
  assert.equal(block?.content?.[0]?.marks, undefined)
})

test('only the web is linked: a bare javascript: or data: stays words', () => {
  assert.deepEqual(links('javascript:alert(1) data:text/html,x ftp://x.com'), [['javascript:alert(1) data:text/html,x ftp://x.com', null]])
  /* An address inside emphasis is linked inside it. */
  const bold = fromMarkdown('**see https://x.com**').content?.[0]?.content?.[1]
  assert.deepEqual(
    (bold?.marks ?? []).map((m) => m.type),
    ['bold', 'link'],
  )
})

test('a long text of addresses and near-addresses is read', () => {
  for (const attack of ['https://', 'www.', 'https://a.co ', 'http://(((', 'xhttps://a.co']) {
    assert.equal(fromMarkdown(attack.repeat(200_000 / attack.length)).type, 'doc', attack)
  }
})

/* GitHub's alerts and HTML's fold are the editor's callout and toggle;
   anything else quoted stays a quote. */
test('an alert is a callout and a details block is a toggle', () => {
  const doc = fromMarkdown(
    [
      '> [!WARNING]',
      '> Mind the **gap**.',
      '',
      '> [!tip] Inline words',
      '',
      '> 💡 just a quote',
      '',
      '<details>',
      '<summary>More &lt;here&gt;</summary>',
      '',
      '- one',
      '- two',
      '</details>',
      '',
      'After.',
    ].join('\n'),
  )
  const [warning, tip, quote, toggle, after] = doc.content ?? []
  assert.equal(warning?.type, 'callout')
  assert.deepEqual(warning?.attrs, { emoji: '⚠️', tone: 'yellow' })
  assert.equal(warning?.content?.[0]?.content?.[1]?.text, 'gap')
  assert.equal(tip?.type, 'callout')
  assert.equal(tip?.attrs?.tone, 'green')
  assert.equal(tip?.content?.[0]?.content?.[0]?.text, 'Inline words')
  assert.equal(quote?.type, 'blockquote')
  assert.equal(toggle?.type, 'details')
  assert.equal(toggle?.content?.[0]?.type, 'detailsSummary')
  assert.equal(toggle?.content?.[0]?.content?.[0]?.text, 'More <here>')
  assert.equal(toggle?.content?.[1]?.type, 'detailsContent')
  assert.equal(toggle?.content?.[1]?.content?.[0]?.type, 'bulletList')
  assert.equal(after?.type, 'paragraph')
})

test('a fold that never closes, or folds a thousand deep, is read', () => {
  const doc = fromMarkdown('<details>\n'.repeat(5_000))
  assert.equal(doc.content?.[0]?.type, 'details')
  const unclosed = fromMarkdown('<details><summary>Open</summary>\nwords')
  assert.equal(unclosed.content?.[0]?.content?.[1]?.content?.[0]?.content?.[0]?.text, 'words')
})
