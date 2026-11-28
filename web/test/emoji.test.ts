import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { find, type EmojiGroup } from '../src/data/emojiFind.js'

/* docs/specs/emoji.md */
type Row = [string, string, string?, string?, number?]
const read = (lang: string): EmojiGroup[] =>
  (
    JSON.parse(readFileSync(new URL(`../src/data/emoji/${lang}.json`, import.meta.url), 'utf8')) as { groups: { id: string; e: Row[] }[] }
  ).groups.map((g) => ({ id: g.id, e: g.e.map((r) => ({ e: r[0], name: r[1], words: r[2] ?? '', tone: r[3] || null })) }))
const en = read('en')
const fr = read('fr')
const zh = read('zh')

/* The server's test for a reaction, `server/src/http/chat.ts`. */
const SERVER = /^[\p{Extended_Pictographic}\p{Emoji_Component}‍️⃣]+$/u

test('every emoji offered is one the server takes as a reaction, in every tone', () => {
  let n = 0
  for (const g of en)
    for (const x of g.e) {
      for (const e of [x.e, ...(x.tone ? ['🏻', '🏼', '🏽', '🏾', '🏿'].map((t) => x.tone!.replaceAll('🏻', t)) : [])]) {
        assert.ok(SERVER.test(e) && e.length <= 16, `${e} ${x.name}`)
        n++
      }
    }
  assert.ok(n > 3000, `all of Unicode, not a short set: ${n}`)
})

test('the three languages hold the same emoji in the same order', () => {
  const order = en.flatMap((g) => g.e.map((x) => x.e))
  assert.deepEqual(
    fr.flatMap((g) => g.e.map((x) => x.e)),
    order,
  )
  assert.deepEqual(
    zh.flatMap((g) => g.e.map((x) => x.e)),
    order,
  )
})

test('a word finds it, the closest name first', () => {
  assert.equal(find(en, 'rocket')[0]?.e, '🚀')
  assert.equal(find(en, 'thumbs up')[0]?.e, '👍')
  assert.equal(find(en, 'flag fra')[0]?.e, '🇫🇷')
  assert.ok(
    find(en, 'heart')
      .slice(0, 3)
      .some((x) => x.e === '❤️'),
  )
  assert.equal(find(en, 'zzqx').length, 0)
  /* In French, without its accents, and by its English name too. */
  assert.equal(find(fr, 'fusee')[0]?.e, '🚀')
  assert.equal(find(fr, 'rocket')[0]?.e, '🚀')
  /* In Chinese, and by its English name too. */
  assert.equal(find(zh, '火箭')[0]?.e, '🚀')
  assert.equal(find(zh, 'rocket')[0]?.e, '🚀')
})
