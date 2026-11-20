/**
 * A Markdown worker for `markdown-pool.test.ts`: the real parser, except
 * for a few texts that stand for what the pool has to hold against —
 * `spin`, a pattern that never finishes; `hog`, one that eats memory until
 * it is stopped; `slow`, a third of a second of work; `throw`, the parser
 * itself failing; and `exit`, the worker ending under a job.
 */

import { parentPort } from 'node:worker_threads'
import { fromMarkdown } from '../src/mcp/markdown.js'

const port = parentPort!
port.on('message', (text: string) => {
  if (text === 'spin') for (;;);
  if (text === 'hog') {
    const kept: number[][] = []
    for (;;) kept.push(new Array(1_000_000).fill(kept.length))
  }
  if (text === 'slow') {
    const until = Date.now() + 300
    while (Date.now() < until);
  }
  if (text === 'throw') {
    port.postMessage({ ok: false, error: 'Error: boom' })
    return
  }
  if (text === 'exit') process.exit(3)
  port.postMessage({ ok: true, doc: fromMarkdown(text) })
})
port.postMessage('ready')
