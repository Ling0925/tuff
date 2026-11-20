import { useEffect, useState } from 'react'
import { isOnline, onReach } from '../data/api.js'
import { Icon } from './glyphs.jsx'
import { OFFLINE_BAND as W } from '../words/offlineBand.js'

/**
 * Whether this window can reach the server, said across the very top of it
 * — `docs/specs/offline.md`.
 *
 * Above everything and on every page, and pushing the window down rather
 * than covering it: the band's height is `--offline-h` on the root, which the
 * full-height pages subtract. Offline it says what the screen is showing;
 * back online it says so for two seconds and folds away.
 */
export function OfflineBand() {
  const [online, setOnline] = useState(isOnline)
  const [back, setBack] = useState(false)
  useEffect(
    () =>
      onReach((now) => {
        setOnline(now)
        if (now) {
          setBack(true)
          setTimeout(() => setBack(false), 2000)
        }
      }),
    [],
  )
  const shown = !online || back
  useEffect(() => {
    document.documentElement.style.setProperty('--offline-h', shown ? '28px' : '0px')
  }, [shown])

  return (
    <div
      data-offline-band={online ? (back ? 'back' : undefined) : 'offline'}
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 z-[100] flex items-center justify-center gap-2 overflow-hidden px-4 text-sm font-medium"
      style={{
        /* Under the phone's own band, not behind it. */
        top: 'var(--top-inset, 0px)',
        height: 'var(--offline-h, 0px)',
        background: online ? 'var(--tint-3)' : 'var(--ink)',
        color: online ? '#ffffff' : 'var(--canvas)',
      }}
    >
      {shown && (
        <>
          {!online && <Icon name="offline" size={14} />}
          {online ? (
            <span className="truncate">{W.backOnline}</span>
          ) : (
            <>
              {/* The whole sentence where it fits; on a phone, the half
                  that matters. */}
              <span className="truncate max-sm:hidden">{W.offline}</span>
              <span className="truncate sm:hidden">{W.offlineShort}</span>
            </>
          )}
        </>
      )}
    </div>
  )
}
