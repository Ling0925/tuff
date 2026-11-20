import { api } from './api.js'

/**
 * A file's link, asked for once and kept while it is good.
 *
 * Every picture in a body asked the server for its link each time it was
 * drawn — and an editor draws its nodes again when the body arrives, so a
 * task with four pictures opened with eight round trips before the first
 * byte of any of them. Kept here by file id, with the request in flight
 * shared, so the second draw and every other place the same file appears
 * (the editor, a comment, the lightbox) take the link that is already in
 * hand. The server signs links on the hour, so a link kept is also the link
 * the browser's cache knows the bytes by.
 */
/** A file's links: the original, and the copy to draw when it has one. */
export type Links = { url: string; display: string | null }

const kept = new Map<string, { links: Promise<Links>; until: number; now?: Links }>()
/** Sizes as the server knows them, for files whose body did not record one. */
const sizes = new Map<string, number>()

export function sizeOf(id: string | null): number | null {
  return id ? (sizes.get(id) ?? null) : null
}

/** The links if they are already in hand, so a picture drawn again starts
    with its bytes rather than with a grey box for a frame. */
export function knownLinks(id: string): Links | null {
  const hit = kept.get(id)
  return hit && hit.until > Date.now() ? (hit.now ?? null) : null
}
export function knownUrl(id: string): string | null {
  return knownLinks(id)?.url ?? null
}

/**
 * The original's link and, for a picture that has one, its copy for showing
 * — drawn in a body, while the original is opened full size and saved.
 */
/**
 * Links handed over with what names them, rather than asked for one by one:
 * a document shared to the web arrives with its pictures' links, and a
 * reader there has no session to ask with.
 */
export function seedLinks(links: Record<string, { url: string; display_url: string | null }>, seconds = 3600): void {
  const until = Date.now() + Math.max(60, seconds - 60) * 1000
  for (const [id, l] of Object.entries(links)) {
    const now = { url: l.url, display: l.display_url }
    kept.set(id, { links: Promise.resolve(now), until, now })
  }
}

export function fileLinks(id: string): Promise<Links> {
  /* An id out of a body is what somebody wrote — only a uuid becomes part
     of an address. */
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return Promise.reject(new Error('not a file'))
  }
  const now = Date.now()
  const hit = kept.get(id)
  if (hit && hit.until > now) return hit.links
  const links = api<{ url: string; display_url?: string | null; expires_in?: number; size?: number | null }>(`/files/${id}/url`).then(
    (r) => {
      if (typeof r.size === 'number') sizes.set(id, r.size)
      const got = { url: r.url, display: r.display_url ?? null }
      /* Given back a minute early, so a link is never handed out in the
       last seconds it works. */
      const entry = kept.get(id)
      if (entry) {
        entry.until = Date.now() + Math.max(60, (r.expires_in ?? 300) - 60) * 1000
        entry.now = got
      }
      return got
    },
  )
  kept.set(id, { links, until: now + 60_000 })
  // A failure is not kept: the next draw asks again.
  links.catch(() => kept.delete(id))
  return links
}

export function fileUrl(id: string): Promise<string> {
  return fileLinks(id).then((l) => l.url)
}

/**
 * Links that arrived with something else — a task's read carries the links
 * for every file in its body and its comments, and the copies to draw for
 * the pictures that have them — kept as if each had been asked for, so no
 * picture on that screen asks again.
 */
export function primeUrls(
  links: Record<string, string> | undefined,
  known?: Record<string, number>,
  displays?: Record<string, string>,
  seconds = 3600,
): void {
  for (const [id, n] of Object.entries(known ?? {})) sizes.set(id, n)
  if (!links) return
  const until = Date.now() + Math.max(60, seconds - 60) * 1000
  for (const [id, url] of Object.entries(links)) {
    const now = { url, display: displays?.[id] ?? null }
    kept.set(id, { links: Promise.resolve(now), until, now })
  }
}

/** The bytes of these pictures, asked for now, so a screen about to open
    finds them in the browser's cache. */
export function warmPictures(urls: string[]): void {
  for (const u of urls) {
    const img = new Image()
    img.decoding = 'async'
    img.src = u
  }
}
