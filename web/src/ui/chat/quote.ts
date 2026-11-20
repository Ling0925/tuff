import { format } from '../../data/route.js'
import { CHAT as W } from '../../words/chat.js'
import { type Message } from './lines.jsx'

/*
 * A message as a quote in the line — `docs/specs/chat-composer.md`,
 * "Quoting a message". Who said it and a link back to it, then its words:
 * a file, a GIF, a link's card and an earlier quote stay behind, and a
 * mention is written out, so the quote calls nobody in.
 */

type Node = { type?: string; text?: string; attrs?: Record<string, unknown>; marks?: unknown[]; content?: Node[] }

/** The words of a node, with mentions as words and the things that are not words left out. */
function words(n: Node): Node | null {
  if (n.type === 'mention') return { type: 'text', text: `@${String(n.attrs?.label ?? '')}` }
  if (n.type === 'attachment' || n.type === 'gif' || n.type === 'preview' || n.type === 'blockquote') return null
  if (!n.content) return n
  const content = n.content.map(words).filter((c): c is Node => c !== null)
  return { ...n, content }
}

const SAID = new Set(['paragraph', 'bulletList', 'orderedList', 'codeBlock'])

export function quoteOf(m: Message, roomId: string): unknown[] {
  const at = format({ view: 'chat', roomId, messageId: m.id, ...(m.parent_id ? { threadId: m.parent_id } : {}) })
  const body = ((m.body as { content?: Node[] } | null)?.content ?? []).filter((n) => SAID.has(n.type ?? ''))
  const said = body.map(words).filter((n): n is Node => n !== null && !(n.type === 'paragraph' && !(n.content ?? []).length))
  return [
    {
      type: 'blockquote',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: m.author_name || W.someone, marks: [{ type: 'bold' }] },
            { type: 'text', text: ' · ' },
            { type: 'text', text: W.viewMessage, marks: [{ type: 'link', attrs: { href: `${location.origin}${at}` } }] },
          ],
        },
        ...said,
      ],
    },
    { type: 'paragraph' },
  ]
}
