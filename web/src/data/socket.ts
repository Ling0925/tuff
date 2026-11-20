import { api, stored } from './api.js'

/**
 * A socket that comes back.
 *
 * Each of the three sockets (the shell's, a project's, a room's) opened once
 * and, when it closed, stayed closed: a deploy restarting the server, a
 * laptop waking, a Wi-Fi hop, a proxy timing an idle connection out. The page
 * looked live and heard nothing until it was reloaded — which is what "it is
 * as if the websocket falls off" was.
 *
 * This opens it again: at once when the browser says it is back online or the
 * tab comes to the front, otherwise after 1, 2, 4… up to 15 seconds, each
 * stretched by up to as much again at random. The
 * token it sends first is read fresh each time, after a cheap request that
 * renews it if it has run out. And on every reopening `onBack` runs, because
 * whatever was said while it was closed was said to nobody: the screen reads
 * itself again.
 */
export function keepOpen(
  path: string,
  onWord: (ev: MessageEvent) => void,
  onBack: () => void,
  /** Said when the socket goes, before it is opened again — a document's
      session stops sending until the server has spoken. */
  onDrop?: () => void,
): { send: (word: string) => void; stop: () => void } {
  let ws: WebSocket | null = null
  let stopped = false
  let wait = 1000
  let timer: ReturnType<typeof setTimeout> | null = null
  let dropped = false
  let heard = 0

  const open = async () => {
    if (stopped) return
    if (timer) clearTimeout(timer)
    timer = null
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return
    /* After a drop the token may have run out while nobody was asking: a
       read through `api` renews it, and the socket takes the new one. */
    if (dropped) await api('/me').catch(() => null)
    if (stopped) return
    const token = stored()?.access_token
    /* Nothing to hear in no workspace. */
    if (!token || stored()?.workspace_id === null) return
    let next: WebSocket
    try {
      /* Bare: the token goes in the first frame, not the address every
         proxy on the way logs. */
      next = new WebSocket(`${location.origin.replace(/^http/, 'ws')}${path}`)
    } catch {
      return later()
    }
    ws = next
    next.onmessage = (ev) => {
      heard = Date.now()
      if (ev.data === 'tick') return
      onWord(ev)
    }
    next.onopen = () => {
      next.send(`auth ${token}`)
      heard = Date.now()
      wait = 1000
      /* Read again a moment later, at a moment of its own: after a deploy
         every window comes back together, and each one reading its whole
         screen in the same second was a minute's ceiling in that second. */
      if (dropped) setTimeout(onBack, Math.random() * 2000)
      dropped = false
    }
    next.onclose = (ev) => {
      if (ws !== next) return
      ws = null
      dropped = true
      onDrop?.()
      /* Refused for good — a project or room this person may not see. Asking
         again every fifteen seconds would not change the answer. */
      if (ev.code === 4404) return
      later()
    }
  }
  const later = () => {
    if (stopped || timer) return
    /* Somewhere between the wait and twice it, so a thousand windows that
       lost the server together do not knock on it together. */
    timer = setTimeout(
      () => {
        timer = null
        void open()
      },
      wait * (1 + Math.random()),
    )
    wait = Math.min(wait * 2, 15_000)
  }
  const now = () => {
    wait = 1000
    void open()
  }
  /*
   * Back to the front after a while away — a laptop asleep, another app for
   * an hour — the socket may look open and be dead: the other end was lost
   * without a word. Opened again rather than trusted, and the screen reads
   * itself again with it.
   */
  const reopen = () => {
    if (!ws) return
    const was = ws
    ws = null
    dropped = true
    onDrop?.()
    was.onclose = null
    was.close()
    now()
  }
  let hiddenAt = 0
  const front = () => {
    if (document.visibilityState !== 'visible') {
      hiddenAt = Date.now()
      return
    }
    if (hiddenAt && Date.now() - hiddenAt > 60_000) reopen()
    hiddenAt = 0
    now()
  }
  /*
   * And while it is on the screen. The server says something every
   * twenty-five seconds on every socket; one that has said nothing for a
   * minute is open on this side only — dropped somewhere in between without
   * a word to either end — and is opened again rather than waited on.
   */
  const quiet = setInterval(() => {
    if (document.visibilityState !== 'visible') return
    if (ws?.readyState === WebSocket.OPEN && Date.now() - heard > 60_000) reopen()
  }, 10_000)
  window.addEventListener('online', now)
  document.addEventListener('visibilitychange', front)
  void open()

  return {
    send(word) {
      try {
        if (ws?.readyState === WebSocket.OPEN) ws.send(word)
      } catch {
        // The socket going down is the socket's business, not the sender's.
      }
    },
    stop() {
      stopped = true
      if (timer) clearTimeout(timer)
      clearInterval(quiet)
      window.removeEventListener('online', now)
      document.removeEventListener('visibilitychange', front)
      const was = ws
      ws = null
      was?.close()
    },
  }
}
