import type { Context } from 'hono'

/**
 * A workspace's own domain, as the core sees one.
 *
 * The service's edition recognises a request that came through its Worker
 * with a good signature over the name, finds the workspace that name opens,
 * and leaves it on the request as `host` (`cloud/domains/hosts.ts`). The
 * core only reads it: a session made there is bound to it, a token from
 * anywhere else is nobody there, and the page is written as that
 * workspace's. On your own server nothing ever sets it.
 */
export type Host = {
  domainId: string
  hostname: string
  workspaceId: string
  slug: string
  name: string
}

/** The host a request came in on, or null for this server's own address. */
export const hostOf = (c: Context): Host | null => ((c as Context<any>).get('host') as Host | undefined) ?? null

/**
 * Whether a signed-in context may be used on this request's host: on
 * usetuff.com, any; on a host, only a session made on that same host, in
 * its workspace — never a token, never a session from usetuff.com or from
 * another host.
 */
export function usableHere(c: Context, ctx: { host?: string | undefined; workspaceId: string; tokenId?: string | undefined }): boolean {
  const host = hostOf(c)
  if (!host) return true
  return !ctx.tokenId && ctx.host === host.hostname && ctx.workspaceId === host.workspaceId
}

/**
 * What the app's page is, for a host to write as its workspace's — set by
 * `main.ts` where there is a built page, empty in the tests.
 */
export const hostPage: { html: (() => string) | null; headers: Record<string, string> } = { html: null, headers: {} }
