/**
 * Which theme, and who decided.
 *
 * Three answers and not two. A switch with only light and dark takes the
 * choice away from the machine for ever: somebody who turns their laptop dark
 * at sunset would have to come back here and do it again. "System" is the
 * default and the way back to it.
 *
 * The value lives on the device. It is not a workspace setting — two people
 * in one workspace do not have to agree about it, and a theme that travelled
 * with the account would follow somebody from a dark room to a bright one.
 */
export type Theme = 'system' | 'light' | 'dark'

const KEY = 'theme'

export function readTheme(): Theme {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}

/** What the machine says, for when nobody has said anything else. */
function fromSystem(): 'light' | 'dark' {
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme === 'system' ? fromSystem() : theme
  /*
   * And the window's own bar with it.
   *
   * An installed copy takes its title bar from `theme-color`, and left alone
   * that is whatever the manifest said on the day it was installed — one
   * colour for ever, so a dark app sat under a white bar. Read from the token
   * rather than written twice: the page's ground and the bar above it are one
   * colour, and a second copy of it is a copy that drifts.
   *
   * The shell sets an approximation before the stylesheet arrives, because a
   * bar that corrects itself a beat later is a white flash on every start.
   */
  const canvas = getComputedStyle(document.documentElement).getPropertyValue('--canvas').trim()
  if (!canvas) return
  let bar = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  if (!bar) {
    bar = document.createElement('meta')
    bar.name = 'theme-color'
    document.head.appendChild(bar)
  }
  bar.content = canvas
}

export function writeTheme(theme: Theme): void {
  try {
    if (theme === 'system') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, theme)
  } catch {
    // Blocked storage: the theme still changes, it just will not be
    // remembered — which is better than refusing to change it.
  }
  applyTheme(theme)
}

/**
 * Follow the machine while nobody has overruled it.
 *
 * Without this, choosing "System" and then turning the laptop dark leaves the
 * app light until it is reloaded — the setting says "follow" and it does not.
 */
export function watchSystem(): () => void {
  const media = matchMedia('(prefers-color-scheme: dark)')
  const onChange = () => {
    if (readTheme() === 'system') applyTheme('system')
  }
  media.addEventListener('change', onChange)
  return () => media.removeEventListener('change', onChange)
}
