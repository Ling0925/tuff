/**
 * What the three imports share when they ask another product's API.
 */

export type Source = 'linear' | 'jira' | 'asana'
export const NAME: Record<Source, string> = { linear: 'Linear', jira: 'Jira', asana: 'Asana' }

/** Refused for what was sent — a key it no longer takes, among others. */
export class Refused extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}
/** Asked to wait: the work goes on later, from where it was. */
export class Later extends Error {
  constructor(readonly seconds: number) {
    super(`Asked to wait ${seconds}s`)
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * A request that waits out a short "too many" in place, as a person would,
 * and hands a long one back as `Later`. Asana's free plan allows a hundred
 * and fifty a minute and a task costs two: given back to the next turn,
 * every wait cost the ten minutes a claim takes to lapse.
 */
export async function patiently(ask: () => Promise<Response>, inPlace = true): Promise<Response> {
  for (let tries = 0; ; tries++) {
    const r = await ask()
    if (r.status !== 429 && r.status !== 503) return r
    const wait = Number(r.headers.get('retry-after')) || 30
    /* A person waiting on a request is not kept waiting minutes: told. */
    if (!inPlace || tries >= 4 || wait > 60) throw new Later(Math.max(wait, 60))
    await r.body?.cancel().catch(() => {})
    await sleep(wait * 1000)
  }
}

export const MAX_FILE = 10 * 1024 * 1024

/** A body read as it streams, ten megabytes at most; null past that. */
export async function capped(r: Response, max = MAX_FILE): Promise<ArrayBuffer | null> {
  if (!r.body) return null
  const chunks: Uint8Array[] = []
  let size = 0
  const reader = r.body.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > max) {
      await reader.cancel().catch(() => {})
      return null
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(size)
  let at = 0
  for (const c of chunks) {
    bytes.set(c, at)
    at += c.byteLength
  }
  return bytes.buffer
}

/** An https address on exactly this host, or nothing. */
export function on(url: string, host: (h: string) => boolean): URL | null {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  if (u.protocol !== 'https:' || u.port || u.username || u.password || !host(u.hostname)) return null
  return u
}
