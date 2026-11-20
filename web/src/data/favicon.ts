/**
 * A red dot on the tab's icon while something is waiting.
 *
 * The number on an installed app's icon has nowhere to go in a browser tab,
 * and a tab among twenty is the place somebody looks for "is there anything
 * for me". Basecamp's dot is the answer people already know: the same mark,
 * a red dot in its corner, and nothing at all when there is nothing.
 *
 * Drawn on a canvas from the icon the page already has, once per change, and
 * put back exactly as it was when the dot goes.
 */
let base: HTMLImageElement | null = null
let plain: string | null = null
let shown = false

function link(): HTMLLinkElement | null {
  return document.querySelector<HTMLLinkElement>('link[rel="icon"]')
}

export function faviconDot(on: boolean): void {
  if (typeof document === 'undefined' || on === shown) return
  const el = link()
  if (!el) return
  plain ??= el.href
  shown = on
  if (!on) {
    el.href = plain
    return
  }
  const draw = () => {
    if (!shown || !base) return
    const size = 64
    const c = document.createElement('canvas')
    c.width = size
    c.height = size
    const g = c.getContext('2d')
    if (!g) return
    g.drawImage(base, 0, 0, size, size)
    /* Cut a ring out of the icon first, so the dot reads on any icon and any
       tab colour, then the dot in it. */
    const r = 15
    const x = size - r - 1
    const y = r + 1
    g.globalCompositeOperation = 'destination-out'
    g.beginPath()
    g.arc(x, y, r + 4, 0, Math.PI * 2)
    g.fill()
    g.globalCompositeOperation = 'source-over'
    g.fillStyle = '#ff3b30'
    g.beginPath()
    g.arc(x, y, r, 0, Math.PI * 2)
    g.fill()
    el.href = c.toDataURL('image/png')
  }
  if (base?.complete) return draw()
  base = new Image()
  base.onload = draw
  base.src = plain
}
