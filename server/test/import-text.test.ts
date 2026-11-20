import { test } from 'node:test'
import assert from 'node:assert/strict'
import { adfToMarkdown, asanaHtmlToMarkdown } from '../src/importText.js'

/* Somebody else's text, read in one pass. */
test('Jira’s document reads as Markdown, links only to the web', () => {
  const md = adfToMarkdown({
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Plan' }] },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'see ' },
          { type: 'text', text: 'here', marks: [{ type: 'link', attrs: { href: 'https://example.com/a b' } }] },
          { type: 'text', text: ' and ' },
          { type: 'text', text: 'there', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] },
          { type: 'hardBreak' },
          { type: 'mention', attrs: { text: '@Ann' } },
        ],
      },
      { type: 'orderedList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }] }] },
      { type: 'codeBlock', content: [{ type: 'text', text: 'x = 1' }] },
      {
        type: 'table',
        content: [
          {
            type: 'tableRow',
            content: [{ type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a|b' }] }] }],
          },
        ],
      },
    ],
  })
  assert.equal(md, '## Plan\n\nsee [here](https://example.com/a%20b) and there\n@Ann\n\n1. one\n\n```\nx = 1\n```\n\n| a/b |\n| --- |')
  assert.equal(adfToMarkdown(null), '')
  assert.equal(adfToMarkdown('plain'), 'plain')
})

test('Asana’s notes read as Markdown, and no tag is taken as HTML', () => {
  assert.equal(
    asanaHtmlToMarkdown(
      '<body>Hi <strong>there</strong> &amp; <a href="https://x.example">x</a> <a href="javascript:1">y</a>\n<ul><li>one</li><li>two</li></ul><h1>Head</h1><script>bad()</script></body>',
    ),
    'Hi **there** & [x](https://x.example) y\n\n- one\n- two\n\n# Head\n\nbad()',
  )
  assert.equal(asanaHtmlToMarkdown('<pre>a\n\nb</pre>'), '```\na\n\nb\n```')
})

/* What it costs in time is `bench/parsers.bench.ts`; here, that each is
   read through, and the wide row stays narrow. */
test('long and deeply nested input is read through', () => {
  let deep: unknown = { type: 'text', text: 'x' }
  for (let i = 0; i < 5000; i++) deep = { type: 'paragraph', content: [deep] }
  adfToMarkdown({ type: 'doc', content: [deep] })
  adfToMarkdown({
    type: 'doc',
    content: Array.from({ length: 200_000 }, () => ({ type: 'paragraph', content: [{ type: 'text', text: 'x' }] })),
  })
  // One wide row does not widen ten thousand narrow ones.
  const cell = { type: 'tableCell', content: [] }
  const wide = adfToMarkdown({
    type: 'doc',
    content: [
      {
        type: 'table',
        content: [
          { type: 'tableRow', content: Array.from({ length: 10_000 }, () => cell) },
          ...Array.from({ length: 10_000 }, () => ({ type: 'tableRow', content: [cell] })),
        ],
      },
    ],
  })
  assert.ok(wide.length < 400_000, `${wide.length}`)
  asanaHtmlToMarkdown('<'.repeat(200_000))
  asanaHtmlToMarkdown('<a href="'.repeat(40_000))
  asanaHtmlToMarkdown('<ul><li>'.repeat(50_000))
  asanaHtmlToMarkdown('&#'.repeat(100_000) + '&amp;'.repeat(50_000))
})
