import { useEffect, useState } from 'react'
import { authHeaders, setSession, type Session } from '../../data/api.js'
import type { OnHost } from '../../data/host.js'
import { HOST_SIGN_IN as W } from '../../words/hostSignIn.js'
import { AuthShell, ProviderButtons, field, fieldLook, primaryLook } from '../Access.jsx'
import { Panel, SectionHead } from '../kit.jsx'

/**
 * Signing in on a workspace's own domain.
 *
 * Never a password: whoever controls the domain's DNS could serve a copy
 * of this page. An email, then the code mailed to it, then the second
 * factor where the account has one — or Google, Apple or GitHub through
 * usetuff.com, whose ticket comes back here and is traded beside the cookie
 * the start set. The workspace's name and mark head it, and one quiet line
 * says whose account it wants.
 */
type Said = { error?: { code?: string; message?: string } }

export function HostSignIn({ host, onDone }: { host: OnHost; onDone: () => void }) {
  const q = new URLSearchParams(location.search)
  const [handoff] = useState(() => q.get('handoff'))
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [totp, setTotp] = useState('')
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [trading, setTrading] = useState(Boolean(handoff))
  const [error, setError] = useState<string | null>(() => {
    const why = q.get('oauth')
    if (!why) return null
    return why === 'notin' ? W.notIn(host.name) : W.providerFailed
  })

  const done = (s: Session) => {
    setSession(s)
    history.replaceState(null, '', `/${host.slug}`)
    onDone()
  }

  async function post(path: string, body: unknown): Promise<{ ok: boolean; status: number; said: Said & Partial<Session> }> {
    const r = await fetch(path, { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) }).catch(() => null)
    return { ok: Boolean(r?.ok), status: r?.status ?? 0, said: ((await r?.json().catch(() => ({}))) ?? {}) as Said & Partial<Session> }
  }

  async function trade(given?: string) {
    if (!handoff) return
    const r = await post('/auth/oauth/exchange', { handoff, ...(given ? { totp: given } : {}) })
    setTrading(false)
    if (r.ok) return done(r.said as Session)
    if (r.said.error?.code === 'totp_required') {
      if (asking) setError(W.wrongCode)
      setAsking(true)
      return
    }
    history.replaceState(null, '', '/signin')
    setError(W.expired)
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: once, with the ticket the page arrived with
  useEffect(() => {
    /* Out of the address as soon as it is read. */
    if (q.has('handoff') || q.has('oauth')) history.replaceState(history.state, '', '/signin')
    if (handoff) void trade()
  }, [])

  async function sendCode() {
    if (!email.trim() || busy) return
    setBusy(true)
    setError(null)
    const r = await post('/auth/code', { email: email.trim() })
    setBusy(false)
    if (r.status === 429) return setError(W.tooMany)
    if (!r.ok) return setError(W.couldNotSend)
    setCode('')
    setStep('code')
  }

  async function verify() {
    if (handoff) return trade(totp.trim())
    if (busy) return
    setBusy(true)
    setError(null)
    const r = await post('/auth/code/verify', { email: email.trim(), code, ...(asking && totp ? { totp: totp.trim() } : {}) })
    setBusy(false)
    if (r.ok) return done(r.said as Session)
    if (r.said.error?.code === 'totp_required') {
      if (asking) setError(W.wrongCode)
      setAsking(true)
      return
    }
    setError(r.status === 429 ? W.tooMany : W.wrongCode)
  }

  if (trading) return <div data-signing-in className="min-h-dvh bg-canvas" />
  return (
    <AuthShell
      title={W.signInTo(host.name)}
      mark={<img src="/brand/touch-180.png" alt="" width={56} height={56} draggable={false} className="block size-14 rounded-[12px]" />}
    >
      <div data-testid="host-sign-in" className="flex flex-col gap-3">
        {!handoff && step === 'email' && <ProviderButtons />}
        <form
          noValidate
          className="contents"
          onSubmit={(e) => {
            e.preventDefault()
            void (step === 'email' && !handoff ? sendCode() : verify())
          }}
        >
          {!handoff && step === 'email' && (
            <input
              data-testid="host-email"
              className={field}
              style={fieldLook}
              placeholder={W.email}
              type="email"
              name="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          )}
          {!handoff && step === 'code' && (
            <>
              <p className="text-base leading-[1.4] text-ink-2">{W.sentTo(email.trim())}</p>
              <input
                autoFocus
                data-testid="host-code"
                className={field}
                style={fieldLook}
                placeholder={W.code}
                name="code"
                autoComplete="one-time-code"
                autoCapitalize="characters"
                spellCheck={false}
                maxLength={12}
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </>
          )}
          {asking && (
            <input
              autoFocus
              data-testid="host-totp"
              className={field}
              style={fieldLook}
              placeholder={W.appCode}
              name="totp"
              autoComplete="one-time-code"
              autoCapitalize="off"
              spellCheck={false}
              value={totp}
              onChange={(e) => setTotp(e.target.value)}
            />
          )}
          {error && (
            <p role="alert" className="text-base leading-[1.4] text-danger">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={busy}
            data-testid="host-submit"
            className="mt-2 h-11 rounded-full text-md font-medium transition-transform active:scale-[0.98]"
            style={primaryLook}
          >
            {step === 'email' && !handoff ? W.sendCode : W.signIn}
          </button>
        </form>
        {!handoff && step === 'code' && (
          <p className="mt-2 flex justify-between text-base text-ink-3">
            <button type="button" className="text-accent" onClick={() => setStep('email')}>
              {W.otherAddress}
            </button>
            <button type="button" className="text-accent" onClick={() => void sendCode()}>
              {W.newCode}
            </button>
          </p>
        )}
        {!handoff && step === 'code' && <p className="text-sm leading-[1.4] text-ink-3">{W.noCode}</p>}
        <p className="mt-2 text-center text-sm text-ink-3">{W.tuffAccount}</p>
      </div>
    </AuthShell>
  )
}

/**
 * On a workspace's own domain, Account keeps the face, the name, the
 * language and this device's notifications; everything that belongs to the
 * account rather than the workspace is a link to usetuff.com, where a
 * session made on the host could not reach it anyway.
 */
export function HostSecurity({ host }: { host: OnHost }) {
  return (
    <section data-testid="host-security" className="mt-9 flex flex-col gap-3">
      <SectionHead>{W.security}</SectionHead>
      <Panel>
        <div className="flex min-h-[56px] flex-wrap items-center gap-4 px-4 py-3">
          <span className="min-w-[200px] flex-1 text-sm text-ink-3">{W.securityHint}</span>
          <a href={`${host.home}/${host.slug}/account`} target="_blank" rel="noreferrer" className="text-sm font-medium text-accent">
            {W.openTuff}
          </a>
        </div>
      </Panel>
    </section>
  )
}
