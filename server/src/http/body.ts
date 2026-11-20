import { z } from 'zod'
import { cleanLine } from '@tracker/shared-schema'

/*
 * A body as a request sends it — a post's, a task's, a document's, a
 * message's, a comment's.
 *
 * ProseMirror JSON, kept as it came except for what the contract promises
 * is clean: a task chip's `line`, read
 * through `cleanLine` on the way in, so a `javascript:` address written by
 * hand into one is never stored and never handed to a native app that was
 * told the server keeps only what it cleaned. The shared state cleans it
 * too, each way (`yjson.ts`); this is every other road in.
 */

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** The body with every chip's `line` cleaned, or taken out where nothing of it may stay. */
export function cleanChips<T>(body: T): T {
  const walk = (n: unknown, depth: number): unknown => {
    if (!isObject(n) || depth > 200) return n
    let out: Record<string, unknown> = n
    if (n.type === 'taskref' && isObject(n.attrs) && 'line' in n.attrs) {
      const attrs = { ...n.attrs }
      const line = cleanLine(attrs.line)
      if (line) attrs.line = line
      else delete attrs.line
      out = { ...n, attrs }
    }
    if (Array.isArray(n.content)) out = { ...out, content: n.content.map((k) => walk(k, depth + 1)) }
    return out
  }
  return walk(body, 0) as T
}

/** A body in a request, its chips cleaned. */
export const RichBody = z.record(z.string(), z.unknown()).transform((b) => cleanChips(b))

/*
 * How much one body may weigh, as the request carries it,
 * finding 5.
 *
 * Nothing but the 5 MB a request may carry bounded a stored body, and the
 * screens that read many bodies at once send them whole: four hundred
 * comments of five megabytes on one task, and `GET /api/tasks/:id` built a
 * two-gigabyte answer and took the process with it. What was measured
 * (the `ours` workspace, November 2026): the longest comment 0.7 KB, message
 * 8 KB, task 4 KB, announcement 2 KB, document 5 KB. The ceilings are a
 * long way past any of it: a comment or a message is something said, and
 * 128 KB of it is some fifty thousand words of plain text; a description
 * or an announcement is a page, and 1 MB is a short book; a document is
 * already held to 5 MB by its shared state (`STATE_MOST`).
 */
export const BODY_MOST = {
  /** A comment, a message, a reply. */
  said: 128 * 1024,
  /** A task's description, a step's, an announcement. */
  page: 1024 * 1024,
} as const

/** What a refused one is told, in English; `words.ts` has the French. */
export const TOO_LONG_TO_SEND = 'This is too long to send. Make it shorter or split it up.'
export const TOO_LONG_TO_SAVE = 'This is too long to save. Make it shorter or move part of it into a document.'
