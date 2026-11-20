import { useEffect, useRef, useState } from 'react'
import type { FeedbackSettings as Settings } from '@tracker/shared-schema'
import { api, Refused } from '../data/api.js'
import { ahead } from '../data/ahead.js'
import { FEEDBACK as W } from '../words/feedback.js'
import { edition } from '../edition.jsx'
import { Button, Panel, SectionHead, Switch as OnOff, notALogin, asTyped } from './kit.jsx'

/**
 * A project's feedback page, in its settings.
 *
 * On or off, the address it lives at, the name and line at its head, and
 * whether you hear of what arrives. Whoever runs the project changes the
 * page; anybody on it chooses whether to hear. Where the server says the
 * workspace does not have the page (`paid`), the section is the edition's
 * to draw, and on your own server there is no such workspace.
 */
const SLUG = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/

export function FeedbackSettings({
  projectId,
  owner,
  read,
  onTriage,
}: {
  projectId: string
  owner: boolean
  read: Settings
  /** Triage was added by turning the page on: the screen's own Triage switch and lists read again. */
  onTriage: () => void
}) {
  /* Read by the screen with its other sections, and kept fresh here after
     each save. */
  const [s, setS] = useState<Settings>(read)
  useEffect(() => setS(read), [read])
  /* Made fresh when the page is first made, so its fields start from it. */
  return (
    <Section
      key={s.page?.id ?? 'none'}
      projectId={projectId}
      owner={owner}
      s={s}
      onSaved={(fresh) => {
        if (fresh.triage && !s.triage) onTriage()
        setS(fresh)
      }}
    />
  )
}

export function Row({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-[56px] items-center gap-4 px-4 py-3">{children}</div>
}

export function Line({ title, hint }: { title: string; hint?: string | null }) {
  return (
    <span className="flex min-w-px flex-1 flex-col gap-1">
      <span className="text-base text-ink">{title}</span>
      {hint && <span className="text-sm text-ink-3">{hint}</span>}
    </span>
  )
}

const input = 'h-8 min-w-px flex-1 rounded-[var(--r-tile)] px-2 text-base outline-none placeholder:text-[var(--ink-3)]'
const inputLook = { background: 'var(--sunken)', color: 'var(--ink)' }

function Section({ projectId, owner, s, onSaved }: { projectId: string; owner: boolean; s: Settings; onSaved: (s: Settings) => void }) {
  const path = `/projects/${projectId}/feedback`
  const [live, setLive] = useState(s.page?.live ?? false)
  const [slug, setSlug] = useState(s.page?.slug ?? s.suggested_slug)
  const [name, setName] = useState(s.page?.name ?? '')
  const [intro, setIntro] = useState(s.page?.intro ?? '')
  const [following, setFollowing] = useState(s.following)
  const [slugSaid, setSlugSaid] = useState<string | null>(null)
  const [trouble, setTrouble] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const saving = useRef<Promise<unknown>>(Promise.resolve())

  /* The address as it is typed: free, taken, or not an address — asked a
     moment after the last key, never on every one. */
  useEffect(() => {
    if (!s.may) return
    if (slug === (s.page?.slug ?? null)) return setSlugSaid(null)
    if (!SLUG.test(slug)) return setSlugSaid(slug ? W.addressBad : null)
    const t = setTimeout(() => {
      void api<{ free: boolean }>(`${path}/slug/${encodeURIComponent(slug)}`)
        .then((r) => setSlugSaid(r.free ? null : W.addressTaken))
        .catch(() => {})
    }, 300)
    return () => clearTimeout(t)
  }, [slug, s.may, s.page?.slug, path])

  /* One save at a time, in the order made, and the answer read back. */
  const save = (change: Record<string, unknown>) => {
    setTrouble(null)
    saving.current = saving.current
      .then(async () => {
        await api(path, { method: 'PUT', body: JSON.stringify(change) })
        /* Through `ahead`, so the next visit starts from this answer. */
        onSaved(await ahead<Settings>(path))
      })
      .catch((e: unknown) => {
        if (e instanceof Refused && e.message) {
          if ('slug' in change) setSlugSaid(e.message)
          else setTrouble(e.message)
        } else setTrouble(W.couldntSave)
        void ahead<Settings>(path)
          .then((fresh) => {
            onSaved(fresh)
            setLive(fresh.page?.live ?? false)
          })
          .catch(() => {})
      })
  }

  const address = `${location.host}/f/${s.page?.slug ?? slug}`
  const href = `/f/${s.page?.slug ?? slug}`

  if (!s.paid) return edition.FeedbackLocked ? <edition.FeedbackLocked owner={owner} /> : null

  return (
    <section data-testid="project-feedback" className="flex flex-col gap-3">
      <SectionHead>{W.head}</SectionHead>
      <Panel>
        <Row>
          {/* Said before the press, when it will add Triage. */}
          <Line title={W.on} hint={!s.may ? W.managersOnly : !live && !s.triage ? `${W.hint} ${W.addsTriage}` : W.hint} />
          <OnOff
            testId="feedback-switch"
            said={W.on}
            on={live}
            disabled={!s.may || (!s.page && Boolean(slugSaid))}
            onChange={(next) => {
              setLive(next)
              save({ live: next, ...(s.page ? {} : { slug }) })
            }}
          />
        </Row>
        {s.may && (
          <>
            <Row>
              <label className="flex w-full flex-col gap-2">
                <span className="flex items-center gap-3">
                  <span className="w-16 shrink-0 text-base text-ink">{W.address}</span>
                  <span className="flex min-w-px flex-1 items-center gap-1">
                    <span className="shrink-0 text-base text-ink-3">{location.host}/f/</span>
                    <input
                      {...notALogin}
                      {...asTyped}
                      data-testid="feedback-slug"
                      aria-label={W.address}
                      value={slug}
                      maxLength={40}
                      spellCheck={false}
                      onChange={(e) => setSlug(e.target.value.toLowerCase())}
                      onBlur={() => {
                        if (s.page && slug !== s.page.slug && SLUG.test(slug) && !slugSaid) save({ slug })
                      }}
                      className={input}
                      style={inputLook}
                    />
                  </span>
                </span>
                {/* Its line is always there, so a word about the address
                    does not push the rows under it down. */}
                <span data-testid="feedback-slug-said" className="min-h-[20px] pl-20 text-sm text-danger">
                  {slugSaid}
                </span>
              </label>
            </Row>
            {s.page && (
              <>
                <Row>
                  <span className="w-16 shrink-0 text-base text-ink">{W.name}</span>
                  <input
                    {...notALogin}
                    data-testid="feedback-name"
                    aria-label={W.name}
                    value={name}
                    maxLength={80}
                    onChange={(e) => setName(e.target.value)}
                    onBlur={() => {
                      if (name.trim() && name.trim() !== s.page!.name) save({ name: name.trim() })
                    }}
                    className={input}
                    style={inputLook}
                  />
                </Row>
                <Row>
                  <span className="w-16 shrink-0 text-base text-ink">{W.intro}</span>
                  <input
                    {...notALogin}
                    data-testid="feedback-intro"
                    aria-label={W.intro}
                    placeholder={W.introHint}
                    value={intro}
                    maxLength={200}
                    onChange={(e) => setIntro(e.target.value)}
                    onBlur={() => {
                      if (intro.trim() !== (s.page!.intro ?? '')) save({ intro: intro.trim() || null })
                    }}
                    className={input}
                    style={inputLook}
                  />
                </Row>
              </>
            )}
          </>
        )}
        {s.page?.live && (
          <Row>
            <span data-testid="feedback-address" className="min-w-px flex-1 truncate text-base text-ink-2">
              {address}
            </span>
            <Button
              type="button"
              data-testid="feedback-copy"
              onClick={() => {
                void navigator.clipboard
                  ?.writeText(`${location.origin}${href}`)
                  .then(() => {
                    setCopied(true)
                    setTimeout(() => setCopied(false), 1600)
                  })
                  .catch(() => {})
              }}
            >
              {/* Both words take the same room, so the button never changes size. */}
              <span className="grid">
                <span className="col-start-1 row-start-1" style={{ visibility: copied ? 'hidden' : 'visible' }}>
                  {W.copy}
                </span>
                <span className="col-start-1 row-start-1" style={{ visibility: copied ? 'visible' : 'hidden' }}>
                  {W.copied}
                </span>
              </span>
            </Button>
            <a
              href={href}
              target="_blank"
              rel="noopener"
              data-testid="feedback-open"
              className="inline-flex shrink-0 items-center rounded-full px-4 text-sm font-medium bg-control text-ink"
              style={{ height: 'var(--control-h)' }}
            >
              {W.open}
            </a>
          </Row>
        )}
        {s.page && (
          <Row>
            <Line title={W.follow} />
            <OnOff
              testId="feedback-follow"
              said={W.follow}
              on={following}
              onChange={(next) => {
                setFollowing(next)
                void api(`${path}/follow`, { method: 'PUT', body: JSON.stringify({ follow: next }) }).catch(() => setFollowing(!next))
              }}
            />
          </Row>
        )}
      </Panel>
      {(trouble || (s.page?.live && !s.triage)) && (
        <p className="max-w-[560px] px-1 text-sm" style={{ color: trouble ? 'var(--danger)' : 'var(--ink-3)' }}>
          {trouble ?? W.noTriage}
        </p>
      )}
    </section>
  )
}
