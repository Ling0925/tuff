/**
 * An address typed as words — `docs/specs/rich-text.md`, "Addresses".
 *
 * One rule for where a bare `https://…` or `www.…` in somebody's text
 * starts and ends, read by everything that turns words into a link: the
 * server reading an agent's Markdown (`server/src/mcp/markdown.ts`), a body
 * drawn read-only (`web/src/ui/Doc.tsx`) and a body open in the editor
 * (`web/src/ui/autolink.ts`). Three copies of it would link three different
 * spans of the same sentence.
 *
 * Only the web: a scheme other than http and https is never made a link
 * here, so `javascript:` written in a message stays words.
 */

export type Address = {
  /** Where it starts in the text. */
  index: number
  /** The words as written, which is what the link shows. */
  text: string
  /** Where it goes: `www.` is given its `https://`. */
  href: string
}

/* A run that could be an address. Bounded, so a line of a million
   characters is not one candidate tried a million ways. */
const RUN = /(?:https?:\/\/|www\.)[^\s<>"'`]{1,2048}/giy

/* Said at the end of a sentence rather than part of the address. */
const TRAILING = new Set(['.', ',', ';', ':', '!', '?', '*', '_', '~', '"', "'"])

/* The address must name a host: `https://` alone, or `www.` and a word,
   is somebody writing about addresses. */
const HOST = /^(?:https?:\/\/[^/?#\s]*[a-z0-9]|www\.[a-z0-9-]+\.[a-z0-9])/i

/* Stuck to a word before it, it is part of that word: `xhttps://` and
   `awww.` are not addresses, and `me@www.x.com` is an email. */
const JOINED = /[A-Za-z0-9@./\-_]/

/**
 * The address that starts exactly at `at`, or null.
 *
 * A closing bracket ends the address unless the address opened it, so
 * `(see https://x.com/a)` links `https://x.com/a` and a Wikipedia address
 * that ends in `_(film)` keeps its bracket.
 */
export function addressAt(text: string, at = 0): Address | null {
  if (at > 0 && JOINED.test(text[at - 1]!)) return null
  RUN.lastIndex = at
  const m = RUN.exec(text)
  if (!m) return null
  let run = m[0]
  let opens = 0
  let closes = 0
  let squareOpens = 0
  let squareCloses = 0
  for (const c of run) {
    if (c === '(') opens++
    else if (c === ')') closes++
    else if (c === '[') squareOpens++
    else if (c === ']') squareCloses++
  }
  let end = run.length
  while (end > 0) {
    const c = run[end - 1]!
    if (TRAILING.has(c)) end--
    else if (c === ')' && closes > opens) {
      closes--
      end--
    } else if (c === ']' && squareCloses > squareOpens) {
      squareCloses--
      end--
    } else break
  }
  run = run.slice(0, end)
  if (!HOST.test(run)) return null
  return { index: at, text: run, href: /^www\./i.test(run) ? `https://${run}` : run }
}

/* Where an address could begin: checked by `addressAt`. */
const START = /https?:\/\/|www\./gi

/** Every address in a run of text, in order. */
export function addresses(text: string): Address[] {
  const out: Address[] = []
  START.lastIndex = 0
  for (let m = START.exec(text); m; m = START.exec(text)) {
    const found = addressAt(text, m.index)
    if (found) {
      out.push(found)
      START.lastIndex = m.index + found.text.length
    } else START.lastIndex = m.index + 1
  }
  return out
}

/** Where the next address begins at or after `from` and before `until`,
    or -1. Bounded so a reader stepping through a long text looks only as
    far as its next step, not to the end of it every time. */
export function nextAddress(text: string, from: number, until = text.length): number {
  /* Searched in the part up to `until` (and the length of `https://`
     past it), or a text with no address in it is read to its end at every
     step. */
  const part = until >= text.length ? text : text.slice(0, until + 8)
  START.lastIndex = from
  for (let m = START.exec(part); m && m.index < until; m = START.exec(part)) {
    if (addressAt(text, m.index)) return m.index
    START.lastIndex = m.index + 1
  }
  return -1
}
