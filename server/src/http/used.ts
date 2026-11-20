import type { Context } from 'hono'

/*
 * What a request was, said by the handler that knows.
 *
 * The route says most of it: a POST to a project's tasks made a task. A few
 * routes do more than one thing, and only their handler can tell which: a
 * change to a task that moved it, a message said in a channel or directly.
 * Those say it here, by the feature's name, and the edition decides what
 * becomes of it — on the service, a count; on your own server, nothing.
 * Never anything about the object: a name from a short list, no more.
 */
const said = new WeakMap<Request, string>()

export function used(c: Context, feature: string): void {
  said.set(c.req.raw, feature)
}

export function usedAs(c: Context): string | null {
  return said.get(c.req.raw) ?? null
}
