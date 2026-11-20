import type { Context } from 'hono'
import { origin } from './oauth.js'

/*
 * One machine and the networks around it, for counting what an address
 * may do; and whether a request came from this site's own page. A
 * feedback page asks both, and a board by link did first.
 */

/**
 * An IPv6 address written out whole — eight groups of four — so that
 * `2001:db8::5` and `2001:db8:0:0::6` are seen as the same machine. Null
 * for anything that is not one; an IPv4 address written inside one
 * (`::ffff:1.2.3.4`) is that IPv4 address.
 */
export function expandV6(ip: string): string[] | null {
  let a = ip
    .trim()
    .replace(/^\[|\]$/g, '')
    .split('%')[0]!
    .toLowerCase()
  if (!a.includes(':')) return null
  const v4 = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(a)
  if (v4) {
    const p = v4.slice(1).map(Number)
    if (p.some((n) => n > 255)) return null
    a = `${a.slice(0, v4.index)}${((p[0]! << 8) | p[1]!).toString(16)}:${((p[2]! << 8) | p[3]!).toString(16)}`
  }
  const halves = a.split('::')
  if (halves.length > 2) return null
  const left = halves[0] ? halves[0].split(':') : []
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  let all: string[]
  if (halves.length === 1) {
    all = left
  } else {
    const fill = 8 - left.length - right.length
    if (fill < 1) return null
    all = [...left, ...Array<string>(fill).fill('0'), ...right]
  }
  if (all.length !== 8 || all.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null
  return all.map((g) => g.padStart(4, '0'))
}

/** Whether an address is an IPv4 one written inside IPv6. */
function mappedV4(groups: string[]): string | null {
  if (groups.slice(0, 5).join('') !== '00000000000000000000' || groups[5] !== 'ffff') return null
  const n = (g: string) => [parseInt(g.slice(0, 2), 16), parseInt(g.slice(2), 16)]
  return [...n(groups[6]!), ...n(groups[7]!)].join('.')
}

/**
 * One machine, for counting: an IPv4 address as it is, an IPv6 one as its
 * /64 — the network one machine is given, and can spread over.
 */
export function machineOf(ip: string): string {
  const g = expandV6(ip)
  if (!g) return ip
  return mappedV4(g) ?? `${g.slice(0, 4).join(':')}::/64`
}

/** The networks around one machine, for the wider ceilings: an IPv6 /56 and /48. */
export function networksOf(ip: string): { n56: string; n48: string } | null {
  const g = expandV6(ip)
  if (!g || mappedV4(g)) return null
  return { n56: `${g.slice(0, 3).join(':')}:${g[3]!.slice(0, 2)}::/56`, n48: `${g.slice(0, 3).join(':')}::/48` }
}

/** Where a request comes from: this site's own page. */
export function fromOurPage(c: Context): boolean {
  const said = c.req.header('origin')
  if (!said) return false
  let at: URL
  try {
    at = new URL(said)
  } catch {
    return false
  }
  if (said === origin(c) || at.host === c.req.header('host')) return true
  /* A laptop's own page, through the dev server's proxy, which names the
     API's port as the host. Never in production. */
  return process.env.NODE_ENV !== 'production' && (at.hostname === 'localhost' || at.hostname === '127.0.0.1')
}
