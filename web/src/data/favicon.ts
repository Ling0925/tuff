/**
 * A red dot on the tab's icon while something is waiting.
 *
 * The number on an installed app's icon has nowhere to go in a browser tab,
 * and a tab among twenty is the place somebody looks for "is there anything
 * for me". Basecamp's dot is the answer people already know: the same mark,
 * a red dot in its corner, and nothing at all when there is nothing.
 *
 * Drawn on a canvas from the icon the tab wears, once per change, and put
 * back exactly as it was when the dot goes.
 *
 * The icon worn is Tuff's, or a branded workspace's mark while that
 * workspace is open (`faviconWorn`, `data/brand.ts`): the dot is drawn over whichever it is.
 */
let base: HTMLImageElement | null = null
let baseFor: string | null = null
let plain: string | null = null
let worn: string | null = null
let shown = false

function link(): HTMLLinkElement | null {
  return document.querySelector<HTMLLinkElement>('link[rel="icon"]')
}

/** The icon under the dot: the workspace's when one is worn, else the page's own. */
function under(el: HTMLLinkElement): string {
  plain ??= el.href
  return worn ?? plain
}

function paint(): void {
  const el = link()
  if (!el) return
  const icon = under(el)
  if (!shown) {
    if (el.href !== icon) el.href = icon
    return
  }
  const draw = () => {
    if (!shown || !base || baseFor !== under(el)) return
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
    try {
      el.href = c.toDataURL('image/png')
    } catch {
      /* A picture from another origin that would not be read back: the
         icon without its dot, rather than no icon. */
      el.href = under(el)
    }
  }
  if (base && baseFor === icon && base.complete) return draw()
  base = new Image()
  baseFor = icon
  base.crossOrigin = 'anonymous'
  base.onload = draw
  /* A picture that will not load, or not across origins: the icon as it
     is, without the dot, rather than whatever was there before. */
  base.onerror = () => {
    if (baseFor === icon) el.href = icon
  }
  base.src = icon
}

export function faviconDot(on: boolean): void {
  if (typeof document === 'undefined' || on === shown) return
  shown = on
  paint()
}

/**
 * The icon the tab wears under any dot: a workspace's mark, drawn as an
 * image's address, or null for the page's own — `data/brand.ts`.
 */
export function faviconWorn(href: string | null): void {
  if (typeof document === 'undefined' || href === worn) return
  const el = link()
  if (el) plain ??= el.href
  worn = href
  paint()
}
