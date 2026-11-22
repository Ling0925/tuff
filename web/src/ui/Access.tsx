import { useEffect, useRef, useState } from 'react'
import { edition } from '../edition.jsx'
import { AFTER_SIGN_IN, api, authHeaders, Refused, setSession, signOut, stored, type Session } from '../data/api.js'
import { Icon } from './glyphs.jsx'
import { now } from '../data/words.js'
import { ACCESS as W } from '../words/access.jsx'

/**
 * The ways in that are not the app itself:
 * the frame the sign-in, sign-up and password
 * screens share, the Google and Apple buttons, the password field that says
 * what it needs, the screen that waits for a confirmation link, the link's
 * own page, and the two screens of a forgotten password.
 */

/** The same quiet frame for every screen before the app. */
export function AuthShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    /*
     * In the middle of the window, near enough: the top of the block sits
     * where a block of a sign-in's height would be centred, and anything that
     * appears under a field grows it downwards. Truly centred, an error line
     * moved the whole form up by half its height under the hand that was
     * typing. Never closer than 64 to the top, on a short screen or behind a
     * phone's keyboard.
     */
    <div
      className="flex min-h-dvh flex-col items-center px-4 pb-16 bg-canvas text-ink"
      style={{ paddingTop: 'max(64px, calc(50dvh - 300px))' }}
    >
      {/* The mark alone, at the size the landing gives it: at 28 beside the
          name it read as a favicon that had wandered onto the page, and
          the name said again what the mark already says. The landing's
          drawing and not the favicon's, which is 64 pixels and soft at
          twice the size on a retina screen. */}
      <a href="/welcome" aria-label="Tuff" className="block">
        <img src="/landing/mark.svg" alt="" draggable={false} width={56} height={56} className="block" />
      </a>
      <div className="mt-12 flex w-full max-w-[400px] flex-col gap-3">
        <h1 className="mb-2 text-center text-display font-semibold" style={{ letterSpacing: '-0.02em' }}>
          {title}
        </h1>
        {children}
      </div>
    </div>
  )
}

export const field = 'h-11 w-full rounded-[10px] px-4 text-md outline-none'
export const fieldLook = { background: 'var(--surface)', color: 'var(--ink)', boxShadow: 'inset 0 0 0 1px var(--line)' }
export const primaryLook = { background: 'var(--accent)', color: 'var(--on-accent)' }

/** The shortest password the server takes. */
export const PASSWORD_MIN = 12

/**
 * A password field that says what it needs while it is typed in, and shows
 * what was typed when asked to.
 *
 * The rule was a placeholder — "twelve characters or more" — gone the moment
 * the first character went in, and a button that stayed grey with nothing
 * saying why. Now the line under the field counts down to the rule and turns
 * into a tick when it is met. `rule: 'new'` is a password being chosen;
 * `'either'` is a field that takes an existing account's password too, where
 * the rule is for a new one only; `false` is a password being given.
 */
export function PasswordField({
  value,
  onChange,
  onEnter,
  placeholder = W.password,
  rule = 'new',
  testId,
  autoFocus,
  look = 'page',
  name = rule === false ? 'password' : 'new-password',
}: {
  value: string
  onChange: (v: string) => void
  onEnter?: (v: string) => void
  placeholder?: string
  rule?: 'new' | 'either' | false
  testId?: string
  autoFocus?: boolean
  /** A page's field, or the smaller sunken one a window's fields are. */
  look?: 'page' | 'window'
  /** What the form sends it as, which is what a password manager matches on. */
  name?: string
}) {
  const [shown, setShown] = useState(false)
  const inWindow = look === 'window'
  const short = PASSWORD_MIN - value.length
  const met = short <= 0
  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <input
          autoFocus={autoFocus}
          data-testid={testId}
          aria-label={placeholder}
          className={`${inWindow ? 'h-10 w-full rounded-[var(--r-row)] px-3 text-base outline-none' : field} pr-12`}
          style={inWindow ? { background: 'var(--sunken)', color: 'var(--ink)' } : fieldLook}
          placeholder={placeholder}
          type={shown ? 'text' : 'password'}
          name={name}
          autoComplete={rule === false ? 'current-password' : 'new-password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && onEnter) onEnter(e.currentTarget.value)
          }}
        />
        <button
          type="button"
          data-testid="password-show"
          aria-label={shown ? W.hidePassword : W.showPassword}
          aria-pressed={shown}
          onClick={() => setShown((v) => !v)}
          className={`absolute top-0 right-0 flex items-center justify-center ${inWindow ? 'size-10' : 'size-11'} text-ink-3`}
        >
          <Icon name={shown ? 'eyeOff' : 'eye'} size={18} />
        </button>
      </div>
      {rule && (
        <p
          data-testid="password-rule"
          data-met={met || undefined}
          aria-live="polite"
          className="flex h-5 items-center gap-2 px-1 text-sm"
          style={{ color: met ? '#30d158' : 'var(--ink-3)' }}
        >
          {met ? (
            <Icon name="check" size={14} />
          ) : (
            <span className="relative h-1 w-8 overflow-hidden rounded-full bg-line">
              <span
                className="absolute inset-y-0 left-0 rounded-full bg-ink-3"
                style={{ width: `${(value.length / PASSWORD_MIN) * 100}%` }}
              />
            </span>
          )}
          <span className="tabular-nums">
            {met ? W.longEnough : value.length === 0 ? (rule === 'either' ? W.atLeastForNew : W.atLeast) : W.moreCharacters(short)}
          </span>
        </p>
      )}
    </div>
  )
}

/** Where an address's inbox opens, for the few that most people have. */
function inboxOf(email: string): { name: string; url: string } | null {
  const at = email.split('@')[1]?.toLowerCase() ?? ''
  /* Gmail opened on the service's letters; on your own server, whose
     sender is its own, on the inbox. */
  if (at === 'gmail.com' || at === 'googlemail.com')
    return {
      name: 'Gmail',
      url: edition.vendor
        ? `https://mail.google.com/mail/u/0/#search/from%3A${encodeURIComponent(edition.vendor.mailDomain)}`
        : 'https://mail.google.com/mail/u/0/#inbox',
    }
  if (['outlook.com', 'hotmail.com', 'live.com', 'msn.com'].includes(at))
    return { name: 'Outlook', url: 'https://outlook.live.com/mail/0/' }
  if (['icloud.com', 'me.com', 'mac.com'].includes(at)) return { name: 'iCloud Mail', url: 'https://www.icloud.com/mail' }
  if (at === 'yahoo.com') return { name: 'Yahoo Mail', url: 'https://mail.yahoo.com' }
  return null
}

const ENVELOPE = (
  <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden>
    <rect x="4" y="7" width="20" height="14" rx="3" stroke="currentColor" strokeWidth="1.6" />
    <path d="m5 9 9 6.5L23 9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

/**
 * Waiting for the link. Said where it went, a way
 * to the inbox for the mail services most people use, another one sent on
 * request (not more than one every thirty seconds), and a way back to
 * change the address.
 */
export function CheckEmail({
  email,
  resend,
  back,
}: {
  email: string
  /** Sends another; whether it went. */
  resend: () => Promise<boolean>
  back: { label: string; go: () => void }
}) {
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle')
  const [wait, setWait] = useState(30)
  const tick = useRef<ReturnType<typeof setInterval> | null>(null)
  const count = () => {
    if (tick.current) clearInterval(tick.current)
    setWait(30)
    tick.current = setInterval(() => setWait((w) => (w <= 1 ? 0 : w - 1)), 1000)
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: the countdown starts once, when the screen opens
  useEffect(() => {
    count()
    return () => {
      if (tick.current) clearInterval(tick.current)
    }
  }, [])
  const inbox = inboxOf(email)
  return (
    <div data-testid="check-email" className="flex flex-col items-center gap-4 text-center">
      <span className="flex size-16 items-center justify-center rounded-full bg-surface text-accent">{ENVELOPE}</span>
      <p className="text-md leading-[1.5] text-ink-2">{W.weSentTo(<strong className="text-ink">{email}</strong>)}</p>
      <p className="text-sm leading-[1.5] text-ink-3">{W.linkWorks}</p>
      {inbox && (
        <a
          href={inbox.url}
          target="_blank"
          rel="noreferrer"
          className="flex h-11 w-full items-center justify-center rounded-full text-md font-medium transition-transform active:scale-[0.98]"
          style={primaryLook}
        >
          {W.openInbox(inbox.name)}
        </a>
      )}
      <button
        type="button"
        data-testid="check-email-again"
        disabled={wait > 0 || state === 'sending'}
        onClick={async () => {
          setState('sending')
          const ok = await resend().catch(() => false)
          setState(ok ? 'sent' : 'failed')
          if (ok) count()
        }}
        className="flex h-11 w-full items-center justify-center rounded-full text-md font-medium transition-transform active:scale-[0.98] disabled:opacity-40"
        style={inbox ? { background: 'var(--surface)', color: 'var(--ink)' } : primaryLook}
      >
        <span className="tabular-nums">
          {state === 'sending'
            ? W.sending
            : wait > 0
              ? state === 'sent'
                ? W.sentSendAnotherIn(wait)
                : W.sendAnotherIn(wait)
              : W.sendAnother}
        </span>
      </button>
      {state === 'failed' && (
        <p role="alert" className="text-base text-danger">
          {W.couldntSend}
        </p>
      )}
      <button type="button" onClick={back.go} className="text-base text-accent">
        {back.label}
      </button>
    </div>
  )
}

/**
 * `/verify/<token>`: a confirmation link from before the password came after the proof, still in
 * somebody's inbox, or a link of a change of address — told apart by the
 * token's own first letters, which say which mail it came in.
 */
export function Verify({ token }: { token: string }) {
  return /^(eml|apv)_/.test(token) ? <ChangeOfAddress token={token} /> : <Confirmation token={token} />
}

type AddressLink = {
  kind: 'approve' | 'email'
  email: string
  account: { id: string; name: string; email: string }
  needs_session: boolean
}

/* Whose a link to confirm is, against who this browser is signed in as: a
   press from anybody else is refused by the server anyway, so it is not
   offered. A link that asks no session — an approval, or an account whose
   address nobody proved — is pressed from anywhere. */
function placed(l: AddressLink): 'ask' | 'sign-in' | 'other' {
  if (!l.needs_session) return 'ask'
  const s = stored()
  return !s ? 'sign-in' : s.actor_id === l.account.id ? 'ask' : 'other'
}

/* A name somebody chose, at most this long where the page says it: a name
   written to look like a warning does not get to fill the page. */
const NAME_SHOWN = 60
const shortName = (name: string) => (name.length > NAME_SHOWN ? `${name.slice(0, NAME_SHOWN - 1)}…` : name)

/**
 * A link of a change of address. Opening it changes nothing: the page says
 * what it would do, naming the account, and the press does it. The old
 * address's yes is anybody's press who has its letter, since that inbox is
 * the account; the new address is confirmed only from the account's own
 * session, so a browser signed in to nobody, or to somebody else, is told
 * to sign in to that account and comes back here after it.
 */
function ChangeOfAddress({ token }: { token: string }) {
  const [link, setLink] = useState<AddressLink | null>(null)
  const [state, setState] = useState<'reading' | 'ask' | 'sign-in' | 'other' | 'changed' | 'approved' | 'taken' | 'gone' | 'failed'>(
    'reading',
  )
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', 'dark')
    document.title = W.confirmingTitle
    void (async () => {
      const r = await fetch('/auth/verify/peek', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ token }),
      }).catch(() => null)
      if (r?.ok) {
        const l = (await r.json()) as AddressLink
        setLink(l)
        setState(placed(l))
        return
      }
      setState(r?.status === 410 ? 'gone' : 'failed')
    })()
  }, [token])

  async function press() {
    if (!link || busy) return
    setBusy(true)
    try {
      /* No session asked: the old address's yes, or a new address for an
         account nobody proved, whose previous holder the press puts out. */
      if (!link.needs_session) {
        const r = await fetch('/auth/verify', {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ token, pressed: true }),
        }).catch(() => null)
        const done = link.kind === 'approve' ? 'approved' : 'changed'
        setState(r?.ok ? done : r?.status === 410 ? 'gone' : r?.status === 409 ? 'taken' : 'failed')
        return
      }
      await api('/me/email/confirm', { method: 'POST', body: JSON.stringify({ token, pressed: true }) })
      setState('changed')
    } catch (e) {
      if (e instanceof Refused) {
        const code = (e.said as { error?: { code?: string } } | undefined)?.error?.code
        setState(code === 'not_this_account' ? 'other' : e.status === 410 ? 'gone' : e.status === 409 ? 'taken' : 'failed')
      } else {
        /* The session ended while the page was open: signed out here, so
           signing in is what is left. */
        setState(e instanceof Error && e.message === 'unauthorized' ? 'sign-in' : 'failed')
      }
    } finally {
      setBusy(false)
    }
  }

  /* To signing in, and back here once it is done (`App.tsx`). Signed in as
     somebody else, that session ends first: the sign-in screen is only
     shown to a browser signed in to nobody. */
  async function signInThere(asAnother: boolean) {
    try {
      sessionStorage.setItem(AFTER_SIGN_IN, location.pathname)
    } catch {
      /* No storage: they sign in, and open the link again. */
    }
    if (asAnother) await signOut()
    location.assign('/signin')
  }

  if (state === 'reading') return null
  const name = shortName(link?.account.name ?? '')
  const now = link?.account.email ?? ''
  const email = link?.email ?? ''
  /* A new address for an account nobody proved: whoever held it goes, and
     the password with them. */
  const weak = link?.kind === 'email' && !link.needs_session
  const title = {
    ask: link?.kind === 'approve' ? W.askApprove : W.askConfirm,
    'sign-in': W.signInToConfirm,
    other: W.signInToConfirm,
    changed: W.changed,
    approved: W.approved,
    taken: W.taken,
    gone: W.gone,
    failed: W.failed,
  }[state]
  const said = {
    ask:
      link?.kind === 'approve'
        ? W.saidAskApprove(email, name, now)
        : weak
          ? W.saidAskConfirmNew(email, name, now)
          : W.saidAskConfirm(email, name, now),
    'sign-in': W.saidSignInToConfirm(email, name, now),
    other: W.saidOtherAccount(email, name, now),
    changed: weak ? W.saidChangedChoose(email) : W.saidChanged(email),
    approved: W.saidApproved(email),
    taken: W.saidTaken,
    gone: W.saidGoneMoving,
    failed: W.saidFailed,
  }[state]
  const button = 'flex h-11 w-full items-center justify-center rounded-full text-md font-medium'
  /* After a weak account's change every session of it ended. */
  const signedIn = Boolean(stored()) && !(weak && state === 'changed')
  return (
    <AuthShell title={title}>
      <div data-testid="verify" data-state={state} data-kind={link?.kind} className="flex flex-col items-center gap-4 text-center">
        <p className="text-md leading-[1.5] text-ink-2">{said}</p>
        {state === 'ask' ? (
          <button
            type="button"
            data-testid="verify-press"
            onClick={() => void press()}
            disabled={busy}
            className={button}
            style={primaryLook}
          >
            {busy ? (link?.kind === 'approve' ? W.approving : W.confirming) : link?.kind === 'approve' ? W.approve : W.confirm}
          </button>
        ) : state === 'sign-in' || state === 'other' ? (
          <button
            type="button"
            data-testid="verify-sign-in"
            onClick={() => void signInThere(state === 'other')}
            className={button}
            style={primaryLook}
          >
            {state === 'other' ? W.signInToAnother : W.signIn}
          </button>
        ) : (
          <a href={signedIn ? '/' : '/signin'} className={button} style={primaryLook}>
            {signedIn ? W.openTuff : W.signIn}
          </a>
        )}
        {(state === 'ask' || state === 'sign-in' || state === 'other') && (
          <p className="text-sm leading-[1.5] text-ink-3">{W.ignoreIfNotYou}</p>
        )}
      </div>
    </AuthShell>
  )
}

/**
 * A confirmation link from before the password came after the proof, still in somebody's inbox. It
 * confirms the address and asks for a password, since the one the account
 * held goes with the confirmation.
 */
function Confirmation({ token }: { token: string }) {
  const [state, setState] = useState<'checking' | 'confirmed' | 'gone' | 'closed' | 'failed'>('checking')
  /* Confirming took the password the account held, chosen before the
     address was proved (migration 212): the link proved the inbox, so the
     password is chosen here, with the ticket the answer carried. */
  const [choosing, setChoosing] = useState<string | null>(null)
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', 'dark')
    document.title = W.confirmingTitle
    void (async () => {
      const r = await fetch('/auth/verify', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ token }),
      }).catch(() => null)
      if (r?.ok) {
        const body = (await r.json()) as Partial<Session> & { confirmed?: boolean; choose_password?: string }
        if (body.choose_password) {
          setChoosing(body.choose_password)
          return
        }
        if (body.access_token) {
          setSession(body as Session)
          /* Back to wherever the edition kept for a sign-up to return to,
             when that is why somebody signed up. */
          location.replace(edition.returnTo() ?? '/')
          return
        }
        setState('confirmed')
        return
      }
      /* Signed up before a server of one's own was claimed, and confirmed
         after it while sign-up is closed. */
      const closed =
        r?.status === 403 && ((await r.json().catch(() => ({}))) as { error?: { code?: string } }).error?.code === 'sign_up_closed'
      setState(closed ? 'closed' : r?.status === 410 ? 'gone' : 'failed')
    })()
  }, [token])
  const title = {
    checking: W.confirming,
    confirmed: W.confirmed,
    gone: W.gone,
    closed: W.closedTitle,
    failed: W.failed,
  }[state]
  const said = {
    checking: null,
    confirmed: W.saidConfirmed,
    gone: W.saidGone,
    closed: W.troubleClosed,
    failed: W.saidFailed,
  }[state]
  if (choosing) return <Reset token={choosing} choosing />
  return (
    <AuthShell title={title}>
      <div data-testid="verify" data-state={state} className="flex flex-col items-center gap-4 text-center">
        {said && <p className="text-md leading-[1.5] text-ink-2">{said}</p>}
        {state !== 'checking' && (
          <a href="/signin" className="flex h-11 w-full items-center justify-center rounded-full text-md font-medium" style={primaryLook}>
            {W.signIn}
          </a>
        )}
      </div>
    </AuthShell>
  )
}

/**
 * Whether this is your own server with no mail set up.
 * Said in the page by the server (`tuff-mail`), so a screen opens on the
 * right sentence; asked only where nothing wrote the page (the dev server).
 * Never on the service, whose server never says it: there a screen that
 * waits for a letter stays as it was, Resend key or not.
 */
function noMailInPage(): boolean | null {
  if (document.querySelector('meta[name="tuff-mail"]')?.getAttribute('content') === 'off') return true
  return document.querySelector('meta[name="tuff-providers"]') ? false : null
}
let noMailAsked: Promise<boolean> | null = null
export function useNoMail(): boolean {
  const [none, setNone] = useState(() => noMailInPage() === true)
  useEffect(() => {
    if (noMailInPage() !== null) return
    noMailAsked ??= fetch('/auth/providers')
      .then((r) => (r.ok ? (r.json() as Promise<{ no_mail?: boolean }>) : null))
      .then((p) => p?.no_mail === true)
      .catch(() => false)
    void noMailAsked.then(setNone)
  }, [])
  return none
}

type Offered = { google: boolean; apple: boolean; github: boolean }
const NONE: Offered = { google: false, apple: false, github: false }
let asked: Promise<Offered> | null = null
/** Which providers this deployment has keys for, as the server wrote them
    into the page — there before anything is drawn. */
function written(): Offered | null {
  const said = document.querySelector('meta[name="tuff-providers"]')?.getAttribute('content')
  if (said == null) return null
  const ways = said.split(' ')
  return { google: ways.includes('google'), apple: ways.includes('apple'), github: ways.includes('github') }
}
/** Or asked, once a page, where nothing wrote them — the dev server. */
function offered(): Promise<Offered> {
  asked ??= fetch('/auth/providers')
    .then((r) => (r.ok ? (r.json() as Promise<Offered>) : NONE))
    .catch(() => NONE)
  return asked
}

export const GOOGLE = (
  <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
    <path
      fill="#4285F4"
      d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"
    />
    <path
      fill="#34A853"
      d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z"
    />
    <path
      fill="#FBBC05"
      d="M3.97 10.72A5.4 5.4 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.05l3.01-2.33Z"
    />
    <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z" />
  </svg>
)
export const APPLE = (
  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden fill="currentColor">
    <path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701" />
  </svg>
)

/* GitHub's own mark, white on its own dark, as GitHub asks it be drawn. */
export const GITHUB = (
  <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden fill="currentColor">
    <path
      fillRule="evenodd"
      d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"
    />
  </svg>
)

/**
 * Google, Apple and GitHub, when this deployment has their keys — a button that
 * answers "not configured" is worse than no button. Each is a link: the
 * server sends the browser on to the provider and back.
 */
export function ProviderButtons({ invite }: { invite?: string } = {}) {
  const [on, setOn] = useState<Offered>(() => written() ?? NONE)
  useEffect(() => {
    if (!written()) void offered().then(setOn)
  }, [])
  if (!on.google && !on.apple && !on.github) return null
  const look = 'flex h-11 items-center justify-center gap-3 rounded-full text-md font-medium transition-transform active:scale-[0.98]'
  /* Following an invitation, it goes with them to the provider and back,
     and they arrive in the workspace that asked. */
  const carried = invite ? `?invite=${encodeURIComponent(invite)}` : ''
  return (
    <>
      {on.google && (
        <a
          href={`/auth/oauth/google/start${carried}`}
          data-testid="with-google"
          className={look}
          style={{ background: '#fff', color: '#1f1f1f' }}
        >
          {GOOGLE}
          {W.withGoogle}
        </a>
      )}
      {on.apple && (
        <a
          href={`/auth/oauth/apple/start${carried}`}
          data-testid="with-apple"
          className={look}
          style={{ background: '#000', color: '#fff', boxShadow: 'inset 0 0 0 1px rgb(255 255 255 / 0.2)' }}
        >
          {APPLE}
          {W.withApple}
        </a>
      )}
      {on.github && (
        <a
          href={`/auth/oauth/github/start${carried}`}
          data-testid="with-github"
          className={look}
          style={{ background: '#24292f', color: '#fff', boxShadow: 'inset 0 0 0 1px rgb(255 255 255 / 0.2)' }}
        >
          {GITHUB}
          {W.withGithub}
        </a>
      )}
      <div className="my-2 flex items-center gap-3 text-sm text-ink-3">
        <span className="h-px flex-1 bg-line" />
        {W.orWithEmail}
        <span className="h-px flex-1 bg-line" />
      </div>
    </>
  )
}

/** What a provider's callback said when it sent somebody back without a session. */
export function providerTrouble(said: string | null): string | null {
  if (said === 'conflict') return W.troubleConflict
  if (said === 'github') return W.troubleGithub
  if (said === 'noemail') return W.troubleNoEmail
  if (said === 'expired') return W.troubleExpired
  if (said === 'off') return W.troubleOff
  if (said === 'failed') return W.troubleFailed
  /* A new account on a server of one's own with sign-up closed. */
  if (said === 'closed') return W.troubleClosed
  /* A link handed over by hand to another address. */
  if (said === 'elsewhere') return W.troubleElsewhere
  /* And what only the edition says — on the service, a workspace full for its plan. */
  return said ? edition.trouble(said) : null
}

/** A forgotten password: the address, and the same answer whatever it is. */
export function Forgot() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const noMail = useNoMail()
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', 'dark')
    document.title = W.forgotTitle
  }, [])
  async function go(e: React.FormEvent) {
    e.preventDefault()
    if (!/\S+@\S+\.\S+/.test(email) || busy) return
    setBusy(true)
    await fetch('/auth/password/forgot', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-tongue': now },
      body: JSON.stringify({ email: email.trim() }),
    }).catch(() => null)
    setBusy(false)
    setSent(true)
  }
  return (
    <AuthShell title={W.forgot}>
      {noMail ? (
        /* No letter can go: said instead of a form that would promise one. */
        <p data-testid="forgot-no-mail" className="text-center text-md leading-[1.5] text-ink-2">
          {W.forgotNoMail}
        </p>
      ) : sent ? (
        <p data-testid="forgot-sent" className="text-center text-md leading-[1.5] text-ink-2">
          {W.forgotSent(email.trim())}
        </p>
      ) : (
        <form onSubmit={go} className="flex flex-col gap-3">
          <p className="text-center text-md text-ink-2">{W.forgotAsk}</p>
          <input
            autoFocus
            data-testid="forgot-email"
            className={field}
            style={fieldLook}
            type="email"
            name="email"
            placeholder={W.email}
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <button
            type="submit"
            disabled={busy || !/\S+@\S+\.\S+/.test(email)}
            className="mt-2 h-11 rounded-full text-md font-medium disabled:opacity-40"
            style={primaryLook}
          >
            {W.sendLink}
          </button>
        </form>
      )}
      <p className="mt-2 text-center text-base text-ink-3">
        <a href="/signin" className="text-accent">
          {W.backToSignIn}
        </a>
      </p>
    </AuthShell>
  )
}

/**
 * The link from the mail: a password, then in.
 *
 * A forgotten password's link sets a new one, and the screen says to sign
 * in with it. The sign-up letter's link (its token starts `chs_`), or a
 * confirmation link from before the password came after the proof that took the old password, chooses
 * the first one — and in the browser that signed up the answer carries a
 * session, so the person lands in their workspace without signing in
 * again.
 */
export function Reset({ token, choosing: told = false }: { token: string; choosing?: boolean }) {
  const choosing = told || token.startsWith('chs_')
  const [password, setPassword] = useState('')
  const [state, setState] = useState<'asking' | 'done' | 'gone' | 'closed' | 'failed'>('asking')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', 'dark')
    document.title = choosing ? W.chooseTitle : W.resetTitle
  }, [choosing])
  async function go(e: React.FormEvent) {
    e.preventDefault()
    if (password.length < PASSWORD_MIN || busy) return
    setBusy(true)
    const r = await fetch('/auth/password/reset', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-tongue': now },
      body: JSON.stringify({ token, password }),
    }).catch(() => null)
    if (r?.ok) {
      const body = (await r.json().catch(() => ({}))) as Partial<Session>
      if (body.access_token) {
        setSession(body as Session)
        /* Back to wherever the edition kept for a sign-up to return to,
           when that is why somebody signed up. */
        location.replace(edition.returnTo() ?? '/')
        return
      }
    }
    setBusy(false)
    const closed =
      r?.status === 403 && ((await r.json().catch(() => ({}))) as { error?: { code?: string } }).error?.code === 'sign_up_closed'
    setState(r?.ok ? 'done' : closed ? 'closed' : r?.status === 410 ? 'gone' : 'failed')
  }
  return (
    <AuthShell title={choosing ? W.choose : W.reset}>
      {state === 'done' ? (
        <p data-testid="reset-done" className="text-center text-md leading-[1.5] text-ink-2">
          {choosing ? W.chooseDone : W.resetDone}
        </p>
      ) : state === 'closed' ? (
        /* An address that signed up before a server of one's own was
           claimed: sign-up is closed now. */
        <p className="text-center text-md leading-[1.5] text-ink-2">{W.troubleClosed}</p>
      ) : state === 'gone' ? (
        <p className="text-center text-md leading-[1.5] text-ink-2">
          {W.resetGone(
            <a href="/forgot" className="text-accent">
              {W.askNew}
            </a>,
          )}
        </p>
      ) : (
        <form onSubmit={go} className="flex flex-col gap-3" data-testid="reset-form">
          {choosing && (
            <p data-testid="choose-password" className="text-center text-md leading-[1.5] text-ink-2">
              {W.saidChoose}
            </p>
          )}
          <PasswordField
            autoFocus
            testId="reset-password"
            placeholder={choosing ? W.password : W.newPassword}
            value={password}
            onChange={setPassword}
          />
          {state === 'failed' && (
            <p role="alert" className="text-base text-danger">
              {W.couldntSet}
            </p>
          )}
          <button
            type="submit"
            disabled={busy || password.length < PASSWORD_MIN}
            className="mt-2 h-11 rounded-full text-md font-medium disabled:opacity-40"
            style={primaryLook}
          >
            {W.setPassword}
          </button>
        </form>
      )}
      <p className="mt-2 text-center text-base text-ink-3">
        <a href="/signin" className="text-accent">
          {W.signIn}
        </a>
      </p>
    </AuthShell>
  )
}
