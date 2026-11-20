import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pixelsOf } from '../src/pixels.js'

/* A picture's pixels, off its first bytes — `server/src/pixels.ts`. */
test('the size of a PNG, a JPEG, a GIF and a WebP is read off their first bytes', () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
  assert.deepEqual(pixelsOf(png), { width: 1, height: 1 })

  // A JPEG: start, an APP0 of sixteen bytes, then a frame header at 100 by 200.
  const jpeg = Uint8Array.from([
    0xff,
    0xd8,
    0xff,
    0xe0,
    0x00,
    0x10,
    ...new Array(14).fill(0),
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    0x00,
    0x64,
    0x00,
    0xc8,
    0x03,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
  ])
  assert.deepEqual(pixelsOf(jpeg), { width: 200, height: 100 })

  const gif = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 3, 0, 4, 0, 0, 0])
  assert.deepEqual(pixelsOf(gif), { width: 3, height: 4 })

  // An extended WebP, 640 by 480: the canvas is stored less one, in three bytes.
  const webp = new Uint8Array(30)
  webp.set([0x52, 0x49, 0x46, 0x46], 0)
  webp.set([0x57, 0x45, 0x42, 0x50], 8)
  webp.set([0x56, 0x50, 0x38, 0x58], 12)
  webp.set([639 & 0xff, 639 >> 8, 0, 479 & 0xff, 479 >> 8, 0], 24)
  assert.deepEqual(pixelsOf(webp), { width: 640, height: 480 })

  assert.equal(pixelsOf(Buffer.from('%PDF-1.7')), null)
})
