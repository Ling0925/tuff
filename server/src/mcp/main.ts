/**
 * The MCP server.
 *
 * A thin wrapper over the REST API, not a second way into the data. Every tool
 * below is one HTTP call to the endpoint the web app uses, with the person's
 * own token — so permissions, validation and the client-visibility rules are
 * the same by construction rather than by two implementations agreeing.
 *
 * Run with: TRACKER_TOKEN=tok_... TRACKER_URL=http://localhost:8787
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { tuffServer } from './tools.js'

/* `TUFF_*` since the product was named; `TRACKER_*` still read, so an
   agent set up before then keeps working. */
const token = process.env.TUFF_TOKEN ?? process.env.TRACKER_TOKEN
const base = process.env.TUFF_URL ?? process.env.TRACKER_URL ?? 'http://localhost:8787'
if (!token) throw new Error('TUFF_TOKEN is not set')

async function call(path: string, init: RequestInit = {}): Promise<unknown> {
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      /* A file goes up as a form, which says its own type and boundary. */
      ...(init.body instanceof FormData ? {} : { 'content-type': 'application/json' }),
      'x-api-version': '1',
      authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    const e = (body as { error?: { code?: string; message?: string } }).error
    // Forbidden is a fact about this token, not a failure to retry: some
    // things are never available through one, whatever the person may do.
    throw new Error(`${e?.code ?? res.status}: ${e?.message ?? 'refused'}`)
  }
  return body
}

await tuffServer(call, base.replace(/\/$/, '')).connect(new StdioServerTransport())
