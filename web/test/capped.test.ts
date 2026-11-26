import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cappedRows, landing } from '../src/ui/capped.js'

/* The open project or room is always in the sidebar's column. */
const rows = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({ id }))
const ids = (r: { id: string }[]) => r.map((x) => x.id)

test('nothing open, or the open one within the cap: the first of the order', () => {
  assert.deepEqual(ids(cappedRows(rows, 3, null).shown), ['a', 'b', 'c'])
  assert.deepEqual(cappedRows(rows, 3, 'b'), { shown: rows.slice(0, 3), lifted: false })
  assert.deepEqual(cappedRows(rows, 3, 'c').lifted, false)
  // Open, but not in this list at all — a room put away, an archived project.
  assert.deepEqual(cappedRows(rows, 3, 'zz').lifted, false)
})

test('the open one past the cap takes the last place, and the list is as long', () => {
  const { shown, lifted } = cappedRows(rows, 3, 'e')
  assert.equal(lifted, true)
  assert.deepEqual(ids(shown), ['a', 'b', 'e'])
})

test('everything fits: nothing to lift', () => {
  assert.deepEqual(cappedRows(rows, 10, 'f'), { shown: rows, lifted: false })
})

test('a drop anywhere but below the lifted row lands as it says', () => {
  const drawn = ['a', 'b', 'e']
  assert.equal(landing(drawn, true, 'e', 'a', 'b'), 'b')
  assert.equal(landing(drawn, true, 'e', 'b', null), null)
  // The lifted row itself, carried up: where it was let go.
  assert.equal(landing(drawn, true, 'e', 'e', 'a'), 'a')
  // Nothing lifted: the row above the gap, whatever it is.
  assert.equal(landing(['a', 'b', 'c'], false, 'c', 'a', 'c'), 'c')
})

test('let go below the lifted row, a row lands above it, not behind its far-off place', () => {
  assert.equal(landing(['a', 'b', 'e'], true, 'e', 'a', 'e'), 'b')
  // Already right above it: no move.
  assert.equal(landing(['a', 'b', 'e'], true, 'e', 'b', 'e'), undefined)
})
