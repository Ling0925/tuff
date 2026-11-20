import { api } from './api.js'

/**
 * GIFs, from KLIPY — `docs/specs/gifs.md`.
 *
 * Asked of KLIPY by the browser and drawn from KLIPY's own addresses, which
 * is what its terms require: no request through our server, no copy of the
 * picture kept. The deployment's key comes from the server, so a deployment
 * without one has no GIF button rather than a broken one.
 */

export type Gif = {
  slug: string
  title: string
  /** What the message carries and draws: KLIPY's own address. */
  url: string
  width: number
  height: number
  /** A smaller copy for the picker's grid. */
  thumb: string
  thumbWidth: number
  thumbHeight: number
}

/** Only KLIPY's own addresses are drawn — a message is not a way to make
    somebody's browser fetch anything else. The server refuses others too. */
export const isKlipy = (url: unknown): url is string => typeof url === 'string' && /^https:\/\/static\d*\.klipy\.com\//.test(url)

let key: Promise<string | null> | null = null
export function gifKey(): Promise<string | null> {
  key ??= api<{ key: string | null }>('/gifs/key')
    .then((r) => r.key)
    .catch(() => {
      key = null
      return null
    })
  return key
}

/* Who is asking, as KLIPY sees it: a random id for this browser, not the
   account — it tunes what is offered and says nothing about who we are. */
function customer(): string {
  try {
    const had = localStorage.getItem('gif-customer')
    if (had) return had
    const made = crypto.randomUUID()
    localStorage.setItem('gif-customer', made)
    return made
  } catch {
    return 'anonymous'
  }
}

type Format = { url: string; width: number; height: number }
type Item = {
  slug: string
  title?: string
  file?: Record<string, Record<string, Format | undefined> | undefined>
}

function shaped(it: Item): Gif | null {
  const md = it.file?.md?.webp ?? it.file?.md?.gif
  const sm = it.file?.sm?.webp ?? it.file?.sm?.gif ?? md
  if (!md || !sm || !isKlipy(md.url) || !isKlipy(sm.url)) return null
  return {
    slug: it.slug,
    title: it.title ?? '',
    url: md.url,
    width: md.width,
    height: md.height,
    thumb: sm.url,
    thumbWidth: sm.width,
    thumbHeight: sm.height,
  }
}

/** Trending with no words, a search with them — a page at a time, in
    KLIPY's order. */
export async function findGifs(q: string, page: number): Promise<{ gifs: Gif[]; more: boolean }> {
  const k = await gifKey()
  if (!k) return { gifs: [], more: false }
  const words = q.trim()
  const params = new URLSearchParams({
    page: String(page),
    per_page: '24',
    customer_id: customer(),
    content_filter: 'medium',
    format_filter: 'webp,gif',
  })
  if (words) params.set('q', words)
  const r = await fetch(`https://api.klipy.com/api/v1/${encodeURIComponent(k)}/gifs/${words ? 'search' : 'trending'}?${params}`)
  if (!r.ok) throw new Error(`KLIPY ${r.status}`)
  const body = (await r.json()) as { data?: { data?: Item[]; has_next?: boolean } }
  return {
    gifs: (body.data?.data ?? []).map(shaped).filter((g): g is Gif => g !== null),
    more: Boolean(body.data?.has_next),
  }
}

/** Told when one is sent, as KLIPY asks — what was searched for, if
    anything. Nothing waits on it. */
export function sharedGif(slug: string, q: string): void {
  void gifKey().then((k) => {
    if (!k) return
    void fetch(`https://api.klipy.com/api/v1/${encodeURIComponent(k)}/gifs/share/${encodeURIComponent(slug)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ customer_id: customer(), q: q.trim() }),
    }).catch(() => {})
  })
}
