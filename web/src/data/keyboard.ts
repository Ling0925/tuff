/**
 * Whether a phone's keyboard is up.
 *
 * The air kept at a phone's foot is for its tabs and its home indicator,
 * and with the keyboard up neither is there: the line to write on stood a
 * thumb's width above the keys. Said on the root as `data-keyboard`, and
 * `theme.css` takes the foot's air away.
 *
 * Two ways of knowing, because neither is enough alone. The visual viewport
 * shrinks by the keyboard's height in most browsers; an installed iPhone
 * app shrinks the window with it, and the difference is nothing. So a
 * field, a text area or a body being written in on a touch screen is also
 * taken as the keyboard being up — it is, the moment one has the caret.
 *
 * And how tall the window is: `--app-h`, the visual viewport's height, on a
 * touch screen. The shell was `100dvh` tall, and `dvh` follows the
 * browser's bars, not the keyboard — so with the keyboard up the shell was
 * taller than what could be seen, the page itself scrolled under the room's
 * own scroller, and the line to write on stood wherever the page had been
 * scrolled to. Measured, the window is what is above the keyboard and
 * Safari's strip over it, and the page is held at its top.
 */
export function watchKeyboard(): void {
  const root = document.documentElement
  const touch = matchMedia('(pointer: coarse)').matches
  const writing = () => {
    const el = document.activeElement as HTMLElement | null
    if (!el) return false
    if (el.isContentEditable) return true
    if (el.tagName === 'TEXTAREA') return true
    return el.tagName === 'INPUT' && !/^(checkbox|radio|button|submit|file|range|color)$/.test((el as HTMLInputElement).type)
  }
  const vv = window.visualViewport
  const read = () => {
    const shrunk = vv ? window.innerHeight - vv.height > 150 : false
    root.toggleAttribute('data-keyboard', shrunk || (touch && writing()))
    /* Inside the app only: a public page scrolls the document, and writing
       a property on the root at every fold of Safari's bars restyles the
       whole page while it is being scrolled. Until the shell is there it
       is `100dvh`, which is right with no keyboard up. */
    if (!touch || !vv || !document.querySelector('[data-app-shell]')) return
    /*
     * A document or a task being written runs on under the keys, as
     * Notion's does: the window keeps its whole height, the words show
     * through the dock's glass and Safari's strip, and the scroller's
     * spacer grows by the keys (`--under` in the theme) so the last line
     * still scrolls clear of them. A room's line to write on, and a
     * window over the screen, still end on the keys.
     */
    const el = document.activeElement as HTMLElement | null
    const under = shrunk && !!document.querySelector('[data-phone-dock]') && !el?.closest('[role="dialog"]')
    root.toggleAttribute('data-under', under)
    const k = `${Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop))}px`
    if (root.style.getPropertyValue('--keys') !== k) root.style.setProperty('--keys', k)
    const h = `${Math.round(under ? window.innerHeight : vv.height)}px`
    if (root.style.getPropertyValue('--app-h') !== h) root.style.setProperty('--app-h', h)
    hold()
  }
  /*
   * The page a browser scrolled to bring a field into view: the window is
   * already the height of what can be seen, so there is nothing to bring.
   *
   * Only inside the app, and only with the keyboard up. It ran on every
   * page, and Safari's bars folding away as the landing was scrolled is a
   * resize of the visual viewport — so the landing was put back at its top
   * the moment anybody began to scroll it.
   */
  const hold = () => {
    if (!touch || window.scrollY === 0) return
    if (!root.hasAttribute('data-keyboard') || !document.querySelector('[data-app-shell]')) return
    window.scrollTo(0, 0)
  }
  /*
   * The line being written stays above the keys.
   *
   * A tap low on a document put the caret where the keys were about to
   * be, and Safari answered by sliding the whole window up — the bar, the
   * title, everything — until the caret showed; the window was then put
   * back at its top and shrunk, and the caret was left under the keys.
   * Notion's page does not move: the words under the caret scroll up
   * inside their own scroller, and the window stays where it is.
   *
   * So as the caret lands, the words' own scroller brings it clear of
   * where the keys will be — the last keyboard's height, or half the
   * screen before there was one — and the dock over them. Safari then
   * finds the caret in view and has nothing to slide.
   */
  let keys = 0
  const DOCK = 56 + 16
  const scroller = (el: HTMLElement): HTMLElement | null => {
    for (let at = el.parentElement; at; at = at.parentElement) {
      const y = getComputedStyle(at).overflowY
      if ((y === 'auto' || y === 'scroll') && at.scrollHeight > at.clientHeight) return at
    }
    return null
  }
  const reveal = () => {
    if (!touch || !document.querySelector('[data-app-shell]')) return
    const el = document.activeElement as HTMLElement | null
    if (!el?.isContentEditable) return
    const sel = document.getSelection()
    if (!sel?.rangeCount) return
    const range = sel.getRangeAt(0)
    let r = range.getBoundingClientRect()
    /* A caret on an empty line has no box of its own; its line does. */
    const at = range.startContainer
    if (!r.height) r = (at instanceof Element ? at : at.parentElement)?.getBoundingClientRect() ?? r
    if (!r.height) return
    const shown = vv ? window.innerHeight - vv.height > 150 : false
    const floor = shown && vv ? vv.height - DOCK : window.innerHeight - (keys || window.innerHeight / 2) - DOCK
    if (r.bottom <= floor) return
    const box = scroller(el)
    if (box) box.scrollTop += r.bottom - floor
  }
  let landing = 0
  document.addEventListener('selectionchange', () => {
    /* And while writing under the keys, every line the caret goes down
       to: nothing ends the scroller above them any more. */
    if (performance.now() - landing < 600 || root.hasAttribute('data-under')) reveal()
  })
  vv?.addEventListener('resize', () => {
    if (vv && window.innerHeight - vv.height > 150) keys = window.innerHeight - vv.height
    read()
    reveal()
  })
  vv?.addEventListener('scroll', hold)
  /* After the focus has landed, not as it leaves one field for the next. */
  document.addEventListener('focusin', () => {
    landing = performance.now()
    read()
    reveal()
    /* The dock comes up a frame after the caret. */
    requestAnimationFrame(read)
  })
  document.addEventListener('focusout', () => setTimeout(read, 50))
  read()
}
