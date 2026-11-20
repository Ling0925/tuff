/*
 * Slack's incoming-webhook JSON, made into the product's own rich text.
 *
 * What arrives is somebody else's text, from anybody who holds a hook's
 * address. It is parsed into nodes and nothing else: no markup passes
 * through, links are only http(s) and mailto, and none of the nodes that
 * make the product fetch, notify or link anything — mentions, task and
 * document references, files, GIFs, link cards — are ever made. A payload
 * of the wrong shape is refused with Slack's own words for it.
 */

type Mark = { type: 'bold' | 'italic' | 'strike' | 'code' } | { type: 'link'; attrs: { href: string } }
type Text = { type: 'text'; text: string; marks?: Mark[] }
type Block =
  | { type: 'paragraph'; content?: Text[] }
  | { type: 'codeBlock'; content?: Text[] }
  | { type: 'blockquote'; content: Block[] }
  | { type: 'bulletList' | 'orderedList'; content: { type: 'listItem'; content: Block[] }[] }

export type SlackDoc = { type: 'doc'; content: Block[] }

/** Slack's own refusals, said back in its words. */
export type Refusal = 'invalid_payload' | 'no_text' | 'msg_too_long' | 'invalid_blocks' | 'too_many_attachments'

/* Slack's ceilings. */
const MAX_TEXT = 40_000
const MAX_BLOCKS = 50
const MAX_ATTACHMENTS = 100
/* Ours: one piece of text inside a block or an attachment, a list's
   items, and the document as a whole. */
const MAX_PIECE = 3_000
const MAX_ITEMS = 100
const MAX_NODES = 2_000

/*
 * The document's nodes are counted as they are made, and the reading stops
 * the moment there are enough: a payload shaped to grow costs what two
 * thousand nodes cost, not what its sixty-four kilobytes could.
 */
let budget = Number.POSITIVE_INFINITY
const FULL = Symbol('full')
function spend(n = 1) {
  budget -= n
  if (budget < 0) throw FULL
}

/** An address that may be a link: http(s) or mail, whole, with nothing odd in it. */
export function safeHref(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const u = raw.trim()
  if (u.length === 0 || u.length > 2048) return null
  if (/[\s\u0000-\u001f\u007f<>"]/.test(u)) return null
  if (/^mailto:[^@]+@[^@]+$/i.test(u)) return u
  if (!/^https?:\/\//i.test(u)) return null
  try {
    const parsed = new URL(u)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? u : null
  } catch {
    return null
  }
}

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)
const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
const cut = (s: string, n = MAX_PIECE) => (s.length > n ? `${s.slice(0, n)}…` : s)

/** Slack escapes three characters in text, and only those. */
const unescape = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')

function text(t: string, marks: Mark[]): Text[] {
  if (!t) return []
  spend()
  return [marks.length ? { type: 'text', text: t, marks: [...marks] } : { type: 'text', text: t }]
}

/*
 * Plain words, a link only where the address is a safe one. Where a link
 * really goes is drawn beside it when the message is read (`Doc`'s
 * `LinkHost`), never written into the words here, so nothing a payload
 * types can pass for it.
 */
function linkOr(label: string, href: unknown, marks: Mark[] = []): Text[] {
  const safe = safeHref(href)
  const words = label || (typeof href === 'string' ? href : '')
  return text(words, safe ? [...marks, { type: 'link', attrs: { href: safe } }] : marks)
}

/*
 * What `<…>` holds: a link, somebody, a channel, a broadcast, a date — each
 * written out as words, never as a mention: a hook calls nobody in.
 */
function angle(inside: string, marks: Mark[]): Text[] {
  const bar = inside.indexOf('|')
  const target = bar === -1 ? inside : inside.slice(0, bar)
  const label = bar === -1 ? '' : unescape(inside.slice(bar + 1))
  if (target.startsWith('@')) return text(label ? `@${label.replace(/^@/, '')}` : target, marks)
  if (target.startsWith('#')) return text(`#${(label || target.slice(1)).replace(/^#/, '')}`, marks)
  if (target.startsWith('!')) {
    const what = target.slice(1)
    if (what === 'here' || what === 'channel' || what === 'everyone') return text(`@${what}`, marks)
    if (what.startsWith('subteam^')) return text(label || '@group', marks)
    if (what.startsWith('date^')) return text(label || '', marks)
    return text(label || what, marks)
  }
  const href = unescape(target)
  return linkOr(label || href, href, marks)
}

const PAIRS: { char: string; mark: Mark }[] = [
  { char: '*', mark: { type: 'bold' } },
  { char: '_', mark: { type: 'italic' } },
  { char: '~', mark: { type: 'strike' } },
]

/*
 * One line of mrkdwn. The earliest of a link, a code span, or a pair of
 * markers at word edges is taken; what is between pairs is read again
 * with the mark on, so `*_both_*` is bold and italic.
 */
/*
 * Walked by position, each pattern's next match kept until the walk passes
 * it: forty thousand characters of tokens would otherwise be scanned again
 * from where the walk stands for every token, and a payload could cost the
 * server seconds.
 */
type Took = { lead: number; nodes: () => Text[] } | null
const PATTERNS: { re: RegExp; take: (m: RegExpExecArray, marks: Mark[], depth: number) => Took }[] = [
  { re: /<([^<>\n]{1,2100})>/g, take: (m, marks) => ({ lead: 0, nodes: () => angle(m[1]!, marks) }) },
  { re: /`([^`\n]+)`/g, take: (m, marks) => ({ lead: 0, nodes: () => text(unescape(m[1]!), [...marks, { type: 'code' }]) }) },
  ...PAIRS.map((p) => {
    const e = p.char === '*' ? '\\*' : p.char
    return {
      re: new RegExp(`(^|[\\s(\\[{"'])${e}([^${e}\\n]+?)${e}(?=$|[\\s.,!?;:)\\]}"'])`, 'g'),
      take: (m: RegExpExecArray, marks: Mark[], depth: number): Took =>
        depth < 3 && !/^\s|\s$/.test(m[2]!) ? { lead: m[1]!.length, nodes: () => inline(m[2]!, [...marks, p.mark], depth + 1) } : null,
    }
  }),
]

function inline(line: string, marks: Mark[] = [], depth = 0): Text[] {
  const out: Text[] = []
  /* Made once, shared: every look sets where it starts before it looks. */
  const res = PATTERNS.map((p) => p.re)
  /* Each pattern's next match from where the walk stands: undefined for not
     looked yet, null for none left in the line. */
  const next: (RegExpExecArray | null | undefined)[] = PATTERNS.map(() => undefined)
  const seek = (i: number, from: number) => {
    res[i]!.lastIndex = from
    next[i] = res[i]!.exec(line)
  }
  let pos = 0
  while (pos < line.length) {
    let best: { at: number; end: number; nodes: () => Text[] } | null = null
    for (let i = 0; i < PATTERNS.length; i++) {
      if (next[i] === undefined || (next[i] && next[i]!.index < pos)) seek(i, pos)
      while (next[i]) {
        const m = next[i]!
        const took = PATTERNS[i]!.take(m, marks, depth)
        if (took) {
          const at = m.index + took.lead
          if (!best || at < best.at) best = { at, end: m.index + m[0].length, nodes: took.nodes }
          break
        }
        /* A match this depth does not take: look past it. */
        seek(i, m.index + 1)
      }
    }
    if (!best) {
      out.push(...text(unescape(line.slice(pos)), marks))
      break
    }
    out.push(...text(unescape(line.slice(pos, best.at)), marks))
    out.push(...best.nodes())
    pos = best.end
  }
  return out
}

const para = (content: Text[]): Block => {
  spend()
  return content.length ? { type: 'paragraph', content } : { type: 'paragraph' }
}

/** A body of mrkdwn: code blocks, quoted lines, and a paragraph a line. */
export function mrkdwn(source: string, out: Block[] = []): Block[] {
  const parts = source.split('```')
  parts.forEach((part, i) => {
    if (i % 2 === 1 && i < parts.length - 1) {
      const code = unescape(part.replace(/^\n/, '').replace(/\n$/, ''))
      spend(2)
      out.push(code ? { type: 'codeBlock', content: [{ type: 'text', text: code }] } : { type: 'codeBlock' })
      return
    }
    /* An unclosed fence is words. */
    const words = i % 2 === 1 ? `\`\`\`${part}` : part
    let quoted: Block[] = []
    const flush = () => {
      if (quoted.length) out.push({ type: 'blockquote', content: quoted })
      quoted = []
    }
    const lines = words.split('\n')
    lines.forEach((line, n) => {
      /* The empty ends a fence leaves are not lines anybody wrote. */
      if (line === '' && ((n === 0 && i > 0) || (n === lines.length - 1 && i < parts.length - 1))) return
      const q = /^(?:&gt;|>)\s?(.*)$/.exec(line)
      if (q) {
        quoted.push(para(inline(q[1]!)))
        return
      }
      flush()
      out.push(para(inline(line)))
    })
    flush()
  })
  return out
}

/** A Slack text object: plain is literal, mrkdwn is parsed. */
function textObject(v: unknown): Block[] {
  const t = obj(v)
  const words = t && str(t.text)
  if (!t || words === null) return []
  return t.type === 'plain_text' ? words.split('\n').map((l) => para(text(cut(l), []))) : mrkdwn(cut(words))
}

function plainOf(v: unknown): string {
  const t = obj(v)
  return t ? (str(t.text) ?? '') : ''
}

/** A button is a link when it has an address; otherwise it does something in Slack, which is not here. */
function button(v: unknown): Text[] {
  const b = obj(v)
  if (!b || b.type !== 'button') return []
  const label = cut(plainOf(b.text), 200)
  return safeHref(b.url) ? linkOr(label || String(b.url), b.url) : []
}

function imageLink(url: unknown, alt: unknown, title?: unknown): Text[] {
  const words = cut(plainOf(title) || (str(alt) ?? '') || 'Image', 200)
  return linkOr(words, url)
}

/* The pieces of a rich_text section. */
function richInline(elements: unknown): Text[] {
  if (!Array.isArray(elements)) return []
  const out: Text[] = []
  for (const raw of elements.slice(0, MAX_ITEMS * 4)) {
    const e = obj(raw)
    if (!e) continue
    const style = obj(e.style) ?? {}
    const marks: Mark[] = [
      ...(style.bold === true ? [{ type: 'bold' } as Mark] : []),
      ...(style.italic === true ? [{ type: 'italic' } as Mark] : []),
      ...(style.strike === true ? [{ type: 'strike' } as Mark] : []),
      ...(style.code === true ? [{ type: 'code' } as Mark] : []),
    ]
    if (e.type === 'text') out.push(...text(cut(str(e.text) ?? ''), marks))
    else if (e.type === 'link') out.push(...linkOr(cut(str(e.text) ?? '', 500), e.url, marks))
    else if (e.type === 'emoji') {
      const hex = str(e.unicode)
      const fromHex =
        hex && /^[0-9a-f]{2,6}(-[0-9a-f]{2,6}){0,7}$/i.test(hex)
          ? (() => {
              try {
                return String.fromCodePoint(...hex.split('-').map((h) => Number.parseInt(h, 16)))
              } catch {
                return null
              }
            })()
          : null
      out.push(...text(fromHex ?? `:${cut(str(e.name) ?? '', 60)}:`, marks))
    } else if (e.type === 'user') out.push(...text(`@${cut(str(e.user_id) ?? '', 40)}`, marks))
    else if (e.type === 'channel') out.push(...text(`#${cut(str(e.channel_id) ?? '', 40)}`, marks))
    else if (e.type === 'usergroup') out.push(...text('@group', marks))
    else if (e.type === 'broadcast') out.push(...text(`@${cut(str(e.range) ?? 'here', 20)}`, marks))
    else if (e.type === 'date') out.push(...text(cut(str(e.fallback) ?? '', 200), marks))
  }
  return out
}

function richText(v: Record<string, unknown>): Block[] {
  const out: Block[] = []
  if (!Array.isArray(v.elements)) return out
  for (const raw of v.elements.slice(0, MAX_ITEMS)) {
    const e = obj(raw)
    if (!e) continue
    if (e.type === 'rich_text_section') out.push(para(richInline(e.elements)))
    else if (e.type === 'rich_text_preformatted') {
      const code = richInline(e.elements)
        .map((t) => t.text)
        .join('')
      out.push(code ? { type: 'codeBlock', content: [{ type: 'text', text: code }] } : { type: 'codeBlock' })
    } else if (e.type === 'rich_text_quote') out.push({ type: 'blockquote', content: [para(richInline(e.elements))] })
    else if (e.type === 'rich_text_list' && Array.isArray(e.elements)) {
      const items = e.elements
        .slice(0, MAX_ITEMS)
        .map((s) => obj(s))
        .filter((s): s is Record<string, unknown> => Boolean(s))
        .map((s) => ({ type: 'listItem' as const, content: [para(richInline(s.elements))] }))
      if (items.length) out.push({ type: e.style === 'ordered' ? 'orderedList' : 'bulletList', content: items })
    }
  }
  return out
}

/** One block of Block Kit, or nothing for a kind that draws nothing here. */
function block(v: Record<string, unknown>): Block[] {
  switch (v.type) {
    case 'section': {
      const out = textObject(v.text)
      if (Array.isArray(v.fields)) for (const f of v.fields.slice(0, 10)) out.push(...textObject(f))
      const acc = obj(v.accessory)
      if (acc?.type === 'button') {
        const b = button(acc)
        if (b.length) out.push(para(b))
      } else if (acc?.type === 'image') {
        const l = imageLink(acc.image_url, acc.alt_text)
        if (l.length) out.push(para(l))
      }
      return out
    }
    case 'header':
      return [para(text(cut(plainOf(v.text), 150), [{ type: 'bold' }]))]
    case 'context': {
      if (!Array.isArray(v.elements)) return []
      const pieces: Text[] = []
      for (const raw of v.elements.slice(0, 10)) {
        const e = obj(raw)
        if (!e) continue
        const t = e.type === 'image' ? [] : e.type === 'plain_text' ? text(cut(str(e.text) ?? ''), []) : inline(cut(str(e.text) ?? ''))
        if (t.length && pieces.length) pieces.push({ type: 'text', text: '  ·  ' })
        pieces.push(...t)
      }
      return pieces.length ? [para(pieces)] : []
    }
    case 'divider':
      return [para([])]
    case 'actions': {
      if (!Array.isArray(v.elements)) return []
      const links: Text[] = []
      for (const raw of v.elements.slice(0, 25)) {
        const b = button(raw)
        if (b.length && links.length) links.push({ type: 'text', text: '  ·  ' })
        links.push(...b)
      }
      return links.length ? [para(links)] : []
    }
    case 'image': {
      const l = imageLink(v.image_url, v.alt_text, v.title)
      return l.length ? [para(l)] : []
    }
    case 'rich_text':
      return richText(v)
    default:
      return []
  }
}

/** An attachment of the old shape: its pretext, then a quote of the rest. */
function attachment(v: Record<string, unknown>): Block[] {
  const out: Block[] = []
  const pretext = str(v.pretext)
  if (pretext) out.push(...mrkdwn(cut(pretext)))
  const inside: Block[] = []
  const title = str(v.title)
  if (title) inside.push(para(linkOr(cut(title, 300), v.title_link, [{ type: 'bold' }])))
  const words = str(v.text)
  if (words) inside.push(...mrkdwn(cut(words)))
  if (Array.isArray(v.fields)) {
    for (const raw of v.fields.slice(0, 20)) {
      const f = obj(raw)
      if (!f) continue
      const name = str(f.title) ?? ''
      const value = str(f.value) ?? ''
      if (!name && !value) continue
      inside.push(para([...text(cut(name, 300), [{ type: 'bold' }]), ...(name && value ? text(': ', []) : []), ...inline(cut(value))]))
    }
  }
  if (Array.isArray(v.blocks)) for (const b of v.blocks.slice(0, MAX_BLOCKS)) inside.push(...(obj(b) ? block(obj(b)!) : []))
  if (str(v.image_url)) {
    const l = imageLink(v.image_url, v.fallback)
    if (l.length) inside.push(para(l))
  }
  if (Array.isArray(v.actions)) {
    const links: Text[] = []
    for (const raw of v.actions.slice(0, 25)) {
      const a = obj(raw)
      if (!a || !safeHref(a.url)) continue
      if (links.length) links.push({ type: 'text', text: '  ·  ' })
      links.push(...linkOr(cut(str(a.text) ?? String(a.url), 200), a.url))
    }
    if (links.length) inside.push(para(links))
  }
  const footer = str(v.footer)
  if (footer) inside.push(para(inline(cut(footer, 300))))
  /* Nothing but the fallback: the fallback, so the attachment says something. */
  if (!inside.length && !out.length && str(v.fallback)) inside.push(para(text(cut(str(v.fallback)!), [])))
  if (inside.length) out.push({ type: 'blockquote', content: inside })
  return out
}

/** How many nodes a block holds, to keep a document from growing without end. */
function count(b: Block): number {
  if (b.type === 'blockquote') return 1 + b.content.reduce((n, c) => n + count(c), 0)
  if (b.type === 'bulletList' || b.type === 'orderedList')
    return 1 + b.content.reduce((n, li) => n + 1 + li.content.reduce((m, c) => m + count(c), 0), 0)
  return 1 + (b.content?.length ?? 0)
}

/** Whether anything in it would be drawn as words. */
function says(blocks: Block[]): boolean {
  return blocks.some((b) =>
    b.type === 'blockquote'
      ? says(b.content)
      : b.type === 'bulletList' || b.type === 'orderedList'
        ? b.content.some((li) => says(li.content))
        : ((b.content ?? []) as Text[]).some((t) => t.text.trim()),
  )
}

/**
 * The payload, made into a document — or the refusal Slack would give.
 * `text` is Slack's fallback when there are blocks, as in Slack, and drawn
 * only when there are none.
 */
export function fromSlack(payload: unknown): { doc: SlackDoc } | { refused: Refusal } {
  const p = obj(payload)
  if (!p) return { refused: 'invalid_payload' }
  if (p.text !== undefined && p.text !== null && typeof p.text !== 'string') return { refused: 'invalid_payload' }
  if (p.blocks !== undefined && p.blocks !== null && !Array.isArray(p.blocks)) return { refused: 'invalid_blocks' }
  if (p.attachments !== undefined && p.attachments !== null && !Array.isArray(p.attachments)) return { refused: 'invalid_payload' }
  const words = str(p.text) ?? ''
  const blocks = Array.isArray(p.blocks) ? p.blocks : []
  const attachments = Array.isArray(p.attachments) ? p.attachments : []
  if (words.length > MAX_TEXT) return { refused: 'msg_too_long' }
  if (blocks.length > MAX_BLOCKS) return { refused: 'invalid_blocks' }
  if (blocks.some((b) => !obj(b) || typeof obj(b)!.type !== 'string')) return { refused: 'invalid_blocks' }
  if (attachments.length > MAX_ATTACHMENTS) return { refused: 'too_many_attachments' }

  const content: Block[] = []
  budget = MAX_NODES
  try {
    if (blocks.length) for (const b of blocks) content.push(...block(obj(b)!))
    /* Into the document as it goes, so what was read before it was full is kept. */ else if (words) mrkdwn(words, content)
    for (const a of attachments) {
      const at = obj(a)
      if (at) content.push(...attachment(at))
    }
  } catch (e) {
    /* Enough: what was finished is kept, and nothing more is read. */
    if (e !== FULL) throw e
  } finally {
    budget = Number.POSITIVE_INFINITY
  }
  /* Bounded, whatever the input was shaped to grow into. */
  const kept: Block[] = []
  let n = 0
  for (const b of content) {
    n += count(b)
    if (n > MAX_NODES) break
    kept.push(b)
  }
  /* No blank lines at the head or the foot. */
  const empty = (b: Block | undefined) => b?.type === 'paragraph' && !(b.content ?? []).length
  while (empty(kept[0])) kept.shift()
  while (empty(kept[kept.length - 1])) kept.pop()
  if (!kept.length || !says(kept)) return { refused: 'no_text' }
  return { doc: { type: 'doc', content: kept } }
}
