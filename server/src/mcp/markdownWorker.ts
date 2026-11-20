/**
 * What each of the pool's workers runs.
 *
 * One text in, its document out, one at a time. A text that throws is
 * answered with what was thrown rather than letting the worker die over
 * it: that is a fault in the parser, and the pool says so as one, not as
 * the caller's text being too complex.
 */

import { parentPort } from 'node:worker_threads'
import { fromMarkdown } from './markdown.js'

const port = parentPort
if (!port) throw new Error('markdownWorker runs as a worker thread')
port.on('message', (text: string) => {
  try {
    port.postMessage({ ok: true, doc: fromMarkdown(text) })
  } catch (e) {
    port.postMessage({ ok: false, error: e instanceof Error ? `${e.name}: ${e.message}` : String(e) })
  }
})
/* Said once its imports are in: a worker still starting is given no job,
   so its start is never counted against a job's half second. */
port.postMessage('ready')
