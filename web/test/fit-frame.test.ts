import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fitFrame } from '../src/data/fitFrame.js'

/*
 * Opened, a picture is as large as the window allows — a small screenshot
 * is read, not squinted at. Capped at its own size, a 390-pixel phone
 * screenshot in the middle of a desktop window was no bigger opened than it
 * was in the column, and the words in it stayed unreadable: the lightbox
 * was a frame around the same small picture.
 *
 * Past its own size it is drawn up to twice over — enough to read what a
 * phone-sized screenshot says, not so far that a sharp one is mush.
 */
test('a picture larger than the window is still shrunk to fit', () => {
  const fit = fitFrame({ w: 4000, h: 3000 }, { w: 1440, h: 900 })
  assert.ok(fit.h <= 900 - 64)
  assert.ok(fit.w <= 1440 - 64)
  // The smaller of the two fittings, in the picture's shape.
  assert.equal(fit.h, 836)
  assert.equal(fit.w, Math.round((4000 * 836) / 3000))
})

test('a small picture grows to fill the window, up to twice its own size', () => {
  // 480 × 373 in 1440 × 900: twice over fills the width before the cap.
  const fit = fitFrame({ w: 480, h: 373 }, { w: 1440, h: 900 })
  assert.deepEqual(fit, { w: 960, h: 746 })
})

test('a picture already near the window is its own size, never squeezed out of shape', () => {
  // 390 × 844 in 1440 × 900 is height-bound just under its own height.
  const fit = fitFrame({ w: 390, h: 844 }, { w: 1440, h: 900 })
  assert.equal(fit.h, 836)
  assert.equal(fit.w, Math.round((390 * 836) / 844))
  // Width and height keep the picture's shape.
  assert.ok(Math.abs(fit.w / fit.h - 390 / 844) < 0.01)
})

test('the growth stops at twice over, however small the picture', () => {
  const fit = fitFrame({ w: 100, h: 100 }, { w: 2560, h: 1440 })
  assert.deepEqual(fit, { w: 200, h: 200 })
})
