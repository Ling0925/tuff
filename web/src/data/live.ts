/**
 * What the shell heard, for the screens that are not the shell.
 *
 * One socket per signed-in person carries what is addressed to them
 * — and the shell opens it. A screen that also wants to
 * know would otherwise open a second one of its own, which is a second
 * connection per tab for the same words.
 *
 * So the shell says it here and whoever is interested listens. A word, not a
 * row: the answer is the same refetch the screen would do anyway, so there is
 * one path into the data rather than two that can drift apart.
 */
type Listener = (kind: string) => void

const listeners = new Set<Listener>()

export function heard(kind: string): void {
  for (const said of listeners) said(kind)
}

export function onHeard(said: Listener): () => void {
  listeners.add(said)
  return () => listeners.delete(said)
}
