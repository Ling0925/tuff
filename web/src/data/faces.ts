import { useSyncExternalStore } from 'react'

/**
 * Which of the ten face colours each person in the workspace wears —
 * `docs/specs/avatar.md`.
 *
 * Taken from a hash of the id, ten colours for any number of people: in a
 * team of six, two or three wore the same one, and the colour is half of
 * what tells two faces apart at twenty pixels. So the people of the
 * workspace are dealt the colours: each takes the one its hash points at if
 * nobody before it has, and the next free one if somebody has, and only once
 * all ten are worn does a colour come round a second time. Dealt in id
 * order, so every screen and every person sees the same face on the same
 * person; and most people keep the colour their hash gave them, so the deal
 * does not repaint a workspace that was mostly apart already.
 *
 * Anybody not in the deal — a name with no id, somebody from another
 * workspace — is the hash, as before.
 */
const COLOURS = 10

export function hashOf(seed: string): number {
  let hash = 0
  for (const ch of seed) hash = (hash * 31 + ch.charCodeAt(0)) % 100_000
  return hash
}

let dealt = new Map<string, number>()
let key = ''
const heard = new Set<() => void>()

/** The workspace's people, by id, whenever the list is (re)read. */
export function dealFaces(ids: readonly string[]): void {
  const order = [...new Set(ids)].sort()
  const next = order.join(',')
  if (next === key) return
  key = next
  const out = new Map<string, number>()
  let worn = new Set<number>()
  for (const id of order) {
    if (worn.size === COLOURS) worn = new Set()
    let at = hashOf(id) % COLOURS
    while (worn.has(at)) at = (at + 1) % COLOURS
    worn.add(at)
    out.set(id, at)
  }
  dealt = out
  for (const f of heard) f()
}

/** The colour for a face: dealt if the person is in the workspace, the hash
    otherwise. */
export function useFace(seed: string): number {
  const d = useSyncExternalStore(
    (f) => {
      heard.add(f)
      return () => heard.delete(f)
    },
    () => dealt,
  )
  return d.get(seed) ?? hashOf(seed) % COLOURS
}

/** The same, outside React — a caret the editor draws in another person's
    colour. */
export function faceOf(seed: string): number {
  return dealt.get(seed) ?? hashOf(seed) % COLOURS
}
