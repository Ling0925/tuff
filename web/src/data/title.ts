/**
 * What the window's tab says — `docs/specs/window-title.md`.
 *
 * Where you are, the way Linear says it: `Acme rebrand › Tasks`, the room's
 * name, the person. A task open on top says its own handle and title. Two
 * writers, so one store: the shell says the place, the task says itself
 * while it is open, and whichever is more specific wins — set by effects
 * that run child first, the shell's would otherwise overwrite the task's.
 */
let place = 'Tuff'
let detail: string | null = null

function write() {
  document.title = detail ?? place
}

export function setPlace(p: string): void {
  place = p || 'Tuff'
  write()
}

export function setDetail(d: string | null): void {
  detail = d
  write()
}
