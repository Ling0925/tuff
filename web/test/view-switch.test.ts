import test from 'node:test'
import assert from 'node:assert/strict'
import { viewOf } from '../src/ui/tasks/useTaskData.js'

/*
 * Which drawing the address asks for, at this width — `useTaskData.viewOf`.
 *
 * The labels board is a drawing of its own and answers at every width:
 * holding it to a desk meant pressing Labels on a phone changed the address
 * and left the list on the screen, which read as a switch that did nothing.
 * Members is different — a way of grouping the board rather than a drawing
 * of its own — so a narrower window draws the board's lists for it and the
 * members come back when the window widens.
 */
test('labels is the labels board at any width', () => {
  assert.equal(viewOf('labels', 'list', true), 'labels')
  assert.equal(viewOf('labels', 'list', false), 'labels')
  /* The grouping the address happens to carry does not change it either:
     labels is not a way of grouping the board. */
  assert.equal(viewOf('labels', 'who', false), 'labels')
})

test('board by members is a desk drawing; narrower windows draw the board', () => {
  assert.equal(viewOf('board', 'who', true), 'people')
  assert.equal(viewOf('board', 'who', false), 'board')
  assert.equal(viewOf('board', 'list', true), 'board')
  assert.equal(viewOf('board', 'list', false), 'board')
})

test('everything else is the list', () => {
  assert.equal(viewOf('list', 'list', true), 'list')
  assert.equal(viewOf('list', 'list', false), 'list')
  assert.equal(viewOf('', 'list', false), 'list')
})
