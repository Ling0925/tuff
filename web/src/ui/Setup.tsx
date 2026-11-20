import { useEffect, useState } from 'react'
import { AuthShell, field, fieldLook, PasswordField, PASSWORD_MIN, primaryLook } from './Access.jsx'
import { MailFields, mailSummary } from './MailSettings.jsx'
import { authHeaders, setSession, type Session } from '../data/api.js'
import { draftOf, draftReady, inputOf, type MailDraft, type MailSetup } from '../data/mailSetup.js'
import { SETUP as W } from '../words/setup.js'
import { MAIL_SETTINGS as M } from '../words/mailSettings.js'

/**
 * Your own server's first opening, `/setup?token=…`.
 *
 * Email, then the owner's account, behind the one-time token `setup.sh`
 * printed. The token is taken out of the address at once — kept for this
 * tab only — so it is in no history, bookmark or `Referer`, and is sent in
 * a header, never in an address. The account is made owner, confirmed and
 * signed in by the one press that makes it; the app is what comes next.
 */

const KEPT = 'tuff.setup-token'

/** Once, as the screen's code loads: from the address, else from this tab. */
function takeToken(): string {
  const q = new URLSearchParams(location.search)
  const given = q.get('token')
  if (given) {
    try {
      sessionStorage.setItem(KEPT, given)
    } catch {}
    q.delete('token')
    const rest = q.toString()
    history.replaceState(history.state, '', `${location.pathname}${rest ? `?${rest}` : ''}`)
    return given
  }
  try {
    return sessionStorage.getItem(KEPT) ?? ''
  } catch {
    return ''
  }
}
const TOKEN = takeToken()

function ask(path: string, method: string, body?: unknown): Promise<Response> {
  return fetch(`/auth/setup${path}`, {
    method,
    headers: { ...authHeaders(), 'x-setup-token': TOKEN },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

/** What a refusal says: the server's words (already in the reader's language), else ours. */
async function saidBy(r: Response, fallback: string): Promise<string> {
  if (r.status === 429) return W.tooMany
  const b = (await r.json().catch(() => ({}))) as { error?: { message?: string } }
  return b.error?.message || fallback
}

type Stage = 'loading' | 'bad' | 'done' | 'mail' | 'skip' | 'owner'
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function Setup() {
  const [stage, setStage] = useState<Stage>(TOKEN ? 'loading' : 'bad')
  const [ownerEmail, setOwnerEmail] = useState<string | null>(null)
  const [mail, setMail] = useState<MailSetup | null>(null)
  const [draft, setDraft] = useState<MailDraft>(() => draftOf(null))
  const [testTo, setTestTo] = useState('')
  const [test, setTest] = useState<'sending' | 'sent' | 'failed' | null>(null)
  const [said, setSaid] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', 'dark')
    document.title = W.docTitle
    if (!TOKEN) return
    void (async () => {
      const r = await ask('', 'GET').catch(() => null)
      if (!r) return setStage('bad')
      if (r.status === 410) return setStage('done')
      if (!r.ok) return setStage('bad')
      const s = (await r.json()) as { owner_email: string | null; mail_setup: MailSetup }
      setOwnerEmail(s.owner_email)
      setEmail(s.owner_email ?? '')
      setTestTo(s.owner_email ?? '')
      setMail(s.mail_setup)
      setDraft(draftOf(s.mail_setup))
      setStage('mail')
    })()
  }, [])

  /** What a failed request means for the screen: gone for good, or a sentence. */
  async function refused(r: Response | null, fallback: string): Promise<void> {
    if (!r) return setSaid(W.couldntReach)
    if (r.status === 410) return setStage('done')
    if (
      r.status === 403 &&
      (
        (await r
          .clone()
          .json()
          .catch(() => ({}))) as { error?: { code?: string } }
      ).error?.code === 'bad_token'
    ) {
      return setStage('bad')
    }
    setSaid(await saidBy(r, fallback))
  }

  /** The mail typed, saved; whether it was. */
  async function saveMail(): Promise<boolean> {
    const r = await ask('/mail', 'PUT', inputOf(draft)).catch(() => null)
    if (!r?.ok) {
      await refused(r, M.couldntSave)
      return false
    }
    const s = (await r.json()) as { mail_setup: MailSetup }
    setMail(s.mail_setup)
    return true
  }

  async function sendTest() {
    if (busy || !EMAIL.test(testTo.trim())) return
    setBusy(true)
    setSaid(null)
    setTest('sending')
    try {
      if (!(await saveMail())) return setTest(null)
      const r = await ask('/mail/test', 'POST', { to: testTo.trim() }).catch(() => null)
      if (!r?.ok) {
        setTest(null)
        return await refused(r, W.testFailed)
      }
      const b = (await r.json()) as { sent: boolean }
      setTest(b.sent ? 'sent' : 'failed')
    } finally {
      setBusy(false)
    }
  }

  async function goOn() {
    if (busy) return
    setSaid(null)
    if (mail?.source === 'env') return setStage('owner')
    setBusy(true)
    try {
      if (await saveMail()) setStage('owner')
    } finally {
      setBusy(false)
    }
  }

  async function withoutMail() {
    if (busy) return
    setBusy(true)
    setSaid(null)
    try {
      /* Saved by a test a moment ago: skipping means none. */
      if (mail?.source === 'saved') {
        const r = await ask('/mail', 'DELETE').catch(() => null)
        if (!r?.ok) return await refused(r, M.couldntSave)
        setMail(((await r.json()) as { mail_setup: MailSetup }).mail_setup)
      }
      setStage('owner')
    } finally {
      setBusy(false)
    }
  }

  async function create(e: React.FormEvent) {
    e.preventDefault()
    if (busy || !name.trim() || !EMAIL.test(email.trim()) || password.length < PASSWORD_MIN) return
    setBusy(true)
    setSaid(null)
    try {
      const r = await ask('/owner', 'POST', { name: name.trim(), email: email.trim(), password }).catch(() => null)
      if (!r?.ok) return await refused(r, W.couldntReach)
      setSession((await r.json()) as Session)
      try {
        sessionStorage.removeItem(KEPT)
      } catch {}
      location.replace('/')
    } finally {
      setBusy(false)
    }
  }

  if (stage === 'loading') return null

  if (stage === 'bad' || stage === 'done')
    return (
      <AuthShell title={stage === 'bad' ? W.badLinkTitle : W.doneTitle}>
        <div className="flex flex-col items-center gap-4 text-center" data-testid="setup-closed" data-state={stage}>
          <p className="text-md leading-[1.5] text-ink-2">{stage === 'bad' ? W.badLink : W.done}</p>
          {stage === 'done' && (
            <a href="/signin" className="flex h-11 w-full items-center justify-center rounded-full text-md font-medium" style={primaryLook}>
              {W.signIn}
            </a>
          )}
        </div>
      </AuthShell>
    )

  const alert = (
    <p role={said ? 'alert' : undefined} className="min-h-5 px-1 text-base text-danger">
      {said}
    </p>
  )

  if (stage === 'skip')
    return (
      <AuthShell title={W.skipTitle}>
        <div className="flex flex-col gap-4" data-testid="setup-skip">
          <ul className="flex flex-col gap-3 text-md leading-[1.5] text-ink-2">
            <li>{W.skipWont}</li>
            <li>{W.skipWill}</li>
            <li>{W.skipLater}</li>
          </ul>
          {alert}
          <button
            type="button"
            data-testid="setup-skip-go"
            disabled={busy}
            onClick={() => void withoutMail()}
            className="h-11 rounded-full text-md font-medium transition-transform active:scale-[0.98] disabled:opacity-40"
            style={primaryLook}
          >
            {W.skipGo}
          </button>
          <button type="button" onClick={() => setStage('mail')} className="text-base text-accent">
            {W.back}
          </button>
        </div>
      </AuthShell>
    )

  if (stage === 'owner')
    return (
      <AuthShell title={W.ownerTitle}>
        <form onSubmit={(e) => void create(e)} noValidate className="flex flex-col gap-3" data-testid="setup-owner">
          <p className="text-center text-sm text-ink-3">{W.step(2)}</p>
          <p className="mb-2 text-center text-md leading-[1.5] text-ink-2">{W.ownerIntro}</p>
          <input
            className={field}
            style={fieldLook}
            aria-label={W.name}
            placeholder={W.name}
            name="name"
            autoComplete="name"
            data-testid="setup-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <div className="flex flex-col gap-2">
            <input
              className={field}
              style={{ ...fieldLook, ...(ownerEmail ? { color: 'var(--ink-2)' } : {}) }}
              aria-label={W.email}
              placeholder={W.email}
              type="email"
              name="email"
              autoComplete="username"
              data-testid="setup-email"
              readOnly={Boolean(ownerEmail)}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            {ownerEmail && <p className="flex h-5 items-center px-1 text-sm text-ink-3">{W.ownerEmailFixed}</p>}
          </div>
          <PasswordField value={password} onChange={setPassword} testId="setup-password" />
          {alert}
          <button
            type="submit"
            data-testid="setup-create"
            disabled={busy || !name.trim() || !EMAIL.test(email.trim()) || password.length < PASSWORD_MIN}
            className="h-11 rounded-full text-md font-medium transition-transform active:scale-[0.98] disabled:opacity-40"
            style={primaryLook}
          >
            {busy ? W.creating : W.create}
          </button>
        </form>
      </AuthShell>
    )

  const fromEnv = mail?.source === 'env'
  const ready = fromEnv || draftReady(mail, draft)
  return (
    <AuthShell title={W.mailTitle}>
      <div className="flex flex-col gap-3" data-testid="setup-mail">
        <p className="text-center text-sm text-ink-3">{W.step(1)}</p>
        <p className="mb-2 text-center text-md leading-[1.5] text-ink-2">{W.mailIntro}</p>
        {fromEnv && mail ? (
          <div className="flex flex-col gap-1 rounded-[10px] px-4 py-3" style={fieldLook} data-testid="setup-mail-env">
            <span className="text-md text-ink">{M.fromEnv}</span>
            <span className="text-sm text-ink-2">{mailSummary(mail)}</span>
            <span className="text-sm text-ink-3">{M.fromEnvHint}</span>
          </div>
        ) : (
          <>
            <MailFields look="page" setup={mail} draft={draft} onChange={setDraft} />
            <div className="mt-2 flex flex-col gap-2">
              <span aria-hidden className="px-1 text-sm text-ink-3">
                {W.testTo}
              </span>
              <div className="flex gap-2">
                <input
                  className={field}
                  style={fieldLook}
                  aria-label={W.testTo}
                  type="email"
                  autoComplete="email"
                  data-testid="setup-test-to"
                  value={testTo}
                  onChange={(e) => setTestTo(e.target.value)}
                />
                <button
                  type="button"
                  data-testid="setup-test"
                  disabled={busy || !ready || !EMAIL.test(testTo.trim())}
                  onClick={() => void sendTest()}
                  className="h-11 shrink-0 rounded-full px-4 text-md font-medium transition-transform active:scale-[0.98] disabled:opacity-40"
                  style={{ background: 'var(--surface)', color: 'var(--ink)', boxShadow: 'inset 0 0 0 1px var(--line)' }}
                >
                  {test === 'sending' ? W.testing : W.test}
                </button>
              </div>
              {/* One line, kept whether or not it says anything, so nothing under it moves. */}
              <p data-testid="setup-test-said" aria-live="polite" className="flex h-5 items-center px-1 text-sm text-ink-3">
                {test === 'sent' ? W.testSent : test === 'failed' ? W.testFailed : ''}
              </p>
            </div>
          </>
        )}
        {alert}
        <button
          type="button"
          data-testid="setup-continue"
          disabled={busy || !ready}
          onClick={() => void goOn()}
          className="h-11 rounded-full text-md font-medium transition-transform active:scale-[0.98] disabled:opacity-40"
          style={primaryLook}
        >
          {W.continue}
        </button>
        {!fromEnv && (
          <button type="button" data-testid="setup-skip-open" onClick={() => setStage('skip')} className="text-base text-accent">
            {W.skip}
          </button>
        )}
      </div>
    </AuthShell>
  )
}
