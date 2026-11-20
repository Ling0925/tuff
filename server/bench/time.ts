/** The milliseconds `fn` takes, the best of `runs` (one by default). */
export function took(fn: () => unknown, runs = 1): number {
  let best = Number.POSITIVE_INFINITY
  for (let i = 0; i < runs; i++) {
    const t = performance.now()
    fn()
    best = Math.min(best, performance.now() - t)
  }
  return best
}

/** The milliseconds an asynchronous `fn` takes. */
export async function tookAsync(fn: () => Promise<unknown>): Promise<number> {
  const t = performance.now()
  await fn()
  return performance.now() - t
}
