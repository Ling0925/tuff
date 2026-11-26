/**
 * What the window's tab says — `docs/specs/window-title.md`.
 *
 * Where you are, the way Linear says it: `Acme rebrand › Tasks`, the room's
 * name, the person. A task open on top says its own handle and title. Two
 * writers, so one store: the shell says the place, the task says itself
 * while it is open, and whichever is more specific wins — set by effects
 * that run child first, the shell's would otherwise overwrite the task's.
 */
let place = ''
let detail: string | null = null
/* What a window with no place to name is called: the product, or a
   branded workspace while it is open. */
let own = 'Tuff'

function write() {
  document.title = detail ?? (place || own)
}

export function setPlace(p: string): void {
  place = p
  write()
}

/** The name in place of a place: a branded workspace's, or null for Tuff's — `data/brand.ts`. */
export function setOwnName(name: string | null): void {
  own = name || 'Tuff'
  write()
}

export function setDetail(d: string | null): void {
  detail = d
  write()
}
