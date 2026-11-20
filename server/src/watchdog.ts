/**
 * A net under the event loop.
 *
 * Production is one process per service, and one thread in it answers
 * everybody: a body that took two minutes to parse took the site down for
 * two minutes. Markdown is read off that thread now;
 * this is for whatever is next.
 *
 * The main thread moves a counter in shared memory a few times a second and
 * writes there what it is in the middle of. A thread of its own watches the
 * counter: still for two seconds, it says so once, with what was in flight;
 * still for thirty, it kills the process so Railway starts another. A timer
 * on the main thread could do neither — it is the thing that is not running.
 */

import inspector from 'node:inspector'
import { Worker } from 'node:worker_threads'
import type { MiddlewareHandler } from 'hono'
import { wholeFromEnv } from './env.js'

/** What the two threads share. */
export type Shared = {
  /** The main thread's heartbeat, one Int32 that only ever moves. */
  beat: SharedArrayBuffer
  /** Odd while `bytes` is being written, even when it may be read. */
  seq: SharedArrayBuffer
  /** How many of `bytes` are meant. */
  length: SharedArrayBuffer
  /** What is in flight, one `<started ms> <label>` a line. */
  bytes: SharedArrayBuffer
}

/* Under tsx this file is `.ts` and so is the thread's; compiled, both are
   `.js` in `dist`. A worker inherits the parent's `execArgv` — tsx's loader
   in one, `--conditions=compiled` in the other. As `markdownPool.ts`. */
const THREAD = new URL(`./watchdogThread.${import.meta.url.endsWith('.ts') ? 'ts' : 'js'}`, import.meta.url)

/* Enough for a few dozen labels; the rest are left out rather than grown
   into — the first ones in are the oldest, and the oldest is the suspect. */
const BYTES = 2048

let shared: (Shared & { view: Buffer; seqs: Int32Array; len: Int32Array }) | null = null
const inFlight = new Map<number, string>()
let next = 0

/* Written on every change rather than on the heartbeat: the request that
   stalls the loop started after the last beat, and never reaches the next. */
function write() {
  if (!shared) return
  let text = ''
  for (const line of inFlight.values()) {
    if (text.length + line.length + 1 > BYTES) break
    text += text ? `\n${line}` : line
  }
  Atomics.add(shared.seqs, 0, 1)
  const n = shared.view.write(text, 0, 'utf8')
  Atomics.store(shared.len, 0, n)
  Atomics.add(shared.seqs, 0, 1)
}

/**
 * Says the main thread has started on something; the function it returns
 * says it is done. A label is a method and a shape of path, or a job's
 * name — never a body, a query string or anybody's words. Nothing is kept
 * while the watchdog is off.
 */
export function begin(label: string): () => void {
  if (!shared) return () => {}
  const id = next++
  inFlight.set(id, `${Date.now()} ${label}`)
  write()
  return () => {
    inFlight.delete(id)
    write()
  }
}

/*
 * A path as the log may show it: words and numbers stay, anything else in
 * a segment — an id, a token in `/f/…/confirm/…`, a name — is `:`. The
 * query string is never read.
 */
export function pathShape(path: string): string {
  return path
    .split('/')
    .map((s) => (s === '' || /^\d{1,9}$/.test(s) || (s.length <= 24 && /^[a-z][a-z_-]*$/i.test(s)) ? s : ':'))
    .join('/')
}

/** Every request, in flight from its first middleware to its answer. */
export const watching: MiddlewareHandler = async (c, nextHandler) => {
  if (!shared) return nextHandler()
  const done = begin(`${c.req.method} ${pathShape(c.req.path)}`)
  try {
    await nextHandler()
  } finally {
    done()
  }
}

export type WatchdogOptions = {
  /** Still this long: one line in the log. */
  logMs?: number
  /** Still this long: the process is killed. */
  exitMs?: number
}

/**
 * Starts the watchdog for this process, named in its lines (`server`,
 * `worker`). On by default; off with `WATCHDOG=0`, under the test runner
 * unless `WATCHDOG=1`, and while a debugger is attached — a breakpoint is
 * a stalled loop. `WATCHDOG_LOG_MS` and `WATCHDOG_EXIT_MS` move the lines.
 */
export function startWatchdog(name: string, options: WatchdogOptions = {}): boolean {
  if (shared) return true
  const said = (process.env.WATCHDOG ?? '').trim().toLowerCase()
  if (said === '0' || said === 'off' || said === 'false') return false
  if (said !== '1' && said !== 'on' && said !== 'true') {
    if (process.env.NODE_TEST_CONTEXT || inspector.url()) return false
  }
  const logMs = options.logMs ?? wholeFromEnv(process.env.WATCHDOG_LOG_MS, 2_000, 50)
  const exitMs = Math.max(logMs, options.exitMs ?? wholeFromEnv(process.env.WATCHDOG_EXIT_MS, 30_000, 50))
  /* A tenth of the shorter line, so a stall is seen within ten per cent
     of when it crossed it; never busier than every 25 ms. */
  const tickMs = Math.max(25, Math.min(250, Math.floor(logMs / 10)))

  const s: Shared = {
    beat: new SharedArrayBuffer(4),
    seq: new SharedArrayBuffer(4),
    length: new SharedArrayBuffer(4),
    bytes: new SharedArrayBuffer(BYTES),
  }
  const beats = new Int32Array(s.beat)
  setInterval(() => Atomics.add(beats, 0, 1), tickMs).unref()

  const thread = new Worker(THREAD, { workerData: { ...s, name, logMs, exitMs, tickMs } })
  thread.on('error', (e) => console.error(`watchdog: ${name} could not watch:`, e))
  thread.on('message', (m: { ms: number; doing: string }) =>
    console.error(`watchdog: ${name} event loop resumed after ${m.ms}ms — was in flight: ${m.doing}`),
  )
  /* Never what keeps the process alive: a script that is done ends. After
     the listeners, since adding one refs the thread again. */
  thread.unref()
  shared = { ...s, view: Buffer.from(s.bytes), seqs: new Int32Array(s.seq), len: new Int32Array(s.length) }
  console.log(`watchdog: ${name} logs a stall past ${logMs}ms and exits past ${exitMs}ms`)
  return true
}
