/**
 * Markdown an agent writes, as the document the editor keeps.
 *
 * A model writes Markdown whether or not it is asked to, and every body it
 * sent arrived as one paragraph with the pound signs and asterisks in it: a
 * brief with headings and lists read as a wall of punctuation. This is the
 * part of Markdown a model uses — headings, paragraphs, lists, quotes,
 * fenced code, rules, tables, bold, italic, code, links and the workspace's
 * own pictures and files (`![caption](file:<id>)`) — turned into the
 * nodes the editor draws (`web/src/ui/Editor.tsx`: StarterKit and tables).
 * A bare `https://…` or `www.…` is a link too, as it is in every chat a
 * model has read: an agent pasting an address did not mean words.
 * GitHub's alerts (`> [!NOTE]`) are callouts and a `<details>` block is a
 * toggle. Anything else it does not know stays as
 * the text it was — a task box, say — because the editor has nothing to
 * draw it with.
 */

import { addressAt, nextAddress } from '@tracker/shared-schema'

type Mark = { type: string; attrs?: Record<string, unknown> }
type Node = {
  type: string
  attrs?: Record<string, unknown>
  content?: Node[]
  text?: string
  marks?: Mark[]
}

/* Links only to the web or to an address: a `javascript:` link is one
   somebody else in the project clicks. */
const safe = (href: string) => /^(https?:|mailto:)/i.test(href)

const LINK = /^\[([^\]\n]{1,300})\]\(([^)\s]{1,2000})\)/
/* The next character a link's words or its address cannot run past. */
const LABEL_END = /[\]\n]/g
const HREF_END = /[)\s]/g

/* Whether a link could start at `at`, answered from the farthest point
   already scanned. Each `[` scanned its words afresh, so a body of `[`
   or `[a](` read the same three hundred or two thousand characters again
   from every bracket — a second for 200 000 of them. The pattern is still
   what decides; this only says when it cannot match, by the same rules. */
function linkScanner(text: string) {
  let label = -1
  let href = -1
  const next = (re: RegExp, from: number) => {
    re.lastIndex = from
    return re.exec(text)?.index ?? text.length
  }
  return (at: number) => {
    if (label <= at) label = next(LABEL_END, at + 1)
    const words = label - at - 1
    if (text[label] !== ']' || text[label + 1] !== '(' || words < 1 || words > 300) return false
    const start = label + 2
    if (href < start) href = next(HREF_END, start)
    const length = href - start
    return text[href] === ')' && length >= 1 && length <= 2000
  }
}

/* What one run of words costs once the document is written out: its
   words, the node around them, and its marks with their attributes. A
   link's address is on every run inside the link, so `[*a*b*a*b…](…)`
   wrote a two-thousand-character address a hundred and fifty times — a
   handful of nodes, and megabytes. */
const runCost = (t: string, m: Mark[]) => t.length + 28 + (m.length ? 10 + JSON.stringify(m).length : 0)

/** What a line's runs have cost so far, against what they may. */
export type Meter = { room: number; spent: number }

/** One line's words, with their marks. Past `limit` runs of words, or
    past `meter.room` bytes of them, it stops, and what it has is thrown
    away by whoever set the limit. */
export function inline(text: string, marks: Mark[] = [], limit = Infinity, meter: Meter = { room: Infinity, spent: 0 }): Node[] {
  const out: Node[] = []
  let rest = text
  const canLink = linkScanner(text)
  const push = (t: string, m: Mark[]) => {
    if (!t) return
    const last = out[out.length - 1]
    if (last && last.type === 'text' && JSON.stringify(last.marks ?? []) === JSON.stringify(m)) {
      last.text += t
      meter.spent += t.length
    } else {
      out.push(m.length ? { type: 'text', text: t, marks: m } : { type: 'text', text: t })
      meter.spent += runCost(t, m)
    }
  }
  const rules: [RegExp, (m: RegExpExecArray) => Node[]][] = [
    /* Every run bounded, and none crossing a line: unbounded, `[a` over and
       over tried every bracket against the whole rest of the text — the
       square of its length. */
    [/^`([^`\n]{1,2000})`/, (m) => [{ type: 'text', text: m[1]!, marks: [...marks, { type: 'code' }] }]],
    [LINK, (m) => (safe(m[2]!) ? inline(m[1]!, [...marks, { type: 'link', attrs: { href: m[2] } }]) : inline(m[1]!, marks))],
    [/^\*\*([^*\n]{1,2000}?)\*\*/, (m) => inline(m[1]!, [...marks, { type: 'bold' }])],
    [/^__([^_\n]{1,2000}?)__/, (m) => inline(m[1]!, [...marks, { type: 'bold' }])],
    [/^\*([^*\s][^*\n]{0,2000}?)\*/, (m) => inline(m[1]!, [...marks, { type: 'italic' }])],
    [/^_([^_\s][^_\n]{0,2000}?)_(?![A-Za-z0-9])/, (m) => inline(m[1]!, [...marks, { type: 'italic' }])],
    [/^~~([^~\n]{1,2000}?)~~/, (m) => inline(m[1]!, [...marks, { type: 'strike' }])],
  ]
  /* Inside a link already, an address is that link's words. */
  const linking = !marks.some((m) => m.type === 'link')
  outer: while (rest && out.length <= limit && meter.spent <= meter.room) {
    if (linking) {
      const found = addressAt(rest)
      if (found) {
        push(found.text, [...marks, { type: 'link', attrs: { href: found.href } }])
        rest = rest.slice(found.text.length)
        continue
      }
    }
    for (const [re, make] of rules) {
      if (re === LINK && (rest[0] !== '[' || !canLink(text.length - rest.length))) continue
      const m = re.exec(rest)
      if (m) {
        for (const n of make(m)) push(n.text ?? '', n.marks ?? [])
        rest = rest.slice(m[0].length)
        continue outer
      }
    }
    /* Up to the next thing that could start a mark or an address, as
       plain text. The address is looked for in what is left, from its
       second character, so the word it would be stuck to is still there to
       tell `xhttps://` from ` https://`. */
    const mark = rest.slice(1).search(/[`[*_~]/)
    const near = mark === -1 ? rest.length : mark + 1
    const address = linking ? nextAddress(rest, 1, near) : -1
    const take = address === -1 ? near : address
    push(rest.slice(0, take), marks)
    rest = rest.slice(take)
  }
  return out
}

/* How many nodes one body may become, counted across every block, list
   item, row, cell and run of words, quotes inside quotes included. A
   header of sixty-four columns over rows of `||` was a hundred and thirty
   nodes for every three characters — four million of them, and most of a
   gigabyte, from a body inside the 200 000-character cap. Past the budget
   the rest of the body is one plain paragraph of its own words. */
export const NODE_BUDGET = 50_000
/* And how many bytes the document may come to, counted as it is made
   rather than by writing it out at the end. Nodes were counted and bytes
   were not: 198 230 characters of links over italics were 26.86 MB of
   JSON, and an import of rows of them two gigabytes. A run of words costs
   its words, its marks and their attributes; every other node — a
   paragraph, a list item, a row, a cell — costs `NODE_BYTES`, so a table
   of sixty-four columns over empty rows is bounded too (1.36 MB from
   4 000 characters before). Past it the line, and the rest of the body,
   are their own words, as past the node budget — links and marks lost.
   An ordinary body is well under: four to eight times its length when
   every line has a link and a bold word or is a short list item, so a
   short body has 64 KB and a long one twenty-four times its length, up to
   a megabyte. */
export const BYTE_BUDGET = 1_000_000
export const bytesFor = (source: string) => Math.min(BYTE_BUDGET, 64_000 + 24 * source.length)
/* What a node other than a run of words is charged, about what one is once
   written out; a heading's and a callout's attributes are charged on top. */
const NODE_BYTES = 40
/* What one request of an import may write, all its bodies together: ten
   times the words it was sent and a megabyte more, and twenty megabytes at
   most. Each body is bounded by the budget above, and two hundred bounded
   bodies were two gigabytes and a `RangeError`. A page of two
   hundred rows of twenty thousand characters writes four megabytes plain
   and fifteen with a link and a bold word on every line. */
export const IMPORT_BYTES = 20_000_000
/** Thrown past what an import may write, and answered `413 too_large`. */
export class TooLong extends Error {}
export const tooLong = { error: { code: 'too_large', message: 'This is too much to import at once. Import fewer at a time.' } }
/** One request's bodies, counted as they are written: `text` read as a
    document `bytes` long. Throws `TooLong` past what the request may write. */
export function importTally() {
  let sent = 0
  let spent = 0
  /* Counted only when it fits: a body refused here and kept some other way
     (the Linear import's plain words) is counted as that instead. */
  return (text: string, bytes: number, anyway = false) => {
    if (!anyway && spent + bytes > Math.min(IMPORT_BYTES, 1_000_000 + 10 * (sent + text.length))) throw new TooLong()
    sent += text.length
    spent += bytes
  }
}
/* A table is this many rows at most; the rows past it are their words. */
export const TABLE_ROWS = 1_000

/* Nodes and bytes, spent together. `left` is how many more nodes may be
   made, the fewer of the two: every place that spends or checks a node
   (`budget.left--`, `cost > budget.left`) charges and heeds the bytes too. */
class Budget {
  nodes = NODE_BUDGET
  constructor(public bytes: number) {}
  get left(): number {
    return Math.max(0, Math.min(this.nodes, Math.floor(this.bytes / NODE_BYTES)))
  }
  set left(to: number) {
    const spent = this.left - to
    this.nodes -= spent
    this.bytes -= spent * NODE_BYTES
  }
  /** What a node's attributes add to it once written out. */
  charge(bytes: number) {
    this.bytes -= bytes
  }
  /** Nothing more is read into the body. */
  spendAll() {
    this.nodes = 0
    this.bytes = 0
  }
}
/* The structure's share of the budget: all of it but the body's own
   length, kept back for what is written as it was — the plain rest past
   the budget, a code block's words — which together are never more than
   the body. So the whole document is within `bytesFor`, and the check at
   the end of `fromMarkdown` is a net, not the bound. */
const fresh = (source: string): Budget => new Budget(bytesFor(source) - source.length)

/* The words as they were, with nothing read into them. */
const plain = (text: string): Node => (text ? { type: 'paragraph', content: [{ type: 'text', text }] } : { type: 'paragraph' })

/* A line's words, counted against the budget: a line that would spend
   more than is left is its plain words, and spends the rest. */
function wordsOf(text: string, budget: Budget): Node[] {
  const meter = { room: budget.bytes, spent: 0 }
  const content = inline(text, [], budget.left, meter)
  if (content.length > budget.left || meter.spent > budget.bytes) {
    budget.spendAll()
    return text ? [{ type: 'text', text }] : []
  }
  /* A run is charged what it costs, not a node's flat rate. */
  budget.nodes -= content.length
  budget.bytes -= meter.spent
  return content
}

const para = (text: string, budget: Budget): Node => {
  budget.left--
  const content = wordsOf(text.trim(), budget)
  return content.length ? { type: 'paragraph', content } : { type: 'paragraph' }
}

/**
 * GitHub's five alerts, as the callout each one is: the emoji and the tone
 * they are written back out as too (`prompt.ts`), so one survives a trip
 * through GitHub and back.
 */
export const ALERTS: Record<string, { emoji: string; tone: string }> = {
  NOTE: { emoji: 'ℹ️', tone: 'blue' },
  TIP: { emoji: '💡', tone: 'green' },
  IMPORTANT: { emoji: '📌', tone: 'grey' },
  WARNING: { emoji: '⚠️', tone: 'yellow' },
  CAUTION: { emoji: '🛑', tone: 'red' },
}
const ALERT = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*(.*)$/i
const OPENS = /^\s*<details(?:\s[^>]{0,200})?>\s*(.*)$/i
const SUMMARY = /^\s*<summary>(.*?)<\/summary>\s*(.*)$/i
const unescaped = (s: string) =>
  s
    .replace(/<[^>]{0,200}>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')

/* Lines run to the end of the line: `.` stops at a line separator, and
   `\s+(.*)$` on a run of spaces before one tried every split of it. The
   same pattern written so the run and the words cannot share a character. */
const LIST = /^(\s*)([-*+]|\d+[.)])\s+(\S[^\n\r\u2028\u2029]*|)$/
const FILE = /^!?\[[^\]]*\]\(file:([0-9a-f-]{36})\)$/i

/* The lines left over, as one run of words. */
const rest = (lines: string[]) =>
  lines
    .map((l) => l.trim())
    .filter(Boolean)
    .join(' ')

/** A whole body, as the editor's document. */
export function fromMarkdown(source: string, depth = 0, budget: Budget = fresh(source)): Node {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const blocks: Node[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]!
    if (!line.trim()) {
      i++
      continue
    }
    if (budget.left <= 0) {
      blocks.push(plain(rest(lines.slice(i))))
      break
    }
    /* Read with the end of the line trimmed first: `\s*([\w+-]*)\s*$`,
       with no language between them, tried every split of a run of
       spaces between its two `\s*` — eight seconds at 200 000. */
    const fence = /^\s*(```|~~~)\s*([\w+-]*)$/.exec(line.trimEnd())
    if (fence) {
      const body: string[] = []
      i++
      while (i < lines.length && !lines[i]!.trim().startsWith(fence[1]!)) body.push(lines[i++]!)
      i++
      const text = body.join('\n')
      budget.left -= text ? 2 : 1
      blocks.push({
        type: 'codeBlock',
        attrs: { language: fence[2] || null },
        ...(text ? { content: [{ type: 'text', text }] } : {}),
      })
      continue
    }
    /* The closing hashes are taken off by hand: as one pattern, a lazy
       middle between two runs of spaces tried every split of them, and a
       heading of a few thousand spaces held the thread for minutes. */
    const heading = /^(#{1,6})[ \t]+([^ \t\n\r\u2028\u2029][^\n\r\u2028\u2029]*|)$/.exec(line)
    if (heading) {
      let words = heading[2]!.trimEnd()
      /* Counted, not matched: `#+$` on a line of hashes is the square of it. */
      let end = words.length
      while (end && words[end - 1] === '#') end--
      if (end < words.length && (end === 0 || words[end - 1] === ' ' || words[end - 1] === '\t')) words = words.slice(0, end)
      budget.left--
      budget.charge(16)
      blocks.push({
        type: 'heading',
        attrs: { level: Math.min(heading[1]!.length, 3) },
        content: wordsOf(words.trim(), budget),
      })
      i++
      continue
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      budget.left--
      blocks.push({ type: 'horizontalRule' })
      i++
      continue
    }
    if (/^\s*>/.test(line)) {
      const quoted: string[] = []
      while (i < lines.length && /^\s*>/.test(lines[i]!)) quoted.push(lines[i++]!.replace(/^\s*>\s?/, ''))
      /* `> [!NOTE]` and its kin: a callout, its words what follows. */
      const alert = ALERT.exec(quoted[0]!.trim())
      if (alert) {
        const rest = [alert[2]!, ...quoted.slice(1)].join('\n')
        budget.left--
        budget.charge(48)
        const inner = depth < 8 ? (fromMarkdown(rest, depth + 1, budget).content ?? []) : [para(rest.replace(/\n/g, ' '), budget)]
        blocks.push({ type: 'callout', attrs: { ...ALERTS[alert[1]!.toUpperCase()]! }, content: inner.length ? inner : [para('', budget)] })
        continue
      }
      /* A quote in a quote is read as one only so deep: a thousand `>`
         ran the stack out. Past that the rest is the quote's words. */
      budget.left--
      blocks.push({
        type: 'blockquote',
        content:
          depth < 8 ? (fromMarkdown(quoted.join('\n'), depth + 1, budget).content ?? [para('', budget)]) : [para(quoted.join(' '), budget)],
      })
      continue
    }
    /* A `<details>` block, its `<summary>` the toggle's line and the rest
       what it folds, to the `</details>` that closes this one. */
    const opens = OPENS.exec(line)
    if (opens && depth < 8) {
      const inside: string[] = [opens[1]!]
      let open = 1
      i++
      while (i < lines.length) {
        const l = lines[i++]!
        open += (l.match(/<details(?:\s[^>]{0,200})?>/gi) ?? []).length
        open -= (l.match(/<\/details>/gi) ?? []).length
        if (open <= 0) {
          inside.push(l.replace(/<\/details>\s*$/i, ''))
          break
        }
        inside.push(l)
      }
      let said = ''
      const at = inside.findIndex((l) => l.trim() !== '')
      const summary = at >= 0 ? SUMMARY.exec(inside[at]!) : null
      if (summary) {
        said = unescaped(summary[1]!).trim()
        inside[at] = summary[2]!
      }
      budget.left -= 3
      const under = fromMarkdown(inside.join('\n'), depth + 1, budget).content ?? []
      const words = wordsOf(said, budget).filter((n) => n.type === 'text')
      blocks.push({
        type: 'details',
        content: [
          words.length ? { type: 'detailsSummary', content: words } : { type: 'detailsSummary' },
          { type: 'detailsContent', content: under.length ? under : [para('', budget)] },
        ],
      })
      continue
    }
    /* `^\s*\|?\s*` was two runs of spaces with nothing certain between
       them: a line of spaces after a table's first row took minutes. */
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*(?:\|\s*)?:?-{2,}/.test(lines[i + 1]!)) {
      const cells = (l: string) =>
        l
          .trim()
          .replace(/^\||\|$/g, '')
          .split('|')
          .map((c) => c.trim())
      const head = cells(line)
      /* A row is a node, and a cell and a paragraph for every column of
         the header, before any words: one that cannot be paid for whole
         is left to be the rest of the body. */
      const cost = 1 + 2 * head.length
      if (1 + cost > budget.left) {
        budget.left = 0
        continue
      }
      budget.left--
      const row = (r: string[], kind: string): Node => {
        budget.left -= 1 + head.length
        return {
          type: 'tableRow',
          content: head.map((_, k) => ({
            type: kind,
            content: [para(r[k] ?? '', budget)],
          })),
        }
      }
      const content = [row(head, 'tableHeader')]
      i += 2
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i]!) && content.length <= TABLE_ROWS && cost <= budget.left) {
        content.push(row(cells(lines[i++]!), 'tableCell'))
      }
      blocks.push({ type: 'table', content })
      /* A row the budget could not pay for is where the rest begins. */
      if (cost > budget.left && i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i]!)) budget.left = 0
      /* Rows past the last one a table holds are their own words. */
      const past: string[] = []
      while (budget.left > 0 && i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i]!)) past.push(lines[i++]!)
      if (past.length) {
        budget.left--
        blocks.push(plain(rest(past)))
      }
      continue
    }
    if (LIST.test(line)) {
      const [list, after] = listAt(lines, i, LIST.exec(line)![1]!.length, budget)
      blocks.push(list)
      i = after
      continue
    }
    /* A paragraph runs until a blank line or the start of something else. */
    const words: string[] = [line]
    i++
    while (i < lines.length && lines[i]!.trim() && !/^\s*(#{1,6}\s|>|```|~~~|\||<details)/i.test(lines[i]!) && !LIST.test(lines[i]!)) {
      words.push(lines[i++]!)
    }
    /* A picture or a file of this workspace, each on a line of its own:
       `![caption](file:<id>)`. Its name, size and room are filled in by
       whoever writes the body, who can look the file up — `tools.ts`. */
    const files = words.map((w) => FILE.exec(w.trim()))
    if (files.every(Boolean)) {
      budget.left -= files.length
      for (const f of files)
        blocks.push({
          type: 'attachment',
          attrs: { fileId: f![1]!.toLowerCase() },
        })
      continue
    }
    blocks.push(para(words.map((w) => w.trim()).join(' '), budget))
  }
  /* A quote, a callout or a fold with nothing in it is given an empty
     paragraph, and pays for it. */
  if (!blocks.length && depth > 0) budget.left--
  const doc = {
    type: 'doc',
    content: blocks.length ? blocks : [{ type: 'paragraph' }],
  }
  /* The net under the budget: a document that came to more than its bytes
     after all — a node charged less than it costs — is the body's plain
     paragraphs instead, which are never more than the body. */
  if (depth === 0 && JSON.stringify(doc).length > bytesFor(source)) return plainParagraphs(source)
  return doc
}

/** Paragraphs of the words as they were, split on blank lines, nothing
    read into them. Linear; never more than the text and a few bytes a
    paragraph. */
export function plainParagraphs(text: string): Node {
  const content = text
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((p) =>
      p
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .join(' '),
    )
    .filter(Boolean)
    .map((t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] }))
  return { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] }
}

/* A list, and any list inside its items that is indented further. A task
   box (`- [ ]`) is drawn as the words after it: the editor has no
   checklist, and the box in the text would be noise. */
function listAt(lines: string[], start: number, indent: number, budget: Budget): [Node, number] {
  const first = LIST.exec(lines[start]!)!
  const ordered = /\d/.test(first[2]!)
  const items: Node[] = []
  budget.left--
  let i = start
  /* Every list keeps its first item, so a list is never empty. */
  while (i < lines.length && (budget.left > 0 || !items.length)) {
    const m = LIST.exec(lines[i]!)
    if (!m || m[1]!.length < indent) {
      if (!lines[i]!.trim() && i + 1 < lines.length && LIST.exec(lines[i + 1]!)?.[1]!.length === indent) {
        i++
        continue
      }
      break
    }
    if (m[1]!.length > indent) {
      const [inner, after] = listAt(lines, i, m[1]!.length, budget)
      items[items.length - 1]?.content?.push(inner)
      i = after
      continue
    }
    if (/\d/.test(m[2]!) !== ordered) break
    budget.left--
    items.push({
      type: 'listItem',
      content: [para(m[3]!.replace(/^\[[ xX]\]\s+/, ''), budget)],
    })
    i++
  }
  return [{ type: ordered ? 'orderedList' : 'bulletList', content: items }, i]
}
