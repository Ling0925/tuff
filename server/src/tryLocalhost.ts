import type { MiddlewareHandler } from 'hono'
import { env } from './env.js'

/*
 * Tuff tried on one computer over plain http.
 * Whether it is on is `env.tryLocalhost`, which refused to start the server
 * on any `APP_URL` but `http://localhost` or `http://127.0.0.1`.
 */

/** Whether a `Host` header names this machine: localhost or 127.0.0.1, at any port. */
export function loopbackHost(host: string | undefined): boolean {
  const m = /^(localhost|127\.0\.0\.1)(?::\d{1,5})?$/i.exec((host ?? '').trim())
  return m !== null
}

/*
 * The headers a proxy or a tunnel adds on its way in. ngrok, cloudflared,
 * Caddy, Traefik and an nginx told to say where a request came from write
 * at least one of them, even when they rewrite `Host` to localhost.
 */
export const FORWARDING = [
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'forwarded',
  'via',
  'x-real-ip',
  'cf-connecting-ip',
  'true-client-ip',
] as const

/*
 * Requests from a browser on this machine, or nothing. `APP_URL` cannot
 * say who reaches the app, and the cookies below go without `Secure` only
 * because nothing between the browser and the app is a network. So, with
 * try mode on, a request is answered 421 when its `Host` is not localhost
 * or 127.0.0.1 — an address on the network, a name of somebody else's
 * pointed at 127.0.0.1 (DNS rebinding) — or when it carries any forwarding
 * header, which a proxy or a tunnel that rewrites `Host` still adds.
 *
 * What it cannot see: a proxy on this machine that rewrites `Host` and adds
 * nothing, as nginx's bare `proxy_pass http://127.0.0.1:<port>` does. That
 * is somebody putting a server in front on purpose, and is the case the
 * self-hosting guide says try mode is not for. First, before anything
 * reads the request.
 */
export const onlyLocalhost: MiddlewareHandler = async (c, next) => {
  if (!env.tryLocalhost) return next()
  if (loopbackHost(c.req.header('host')) && !FORWARDING.some((h) => c.req.header(h) !== undefined)) return next()
  return c.text(`This Tuff is for trying on one computer. Open it at ${env.appUrl}.`, 421)
}

/**
 * `; Secure` for a cookie that asks for it, except where Tuff is being
 * tried on this computer over plain http — where WebKit would refuse a
 * `Secure` cookie and every picture would stop loading. The file pass asks
 * in production only, as it always has; the sign-up binding always.
 */
export function secureAttr(asked = true): string {
  return asked && !env.tryLocalhost ? '; Secure' : ''
}
