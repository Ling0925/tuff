/**
 * A page of rows sent whole, and when the server says it is too much to
 * write at once (`413 too_large`
 * ), its two halves, each the same way: the server writes a
 * page whole or not at all, so a refused page left nothing to undo. A page
 * of one that is still refused is the error the person sees.
 *
 * The browser cannot tell how large the server's documents will be — two
 * hundred rows of words with a link and a bold word on every line write
 * four times what they are — so it asks, and halves when told.
 */
export async function sendHalving<T>(
  page: T[],
  send: (part: T[]) => Promise<number>,
  tooLarge: (e: unknown) => boolean,
  written: (n: number) => void = () => {},
): Promise<number> {
  try {
    const n = await send(page)
    written(n)
    return n
  } catch (e) {
    if (!tooLarge(e) || page.length < 2) throw e
    const mid = Math.ceil(page.length / 2)
    const first = await sendHalving(page.slice(0, mid), send, tooLarge, written)
    return first + (await sendHalving(page.slice(mid), send, tooLarge, written))
  }
}
