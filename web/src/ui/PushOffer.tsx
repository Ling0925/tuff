import { useEffect, useState } from 'react'
import { api } from '../data/api.js'
import { remember } from '../data/memory.js'
import { canPush, pushOn, pushState, type PushState } from '../data/push.js'
import { Icon } from './glyphs.jsx'
import { PUSH_OFFER as W } from '../words/pushOffer.js'

/**
 * Notifications offered where they matter, the first time somebody opens a
 * room.
 *
 * Our own card first, and the browser's question only from its button: a
 * prompt nobody asked for is the one people deny for ever, and a denial
 * cannot be asked again from a page. Offered once on this browser —
 * "Not now" and an answer either way both end it — and only where it can
 * work: push supported, keys on the server, not already on, not refused.
 * Standing on the line to write on, over the newest messages, so its
 * arrival moves nothing.
 */
const OFFERED = 'push-offered'

const offered = () => {
  try {
    return localStorage.getItem(OFFERED) !== null
  } catch {
    return true
  }
}
const done = () => {
  try {
    localStorage.setItem(OFFERED, new Date().toISOString())
  } catch {
    // Not kept: offered again next time, which is the lesser harm.
  }
}

export function PushOffer() {
  const [key, setKey] = useState<string | null>(null)
  const [shown, setShown] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (offered() || !canPush() || typeof Notification === 'undefined' || Notification.permission !== 'default') return
    let alive = true
    void api<{ key: string | null }>('/push')
      .then(async (r) => {
        if (!alive || !r.key) return
        const state: PushState = await pushState(r.key)
        if (!alive || state !== 'off') return
        setKey(r.key)
        setShown(true)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  const close = () => {
    done()
    setLeaving(true)
    setTimeout(() => setShown(false), 200)
  }

  if (!shown || !key) return null
  return (
    <div
      data-push-offer
      role="dialog"
      aria-label={W.turnOnNotifications}
      className="absolute inset-x-0 bottom-2 z-20 mx-auto flex w-[calc(100%-16px)] max-w-[440px] items-center gap-3 rounded-[16px] px-4 py-3 transition-[opacity,transform] duration-200 ease-[var(--ease-out)] starting:translate-y-2 starting:opacity-0 motion-reduce:transition-none bg-surface"
      style={{
        boxShadow: 'var(--card-shadow), inset 0 0 0 1px var(--line)',
        ...(leaving ? { opacity: 0, transform: 'translateY(8px)' } : {}),
      }}
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
        <Icon name="bell" size={16} />
      </span>
      <span className="min-w-px flex-1 text-base leading-[1.35] text-ink">{W.getOne}</span>
      <button
        type="button"
        data-testid="push-offer-later"
        onClick={close}
        className="h-8 shrink-0 rounded-full px-3 text-sm font-medium text-ink-2"
      >
        {W.notNow}
      </button>
      <button
        type="button"
        data-testid="push-offer-on"
        disabled={busy}
        onClick={() => {
          /* From the press itself: the browser asks only out of a gesture. */
          setBusy(true)
          void pushOn(key)
            .then((state) => remember('push:state', state))
            .catch(() => {})
            .finally(() => {
              setBusy(false)
              close()
            })
        }}
        className="h-8 shrink-0 rounded-full px-4 text-sm font-medium transition-transform active:scale-[0.97] bg-accent"
        style={{ color: '#fff' }}
      >
        {W.turnOn}
      </button>
    </div>
  )
}
