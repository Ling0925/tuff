import { test } from 'node:test'
import assert from 'node:assert/strict'
import { markdown } from '../src/prompt.js'

const text = (t: string) => ({ type: 'text', text: t })
const cell = (type: 'tableHeader' | 'tableCell', t: string) => ({
  type,
  content: [{ type: 'paragraph', content: t ? [text(t)] : [] }],
})

/**
 * A table reaches an agent as a Markdown table.
 *
 * The first row is the header whether or not it was drawn as one, since
 * Markdown has none without it; a pipe written in a cell is escaped, so the
 * columns read are the ones that were written; a short row is padded.
 */
test('a table in a body becomes a Markdown table', () => {
  const body = {
    type: 'doc',
    content: [
      {
        type: 'table',
        content: [
          { type: 'tableRow', content: [cell('tableHeader', 'Step'), cell('tableHeader', 'Who')] },
          { type: 'tableRow', content: [cell('tableCell', 'Draft a | b'), cell('tableCell', 'Sam')] },
          { type: 'tableRow', content: [cell('tableCell', 'Ship')] },
        ],
      },
    ],
  }
  assert.equal(
    markdown(body, () => null, []),
    ['| Step | Who |', '| --- | --- |', '| Draft a \\| b | Sam |', '| Ship |  |'].join('\n'),
  )
})

/* A callout reaches an agent as a quote with its emoji, or as GitHub's own
   alert when it is one; a toggle as HTML's fold. */
test('a callout and a toggle become Markdown an agent and GitHub read', () => {
  const para = (t: string) => ({ type: 'paragraph', content: [text(t)] })
  const body = {
    type: 'doc',
    content: [
      { type: 'callout', attrs: { emoji: '🔥', tone: 'red' }, content: [para('Hot'), para('Two')] },
      { type: 'callout', attrs: { emoji: '⚠️', tone: 'yellow' }, content: [para('Careful')] },
      {
        type: 'details',
        content: [
          { type: 'detailsSummary', content: [text('Why <b>')] },
          { type: 'detailsContent', content: [para('Because.')] },
        ],
      },
    ],
  }
  assert.equal(
    markdown(body, () => null, []),
    [
      '> 🔥 Hot',
      '>',
      '> Two',
      '',
      '> [!WARNING]',
      '> Careful',
      '',
      '<details>',
      '<summary>Why &lt;b&gt;</summary>',
      '',
      'Because.',
      '',
      '</details>',
    ].join('\n'),
  )
})
