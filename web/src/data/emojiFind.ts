/**
 * Finding an emoji by a word — `docs/specs/emoji.md`.
 *
 * Apart from the list itself so it can be tested without a browser.
 */

export type Emoji = {
  e: string
  name: string
  /** The other words it is found by, space-separated. */
  words: string
  /** Its light-skin-tone form, when it has the five. */
  tone: string | null
}

export type EmojiGroup = { id: string; e: Emoji[] }

/** Lower case, without accents: "cafe" finds « café ». */
export function fold(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

const folded = new WeakMap<Emoji, { name: string; all: string }>()
function words(x: Emoji) {
  let f = folded.get(x)
  if (!f) {
    f = { name: fold(x.name), all: ` ${fold(x.name)} ${fold(x.words)}`.replace(/[:,’'()]/g, ' ') }
    folded.set(x, f)
  }
  return f
}

/**
 * The emoji whose name or words begin with every word asked, best first:
 * the name itself, then the ones whose name holds every word, then those
 * found by their other words, in Unicode's order. Among names, the shorter
 * first, so "heart" puts ❤️ (red heart) before 💘 (heart with arrow).
 */
export function find(groups: readonly EmojiGroup[], q: string, limit = 400): Emoji[] {
  const asked = fold(q).replace(/[:_]/g, ' ').split(/\s+/).filter(Boolean)
  if (asked.length === 0) return []
  const whole = asked.join(' ')
  const scored: { x: Emoji; s: number; i: number }[] = []
  let i = 0
  for (const g of groups) {
    for (const x of g.e) {
      i++
      const f = words(x)
      if (!asked.every((w) => f.all.includes(` ${w}`))) continue
      const named = ` ${f.name.replace(/[:,’'()]/g, ' ')}`
      const s = f.name === whole ? 0 : asked.every((w) => named.includes(` ${w}`)) ? 1 : 2
      scored.push({ x, s, i })
    }
  }
  scored.sort((a, b) => a.s - b.s || (a.s === 1 ? a.x.name.length - b.x.name.length : 0) || a.i - b.i)
  return scored.slice(0, limit).map((r) => r.x)
}
