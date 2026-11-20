import { edition } from '../../edition.jsx'
import { useState, useCallback, useEffect } from 'react'
import { HEADS, MAKE, SAYS, MORE } from '../../data/words.js'
import { ACCOUNT as W } from '../../words/account.jsx'
import { api, Refused } from '../../data/api.js'
import { known, ahead } from '../../data/ahead.js'
import { Create } from '../Create.jsx'
import { SectionHead, Button, Empty, Panel, Hairline, RowActions, InboxCode } from '../kit.jsx'
import { type Token, day, type Factor, field, fieldStyle } from '../Account.jsx'
import { Line } from './line.jsx'

/**
 * Tokens: how an agent gets in, under the person's own name.
 *
 * The whole point of the MCP half of this product is that an agent works with
 * the person's permissions rather than its own. That needs a token, and until
 * this screen existed the only way to get one was to run a script on the
 * server — so the product's headline difference was unreachable from the
 * product.
 */
export function Tokens({ agents = true, onSettings }: { agents?: boolean; onSettings?: () => void }) {
  /* `null` until the first answer — see `Empty` in the kit. */
  const [tokens, setTokens] = useState<Token[] | null>(() => known<{ tokens: Token[] }>('/tokens')?.tokens ?? null)
  const [fresh, setFresh] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!agents) return
    setTokens((await ahead<{ tokens: Token[] }>('/tokens')).tokens)
  }, [agents])
  useEffect(() => void load(), [load])

  /* Agents held back in this workspace (`agent.use` not given): what the
     edition says instead of a button that is refused. Tokens made before
     stay, and work again once agents are. */
  if (!agents) return edition.TokensLocked ? <edition.TokensLocked {...(onSettings ? { onSettings } : {})} /> : null

  async function make(name: string) {
    const r = await api<{ token: string }>('/tokens', {
      method: 'POST',
      body: JSON.stringify({ name }),
    })
    // Shown once. It is stored hashed, so this is the only moment it exists in
    // readable form anywhere — and saying so is part of the screen.
    setFresh(r.token)
    await load()
  }

  const live = (tokens ?? []).filter((t) => !t.revoked_at)

  return (
    <section className="mt-9">
      <div className="flex items-center justify-between">
        <SectionHead>{HEADS.tokens}</SectionHead>
        <Create label={MAKE.newToken} placeholder={MAKE.whatIsItFor} onCreate={make} />
      </div>
      {/* Under the heading's own inset and at the size every section's
          words are, not twelve pixels reaching past the heading's edge. */}
      <p className="mt-1 px-1 text-sm leading-[18px] text-ink-3">{W.tokensAbout}</p>
      {/* An agent on the web connects by address and needs no token made
          here. Its token is listed below once
          it is connected, and revoking it disconnects it. */}
      <p className="mt-2 px-1 text-sm leading-[18px] text-ink-3">
        {W.connectOnTheWeb(
          <code data-testid="mcp-address" className="select-all text-ink-2">
            {location.origin}/mcp
          </code>,
          edition.help ? (
            <a href="/help/connect-chatgpt" target="_blank" rel="noreferrer" className="underline underline-offset-4">
              {W.howToConnect}
            </a>
          ) : null,
        )}
      </p>

      {fresh && (
        <div data-testid="fresh-token" className="mt-3 flex flex-col gap-2 p-3 text-sm bg-sunken" style={{ borderRadius: 'var(--r-row)' }}>
          <div className="text-ink-3">{SAYS.copyItNow}</div>
          <code className="block break-all select-all text-ink">{fresh}</code>
          <code className="text-ink-3">
            TUFF_TOKEN={fresh.slice(0, 8)}… TUFF_URL={location.origin}
          </code>
        </div>
      )}

      {/* The list every settings screen draws — a panel of rows with their
          one action behind the pointer, as a project's people are. */}
      <div className="mt-3">
        {tokens && live.length === 0 && <Empty>{SAYS.noneYet}</Empty>}
        {live.length > 0 && (
          <Panel>
            {live.map((t, i) => (
              <div key={t.id} className="contents">
                {i > 0 && <Hairline inset={14} />}
                <div data-token className="group flex items-center gap-3 px-4 py-3 text-base">
                  <span className="min-w-px flex-1 truncate text-ink">{t.name}</span>
                  <span className="shrink-0 truncate text-ink-3">
                    {t.project_ids?.length ? W.projects(t.project_ids.length) : W.allYourProjects}{' '}
                    {W.usedAndExpires(day(t.last_used_at), day(t.expires_at))}
                  </span>
                  <RowActions>
                    <button
                      data-testid="revoke-token"
                      onClick={async () => {
                        await api(`/tokens/${t.id}/revoke`, { method: 'POST' })
                        await load()
                      }}
                      className="text-sm text-ink-3"
                    >
                      {W.revoke}
                    </button>
                  </RowActions>
                </div>
              </div>
            ))}
          </Panel>
        )}
      </div>
    </section>
  )
}

/**
 * The second factor.
 *
 * Enrolling is three steps because the middle one is the point: the secret is
 * stored, then proved, and only then turned on. Nobody is left with the
 * factor on and a secret they never managed to scan.
 */
/**
 * The authenticator's address as a code a phone's camera reads.
 * Drawn from the `otpauth://` link the server
 * already gives, by `qrcode-generator`, fetched only here: nobody else
 * carries it. Dark on white whatever the theme, because that is what a
 * camera reads, with the quiet margin the format asks for. The space is held
 * while it loads, so the key under it does not move.
 */
function QrCode({ text, size = 160 }: { text: string; size?: number }) {
  const [cells, setCells] = useState<{ n: number; d: string } | null>(null)
  useEffect(() => {
    let alive = true
    void import('qrcode-generator').then(({ default: qrcode }) => {
      const qr = qrcode(0, 'M')
      qr.addData(text)
      qr.make()
      const n = qr.getModuleCount()
      let d = ''
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.isDark(y, x)) d += `M${x} ${y}h1v1h-1z`
      if (alive) setCells({ n, d })
    })
    return () => {
      alive = false
    }
  }, [text])
  return (
    <span
      data-testid="2fa-qr"
      className="flex shrink-0 items-center justify-center rounded-[12px] p-3"
      style={{ width: size + 24, height: size + 24, background: '#fff' }}
    >
      {cells && (
        <svg width={size} height={size} viewBox={`0 0 ${cells.n} ${cells.n}`} shapeRendering="crispEdges" role="img" aria-label={W.qrCode}>
          <path d={cells.d} fill="#000" />
        </svg>
      )}
    </span>
  )
}

/** The error's code, from the answer the server gave — not its status. */
const codeOf = (e: unknown): string | undefined =>
  e instanceof Refused ? (e.said as { error?: { code?: string } } | undefined)?.error?.code : undefined

/**
 * What a refusal says, by its code: `wrong` for a proof that did not match,
 * `otherwise` for anything else the server did not take.
 */
function said(e: unknown, wrong: string, otherwise: string): string {
  switch (codeOf(e)) {
    case 'email_unverified':
      return W.confirmEmailFirst
    case 'conflict':
      return W.alreadyOn
    case 'expired':
      return W.startAgain
    case 'rate_limited':
      return W.tooManyAttempts
    case 'wrong_password':
    case 'wrong_code':
    case 'wrong_email_code':
    case 'password_required':
    case 'code_required':
    case 'totp_required':
      return wrong
    default:
      return e instanceof Refused && e.status === 429 ? W.tooManyAttempts : otherwise
  }
}

export function SecondFactor() {
  const [state, setState] = useState<Factor | null>(() => known<Factor>('/2fa'))
  const [url, setUrl] = useState<string | null>(null)
  const [secret, setSecret] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [codes, setCodes] = useState<string[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  /* Setting up asks who it is first — the password, or a code from the
     inbox for an account with none: a session alone turned the factor on,
     and then it was the only thing a change of address asked. */
  const [proving, setProving] = useState(false)
  const [password, setPassword] = useState('')
  const [proof, setProof] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setState(await ahead<Factor>('/2fa'))
  }, [])
  useEffect(() => void load(), [load])

  const byEmail = state?.proof === 'email'
  const proven = byEmail ? proof.trim().length > 0 : password.length > 0

  async function begin() {
    if (!proven || busy) return
    setBusy(true)
    setError(null)
    try {
      const r = await api<{ secret: string; url: string }>('/2fa/begin', {
        method: 'POST',
        body: JSON.stringify(byEmail ? { code: proof.trim() } : { password }),
      })
      setSecret(r.secret)
      setUrl(r.url)
      setProving(false)
      setPassword('')
      setProof('')
    } catch (e) {
      setError(said(e, byEmail ? W.emailCodeDidntWork : W.wrongPassword, W.couldntSetUp))
      /* On already: the screen catches up with it. */
      if (codeOf(e) === 'conflict') {
        stopProving()
        await load()
      }
    } finally {
      setBusy(false)
    }
  }

  function stopProving() {
    setProving(false)
    setPassword('')
    setProof('')
    setError(null)
  }

  /* Given the code rather than reading it: six digits typed and confirmed in
     one movement used to send whatever the previous render held. */
  async function enable(value = code) {
    try {
      const r = await api<{ recovery_codes: string[] }>('/2fa/enable', {
        method: 'POST',
        body: JSON.stringify({ code: value.trim() }),
      })
      setCodes(r.recovery_codes)
      setUrl(null)
      setSecret(null)
      setCode('')
      await load()
    } catch (e) {
      setError(said(e, W.codeDidntWork, W.codeDidntWork))
      if (codeOf(e) === 'expired') {
        setUrl(null)
        setSecret(null)
        setCode('')
      }
      if (codeOf(e) === 'conflict') await load()
    }
  }

  async function disable() {
    /* The password — or, for an account with none, six digits from the
       inbox sent for this — and a code from the factor itself: the
       password alone was all somebody who had learned it needed to take
       the factor off. */
    let first: Record<string, string>
    if (byEmail) {
      try {
        await api('/me/inbox-code', { method: 'POST', body: JSON.stringify({ for: 'twofa-off' }) })
      } catch (e) {
        setError(said(e, W.couldNotSendCode, W.couldNotSendCode))
        return
      }
      const mailed = prompt(W.emailCodeToTurnOff)
      if (!mailed) return
      first = { email_code: mailed.trim() }
    } else {
      const password = prompt(W.passwordToTurnOff)
      if (!password) return
      first = { password }
    }
    const code = prompt(W.codeToTurnOff)
    if (!code) return
    try {
      await api('/2fa/disable', { method: 'POST', body: JSON.stringify({ ...first, code: code.trim() }) })
      setCodes(null)
      setError(null)
      await load()
    } catch (e) {
      setError(said(e, byEmail ? W.emailCodeOrFactorDidntWork : W.wrongPasswordOrCode, W.wrongPasswordOrCode))
    }
  }

  if (!state) return null

  return (
    <section className="mt-9 flex flex-col gap-3">
      <SectionHead>{MORE.twoFactor}</SectionHead>
      <Panel>
        <Line
          label={state.enabled ? W.on : W.off}
          hint={state.enabled && !codes ? <span data-testid="2fa-on">{W.asksAndLeft(state.recovery_left)}</span> : W.asksForCode}
        >
          {state.enabled ? (
            <button
              data-testid="2fa-disable"
              onClick={() => void disable()}
              className="inline-flex h-8 items-center rounded-full px-4 text-sm font-medium text-danger"
            >
              {W.turnOff}
            </button>
          ) : (
            !url &&
            !proving && (
              <Button tone="primary" data-testid="2fa-begin" onClick={() => setProving(true)}>
                {MORE.setUp}
              </Button>
            )
          )}
        </Line>

        {proving && !url && (
          <>
            <Hairline inset={16} />
            <form
              className="flex flex-col gap-2 px-4 py-3 text-sm"
              onSubmit={(e) => {
                e.preventDefault()
                void begin()
              }}
            >
              <p className="text-ink-2">{byEmail ? W.codeToSetUp : W.passwordToSetUp}</p>
              {byEmail ? (
                <InboxCode
                  value={proof}
                  onChange={setProof}
                  testId="2fa-inbox-code"
                  purpose="twofa"
                  look={{ className: field, style: fieldStyle }}
                />
              ) : (
                <input
                  autoFocus
                  type="password"
                  autoComplete="current-password"
                  aria-label={W.yourPassword}
                  data-testid="2fa-password"
                  className={`${field} w-full max-w-[320px]`}
                  style={fieldStyle}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              )}
              <div className="flex items-center gap-2">
                <Button tone="primary" type="submit" data-testid="2fa-continue" disabled={!proven || busy}>
                  {W.continue}
                </Button>
                <button type="button" onClick={stopProving} className="h-8 px-3 text-sm font-medium text-ink-2">
                  {W.cancel}
                </button>
              </div>
            </form>
          </>
        )}

        {url && (
          <>
            <Hairline inset={16} />
            <div className="flex flex-col gap-2 px-4 py-3 text-sm">
              <p className="text-ink-2">{SAYS.addToAuthenticator}</p>
              <QrCode text={url} />
              <code className="block break-all select-all text-ink-3">{secret}</code>
              <div className="flex items-center gap-2">
                <input
                  autoComplete="one-time-code"
                  data-testid="2fa-code"
                  className={`${field} w-[144px] tabular-nums`}
                  style={fieldStyle}
                  placeholder="123456"
                  inputMode="numeric"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && void enable(e.currentTarget.value)}
                />
                <Button tone="primary" data-testid="2fa-enable" onClick={() => void enable()}>
                  {W.turnOn}
                </Button>
              </div>
            </div>
          </>
        )}

        {codes && (
          <>
            <Hairline inset={16} />
            <div data-testid="recovery-codes" className="flex flex-col gap-2 px-4 py-3 text-sm">
              <p className="text-ink-2">{W.saveCodes}</p>
              <div className="grid grid-cols-2 gap-x-8 gap-y-1 font-mono select-all text-ink">
                {codes.map((c) => (
                  <code key={c}>{c}</code>
                ))}
              </div>
              {/* A way past them, once they are kept: the codes stood under
                  the switch with nothing to say they had been seen. */}
              <div className="mt-1 flex">
                <Button tone="primary" data-testid="recovery-done" onClick={() => setCodes(null)}>
                  {W.done}
                </Button>
              </div>
            </div>
          </>
        )}

        {error && <p className="px-4 pb-3 text-sm text-danger">{error}</p>}
      </Panel>
    </section>
  )
}
