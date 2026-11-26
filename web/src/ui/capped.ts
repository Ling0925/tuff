/**
 * Which rows a capped list in the sidebar draws, and where a row let go
 * among them lands.
 * Apart from the component so it can be tested without one.
 */

/**
 * The rows drawn before "more": the first `cap` of the order, unless the
 * open one is past them — then one fewer of the order and the open one, so
 * the list is as long as it was and only its last row gives way.
 */
export function cappedRows<T extends { id: string }>(items: T[], cap: number, pinned: string | null): { shown: T[]; lifted: boolean } {
  const place = cap > 0 && pinned ? items.findIndex((i) => i.id === pinned) : -1
  if (place < cap) return { shown: items.slice(0, cap), lifted: false }
  return { shown: [...items.slice(0, cap - 1), items[place]!], lifted: true }
}

/**
 * The row a carried one should now sit behind, given the row drawn above the
 * gap it was let go in — or `undefined` when that changes nothing.
 *
 * A lifted row is still at its own place in the order, far below. A gap
 * above it is an ordinary gap; the gap below it would put a row behind that
 * far-off place, out of sight, so it lands above the lifted row instead —
 * behind the row drawn there, which is no move at all when that is the row
 * being carried.
 */
export function landing(
  drawn: string[],
  lifted: boolean,
  pinned: string | null,
  id: string,
  after: string | null,
): string | null | undefined {
  if (!lifted || after !== pinned || id === pinned) return after
  const behind = drawn[drawn.length - 2] ?? null
  return behind === id ? undefined : behind
}
