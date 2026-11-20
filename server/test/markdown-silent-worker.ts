/**
 * A Markdown worker for `markdown-pool.test.ts` that never says it is
 * ready and never ends — the pool must not wait on it for ever.
 */

setInterval(() => {}, 1_000)
