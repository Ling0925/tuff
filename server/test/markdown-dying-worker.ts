/**
 * A Markdown worker for `markdown-pool.test.ts` that says it is ready and
 * dies a moment later, before reading anything; every start is counted in
 * the file `MARKDOWN_DYING` names. The pool must back off, not respawn it
 * in a loop.
 */

import { appendFileSync } from 'node:fs'
import { parentPort } from 'node:worker_threads'

appendFileSync(process.env.MARKDOWN_DYING!, '.')
parentPort!.postMessage('ready')
setTimeout(() => process.exit(1), 10)
