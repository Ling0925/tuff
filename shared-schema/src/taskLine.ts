/**
 * The title a line of words makes when it is made a task.
 *
 * One rule for the two places a line becomes a task: the Make a task
 * button in a document (`web/src/ui/FileDetail.tsx`) and an agent's
 * `tasks_from_doc` (`server/src/mcp/taskLines.ts`). Two copies would
 * title the same line two ways.
 *
 * The whole line is the task, and the chip that stands for it says all of
 * it. Only a line longer than a task's title may be (`TITLE_MOST`, the
 * limit `POST /api/projects/:id/tasks` holds) is cut, at the last space
 * before it, with an ellipsis — and the line is said whole in the task's
 * description, so nothing it said is lost.
 */

/** The longest a task's title may be — `taskCreate` in `entities.ts`. */
export const TITLE_MOST = 300

export type LineTitle = {
  /** The title: one line, its spaces squashed. Empty for a line of nothing. */
  title: string
  /** Where the line's words start, after any spaces before them. */
  start: number
  /** Where they end, before any spaces after them. */
  end: number
  /** Whether the title is the whole line — false only past `TITLE_MOST`. */
  whole: boolean
}

const squash = (s: string) => s.replace(/\s+/g, ' ').trim()

export function lineTitle(line: string): LineTitle {
  const start = line.length - line.trimStart().length
  const end = line.trimEnd().length
  if (end <= start) return { title: '', start: 0, end: 0, whole: true }
  const said = squash(line)
  if (said.length <= TITLE_MOST) return { title: said, start, end, whole: true }
  const room = said.slice(0, TITLE_MOST - 1)
  const space = room.lastIndexOf(' ')
  const cut = space > TITLE_MOST / 2 ? room.slice(0, space) : room
  return { title: `${cut.replace(/[\s,;:–—-]+$/, '')}…`, start, end, whole: false }
}

/*
 * The line a chip stands for.
 *
 * A line that carried more than words — a link, a mention, a thread's mark,
 * how its words look — is swallowed whole like any other, and the chip
 * keeps it in `line`, the line's inline content, to draw it while the task
 * is still called by it. The title stays plain text.
 *
 * Never trusted: a page writes it, so whoever reads it — the server, each
 * time the shared state becomes the stored body and back, and the chip,
 * before drawing it — reads it through `cleanLine`, which keeps only what
 * a line can say and only an address a link may have.
 */

/** A mark a line keeps. */
export type LineMark =
  | { type: 'bold' | 'italic' | 'underline' | 'strike' | 'code' }
  | { type: 'link'; attrs: { href: string } }
  | { type: 'comment'; attrs: { ids: string } }

/** One piece of a line: a run of text, or somebody called in. */
export type LineNode = { type: 'text'; text: string; marks?: LineMark[] } | { type: 'mention'; attrs: { id: string; label: string } }

/** The most a line may hold: pieces, and characters of words. */
export const LINE_PIECES = 200
export const LINE_MOST = 2000

const LOOKS = new Set(['bold', 'italic', 'underline', 'strike', 'code'])
/** The addresses a link may have — the rule links have everywhere else. */
export const LINKABLE = /^(https?:|mailto:)/i
const THREAD = /^[0-9a-f-]{8,64}$/i

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

function cleanMarks(raw: unknown): LineMark[] {
  const out: LineMark[] = []
  const seen = new Set<string>()
  for (const m of Array.isArray(raw) ? raw : []) {
    if (!isObj(m) || typeof m.type !== 'string' || seen.has(m.type)) continue
    const a = isObj(m.attrs) ? m.attrs : {}
    if (LOOKS.has(m.type)) out.push({ type: m.type as 'bold' })
    else if (m.type === 'link') {
      const href = typeof a.href === 'string' ? a.href.trim() : ''
      if (!href || href.length > 2000 || !LINKABLE.test(href)) continue
      out.push({ type: 'link', attrs: { href } })
    } else if (m.type === 'comment') {
      const ids = (typeof a.ids === 'string' ? a.ids.split(/\s+/) : []).filter((id) => THREAD.test(id)).slice(0, 20)
      if (!ids.length) continue
      out.push({ type: 'comment', attrs: { ids: ids.join(' ') } })
    } else continue
    seen.add(m.type)
  }
  return out
}

/**
 * A line as it may be kept and drawn, or null: nothing a line can say, too
 * much of it, or nothing but plain words — a plain line's chip is its title.
 */
export function cleanLine(raw: unknown): LineNode[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > LINE_PIECES) return null
  const out: LineNode[] = []
  let words = 0
  let more = false
  for (const n of raw) {
    if (!isObj(n)) continue
    if (n.type === 'text' && typeof n.text === 'string' && n.text.length > 0) {
      const marks = cleanMarks(n.marks)
      words += n.text.length
      if (marks.length) more = true
      out.push(marks.length ? { type: 'text', text: n.text, marks } : { type: 'text', text: n.text })
    } else if (n.type === 'mention' && isObj(n.attrs)) {
      const id = typeof n.attrs.id === 'string' ? n.attrs.id.slice(0, 64) : ''
      const label = typeof n.attrs.label === 'string' ? n.attrs.label.slice(0, 200) : ''
      if (!id) continue
      words += label.length + 1
      more = true
      out.push({ type: 'mention', attrs: { id, label } })
    }
  }
  if (!more || words > LINE_MOST) return null
  return out
}

/** A line's words, as its title reads them: a mention as `@name`. */
export function lineWords(line: readonly LineNode[]): string {
  return line.map((n) => (n.type === 'text' ? n.text : `@${n.attrs.label}`)).join('')
}

/**
 * Whether a chip still draws its line: the title it shows is the title the
 * line makes. Renamed elsewhere, it is not, and the chip says the new title
 * in words.
 */
export function lineSays(line: readonly LineNode[] | null, title: string): line is LineNode[] {
  return line !== null && line.length > 0 && lineTitle(lineWords(line)).title === title.replace(/\s+/g, ' ').trim()
}

/** Every thread a line's marks name. */
export function lineThreads(line: readonly LineNode[] | null): string[] {
  const out = new Set<string>()
  for (const n of line ?? [])
    if (n.type === 'text') for (const m of n.marks ?? []) if (m.type === 'comment') for (const id of m.attrs.ids.split(' ')) out.add(id)
  return [...out]
}

/** The line for a task's description: as it is, without the document's threads. */
export function lineForTask(line: readonly LineNode[]): LineNode[] {
  return line.map((n) => {
    if (n.type !== 'text' || !n.marks) return n
    const marks = n.marks.filter((m) => m.type !== 'comment')
    return marks.length ? { ...n, marks } : { type: 'text' as const, text: n.text }
  })
}
