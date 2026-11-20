/**
 * Jira's and Asana's rich text, as Markdown.
 *
 * Each is written out as Markdown and read by the one parser of outside
 * text (`mcp/markdown.ts`), rather than turned into the editor's document
 * here: one reader decides what a link may point at and what a file is, not
 * three. Both walks are a single pass with a budget — this is somebody
 * else's text, and nothing in it may cost more than its length.
 */

/* `encodeURIComponent` leaves brackets as they are, and a `)` ends a Markdown link. */
const escapeHref = (href: string) => href.replace(/[()\s]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`)
const safe = (href: unknown): href is string => typeof href === 'string' && href.length <= 2000 && /^(https?:|mailto:)/i.test(href)

type Adf = {
  type?: unknown
  text?: unknown
  attrs?: Record<string, unknown>
  marks?: { type?: unknown; attrs?: Record<string, unknown> }[]
  content?: unknown
}

/**
 * Atlassian's document JSON — Jira's descriptions and comments — as
 * Markdown. What it carries that has no place here (a panel's colour, a
 * layout's columns) gives up its words and keeps them; pictures are left
 * out, since an issue's attachments come as files of their own.
 */
export function adfToMarkdown(doc: unknown): string {
  let budget = 100_000
  const kids = (n: Adf): Adf[] => (Array.isArray(n.content) ? (n.content as Adf[]) : [])

  const inline = (nodes: Adf[], depth: number): string => {
    let out = ''
    for (const n of nodes) {
      if (--budget < 0 || depth > 40 || !n || typeof n !== 'object') break
      switch (n.type) {
        case 'text': {
          let t = typeof n.text === 'string' ? n.text.replace(/\n/g, ' ') : ''
          if (!t) break
          let href: string | null = null
          for (const m of Array.isArray(n.marks) ? n.marks.slice(0, 10) : []) {
            if (m?.type === 'code') t = `\`${t.replace(/`/g, '')}\``
            else if (m?.type === 'strong') t = `**${t}**`
            else if (m?.type === 'em') t = `*${t}*`
            else if (m?.type === 'strike') t = `~~${t}~~`
            else if (m?.type === 'link' && safe(m.attrs?.href)) href = m.attrs!.href as string
          }
          out += href ? `[${t.replace(/[[\]]/g, '')}](${escapeHref(href)})` : t
          break
        }
        case 'hardBreak':
          out += '\n'
          break
        case 'mention':
        case 'emoji':
        case 'status': {
          const t = n.attrs?.text ?? n.attrs?.shortName
          if (typeof t === 'string') out += t.slice(0, 200)
          break
        }
        case 'inlineCard': {
          const url = n.attrs?.url
          if (safe(url)) out += url
          break
        }
        case 'date': {
          const ms = Number(n.attrs?.timestamp)
          if (Number.isFinite(ms)) out += new Date(ms).toISOString().slice(0, 10)
          break
        }
        default:
          out += inline(kids(n), depth + 1)
      }
    }
    return out
  }

  /* Written out no longer than the body that keeps it: past the cut, nothing more is built. */
  let size = 0
  const blocks = (nodes: Adf[], depth: number): string[] => {
    const out: string[] = []
    for (const n of nodes) {
      if (--budget < 0 || depth > 40 || size > 400_000 || !n || typeof n !== 'object') break
      switch (n.type) {
        case 'paragraph': {
          const t = inline(kids(n), depth + 1)
          size += t.length
          if (t.trim()) out.push(t)
          break
        }
        case 'heading': {
          const level = Math.min(Math.max(Number(n.attrs?.level) || 1, 1), 6)
          out.push(`${'#'.repeat(level)} ${inline(kids(n), depth + 1)}`)
          break
        }
        case 'bulletList':
        case 'orderedList':
        case 'taskList':
        case 'decisionList': {
          let at = 0
          const lines: string[] = []
          for (const item of kids(n)) {
            at += 1
            const mark = n.type === 'orderedList' ? `${at}.` : '-'
            const inner =
              item?.type === 'taskItem' || item?.type === 'decisionItem' ? [inline(kids(item), depth + 2)] : blocks(kids(item), depth + 2)
            const [first = '', ...rest] = inner.join('\n').split('\n')
            lines.push(`${mark} ${first}`, ...rest.map((l) => `  ${l}`))
          }
          if (lines.length) out.push(lines.join('\n'))
          break
        }
        case 'codeBlock': {
          const t = kids(n)
            .map((c) => (typeof c?.text === 'string' ? c.text : ''))
            .join('')
            .replace(/```/g, "'''")
          out.push(`\`\`\`\n${t}\n\`\`\``)
          break
        }
        case 'blockquote':
          out.push(
            blocks(kids(n), depth + 1)
              .join('\n\n')
              .split('\n')
              .map((l) => `> ${l}`)
              .join('\n'),
          )
          break
        case 'rule':
          out.push('---')
          break
        case 'table': {
          /* Fifty columns and a thousand rows: a row is padded to the
             widest, and one wide row must not widen ten thousand. */
          const rows = kids(n)
            .slice(0, 1000)
            .map((row) =>
              kids(row)
                .slice(0, 50)
                .map((cell) => {
                  budget -= 1
                  return blocks(kids(cell), depth + 3)
                    .join(' ')
                    .replace(/\n/g, ' ')
                    .replace(/\|/g, '/')
                }),
            )
          if (!rows.length) break
          const width = rows.reduce((w, r) => Math.max(w, r.length), 1)
          const line = (r: string[]) => `| ${Array.from({ length: width }, (_, i) => r[i] ?? '').join(' | ')} |`
          out.push([line(rows[0]!), `|${' --- |'.repeat(width)}`, ...rows.slice(1).map(line)].join('\n'))
          size += out[out.length - 1]!.length
          break
        }
        case 'mediaSingle':
        case 'mediaGroup':
        case 'media':
          break
        case 'blockCard':
        case 'embedCard': {
          const url = n.attrs?.url
          if (safe(url)) out.push(url)
          break
        }
        default:
          out.push(...blocks(kids(n), depth + 1))
      }
    }
    return out
  }

  if (!doc || typeof doc !== 'object') return typeof doc === 'string' ? doc : ''
  return blocks(kids(doc as Adf), 0).join('\n\n')
}

const ENTITY: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
const decode = (s: string) =>
  s.replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z]{2,6});/gi, (all, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ''
    }
    return ENTITY[e.toLowerCase()] ?? all
  })

/**
 * Asana's rich notes as Markdown. Asana writes a small set of tags
 * — and these are read; any other tag is
 * dropped and its words kept. No tag is ever taken as HTML.
 */
export function asanaHtmlToMarkdown(html: string): string {
  const text = html.slice(0, 400_000)
  const out: string[] = []
  const lists: ('ul' | 'ol')[] = []
  const counts: number[] = []
  let line = ''
  let pre = false
  let link: string | null = null
  let quote = false

  const end = () => {
    if (line.trim()) out.push(quote ? `> ${line}` : line)
    line = ''
  }
  const words = (s: string) => {
    const t = decode(s)
    if (pre) {
      line += t
      return
    }
    const parts = t.split('\n')
    parts.forEach((p, i) => {
      if (i > 0) end()
      line += p
    })
  }

  let i = 0
  while (i < text.length) {
    const lt = text.indexOf('<', i)
    if (lt === -1) {
      words(text.slice(i))
      break
    }
    if (lt > i) words(text.slice(i, lt))
    const gt = text.indexOf('>', lt)
    if (gt === -1) {
      words(text.slice(lt))
      break
    }
    const tag = text.slice(lt + 1, gt)
    i = gt + 1
    const closing = tag.startsWith('/')
    const name = (closing ? tag.slice(1) : tag).split(/[\s/]/, 1)[0]!.toLowerCase()
    switch (name) {
      case 'strong':
      case 'b':
        line += '**'
        break
      case 'em':
      case 'i':
        line += '*'
        break
      case 's':
      case 'strike':
        line += '~~'
        break
      case 'code':
        if (!pre) line += '`'
        break
      case 'a':
        if (closing) {
          if (link) line += `](${escapeHref(link)})`
          link = null
        } else {
          const href = /href="([^"]{0,2000})"/.exec(tag)?.[1]
          const h = href ? decode(href) : null
          link = safe(h) ? h : null
          if (link) line += '['
        }
        break
      case 'h1':
      case 'h2':
        end()
        if (!closing) line = name === 'h1' ? '# ' : '## '
        break
      case 'ul':
      case 'ol':
        end()
        if (closing) {
          lists.pop()
          counts.pop()
        } else if (lists.length < 10) {
          lists.push(name)
          counts.push(0)
        }
        break
      case 'li':
        end()
        if (!closing && lists.length) {
          const at = lists.length - 1
          counts[at] = (counts[at] ?? 0) + 1
          line = `${'  '.repeat(at)}${lists[at] === 'ol' ? `${counts[at]}.` : '-'} `
        }
        break
      case 'pre':
        end()
        pre = !closing
        out.push('```')
        break
      case 'blockquote':
        end()
        quote = !closing
        break
      case 'hr':
        end()
        out.push('---')
        break
      default:
        break
    }
  }
  end()
  /* Lines of a list or a block of code stay together; anything else is a
     paragraph of its own. */
  const joined: string[] = []
  let inCode = false
  let wasList = false
  for (const l of out) {
    const list = !inCode && /^\s*(-|\d+\.) /.test(l)
    if (joined.length && (inCode || (list && wasList))) joined[joined.length - 1] += `\n${l}`
    else joined.push(l)
    if (l === '```') inCode = !inCode
    wasList = list
  }
  return joined.join('\n\n')
}
