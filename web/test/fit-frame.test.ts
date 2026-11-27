import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fitFrame } from '../src/data/fitFrame.js'

/*
 * Opened, a picture is as large as the window allows. Capped at its own
 * size, a phone-sized screenshot opened in the middle of a desktop window
 * exactly as small as it was in the column, and the words in it stayed
 * unreadable: the lightbox was a frame around the same small picture, with
 * no zoom to make up for it. Growing it does not invent detail — it puts
 * the pixels that are there at a size they can be read at.
 */
test('a picture larger than the window is shrunk to fit', () => {
  const fit = fitFrame({ w: 4000, h: 3000 }, { w: 1440, h: 900 })
  assert.ok(fit.h <= 900 - 64)
  assert.ok(fit.w <= 1440 - 64)
  // The smaller of the two fittings, in the picture's shape.
  assert.equal(fit.h, 836)
  assert.equal(fit.w, Math.round((4000 * 836) / 3000))
})

test('a small picture grows to fill the window', () => {
  // 480 × 373 in 1440 × 900: height-bound, past twice over.
  const fit = fitFrame({ w: 480, h: 373 }, { w: 1440, h: 900 })
  assert.equal(fit.h, 836)
  assert.equal(fit.w, Math.round((480 * 836) / 373))
  // 960 × 575 in 1440 × 900: width-bound.
  const wide = fitFrame({ w: 960, h: 575 }, { w: 1440, h: 900 })
  assert.equal(wide.w, 1376)
  assert.equal(wide.h, Math.round((575 * 1376) / 960))
})

test('a picture keeps its own shape at any size', () => {
  for (const fit of [
    fitFrame({ w: 390, h: 844 }, { w: 1440, h: 900 }),
    fitFrame({ w: 960, h: 575 }, { w: 2560, h: 1440 }),
    fitFrame({ w: 100, h: 100 }, { w: 2560, h: 1440 }),
  ]) {
    assert.ok(fit.w <= 2560 - 64 + 1)
  }
  const tall = fitFrame({ w: 390, h: 844 }, { w: 1440, h: 900 })
  assert.ok(Math.abs(tall.w / tall.h - 390 / 844) < 0.01)
})

test('a window smaller than the margin still shows the picture, never a negative box', () => {
  const fit = fitFrame({ w: 800, h: 600 }, { w: 40, h: 30 })
  assert.ok(fit.w >= 1 && fit.h >= 1)
  // A merely small window: shrunk into what room there is, in shape.
  const small = fitFrame({ w: 800, h: 600 }, { w: 100, h: 100 })
  assert.deepEqual(small, { w: 36, h: 27 })
})
