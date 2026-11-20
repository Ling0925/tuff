/**
 * A sound when something is said to you — `docs/specs/chime.md`.
 *
 * Drawn by the browser rather than played from a file: two soft sine notes a
 * fifth apart, a sixth of a second, quiet. No asset to ship or to cache, and
 * nothing to decode on the first message of the day.
 *
 * On this device only, like the theme: a sound is about the room somebody is
 * sitting in.
 */
const KEY = 'chime'
let ctx: AudioContext | null = null
let last = 0

export function chimeOn(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off'
  } catch {
    return true
  }
}

export function setChime(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off')
  } catch {
    // A browser that keeps nothing keeps the sound on.
  }
  // Turned on where it was off from the start: made now, out of the press.
  if (on && readied) whenIdle(make)
}

/*
 * The context is made while nothing is happening and only *started* by a
 * press. Making one is where the cost is — about 200 ms on the main thread in
 * Chrome, the audio device being opened — and it was made inside the first
 * press, so somebody whose first act of the day was lifting a card on the
 * board had the lift stand still for a fifth of a second. Starting one that
 * is already made costs nothing in the press: `resume()` returns at once and
 * the device starts off the main thread.
 *
 * Made before anybody has touched the page, it starts suspended, which is
 * what every browser allows and what Safari needs: WebKit starts audio only
 * from inside a press, so the press has to have something to start. Chrome
 * and Firefox remember a press for the life of the page, so there it would
 * start later too; it is the same code for both.
 *
 * Every press asks, not only the first, and cheaply: on a phone it is the
 * finger lifting that counts as a press rather than it landing, and iOS
 * suspends audio again behind a call or a locked screen.
 */
let readied = false

function make(): void {
  if (ctx || !chimeOn() || typeof AudioContext === 'undefined') return
  try {
    ctx = new AudioContext()
  } catch {
    return // No audio here; nothing to say.
  }
  // Pressed already, in a browser that remembers it: started without waiting.
  if (navigator.userActivation?.hasBeenActive) wake()
}

function wake(): void {
  if (ctx && ctx.state !== 'running' && ctx.state !== 'closed') void ctx.resume().catch(() => {})
}

function whenIdle(f: () => void): void {
  if ('requestIdleCallback' in window) window.requestIdleCallback(f, { timeout: 3000 })
  else setTimeout(f, 1500)
}

export function readyChime(): void {
  if (readied) return
  readied = true
  whenIdle(make)
  for (const word of ['pointerdown', 'pointerup', 'touchend', 'keydown'] as const)
    window.addEventListener(word, wake, { capture: true, passive: true })
}

/** The sound itself — once a second at most, however many arrive together. */
export function chime(): void {
  if (!chimeOn() || !ctx || ctx.state !== 'running') return
  const now = Date.now()
  if (now - last < 1000) return
  last = now
  const t = ctx.currentTime
  for (const [freq, at] of [
    [880, 0],
    [1318.5, 0.08],
  ] as const) {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = freq
    gain.gain.setValueAtTime(0, t + at)
    gain.gain.linearRampToValueAtTime(0.08, t + at + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + at + 0.35)
    osc.connect(gain).connect(ctx.destination)
    osc.start(t + at)
    osc.stop(t + at + 0.4)
  }
}

/* The room on the screen, said by the room itself, so a message arriving in
   the room somebody is reading makes no sound — they are already looking. */
let lookingAt: string | null = null
export function looking(room: string | null): void {
  lookingAt = room
}
export function watching(room: string): boolean {
  return lookingAt === room && document.visibilityState === 'visible' && document.hasFocus()
}
