/**
 * A letter shortcut, on whatever layout somebody types in.
 *
 * `e.key` is the character the layout produced. On a Russian layout `c`
 * arrives as `с` and `k` as `к`, on Greek as `ψ` and `κ` — so every letter
 * shortcut in the product quietly stops working for anybody not typing in
 * English. Nobody reports that as a bug; they just stop using the shortcuts.
 *
 * `e.code` is the physical key and ignores the layout entirely, which is the
 * right answer for every layout that leaves the Latin legends where QWERTY
 * put them: Cyrillic, Greek, Hebrew, Arabic, and the national Latin ones.
 *
 * It is the wrong answer for Dvorak and Colemak, where somebody moved the
 * letters on purpose and means the letter rather than the place. So: either
 * one. The two only disagree on layouts where the person chose to move
 * things, and there the extra key is a key that was free anyway.
 */
export function isKey(e: { key: string; code: string }, letter: string): boolean {
  return e.code === `Key${letter.toUpperCase()}` || e.key.toLowerCase() === letter
}

/**
 * Which digit was pressed, or null — the same question as `isKey` and a
 * different answer, because digits are not letters.
 *
 * `Digit1` is the key in the number row wherever the layout put the
 * characters, which is the point: on a French AZERTY that key types `&`
 * unshifted, and somebody pressing it means the first tab rather than an
 * ampersand. The numpad is `Numpad1` and counts too — it is a number key
 * that happens to be somewhere else on the board.
 *
 * `e.key` is accepted as well, for the same reason `isKey` accepts it: a
 * layout where somebody deliberately moved the digits means the digit.
 *
 * Shift is not here. `Shift+1` is `!` and a different intention, and the
 * caller checks modifiers anyway.
 */
export function digit(e: { key: string; code: string }): number | null {
  const m = /^(?:Digit|Numpad)([1-9])$/.exec(e.code)
  if (m) return Number(m[1])
  return /^[1-9]$/.test(e.key) ? Number(e.key) : null
}
