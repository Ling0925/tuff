import type { Context } from 'hono'
import { edition } from './edition.js'
import { env } from './env.js'

/**
 * The address the world reaches this deployment at, where there is no
 * request to read it from — a message sent to Slack by the worker, the name
 * the link previewer gives the sites it reads. `APP_URL`, else the
 * service's own (`edition.vendor`); on your own server without `APP_URL`,
 * empty, and whatever needs it does without rather than naming usetuff.com.
 */
export function siteUrl(appUrl: string, vendorSite: string | null): string {
  return appUrl || vendorSite || ''
}

export const publicUrl = (): string => siteUrl(env.appUrl, edition.vendor?.site ?? null)

/**
 * Where a link this server hands out points — the one place every letter,
 * redirect and callback reads it from (the
 * seventh audit).
 *
 * In production it is `APP_URL`, else the service's own address, and never
 * the request: its `Host` is written by whoever sent it, and a reset asked
 * for with `Host: attacker.example`, behind a proxy that passed it on,
 * mailed the genuine token to the attacker's site. A production server that
 * would have no address does not start (`needSiteUrl`), so this is never
 * empty there.
 *
 * Elsewhere — a laptop, the tests — `APP_URL` when it is set, and otherwise
 * the host the request was routed by, which on a developer's machine is
 * localhost.
 */
export function linkOrigin(s: { appUrl: string; vendorSite: string | null; live: boolean; request: () => string }): string {
  if (s.appUrl) return s.appUrl
  if (s.live) return siteUrl(s.appUrl, s.vendorSite)
  return s.request()
}

/** `linkOrigin` for this server and this request. */
export function origin(c: Context): string {
  return linkOrigin({
    appUrl: env.appUrl,
    vendorSite: edition.vendor?.site ?? null,
    live: process.env.NODE_ENV === 'production',
    request: () => {
      /* Not `X-Forwarded-Host`, which the sender writes either way. */
      const url = new URL(c.req.url)
      const proto = c.req.header('x-forwarded-proto') === 'https' ? 'https' : url.protocol.replace(':', '')
      return `${proto}://${c.req.header('host') ?? url.host}`
    },
  })
}

export class NoSiteUrl extends Error {}

/**
 * A production server with no address of its own refuses to start, before
 * it listens — as one that row-level security would not bind does
 * (`rlsGuard.ts`). On the service the edition names its own address; on
 * your own server `scripts/setup.sh` writes `APP_URL` into `.env`.
 */
export function needSiteUrl(s: { appUrl: string; vendorSite: string | null; live: boolean }): void {
  if (!s.live || siteUrl(s.appUrl, s.vendorSite)) return
  throw new NoSiteUrl(
    '\n!!! APP_URL is not set. In production every link this server mails, a password reset among them, is made from it\n' +
      '!!! and never from the request. Set it to the address people open, like APP_URL=https://tuff.example.com (docs/self-hosting.md).\n' +
      '!!! Refusing to start.\n',
  )
}

/** How the link previewer names itself to the sites it reads. */
export function botAgent(site: string): string {
  return site ? `TuffBot/1.0 (+${site})` : 'TuffBot/1.0'
}
