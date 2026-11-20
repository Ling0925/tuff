import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { closeDb, makeOwner, addPerson, makeProject, bearerFor, asTableOwner } from './helpers.js'
import { app } from '../src/http/routes.js'
import { closeRealtime } from '../src/realtime.js'
import { markdown } from '../src/prompt.js'
import { findLine, lineAt, nameTask, splitLines, titleOf } from '../src/mcp/taskLines.js'
import { cleanLine, lineForTask, lineSays, lineTitle, TITLE_MOST } from '@tracker/shared-schema'
import * as Y from 'yjs'
import { bodyOf, carryRich, forStrangers, stateFrom, threadsIn } from '../src/yjson.js'
import { fromMarkdown } from '../src/mcp/markdown.js'

/*
 * A document's lines made into tasks. The
 * line becomes the task named as a node; the task points back; every
 * reader of the body still reads its words.
 */

after(async () => {
  await closeRealtime()
  await closeDb()
})

const para = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] })
const doc = (...lines: string[]) => ({ type: 'doc', content: lines.map(para) })
const call = (token: string) => (method: string, path: string, body?: unknown) =>
  app.request(path, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

const chip = (id: string, title: string) => ({ type: 'taskref', attrs: { id, projectId: 'p', number: 41, key: 'ACM', title } })

test('a line is found and replaced by the task, whole or in part, marks kept around it', () => {
  const body = {
    type: 'doc',
    content: [
      para('Agenda'),
      {
        type: 'bulletList',
        content: [
          { type: 'listItem', content: [para('Call the printer')] },
          {
            type: 'listItem',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Then send the proofs today', marks: [{ type: 'bold' }] }] }],
          },
        ],
      },
    ],
  }
  assert.ok(findLine(body, 'Call the printer'))
  assert.equal(findLine(body, 'Not there'), null)
  assert.ok(nameTask(body, '  Call the printer ', { id: 't1', projectId: 'p', number: 41, key: 'ACM', title: 'Call the printer' }))
  assert.ok(nameTask(body, 'send the proofs', { id: 't2', projectId: 'p', number: 42, key: 'ACM', title: 'send the proofs' }))
  const items = (body.content[1] as { content: { content: { content: unknown[] }[] }[] }).content
  assert.deepEqual(items[0]!.content[0]!.content, [
    { type: 'taskref', attrs: { id: 't1', projectId: 'p', number: 41, key: 'ACM', title: 'Call the printer' } },
  ])
  assert.deepEqual(items[1]!.content[0]!.content, [
    { type: 'text', text: 'Then ', marks: [{ type: 'bold' }] },
    { type: 'taskref', attrs: { id: 't2', projectId: 'p', number: 42, key: 'ACM', title: 'send the proofs' } },
    { type: 'text', text: ' today', marks: [{ type: 'bold' }] },
  ])
})

test('every reader of the body reads the task as its words', () => {
  const body = {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Next: ' }, chip('11111111-1111-4111-8111-111111111111', 'Ship it')] }],
  }
  // Markdown out.
  assert.equal(
    markdown(body, () => null, []),
    'Next: ACM-41 Ship it',
  )
  // A reader by link: the title, and nothing that says where it stands.
  assert.deepEqual(forStrangers(body), doc('Next: Ship it'))
  // Markdown in: the same words keep the chip; changed words are the caller's.
  assert.deepEqual(carryRich(body, doc('Next: ACM-41 Ship it')), body)
  assert.deepEqual(carryRich(body, doc('Next: Ship it')), body)
  assert.deepEqual(carryRich(body, doc('Next: ship something else')), doc('Next: ship something else'))
})

test('a task made from a line points back at the document, and search finds the line by its words', async () => {
  const { ctx: owner, workspaceId, token } = await makeOwner()
  const p = await makeProject(owner, workspaceId, 'Acme')
  const made = await call(token)('POST', `/api/projects/${p}/files`, { name: 'Notes', body: doc('Book the zeppelin hangar') })
  const { id: fileId } = (await made.json()) as { id: string }
  const t = await call(token)('POST', `/api/projects/${p}/tasks`, {
    title: 'Book the zeppelin hangar',
    body: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'From ' },
            { type: 'docref', attrs: { id: fileId, title: 'Notes' } },
          ],
        },
      ],
    },
  })
  assert.equal(t.status, 201)
  const task = (await t.json()) as { id: string; number: number }
  // Linked both ways, from the docref alone.
  const links = await asTableOwner()<{ from_type: string; to_type: string }[]>`
    select from_type, to_type from object_link where (from_id = ${task.id} and to_id = ${fileId}) or (from_id = ${fileId} and to_id = ${task.id})`
  assert.equal(links.length, 2)

  // The line becomes the chip; the document is still found by the line's words.
  const r = await call(token)('PATCH', `/api/files/${fileId}`, {
    body: { type: 'doc', content: [{ type: 'paragraph', content: [chip(task.id, 'Book the zeppelin hangar')] }] },
  })
  assert.equal(r.status, 200)
  const found = (await (await call(token)('GET', '/api/search?q=zeppelin&type=file')).json()) as { results: { id: string }[] }
  assert.ok(found.results.some((x) => x.id === fileId))
})

test('a line is made a task only by somebody who may make tasks there', async () => {
  const { ctx: owner, workspaceId } = await makeOwner()
  const p = await makeProject(owner, workspaceId, 'Acme')
  const kim = await addPerson(owner, workspaceId, 'member', [p], [])
  const kimToken = await bearerFor(kim.actorId, workspaceId)
  assert.equal((await call(kimToken)('POST', `/api/projects/${p}/tasks`, { title: 'Not mine to make' })).status, 403)
  const outsider = (await makeOwner()).token
  assert.ok([403, 404].includes((await call(outsider)('POST', `/api/projects/${p}/tasks`, { title: 'Nor mine' })).status))
})

test('a line of code is not a line of work', () => {
  const body = { type: 'doc', content: [{ type: 'codeBlock', content: [{ type: 'text', text: 'npm run build' }] }] }
  assert.equal(findLine(body, 'npm run build'), null)
  assert.equal(nameTask(body, 'npm run build', { id: 't', projectId: 'p', number: 1, key: null, title: 'npm run build' }), false)
})

test('lines joined by a hard break are two lines, and each becomes its own task', () => {
  const body = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'Call the printer' }, { type: 'hardBreak' }, { type: 'text', text: 'Send the proofs' }],
      },
    ],
  }
  // The two lines together are no line of the document: a task's title is one line.
  assert.equal(findLine(body, 'Call the printerSend the proofs'), null)
  assert.equal(findLine(body, 'Call the printer Send the proofs'), null)
  assert.deepEqual(splitLines(['Call the printer\nSend the proofs', '  ']), ['Call the printer', 'Send the proofs'])
  assert.ok(nameTask(body, 'Call the printer', { id: 't1', projectId: 'p', number: 1, key: 'ACM', title: 'Call the printer' }))
  assert.ok(nameTask(body, 'Send the proofs', { id: 't2', projectId: 'p', number: 2, key: 'ACM', title: 'Send the proofs' }))
  // Each line its own chip, the break between them kept.
  assert.deepEqual(
    (body.content[0] as { content: { type: string; attrs?: { id: string } }[] }).content.map((k) => k.attrs?.id ?? k.type),
    ['t1', 'hardBreak', 't2'],
  )
})

test('the whole line is the title, and only a line past a title’s limit is cut', () => {
  const line =
    'Send the proofs to the printer by Friday. They want the files in CMYK with bleed, and the cover goes to the binder separately on Monday.'
  assert.ok(line.length > 120 && line.length < TITLE_MOST)
  assert.equal(titleOf(line), line)
  assert.deepEqual(lineTitle('  Ship it  '), { title: 'Ship it', start: 2, end: 9, whole: true })
  // Past the limit: cut at a space, with an ellipsis, inside the limit.
  const run = 'word '.repeat(80).trim()
  const t = lineTitle(run)
  assert.equal(t.whole, false)
  assert.ok(t.title.endsWith('…'))
  assert.ok(t.title.length <= TITLE_MOST)

  // The whole line becomes the chip: nothing is left after it.
  const body = { type: 'doc', content: [para(line)] }
  assert.ok(nameTask(body, line, { id: 't', projectId: 'p', number: 3, key: 'ACM', title: titleOf(line) }))
  assert.deepEqual((body.content[0] as { content: unknown[] }).content, [
    { type: 'taskref', attrs: { id: 't', projectId: 'p', number: 3, key: 'ACM', title: line } },
  ])
})

/* ------------------------------------------- a line that carried more than words */

const THREAD = '0f8fad5b-d9cb-469f-a165-70867728950e'
const richLine = [
  { type: 'text', text: 'Read ' },
  { type: 'text', text: 'the brief', marks: [{ type: 'link', attrs: { href: 'https://example.com/brief' } }] },
  { type: 'text', text: ' with ' },
  { type: 'mention', attrs: { id: 'u1', label: 'Sam' } },
  { type: 'text', text: ' today', marks: [{ type: 'comment', attrs: { ids: THREAD } }] },
]

test('a line with a link, a mention and a thread is swallowed whole, and the chip keeps it', () => {
  const body = { type: 'doc', content: [{ type: 'paragraph', content: structuredClone(richLine) }] }
  const said = 'Read the brief with @Sam today'
  assert.deepEqual(lineAt(body, said), richLine)
  assert.ok(nameTask(body, said, { id: 't', projectId: 'p', number: 5, key: 'ACM', title: titleOf(said) }))
  const kids = (body.content[0] as { content: { type: string; attrs: Record<string, unknown> }[] }).content
  assert.equal(kids.length, 1)
  assert.equal(kids[0]!.type, 'taskref')
  assert.deepEqual(kids[0]!.attrs.line, richLine)
  assert.ok(lineSays(cleanLine(kids[0]!.attrs.line), said))
  // The thread is still on words: inside the chip.
  assert.ok(threadsIn(body).has(THREAD))
  // The description's copy keeps the link and the mention, not the document's thread.
  assert.deepEqual(lineForTask(richLine as never)[4], { type: 'text', text: ' today' })
})

test('a line is never trusted: only what a line can say, and only an address a link may have', () => {
  const dirty = [
    { type: 'text', text: 'Click ', marks: [{ type: 'bold' }, { type: 'textStyle', attrs: { color: 'red' } }] },
    { type: 'text', text: 'here', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] },
    { type: 'text', text: ' or ', marks: [{ type: 'comment', attrs: { ids: '<img onerror=x>' } }] },
    { type: 'image', attrs: { src: 'x' } },
    { type: 'mention', attrs: { id: 'u1', label: 'Sam', extra: 'x' } },
  ]
  assert.deepEqual(cleanLine(dirty), [
    { type: 'text', text: 'Click ', marks: [{ type: 'bold' }] },
    { type: 'text', text: 'here' },
    { type: 'text', text: ' or ' },
    { type: 'mention', attrs: { id: 'u1', label: 'Sam' } },
  ])
  // Plain words, nothing at all, or too much: no line — the chip is its title.
  assert.equal(cleanLine([{ type: 'text', text: 'Just words' }]), null)
  assert.equal(cleanLine('nope'), null)
  assert.equal(cleanLine([{ type: 'text', text: 'x'.repeat(3000), marks: [{ type: 'bold' }] }]), null)
  // Renamed elsewhere: the line no longer says the title.
  assert.equal(lineSays(cleanLine(richLine), 'Something else'), false)
})

test('the line goes through the shared state and back, cleaned, and every reader reads it', () => {
  const dirty = [...richLine, { type: 'text', text: '!', marks: [{ type: 'link', attrs: { href: 'javascript:x' } }] }]
  const title = 'Read the brief with @Sam today!'
  const body = {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'taskref', attrs: { id: 't', projectId: 'p', number: 5, key: 'ACM', title, line: dirty } }] },
    ],
  }
  const state = new Y.Doc()
  Y.applyUpdate(state, stateFrom(body))
  const back = bodyOf(state) as { type: 'doc'; content: { content: { attrs: { line: unknown } }[] }[] }
  assert.deepEqual(back.content[0]!.content[0]!.attrs.line, [...richLine, { type: 'text', text: '!' }])
  // A chip never finished goes back to its line, not just its title.
  const unfinished = {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'taskref', attrs: { title, line: richLine, making: 'x' } }] }],
  }
  const state2 = new Y.Doc()
  Y.applyUpdate(state2, stateFrom(unfinished))
  assert.deepEqual((bodyOf(state2).content[0] as { content: unknown[] }).content, richLine)
  // Markdown out: the line, links and all, after the handle.
  const md = markdown(back, () => null, [])
  assert.equal(md, 'ACM-5 Read [the brief](https://example.com/brief) with @Sam today!')
  // A stranger reads the line, links and mentions kept, threads taken out.
  const strangers = forStrangers(back) as { content: { content: unknown[] }[] }
  assert.deepEqual(strangers.content[0]!.content, [
    { type: 'text', text: 'Read ' },
    { type: 'text', text: 'the brief', marks: [{ type: 'link', attrs: { href: 'https://example.com/brief' } }] },
    { type: 'text', text: ' with ' },
    { type: 'mention', attrs: { id: 'u1', label: 'Sam' } },
    { type: 'text', text: ' today!' },
  ])
  // Renamed in the node: the title in words, everywhere.
  const renamed = structuredClone(back) as unknown as { content: { content: { attrs: { title: string } }[] }[] }
  renamed.content[0]!.content[0]!.attrs.title = 'Brief'
  assert.equal(
    markdown(renamed, () => null, []),
    'ACM-5 Brief',
  )
  // Sent back through Markdown, as words, the chip — and its line — is made again.
  const carried = carryRich(back, doc('ACM-5 Read the brief with @Sam today!')) as {
    content: { content: { type: string; attrs?: { line?: unknown } }[] }[]
  }
  assert.equal(carried.content[0]!.content[0]!.type, 'taskref')
  assert.ok(carried.content[0]!.content[0]!.attrs?.line)
})

/** A body written out as Markdown and read back, as an agent's `update_doc` that changed nothing. */
const throughMarkdown = (body: unknown) => fromMarkdown(markdown(body, () => null, []))
const only = (body: unknown) =>
  (body as { content: { content: { type: string; attrs?: Record<string, unknown> }[] }[] }).content[0]!.content

test('a chip whose line is past a title’s limit, or whose link has brackets, comes back from Markdown untouched', () => {
  // Past the limit, with any formatting: written whole, its title cut with "…".
  const long = `${'word '.repeat(70)}done`
  const line = [
    { type: 'text', text: long.slice(0, 20), marks: [{ type: 'bold' }] },
    { type: 'text', text: long.slice(20), marks: [{ type: 'comment', attrs: { ids: THREAD } }] },
  ]
  const title = lineTitle(long).title
  assert.ok(title.endsWith('…'))
  const body = {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'taskref', attrs: { id: 't', number: 4, key: 'W', title, line } }] }],
  }
  const back = only(carryRich(body, throughMarkdown(body)))
  assert.equal(back.length, 1)
  assert.equal(back[0]!.type, 'taskref')
  assert.deepEqual(back[0]!.attrs!.line, line)

  // A link whose address has brackets, not at the end of the line.
  const wiki = 'https://en.wikipedia.org/wiki/Foo_(bar)'
  const linked = [
    { type: 'text', text: 'Read ' },
    { type: 'text', text: 'the wiki', marks: [{ type: 'link', attrs: { href: wiki } }] },
    { type: 'text', text: ' first' },
  ]
  const body2 = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'taskref', attrs: { id: 't2', number: 5, key: 'W', title: 'Read the wiki first', line: linked } }],
      },
    ],
  }
  assert.match(
    markdown(body2, () => null, []),
    /Foo_%28bar%29\) first$/,
  )
  const back2 = only(carryRich(body2, throughMarkdown(body2)))
  assert.equal(back2.length, 1)
  assert.deepEqual(back2[0]!.attrs!.line, linked)
})

test('a chip reworded through Markdown is words again, and its thread stays on its words', () => {
  const line = [
    { type: 'text', text: 'Fix the ' },
    {
      type: 'text',
      text: 'login bug',
      marks: [
        { type: 'link', attrs: { href: 'https://example.com/bug' } },
        { type: 'comment', attrs: { ids: THREAD } },
      ],
    },
    { type: 'text', text: ' today' },
  ]
  const body = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'taskref', attrs: { id: 't', number: 6, key: 'W', title: 'Fix the login bug today', line } }],
      },
    ],
  }
  const theirs = fromMarkdown(markdown(body, () => null, []).replace('today', 'tomorrow'))
  const back = carryRich(body, theirs)
  assert.ok(threadsIn(back).has(THREAD))
  const kids = only(back) as { type: string; text?: string; marks?: { type: string }[] }[]
  assert.ok(kids.every((k) => k.type === 'text'))
  const marked = kids.find((k) => k.marks?.some((m) => m.type === 'comment'))
  assert.equal(marked?.text, 'login bug')
})

test('through MCP, a line too large for a chip keeps its words and links, the chip in front', () => {
  const pieces = Array.from({ length: 201 }, (_, i) =>
    i % 2
      ? { type: 'text', text: `w${i} `, marks: [{ type: 'link', attrs: { href: `https://example.com/${i}` } }] }
      : { type: 'text', text: `w${i} ` },
  )
  const body = { type: 'doc', content: [{ type: 'paragraph', content: structuredClone(pieces) }] }
  const said = pieces.map((p) => p.text).join('')
  assert.equal(lineAt(body, said), null)
  assert.ok(nameTask(body, said, { id: 't', projectId: 'p', number: 7, key: 'W', title: titleOf(said) }))
  const kids = only(body)
  assert.equal(kids[0]!.type, 'taskref')
  assert.equal(kids[0]!.attrs!.line, undefined)
  assert.equal(kids.filter((k) => k.type === 'text').length, 202)

  // A line naming a document is swallowed with it, and the chip draws its line.
  const withDoc = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'See ' },
          { type: 'docref', attrs: { id: 'd', title: 'Specs' } },
          { type: 'text', text: ' and ' },
          { type: 'text', text: 'this', marks: [{ type: 'link', attrs: { href: 'https://example.com' } }] },
        ],
      },
    ],
  }
  const words = 'See Specs and this'
  assert.ok(nameTask(withDoc, words, { id: 't3', projectId: 'p', number: 8, key: 'W', title: titleOf(words) }))
  assert.ok(lineSays(cleanLine(only(withDoc)[0]!.attrs!.line), titleOf(words)))
})

test('every body written is stored with its chips’ lines cleaned', async () => {
  const { ctx: owner, workspaceId, token } = await makeOwner()
  const p = await makeProject(owner, workspaceId, 'Acme')
  const dirty = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          {
            type: 'taskref',
            attrs: {
              id: '00000000-0000-4000-8000-000000000001',
              number: 1,
              title: 'Call now',
              line: [
                { type: 'text', text: 'Call ', marks: [{ type: 'bold' }] },
                { type: 'text', text: 'now', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] },
              ],
            },
          },
        ],
      },
    ],
  }
  const clean = [
    { type: 'text', text: 'Call ', marks: [{ type: 'bold' }] },
    { type: 'text', text: 'now' },
  ]
  const lineOf = (b: unknown) => JSON.parse(JSON.stringify(b)).content[0].content[0].attrs.line
  // A document, made and then written.
  const made = await call(token)('POST', `/api/projects/${p}/files`, { name: 'Notes', body: dirty })
  const { id: fileId } = (await made.json()) as { id: string }
  const read = async () => ((await (await call(token)('GET', `/api/files/${fileId}`)).json()) as { file: { body: unknown } }).file.body
  assert.deepEqual(lineOf(await read()), clean)
  assert.equal((await call(token)('PATCH', `/api/files/${fileId}`, { body: dirty })).status, 200)
  assert.ok(!JSON.stringify(await read()).includes('javascript:'))
  // A task's description.
  const t = await call(token)('POST', `/api/projects/${p}/tasks`, { title: 'Holder', body: dirty })
  const { id: taskId } = (await t.json()) as { id: string }
  const task = await (await call(token)('GET', `/api/tasks/${taskId}`)).json()
  assert.ok(!JSON.stringify(task).includes('javascript:'))
})
