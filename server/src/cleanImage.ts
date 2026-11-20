import { pixelsOf } from './pixels.js'

/**
 * A picture somebody with a board's link sent, made safe to keep and to
 * show.
 *
 * A board is anonymous hosting, so what it takes is narrow: PNG, JPEG or
 * WebP, known by their bytes and never by a name or a type somebody sent;
 * two megabytes at most; no side over the ceiling. And what it keeps is
 * only the picture: every chunk or segment that is not needed to draw it —
 * EXIF with its GPS, XMP, comments, text, thumbnails — is dropped, and
 * nothing after the end of the image survives, so the file cannot carry a
 * second file behind it.
 *
 * Not a re-encode: that needs an image library, which is a dependency the
 * product does not have and we decide on. Until then the pixels
 * are what was sent, inside a file rebuilt from the parts a decoder reads.
 */
export const MOST_BYTES = 2 * 1024 * 1024
export const MOST_SIDE = 4096

export type Clean = { type: 'image/png' | 'image/jpeg' | 'image/webp'; bytes: Uint8Array; width: number; height: number }
export type Refused = { refused: 'type' | 'size' | 'side' | 'broken' }

const concat = (parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.byteLength
  }
  return out
}

/* ------------------------------------------------------------------ PNG */

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
/* What a decoder needs to draw it as it was meant: the image, its palette and
   transparency, and how its colours are to be read. Nothing written in it. */
const PNG_KEEP = new Set(['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IEND', 'gAMA', 'cHRM', 'sRGB', 'pHYs', 'sBIT'])

function cleanPng(b: Uint8Array): Uint8Array | null {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const parts: Uint8Array[] = [b.subarray(0, 8)]
  let i = 8
  let ended = false
  let headers = 0
  while (i + 12 <= b.length) {
    const length = view.getUint32(i)
    const type = String.fromCharCode(b[i + 4]!, b[i + 5]!, b[i + 6]!, b[i + 7]!)
    const end = i + 12 + length
    if (end > b.length) return null
    /* The header first, thirteen bytes, and only once — what every decoder
       assumes and a crafted file need not say. */
    if (i === 8 && (type !== 'IHDR' || length !== 13)) return null
    if (type === 'IHDR' && ++headers > 1) return null
    if (PNG_KEEP.has(type)) parts.push(b.subarray(i, end))
    i = end
    if (type === 'IEND') {
      ended = true
      break
    }
  }
  return ended ? concat(parts) : null
}

/* ----------------------------------------------------------------- JPEG */

/*
 * The segments a decoder reads, by name, and nothing else: frame headers
 * (SOF0–3, 5–7, 9–11, 13–15), Huffman and arithmetic tables, quantisation
 * tables, restart intervals, scans, line counts and expansions. Every APPn
 * (EXIF, XMP, ICC, makers' notes), every comment and every marker not on
 * this list is dropped — except APP0 and APP14, rewritten below to the few
 * bytes that say how the colours are read and nothing more.
 */
const JPEG_KEEP = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf, 0xc4, 0xcc, 0xdb, 0xdd, 0xdc, 0xdf,
])

/* APP0 as a bare JFIF header — version, units, density — with no thumbnail:
   a JFIF or JFXX thumbnail is a second, uncropped picture. */
function bareJfif(seg: Uint8Array): Uint8Array | null {
  if (seg.length < 18 || String.fromCharCode(...seg.subarray(4, 9)) !== 'JFIF\0') return null
  const out = new Uint8Array(18)
  out.set([0xff, 0xe0, 0x00, 0x10])
  out.set(seg.subarray(4, 16), 4)
  out[16] = 0
  out[17] = 0
  return out
}

/* APP14 cut to Adobe's twelve bytes: what says whether the colours are
   transformed, which a decoder needs for CMYK. */
function bareAdobe(seg: Uint8Array): Uint8Array | null {
  if (seg.length < 16 || String.fromCharCode(...seg.subarray(4, 9)) !== 'Adobe') return null
  const out = new Uint8Array(16)
  out.set([0xff, 0xee, 0x00, 0x0e])
  out.set(seg.subarray(4, 16), 4)
  return out
}

function cleanJpeg(b: Uint8Array): Uint8Array | null {
  const parts: Uint8Array[] = [b.subarray(0, 2)]
  let i = 2
  while (i + 2 <= b.length) {
    if (b[i] !== 0xff) return null
    const marker = b[i + 1]!
    if (marker === 0xff) {
      i++
      continue
    }
    if (marker === 0xd9) {
      parts.push(new Uint8Array([0xff, 0xd9]))
      return concat(parts)
    }
    if (i + 4 > b.length) return null
    const length = (b[i + 2]! << 8) | b[i + 3]!
    const end = i + 2 + length
    if (end > b.length || length < 2) return null
    if (marker === 0xda) {
      /* The scan: its header, then the coded data up to the next marker
         that is not a restart and not a stuffed byte. */
      let j = end
      while (j + 1 < b.length) {
        if (b[j] === 0xff && b[j + 1] !== 0x00 && !(b[j + 1]! >= 0xd0 && b[j + 1]! <= 0xd7)) break
        j++
      }
      parts.push(b.subarray(i, j))
      i = j
      continue
    }
    const seg = b.subarray(i, end)
    if (marker === 0xe0) {
      const kept = bareJfif(seg)
      if (kept) parts.push(kept)
    } else if (marker === 0xee) {
      const kept = bareAdobe(seg)
      if (kept) parts.push(kept)
    } else if (JPEG_KEEP.has(marker)) {
      parts.push(seg)
    }
    i = end
  }
  return null
}

/* ----------------------------------------------------------------- WebP */

/* The image and how it is laid out — never EXIF, XMP or an ICC profile. */
const WEBP_KEEP = new Set(['VP8 ', 'VP8L', 'VP8X', 'ALPH', 'ANIM', 'ANMF'])

function cleanWebp(b: Uint8Array): Uint8Array | null {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const declared = view.getUint32(4, true) + 8
  if (declared > b.length || declared < 12) return null
  const parts: Uint8Array[] = []
  let i = 12
  /* It starts with the image or its extended header — nothing in front. */
  const first = String.fromCharCode(b[12] ?? 0, b[13] ?? 0, b[14] ?? 0, b[15] ?? 0)
  if (first !== 'VP8 ' && first !== 'VP8L' && first !== 'VP8X') return null
  while (i + 8 <= declared) {
    const type = String.fromCharCode(b[i]!, b[i + 1]!, b[i + 2]!, b[i + 3]!)
    const size = view.getUint32(i + 4, true)
    const end = i + 8 + size + (size % 2)
    if (end > declared + 1) return null
    if (WEBP_KEEP.has(type)) {
      const chunk = new Uint8Array(b.subarray(i, Math.min(end, declared)))
      /* The extended header says which chunks follow: the ones dropped are
         said to be absent — ICC (bit 5), EXIF (bit 3), XMP (bit 2). */
      if (type === 'VP8X' && chunk.length > 8) chunk[8] = chunk[8]! & ~(0x20 | 0x08 | 0x04)
      parts.push(chunk)
    }
    i = end
  }
  if (!parts.length) return null
  const body = concat(parts)
  const head = new Uint8Array(12)
  head.set([0x52, 0x49, 0x46, 0x46])
  new DataView(head.buffer).setUint32(4, body.byteLength + 4, true)
  head.set([0x57, 0x45, 0x42, 0x50], 8)
  return concat([head, body])
}

/* ------------------------------------------------------------------- all */

export function typeOf(b: Uint8Array): Clean['type'] | null {
  if (b.length >= 8 && PNG_SIGNATURE.every((x, i) => b[i] === x)) return 'image/png'
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (
    b.length >= 16 &&
    b[0] === 0x52 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x46 &&
    b[8] === 0x57 &&
    b[9] === 0x45 &&
    b[10] === 0x42 &&
    b[11] === 0x50
  )
    return 'image/webp'
  return null
}

export function cleanImage(bytes: Uint8Array): Clean | Refused {
  if (bytes.byteLength > MOST_BYTES) return { refused: 'size' }
  const type = typeOf(bytes)
  if (!type) return { refused: 'type' }
  const cleaned = type === 'image/png' ? cleanPng(bytes) : type === 'image/jpeg' ? cleanJpeg(bytes) : cleanWebp(bytes)
  if (!cleaned) return { refused: 'broken' }
  const px = pixelsOf(cleaned)
  if (!px || px.width < 1 || px.height < 1) return { refused: 'broken' }
  if (px.width > MOST_SIDE || px.height > MOST_SIDE) return { refused: 'side' }
  return { type, bytes: cleaned, width: px.width, height: px.height }
}
