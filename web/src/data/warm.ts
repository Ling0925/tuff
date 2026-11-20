import { api } from './api.js'
import { fileLinks } from './files.js'
import { recall, remember } from './memory.js'

/**
 * Pictures fetched before they are looked at.
 *
 * The glance is for a picture nobody could have expected: one scrolled up
 * to in a room's history. The ones a person is about to see — the newest
 * in a room they are likely to open, one arriving in the room they are in —
 * are fetched in the background, so they open sharp.
 */

type Node = { type?: string; attrs?: { fileId?: unknown; kind?: unknown }; content?: Node[] }

/** The pictures a body carries, by file id. */
export function picturesOf(body: unknown): string[] {
  const out: string[] = []
  const walk = (n: Node | undefined) => {
    if (!n) return
    if (n.type === 'attachment' && n.attrs?.kind === 'image' && typeof n.attrs.fileId === 'string') out.push(n.attrs.fileId)
    n.content?.forEach(walk)
  }
  walk(body as Node)
  return out
}

const warmed = new Set<string>()

/*
 * Pictures held decoded, by address — Docs' thumbnails — `docs/specs/docs.md`.
 *
 * Every visit to Docs drew its pictures afresh: the `<img>` was new, lazy,
 * and the copy behind it is up to 1600 pixels wide, so each one was fetched
 * from the cache and decoded again while the row showed its blank tile —
 * which reads as everything loading every time. An image kept alive here
 * keeps its decoded bitmap, so the row's `<img>` with the same address paints
 * on its first frame.
 *
 * Only the rows a first screen of Docs shows, and only one project's. It
 * held the newest two hundred, read for the whole list whenever a project
 * opened — on a board, before Docs was ever pressed — and never let go
 * when the project changed. A decoded copy is its width times its height
 * times four: a phone's screenshot drawn at 1600 is near five megabytes,
 * and a project of a hundred and fifty of them held three quarters of a
 * gigabyte of pictures nobody was looking at. That is what the tiles'
 * `loading="lazy"` was put there to prevent, and this undid it — the
 * likeliest of what Safari on a phone was ending the tab for.
 */
const HELD_AT_MOST = 12
const held = new Map<string, HTMLImageElement>()
export function holdPictures(urls: readonly (string | null | undefined)[]): void {
  const first = urls.filter((u): u is string => Boolean(u)).slice(0, HELD_AT_MOST)
  /* Another project's, or rows that are no longer at the top: let go, so
     the browser may drop their bitmaps. */
  const wanted = new Set(first)
  for (const src of held.keys()) if (!wanted.has(src)) held.delete(src)
  for (const src of first) {
    if (held.has(src)) continue
    const img = new Image()
    img.decoding = 'async'
    img.src = src
    void img.decode().catch(() => held.delete(src))
    held.set(src, img)
  }
}

/** Each picture's link, then its bytes, decoded — settled when they are in. */
export function warmPictures(fileIds: string[]): Promise<void> {
  return Promise.all(
    fileIds.map(async (id) => {
      const links = await fileLinks(id).catch(() => null)
      const src = links?.display ?? links?.url
      if (!src || warmed.has(src)) return
      warmed.add(src)
      const img = new Image()
      img.decoding = 'async'
      img.src = src
      await img.decode().catch(() => {
        warmed.delete(src)
      })
    }),
  ).then(() => {})
}

/** Within a time limit: a picture slower than that is drawn over its glance. */
export function warmWithin(fileIds: string[], ms: number): Promise<void> {
  if (fileIds.length === 0) return Promise.resolve()
  return Promise.race([warmPictures(fileIds), new Promise<void>((done) => setTimeout(done, ms))])
}

/**
 * A room's newest page, remembered where the room reads it first, and the
 * pictures in its last few messages fetched — so opening it draws what was
 * said, pictures and all, without waiting.
 */
export async function warmRoom(roomId: string): Promise<void> {
  /* And who is in it, beside the page and not after it: the faces in the
     room's head are drawn from this, and with the messages remembered and
     the people not, the room opened on its words and its head grew a row
     of faces a round trip later. Once a room — they change rarely, and
     the room reads them again when it opens. */
  if (recall(`room-members:${roomId}`) === null) {
    void api<{ members: unknown[]; chosen: boolean }>(`/conversations/${roomId}/members`)
      .then((m) => remember(`room-members:${roomId}`, { members: m.members ?? [], chosen: m.chosen }))
      .catch(() => {})
  }
  const r = await api<{ messages: { body: unknown }[] }>(`/conversations/${roomId}/messages`)
  remember(`room-messages:${roomId}`, r.messages)
  const recent = r.messages.slice(-8).flatMap((m) => picturesOf(m.body))
  await warmPictures(recent)
}
