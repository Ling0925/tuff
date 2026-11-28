/**
 * How large a picture is opened, read off its own shape and the window's.
 *
 * Opened, a picture is as large as the window allows — that is what opening
 * one is for. Nothing is invented by it: growing a raster picture does not
 * put back detail its bytes do not hold, and a blurry one is a blurry one
 * at any size. But small and sharp is not the same as large and soft when
 * what is in the picture is words: the same pixels, twice or three times
 * the size on the screen, are the difference between a screenshot that is
 * a decoration and one that can be read. That is why every viewer a person
 * already uses — the system's own, and every chat's — grows a small picture
 * to the window when it is opened, rather than framing it at the size it
 * already was. A lightbox that shows a picture no bigger than it stood on
 * the page is a frame around the same picture, and there is no zoom here to
 * make up for it: too large is closed with a press, too small is a dead end.
 *
 * The margin is the 32 on every side the lightbox leaves. In a window
 * smaller than that the picture is simply what fits.
 */
export function fitFrame(natural: { w: number; h: number }, window: { w: number; h: number }): { w: number; h: number } {
  const wide = Math.max(1, window.w - 64)
  const tall = Math.max(1, window.h - 64)
  const k = Math.min(wide / natural.w, tall / natural.h)
  return { w: Math.max(1, Math.round(natural.w * k)), h: Math.max(1, Math.round(natural.h * k)) }
}
