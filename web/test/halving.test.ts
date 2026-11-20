import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sendHalving } from '../src/data/halving.js'

/* The CSV import's pages. The server refuses
   a page whose documents come to too much, writing none of it. */
class TooLarge extends Error {}
const isTooLarge = (e: unknown) => e instanceof TooLarge

test('a page the server takes is sent once', async () => {
  const sent: number[][] = []
  const n = await sendHalving([1, 2, 3], async (p) => (sent.push(p), p.length), isTooLarge)
  assert.equal(n, 3)
  assert.deepEqual(sent, [[1, 2, 3]])
})

test('a page too large is halved until each half is taken, in order', async () => {
  const taken: number[][] = []
  const told: number[] = []
  const rows = [1, 2, 3, 4, 5, 6, 7, 8]
  const n = await sendHalving(
    rows,
    async (p) => {
      if (p.reduce((s, r) => s + r, 0) > 10) throw new TooLarge()
      taken.push(p)
      return p.length
    },
    isTooLarge,
    (k) => told.push(k),
  )
  assert.equal(n, 8)
  assert.deepEqual(taken.flat(), rows, 'every row written once, in order')
  assert.ok(taken.length > 1)
  assert.equal(
    told.reduce((s, k) => s + k, 0),
    8,
  )
})

test('a single row still too large is the error, and other errors are not halved', async () => {
  await assert.rejects(
    sendHalving(
      [1, 99],
      async (p) => {
        if (p.includes(99)) throw new TooLarge()
        return p.length
      },
      isTooLarge,
    ),
    TooLarge,
  )
  let calls = 0
  await assert.rejects(
    sendHalving(
      [1, 2],
      async () => {
        calls++
        throw new Error('down')
      },
      isTooLarge,
    ),
    /down/,
  )
  assert.equal(calls, 1)
})
