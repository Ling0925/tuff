import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { closeDb } from './helpers.js'
import { ADAPTERS } from '../src/http/import.js'

after(async () => {
  await closeDb()
})

test('three exports normalise to one shape', () => {
  const trello = ADAPTERS.trello({
    name: 'Board',
    lists: [
      { id: 'l1', name: 'Doing' },
      { id: 'l2', name: 'Archived', closed: true },
    ],
    cards: [
      { idList: 'l1', name: 'A card', desc: 'about it', due: '2026-03-01T00:00:00Z' },
      { idList: 'l2', name: 'In an archived list' },
    ],
    actions: [{ type: 'commentCard', data: { text: 'said something' }, memberCreator: { fullName: 'Sam' } }],
  })
  // An archived list is not work somebody still has: bringing it across would
  // hand a team a backlog of things they had already put away.
  assert.deepEqual(
    trello.lists.map((l) => l.name),
    ['Doing'],
  )
  assert.equal(trello.lists[0]!.tasks[0]!.due_on, '2026-03-01')
  assert.equal(trello.lists[0]!.tasks[0]!.comments[0]!.author, 'Sam')

  const asana = ADAPTERS.asana({
    name: 'Project',
    tasks: [
      {
        name: 'Task one',
        notes: 'detail',
        completed: true,
        memberships: [{ section: { name: 'Later' } }],
        created_by: { name: 'Dana' },
        stories: [{ text: 'a story', created_by: { name: 'Sam' } }],
      },
      { name: 'No section' },
    ],
  })
  assert.deepEqual(asana.lists.map((l) => l.name).sort(), ['Later', 'Tasks'])
  assert.equal(asana.lists.find((l) => l.name === 'Later')!.tasks[0]!.author, 'Dana')

  const basecamp = ADAPTERS.basecamp({
    name: 'Client work',
    todolists: [
      {
        title: 'Week one',
        todos: [
          {
            content: 'Do the thing',
            creator: { name: 'Dana' },
            comments: [{ content: 'on it', creator: { name: 'Sam' } }],
          },
        ],
      },
    ],
    messages: [{ subject: 'Kickoff', content: 'we start monday', creator: { name: 'Dana' } }],
  })
  assert.equal(basecamp.posts[0]!.title, 'Kickoff')
  assert.equal(basecamp.lists[0]!.tasks[0]!.comments[0]!.text, 'on it')
})

test('an export with nothing recognisable is refused, not half-imported', () => {
  // Reading whatever happens to parse and quietly dropping the rest is how an
  // import leaves a team unsure what they actually have.
  const empty = ADAPTERS.trello({ name: 'Board' })
  assert.deepEqual(empty.lists, [])
  assert.throws(() => ADAPTERS.normalised({ lists: [] }))
})
