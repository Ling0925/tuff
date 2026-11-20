import { useCallback, useEffect, useState } from 'react'
import type { WaysIn as Ways } from '@tracker/shared-schema'
import { ACCOUNT as W } from '../words/account.jsx'
import { MORE } from '../data/words.js'
import { api, Refused } from '../data/api.js'
import { ahead, known } from '../data/ahead.js'
import { APPLE, GITHUB, GOOGLE } from './Access.jsx'
import { Button, Dialog, Hairline, InboxCode, Panel, SectionHead, quietLook } from './kit.jsx'

type Provider = Ways['offered'][number]
type Way = Ways['ways'][number]

const NAMES: Record<Provider, string> = { google: 'Google', apple: 'Apple', github: 'GitHub' }
const MARKS: Record<Provider, React.ReactNode> = { google: GOOGLE, apple: APPLE, github: GITHUB }

/** What the callback said on the way back — `?ways=` — once, then gone from the address. */
function cameBack(): string | null {
  const said = new URLSearchParams(window.location.search).get('ways')
  if (!said) return null
  window.history.replaceState(window.history.state, '', window.location.pathname)
  return said === 'added' ? W.wayAdded : said === 'taken' ? W.wayTaken : W.wayFailed
}

/**
 * What the account signs in with besides its email and password.
 * A row for each provider this deployment offers,
 * and one for each account connected there.
 *
 * Adding and removing both ask what signing in asks: a session alone is a
 * laptop left open, and a way in added from one outlives every sign-out.
 */
export function WaysIn() {
  const [ways, setWays] = useState<Ways | null>(() => known<Ways>('/me/ways-in') ?? null)
  const [said, setSaid] = useState<{ text: string; bad: boolean } | null>(() => {
    const text = cameBack()
    return text ? { text, bad: text !== W.wayAdded } : null
  })
  const [asking, setAsking] = useState<{ provider: Provider; way?: Way } | null>(null)
  const load = useCallback(async () => setWays(await ahead<Ways>('/me/ways-in')), [])
  useEffect(() => void load().catch(() => {}), [load])

  if (!ways || ways.offered.length === 0) return null
  /* Each connected account, and a Connect for a provider with none. */
  const rows = ways.offered.flatMap((p): { provider: Provider; way: Way | undefined }[] => {
    const mine = ways.ways.filter((w) => w.provider === p)
    return mine.length ? mine.map((way) => ({ provider: p, way })) : [{ provider: p, way: undefined }]
  })

  return (
    <section data-testid="ways-in" className="mt-9 flex flex-col gap-3">
      <SectionHead>{W.waysIn}</SectionHead>
      <Panel>
        {rows.map((r, i) => (
          <div key={r.way?.id ?? r.provider}>
            {i > 0 && <Hairline inset={52} />}
            <div data-way={r.provider} className="flex min-h-[56px] items-center gap-4 px-4 py-3">
              <span className="flex size-5 shrink-0 items-center justify-center text-ink">{MARKS[r.provider]}</span>
              <div className="flex min-w-px flex-1 flex-col gap-1">
                <span className="text-base text-ink">{NAMES[r.provider]}</span>
                <span className="truncate text-sm text-ink-3">{r.way ? (r.way.email ?? W.connected) : W.notConnected}</span>
              </div>
              <button
                data-testid={r.way ? `way-remove-${r.provider}` : `way-connect-${r.provider}`}
                data-control
                onClick={() => {
                  setSaid(null)
                  setAsking({ provider: r.provider, ...(r.way ? { way: r.way } : {}) })
                }}
                className="inline-flex h-8 shrink-0 items-center rounded-full px-4 text-sm font-medium transition-transform active:scale-[0.97]"
                style={quietLook}
              >
                {r.way ? W.remove : W.connect}
              </button>
            </div>
          </div>
        ))}
      </Panel>
      <p
        data-testid="ways-said"
        role={said?.bad ? 'alert' : undefined}
        className="px-4 text-sm"
        style={{ color: said?.bad ? 'var(--danger)' : 'var(--ink-3)' }}
      >
        {said?.text ?? W.waysHint}
      </p>
      {asking && (
        <Prove
          provider={asking.provider}
          {...(asking.way ? { way: asking.way } : {})}
          asks={ways.asks}
          onClose={() => setAsking(null)}
          onRemoved={() => {
            setSaid({ text: W.wayRemoved, bad: false })
            void load()
          }}
        />
      )}
    </section>
  )
}

/**
 * What signing in asks, before a way in is added or taken off: the
 * password and the code, or six digits from the inbox for an account with
 * neither. Adding then goes to the provider; removing is done here.
 */
function Prove({
  provider,
  way,
  asks,
  onClose,
  onRemoved,
}: {
  provider: Provider
  way?: Way
  asks: Ways['asks']
  onClose: () => void
  onRemoved: () => void
}) {
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<string | null>(null)
  const name = NAMES[provider]
  const ready = asks === 'email' ? code.trim().length > 0 : password.length > 0 && (asks !== 'password_and_code' || code.trim().length > 0)

  async function go() {
    if (!ready || busy) return
    setBusy(true)
    setSaid(null)
    const proof = JSON.stringify({ ...(asks !== 'email' ? { password } : {}), ...(asks !== 'password' ? { code: code.trim() } : {}) })
    try {
      if (way) {
        await api(`/me/ways-in/${way.id}`, { method: 'DELETE', body: proof })
        onRemoved()
        onClose()
      } else {
        const r = await api<{ url: string }>(`/me/ways-in/${provider}`, { method: 'POST', body: proof })
        /* Busy until the page goes: the provider is the next thing seen. */
        window.location.assign(r.url)
        return
      }
    } catch (e) {
      const status = e instanceof Refused ? e.status : 0
      setSaid(
        status === 403
          ? asks === 'password_and_code'
            ? W.wrongPasswordOrCode
            : asks === 'email'
              ? W.codeDidntWork
              : W.wrongPassword
          : status === 429
            ? W.tooManyAttempts
            : status === 409
              ? W.wayLast
              : way
                ? W.couldntRemove
                : W.wayFailed,
      )
    }
    setBusy(false)
  }

  const input = 'h-10 rounded-[var(--r-row)] px-3 text-base outline-none placeholder:text-[var(--ink-3)]'
  const ground = { background: 'var(--sunken)', color: 'var(--ink)' }
  return (
    <Dialog
      title={way ? W.removeWay(name) : W.connectWay(name)}
      testId="way-dialog"
      onClose={onClose}
      footer={
        <div className="flex flex-1 items-center justify-end gap-2">
          <button onClick={onClose} className="h-8 px-3 text-base font-medium text-ink-2">
            {MORE.cancel}
          </button>
          <Button tone={way ? 'danger' : 'primary'} data-testid="way-go" disabled={!ready || busy} onClick={() => void go()}>
            {way ? W.remove : W.continue}
          </Button>
        </div>
      }
    >
      <form
        className="flex flex-col gap-3 px-4 pt-2 pb-4"
        onSubmit={(e) => {
          e.preventDefault()
          void go()
        }}
      >
        {/* Twenty, not one and a half: two lines at 19.5 left the window half
            a pixel off the grid, and its height read 220 and 221 by turns. */}
        <p className="text-sm leading-5 text-ink-3">{way ? W.removeSays(name) : W.connectSays(name)}</p>
        {asks === 'email' ? (
          <InboxCode value={code} onChange={setCode} testId="way-inbox-code" purpose="ways" look={{ className: input, style: ground }} />
        ) : (
          <label className="flex flex-col gap-1">
            <span className="text-sm text-ink-3">{W.yourPassword}</span>
            <input
              autoFocus
              type="password"
              autoComplete="current-password"
              data-testid="way-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={input}
              style={ground}
            />
          </label>
        )}
        {asks === 'password_and_code' && (
          <label className="flex flex-col gap-1">
            <span className="text-sm text-ink-3">{W.codeOrRecovery}</span>
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              data-testid="way-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className={input}
              style={ground}
            />
          </label>
        )}
        {said && (
          <p role="alert" data-testid="way-said" className="text-sm text-danger">
            {said}
          </p>
        )}
        <button type="submit" hidden />
      </form>
    </Dialog>
  )
}
