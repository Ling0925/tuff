/**
 * Turning notifications on for this browser.
 *
 * Asked from Settings and nowhere else. A permission prompt on the first
 * paint is the one people deny for ever, and a denial cannot be asked again
 * from a web page — the browser remembers it, and the only way back is
 * through the site settings, which nobody finds.
 */
import { api } from './api.js'
import { onHost } from './host.js'
import { PUSH } from '../words/push.js'

export type PushState =
  | 'unsupported' // no service worker or no Push API: an old browser, or iOS in a tab
  | 'unavailable' // this deployment has no VAPID keys
  | 'denied' // asked once and refused; the browser will not ask again
  | 'off'
  | 'on'

/**
 * The base64url the server sends, as the bytes `subscribe` wants.
 *
 * Its own buffer, not a view into a shared one: `applicationServerKey` is
 * typed as an `ArrayBuffer`, and a `Uint8Array` in this TypeScript may be
 * backed by a `SharedArrayBuffer`, which it is not.
 */
function keyBytes(key: string): ArrayBuffer {
  const padded = key.replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
  const out = new ArrayBuffer(raw.length)
  const bytes = new Uint8Array(out)
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return out
}

/* Never on a workspace's own domain: a subscription would outlive the
   session that made it. */
export const canPush = (): boolean =>
  typeof navigator !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && !onHost()

async function worker(): Promise<ServiceWorkerRegistration> {
  return navigator.serviceWorker.register('/sw.js', { scope: '/' })
}

/**
 * Whether this browser is on, without asking it anything.
 *
 * Three things have to agree — the browser's permission, a registration, and
 * a row on the server — and any of them can end without the others hearing.
 * A switch that reads only one of them is a switch that is wrong the first
 * time somebody clears their site data.
 */
export async function pushState(key: string | null): Promise<PushState> {
  if (!canPush()) return 'unsupported'
  if (!key) return 'unavailable'
  if (Notification.permission === 'denied') return 'denied'
  if (Notification.permission !== 'granted') return 'off'
  const reg = await navigator.serviceWorker.getRegistration('/')
  const sub = await reg?.pushManager.getSubscription()
  if (!sub) return 'off'
  /*
   * And the row, said again rather than asked about.
   *
   * The browser keeps its subscription whether or not the server ever heard
   * of it, so a send that failed once left the switch reading "on" over a
   * device nothing could be pushed to. Telling the server again is safe — the
   * endpoint is the device's identity and the row is replaced, not doubled —
   * and it is the only answer that makes "on" true rather than merely likely.
   */
  try {
    return (await tell(sub)) ? 'on' : 'off'
  } catch {
    return 'off'
  }
}

/** Hands the server this browser's subscription; false if it has no keys to give. */
async function tell(sub: PushSubscription): Promise<boolean> {
  const raw = sub.toJSON() as { endpoint?: string; keys?: { p256dh: string; auth: string } }
  if (!raw.endpoint || !raw.keys) return false
  await api('/push', {
    method: 'POST',
    body: JSON.stringify({ endpoint: raw.endpoint, keys: raw.keys, said: said() }),
  })
  return true
}

/** What said it, so a person can tell their machines apart in a list. */
function said(): string {
  const ua = navigator.userAgent
  const where = /Mac/.test(ua)
    ? 'Mac'
    : /Windows/.test(ua)
      ? 'Windows'
      : /iPhone|iPad/.test(ua)
        ? 'iPhone'
        : /Android/.test(ua)
          ? 'Android'
          : PUSH.unknownSystem
  const what = /Edg\//.test(ua)
    ? 'Edge'
    : /Chrome\//.test(ua)
      ? 'Chrome'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Safari\//.test(ua)
          ? 'Safari'
          : PUSH.aBrowser
  return PUSH.browserOn(what, where)
}

export async function pushOn(key: string): Promise<PushState> {
  if (!canPush()) return 'unsupported'
  // From the click, not before it: Safari refuses a request that did not come
  // out of a gesture, and every browser treats one that did more kindly.
  const answer = await Notification.requestPermission()
  if (answer !== 'granted') return answer === 'denied' ? 'denied' : 'off'

  const reg = await worker()
  await navigator.serviceWorker.ready
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      // Always. A subscription that could send without showing anything is
      // one the browser will revoke, and rightly.
      userVisibleOnly: true,
      applicationServerKey: keyBytes(key),
    }))

  return (await tell(sub)) ? 'on' : 'off'
}

/**
 * Whether this is the copy in the dock or a tab.
 *
 * The number on the icon needs an icon, which a tab has not got: the call
 * does nothing in one and says nothing, and "no dot" then means "no dot yet"
 * for two entirely different reasons. So the screen says which.
 */
export const installed = (): boolean => typeof window !== 'undefined' && window.matchMedia('(display-mode: standalone)').matches

export type Drew = 'drawn' | 'nothing-to-draw-with' | 'refused'

/**
 * One, now, to see that it arrives.
 *
 * Through the service worker's own `showNotification`, which is the same call
 * a push ends in — so this proves everything between the browser and the
 * screen: the worker is alive, the permission is real, and the operating
 * system was asked. What it does not prove is the delivery, and that is the
 * point: when nothing arrives, this says in one press which half to look at.
 *
 * It reads the notification back afterwards. A browser that has drawn one
 * keeps it on the registration, so `drawn` with nothing on the screen is not
 * a mystery — it is the operating system declining to show what the browser
 * handed it, which is a setting on the machine and not anything the product
 * can reach. Saying so is the whole difference between a feature that is
 * broken and one that is switched off somewhere else.
 *
 * Product, not a debug hatch. Somebody who has just switched notifications on
 * wants to know they work, and the alternative is waiting for a colleague to
 * do something and wondering.
 */
export async function pushProbe(): Promise<Drew> {
  if (!canPush() || Notification.permission !== 'granted') return 'nothing-to-draw-with'
  const reg = await navigator.serviceWorker.getRegistration('/')
  if (!reg) return 'nothing-to-draw-with'
  try {
    await reg.showNotification(PUSH.probeTitle, {
      body: PUSH.probeBody,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: 'probe',
      /* Pressed twice, said twice. One tag so they do not pile up, and
         `renotify` so the second press is not a silent replacement that
         reads as the button having stopped working.
         
         Cast because the DOM types this browser was built against have no
         `renotify` — it is in the notifications spec and in every browser
         that has a service worker, and dropping it to satisfy a type
         definition would be the type winning an argument about behaviour. */
      renotify: true,
      data: { url: '/' },
    } as NotificationOptions & { renotify: boolean })
  } catch {
    return 'refused'
  }
  const drawn = await reg.getNotifications({ tag: 'probe' })
  return drawn.length > 0 ? 'drawn' : 'refused'
}

export async function pushOff(): Promise<PushState> {
  const reg = await navigator.serviceWorker.getRegistration('/')
  const sub = await reg?.pushManager.getSubscription()
  if (sub) {
    // The server first: a subscription dropped locally and left on the server
    // is a row that keeps being sent to and answers 410 for ever.
    await api('/push/off', { method: 'POST', body: JSON.stringify({ endpoint: sub.endpoint }) })
    await sub.unsubscribe()
  }
  return 'off'
}

/**
 * The number on the icon, for a copy that lives in the dock.
 *
 * The Badging API, which an installed app has and a tab does not — so this
 * says nothing and breaks nothing in a browser window, and puts a dot on the
 * icon of a copy somebody added to their dock or home screen. The unread
 * count is the only number the product has that belongs there: it is what is
 * addressed to you and not yet read.
 *
 * Set from the app whenever the inbox is read, and again from the service
 * worker when a push lands — the app is usually not running at that moment,
 * which is the whole point of the icon carrying it.
 */
export function badge(count: number): void {
  const nav = navigator as Navigator & {
    setAppBadge?: (n?: number) => Promise<void>
    clearAppBadge?: () => Promise<void>
  }
  try {
    if (count > 0) void nav.setAppBadge?.(count)
    else void nav.clearAppBadge?.()
  } catch {
    /* An older browser, or a tab rather than an installed copy. */
  }
}
