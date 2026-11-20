/**
 * A Markdown worker for `markdown-pool.test.ts` that fails to start the
 * first three times — counted in the file `MARKDOWN_FLAKY` names, which
 * every worker of the test's process shares — and starts after that.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { parentPort } from 'node:worker_threads'

const counter = process.env.MARKDOWN_FLAKY!
const tries = Number(readFileSync(counter, 'utf8') || '0') + 1
writeFileSync(counter, String(tries))
if (tries <= 3) throw new Error(`not starting, try ${tries}`)

const port = parentPort!
port.on('message', (text: string) =>
  port.postMessage({ ok: true, doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] } }),
)
port.postMessage('ready')
