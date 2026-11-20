/**
 * Every emoji, read when somebody is about to want one — `docs/specs/emoji.md`.
 *
 * The list is Unicode's, made into a file per language by
 * `web/scripts/emoji.mjs`, and it is not in the app's bundle: it is fetched
 * the first time a line to write on is drawn and the machine has a moment,
 * and again from the browser's cache after that. A picker opened before it
 * has arrived shows what this person used last, which needs no list.
 */
import enUrl from './emoji/en.json?url'
import frUrl from './emoji/fr.json?url'
import { tongue } from './words.js'
import { find, type Emoji, type EmojiGroup } from './emojiFind.js'

export { find, type Emoji, type EmojiGroup }

type Row = [string, string, string?, string?, number?]
type File = { groups: { id: string; e: Row[] }[] }

let ready: EmojiGroup[] | null = null
let coming: Promise<EmojiGroup[]> | null = null

/** What is already here, for a picker drawn this frame. */
export function emojiNow(): EmojiGroup[] | null {
  return ready
}

/** The list, fetched once. A failure is forgotten, so the next open asks again. */
export function loadEmoji(): Promise<EmojiGroup[]> {
  if (ready) return Promise.resolve(ready)
  if (!coming) {
    coming = fetch(tongue() === 'fr' ? frUrl : enUrl)
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status))
        return r.json() as Promise<File>
      })
      .then((file) => {
        const upTo = drawable()
        ready = file.groups.map((g) => ({
          id: g.id,
          e: g.e.filter((r) => (r[4] ?? 0) <= upTo).map((r): Emoji => ({ e: r[0], name: r[1], words: r[2] ?? '', tone: r[3] || null })),
        }))
        return ready
      })
      .catch((e: unknown) => {
        coming = null
        throw e
      })
  }
  return coming
}

/** Asked for when the machine is idle — a line to write on is on the screen. */
export function soonEmoji(): void {
  if (ready || coming) return
  const go = () => void loadEmoji().catch(() => {})
  if ('requestIdleCallback' in window) window.requestIdleCallback(go, { timeout: 4000 })
  else setTimeout(go, 1500)
}

/* ------------------------------------------------------------ skin tones */

export const TONES = ['', '🏻', '🏼', '🏽', '🏾', '🏿'] as const
const TONE_KEY = 'emoji-tone'

export function skinTone(): number {
  try {
    const n = Number(localStorage.getItem(TONE_KEY) ?? 0)
    return n >= 0 && n < TONES.length ? n : 0
  } catch {
    return 0
  }
}

export function setSkinTone(n: number): void {
  try {
    localStorage.setItem(TONE_KEY, String(n))
  } catch {
    // Blocked storage: the tone lasts as long as the picker.
  }
}

/** The emoji as it is sent, in the tone this person chose where it has one. */
export function toned(x: Emoji, tone: number): string {
  return tone > 0 && x.tone ? x.tone.replaceAll('🏻', TONES[tone]!) : x.e
}

/* ------------------------------------------------------ what can be drawn */

/*
 * The newest version this machine draws.
 *
 * Unicode adds emoji every year and a phone two years old draws last
 * year's as an empty box, or a pair of faces where one was meant. Each
 * version's one emoji is drawn on a canvas: no colour is a box, and twice
 * the width of a face is a sequence the font does not join. A canvas that
 * will not say (a browser hiding what it draws) is taken to draw 15.0,
 * which every system of the last three years does.
 */
const PROBES: [number, string][] = [
  [12, '🥱'],
  [12.1, '🧑‍🦰'],
  [13, '🥲'],
  [13.1, '😮‍💨'],
  [14, '🫠'],
  [15, '🫨'],
  [15.1, '🐦‍🔥'],
  [16, '🫩'],
  [17, '🫪'],
  [18, '🫫'],
]

function drawable(): number {
  try {
    const c = document.createElement('canvas')
    c.width = c.height = 32
    const g = c.getContext('2d', { willReadFrequently: true })
    if (!g) return 15
    g.font = '24px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif'
    g.textBaseline = 'top'
    const face = g.measureText('😀').width
    const coloured = (s: string) => {
      g.clearRect(0, 0, 32, 32)
      g.fillText(s, 0, 0)
      const d = g.getImageData(0, 0, 32, 32).data
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3]! > 0 && (Math.abs(d[i]! - d[i + 1]!) > 16 || Math.abs(d[i + 1]! - d[i + 2]!) > 16)) return true
      }
      return false
    }
    if (!face || !coloured('😀')) return 15
    let upTo = 11
    for (const [v, e] of PROBES) {
      if (!coloured(e) || g.measureText(e).width > face * 1.5) break
      upTo = v
    }
    return upTo
  } catch {
    return 15
  }
}
