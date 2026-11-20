/**
 * How many pixels a picture is, read off its first bytes — PNG, JPEG, GIF
 * or WebP, and null for anything else.
 *
 * Written when it is uploaded, so whatever draws it later can hold its room
 * before it loads: the browser measures what it uploads, and an agent
 * uploading through MCP had nothing to measure with, so its pictures arrived
 * as a line that grew.
 */
export function pixelsOf(b: Uint8Array): { width: number; height: number } | null {
  const px = read(b)
  return px && fits(px.width) && fits(px.height) ? px : null
}

/*
 * A side the format allows — PNG's own bound, 2³¹ − 1, is the widest of
 * the four — and what the database's `int` columns hold. A header saying
 * 2³¹ passed through and failed the file's insert after its bytes were
 * stored (the night audit, 14).
 */
const fits = (n: number) => Number.isInteger(n) && n >= 1 && n <= 0x7fffffff

function read(b: Uint8Array): { width: number; height: number } | null {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const at = (i: number) => b[i] ?? 0
  // PNG: the IHDR chunk's width and height, big-endian.
  if (b.length >= 24 && at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) {
    return { width: view.getUint32(16), height: view.getUint32(20) }
  }
  // GIF: the logical screen, little-endian.
  if (b.length >= 10 && at(0) === 0x47 && at(1) === 0x49 && at(2) === 0x46) {
    return { width: view.getUint16(6, true), height: view.getUint16(8, true) }
  }
  // WebP: lossy (VP8), lossless (VP8L) or extended (VP8X).
  if (b.length >= 30 && at(0) === 0x52 && at(1) === 0x49 && at(8) === 0x57 && at(9) === 0x45) {
    const kind = String.fromCharCode(at(12), at(13), at(14), at(15))
    if (kind === 'VP8 ') return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff }
    if (kind === 'VP8L') {
      const bits = view.getUint32(21, true)
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }
    }
    if (kind === 'VP8X') {
      const three = (i: number) => at(i) | (at(i + 1) << 8) | (at(i + 2) << 16)
      return { width: three(24) + 1, height: three(27) + 1 }
    }
    return null
  }
  // JPEG: walk the markers to the first frame header.
  if (b.length >= 4 && at(0) === 0xff && at(1) === 0xd8) {
    let i = 2
    while (i + 9 < b.length) {
      if (at(i) !== 0xff) return null
      const marker = at(i + 1)
      const length = view.getUint16(i + 2)
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { width: view.getUint16(i + 7), height: view.getUint16(i + 5) }
      }
      i += 2 + length
    }
  }
  return null
}
