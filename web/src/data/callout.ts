/**
 * What a callout may look like.
 *
 * Here and not in the editor's node, because the read-only drawing (`Doc`)
 * needs the same answer and is loaded where the editor is not: a room draws
 * bodies by the hundred and has no business importing ProseMirror.
 */

/** Five, chosen: a callout says what kind of aside it is, it is not a palette. */
export const TONES = ['grey', 'blue', 'green', 'yellow', 'red'] as const
export type Tone = (typeof TONES)[number]

/** The emoji the panel offers. Any one already stored is kept and drawn. */
export const EMOJI = ['💡', 'ℹ️', '📌', '⚠️', '✅', '🛑', '❓', '🔥'] as const

/** A stored tone, or grey for anything that is not one of the five. */
export const toneOf = (v: unknown): Tone => (TONES.includes(v as Tone) ? (v as Tone) : 'grey')

/** A stored emoji, held to a few characters; the bulb for none. */
export const emojiOf = (v: unknown): string => (typeof v === 'string' && v.trim() ? [...v.trim()].slice(0, 8).join('') : '💡')
