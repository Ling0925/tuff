/**
 * Whether a picture's bytes are whole — PNG, JPEG, GIF or WebP, told by
 * their own bytes and never by a name or a type somebody sent.
 *
 * What is stored is exactly what was sent, always: this changes nothing,
 * it only reads. What it answers is whether the file is all there. A
 * picture can be shorter than its own header says — cut off on its way up,
 * or written out by a step that dropped a byte of its base64 and shifted
 * every byte after it — and such a file was stored, served and drawn as a
 * blur or a grey box, with its size and even its pixel dimensions looking
 * right, because those are read off the header alone. Nobody was ever told.
 *
 * The walk is each format's own: a PNG is its chunks, length by length, to
 * IEND; a JPEG its segments to the scan and the scan to the next marker,
 * to EOI; a GIF its blocks to the trailer; a WebP its chunks inside the
 * RIFF length it declares. What the walk is not is a decode: a bit flipped
 * inside otherwise whole scan data is beyond what structure can see (and
 * for JPEG nothing short of decoding the scan can see it). What it catches
 * is the file that is not all there — which is the file that looks fine in
 * every listing and cannot be drawn.
 *
 * `null` is not broken: it is not one of the four, so there is nothing here
 * to say about it — a file of any other kind takes its own chances, as it
 * always has.
 */
export type WholeImage = 'png' | 'jpeg' | 'gif' | 'webp'

export function wholeImage(b: Uint8Array): WholeImage | 'broken' | null {
  if (isPng(b)) return wholePng(b) ? 'png' : 'broken'
  if (isJpeg(b)) return wholeJpeg(b) ? 'jpeg' : 'broken'
  if (isGif(b)) return wholeGif(b) ? 'gif' : 'broken'
  if (isWebp(b)) return wholeWebp(b) ? 'webp' : 'broken'
  return null
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const isPng = (b: Uint8Array) => b.length >= 8 && PNG_SIGNATURE.every((x, i) => b[i] === x)
const isJpeg = (b: Uint8Array) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff
const isGif = (b: Uint8Array) =>
  b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38 && (b[4] === 0x37 || b[4] === 0x39) && b[5] === 0x61
const isWebp = (b: Uint8Array) =>
  b.length >= 16 &&
  b[0] === 0x52 &&
  b[1] === 0x49 &&
  b[2] === 0x46 &&
  b[3] === 0x46 &&
  b[8] === 0x57 &&
  b[9] === 0x45 &&
  b[10] === 0x42 &&
  b[11] === 0x50

/* ------------------------------------------------------------------ PNG */

function wholePng(b: Uint8Array): boolean {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength)
  let i = 8
  let headers = 0
  let data = 0
  while (i + 12 <= b.length) {
    const length = view.getUint32(i)
    const type = String.fromCharCode(b[i + 4]!, b[i + 5]!, b[i + 6]!, b[i + 7]!)
    const end = i + 12 + length
    /* A chunk running past the end of the file is the file cut short. */
    if (end > b.length) return false
    /* The header first, thirteen bytes, and only once. */
    if (i === 8 && (type !== 'IHDR' || length !== 13)) return false
    if (type === 'IHDR' && ++headers > 1) return false
    if (type === 'IDAT') data++
    i = end
    if (type === 'IEND') return data > 0
  }
  /* Fell off the end of the file with no IEND. */
  return false
}

/* ----------------------------------------------------------------- JPEG */

function wholeJpeg(b: Uint8Array): boolean {
  let i = 2
  let frame = false
  let scan = false
  while (i + 2 <= b.length) {
    if (b[i] !== 0xff) return false
    const marker = b[i + 1]!
    if (marker === 0xff) {
      i++
      continue
    }
    if (marker === 0xd9) return frame && scan
    if (i + 4 > b.length) return false
    const length = (b[i + 2]! << 8) | b[i + 3]!
    const end = i + 2 + length
    if (end > b.length || length < 2) return false
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) frame = true
    if (marker === 0xda) {
      scan = true
      /* The scan: its header, then the coded data up to the next marker
         that is not a restart and not a stuffed byte. */
      let j = end
      while (j + 1 < b.length) {
        if (b[j] === 0xff && b[j + 1] !== 0x00 && !(b[j + 1]! >= 0xd0 && b[j + 1]! <= 0xd7)) break
        j++
      }
      i = j
      continue
    }
    i = end
  }
  /* Fell off the end of the file with no EOI — the scan cut short is the
     progressive picture that draws as a blur instead of failing. */
  return false
}

/* ------------------------------------------------------------------ GIF */

function wholeGif(b: Uint8Array): boolean {
  if (b.length < 13) return false
  /* The logical screen descriptor, and the global colour table it may
     say follows. */
  const packed = b[10]!
  let i = 13
  if (packed & 0x80) i += 3 * 2 ** ((packed & 0x07) + 1)
  if (i > b.length) return false
  let picture = false
  /* Sub-blocks: a run of size-prefixed parts ended by a zero. Answers
     where the next block starts, or past the end when they are cut. */
  const pastSubBlocks = (at: number): number => {
    while (at < b.length) {
      const size = b[at]!
      if (size === 0) return at + 1
      at += 1 + size
    }
    return b.length + 1
  }
  while (i < b.length) {
    const marker = b[i]!
    if (marker === 0x3b) return picture
    if (marker === 0x21) {
      /* An extension: its byte, a label, and sub-blocks. */
      i = pastSubBlocks(i + 2)
      continue
    }
    if (marker === 0x2c) {
      /* A picture: nine bytes of descriptor, a local table the packed byte
         may say, the LZW floor, and the data as sub-blocks. */
      if (i + 10 > b.length) return false
      picture = true
      const local = b[i + 9]!
      let at = i + 10
      if (local & 0x80) at += 3 * 2 ** ((local & 0x07) + 1)
      if (at >= b.length) return false
      i = pastSubBlocks(at + 1)
      continue
    }
    return false
  }
  return false
}

/* ----------------------------------------------------------------- WebP */

function wholeWebp(b: Uint8Array): boolean {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const declared = view.getUint32(4, true) + 8
  /* The RIFF length saying more than the file holds is the file cut short.
     Saying less is only bytes behind the picture, which some encoders pad. */
  if (declared > b.length || declared < 12) return false
  const first = String.fromCharCode(b[12] ?? 0, b[13] ?? 0, b[14] ?? 0, b[15] ?? 0)
  if (first !== 'VP8 ' && first !== 'VP8L' && first !== 'VP8X') return false
  let i = 12
  let picture = false
  while (i + 8 <= declared) {
    const type = String.fromCharCode(b[i]!, b[i + 1]!, b[i + 2]!, b[i + 3]!)
    const size = view.getUint32(i + 4, true)
    const end = i + 8 + size + (size % 2)
    if (end > declared + 1) return false
    if (type === 'VP8 ' || type === 'VP8L' || type === 'ANMF') picture = true
    i = end
  }
  return picture
}
