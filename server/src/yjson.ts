import * as Y from 'yjs'
import { cleanLine, lineSays, lineThreads, lineWords, type LineNode } from '@tracker/shared-schema'

/*
 * A document's body as Yjs, and back.
 *
 * Without a ProseMirror schema: the server has no editor and should not
 * grow one. The mapping is the one `y-prosemirror` uses in the browser —
 * an element per node, named by its type, with the node's attributes as
 * its own (nulls left out); a run of text as one XML text, each mark a
 * formatting attribute holding the mark's attributes. What one end writes
 * the other reads as the same document.
 */

/** The fragment the editor binds to — the name TipTap's binding uses too. */
export const FRAGMENT = 'default'

export type PmNode = {
  type?: unknown
  text?: unknown
  attrs?: Record<string, unknown> | null
  marks?: { type?: unknown; attrs?: Record<string, unknown> | null }[] | null
  content?: PmNode[] | null
}

type Doc = { type: 'doc'; content: PmNode[] }

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/* -------------------------------------------------------------- JSON → Y */

function marksOf(n: PmNode): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const m of Array.isArray(n.marks) ? n.marks : []) {
    if (isObject(m) && typeof m.type === 'string') out[m.type] = isObject(m.attrs) ? m.attrs : {}
  }
  return out
}

/**
 * A chip's attributes with its `line` read through `cleanLine` — never
 * trusted, whichever way it is going.
 */
function chipAttrs(attrs: Record<string, unknown>): Record<string, unknown> {
  if (!('line' in attrs)) return attrs
  const line = cleanLine(attrs.line)
  const out = { ...attrs }
  if (line) out.line = line
  else delete out.line
  return out
}

/** A line as the nodes it was, for a chip turned back into its words. */
export const lineNodes = (line: LineNode[]): PmNode[] => line.map((n) => ({ ...n }))

/** One block or inline node, as an element not yet in any document. */
export function toElement(node: PmNode): Y.XmlElement {
  const el = new Y.XmlElement(typeof node.type === 'string' ? node.type : 'paragraph')
  if (isObject(node.attrs)) {
    const attrs = node.type === 'taskref' ? chipAttrs(node.attrs) : node.attrs
    for (const [k, v] of Object.entries(attrs)) {
      /* As `y-prosemirror` writes them: a null is the schema's default. */
      if (v !== null && v !== undefined && k !== 'ychange') el.setAttribute(k, v as never)
    }
  }
  const kids: (Y.XmlElement | Y.XmlText)[] = []
  let run: PmNode[] = []
  const flush = () => {
    if (run.length === 0) return
    const t = new Y.XmlText()
    t.applyDelta(run.map((r) => ({ insert: r.text as string, attributes: marksOf(r) })))
    kids.push(t)
    run = []
  }
  for (const child of Array.isArray(node.content) ? node.content : []) {
    if (!isObject(child)) continue
    if (child.type === 'text') {
      if (typeof child.text === 'string' && child.text.length > 0) run.push(child)
    } else {
      flush()
      kids.push(toElement(child))
    }
  }
  flush()
  if (kids.length) el.insert(0, kids)
  return el
}

function blocksOf(body: unknown): PmNode[] {
  const b = body as PmNode | null
  return isObject(b) && Array.isArray(b.content) ? b.content.filter(isObject) : []
}

/** A fresh state holding `body`, as the update that makes it. */
export function stateFrom(body: unknown): Uint8Array {
  const doc = new Y.Doc()
  const blocks = blocksOf(body)
  if (blocks.length) doc.getXmlFragment(FRAGMENT).insert(0, blocks.map(toElement))
  const out = Y.encodeStateAsUpdate(doc)
  doc.destroy()
  return out
}

/* -------------------------------------------------------------- Y → JSON */

function nodeOf(item: unknown): PmNode[] {
  if (item instanceof Y.XmlText) {
    const out: PmNode[] = []
    for (const d of item.toDelta() as { insert?: unknown; attributes?: Record<string, unknown> }[]) {
      /* An embed is nothing the editor writes. */
      if (typeof d.insert !== 'string' || d.insert.length === 0) continue
      const text: PmNode = { type: 'text', text: d.insert }
      if (d.attributes && Object.keys(d.attributes).length) {
        text.marks = Object.entries(d.attributes).map(([name, attrs]) => {
          /* An overlapping mark is written `name--hash`. */
          const type = /^(.*)--[a-zA-Z0-9+/=]{8}$/.exec(name)?.[1] ?? name
          return isObject(attrs) && Object.keys(attrs).length ? { type, attrs } : { type }
        })
      }
      out.push(text)
    }
    return out
  }
  if (item instanceof Y.XmlElement) {
    const attrs = item.getAttributes() as Record<string, unknown>
    /*
     * A picture still on its way up has no file yet. The editor leaves it
     * out of what it saves (`settled` in `web/src/ui/Editor.tsx`) and so
     * does this: the stored body never holds a node nothing can draw.
     */
    if (item.nodeName === 'attachment') {
      if (!attrs.fileId) return []
      delete attrs.uploadId
    }
    /* So is a task still being made: its words, until it has an id. */
    if (item.nodeName === 'taskref') {
      const line = cleanLine(attrs.line)
      if (!attrs.id) {
        if (line) return lineNodes(line)
        return typeof attrs.title === 'string' && attrs.title ? [{ type: 'text', text: attrs.title }] : []
      }
      delete attrs.making
      if (line) attrs.line = line
      else delete attrs.line
    }
    const node: PmNode = { type: item.nodeName }
    if (Object.keys(attrs).length) node.attrs = attrs
    const content = item.toArray().flatMap(nodeOf)
    if (content.length) node.content = content
    return [node]
  }
  /* Anything else in the list — a Y.Map, a raw value — was not put there
     by an editor, and is not a node. */
  return []
}

/** The body the state stands for, as the stored ProseMirror JSON. */
export function bodyOf(doc: Y.Doc): Doc {
  return { type: 'doc', content: doc.getXmlFragment(FRAGMENT).toArray().flatMap(nodeOf) }
}

/* --------------------------------------------------------------- merging */

/**
 * A block as it compares: no nulls, no empty lists, marks in one order.
 * The stored body may have been written by the editor (every attribute,
 * nulls included), by this file (nulls left out) or from Markdown (only
 * what Markdown says) — the same paragraph three ways.
 */
function norm(n: unknown): unknown {
  if (!isObject(n)) return n
  const out: Record<string, unknown> = { type: n.type }
  if (typeof n.text === 'string') out.text = n.text
  if (isObject(n.attrs)) {
    const a = Object.fromEntries(
      Object.entries(n.attrs)
        .filter(([k, v]) => v !== null && v !== undefined && k !== 'uploadId')
        .sort(([x], [y]) => (x < y ? -1 : 1)),
    )
    if (Object.keys(a).length) out.attrs = a
  }
  if (Array.isArray(n.marks) && n.marks.length) {
    out.marks = n.marks.map(norm).sort((x, y) => (JSON.stringify(x) < JSON.stringify(y) ? -1 : 1))
  }
  if (Array.isArray(n.content) && n.content.length) out.content = n.content.map(norm)
  return out
}

export const key = (n: unknown) => JSON.stringify(norm(n))

/** The attributes a block keeps through Markdown: the rest are the editor's. */
const CARRIED = new Set(['level', 'language', 'fileId', 'start', 'checked'])

function markLoose(m: unknown): string {
  if (!isObject(m)) return ''
  return m.type === 'link' && isObject(m.attrs) ? `link:${String(m.attrs.href ?? '')}` : String(m.type)
}

/**
 * A node as Markdown can carry it — `update_doc` reads a body as JSON and
 * writes it back as Markdown, and a paragraph that came back without the
 * editor's own attributes, or with its words in runs cut differently, is
 * the same paragraph. Text runs with the same marks are one run; only the
 * attributes Markdown says are kept; a link is its address.
 */
function loose(n: unknown): unknown {
  if (!isObject(n)) return n
  const out: Record<string, unknown> = { type: n.type }
  if (isObject(n.attrs)) {
    const a = Object.fromEntries(
      Object.entries(n.attrs)
        .filter(([k, v]) => CARRIED.has(k) && v !== null && v !== undefined)
        .sort(([x], [y]) => (x < y ? -1 : 1)),
    )
    if (Object.keys(a).length) out.attrs = a
  }
  if (Array.isArray(n.content) && n.content.length) {
    const kids: unknown[] = []
    for (const c of n.content) {
      if (isObject(c) && c.type === 'text' && typeof c.text === 'string') {
        const sig = (Array.isArray(c.marks) ? c.marks.map(markLoose) : []).sort().join(',')
        const last = kids[kids.length - 1] as { text?: string; sig?: string } | undefined
        if (last && typeof last.text === 'string' && last.sig === sig) last.text += c.text
        else kids.push({ text: c.text, sig })
      } else kids.push(loose(c))
    }
    out.content = kids
  }
  return out
}

const looseKey = (n: unknown) => JSON.stringify(loose(n))

type Sign = { k: string; l: string }

/** Which blocks of `a` and `b` are the same block, in order: a longest common subsequence. */
function pairs(n0: number, m0: number, eq: (i: number, j: number) => boolean): [number, number][] {
  const out: [number, number][] = []
  let head = 0
  while (head < n0 && head < m0 && eq(head, head)) {
    out.push([head, head])
    head++
  }
  let tail = 0
  while (tail < n0 - head && tail < m0 - head && eq(n0 - 1 - tail, m0 - 1 - tail)) tail++
  const n = n0 - head - tail
  const m = m0 - head - tail
  /* A middle too large to compare block by block is one change. */
  if (n > 0 && m > 0 && n * m <= 4_000_000) {
    const w = m + 1
    const dp = new Uint32Array((n + 1) * w)
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i * w + j] = eq(head + i, head + j) ? dp[(i + 1) * w + j + 1]! + 1 : Math.max(dp[(i + 1) * w + j]!, dp[i * w + j + 1]!)
      }
    }
    let i = 0
    let j = 0
    while (i < n && j < m) {
      if (eq(head + i, head + j)) {
        out.push([head + i, head + j])
        i++
        j++
      } else if (dp[(i + 1) * w + j]! >= dp[i * w + j + 1]!) i++
      else j++
    }
  }
  for (let t = tail; t > 0; t--) out.push([n0 - t, m0 - t])
  return out
}

export type Merged = { changed: boolean; conflicts: number }

/**
 * Where a body sent from outside lands in the live state.
 *
 * Three bodies, block by block: `base`, the body the caller read; `theirs`,
 * what the caller sent; and the live state. Each stretch the caller changed
 * against `base` is found in the live state between the nearest blocks
 * around it that nobody changed, and then:
 *
 * - what the caller wrote that the live state already says is already
 *   done — a retry, a `base_rev` used twice, a typo the people fixed the
 *   same way — and is not written again;
 * - when the people changed or removed a block of the stretch and the
 *   caller's words are not already there, the stretch is the people's: it
 *   is left as they left it and counted in `conflicts`, so the caller can
 *   read again rather than have two versions of one paragraph;
 * - otherwise the stretch's blocks are replaced by the caller's, and a
 *   block the caller added goes where it stands in their body.
 *
 * Nothing the caller did not touch is written. Blocks are compared as
 * written; `markdown` also counts a block as the same when it is the same
 * as Markdown carries it (`loose`), for a body that came through MCP's
 * Markdown and cannot say what Markdown cannot.
 */
export function mergeInto(doc: Y.Doc, base: unknown, theirs: unknown, markdown = false): Merged {
  const frag = doc.getXmlFragment(FRAGMENT)
  const sign = (n: unknown): Sign => ({ k: key(n), l: markdown ? looseKey(n) : '' })
  const same = (x: Sign, y: Sign) => x.k === y.k || (markdown && x.l === y.l)
  const B = blocksOf(base).map(sign)
  const Tn = blocksOf(theirs)
  const T = Tn.map(sign)
  const O = bodyOf(doc).content.map(sign)

  /* Where each base block stands in the live state, or -1 when the people changed or removed it. */
  const live = new Array<number>(B.length).fill(-1)
  for (const [i, j] of pairs(B.length, O.length, (i, j) => B[i]!.k === O[j]!.k)) live[i] = j

  type Edit = { at: number; del: boolean; blocks?: PmNode[] }
  const edits: Edit[] = []
  let conflicts = 0
  let pb = -1
  let pt = -1
  const hunks = [...pairs(B.length, T.length, (i, j) => same(B[i]!, T[j]!)), [B.length, T.length] as [number, number]]
  for (const [nb, nt] of hunks) {
    if (nb - pb > 1 || nt - pt > 1) {
      /* The stretch of the live state it stands in: after the nearest
         block before it that nobody changed, up to the nearest after. */
      let k = pb
      while (k >= 0 && live[k]! < 0) k--
      const lo = k >= 0 ? live[k]! + 1 : 0
      k = nb
      while (k < B.length && live[k]! < 0) k++
      const hi = k < B.length ? live[k]! : O.length
      const there = O.slice(lo, hi)
      /* What of the caller's stretch the live one already holds, matched
         block for block in order — not "appears anywhere", which dropped
         a second empty paragraph or a line said twice on purpose. */
      const mine = T.slice(pt + 1, nt)
      const held = new Set(pairs(mine.length, there.length, (a, b) => same(there[b]!, mine[a]!)).map(([a]) => a))
      const fresh: PmNode[] = []
      for (let j = pt + 1; j < nt; j++) if (!held.has(j - pt - 1)) fresh.push(Tn[j]!)
      let peopleToo = false
      const gone: number[] = []
      for (let i = pb + 1; i < nb; i++) {
        if (live[i]! < 0) peopleToo = true
        else gone.push(live[i]!)
      }
      if (peopleToo && fresh.length > 0) conflicts++
      else {
        for (const at of gone) edits.push({ at, del: true })
        if (fresh.length) edits.push({ at: gone[0] ?? lo, del: false, blocks: fresh })
      }
    }
    pb = nb
    pt = nt
  }
  if (edits.length === 0) return { changed: false, conflicts }
  /* From the end, so every place still means what it meant; at one place
     the block goes before what replaces it. */
  edits.sort((x, y) => y.at - x.at || (x.del === y.del ? 0 : x.del ? -1 : 1))
  doc.transact(() => {
    for (const e of edits) {
      if (e.del) frag.delete(e.at, 1)
      else frag.insert(e.at, e.blocks!.map(toElement))
    }
  })
  return { changed: true, conflicts }
}

/** Whether an update changes anything at all — an empty one is two zero bytes. */
export function isEmpty(update: Uint8Array): boolean {
  const { structs, ds } = Y.decodeUpdate(update)
  return structs.length === 0 && ds.clients.size === 0
}

/* ------------------------------------------------- what a body cannot say */

/**
 * The mark a thread's words carry.
 * One mark with every thread's id in it, space-separated, rather than a
 * mark per thread: a mark that may stand beside itself is written into
 * Yjs under a hashed name the server would have to compute as the browser
 * does.
 */
export const COMMENT = 'comment'

const idsOf = (v: unknown): string[] => (isObject(v) && typeof v.ids === 'string' ? v.ids.split(/\s+/).filter(Boolean) : [])

/** Every thread id a body's comment marks name. */
export function threadsIn(body: unknown): Set<string> {
  const out = new Set<string>()
  const walk = (n: unknown) => {
    if (!isObject(n)) return
    for (const m of Array.isArray(n.marks) ? n.marks : [])
      if (isObject(m) && m.type === COMMENT) for (const id of idsOf(m.attrs)) out.add(id)
    /* A line made into a task keeps its thread's words inside the chip — `text-to-task.md`. */
    if (n.type === 'taskref' && isObject(n.attrs)) for (const id of lineThreads(cleanLine(n.attrs.line))) out.add(id)
    for (const k of Array.isArray(n.content) ? n.content : []) walk(k)
  }
  walk(body)
  return out
}

/** The body with every comment mark taken out — for a reader by link. */
export function withoutThreads<T>(body: T): T {
  const walk = (n: unknown): unknown => {
    if (!isObject(n)) return n
    const out: Record<string, unknown> = { ...n }
    if (Array.isArray(n.marks)) {
      const marks = n.marks.filter((m) => !(isObject(m) && m.type === COMMENT))
      if (marks.length) out.marks = marks
      else delete out.marks
    }
    if (Array.isArray(n.content)) {
      /* Runs the mark split, joined again where nothing else tells them apart. */
      const joined: unknown[] = []
      for (const k of n.content.map(walk)) {
        const last = joined[joined.length - 1]
        if (
          isObject(k) &&
          isObject(last) &&
          k.type === 'text' &&
          last.type === 'text' &&
          JSON.stringify(k.marks ?? null) === JSON.stringify(last.marks ?? null)
        )
          joined[joined.length - 1] = { ...last, text: `${String(last.text)}${String(k.text)}` }
        else joined.push(k)
      }
      out.content = joined
    }
    return out
  }
  return walk(body) as T
}

/**
 * A body for somebody outside the project, a reader by link: no thread's
 * mark, and a task named in it as its title in words — not its id, its
 * project or where it stands.
 */
export function forStrangers<T>(body: T): T {
  const walk = (n: unknown): unknown => {
    if (!isObject(n)) return n
    /* A task or another document named in it: its title, not its id or its project's. */
    if (n.type === 'taskref' || n.type === 'docref') {
      const title = isObject(n.attrs) && typeof n.attrs.title === 'string' ? n.attrs.title : ''
      /* A chip that still says its line: the line, links and mentions kept; its threads go below. */
      const line = n.type === 'taskref' && isObject(n.attrs) ? cleanLine(n.attrs.line) : null
      if (lineSays(line, title)) return lineNodes(line)
      return title ? { type: 'text', text: title } : null
    }
    if (!Array.isArray(n.content)) return n
    return { ...n, content: n.content.flatMap(walk).filter(Boolean) }
  }
  /* Threads taken out last, which joins the words a chip has become with the words around it. */
  return withoutThreads(walk(body)) as T
}

/* What Markdown cannot say, carried onto a body that came back through it. */

/** A block whose content is words: a paragraph, a heading, a list item's line. */
const isLine = (n: unknown): n is PmNode =>
  isObject(n) &&
  n.type !== 'codeBlock' &&
  Array.isArray(n.content) &&
  n.content.some((k) => isObject(k) && (k.type === 'text' || k.type === 'taskref'))

function linesOf(body: unknown): PmNode[] {
  const out: PmNode[] = []
  const walk = (n: unknown) => {
    if (!isObject(n)) return
    if (isLine(n)) out.push(n)
    else if (Array.isArray(n.content)) n.content.forEach(walk)
  }
  walk(body)
  return out
}

/** A line's words, a node that is not words standing as one character. */
const OBJ = '\ufffc'
function wordsOfLine(n: PmNode): string {
  return (n.content ?? []).map((k) => (k.type === 'text' ? String(k.text ?? '') : OBJ)).join('')
}

/** What a base line held that Markdown cannot say: a thread's words, a task's chip. */
type Thread = { kind: 'thread'; text: string; ids: string[] }
/** A chip: the words it is written out as, and the threads on the words of the line it holds. */
type Rich = Thread | { kind: 'chip'; node: PmNode; says: string[]; threads: Thread[] }

/** The threads on a run of nodes: each stretch of words under the same threads, as one. */
function threadsOf(kids: readonly PmNode[]): Thread[] {
  const out: Thread[] = []
  let joined = false
  for (const k of kids) {
    if (k.type !== 'text' || typeof k.text !== 'string') {
      joined = false
      continue
    }
    const ids = (Array.isArray(k.marks) ? k.marks : []).flatMap((m) => (isObject(m) && m.type === COMMENT ? idsOf(m.attrs) : []))
    const last = out[out.length - 1]
    if (ids.length && joined && last && last.ids.join(' ') === ids.join(' ')) last.text += k.text
    else if (ids.length) out.push({ kind: 'thread', text: k.text, ids })
    joined = ids.length > 0
  }
  return out
}

function richOf(line: PmNode): Rich[] {
  const out: Rich[] = []
  const run: PmNode[] = []
  const flush = () => {
    out.push(...threadsOf(run))
    run.length = 0
  }
  for (const k of line.content ?? []) {
    if (k.type === 'taskref' && isObject(k.attrs)) {
      flush()
      const a = k.attrs
      const title = typeof a.title === 'string' ? a.title : ''
      const n = typeof a.number === 'number' ? a.number : null
      const handle = n === null ? null : typeof a.key === 'string' && a.key ? `${a.key}-${n}` : `#${n}`
      /* The line it holds, as Markdown writes it out (`prompt.ts`) while it
         still says the title — whole, where a cut title ends in "…" the
         line never has. */
      const line_ = cleanLine(a.line)
      const words = lineSays(line_, title) ? lineWords(line_).trim() : ''
      /* As the chip is written out (`KEY-41 Title`, `#41 Title`), longest first, and as its title alone. */
      const says = [words, title]
        .flatMap((t) => [handle && t ? `${handle} ${t}` : null, n !== null && t ? `#${n} ${t}` : null])
        .concat([words, title])
        .filter((x): x is string => Boolean(x && x.trim()))
      out.push({ kind: 'chip', node: k, says: [...new Set(says)], threads: threadsOf(line_ ?? []) })
    } else run.push(k)
  }
  flush()
  return out
}

/** A thread's mark put back on its words in the line's content, as whole words; whether it was. */
function markThread_(kids: PmNode[], r: Thread): boolean {
  if (!r.text.trim()) return false
  const at = wholeAt(wordsOfLine({ content: kids }), r.text)
  if (at < 0) return false
  const [a, b] = span(kids, at, at + r.text.length)
  for (let i = a; i <= b; i++) {
    const k = kids[i]!
    if (k.type !== 'text') continue
    const marks = (Array.isArray(k.marks) ? k.marks : []).filter((m) => !(isObject(m) && m.type === COMMENT))
    const had = (Array.isArray(k.marks) ? k.marks : []).flatMap((m) => (isObject(m) && m.type === COMMENT ? idsOf(m.attrs) : []))
    kids[i] = { ...k, marks: [...marks, { type: COMMENT, attrs: { ids: [...new Set([...had, ...r.ids])].join(' ') } }] }
  }
  return true
}

/** The line's content cut so that a boundary falls at `at` words in. */
function cutAt(kids: PmNode[], at: number): void {
  let pos = 0
  for (let i = 0; i < kids.length; i++) {
    const k = kids[i]!
    const len = k.type === 'text' ? String(k.text ?? '').length : 1
    if (at > pos && at < pos + len && k.type === 'text') {
      const t = String(k.text)
      kids.splice(i, 1, { ...k, text: t.slice(0, at - pos) }, { ...k, text: t.slice(at - pos) })
      return
    }
    pos += len
  }
}

/** The indexes of the content between two places in words, after cutting there. */
function span(kids: PmNode[], from: number, to: number): [number, number] {
  cutAt(kids, from)
  cutAt(kids, to)
  let pos = 0
  let a = -1
  let b = -1
  for (let i = 0; i < kids.length; i++) {
    if (pos === from && a < 0) a = i
    pos += kids[i]!.type === 'text' ? String(kids[i]!.text ?? '').length : 1
    if (pos === to) {
      b = i
      break
    }
  }
  return [a, b]
}

/** Each rich thing of a base line put onto an incoming line where its words still are; how many were. */
/** The words of a text, lowercased: what two lines are compared by. */
const wordList = (t: string) =>
  t
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)

/** Where `words` stand in `said` as whole words — not "fix" inside "Prefix". */
function wholeAt(said: string, words: string): number {
  const edge = /[\p{L}\p{N}]/u
  for (let at = said.indexOf(words); at >= 0; at = said.indexOf(words, at + 1)) {
    const before = at > 0 ? said[at - 1]! : ' '
    const after = at + words.length < said.length ? said[at + words.length]! : ' '
    if (!edge.test(before) && !edge.test(after)) return at
  }
  return -1
}

/** Each rich thing of a base line put onto the line matched to it, where its words still are, as whole words. */
function carryOnto(line: PmNode, rich: Rich[]): void {
  const kids = (line.content ?? []).map((k) => ({ ...k }))
  let carried = 0
  for (const r of rich) {
    const said = wordsOfLine({ content: kids })
    if (r.kind === 'thread') {
      if (markThread_(kids, r)) carried++
    } else {
      const id = isObject(r.node.attrs) ? r.node.attrs.id : null
      if (kids.some((k) => k.type === 'taskref' && isObject(k.attrs) && k.attrs.id === id)) continue
      const words = r.says.find((w) => wholeAt(said, w) >= 0)
      if (!words) {
        /* The chip is not made again — its words were changed — but the
           threads on the line it held go back on their words where those
           still are, as any thread's do: they are not orphaned by it. */
        for (const t of r.threads) if (markThread_(kids, t)) carried++
        continue
      }
      const at = wholeAt(said, words)
      const [a, b] = span(kids, at, at + words.length)
      kids.splice(a, b - a + 1, r.node)
      carried++
    }
  }
  if (carried) line.content = kids
}

/** Which lines of `a` and `b` say the same words, in order: a longest common subsequence. */
function alignLines(a: string[], b: string[]): Map<number, number> {
  const n = a.length
  const m = b.length
  const out = new Map<number, number>()
  if (!n || !m || n * m > 4_000_000) return out
  const w = m + 1
  const dp = new Uint32Array((n + 1) * w)
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--)
      dp[i * w + j] = a[i] === b[j] ? dp[(i + 1) * w + j + 1]! + 1 : Math.max(dp[(i + 1) * w + j]!, dp[i * w + j + 1]!)
  }
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.set(i, j)
      i++
      j++
    } else if (dp[(i + 1) * w + j]! >= dp[i * w + j + 1]!) i++
    else j++
  }
  return out
}

/**
 * A body sent from outside, with what Markdown cannot say carried onto it.
 *
 * Markdown has no way to write a comment's mark or a task named in a line,
 * so
 * an agent that read a document and wrote it back sends every line without
 * them. What a base line held goes only onto the same line in the incoming
 * body — the line the alignment of the two bodies pairs it with, or, where
 * the line was rewritten, the line standing in its place that shares most
 * of its words — and only onto whole words. A chip also needs a word of its
 * line besides its own, unless the line is nothing but the chip's words.
 * Anything without a line it surely belongs to is dropped: the thread reads
 * as on deleted text, and the chip stays words. Nothing of the incoming
 * body is taken away or changed — not a word, an attribute or an address.
 */
export function carryRich(base: unknown, theirs: unknown, onlyThread?: string): unknown {
  /* One thread's mark and nothing else — what an anchor writes into the stored body. */
  const richOf_ = (l: PmNode): Rich[] =>
    onlyThread === undefined
      ? richOf(l)
      : richOf(l).flatMap((r) => (r.kind === 'thread' && r.ids.includes(onlyThread) ? [{ ...r, ids: [onlyThread] }] : []))
  const baseLines = linesOf(base)
  if (!baseLines.some((l) => richOf_(l).length) || !isObject(theirs)) return theirs
  const out = structuredClone(theirs)
  const into = linesOf(out)
  const said = (l: PmNode) => wordList(wordsOfLine(l)).join(' ')
  const pair = alignLines(baseLines.map(said), into.map(said))
  const taken = new Set(pair.values())
  for (let i = 0; i < baseLines.length; i++) {
    const rich = richOf_(baseLines[i]!)
    if (!rich.length) continue
    let target = pair.get(i)
    if (target === undefined) {
      /* Rewritten: the incoming lines between the paired lines around it. */
      let lo = 0
      for (let k = i - 1; k >= 0; k--)
        if (pair.has(k)) {
          lo = pair.get(k)! + 1
          break
        }
      let hi = into.length
      for (let k = i + 1; k < baseLines.length; k++)
        if (pair.has(k)) {
          hi = pair.get(k)!
          break
        }
      const chipWords = new Set(rich.flatMap((r) => (r.kind === 'chip' ? r.says.flatMap(wordList) : [])))
      const mine = new Set(wordList(wordsOfLine(baseLines[i]!)).filter((x) => !chipWords.has(x)))
      let best = -1
      let score = 0
      for (let j = lo; j < hi; j++) {
        if (taken.has(j)) continue
        const theirsWords = wordList(wordsOfLine(into[j]!))
        const rest = new Set(theirsWords.filter((x) => !chipWords.has(x)))
        const shared = [...mine].filter((x) => rest.has(x)).length
        const overlap = shared / Math.max(mine.size, rest.size, 1)
        /* Nothing but the chip's words, standing where the chip's line stood. */
        const onlyChip = mine.size === 0 && rest.size === 0 && theirsWords.length > 0
        const sure = onlyChip ? 1 : shared > 0 && overlap >= 0.5 ? overlap : 0
        if (sure > score) {
          best = j
          score = sure
        }
      }
      if (best < 0) {
        /* A chip whose line was reworded: the chip is not made again, but
           the threads on its line go onto the line standing in its place,
           when that shares at least half the words the line said. */
        const held = rich.flatMap((r) => (r.kind === 'chip' ? r.threads : []))
        if (!held.length) continue
        const said = new Set(
          wordList(
            (baseLines[i]!.content ?? [])
              .map((k) => {
                if (k.type === 'text') return String(k.text ?? '')
                const line = k.type === 'taskref' && isObject(k.attrs) ? cleanLine(k.attrs.line) : null
                return line ? lineWords(line) : ' '
              })
              .join(''),
          ),
        )
        for (let j = lo; j < hi; j++) {
          if (taken.has(j)) continue
          const theirsWords = new Set(wordList(wordsOfLine(into[j]!)))
          const shared = [...said].filter((x) => theirsWords.has(x)).length
          const overlap = shared / Math.max(said.size, theirsWords.size, 1)
          if (shared > 0 && overlap >= 0.5 && overlap > score) {
            best = j
            score = overlap
          }
        }
        if (best < 0) continue
        taken.add(best)
        carryOnto(into[best]!, held)
        continue
      }
      target = best
    }
    taken.add(target)
    carryOnto(into[target]!, rich)
  }
  return out
}

/* ------------------------------------------------------------- anchoring */

/** Every text of the state, in document order. */
function texts(doc: Y.Doc): Y.XmlText[] {
  const out: Y.XmlText[] = []
  const walk = (item: unknown) => {
    if (item instanceof Y.XmlText) out.push(item)
    else if (item instanceof Y.XmlElement) for (const k of item.toArray()) walk(k)
  }
  for (const k of doc.getXmlFragment(FRAGMENT).toArray()) walk(k)
  return out
}

/** A stretch of the state: from a place in one text to a place in the same or a later one. */
export type Stretch = { from: { text: Y.XmlText; index: number }; to: { text: Y.XmlText; index: number } }

/**
 * Where two encoded relative positions stand now, or null while either
 * names an item this state does not have yet, or they cross.
 */
export function stretchAt(doc: Y.Doc, from: Uint8Array, to: Uint8Array): Stretch | null {
  let a: Y.AbsolutePosition | null
  let b: Y.AbsolutePosition | null
  try {
    a = Y.createAbsolutePositionFromRelativePosition(Y.decodeRelativePosition(from), doc)
    b = Y.createAbsolutePositionFromRelativePosition(Y.decodeRelativePosition(to), doc)
  } catch {
    return null
  }
  if (!a || !b || !(a.type instanceof Y.XmlText) || !(b.type instanceof Y.XmlText)) return null
  const all = texts(doc)
  const i = all.indexOf(a.type)
  const j = all.indexOf(b.type)
  if (i < 0 || j < 0 || i > j || (i === j && a.index >= b.index)) return null
  return { from: { text: a.type, index: a.index }, to: { text: b.type, index: b.index } }
}

/** The first stretch of one text that says exactly `words`. */
export function stretchOf(doc: Y.Doc, words: string): Stretch | null {
  const want = words.trim()
  if (!want) return null
  for (const t of texts(doc)) {
    const at = plain(t).indexOf(want)
    if (at >= 0) return { from: { text: t, index: at }, to: { text: t, index: at + want.length } }
  }
  return null
}

/** A text's words without its formatting. */
function plain(t: Y.XmlText): string {
  return (t.toDelta() as { insert?: unknown }[]).map((d) => (typeof d.insert === 'string' ? d.insert : '')).join('')
}

/** Each piece of text a stretch covers: the text, where in it, how long. */
function pieces(doc: Y.Doc, s: Stretch): { text: Y.XmlText; index: number; length: number }[] {
  const all = texts(doc)
  const i = all.indexOf(s.from.text)
  const j = all.indexOf(s.to.text)
  const out: { text: Y.XmlText; index: number; length: number }[] = []
  for (let k = i; k <= j; k++) {
    const t = all[k]!
    const start = k === i ? s.from.index : 0
    const end = k === j ? s.to.index : t.length
    if (end > start) out.push({ text: t, index: start, length: end - start })
  }
  return out
}

/** The words a stretch covers, as a person would quote them. */
export function wordsOf(doc: Y.Doc, s: Stretch): string {
  return pieces(doc, s)
    .map((p) => plain(p.text).slice(p.index, p.index + p.length))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * The thread's mark over a stretch, as one transaction: each run keeps the
 * threads it already had and gains this one.
 */
export function markThread(doc: Y.Doc, s: Stretch, id: string): void {
  doc.transact(() => {
    for (const p of pieces(doc, s)) {
      let at = 0
      for (const d of p.text.toDelta() as { insert?: unknown; attributes?: Record<string, unknown> }[]) {
        const len = typeof d.insert === 'string' ? d.insert.length : 1
        const lo = Math.max(at, p.index)
        const hi = Math.min(at + len, p.index + p.length)
        if (hi > lo) {
          const had = idsOf(d.attributes?.[COMMENT])
          p.text.format(lo, hi - lo, { [COMMENT]: { ids: [...new Set([...had, id])].join(' ') } })
        }
        at += len
      }
    }
  })
}
