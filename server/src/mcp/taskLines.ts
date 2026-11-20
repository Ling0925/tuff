/**
 * Lines of a document made into tasks, for an agent.
 *
 * What the Make a task button does in the browser, on the stored body: the
 * words of a line are found and replaced by the task named as a node. Pure,
 * so the tool around it makes the tasks and writes the body through the
 * same endpoints a page uses.
 *
 * A line is what a reader sees as one: a paragraph, a heading or a list
 * item's line, and each run of one between hard breaks — two lines joined
 * by Shift+Enter are two lines, and two tasks, as they are on the button.
 */
import { cleanLine, lineTitle, type LineNode } from '@tracker/shared-schema'

type Node = { type?: string; text?: string; attrs?: Record<string, unknown>; marks?: unknown[]; content?: Node[] }

export type TaskNamed = { id: string; projectId: string; number: number; key: string | null; title: string }

/** One line: a block, and the run of its children between hard breaks. */
type Line = { block: Node; from: number; to: number }

const squash = (s: string) => s.replace(/\s+/g, ' ').trim()

/** Lines an agent sends with breaks in them are each a line. */
export function splitLines(lines: readonly string[]): string[] {
  return lines.flatMap((l) => l.split(/\r?\n/)).filter((l) => l.trim() !== '')
}

/** The title each line makes — the same rule the button uses. */
export const titleOf = (line: string) => lineTitle(line).title

/** A run's words, as one line. */
function wordsOf(kids: Node[]): string {
  return kids
    .map((n) =>
      n.type === 'text'
        ? (n.text ?? '')
        : n.type === 'mention'
          ? `@${String(n.attrs?.label ?? '')}`
          : n.type === 'taskref'
            ? ''
            : n.type === 'docref'
              ? String(n.attrs?.title ?? '')
              : wordsOf(n.content ?? []),
    )
    .join('')
}

/**
 * What a line carried besides its words — links, mentions, marks — as the
 * chip keeps it in `line`. A document named
 * in it is kept as its words. Null for a line of plain words.
 */
export function richLine(kids: Node[]): LineNode[] | null {
  return cleanLine(
    kids.map((n) =>
      n.type === 'text' || n.type === 'mention'
        ? n
        : { type: 'text', text: n.type === 'docref' ? String(n.attrs?.title ?? '') : wordsOf(n.content ?? []) },
    ),
  )
}

/** The rich line a line names, when it is found whole: what goes in the chip and the description. */
export function lineAt(body: unknown, line: string): LineNode[] | null {
  const at = findLine(body, line)
  return at?.whole ? richLine(run(at)) : null
}

/** Every line of the body, in reading order — not code: a line of a code block is not a line of work. */
function lines(body: Node): Line[] {
  const out: Line[] = []
  const walk = (n: Node) => {
    const kids = n.content ?? []
    if (n.type === 'codeBlock') return
    if (!kids.some((k) => k.type === 'text' || k.type === 'hardBreak' || k.type === 'taskref')) {
      kids.forEach(walk)
      return
    }
    let from = 0
    kids.forEach((k, i) => {
      if (k.type !== 'hardBreak') return
      out.push({ block: n, from, to: i })
      from = i + 1
    })
    out.push({ block: n, from, to: kids.length })
  }
  walk(body)
  return out
}

const run = (l: Line) => (l.block.content ?? []).slice(l.from, l.to)

/**
 * Where a line is: the first line saying it — the whole of it, or inside
 * one run of its words. Null when no line says it.
 */
export function findLine(body: unknown, line: string): { block: Node; from: number; to: number; whole: boolean } | null {
  const want = squash(line)
  if (!want) return null
  const all = lines(body as Node)
  const whole = all.find((l) => squash(wordsOf(run(l))) === want && !run(l).some((k) => k.type === 'taskref'))
  if (whole) return { ...whole, whole: true }
  const part = all.find((l) => run(l).some((k) => k.type === 'text' && (k.text ?? '').includes(line.trim())))
  return part ? { ...part, whole: false } : null
}

/**
 * The line's words replaced by the task, in place. Answers whether it was found.
 *
 * The whole line becomes the chip, which says all of it — nothing is left
 * after it; one that carries more than a chip may hold keeps its words,
 * the chip in front of them. A line past a title's limit is cut in the title and said whole
 * in the task's description by the caller.
 */
export function nameTask(body: unknown, line: string, task: TaskNamed): boolean {
  const at = findLine(body, line)
  if (!at) return false
  const node: Node = {
    type: 'taskref',
    attrs: { id: task.id, projectId: task.projectId, number: task.number, key: task.key, title: task.title },
  }
  const kids = at.block.content ?? []
  if (at.whole) {
    /* Swallowed whole, links and mentions with it: the chip draws them. */
    const words = run(at)
    const rich = richLine(words)
    if (rich) node.attrs!.line = rich
    else if (words.some((k) => k.type === 'mention' || (k.type === 'text' && Array.isArray(k.marks) && k.marks.length > 0))) {
      /* More than a chip may hold (`LINE_PIECES`, `LINE_MOST`): the chip
         goes in front and the words stay, links and all — as the button does. */
      kids.splice(at.from, 0, node, { type: 'text', text: ' ' })
      at.block.content = kids
      return true
    }
    kids.splice(at.from, at.to - at.from, node)
    at.block.content = kids
    return true
  }
  const want = line.trim()
  const i = kids.findIndex((k, j) => j >= at.from && j < at.to && k.type === 'text' && (k.text ?? '').includes(want))
  const piece = kids[i]!
  const text = piece.text ?? ''
  const from = text.indexOf(want)
  const words = (t: string): Node[] => (t ? [{ ...piece, text: t }] : [])
  kids.splice(i, 1, ...words(text.slice(0, from)), node, ...words(text.slice(from + want.length)))
  return true
}
