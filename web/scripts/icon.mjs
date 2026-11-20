/*
 * The icon, at the size a Mac expects it.
 *
 * A dock icon is not the whole tile. Every system icon draws its shape inside
 * about four fifths of the canvas and leaves the rest transparent, and one
 * that fills the square edge to edge stands taller than everything beside it
 * — which is what ours did. The numbers are Apple's: the shape is 80.5% of
 * the side, and it is a squircle rather than a rounded rectangle, which is
 * the difference between looking nearly right and looking placed.
 *
 * Written rather than drawn because it is four numbers and a tick, and a
 * binary in the repository that nobody can regenerate is a binary nobody
 * dares change. `node web/scripts/icon.mjs`.
 */
import { writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'

const BLUE = [29, 99, 255]
/**
 * How much of the canvas the shape uses.
 *
 * Apple's proportion for a *dock* icon, where the app supplies its own
 * rounded shape and the margin is what keeps it the same size as its
 * neighbours.
 *
 * A Home Screen icon on iOS is the opposite: the system masks whatever it is
 * given into the squircle itself. Handed one that is already a squircle with
 * a margin, it rounds the rounding and leaves the corners transparent, which
 * on a Home Screen is black. That one is a plain square — see
 * `apple-touch-icon` below.
 */
const SHAPE = 0.805
/** The squircle's exponent: 4 is a rounded square, 5 is what a Mac draws. */
const N = 5

/** Coverage of one pixel, sampled, so the curve has no staircase on it. */
function cover(x, y, half, mid, test) {
  let hit = 0
  const step = 1 / 4
  for (let sy = 0; sy < 4; sy++) {
    for (let sx = 0; sx < 4; sx++) {
      if (test(x + (sx + 0.5) * step - mid, y + (sy + 0.5) * step - mid, half)) hit++
    }
  }
  return hit / 16
}

const squircle = (dx, dy, half) =>
  Math.abs(dx / half) ** N + Math.abs(dy / half) ** N <= 1

function icon(size, square = false) {
  const mid = size / 2
  const half = (size * (square ? 1 : SHAPE)) / 2
  /* The tick, in the same proportions whatever the size: a short stroke down
     and a long one up, struck through the middle of the shape. */
  const w = half * 0.135
  const pts = [
    [-0.30, 0.02, -0.07, 0.25],
    [-0.07, 0.25, 0.32, -0.24],
  ].map(([x1, y1, x2, y2]) => [x1 * half * 2, y1 * half * 2, x2 * half * 2, y2 * half * 2])

  const onTick = (dx, dy) =>
    pts.some(([x1, y1, x2, y2]) => {
      const ax = x2 - x1
      const ay = y2 - y1
      const t = Math.max(0, Math.min(1, ((dx - x1) * ax + (dy - y1) * ay) / (ax * ax + ay * ay)))
      const px = x1 + t * ax
      const py = y1 + t * ay
      return (dx - px) ** 2 + (dy - py) ** 2 <= w * w
    })

  const rows = []
  for (let y = 0; y < size; y++) {
    const row = [0]
    for (let x = 0; x < size; x++) {
      // A square has no shape to be inside of: every pixel is the icon.
      const shape = square ? () => true : squircle
      const inShape = square ? 1 : cover(x, y, half, mid, shape)
      const inTick = cover(x, y, half, mid, (dx, dy) => shape(dx, dy, half) && onTick(dx, dy))
      // The tick is white over the blue, both faded by how much of the pixel
      // the shape covers — so the edge is a curve and not a staircase.
      const t = inShape === 0 ? 0 : inTick / inShape
      const c = BLUE.map((v) => Math.round(v + (255 - v) * t))
      row.push(c[0], c[1], c[2], Math.round(inShape * 255))
    }
    rows.push(Buffer.from(row))
  }

  const crcTable = []
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    crcTable[n] = c >>> 0
  }
  const crc = (buf) => {
    let c = 0xffffffff
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type), data])
    const sum = Buffer.alloc(4)
    sum.writeUInt32BE(crc(body))
    return Buffer.concat([len, body, sum])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows), { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

for (const size of [192, 512]) {
  writeFileSync(new URL(`../public/icon-${size}.png`, import.meta.url), icon(size))
  console.log(`icon-${size}.png`)
}

/*
 * And the one iOS puts on a Home Screen, which it masks itself.
 *
 * 180 is what it asks for, and a plain square because the system draws the
 * squircle: handed a rounded one it rounds the rounding, and the corners it
 * trims were transparent, which on a Home Screen is black.
 */
writeFileSync(new URL('../public/apple-touch-icon.png', import.meta.url), icon(180, true))
console.log('apple-touch-icon.png')
