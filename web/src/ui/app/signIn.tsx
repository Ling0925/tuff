import { useState, useEffect } from 'react'
import { HEADS } from '../../data/words.js'
import { APP as W } from '../../words/app.js'
import { whyRemoved, authHeaders, setSession, type Session, signIn } from '../../data/api.js'
import {
  providerTrouble,
  AuthShell,
  CheckEmail,
  ProviderButtons,
  field,
  fieldLook,
  PasswordField,
  primaryLook,
  useNoMail,
} from '../Access.jsx'
import { ACCESS } from '../../words/access.jsx'

export function SignIn({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  /* What a provider's callback said, if it sent somebody back here without
     a session. */
  const [error, setError] = useState<string | null>(() => providerTrouble(new URLSearchParams(location.search).get('oauth')))
  /* Asked for once the password is right and the account has a second
     factor — never before, so a wrong password says nothing about it. */
  const [asking, setAsking] = useState(false)
  const [code, setCode] = useState('')
  /* The ticket a provider's callback left in the address, traded for a
     session here — and kept while a second factor is asked for. */
  const [handoff] = useState(() => new URLSearchParams(location.search).get('handoff'))
  /* An invitation that waits for the second factor comes back beside it. */
  const [invited] = useState(() => new URLSearchParams(location.search).get('invite'))
  const [trading, setTrading] = useState(Boolean(handoff))
  /* The password was right and the address is not confirmed yet: a link
     went to it, and this screen waits for it. */
  const [unconfirmed, setUnconfirmed] = useState(false)
  /* Your own server with no mail: no link can go to confirm it. */
  const noMail = useNoMail()
  /* Sent here because they were removed from a workspace: said until
     they sign in again — `docs/specs/removing-someone.md`. */
  const [removed] = useState(whyRemoved)

  async function trade(totp?: string) {
    if (!handoff) return
    const r = await fetch('/auth/oauth/exchange', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ handoff, nowhere: true, ...(totp ? { totp } : {}), ...(invited ? { invite: invited } : {}) }),
    }).catch(() => null)
    if (r?.ok) {
      setSession((await r.json()) as Session)
      history.replaceState(null, '', '/')
      onDone()
      return
    }
    const said = (await r?.json().catch(() => ({}))) as { error?: { code?: string; message?: string } } | undefined
    setTrading(false)
    if (said?.error?.code === 'totp_required') {
      if (asking) setError(W.codeDidNotWork)
      setAsking(true)
      return
    }
    history.replaceState(null, '', '/signin')
    /* A full workspace or a spent invitation says so; anything else is the
       ticket having run out. */
    setError(said?.error?.message ?? W.signInExpired)
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, with the ticket the page arrived with
  useEffect(() => {
    /* A ticket is out of the address as soon as it is read: an address is
       kept in a history, synced, and copied to show somebody: */
    const q = new URLSearchParams(location.search)
    if (['handoff', 'linked', 'ways'].some((k) => q.has(k))) {
      for (const k of ['handoff', 'linked', 'ways']) q.delete(k)
      const rest = q.toString()
      history.replaceState(history.state, '', `${location.pathname}${rest ? `?${rest}` : ''}`)
    }
    if (handoff) void trade()
    // Once, with the ticket the page arrived with.
  }, [])

  async function submit(pass = password, given = code) {
    setError(null)
    if (handoff) return trade(given.trim())
    try {
      await signIn(email, pass, asking ? given.trim() : undefined)
      onDone()
    } catch (e) {
      if ((e as Error).message === 'totp_required') {
        if (asking) setError(W.codeDidNotWork)
        setAsking(true)
        return
      }
      if ((e as Error).message === 'email_unverified') {
        setUnconfirmed(true)
        return
      }
      // Not "no such account" or "wrong password": which one it was is
      // information about who has an account here.
      setError(W.wrongPassword)
    }
  }

  /* Back from Google or Apple, the ticket is traded in a moment, and the
     product is what comes next: a screen that says "Signing you in" between
     the provider and the work was one more page on the way in. The canvas,
     and then the app. */
  if (trading) return <div data-signing-in className="min-h-dvh bg-canvas" />
  if (unconfirmed && noMail)
    return (
      <AuthShell title={ACCESS.unconfirmedTitle}>
        <div data-testid="unconfirmed-no-mail" className="flex flex-col items-center gap-4 text-center">
          <p className="text-md leading-[1.5] text-ink-2">{ACCESS.unconfirmedNoMail}</p>
          <button type="button" onClick={() => setUnconfirmed(false)} className="text-base text-accent">
            {W.backToSignIn}
          </button>
        </div>
      </AuthShell>
    )
  if (unconfirmed)
    return (
      <AuthShell title={W.checkEmail}>
        <CheckEmail
          email={email.trim()}
          resend={() =>
            signIn(email, password).then(
              () => {
                // Confirmed meanwhile, in another tab: in.
                onDone()
                return true
              },
              (e: Error) => e.message === 'email_unverified',
            )
          }
          back={{ label: W.backToSignIn, go: () => setUnconfirmed(false) }}
        />
      </AuthShell>
    )

  return (
    <AuthShell title={handoff ? W.oneMoreStep : W.signInToTuff}>
      {removed !== null && (
        <p
          role="status"
          data-testid="removed-notice"
          className="mb-2 rounded-[12px] px-4 py-3 text-base leading-[1.4] bg-surface text-ink"
          style={{ boxShadow: 'inset 0 0 0 1px var(--line)' }}
        >
          {removed ? W.removedFrom(removed) : W.removedFromIt}
        </p>
      )}
      {!handoff && <ProviderButtons />}
      {/* A real form, so a password manager knows this is the sign-in and
          offers to keep what was typed — and only here and on the other
          ways in. The button and the key press are the form's one submit,
          and both read the fields themselves: state here can be one render
          behind the last character typed. */}
      <form
        data-testid="sign-in-form"
        method="post"
        noValidate
        className="contents"
        onSubmit={(e) => {
          e.preventDefault()
          const typed = new FormData(e.currentTarget)
          const said = (k: string, or: string) => {
            const v = typed.get(k)
            return typeof v === 'string' ? v : or
          }
          void submit(said('password', password), said('code', code))
        }}
      >
        {!handoff && (
          <>
            <input
              className={field}
              style={fieldLook}
              placeholder={W.email}
              type="email"
              name="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <PasswordField rule={false} value={password} onChange={setPassword} />
          </>
        )}
        {asking && (
          <input
            autoFocus
            data-testid="sign-in-code"
            className={field}
            style={fieldLook}
            placeholder={W.codeOrRecovery}
            name="code"
            autoComplete="one-time-code"
            autoCapitalize="off"
            spellCheck={false}
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
        )}
        {error && (
          <p role="alert" className="text-base leading-[1.4] text-danger">
            {error}
          </p>
        )}
        <button
          type="submit"
          className="mt-2 h-11 rounded-full text-md font-medium transition-transform active:scale-[0.98]"
          style={primaryLook}
        >
          {HEADS.signIn}
        </button>
      </form>
      {!handoff && (
        <p className="mt-2 flex justify-between text-base text-ink-3">
          <a href="/forgot" data-testid="to-forgot" className="text-accent">
            {W.forgot}
          </a>
          <a href="/signup" className="text-accent">
            {W.createWorkspace}
          </a>
        </p>
      )}
    </AuthShell>
  )
}
