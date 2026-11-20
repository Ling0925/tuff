/**
 * A process for `watchdog.test.ts` to stall: started with the watchdog on
 * and small lines, it holds its own loop as `CHILD` says, inside a request
 * to a Hono app carrying the watchdog's middleware.
 *
 * - `stall` — one request holds the loop for `HOLD_MS`, then it ends cleanly.
 * - `hiccups` — ten pauses of `HOLD_MS` with the loop free between them.
 * - `hang` — one request holds the loop for ever.
 */

import { Hono } from 'hono'
import { startWatchdog, watching } from '../src/watchdog.js'

const hold = (ms: number) => {
  const until = performance.now() + ms
  while (performance.now() < until) {
    /* A body that will not finish parsing. */
  }
}

if (!startWatchdog('child')) throw new Error('the watchdog did not start')
const ms = Number(process.env.HOLD_MS ?? 0)
const mode = process.env.CHILD

const app = new Hono()
app.use('*', watching)
app.post('/api/projects/:id/tasks', (c) => {
  hold(mode === 'hang' ? Number.POSITIVE_INFINITY : ms)
  return c.json({ ok: true })
})

/* A beat or two first, so the watcher is running before anything stalls. */
await new Promise((r) => setTimeout(r, 300))
if (mode === 'hiccups') {
  for (let i = 0; i < 10; i++) {
    hold(ms)
    await new Promise((r) => setTimeout(r, 100))
  }
} else {
  await app.request('/api/projects/0b6f4f2e-5f5a-4d1e-9a51-0c0ffee00001/tasks?token=hunter2secret', {
    method: 'POST',
    body: 'the words of somebody',
  })
}
/* Room for the watcher to say the loop came back. */
await new Promise((r) => setTimeout(r, 300))
console.log('child: done')
