import { useEffect, useState } from 'react'
import { LANGUAGE_NAMES } from '../words/code.js'

/**
 * A code block's language, and the highlighter that colours it.
 *
 * This file is what every screen carries: the list the picker offers and
 * how to find a name in it. The highlighter itself — lowlight, its grammars
 * and TipTap's plugin over them — is `lit.ts`, a chunk of its own, asked
 * for only when a code block is drawn. A page with no code never fetches it.
 */

export type Language = {
  /** What is written into the block's `language`, and into a Markdown fence. */
  id: keyof typeof LANGUAGE_NAMES
  /** The other names a fence or a paste may carry for the same language. */
  also: readonly string[]
}

/* lowlight's common grammars, the ones a team pastes into a task. The ids
   are names lowlight knows, so what is stored is what it highlights. */
const ALL: readonly Language[] = [
  { id: 'bash', also: ['zsh'] },
  { id: 'c', also: ['h'] },
  { id: 'cpp', also: ['c++', 'cc', 'cxx', 'hpp', 'hh', 'hxx', 'h++'] },
  { id: 'csharp', also: ['cs', 'c#'] },
  { id: 'css', also: [] },
  { id: 'diff', also: ['patch'] },
  { id: 'go', also: ['golang'] },
  { id: 'graphql', also: ['gql'] },
  { id: 'html', also: ['xhtml'] },
  { id: 'ini', also: [] },
  { id: 'java', also: ['jsp'] },
  { id: 'javascript', also: ['js', 'jsx', 'mjs', 'cjs'] },
  { id: 'json', also: ['jsonc', 'json5'] },
  { id: 'kotlin', also: ['kt', 'kts'] },
  { id: 'less', also: [] },
  { id: 'lua', also: [] },
  { id: 'makefile', also: ['make', 'mk', 'mak'] },
  { id: 'markdown', also: ['md', 'mkdown', 'mkd'] },
  { id: 'objectivec', also: ['objc', 'objective-c', 'obj-c', 'mm'] },
  { id: 'perl', also: ['pl', 'pm'] },
  { id: 'php', also: [] },
  { id: 'plaintext', also: ['text', 'txt', 'plain'] },
  { id: 'python', also: ['py', 'gyp', 'ipython'] },
  { id: 'r', also: [] },
  { id: 'ruby', also: ['rb', 'gemspec', 'podspec', 'thor', 'irb'] },
  { id: 'rust', also: ['rs'] },
  { id: 'scss', also: [] },
  { id: 'sh', also: ['shell', 'console', 'shellsession'] },
  { id: 'sql', also: ['postgresql', 'postgres', 'mysql', 'sqlite'] },
  { id: 'swift', also: [] },
  { id: 'toml', also: [] },
  { id: 'typescript', also: ['ts', 'tsx', 'mts', 'cts'] },
  { id: 'vbnet', also: ['vb'] },
  { id: 'xml', also: ['svg', 'rss', 'atom', 'plist', 'xsl', 'xsd'] },
  { id: 'yaml', also: ['yml'] },
]

/** The list as the picker draws it: by name, in the reader's language. */
export const LANGUAGES: readonly Language[] = [...ALL].sort((a, b) =>
  LANGUAGE_NAMES[a.id].localeCompare(LANGUAGE_NAMES[b.id], undefined, { sensitivity: 'base' }),
)

/**
 * The language a block's `language` names, whichever of its names it was
 * written with — a fence says `ts`, the picker writes `typescript`, and
 * both are TypeScript with its check beside it. Null for none, or for one
 * this list does not have.
 */
export function languageOf(written: unknown): Language | null {
  if (typeof written !== 'string' || !written) return null
  const w = written.trim().toLowerCase()
  return ALL.find((l) => l.id === w || l.also.includes(w)) ?? null
}

/**
 * What a block's language is called on its bar: the list's name for it, or
 * the word it was written with when the list has none — a fence that says
 * `mermaid` still says so. Null for none.
 */
export function languageName(written: unknown): string | null {
  const known = languageOf(written)
  if (known) return LANGUAGE_NAMES[known.id]
  if (typeof written !== 'string') return null
  const w = written.trim()
  return /^[\w+#.-]{1,40}$/.test(w) ? w : null
}

/* ---------------------------------------------------------- the chunk */

export type Lit = typeof import('./lit.js')

let lit: Lit | null = null
let coming: Promise<Lit> | null = null
const waiting = new Set<(l: Lit) => void>()

/** The highlighter, fetched once; every caller after the first has the same answer. */
export function loadLit(): Promise<Lit> {
  coming ??= import('./lit.js').then(
    (m) => {
      lit = m
      for (const tell of waiting) tell(m)
      waiting.clear()
      return m
    },
    (e: unknown) => {
      /* Asked again next time: a chunk that failed to arrive once — a
         dropped connection, a deploy in between — is not gone for good. */
      coming = null
      throw e
    },
  )
  return coming
}

/** The highlighter if it is here already, without asking for it. */
export const litNow = (): Lit | null => lit

/**
 * For a screen drawing code: the highlighter once it is here, asked for as
 * the first block is drawn. Until then the block is its words in the ink
 * of the body, at the same size — the colour arriving moves nothing.
 */
export function useLit(): Lit | null {
  const [have, setHave] = useState<Lit | null>(lit)
  useEffect(() => {
    if (have) return
    if (lit) return setHave(lit)
    waiting.add(setHave)
    void loadLit().catch(() => {})
    return () => {
      waiting.delete(setHave)
    }
  }, [have])
  return have
}

/**
 * How wide the numbers' column is for a block of so many lines: room for
 * its longest number and twelve pixels before the code, on the grid.
 */
export function gutterFor(lines: number): number {
  const digits = String(Math.max(1, lines)).length
  return 28 + 8 * Math.max(2, digits)
}
