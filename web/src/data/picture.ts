/**
 * A picture made fit to be a mark — a project's, a workspace's, a face —
 * before it is sent.
 *
 * The server takes PNG, JPEG, GIF and WebP up to two megabytes, and a mark
 * is drawn at eighteen pixels. What failed was everything else, without a
 * word: an SVG was stored and then could not be drawn, a photo off a phone
 * was over the limit or in HEIC, and the button did nothing either way.
 *
 * So, here, before anything is sent:
 * - an SVG is drawn onto a canvas and sent as a PNG;
 * - anything larger than a mark needs is scaled down to 512 pixels on its
 *   long side — a photograph of an office is not refused, it is made small;
 * - a GIF is sent as it is, so it keeps moving, if it is under the limit;
 * - what a browser cannot draw (HEIC, TIFF) is refused with a sentence.
 */
import { PICTURE as W } from '../words/picture.js'

export const PICTURE_LIMIT = 2 * 1024 * 1024
const DRAWN = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
const SIDE = 512

export async function pictureFor(f: File): Promise<File | { refused: string }> {
  const svg = f.type === 'image/svg+xml' || /\.svg$/i.test(f.name)
  if (!svg && !DRAWN.includes(f.type)) {
    return { refused: W.cantShow }
  }
  if (f.type === 'image/gif') {
    return f.size <= PICTURE_LIMIT ? f : { refused: W.gifTooBig }
  }
  if (!svg && f.size <= PICTURE_LIMIT) {
    /* Small enough already; scaled only when it is much larger than a mark. */
    const size = await sizeOf(f).catch(() => null)
    if (!size || Math.max(size.w, size.h) <= SIDE * 2) return f
  }
  const drawn = await redraw(f).catch(() => null)
  return drawn ?? { refused: W.cantRead }
}

async function sizeOf(f: File): Promise<{ w: number; h: number }> {
  const img = await load(f)
  return { w: img.naturalWidth, h: img.naturalHeight }
}

function load(f: File): Promise<HTMLImageElement> {
  return new Promise((done, fail) => {
    const url = URL.createObjectURL(f)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      done(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      fail(new Error('unreadable'))
    }
    img.src = url
  })
}

/** Drawn again at no more than 512 on its long side, as a PNG. An SVG with
    no size of its own is drawn square. */
async function redraw(f: File): Promise<File> {
  const img = await load(f)
  const w = img.naturalWidth || SIDE
  const h = img.naturalHeight || SIDE
  const scale = Math.min(1, SIDE / Math.max(w, h)) || 1
  const fit = { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) }
  /* An SVG is drawn at the full side, not its own few dozen pixels. */
  if (f.type === 'image/svg+xml' || /\.svg$/i.test(f.name)) {
    const up = SIDE / Math.max(w, h)
    fit.w = Math.max(1, Math.round(w * up))
    fit.h = Math.max(1, Math.round(h * up))
  }
  const canvas = document.createElement('canvas')
  canvas.width = fit.w
  canvas.height = fit.h
  canvas.getContext('2d')!.drawImage(img, 0, 0, fit.w, fit.h)
  const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, 'image/png'))
  if (!blob) throw new Error('unreadable')
  return new File([blob], f.name.replace(/\.[^.]+$/, '') + '.png', { type: 'image/png' })
}
