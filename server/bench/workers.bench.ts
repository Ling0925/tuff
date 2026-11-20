import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { app } from '../src/http/routes.js'
import { createPool, setMarkdownPool, TooComplex } from '../src/mcp/markdownPool.js'
import { closeDb, makeOwner, makeProject } from '../test/helpers.js'
import { tookAsync } from './time.js'

/*
 * How soon what holds a thread is let go — the time budgets of
 * `markdown-pool.test.ts` and `watchdog.test.ts`, out of `pnpm check`.
 * The tests keep what happens: refused, replaced, killed, the
 * server answering meanwhile. How long it took is a fact about a quiet
 * machine, and is held here.
 */

const HOSTILE = new URL('../test/markdown-hostile-worker.ts', import.meta.url)
after(async () => {
  await setMarkdownPool(null)
  await closeDb()
})

test('a body that never finishes is refused in half a second; two on two workers together', async () => {
  const pool = createPool({ file: HOSTILE, size: 2 })
  /* Both workers up: two thirds of a second's work done side by side. A
     worker starting under tsx takes a second or two on a loaded machine,
     and that is not what is measured here. */
  const bothUp = async () => {
    for (let k = 0; k < 40; k++) {
      if ((await tookAsync(() => Promise.all([pool.read('slow'), pool.read('slow')]))) < 550) return
    }
    assert.fail('the workers never came up together')
  }
  try {
    await bothUp()
    const one = await tookAsync(() => assert.rejects(pool.read('spin'), TooComplex))
    assert.ok(one >= 450 && one < 1000, `${Math.round(one)} ms`)
    await bothUp()
    // Together, not one after the other.
    const both = await tookAsync(() => Promise.allSettled([pool.read('spin'), pool.read('spin')]))
    assert.ok(both < 1500, `${Math.round(both)} ms`)
  } finally {
    await pool.close()
  }
})

test('a worker that never says it is ready is given up on within seconds', async () => {
  const pool = createPool({ file: new URL('../test/markdown-silent-worker.ts', import.meta.url), size: 1, startMs: 300, retryMs: 10 })
  try {
    const ms = await tookAsync(() => pool.read('x').catch(() => {}))
    assert.ok(ms < 5_000, `${Math.round(ms)} ms`)
  } finally {
    await pool.close()
  }
})

test('a hostile page is refused within about a second, and nobody else waits', async (t) => {
  await setMarkdownPool(createPool({ file: HOSTILE, size: 2 }))
  const me = await makeOwner()
  const p = await makeProject(me.ctx, me.workspaceId, 'Hostile')
  const send = (tasks: unknown[]) =>
    app.request(`/api/projects/${p}/import/tasks`, {
      method: 'POST',
      headers: { authorization: `Bearer ${me.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ tasks }),
    })
  assert.equal((await send([{ title: 'Warm', body: 'Started.' }])).status, 200)

  let done = false
  const latencies: number[] = []
  const unrelated = (async () => {
    while (!done) {
      latencies.push(await tookAsync(async () => (await app.request('/health')).arrayBuffer()))
      await new Promise((ok) => setTimeout(ok, 20))
    }
  })()
  let status = 0
  const ms = await tookAsync(async () => {
    status = (await send(Array.from({ length: 200 }, (_, k) => ({ title: `Row ${k}`, body: 'spin' })))).status
  })
  done = true
  await unrelated
  assert.equal(status, 422)
  const worst = Math.max(...latencies)
  t.diagnostic(`refused after ${Math.round(ms)} ms; ${latencies.length} unrelated answers meanwhile, the slowest ${Math.round(worst)} ms`)
  assert.ok(ms < 1500, `refused after ${Math.round(ms)} ms`)
  assert.ok(worst < 200, `the slowest unrelated answer took ${Math.round(worst)} ms`)
})

test('a loop held past the exit line is killed well before anything else gives up on it', async () => {
  const child = fileURLToPath(new URL('../test/watchdog-child.ts', import.meta.url))
  let signal: NodeJS.Signals | null = null
  const ms = await tookAsync(
    () =>
      new Promise((resolve) => {
        const c = spawn(process.execPath, ['--import', 'tsx', child], {
          cwd: fileURLToPath(new URL('..', import.meta.url)),
          env: { ...process.env, NODE_TEST_CONTEXT: '', WATCHDOG: '1', CHILD: 'hang', WATCHDOG_LOG_MS: '200', WATCHDOG_EXIT_MS: '1000' },
          stdio: 'ignore',
        })
        c.on('exit', (_code, s) => resolve((signal = s)))
      }),
  )
  assert.equal(signal, 'SIGKILL')
  assert.ok(ms < 8_000, `took ${Math.round(ms)}ms`)
})
