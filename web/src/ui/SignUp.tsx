import { useEffect, useState } from 'react'
import { AuthShell, CheckEmail, ProviderButtons, field, fieldLook, primaryLook, useNoMail } from './Access.jsx'
import { authHeaders } from '../data/api.js'
import { SIGN_UP as W } from '../words/signUp.jsx'
import { edition } from '../edition.jsx'

/**
 * A workspace of your own.
 *
 * A name and an email; then a letter to the address, where the password is
 * chosen — after the address is proved, never before.
 * The workspace is called after the
 * name on the server, and renamed in Settings.
 *
 * An address that already has an account is told so by mail rather than on
 * this screen: the screen says the same thing for every address, because
 * which ones are here is information about who is here.
 */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Whether this server lets anybody sign up.
 * Said in the page by the server when it is closed, so the screen opens on
 * the sentence; asked only where nothing wrote the page (the dev server).
 * Open until said otherwise, which on the service it never is.
 */
function closedInPage(): boolean | null {
  if (document.querySelector('meta[name="tuff-sign-up"]')?.getAttribute('content') === 'closed') return true
  /* A page the server wrote says it when closed, so its silence is open. */
  return document.querySelector('meta[name="tuff-providers"]') ? false : null
}

export function SignUp() {
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', 'dark')
    document.title = W.docTitle
  }, [])
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [emailLeft, setEmailLeft] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /* Sent: the screen is the wait for the link. */
  const [sent, setSent] = useState(false)
  const [closed, setClosed] = useState(() => closedInPage() === true)
  /* Your own server with no mail: the letter this form ends in cannot go. */
  const noMail = useNoMail()
  useEffect(() => {
    if (closedInPage() !== null) return
    void fetch('/auth/providers')
      .then((r) => (r.ok ? (r.json() as Promise<{ sign_up?: boolean }>) : null))
      .then((p) => {
        if (p?.sign_up === false) setClosed(true)
      })
      .catch(() => {})
  }, [])
  const emailOk = EMAIL.test(email.trim())
  const ready = Boolean(name.trim() && emailOk)
  const ask = () =>
    fetch('/auth/register', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ name: name.trim(), email: email.trim() }),
    })

  async function go(e: React.FormEvent) {
    e.preventDefault()
    setEmailLeft(true)
    if (!ready || busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await ask()
      if (res.ok) {
        setSent(true)
        return
      }
      if (res.status === 403) {
        const said = (await res.json().catch(() => ({}))) as { error?: { code?: string } }
        if (said.error?.code === 'sign_up_closed') {
          setClosed(true)
          return
        }
      }
      setError(res.status === 429 ? W.tooMany : W.couldntCreate)
    } catch {
      setError(W.couldntReach)
    } finally {
      setBusy(false)
    }
  }

  /* Another letter: the same sign-up again. The address has an account by
     now, unconfirmed, and that is the letter it gets — three an hour at
     most, however often anybody asks. */
  async function again(): Promise<boolean> {
    const r = await ask().catch(() => null)
    return r?.status === 202
  }

  if (sent)
    return (
      <AuthShell title={W.checkEmail}>
        <CheckEmail email={email.trim()} resend={again} back={{ label: W.differentEmail, go: () => setSent(false) }} />
      </AuthShell>
    )

  if (closed || noMail)
    return (
      <AuthShell title={closed ? W.closedTitle : W.noMailTitle}>
        <div className="flex flex-col gap-4" data-testid={closed ? 'signup-closed' : 'signup-no-mail'}>
          <p className="text-md leading-[1.5] text-ink-2">{closed ? W.closed : W.noMail}</p>
          <p className="text-center text-base text-ink-3">
            {W.haveAccount}{' '}
            <a href="/signin" className="text-accent">
              {W.signIn}
            </a>
          </p>
        </div>
      </AuthShell>
    )

  return (
    <AuthShell title={W.start}>
      <form onSubmit={go} noValidate className="flex flex-col gap-3" data-testid="signup">
        {/* Google and Apple make the account and its workspace in one step,
            the address confirmed by them. */}
        <ProviderButtons />
        <input
          className={field}
          style={fieldLook}
          aria-label={W.yourName}
          placeholder={W.yourName}
          name="name"
          autoComplete="name"
          data-testid="signup-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <div className="flex flex-col gap-2">
          <input
            className={field}
            style={{
              ...fieldLook,
              ...(emailLeft && email && !emailOk ? { boxShadow: 'inset 0 0 0 1px var(--danger)' } : {}),
            }}
            aria-label={W.email}
            aria-invalid={emailLeft && Boolean(email) && !emailOk}
            placeholder={W.email}
            type="email"
            name="email"
            autoComplete="email"
            data-testid="signup-email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onBlur={() => setEmailLeft(true)}
          />
          {emailLeft && email && !emailOk && <p className="flex h-5 items-center px-1 text-sm text-danger">{W.notAnEmail}</p>}
        </div>
        {error && (
          <p role="alert" className="text-base text-danger">
            {error}
          </p>
        )}
        <button
          type="submit"
          data-testid="signup-go"
          disabled={!ready || busy}
          className="mt-2 h-11 rounded-full text-md font-medium transition-transform active:scale-[0.98] disabled:opacity-40"
          style={primaryLook}
        >
          {busy ? W.creating : W.create}
        </button>
        {/* The terms and the policy, where the edition has them. */}
        {edition.legal && (
          <p className="mt-2 text-center text-sm leading-[1.5] text-ink-3">
            {W.accept(
              <a href="/terms" className="underline underline-offset-4 text-ink-2">
                {W.terms}
              </a>,
              <a href="/privacy" className="underline underline-offset-4 text-ink-2">
                {W.privacy}
              </a>,
            )}
          </p>
        )}
        <p className="text-center text-base text-ink-3">
          {W.haveAccount}{' '}
          <a href="/signin" className="text-accent">
            {W.signIn}
          </a>
        </p>
      </form>
    </AuthShell>
  )
}
