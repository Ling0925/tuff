/**
 * The headers every page of the app goes out with.
 *
 * Production sent none: no Content-Security-Policy, so any script that got
 * into a page could read the session out of storage; no frame-ancestors, so
 * the app could be laid invisibly under somebody else's page and a press on
 * it taken for a press on theirs; no HSTS. Written once, here, because two
 * things serve the app — the server in production and Vite's preview under
 * the browser tests — and a policy only the first one sends is a policy the
 * tests never meet.
 *
 * Scripts: this origin and the inline theme script by its hash, nothing
 * else — that is the line that matters. Pictures and media from any https
 * origin, because files come through the edge (another origin) and GIFs
 * from KLIPY; styles inline, because every component sets style attributes.
 */
/*
 * `counted`: a public page written out as HTML —
 * which loads Cloudflare's visit counter and so
 * lets that one script in and its one address be written to. Only there:
 * the app's own pages never load it, and a third party's script on the
 * screens that hold a workspace is a door nobody needs open.
 */
/*
 * `turnstile`: a project's feedback page — which
 * runs Cloudflare's check beside its Send, a script and the frame it draws.
 * Only there, for the same reason as the counter.
 */
const TURNSTILE = 'https://challenges.cloudflare.com'
export function pageHeaders(o: { scriptHashes: string[]; production: boolean; counted?: boolean; turnstile?: boolean }): Record<string, string> {
  const csp = [
    "default-src 'self'",
    `script-src 'self' ${o.scriptHashes.map((h) => `'${h}'`).join(' ')}${o.counted ? ' https://static.cloudflareinsights.com' : ''}${o.turnstile ? ` ${TURNSTILE}` : ''}`.trim(),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob: https:",
    "font-src 'self' data:",
    `connect-src 'self' wss: https://api.klipy.com${o.counted ? ' https://cloudflareinsights.com' : ''}`,
    `frame-src 'self' blob:${o.turnstile ? ` ${TURNSTILE}` : ''}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self' https://appleid.apple.com https://accounts.google.com",
    "frame-ancestors 'none'",
  ].join('; ')
  return {
    'content-security-policy': csp,
    'x-frame-options': 'DENY',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    ...(o.production ? { 'strict-transport-security': 'max-age=31536000; includeSubDomains' } : {}),
  }
}

/** The inline scripts of a page, as CSP names them: `sha256-…` of each body. */
export function inlineScripts(html: string): string[] {
  const out: string[] = []
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi
  for (let m = re.exec(html); m; m = re.exec(html)) out.push(m[1] ?? '')
  return out
}
