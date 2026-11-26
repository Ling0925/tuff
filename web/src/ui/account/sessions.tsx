import { useState, useCallback, useEffect } from 'react'
import { onHost } from '../../data/host.js'
import { dayMonth, HEADS, MORE, SAYS } from '../../data/words.js'
import { ACCOUNT as W } from '../../words/account.jsx'
import { api } from '../../data/api.js'
import { remember, recall } from '../../data/memory.js'
import { known, ahead } from '../../data/ahead.js'
import { SectionHead, quietLook, Empty, Panel, Hairline, RowActions, Button } from '../kit.jsx'
import { pushState, type PushState, type Drew, installed, pushOff, pushOn, pushProbe, badge } from '../../data/push.js'
import { Line } from './line.jsx'

/*
 * Every zone the browser knows, each with its offset now — "Europe/Paris ·
 * GMT+1" — worked out once, on the first open of the list. The one the
 * account holds is kept even if this browser does not know it, so the
 * list never shows something other than what is saved.
 */
let ZONES: { id: string; label: string }[] | null = null

export function zones(current: string | null | undefined): { id: string; label: string }[] {
  if (!ZONES) {
    let ids: string[] = []
    try {
      ids = (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf('timeZone')
    } catch {
      ids = []
    }
    if (!ids.includes('UTC')) ids = ['UTC', ...ids]
    const now = new Date()
    ZONES = ids.map((id) => {
      let offset = ''
      try {
        offset =
          new Intl.DateTimeFormat('en-US', { timeZone: id, timeZoneName: 'shortOffset' })
            .formatToParts(now)
            .find((p) => p.type === 'timeZoneName')?.value ?? ''
      } catch {
        offset = ''
      }
      return { id, label: `${id.replaceAll('_', ' ')}${offset ? ` · ${offset}` : ''}` }
    })
  }
  return current && !ZONES.some((z) => z.id === current) ? [{ id: current, label: current }, ...ZONES] : ZONES
}

type Session = {
  id: string
  user_agent: string | null
  ip: string | null
  created_at: string
  last_used_at: string | null
  /** The device asking. */
  current?: boolean
}

/**
 * A device, said as a person would: "Safari on iPhone", not the browser's
 * own two hundred characters of history.
 */
export function deviceOf(ua: string | null): string {
  if (!ua) return W.unknownDevice
  if (/^curl\//i.test(ua)) return 'curl'
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\//.test(ua)
      ? 'Opera'
      : /Firefox\/|FxiOS/.test(ua)
        ? 'Firefox'
        : /Chrome\/|CriOS/.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : null
  const system = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /Mac OS X|Macintosh/.test(ua)
          ? 'Mac'
          : /Windows/.test(ua)
            ? 'Windows'
            : /Linux/.test(ua)
              ? 'Linux'
              : null
  if (browser && system) return W.browserOn(browser, system)
  return browser ?? system ?? ua.split(/[\s/]/)[0] ?? W.unknownDevice
}

/** "Active today", "yesterday", "3 days ago", then the date. */
function lastSeen(at: string): string {
  const days = Math.floor((Date.now() - new Date(at).getTime()) / 86_400_000)
  if (days <= 0) return W.activeToday
  if (days === 1) return W.activeYesterday
  if (days < 7) return W.activeDaysAgo(days)
  return W.activeOn(dayMonth(new Date(at)))
}

/**
 * Where this account is signed in.
 *
 * One line a device, this one first and said so, each with when it was last
 * used and from where; any other signed out from its line, or all of them at
 * once. It showed one line a sign-in, and a sign-in was every switch of
 * workspace and every refresh that lost its device's name: two devices read
 * as fifteen, most of them "Unknown device".
 */
export function Sessions() {
  const [rows, setRows] = useState<Session[] | null>(() => {
    const got = known<{ sessions: Session[] }>('/sessions')?.sessions
    return got ? [...got.filter((s) => s.current), ...got.filter((s) => !s.current)] : null
  })
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const got = (await ahead<{ sessions: Session[] }>('/sessions')).sessions
    // This device first; the rest newest first, as they came.
    setRows([...got.filter((s) => s.current), ...got.filter((s) => !s.current)])
  }, [])
  useEffect(() => void load().catch(() => setRows([])), [load])
  const others = (rows ?? []).filter((s) => !s.current).length

  return (
    <section className="mt-9 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-4">
        <SectionHead>{HEADS.signedIn}</SectionHead>
        {others > 0 && (
          <button
            data-testid="end-other-sessions"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              // Gone from the list at the press; the server's answer agrees.
              setRows((had) => (had ?? []).filter((s) => s.current))
              await api('/sessions', { method: 'DELETE' }).catch(() => undefined)
              await load().catch(() => undefined)
              setBusy(false)
            }}
            className="inline-flex h-8 shrink-0 items-center rounded-full px-4 text-sm font-medium transition-transform active:scale-[0.97] disabled:opacity-40"
            style={quietLook}
          >
            {others === 1 ? W.signOutOther : W.signOutOthers(others)}
          </button>
        )}
      </div>
      {rows && rows.length === 0 && <Empty>{MORE.onlyHere}</Empty>}
      {(rows ?? []).length > 0 && (
        <Panel>
          {(rows ?? []).map((s, i) => (
            <div key={s.id} className="contents">
              {i > 0 && <Hairline inset={16} />}
              <div data-session data-current={s.current || undefined} className="group flex min-h-[56px] items-center gap-3 px-4 py-3">
                <div className="flex min-w-px flex-1 flex-col gap-1">
                  <span className="truncate text-base text-ink">{deviceOf(s.user_agent)}</span>
                  <span className="truncate text-sm" style={{ color: s.current ? 'var(--accent)' : 'var(--ink-3)' }}>
                    {[s.current ? W.thisDevice : lastSeen(s.last_used_at ?? s.created_at), s.ip].filter(Boolean).join(' · ')}
                  </span>
                </div>
                {!s.current && (
                  <RowActions>
                    <button
                      data-testid="end-session"
                      onClick={async () => {
                        setRows((had) => (had ?? []).filter((r) => r.id !== s.id))
                        await api(`/sessions/${s.id}`, { method: 'DELETE' }).catch(() => undefined)
                        await load().catch(() => undefined)
                      }}
                      className="text-sm text-ink-3"
                    >
                      {W.signOut}
                    </button>
                  </RowActions>
                )}
              </div>
            </div>
          ))}
        </Panel>
      )}
    </section>
  )
}

/**
 * Notifications on this machine, asked for here and nowhere else.
 *
 * A permission prompt on the first paint is the one people deny for ever, and
 * a denial cannot be asked again from a web page — the browser remembers it
 * and the only way back is through the site settings, which nobody finds. So
 * the person who wants them comes and turns them on, which is fewer people
 * than a prompt would catch and every one of them meant it.
 */
/*
 * Whether this browser takes notifications, worked out ahead — for the
 * account screen to wait on, so this row is drawn with the rest and does
 * not arrive after them. Remembered for the tab. `data/ahead.ts`.
 */
let pushAsk: Promise<void> | null = null
export function warmPush(): Promise<void> {
  /* Nothing is asked about push on a workspace's own domain. */
  if (onHost()) return Promise.resolve()
  pushAsk ??= ahead<{ key: string | null }>('/push')
    .then(async (r) => void remember('push:state', await pushState(r.key)))
    .catch(() => {})
    .finally(() => {
      pushAsk = null
    })
  return pushAsk
}
export const pushKnown = () => recall<PushState>('push:state') !== null

export function OnThisDevice() {
  const [key, setKey] = useState<string | null>(() => known<{ key: string | null }>('/push')?.key ?? null)
  const [devices, setDevices] = useState<{ id: string; said: string | null }[]>([])
  const [state, setState] = useState<PushState | null>(() => recall<PushState>('push:state'))
  const [drew, setDrew] = useState<Drew | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const r = await ahead<{ key: string | null; devices: { id: string; said: string | null }[] }>('/push')
    setKey(r.key)
    setState(remember('push:state', await pushState(r.key)))
    /* After, not before: `pushState` may just have told the server about this
       browser, and the list read first would not have it in. */
    const again = await api<{ devices: { id: string; said: string | null }[] }>('/push')
    setDevices(again.devices ?? [])
  }, [])
  useEffect(() => void load(), [load])

  if (!state) return null

  /* Said plainly, because every one of these is a different thing to do next
     and "notifications are off" would be the same sentence for all of them. */
  const SAID: Record<PushState, string> = {
    unsupported: W.pushUnsupported,
    unavailable: W.pushUnavailable,
    denied: W.pushDenied,
    off: W.pushOff,
    on: W.pushOn,
  }

  return (
    <div>
      <Line
        label={W.thisDevice}
        hint={
          <span data-push-state={state}>
            {SAID[state]}
            {state === 'on' && !installed() && <span data-not-installed> {W.installForCount}</span>}
          </span>
        }
        wrap
      >
        <Button
          data-testid="push-switch"
          tone={state === 'on' ? 'quiet' : 'primary'}
          disabled={busy || state === 'unsupported' || state === 'unavailable' || state === 'denied'}
          onClick={async () => {
            setBusy(true)
            try {
              setState(state === 'on' ? await pushOff() : await pushOn(key ?? ''))
              await load()
            } finally {
              setBusy(false)
            }
          }}
        >
          {state === 'on' ? W.turnOff : W.turnOn}
        </Button>
        {/* Only once they are on, because before that there is nothing to
            show and a button that explains why it cannot is worse than no
            button. */}
        {state === 'on' && (
          <button
            data-control
            data-testid="push-probe"
            className="flex h-7 items-center px-2 text-sm font-medium text-accent"
            style={{ borderRadius: 'var(--r-field)' }}
            onClick={async () => {
              setDrew(await pushProbe())
              /* And the number, so the icon of an installed copy shows what
                 it will look like at the same moment the notification does. */
              const inbox = await api<{ unread: Record<string, string> }>('/inbox?unread=1')
              badge(Object.values(inbox.unread).reduce((n, v) => n + Number(v), 0))
            }}
          >
            {MORE.showMeOne}
          </button>
        )}
      </Line>

      {/*
        What happened when we drew one, because otherwise nothing did and
        there is no way to tell that from a feature that does not work.

        A browser keeps a notification it has drawn on the registration, so
        "drawn" and an empty screen is not a mystery: it is the operating
        system declining to show what the browser handed it, which is a
        setting on the machine and nothing the product can reach.
      */}
      {drew && (
        <p data-drew={drew} className="px-4 pb-3 text-sm text-ink-3">
          {drew === 'drawn' ? <>{W.probeSent}</> : drew === 'refused' ? <>{SAYS.browserWouldNotDraw}</> : <>{SAYS.nothingToDrawWith}</>}
        </p>
      )}

      {/* And whether the number has anywhere to go. `setAppBadge` does
          nothing in a tab and says nothing, so "no dot" would mean two
          different things with no way to tell them apart. */}

      {/* The other machines, because a subscription somebody has forgotten is
          a notification arriving on a laptop they left at the office. */}
      {devices.length > 0 && (
        <div>
          <>
            {devices.map((d) => (
              <div key={d.id} className="contents">
                <Hairline inset={16} />
                <div data-device className="group flex items-center gap-3 px-4 py-3 text-base">
                  <span className="min-w-px flex-1 truncate text-ink">{d.said ?? W.unknownBrowser}</span>
                  <RowActions>
                    <button
                      aria-label={W.stopOn(d.said ?? W.thisBrowser)}
                      className="text-sm text-ink-3"
                      onClick={async () => {
                        await api(`/push/${d.id}`, { method: 'DELETE' })
                        await load()
                      }}
                    >
                      {W.remove}
                    </button>
                  </RowActions>
                </div>
              </div>
            ))}
          </>
        </div>
      )}
    </div>
  )
}
