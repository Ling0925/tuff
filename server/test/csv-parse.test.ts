import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dayFirstIn, dayOf, guess, labelsOf, parseCsv, priorityOf } from '@tracker/shared-schema'

/* The reading half, which runs in the browser —
   tested here, where the tests are. The three exports, as each writes them. */
test('a CSV with quotes, commas, line breaks and a byte-order mark is read as written', () => {
  const rows = parseCsv('﻿Summary,Description,Labels,Labels\r\n"Login, again","Line one\nLine ""two""",Bug,web\r\n\r\nPlain,,,\n')
  assert.deepEqual(rows, [
    ['Summary', 'Description', 'Labels', 'Labels'],
    ['Login, again', 'Line one\nLine "two"', 'Bug', 'web'],
    ['Plain', '', '', ''],
  ])
  assert.deepEqual(parseCsv('a;b\n1;2'), [
    ['a', 'b'],
    ['1', '2'],
  ])
})

test('Jira’s, Asana’s and Linear’s headers are each recognised', () => {
  assert.equal(guess(['Issue key', 'Summary', 'Status', 'Assignee']).title, 1)
  assert.equal(guess(['Issue key', 'Summary', 'Status', 'Assignee']).key, 0)
  const asana = guess(['Task ID', 'Name', 'Section/Column', 'Assignee Email', 'Completed At', 'Tags', 'Notes'])
  assert.deepEqual([asana.title, asana.status, asana.assignee, asana.done, asana.labels, asana.body], [1, 2, 3, 4, 5, 6])
  assert.equal(guess(['ID', 'Title', 'Priority']).priority, 2)
})

test('dates, priorities and labels as each writes them', () => {
  assert.equal(dayOf('2026-11-06'), '2026-11-06')
  assert.equal(dayOf('06/Nov/26 10:00 AM'), '2026-11-06')
  assert.equal(dayOf('11/06/2026'), '2026-11-06')
  assert.equal(dayOf(''), undefined)
  // The European way round, decided by the file, and a day that is none.
  assert.equal(dayOf('31/12/2026', true), '2026-12-31')
  assert.equal(dayOf('31/12/2026', false), undefined)
  assert.equal(dayOf('2026-13-45'), undefined)
  assert.equal(dayFirstIn(['01/02/2026', '25/03/2026'], false), true)
  assert.equal(dayFirstIn(['03/25/2026'], true), false)
  assert.equal(dayFirstIn(['01/02/2026'], true), true)
  assert.equal(priorityOf('Highest'), 'urgent')
  assert.equal(priorityOf('P2'), 'medium')
  assert.equal(priorityOf('whatever'), undefined)
  assert.deepEqual(labelsOf('Bug, web;Bug'), ['Bug', 'web'])
})
