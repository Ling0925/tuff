/**
 * How large a picture is opened, read off its own shape and the window's.
 *
 * Opened, a picture is as large as the window allows: shrunk to fit when it
 * is bigger than the window, and — the half that was missing — grown when
 * it is smaller. Capped at its own size, a phone-sized screenshot opened in
 * the middle of a desktop window exactly as small as it was in the column,
 * and the words in it stayed unreadable: the lightbox was a frame around
 * the same small picture. Every viewer a person already uses grows a small
 * picture when it is opened, because that is what opening one is for.
 *
 * Growth stops at twice over: enough to read what a small screenshot says,
 * not so far that a sharp one is smeared into mush. The margin is the 32 on
 * every side the lightbox leaves.
 */
export function fitFrame(natural: { w: number; h: number }, window: { w: number; h: number }): { w: number; h: number } {
  const TWICE = 2
  const k = Math.min(TWICE, (window.w - 64) / natural.w, (window.h - 64) / natural.h)
  return { w: Math.round(natural.w * k), h: Math.round(natural.h * k) }
}
