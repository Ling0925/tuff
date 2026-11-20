import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { pathShape } from '../src/watchdog.js'

/*
 * The watchdog. Each case is a process of its
 * own that stalls its loop on purpose; this one only reads what it said
 * and how it ended.
 */

const CHILD = fileURLToPath(new URL('./watchdog-child.ts', import.meta.url))

type Ended = { code: number | null; signal: NodeJS.Signals | null; out: string; err: string; ms: number }

function run(env: Record<string, string>): Promise<Ended> {
  const started = performance.now()
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--import', 'tsx', CHILD], {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      env: { ...process.env, NODE_TEST_CONTEXT: '', WATCHDOG: '1', ...env },
    })
    let out = ''
    let err = ''
    child.stdout.on('data', (d) => {
      out += d
    })
    child.stderr.on('data', (d) => {
      err += d
    })
    child.on('exit', (code, signal) => resolve({ code, signal, out, err, ms: Math.round(performance.now() - started) }))
  })
}

const stalls = (s: string) => s.split('\n').filter((l) => /^watchdog: child event loop stalled \d+ms/.test(l))

test('a loop held past the log line is said once, with the route in flight and nothing else of the request', async () => {
  const r = await run({ CHILD: 'stall', HOLD_MS: '1500', WATCHDOG_LOG_MS: '300', WATCHDOG_EXIT_MS: '10000' })
  assert.equal(r.code, 0, r.err)
  assert.match(r.out, /child: done/)
  const lines = stalls(r.err)
  assert.equal(lines.length, 1, r.err)
  assert.match(lines[0]!, /in flight: POST \/api\/projects\/:\/tasks \(\d+ms\)$/)
  assert.match(r.err, /watchdog: child event loop resumed after \d+ms/)
  assert.doesNotMatch(r.err, /hunter2|0b6f4f2e|somebody/)
})

test('a loop held past the exit line is killed, having said so', async () => {
  const r = await run({ CHILD: 'hang', WATCHDOG_LOG_MS: '200', WATCHDOG_EXIT_MS: '1000' })
  assert.equal(r.signal, 'SIGKILL', r.err)
  assert.doesNotMatch(r.out, /child: done/)
  /* The stall once, then the exit. */
  assert.equal(stalls(r.err).length, 2, r.err)
  assert.match(r.err, /past 1000ms — exiting so it is restarted — in flight: POST \/api\/projects\/:\/tasks/)
  /* Well before anything else would have given up on it: `bench/workers.bench.ts`. */
})

test('short pauses, like a collection, say nothing', async () => {
  const r = await run({ CHILD: 'hiccups', HOLD_MS: '150', WATCHDOG_LOG_MS: '500', WATCHDOG_EXIT_MS: '2000' })
  assert.equal(r.code, 0, r.err)
  assert.doesNotMatch(r.err, /watchdog: child event loop/)
})

test('off under the test runner unless asked', async () => {
  const r = await run({ CHILD: 'stall', HOLD_MS: '10', WATCHDOG: '', NODE_TEST_CONTEXT: 'child' })
  assert.notEqual(r.code, 0)
  assert.match(r.err, /the watchdog did not start/)
})

test('a path is logged by its shape: words and numbers, never ids, tokens or the query', () => {
  assert.equal(pathShape('/api/projects/0b6f4f2e-5f5a-4d1e-9a51-0c0ffee00001/tasks/41'), '/api/projects/:/tasks/41')
  assert.equal(pathShape('/f/website/confirm/abcDEF123_xyz'), '/f/website/confirm/:')
  assert.equal(pathShape('/api/me'), '/api/me')
  assert.equal(pathShape('/f/website/confirm/aVeryLongTokenWithoutAnyDigitsAtAll'), '/f/website/confirm/:')
})
