import { useEffect, useRef, useState } from 'react'
import type { FeedbackPublic } from '@tracker/shared-schema'
import { now } from '../data/words.js'
import { FEEDBACK as W } from '../words/feedback.js'
import { ProjectMark } from './icons.jsx'
import { Looks, MadeBy } from './PublicDoc.jsx'
import { wearBrand } from '../data/brand.js'
import { notALogin } from './kit.jsx'

/**
 * A project's feedback page, phase 1: asking.
 *
 * Read with no session. A box to ask in, and, once somebody has confirmed
 * their address on this page, the key it handed their browser so the next
 * request needs no mail. The page's name and line are the team's; nothing
 * a stranger types is drawn here for anybody else.
 */

const HEADERS = { 'content-type': 'application/json', 'x-api-version': '1', 'x-tongue': now }

/* The key this page handed this browser, kept per page. Storage may be
   refused — a private window — and then every request goes by mail. */
const keyName = (slug: string) => `tracker.feedback.${slug}`
function readKey(slug: string): string | null {
  try {
    return localStorage.getItem(keyName(slug))
  } catch {
    return null
  }
}
function writeKey(slug: string, key: string | null): void {
  try {
    if (key) localStorage.setItem(keyName(slug), key)
    else localStorage.removeItem(keyName(slug))
  } catch {
    // Not kept: the next request asks for an address again.
  }
}

async function ask<T>(path: string, init: RequestInit = {}, key?: string | null): Promise<{ ok: boolean; status: number; body: T }> {
  const r = await fetch(`/api/f/${path}`, {
    ...init,
    headers: { ...HEADERS, ...(key ? { authorization: `Feedback ${key}` } : {}) },
  })
  return { ok: r.ok, status: r.status, body: (await r.json().catch(() => ({}))) as T }
}

type Said = { error?: { code?: string; message?: string } }

/* ------------------------------------------------------------ Turnstile */

type Turnstile = {
  render: (el: HTMLElement, o: Record<string, unknown>) => string
  reset: (id: string) => void
  remove: (id: string) => void
}
declare global {
  interface Window {
    turnstile?: Turnstile
  }
}

let loading: Promise<Turnstile> | null = null
function turnstile(): Promise<Turnstile> {
  if (window.turnstile) return Promise.resolve(window.turnstile)
  loading ??= new Promise((done, fail) => {
    const s = document.createElement('script')
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    s.async = true
    s.onload = () => (window.turnstile ? done(window.turnstile) : fail(new Error('turnstile')))
    s.onerror = () => fail(new Error('turnstile'))
    document.head.appendChild(s)
  })
  return loading
}

/**
 * Cloudflare's check, in a slot of its own size from the first frame, so
 * nothing under it moves when it draws. Hands its token up, and a fresh
 * one after each send.
 */
function Check({ siteKey, round, onToken }: { siteKey: string; round: number; onToken: (t: string | null) => void }) {
  const el = useRef<HTMLDivElement>(null)
  const id = useRef<string | null>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: the widget is drawn once per site key; onToken is the page's and is read when it answers
  useEffect(() => {
    let alive = true
    void turnstile()
      .then((t) => {
        if (!alive || !el.current || id.current) return
        id.current = t.render(el.current, {
          sitekey: siteKey,
          theme: 'auto',
          language: now,
          callback: (token: string) => onToken(token),
          'expired-callback': () => onToken(null),
          'error-callback': () => onToken(null),
        })
      })
      .catch(() => onToken(null))
    return () => {
      alive = false
      if (id.current) window.turnstile?.remove(id.current)
      id.current = null
    }
  }, [siteKey])
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new round resets the widget; onToken is the page's and is read when it answers
  useEffect(() => {
    if (round > 0 && id.current) {
      onToken(null)
      window.turnstile?.reset(id.current)
    }
  }, [round])
  return <div ref={el} data-turnstile className="h-[68px]" />
}

/* ---------------------------------------------------------------- shell */

const field = 'w-full rounded-[var(--r-tile)] px-3 text-md outline-none placeholder:text-[var(--ink-3)]'
const fieldLook = { background: 'var(--sunken)', color: 'var(--ink)' }

function Shell({ page, children }: { page: FeedbackPublic | null; children: React.ReactNode }) {
  return (
    <div data-feedback-page data-page className="min-h-screen bg-surface text-ink">
      <main className="mx-auto flex max-w-[640px] flex-col px-4 pt-16 pb-12 sm:px-8">
        {page && (
          <header className="flex flex-col gap-4 pb-8">
            <ProjectMark id={page.slug} name={page.name} url={page.mark.url} icon={page.mark.icon} tint={page.mark.tint} size={48} />
            <h1 className="text-display leading-[1.15] font-semibold" style={{ letterSpacing: '-0.025em' }}>
              {page.name}
            </h1>
            {page.intro && <p className="text-lg leading-[1.45] text-ink-2">{page.intro}</p>}
          </header>
        )}
        {children}
        <footer
          className="mt-16 flex flex-wrap items-center gap-x-3 gap-y-2 border-t pt-6 text-sm text-ink-3"
          style={{ borderColor: 'var(--line)' }}
        >
          <span className="ml-auto flex items-center gap-4">
            <Looks />
            <MadeBy known brand={page?.brand} from="feedback" />
          </span>
        </footer>
      </main>
    </div>
  )
}

/** The page's ground and nothing on it, while what goes on it is read. */
function Blank() {
  return <div className="min-h-screen bg-surface" />
}

function Notice({ title, body, children }: { title: string; body?: string; children?: React.ReactNode }) {
  return (
    <section data-feedback-notice className="flex flex-col gap-3 rounded-[var(--r-card)] p-6 bg-panel">
      <h2 className="text-xl font-semibold">{title}</h2>
      {body && <p className="text-md leading-[1.45] text-ink-2">{body}</p>}
      {children}
    </section>
  )
}

/* ------------------------------------------------------------- the page */

/** The page and, beside it, whose key this browser holds — read together, so it opens whole. */
function usePage(slug: string): { page: FeedbackPublic | null; missing: boolean; me: string | null; forget: () => void } {
  const [state, setState] = useState<{ page: FeedbackPublic | null; missing: boolean; me: string | null }>({
    page: null,
    missing: false,
    me: null,
  })
  useEffect(() => {
    let alive = true
    const key = readKey(slug)
    void Promise.all([
      ask<FeedbackPublic & Said>(encodeURIComponent(slug)),
      key ? ask<{ email?: string }>(`${encodeURIComponent(slug)}/me`, {}, key) : Promise.resolve(null),
    ])
      .then(([p, m]) => {
        if (!alive) return
        if (!p.ok) return setState({ page: null, missing: true, me: null })
        /* A slug given up for another: the page is at its new address. */
        if (p.body.moved_to) {
          location.replace(location.pathname.replace(`/f/${slug}`, `/f/${p.body.moved_to}`))
          return
        }
        if (key && m && !m.ok) writeKey(slug, null)
        setState({ page: p.body, missing: false, me: m?.ok ? (m.body.email ?? null) : null })
      })
      .catch(() => alive && setState({ page: null, missing: true, me: null }))
    return () => {
      alive = false
    }
  }, [slug])
  useEffect(() => {
    document.title = state.page ? W.title(state.page.name) : 'Tuff'
    /* The workspace's mark on the tab, where its plan wears one. */
    wearBrand(state.page?.brand ?? null)
  }, [state.page])
  return {
    ...state,
    forget: () => {
      writeKey(slug, null)
      setState((s) => ({ ...s, me: null }))
    },
  }
}

export function FeedbackPage({ slug }: { slug: string }) {
  const { page, missing, me, forget } = usePage(slug)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [email, setEmail] = useState('')
  const [token, setToken] = useState<string | null>(null)
  const [round, setRound] = useState(0)
  const [busy, setBusy] = useState(false)
  const [wrong, setWrong] = useState<string | null>(null)
  const [done, setDone] = useState<null | { mailed: string | null }>(null)

  if (missing) {
    return (
      <Shell page={null}>
        <Notice title={W.missing} body={W.missingBody} />
      </Shell>
    )
  }
  /* Nothing until the page is known: a frame that fills in later is the
     thing this product does not draw. */
  if (!page) return <Blank />
  if (!page.available) {
    return (
      <Shell page={page}>
        <Notice title={W.unavailable} />
      </Shell>
    )
  }

  const needsCheck = Boolean(page.turnstile_site_key)
  const ready = title.trim().length > 0 && (me || email.trim().length > 0) && (!needsCheck || token) && !busy

  const send = async () => {
    if (!ready) return
    setBusy(true)
    setWrong(null)
    try {
      const key = me ? readKey(slug) : null
      const r = await ask<{ status?: string } & Said>(
        `${encodeURIComponent(slug)}/requests`,
        {
          method: 'POST',
          body: JSON.stringify({
            title: title.trim(),
            body,
            ...(key ? {} : { email: email.trim() }),
            ...(token ? { turnstile: token } : {}),
          }),
        },
        key,
      )
      if (r.status === 401) {
        /* The key is no longer this page's: ask for an address instead. */
        forget()
        setWrong(r.body.error?.message ?? W.failed)
      } else if (!r.ok) {
        setWrong(r.body.error?.message ?? W.failed)
      } else {
        setDone({ mailed: r.body.status === 'check_email' ? email.trim() : null })
        setTitle('')
        setBody('')
      }
    } catch {
      setWrong(W.failed)
    } finally {
      setBusy(false)
      setRound((n) => n + 1)
    }
  }

  return (
    <Shell page={page}>
      {done ? (
        <Notice title={done.mailed ? W.checkEmail : W.sent} body={done.mailed ? W.checkEmailBody(done.mailed) : W.sentBody}>
          <button
            type="button"
            data-feedback-again
            onClick={() => setDone(null)}
            className="mt-1 h-10 w-fit rounded-full px-4 text-md font-medium bg-control text-ink"
          >
            {W.another}
          </button>
        </Notice>
      ) : (
        <form
          data-feedback-form
          className="flex flex-col gap-3 rounded-[var(--r-card)] p-6 bg-panel"
          onSubmit={(e) => {
            e.preventDefault()
            void send()
          }}
        >
          <h2 className="text-xl font-semibold">{W.askHead}</h2>
          <input
            {...notALogin}
            aria-label={W.askTitle}
            placeholder={W.askTitle}
            value={title}
            maxLength={120}
            onChange={(e) => setTitle(e.target.value)}
            className={`${field} h-12`}
            style={fieldLook}
          />
          <textarea
            aria-label={W.askBody}
            placeholder={W.askBody}
            value={body}
            maxLength={4000}
            onChange={(e) => setBody(e.target.value)}
            className={`${field} h-32 resize-none py-3 leading-[1.45]`}
            style={fieldLook}
          />
          {me ? (
            <p className="flex h-12 items-center gap-2 text-md text-ink-2">
              <span data-feedback-me className="min-w-px truncate">
                {W.sendingAs(me)}
              </span>
              <button type="button" onClick={forget} className="shrink-0 underline text-ink-3">
                {W.notYou}
              </button>
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              <input
                type="email"
                autoComplete="email"
                aria-label={W.askEmail}
                placeholder={W.askEmail}
                value={email}
                maxLength={254}
                onChange={(e) => setEmail(e.target.value)}
                className={`${field} h-12`}
                style={fieldLook}
              />
              <p className="px-1 text-sm text-ink-3">{W.emailUse}</p>
            </div>
          )}
          {page.turnstile_site_key && <Check siteKey={page.turnstile_site_key} round={round} onToken={setToken} />}
          {/* Its line is kept whether or not anything is wrong, so a
              refusal does not push the button down under the pointer. */}
          <p role="status" className="min-h-[20px] text-sm text-danger">
            {wrong}
          </p>
          <button
            type="submit"
            data-feedback-send
            disabled={!ready}
            className="h-12 rounded-full text-md font-medium transition-opacity disabled:opacity-40 bg-accent text-on-accent"
          >
            {busy ? W.sending : W.send}
          </button>
        </form>
      )}
    </Shell>
  )
}

/* ---------------------------------------------------- confirming an address */

/**
 * The page a mailed link opens: what it would confirm, and the press that
 * does. Opening it does nothing — mail scanners open every link.
 */
export function FeedbackConfirm({ slug, token }: { slug: string; token: string }) {
  const { page, missing } = usePage(slug)
  const [waiting, setWaiting] = useState<{ title: string; body: string; email: string } | null | 'gone'>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [wrong, setWrong] = useState<string | null>(null)
  const path = `${encodeURIComponent(slug)}/confirm/${encodeURIComponent(token)}`
  useEffect(() => {
    let alive = true
    void ask<{ title: string; body: string; email: string }>(path)
      .then((r) => alive && setWaiting(r.ok ? r.body : 'gone'))
      .catch(() => alive && setWaiting('gone'))
    return () => {
      alive = false
    }
  }, [path])

  if (missing) {
    return (
      <Shell page={null}>
        <Notice title={W.missing} body={W.missingBody} />
      </Shell>
    )
  }
  if (!page || waiting === null) return <Blank />
  const back = (
    <a href={`/f/${page.slug}`} data-feedback-back className="mt-1 text-md font-medium text-accent">
      {W.backToPage}
    </a>
  )
  if (!page.available) {
    return (
      <Shell page={page}>
        <Notice title={W.unavailable} />
      </Shell>
    )
  }
  if (done) {
    return (
      <Shell page={page}>
        <Notice title={W.confirmed} body={W.confirmedBody}>
          {back}
        </Notice>
      </Shell>
    )
  }
  if (waiting === 'gone') {
    return (
      <Shell page={page}>
        <Notice title={W.linkGone}>{back}</Notice>
      </Shell>
    )
  }
  return (
    <Shell page={page}>
      <Notice title={W.confirmHead}>
        <div className="flex flex-col gap-2 rounded-[var(--r-tile)] p-4 bg-sunken">
          <p data-feedback-asked className="text-lg font-medium" style={{ overflowWrap: 'anywhere' }}>
            {waiting.title}
          </p>
          {waiting.body && (
            <p className="text-md leading-[1.45] whitespace-pre-wrap text-ink-2" style={{ overflowWrap: 'anywhere' }}>
              {waiting.body}
            </p>
          )}
        </div>
        <p className="text-sm text-ink-3">{W.confirmFrom(waiting.email)}</p>
        <p role="status" className="min-h-[20px] text-sm text-danger">
          {wrong}
        </p>
        <button
          type="button"
          data-feedback-confirm
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            setWrong(null)
            try {
              const r = await ask<{ key?: string } & Said>(path, { method: 'POST', body: '{}' })
              if (r.ok && r.body.key) {
                writeKey(page.slug, r.body.key)
                setDone(true)
              } else if (r.status === 410) {
                setWaiting('gone')
              } else {
                setWrong(r.body.error?.message ?? W.failed)
              }
            } catch {
              setWrong(W.failed)
            } finally {
              setBusy(false)
            }
          }}
          className="h-12 rounded-full text-md font-medium transition-opacity disabled:opacity-40 bg-accent text-on-accent"
        >
          {busy ? W.confirming : W.confirm}
        </button>
      </Notice>
    </Shell>
  )
}
