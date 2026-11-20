import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { app } from '../src/http/routes.js'
import { Busy, createPool, plainDoc, readMarkdown, readMarkdownOrPlain, setMarkdownPool, TooComplex } from '../src/mcp/markdownPool.js'
import { corpus } from './markdown-corpus.js'
import { addPerson, asTableOwner, closeDb, makeOwner, makeProject, withActor } from './helpers.js'

/**
 * Somebody else's Markdown, read off the main thread with a hard timeout.
 * Every slow body the parser had was
 * fixed after it held the server's one thread; these stand in for the next
 * one with a worker that never finishes (`markdown-hostile-worker.ts`).
 */

const HOSTILE = new URL('./markdown-hostile-worker.ts', import.meta.url)
after(async () => {
  await setMarkdownPool(null)
  await closeDb()
})

test('ordinary bodies read by the workers exactly as on the main thread', async () => {
  const before = JSON.parse(readFileSync(new URL('./markdown-regression.json', import.meta.url), 'utf8')) as Record<string, unknown>
  const names = Object.keys(corpus)
  const docs = await Promise.all(names.map((name) => readMarkdown(corpus[name]!)))
  names.forEach((name, k) => assert.deepEqual(docs[k], before[name], name))
})

/* Refused after its half second and not before — a timer cannot fire
   early. That it is not much later, and that two on two workers are
   refused together, is timed in `bench/workers.bench.ts`. */
test('a body that never finishes is refused in half a second, and its worker replaced', async () => {
  const pool = createPool({ file: HOSTILE, size: 2 })
  try {
    await Promise.all([pool.read('warm'), pool.read('warm')])
    const started = performance.now()
    await assert.rejects(pool.read('spin'), TooComplex)
    const took = performance.now() - started
    assert.ok(took >= 450, `${Math.round(took)} ms`)
    // Two at once on two workers: both refused.
    const results = await Promise.allSettled([pool.read('spin'), pool.read('spin')])
    assert.ok(results.every((r) => r.status === 'rejected' && r.reason instanceof TooComplex))
    // And the workers that took their places read as before.
    assert.deepEqual(await pool.read('# after'), {
      type: 'doc',
      content: [{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'after' }] }],
    })
  } finally {
    await pool.close()
  }
})

test('a body that eats memory ends its worker, not the server', async () => {
  const pool = createPool({ file: HOSTILE, size: 1, timeoutMs: 10_000 })
  try {
    await assert.rejects(pool.read('hog'), TooComplex)
    assert.equal((await pool.read('words')).type, 'doc')
  } finally {
    await pool.close()
  }
})

test('a worker that cannot start fails what waits as an error of ours, not as the text', async () => {
  const pool = createPool({ file: new URL('./no-such-worker.ts', import.meta.url), size: 2, retryMs: 10 })
  try {
    const e = await pool.read('x').catch((e: unknown) => e)
    assert.ok(e instanceof Error && !(e instanceof TooComplex) && !(e instanceof Busy), String(e))
  } finally {
    await pool.close()
  }
})

/* Three failed starts were once the pool's end, refusing for good even
   after the cause had gone. Now it tries again, later each time, and is
   back as soon as one starts. */
test('workers that would not start are tried again, and the pool comes back', async () => {
  const counter = join(mkdtempSync(join(tmpdir(), 'flaky-')), 'tries')
  writeFileSync(counter, '0')
  process.env.MARKDOWN_FLAKY = counter
  const pool = createPool({ file: new URL('./markdown-flaky-worker.ts', import.meta.url), size: 1, retryMs: 20 })
  try {
    const first = await pool.read('x').catch((e: unknown) => e)
    assert.ok(first instanceof Error && !(first instanceof TooComplex), String(first))
    let doc: unknown = null
    for (let k = 0; k < 40 && !doc; k++) {
      await new Promise((ok) => setTimeout(ok, 50))
      doc = await pool.read('back').catch(() => null)
    }
    assert.deepEqual(doc, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'back' }] }] })
  } finally {
    await pool.close()
  }
})

/* How soon is `bench/workers.bench.ts`. */
test('a worker that never says it is ready is given up on, and what waits is refused', async () => {
  const pool = createPool({ file: new URL('./markdown-silent-worker.ts', import.meta.url), size: 1, startMs: 300, retryMs: 10 })
  try {
    const e = await pool.read('x').catch((e: unknown) => e)
    assert.ok(e instanceof Error && !(e instanceof TooComplex) && !(e instanceof Busy), String(e))
  } finally {
    await pool.close()
  }
})

test('a worker that says it is ready and dies is started again after a wait, not in a loop', async () => {
  const counter = join(mkdtempSync(join(tmpdir(), 'dying-')), 'starts')
  writeFileSync(counter, '')
  process.env.MARKDOWN_DYING = counter
  const pool = createPool({ file: new URL('./markdown-dying-worker.ts', import.meta.url), size: 1, retryMs: 1_000 })
  try {
    void pool.read('x').catch(() => {})
    await new Promise((ok) => setTimeout(ok, 2_000))
    const starts = readFileSync(counter, 'utf8').length
    assert.ok(starts >= 1 && starts <= 2, `${starts} starts in two seconds`)
  } finally {
    await pool.close()
  }
})

/* `new Worker` throws where it is called for some files; called from a
   worker's exit handler, that was an uncaught exception. */
test('a worker that cannot even be made is refused, and the process goes on', async () => {
  const pool = createPool({ file: new URL('https://example.invalid/worker.js'), size: 2, retryMs: 10 })
  try {
    const e = await pool.read('x').catch((e: unknown) => e)
    assert.ok(e instanceof Error && !(e instanceof TooComplex), String(e))
  } finally {
    await pool.close()
  }
})

test('a full queue, a long wait and a caller with too much in hand are told to come back', async () => {
  const pool = createPool({ file: HOSTILE, size: 1, maxQueue: 2, queueWaitMs: 1000, timeoutMs: 2000, perCaller: 2 })
  try {
    await pool.read('warm')
    const running = pool.read('spin').catch((e: unknown) => e)
    const waiting = [pool.read('a').catch((e: unknown) => e), pool.read('b').catch((e: unknown) => e)]
    // The queue holds two: the third is refused at once.
    await assert.rejects(pool.read('c'), Busy)
    // The two waited their second behind the spin and were never read.
    for (const w of await Promise.all(waiting)) assert.ok(w instanceof Busy, String(w))
    assert.ok((await running) instanceof TooComplex)
    // One caller has two in hand at most, once the spin's worker is replaced.
    await pool.read('replaced')
    const mine = [pool.read('slow', 'me'), pool.read('slow', 'me')]
    await assert.rejects(pool.read('x', 'me'), Busy)
    assert.equal((await Promise.all(mine)).length, 2)
    assert.equal((await pool.read('x', 'me')).type, 'doc')
  } finally {
    await pool.close()
  }
})

test('a parser that throws, or a worker that ends, is an error of ours, not a text too complex', async () => {
  const pool = createPool({ file: HOSTILE, size: 1 })
  try {
    const thrown = await pool.read('throw').catch((e: unknown) => e)
    assert.ok(thrown instanceof Error && !(thrown instanceof TooComplex) && /boom/.test(thrown.message), String(thrown))
    const ended = await pool.read('exit').catch((e: unknown) => e)
    assert.ok(ended instanceof Error && !(ended instanceof TooComplex), String(ended))
    assert.equal((await pool.read('after')).type, 'doc')
  } finally {
    await pool.close()
  }
  // Nor is it hidden as plain words where nobody is waiting.
  await setMarkdownPool(createPool({ file: HOSTILE, size: 1 }))
  await assert.rejects(readMarkdownOrPlain('throw'), /boom/)
  assert.equal(((await readMarkdownOrPlain('spin')).content?.[0]?.content?.[0] as { text?: string }).text, 'spin')
  await setMarkdownPool(null)
})

test('a plain document is the paragraphs as they were', () => {
  assert.deepEqual(plainDoc('# a\n*b*\n\n\n[c](d)'), {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: '# a *b*' }] },
      { type: 'paragraph', content: [{ type: 'text', text: '[c](d)' }] },
    ],
  })
  assert.deepEqual(plainDoc(' \n '), { type: 'doc', content: [{ type: 'paragraph' }] })
})

/* The whole of it, through a request: a page of rows that never finish is
   refused 422, nothing is written, and the server goes on answering
   everybody else meanwhile. That it is refused within about a second and
   nobody else waits is timed in `bench/workers.bench.ts`. */
test('a hostile page is refused while other requests keep answering', async () => {
  await setMarkdownPool(createPool({ file: HOSTILE, size: 2 }))
  const me = await makeOwner()
  const p = await makeProject(me.ctx, me.workspaceId, 'Hostile')
  const send = (tasks: unknown[], french = false) =>
    app.request(`/api/projects/${p}/import/tasks`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${me.token}`,
        'content-type': 'application/json',
        ...(french ? { 'x-tongue': 'fr' } : {}),
      },
      body: JSON.stringify({ tasks }),
    })
  // The workers started, as the server starts them when it listens.
  assert.equal((await send([{ title: 'Warm', body: 'Started.' }])).status, 200)

  let done = false
  const latencies: number[] = []
  const unrelated = (async () => {
    while (!done) {
      const t = performance.now()
      const r = await app.request('/health')
      await r.arrayBuffer()
      latencies.push(performance.now() - t)
      await new Promise((ok) => setTimeout(ok, 20))
    }
  })()
  const r = await send(Array.from({ length: 200 }, (_, k) => ({ title: `Row ${k}`, body: 'spin' })))
  done = true
  await unrelated

  assert.equal(r.status, 422)
  assert.deepEqual(await r.json(), {
    error: { code: 'too_complex', message: 'This text is too complex to read. Simplify it and try again.' },
  })
  assert.ok(latencies.length >= 5, `${latencies.length} answers meanwhile`)

  const fr = await send([{ title: 'x', body: 'spin' }], true)
  assert.equal(fr.status, 422)
  assert.equal(
    ((await fr.json()) as { error: { message: string } }).error.message,
    'Ce texte est trop complexe à lire. Simplifiez-le et réessayez.',
  )
  // Nothing of the refused pages was written; the warm-up row was.
  const rows = await withActor(me.ctx.actorId, (tx) => tx<{ title: string }[]>`select title from task where project_id = ${p}`)
  assert.deepEqual(
    rows.map((t) => t.title),
    ['Warm'],
  )
})

test('a request the workers have no room for is answered 503 busy, and writes nothing', async () => {
  await setMarkdownPool(createPool({ file: HOSTILE, size: 1, maxQueue: 0 }))
  const me = await makeOwner()
  const p = await makeProject(me.ctx, me.workspaceId, 'Busy')
  const r = await app.request(`/api/projects/${p}/import/tasks`, {
    method: 'POST',
    headers: { authorization: `Bearer ${me.token}`, 'content-type': 'application/json', 'x-tongue': 'fr' },
    body: JSON.stringify({ tasks: [{ title: 'x', body: 'words' }] }),
  })
  assert.equal(r.status, 503)
  assert.deepEqual(await r.json(), {
    error: { code: 'busy', message: 'Trop de textes sont en cours de lecture. Réessayez dans un instant.' },
  })
  const rows = await withActor(me.ctx.actorId, (tx) => tx<{ n: number }[]>`select count(*)::int as n from task where project_id = ${p}`)
  assert.equal(rows[0]!.n, 0)
  await setMarkdownPool(null)
})

/* The bodies are read with nothing held, so who the rows name is asked
   again when the page is written: somebody taken off the project in
   between is not given a task. */
test('somebody taken off the project while the bodies are read is assigned nothing', async () => {
  await setMarkdownPool(createPool({ file: HOSTILE, size: 1 }))
  const me = await makeOwner()
  const p = await makeProject(me.ctx, me.workspaceId, 'Between')
  const them = await addPerson(me.ctx, me.workspaceId, 'member', [p])
  const name = `Gone ${them.actorId}`
  await asTableOwner()`update actor set name = ${name} where id = ${them.actorId}`
  // Started, so the 200 ms below are the bodies being read, not workers starting.
  await readMarkdown('warm')
  const sending = app.request(`/api/projects/${p}/import/tasks`, {
    method: 'POST',
    headers: { authorization: `Bearer ${me.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ tasks: [1, 2].map((k) => ({ title: `Row ${k}`, body: 'slow', assignee: name })) }),
  })
  await new Promise((ok) => setTimeout(ok, 200))
  await asTableOwner()`update project_member set deleted_at = now() where project_id = ${p} and actor_id = ${them.actorId}`
  const r = await sending
  assert.equal(r.status, 200)
  const rows = await withActor(
    me.ctx.actorId,
    (tx) => tx<{ assignee_ids: string[] }[]>`select assignee_ids from task where project_id = ${p}`,
  )
  assert.equal(rows.length, 2)
  for (const row of rows) assert.deepEqual(row.assignee_ids, [])
  await setMarkdownPool(null)
})
