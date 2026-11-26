/**
 * Whether this window is a workspace's own domain.
 *
 * The server says so in the page it writes there (`tuff-host`, the
 * workspace's slug; `tuff-host-name`, its name; `tuff-home`, usetuff.com),
 * so the router knows before anything is fetched. Nothing writes it on
 * usetuff.com or on your own server, and then this is null.
 */
export type OnHost = { slug: string; name: string; home: string }

let read: OnHost | null | undefined

export function onHost(): OnHost | null {
  if (read !== undefined) return read
  const meta = (n: string) => document.querySelector(`meta[name="${n}"]`)?.getAttribute('content') ?? ''
  const slug = typeof document === 'undefined' ? '' : meta('tuff-host')
  read = slug ? { slug, name: meta('tuff-host-name') || slug, home: meta('tuff-home') || 'https://usetuff.com' } : null
  return read
}

/**
 * Where a path goes from a host: its own workspace's paths stay; anything
 * else — another workspace, signing up, a reset — is a full navigation to
 * the same path at usetuff.com, which the host could not open and whose
 * session could not either. Null to stay.
 */
export function leaveFor(path: string): string | null {
  const host = onHost()
  if (!host) return null
  const first = path.split('/')[1] ?? ''
  if (path === '/' || path.startsWith('/signin') || first === host.slug || first === 'd') return null
  return `${host.home}${path}`
}

/* The workspace's own address, from `GET /api/me` — its connected domain on
   a branded plan, or none. The shared document links the app copies use it,
   so a client is handed the agency's address, not ours. */
let ownOrigin: string | null = null
export function setWorkspaceOrigin(origin: string | null | undefined): void {
  ownOrigin = origin ?? null
}
export const shareOrigin = (): string => ownOrigin ?? location.origin
