/**
 * The watchdog's other half, on a thread of its own.
 *
 * It sees the main thread only through shared memory: a counter the main
 * thread moves on every turn of its loop, and the list of what it is in the
 * middle of. While the counter stands still the main thread is stalled, and
 * this thread is the only code in the process still running.
 *
 * Everything it says goes straight to the file descriptor. `console` in a
 * worker is handed to the main thread to print, which is the thread that is
 * not printing anything; a line written that way would come out after the
 * stall, or never.
 */

import { writeSync } from 'node:fs'
import { parentPort, workerData } from 'node:worker_threads'
import type { Shared } from './watchdog.js'

const { beat, seq, bytes, length, name, logMs, exitMs, tickMs } = workerData as Shared & {
  name: string
  logMs: number
  exitMs: number
  tickMs: number
}

const say = (line: string) => {
  try {
    writeSync(2, `${line}\n`)
  } catch {
    /* Nowhere to say it: the exit below still happens. */
  }
}

/* What the main thread said it was doing, read only while it is not
   writing — it is stalled, so in practice the first read is good. */
const doing = (): string => {
  const counter = new Int32Array(seq)
  for (let tries = 0; tries < 4; tries++) {
    const before = Atomics.load(counter, 0)
    if (before % 2 === 1) continue
    const len = Atomics.load(new Int32Array(length), 0)
    const text = Buffer.from(bytes).toString('utf8', 0, len)
    if (Atomics.load(counter, 0) !== before) continue
    if (!text) return 'nothing'
    const now = Date.now()
    return text
      .split('\n')
      .map((line) => {
        const gap = line.indexOf(' ')
        return `${line.slice(gap + 1)} (${now - Number(line.slice(0, gap))}ms)`
      })
      .join(', ')
  }
  return 'unknown'
}

const beats = new Int32Array(beat)
let seen = Atomics.load(beats, 0)
let since = performance.now()
/* What was in flight when the stall was said, for the line after it. */
let logged: string | null = null

setInterval(() => {
  const now = Atomics.load(beats, 0)
  const at = performance.now()
  if (now !== seen) {
    /* Said by the main thread, through `console.error`, so it reaches
       where errors are told (`cloud/report.ts`); the stall itself could not. */
    if (logged !== null) parentPort?.postMessage({ ms: Math.round(at - since), doing: logged })
    seen = now
    since = at
    logged = null
    return
  }
  const stalled = Math.round(at - since)
  if (stalled >= logMs && logged === null) {
    logged = doing()
    say(`watchdog: ${name} event loop stalled ${stalled}ms — in flight: ${logged}`)
  }
  if (stalled >= exitMs) {
    say(`watchdog: ${name} event loop stalled ${stalled}ms, past ${exitMs}ms — exiting so it is restarted — in flight: ${doing()}`)
    /* `process.exit` here would end this thread and leave the process
       stalled; a signal the main thread would have to handle is never
       handled. SIGKILL is the one thing a stuck loop cannot ignore. */
    process.kill(process.pid, 'SIGKILL')
  }
}, tickMs)
