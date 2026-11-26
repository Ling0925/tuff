import test from 'node:test'
import assert from 'node:assert/strict'
import { labelColumns, labelWalk, labelByColumn, UNLABELED } from '../src/ui/tasks/labelView.jsx'
import type { Task, List } from '../src/ui/tasks/model.jsx'
import type { Label } from '../src/ui/kit.jsx'

const task = (id: string, labels: Label[] = [], list = 'open'): Task => ({
  id,
  number: 1,
  title: id,
  list_id: list,
  assignee_id: null,
  due_on: null,
  priority: null,
  labels,
  starts_at: null,
  ends_at: null,
  sort_key: id,
  completed_at: null,
  decided_at: '',
  parent_id: null,
})
const bug: Label = { id: 'bug', name: 'Bug' }
const ui: Label = { id: 'ui', name: 'UI' }
const lists: List[] = [
  { id: 'open', name: 'Open', progress: null, finishes: false, icon: '', color: null },
  { id: 'done', name: 'Done', progress: null, finishes: true, icon: '', color: null },
]

test('label columns duplicate multi-label tasks, keep unlabeled work, and count finished work', () => {
  const both = task('both', [bug, ui])
  const plain = task('plain')
  const finished = task('finished', [bug], 'done')
  const columns = labelColumns({
    lists,
    byColumn: new Map([
      ['open', [both, plain]],
      ['done', [finished]],
    ]),
    allLabels: [bug, ui],
    sort: 'manual',
    dir: 'asc',
  })
  assert.deepEqual(
    columns.map((c) => c.key),
    [UNLABELED, 'bug', 'ui'],
  )
  assert.deepEqual(
    columns[1]!.open.map((t) => t.id),
    ['both'],
  )
  assert.deepEqual(
    columns[2]!.open.map((t) => t.id),
    ['both'],
  )
  assert.deepEqual(
    columns[0]!.open.map((t) => t.id),
    ['plain'],
  )
  assert.equal(columns[1]!.done, 1)
  assert.equal(columns[0]!.done, 0)
})

test('label walk and range-selection columns deduplicate tasks but keep column membership', () => {
  const both = task('both', [bug, ui])
  const plain = task('plain')
  const columns = labelColumns({
    lists,
    byColumn: new Map([
      ['open', [both, plain]],
      ['done', []],
    ]),
    allLabels: [bug, ui],
    sort: 'manual',
    dir: 'asc',
  })
  assert.deepEqual(
    labelWalk(columns).map((t) => t.id),
    ['plain', 'both'],
  )
  assert.deepEqual(
    labelByColumn(columns)
      .get('bug')!
      .map((t) => t.id),
    ['both'],
  )
  assert.deepEqual(
    labelByColumn(columns)
      .get(UNLABELED)!
      .map((t) => t.id),
    ['plain'],
  )
})
