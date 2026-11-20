import { test } from 'node:test'
import assert from 'node:assert/strict'
import { wholeFromEnv } from '../src/env.js'

/*
 * A number from the environment — a review. Compose passes a line
 * `PURGE_AFTER_DAYS=` as an empty string, and `Number('')` is 0: the worker
 * would have cleared every deleted thing on its first pass.
 */
test('unset, empty, blank, zero or not a number is the default', () => {
  for (const raw of [undefined, '', '  ', '0', 'abc', 'NaN', 'Infinity']) assert.equal(wholeFromEnv(raw, 30), 30, String(raw))
})

test('a number is taken whole, and never under the floor', () => {
  assert.equal(wholeFromEnv('7', 30), 7)
  assert.equal(wholeFromEnv(' 45 ', 30), 45)
  assert.equal(wholeFromEnv('2.9', 30), 2)
  assert.equal(wholeFromEnv('0.5', 30), 30)
  assert.equal(wholeFromEnv('-5', 30), 1)
  assert.equal(wholeFromEnv('3', 20, 5), 5)
})
