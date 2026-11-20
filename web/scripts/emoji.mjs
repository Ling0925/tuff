/**
 * Every emoji, made into the two files the picker reads — `docs/specs/emoji.md`.
 *
 *   node web/scripts/emoji.mjs <dir>
 *
 * where <dir> holds, under these names, what Unicode publishes:
 *
 *   emoji-test.txt              https://unicode.org/Public/emoji/latest/emoji-test.txt
 *   annotations_en.xml          https://raw.githubusercontent.com/unicode-org/cldr/main/common/annotations/en.xml
 *   annotations_fr.xml          …/common/annotations/fr.xml
 *   annotationsDerived_en.xml   …/common/annotationsDerived/en.xml
 *   annotationsDerived_fr.xml   …/common/annotationsDerived/fr.xml
 *
 * and writes `web/src/data/emoji/en.json` and `fr.json`. Run again when
 * Unicode adds emoji; nothing else needs to change.
 *
 * Data, not a dependency: the files are Unicode's (Unicode-3.0 licence,
 * whose notice travels inside each JSON), and what is kept of them is the
 * order, the name, the words to find each by, and the version it arrived
 * in — so a browser that cannot draw a new one is not offered it.
 *
 * Each emoji is `[emoji, name, words?, toned?, version?]`:
 *   - `words` the CLDR keywords not already in the name, space-joined;
 *   - `toned` the light-skin-tone form, when it has the five — the other
 *     four are it with 🏻 swapped, which this script checks;
 *   - `version` only from 12.0, where a machine starts to lack them.
 * Skin-toned forms are not rows of their own; mixed tones (two people, two
 * tones) are left to the keyboard of the machine.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = process.argv[2]
if (!dir) {
  console.error('usage: node web/scripts/emoji.mjs <dir with emoji-test.txt and the CLDR annotations>')
  process.exit(1)
}
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'data', 'emoji')

/* The server's own test for a reaction — `server/src/http/chat.ts`. An emoji
   it would refuse is not offered. */
const SERVER = /^[\p{Extended_Pictographic}\p{Emoji_Component}‍️⃣]+$/u

const GROUPS = {
  'Smileys & Emotion': 'people',
  'People & Body': 'people',
  'Animals & Nature': 'nature',
  'Food & Drink': 'food',
  Activities: 'activities',
  'Travel & Places': 'travel',
  Objects: 'objects',
  Symbols: 'symbols',
  Flags: 'flags',
}
const TONES = ['🏻', '🏼', '🏽', '🏾', '🏿']

const test = readFileSync(join(dir, 'emoji-test.txt'), 'utf8')
const notice = (test.match(/^# © .*$/m)?.[0] ?? '').replace(/^# /, '')
const unicodeVersion = test.match(/^# Version: (.*)$/m)?.[1]

/** Every fully-qualified emoji, in Unicode's order, with its group. */
const all = []
let group = null
for (const line of test.split('\n')) {
  const g = /^# group: (.*)$/.exec(line)
  if (g) group = g[1]
  const m = /^[0-9A-F ]+;\s*fully-qualified\s*#\s*(\S+)\s+E(\d+\.\d+)\s+(.*)$/.exec(line)
  if (m && GROUPS[group]) all.push({ e: m[1], v: Number(m[2]), name: m[3], group: GROUPS[group] })
}
const present = new Set(all.map((x) => x.e))

function annotations(file) {
  const xml = readFileSync(join(dir, file), 'utf8')
  const words = new Map()
  const names = new Map()
  for (const m of xml.matchAll(/<annotation cp="([^"]+)"( type="tts")?>([^<]*)<\/annotation>/g)) {
    const text = m[3].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;/g, '’').replace(/'/g, '’')
    if (m[2]) names.set(m[1], text)
    else words.set(m[1], text.split('|').map((w) => w.trim()))
  }
  return { words, names }
}
const strip = (e) => e.replace(/️/g, '')

function build(lang) {
  const base = annotations(`annotations_${lang}.xml`)
  const derived = annotations(`annotationsDerived_${lang}.xml`)
  const name = (e, fallback) => base.names.get(strip(e)) ?? derived.names.get(strip(e)) ?? fallback
  const words = (e) => base.words.get(strip(e)) ?? derived.words.get(strip(e)) ?? []

  const groups = new Map()
  let toned = 0
  for (const x of all) {
    /* A toned form is folded into its base. */
    if (TONES.some((t) => x.e.includes(t)) && x.name.includes('skin tone')) continue
    if (!SERVER.test(x.e) || x.e.length > 16) throw new Error(`the server would refuse ${x.e} (${x.name})`)
    const said = name(x.e, x.name)
    const known = new Set(said.toLowerCase().split(/[\s:,’'-]+/))
    const more = words(x.e).filter((w) => !known.has(w.toLowerCase()) && w.toLowerCase() !== said.toLowerCase())
    /* In French the English name finds it too: the words a team types to
       look for an emoji are often the ones every other app taught it. */
    if (lang !== 'en') more.push(x.name)
    /* The light-skin-tone form of exactly this one, if the five exist. */
    const light = all.find((y) => y.name === `${x.name}: light skin tone`)
    let tone = ''
    if (light) {
      for (const t of TONES) {
        const one = light.e.replaceAll('🏻', t)
        if (!present.has(one)) throw new Error(`${x.e}: a tone is missing`)
        if (!SERVER.test(one) || one.length > 16) throw new Error(`the server would refuse ${one}`)
      }
      tone = light.e
      toned++
    }
    const row = [x.e, said]
    if (more.length || tone || x.v >= 12) row.push(more.join(' '))
    if (tone || x.v >= 12) row.push(tone)
    if (x.v >= 12) row.push(x.v)
    if (!groups.has(x.group)) groups.set(x.group, [])
    groups.get(x.group).push(row)
  }
  const data = {
    notice: `From Unicode ${unicodeVersion} emoji-test.txt and CLDR annotations. ${notice} Unicode-3.0 licence: https://www.unicode.org/license.txt`,
    groups: [...groups].map(([id, e]) => ({ id, e })),
  }
  mkdirSync(out, { recursive: true })
  const file = join(out, `${lang}.json`)
  writeFileSync(file, JSON.stringify(data))
  const count = data.groups.reduce((n, g) => n + g.e.length, 0)
  console.log(`${file}: ${count} emoji, ${toned} with skin tones`)
}

build('en')
build('fr')
