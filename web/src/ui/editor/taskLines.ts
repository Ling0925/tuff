import type { Node as PMNode } from '@tiptap/pm/model'
import { cleanLine, LINE_MOST, LINE_PIECES, lineTitle, type LineNode } from '@tracker/shared-schema'

/**
 * The lines chosen words make into tasks.
 *
 * A line is what a reader sees as one: a paragraph, a heading, a list
 * item's line, and each run of one between hard breaks — two sentences
 * joined by Shift+Enter were one chip holding both, drawn as two lines
 * piled over each other. Not code: a line of a code block is not a line of
 * work.
 *
 * Each line's title is `lineTitle`'s, the rule `tasks_from_doc` uses too:
 * the whole line, and the chip stands for all of it. A line that carried
 * more than words — a link, a mention, a thread's mark, how it looks — is
 * swallowed whole as well, and the chip keeps it in `line` to draw it.
 */
export type LineToMake = {
  /** What the chip replaces, or where it goes in front of the words it keeps. */
  from: number
  to: number
  title: string
  /** The line as the chip keeps it, when it carried more than words. */
  line: LineNode[] | null
  /** The line said whole, when it was past a title's limit and its title was cut — it goes in the task's description. */
  said: string | null
  /** The words stay and the chip goes in front — only a line too large for a chip to hold. */
  keep: boolean
}

/** An inline node's words, as a title reads them: a mention as `@name`, a chip or a document by its title. */
function leafWords(n: PMNode): string {
  if (n.type.name === 'mention') return `@${String(n.attrs.label ?? '')}`
  if (n.type.name === 'taskref' || n.type.name === 'docref') return String(n.attrs.title ?? '')
  return ' '
}

/** The stretch's inline content as a line — text with its marks, mentions — before `cleanLine` reads it. */
function lineOf(doc: PMNode, a: number, b: number): unknown[] {
  const out: unknown[] = []
  doc.nodesBetween(a, b, (n, pos) => {
    if (!n.isInline) return true
    if (n.isText) {
      const text = (n.text ?? '').slice(Math.max(0, a - pos), Math.min(n.nodeSize, b - pos))
      if (text) out.push({ type: 'text', text, marks: n.marks.map((m) => m.toJSON()) })
    } else if (n.type.name === 'mention') out.push(n.toJSON())
    else out.push({ type: 'text', text: leafWords(n) })
    return false
  })
  return out
}

export function linesToMake(doc: PMNode, from: number, to: number): LineToMake[] {
  const out: LineToMake[] = []
  const take = (a: number, b: number) => {
    if (a >= b) return
    /* One character a node, so places and letters are one to one. */
    const raw = doc.textBetween(a, b, ' ', ' ')
    const at = lineTitle(raw)
    if (!at.title) return
    const from_ = a + at.start
    const to_ = a + at.end
    let plain = true
    doc.nodesBetween(from_, to_, (n) => {
      if (n.isInline && (!n.isText || n.marks.length > 0)) plain = false
      return plain
    })
    if (plain) {
      out.push({ from: from_, to: to_, title: at.title, line: null, said: at.whole ? null : raw.replace(/\s+/g, ' ').trim(), keep: false })
      return
    }
    /* Titled by its words as they read, a mention as its name. */
    const words = doc.textBetween(from_, to_, ' ', leafWords)
    const t = lineTitle(words)
    const said = t.whole ? null : words.replace(/\s+/g, ' ').trim()
    const pieces = lineOf(doc, from_, to_)
    if (words.length <= LINE_MOST && pieces.length <= LINE_PIECES) {
      /* Null when nothing in it is more than words — a document named is kept as its title. */
      out.push({ from: from_, to: to_, title: t.title, line: cleanLine(pieces), said, keep: false })
      return
    }
    /* Too much for a chip to hold: the old way — the chip in front, the
       words left as they are. */
    out.push({ from: a, to: b, title: t.title, line: null, said, keep: true })
  }
  doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isTextblock) return true
    if (node.type.name === 'codeBlock') return false
    let start = pos + 1
    node.forEach((child, offset) => {
      if (child.type.name !== 'hardBreak') return
      const at = pos + 1 + offset
      take(Math.max(from, start), Math.min(to, at))
      start = at + 1
    })
    take(Math.max(from, start), Math.min(to, pos + 1 + node.content.size))
    return false
  })
  return out
}
