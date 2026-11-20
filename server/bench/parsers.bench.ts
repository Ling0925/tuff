import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fromMarkdown } from '../src/mcp/markdown.js'
import { adfToMarkdown, asanaHtmlToMarkdown } from '../src/importText.js'
import { handlesIn } from '../src/github.js'
import { cardFrom } from '../src/http/preview.js'
import { sniff } from '../src/http/files.js'
// @ts-expect-error — plain JavaScript, deployed to Cloudflare on its own.
import { sniff as edgeSniff } from '../../cdn/worker.js'
import { fromSlack } from '../src/slackIn.js'
import { amplifier, attacks, N, worstSlack } from '../test/hostile.js'
import { took } from './time.js'

/*
 * What somebody else's text costs the server's one thread, in time — the
 * budgets the tests used to hold, moved out of `pnpm check`. The
 * tests keep what each input becomes: refused, capped, within its nodes and
 * bytes. A budget in milliseconds is a fact about the machine as much as the
 * code, and in the gate it failed whenever something else was using the
 * machine. `pnpm bench`, on a quiet one.
 */

for (const [name, body] of attacks) {
  test(`Markdown made to be slow is read in a moment: ${name}`, () => {
    const ms = took(() => fromMarkdown(body))
    assert.ok(ms < 1000, `${name}: ${Math.round(ms)} ms`)
  })
}

test('Markdown whose links are marked over and over is read in a moment', () => {
  for (const body of [amplifier.repeat(Math.floor(N / amplifier.length)), `${amplifier}\n\n`.repeat(Math.floor(N / amplifier.length))]) {
    const ms = took(() => fromMarkdown(body))
    assert.ok(ms < 1000, `${Math.round(ms)} ms`)
  }
})

test('Markdown of marks that never close, and of addresses, is read in a moment', () => {
  for (const attack of [
    '[a',
    '![a',
    '**a',
    '*a ',
    '`a',
    '_a ',
    '~~a',
    'https://',
    'www.',
    'https://a.co ',
    'http://(((',
    'xhttps://a.co',
  ]) {
    const ms = took(() => fromMarkdown(attack.repeat(200_000 / attack.length)))
    assert.ok(ms < 1500, `${attack}: ${Math.round(ms)} ms`)
  }
})

test('a heading of spaces, a quote a thousand deep and a fold that never closes are read at once', () => {
  for (const [body, most] of [
    ['# a' + ' '.repeat(16_000) + 'x', 200],
    ['# ' + '#'.repeat(200_000) + 'x', 200],
    ['> '.repeat(5000) + 'deep', 500],
    ['<details>\n'.repeat(5_000), 1500],
  ] as const) {
    const ms = took(() => fromMarkdown(body))
    assert.ok(ms < most, `${body.slice(0, 12)}…: ${Math.round(ms)} ms`)
  }
})

test('long and deeply nested imports cost their length', () => {
  let deep: unknown = { type: 'text', text: 'x' }
  for (let i = 0; i < 5000; i++) deep = { type: 'paragraph', content: [deep] }
  const cell = { type: 'tableCell', content: [] }
  const ms = took(() => {
    adfToMarkdown({ type: 'doc', content: [deep] })
    adfToMarkdown({
      type: 'doc',
      content: Array.from({ length: 200_000 }, () => ({ type: 'paragraph', content: [{ type: 'text', text: 'x' }] })),
    })
    adfToMarkdown({
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
    asanaHtmlToMarkdown('<'.repeat(200_000))
    asanaHtmlToMarkdown('<a href="'.repeat(40_000))
    asanaHtmlToMarkdown('<ul><li>'.repeat(50_000))
    asanaHtmlToMarkdown('&#'.repeat(100_000) + '&amp;'.repeat(50_000))
  })
  assert.ok(ms < 2000, `${Math.round(ms)} ms`)
})

test('a commit message of spaces is read for its task numbers at once', () => {
  const ms = took(() => handlesIn(`fix${' '.repeat(200_000)}x`, 'RED'))
  assert.ok(ms < 100, `${Math.round(ms)} ms`)
})

test('a page made to be slow to read is read at once for its card', () => {
  const at = new URL('https://example.com/x')
  const ms = took(() => cardFrom('<meta'.repeat(200_000) + '<title'.repeat(100_000), at.href, at))
  assert.ok(ms < 200, `${Math.round(ms)} ms`)
})

test('comments in front of nothing are sniffed at once, here and at the edge', () => {
  const bytes = new TextEncoder().encode('<!---->'.repeat(140) + 'x')
  const ms = took(() => {
    sniff(bytes)
    edgeSniff(bytes)
  })
  assert.ok(ms < 50, `${Math.round(ms)} ms`)
})

test('the worst a webhook can send costs a few milliseconds', () => {
  /* Warm, so the first measured is not the module compiling. */
  fromSlack({ text: 'warm *up*' })
  for (const payload of worstSlack) {
    /* The best of three. Each measured alone is under 8 ms. */
    const ms = took(() => fromSlack(payload), 3)
    assert.ok(ms < 30, `${JSON.stringify(payload).slice(0, 30)}… took ${Math.round(ms)} ms`)
  }
})
