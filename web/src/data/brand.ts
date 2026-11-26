import type { Brand } from '@tracker/shared-schema'
import { glyphMarkup, type IconName } from '../ui/glyphs.jsx'
import { faviconWorn } from './favicon.js'
import { setOwnName } from './title.js'

/**
 * A branded workspace's name and mark, worn by the window while it is open.
 *
 * The tab's icon becomes the workspace's mark, drawn here as Tuff draws it
 * everywhere else (its picture, or its glyph or letter on its colour), and a
 * window with no place to name is titled with the workspace's name. Null
 * puts Tuff's back. The server decides whether there is a brand; this only
 * wears what it was handed.
 *
 * The last one worn is kept on this device beside the workspace it was for,
 * and worn again at the next start in that workspace before `/api/me` has
 * answered (`wearKept`) — otherwise every load would show Tuff's icon and
 * then the agency's, which is the jerk the project's handbook asks not to ship.
 */
const KEY = 'tracker.brand'
const SIZE = 64
/* The mark's corner at the size a tab draws it, sixteen pixels, scaled to
   the canvas: `markRadius(16)` is six. */
const RADIUS = (SIZE * 6) / 16

type Kept = { ws: string; name: string; look: string; href: string | null }

/** What a brand looks like, without the signature on its picture's link, which changes every read. */
function lookOf(b: Brand): string {
  return JSON.stringify([b.icon_url?.split('?')[0] ?? null, b.mark_icon, b.mark_tint, b.name.trim()[0]?.toUpperCase() ?? ''])
}

function readKept(): Kept | null {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Kept) : null
  } catch {
    return null
  }
}

function keep(k: Kept | null): void {
  try {
    if (k) localStorage.setItem(KEY, JSON.stringify(k))
    else localStorage.removeItem(KEY)
  } catch {
    // Not kept: the next start shows Tuff's icon until the server answers.
  }
}

function load(src: string, crossOrigin: boolean): Promise<HTMLImageElement> {
  return new Promise((done, fail) => {
    const img = new Image()
    if (crossOrigin) img.crossOrigin = 'anonymous'
    img.onload = () => done(img)
    img.onerror = () => fail(new Error('image'))
    img.src = src
  })
}

function roundedSquare(g: CanvasRenderingContext2D): void {
  g.beginPath()
  g.roundRect(0, 0, SIZE, SIZE, RADIUS)
  g.closePath()
}

/** The mark as an image's address — a PNG drawn here, or the picture's own link when it cannot be read back. */
async function drawn(b: Brand): Promise<string | null> {
  const c = document.createElement('canvas')
  c.width = SIZE
  c.height = SIZE
  const g = c.getContext('2d')
  if (!g) return b.icon_url
  if (b.icon_url) {
    try {
      const img = await load(b.icon_url, true)
      roundedSquare(g)
      g.clip()
      /* Covered, as the mark's `object-cover` is. */
      const scale = Math.max(SIZE / img.naturalWidth, SIZE / img.naturalHeight)
      const w = img.naturalWidth * scale
      const h = img.naturalHeight * scale
      g.drawImage(img, (SIZE - w) / 2, (SIZE - h) / 2, w, h)
      return c.toDataURL('image/png')
    } catch {
      /* Another origin that will not be read back, or a picture gone: its
         own link while it lasts, as the switcher would draw it. */
      return b.icon_url
    }
  }
  const tint = getComputedStyle(document.documentElement).getPropertyValue(`--face-${b.mark_tint}`).trim() || '#747479'
  roundedSquare(g)
  g.fillStyle = tint
  g.fill()
  if (b.mark_icon) {
    try {
      const markup = glyphMarkup(b.mark_icon as IconName, Math.round(SIZE * 0.6)).replace(
        '<svg ',
        '<svg xmlns="http://www.w3.org/2000/svg" style="color:#ffffff" ',
      )
      const img = await load(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`, false)
      g.drawImage(img, (SIZE - img.width) / 2, (SIZE - img.height) / 2)
      return c.toDataURL('image/png')
    } catch {
      // A glyph this build does not know: the letter, as the mark falls back.
    }
  }
  g.fillStyle = '#ffffff'
  g.font = `600 ${Math.round(SIZE * 0.56)}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText((b.name.trim()[0] ?? '?').toUpperCase(), SIZE / 2, SIZE / 2 + 2)
  return c.toDataURL('image/png')
}

let asked = 0

/**
 * Wear a workspace's brand, or null for Tuff's. `ws` is the workspace it is
 * for, and the brand is kept for the next start in it; without one — a
 * public page — nothing is kept, and only the icon changes.
 */
export function wearBrand(b: Brand | null, ws?: string): void {
  const turn = ++asked
  if (ws !== undefined) setOwnName(b?.name ?? null)
  if (!b) {
    faviconWorn(null)
    if (ws !== undefined) keep(null)
    return
  }
  const kept = readKept()
  const look = lookOf(b)
  /* The same mark as last time: what was drawn then, at once. */
  if (kept?.href && kept.look === look) {
    faviconWorn(kept.href)
    if (ws !== undefined && (kept.ws !== ws || kept.name !== b.name)) keep({ ...kept, ws, name: b.name })
    return
  }
  void drawn(b).then((href) => {
    if (turn !== asked) return
    faviconWorn(href)
    /* A picture's own link expires within the hour: only a drawing is kept. */
    if (ws !== undefined) keep({ ws, name: b.name, look, href: href?.startsWith('data:') ? href : null })
  })
}

/** The brand last worn in this workspace, worn again before the server has answered. */
export function wearKept(ws: string | null | undefined): void {
  const kept = readKept()
  if (!ws || !kept || kept.ws !== ws) return
  setOwnName(kept.name)
  if (kept.href) faviconWorn(kept.href)
}
