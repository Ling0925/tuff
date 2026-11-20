/**
 * Somebody else's Markdown, read by a worker rather than by the thread
 * that answers everybody.
 *
 * The parser was made linear one pattern at a time, and each pattern was
 * found after it had held the server's one thread — one body for two
 * minutes. This is the guarantee those fixes are not: a job that takes
 * longer than half a second has its worker terminated and replaced, and is
 * refused as `TooComplex`.
 */

import { availableParallelism } from 'node:os'
import { Worker } from 'node:worker_threads'
import { plainParagraphs } from './markdown.js'

export type Doc = {
  type: string
  attrs?: Record<string, unknown>
  content?: Doc[]
  text?: string
  marks?: { type: string; attrs?: Record<string, unknown> }[]
}

/** A text the pool would not finish reading: too slow, or too big. */
export class TooComplex extends Error {
  constructor() {
    super('This text is too complex to read. Simplify it and try again.')
  }
}
export const tooComplex = { error: { code: 'too_complex', message: 'This text is too complex to read. Simplify it and try again.' } }

/** Not read because too much is waiting already: try again shortly. */
export class Busy extends Error {
  constructor() {
    super('Too much is being read right now. Try again in a moment.')
  }
}
export const busy = { error: { code: 'busy', message: 'Too much is being read right now. Try again in a moment.' } }

/* Under tsx the pool is `.ts` and so is its worker; compiled, both are
   `.js` in `dist`. A worker inherits the parent's `execArgv` — tsx's
   loader in one, `--conditions=compiled` in the other. */
const WORKER = new URL(`./markdownWorker.${import.meta.url.endsWith('.ts') ? 'ts' : 'js'}`, import.meta.url)

export type PoolOptions = {
  /** The worker's file; a test gives one of its own. */
  file?: URL
  size?: number
  /** How long one job may run once a worker has it. */
  timeoutMs?: number
  /** How many may wait for a worker, and how long each may wait. */
  maxQueue?: number
  queueWaitMs?: number
  /** How many one caller may have waiting or running at once. */
  perCaller?: number
  /** The first wait before a worker that failed to start is tried again;
      it doubles with every failure in a row, up to thirty seconds. */
  retryMs?: number
  /** How long a worker may take to say it is ready before it counts as
      one that would not start. */
  startMs?: number
}

type Job = {
  text: string
  resolve: (d: Doc) => void
  reject: (e: Error) => void
  waited: NodeJS.Timeout | null
}
type Slot = {
  worker: Worker
  ready: boolean
  /** Whether it has read anything yet: one that says it is ready and dies
      before it has is a worker that would not start, and waits to be
      tried again like one. */
  served: boolean
  job: Job | null
  timer: NodeJS.Timeout | null
  starting: NodeJS.Timeout | null
}
type Answer = 'ready' | { ok: true; doc: Doc } | { ok: false; error: string }

export type Pool = { read(text: string, caller?: string): Promise<Doc>; close(): Promise<void> }

/* What is logged of a text: its length, never its words. */
const sized = (job: Job | null) => (job ? `a text of ${job.text.length} characters` : 'no text')

export function createPool(options: PoolOptions = {}): Pool {
  const file = options.file ?? WORKER
  const size = options.size ?? Math.max(2, Math.min(4, availableParallelism() - 1))
  const timeoutMs = options.timeoutMs ?? 500
  const maxQueue = options.maxQueue ?? 256
  const queueWaitMs = options.queueWaitMs ?? 5_000
  const perCaller = options.perCaller ?? 4
  const retryMs = options.retryMs ?? 100
  const startMs = options.startMs ?? 15_000
  const slots: Slot[] = []
  const queue: Job[] = []
  const callers = new Map<string, number>()
  let started = false
  let failedStarts = 0
  let closed = false
  let waiting = 0

  /* Refused only when no worker is alive and the last three would not
     start; one that reads something again clears it. */
  const down = () => failedStarts >= 3 && !slots.some((s) => s.ready)
  const downError = () => new Error('The Markdown workers could not start.')

  /* The workers keep the process alive while somebody waits on them, and
     never otherwise: a script that read one body ends when it is done.
     After the listeners, since adding one refs a worker's port again. */
  const hold = () => {
    for (const s of slots) {
      if (waiting > 0) s.worker.ref()
      else s.worker.unref()
    }
  }

  const settle = (slot: Slot) => {
    if (slot.timer) clearTimeout(slot.timer)
    slot.timer = null
    const job = slot.job
    slot.job = null
    return job
  }

  /* A worker that would not start is tried again later, waiting twice as
     long after each failure in a row: not respawned in a tight loop, and
     not given up on for good either. */
  const retry = () => {
    if (closed) return
    const wait = Math.min(30_000, retryMs * 2 ** Math.max(0, failedStarts - 1))
    setTimeout(() => {
      if (!closed && slots.length < size) start()
    }, wait).unref()
  }

  /* `new Worker` can throw where it is called — from an exit handler, in
     `replace` — and that must not take the process with it. */
  const start = () => {
    try {
      spawn()
    } catch (e) {
      console.error('[markdown] a worker could not be started:', (e as Error).message)
      failedStarts++
      if (down()) for (const job of queue.splice(0)) job.reject(downError())
      retry()
    }
  }

  /* Gone, by our hand or its own: what it held is refused with `failure`,
     and another takes its place. At once when the text was to blame — a
     timeout, memory — or the worker had been reading; after a wait that
     doubles when it never started, or never read anything before dying,
     so a worker that says ready and dies is not respawned in a loop. */
  const replace = (slot: Slot, failure: Error) => {
    const at = slots.indexOf(slot)
    if (at === -1) return
    slots.splice(at, 1)
    if (slot.starting) clearTimeout(slot.starting)
    slot.starting = null
    settle(slot)?.reject(failure)
    void slot.worker.terminate()
    if (closed) return
    if (failure instanceof TooComplex || slot.served) start()
    else {
      failedStarts++
      if (down()) for (const job of queue.splice(0)) job.reject(downError())
      retry()
    }
    pump()
  }

  const spawn = () => {
    const worker = new Worker(file, {
      resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 },
    })
    const slot: Slot = { worker, ready: false, served: false, job: null, timer: null, starting: null }
    /* One that never says it is ready, and never ends, would hold every
       request waiting on it: past `startMs` it counts as one that would
       not start. */
    slot.starting = setTimeout(() => {
      console.error(`[markdown] a worker did not start in ${startMs} ms; replaced`)
      replace(slot, new Error('The Markdown worker did not start.'))
    }, startMs)
    slot.starting.unref()
    worker.on('message', (m: Answer) => {
      if (m === 'ready') {
        slot.ready = true
        if (slot.starting) clearTimeout(slot.starting)
        slot.starting = null
      } else {
        const job = settle(slot)
        if (m.ok) {
          slot.served = true
          failedStarts = 0
          job?.resolve(m.doc)
        } else {
          /* The parser itself threw: ours to fix, not the caller's text to
             refuse — a 500, and logged. */
          console.error(`[markdown] the parser failed on ${sized(job)}: ${m.error}`)
          job?.reject(new Error(`The Markdown parser failed: ${m.error}`))
        }
      }
      pump()
    })
    worker.on('error', (e: Error & { code?: string }) => {
      const job = slot.job
      if (e.code === 'ERR_WORKER_OUT_OF_MEMORY') {
        console.error(`[markdown] a worker ran out of memory reading ${sized(job)}; replaced`)
        replace(slot, new TooComplex())
      } else {
        console.error(`[markdown] a worker failed reading ${sized(job)}:`, e.message)
        replace(slot, new Error(`The Markdown worker failed: ${e.message}`))
      }
    })
    worker.on('exit', (code) => {
      if (slots.includes(slot)) console.error(`[markdown] a worker stopped (${code}) reading ${sized(slot.job)}; replaced`)
      replace(slot, new Error('The Markdown worker stopped.'))
    })
    slots.push(slot)
    hold()
  }

  const pump = () => {
    for (const slot of slots) {
      if (!queue.length) return
      if (!slot.ready || slot.job) continue
      const job = queue.shift()!
      if (job.waited) clearTimeout(job.waited)
      job.waited = null
      slot.job = job
      /* The half second starts when a worker takes the job, not while it
         waits behind others. */
      slot.timer = setTimeout(() => {
        console.error(`[markdown] ${sized(job)} took over ${timeoutMs} ms; its worker was replaced`)
        replace(slot, new TooComplex())
      }, timeoutMs)
      slot.worker.postMessage(job.text)
    }
  }

  return {
    read(text: string, caller?: string) {
      if (closed) return Promise.reject(new Error('The Markdown pool is closed.'))
      if (!started) {
        started = true
        for (let k = 0; k < size; k++) start()
      }
      if (down()) return Promise.reject(downError())
      /* A queue that is full, or a caller with as many in hand as one may
         have, is told to come back: not lined up for minutes behind it. */
      if (queue.length >= maxQueue) return Promise.reject(new Busy())
      if (caller !== undefined && (callers.get(caller) ?? 0) >= perCaller) return Promise.reject(new Busy())
      if (caller !== undefined) callers.set(caller, (callers.get(caller) ?? 0) + 1)
      if (++waiting === 1) hold()
      const done = () => {
        if (caller !== undefined) {
          const n = (callers.get(caller) ?? 1) - 1
          if (n > 0) callers.set(caller, n)
          else callers.delete(caller)
        }
        if (--waiting === 0) hold()
      }
      return new Promise<Doc>((resolve, reject) => {
        const job: Job = {
          text,
          resolve: (d) => {
            done()
            resolve(d)
          },
          reject: (e) => {
            done()
            reject(e)
          },
          waited: null,
        }
        /* Waited too long for a worker: busy, not complex — it was never
           read. Not while no worker is up yet: the pool starting is not the
           pool overloaded, and one that cannot start is refused as down. */
        const deadline = () => {
          job.waited = setTimeout(() => {
            const at = queue.indexOf(job)
            if (at === -1) return
            if (!slots.some((s) => s.ready)) return deadline()
            queue.splice(at, 1)
            job.reject(new Busy())
          }, queueWaitMs)
        }
        deadline()
        queue.push(job)
        pump()
      })
    },
    async close() {
      closed = true
      const all = slots.splice(0)
      for (const s of all) settle(s)?.reject(new Error('The Markdown pool is closed.'))
      for (const job of queue.splice(0)) {
        if (job.waited) clearTimeout(job.waited)
        job.reject(new Error('The Markdown pool is closed.'))
      }
      await Promise.all(all.map((s) => s.worker.terminate()))
    },
  }
}

let shared: Pool | null = null

/**
 * Somebody else's Markdown, as the editor's document. Refused with
 * `TooComplex` when a worker could not read it in half a second, or ran
 * out of memory trying; with `Busy` when too much is waiting already, or
 * `caller` — a person, a board — has as much in hand as one may.
 */
export function readMarkdown(text: string, caller?: string): Promise<Doc> {
  shared ??= createPool()
  return shared.read(text, caller)
}

/**
 * The same, for work nobody is waiting on — a GitHub sync, an import's
 * page: a text the workers refuse as too complex is kept as its plain
 * paragraphs, split on blank lines, rather than failing a sync on every
 * pass or stopping an import of a thousand issues at one. A busy pool or
 * a failing parser is still an error: the work is tried again, and a
 * fault of ours is not hidden as plain text.
 */
export async function readMarkdownOrPlain(text: string): Promise<Doc> {
  try {
    return await readMarkdown(text)
  } catch (e) {
    if (!(e instanceof TooComplex)) throw e
    return plainDoc(text)
  }
}

/** Paragraphs of the words as they were, nothing read into them. Linear. */
export const plainDoc = (text: string): Doc => plainParagraphs(text) as Doc

/**
 * Many texts, `inTurn` at a time and in order, stopping at the first
 * refusal: a page of two hundred hostile rows costs two timeouts, not two
 * hundred, and does not fill the queue ahead of everybody else. Given
 * `each`, every document is told to it as it comes rather than kept and
 * answered, and it stops the rest by throwing.
 */
export async function readAll(texts: string[], inTurn = 2, each?: (doc: Doc, k: number) => void, caller?: string): Promise<Doc[]> {
  const out: Doc[] = new Array(texts.length)
  let next = 0
  let failed: unknown = null
  const lane = async () => {
    while (failed === null && next < texts.length) {
      const k = next++
      try {
        const doc = await readMarkdown(texts[k]!, caller)
        if (failed !== null) return
        /* Told rather than kept: the caller keeps what it needs of it. */
        if (each) each(doc, k)
        else out[k] = doc
      } catch (e) {
        failed ??= e
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(inTurn, texts.length) }, lane))
  if (failed !== null) throw failed
  return out
}

/** For tests: the shared pool's workers stopped, and another put in its
    place — one whose worker stands for a body nobody has found yet. */
export async function setMarkdownPool(next: Pool | null): Promise<void> {
  const p = shared
  shared = next
  await p?.close()
}
