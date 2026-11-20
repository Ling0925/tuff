import type { Context } from 'hono'

/**
 * Cookies added to an answer that has already been made, in a way that
 * reaches the browser.
 *
 * `c.res.headers.append` after `next()` looked right and passed every test,
 * and on the running server the cookie was dropped from most answers. Under
 * `@hono/node-server` a handler's `c.json` is the adapter's own light
 * `Response`, holding the headers it was made with apart from the ones read
 * back through `.headers`. An outer middleware that calls `c.header` once the
 * answer is made — `cors` adds `Vary: Origin` to every one — copies the
 * answer from the headers it was made with, and what was appended is lost.
 * Only an answer made after something had touched `c.res` first kept it,
 * which is a request that carried an `Origin`: a browser's POST did, its
 * GETs to its own site do not. So the file cookie arrived with the first
 * write and never with a page that only read, and a picture linked
 * `?for=me` was refused to somebody who had only looked (found on Railway). `app.request` in the tests does not swap the global `Response`,
 * which is why nothing there saw it.
 *
 * So the answer is made again, its headers a real `Headers` that holds the
 * cookies, and handed to `c.res`, whose setter keeps what it is given.
 */
export function addCookies(c: Context, cookies: readonly string[]): void {
  if (cookies.length === 0) return
  const headers = new Headers(c.res.headers)
  for (const h of cookies) headers.append('set-cookie', h)
  c.res = new Response(c.res.body, { status: c.res.status, statusText: c.res.statusText, headers })
}
