import { test } from 'node:test'
import assert from 'node:assert/strict'
import { keepApart, recall, remember } from '../src/data/memory.js'

/*
 * A board's page keeps its answers apart.
 * The new-task window's picker remembers the projects it was offered under
 * `projects:pick`; on a board that is the board, and the app's picker must
 * never be drawn from it.
 */
test('what a board remembers is never what the app recalls', () => {
  keepApart(null)
  remember('projects:pick', [{ id: 'real', name: 'Website' }])
  keepApart('board:abc')
  assert.deepEqual(recall('projects:pick'), null, 'the board starts from nothing of the app’s')
  remember('projects:pick', [{ id: 'abc', name: 'Launch week' }])
  assert.deepEqual(recall('projects:pick'), [{ id: 'abc', name: 'Launch week' }])
  keepApart(null)
  assert.deepEqual(recall('projects:pick'), [{ id: 'real', name: 'Website' }], 'the app’s own, untouched')
})
