import { useEffect, useRef, useState } from 'react'
import { api, Refused, setSession, stored, type Session } from '../data/api.js'
import { now } from '../data/words.js'
import { edition } from '../edition.jsx'
import type { WebEdition } from '../editionShape.js'
import { Dialog, MARK_SAID, PROJECT_MARKS, notALogin, asTyped } from './kit.jsx'
import { Icon } from './glyphs.jsx'
import { WorkspaceMark } from './WorkspaceMark.jsx'
import { pictureFor } from '../data/picture.js'
import type { InviteMade } from '@tracker/shared-schema'
import { EmailChips, HandedLinks, linkOf } from './InviteDialog.jsx'
import { NEW_WORKSPACE as W } from '../words/newWorkspace.js'

type Address = { slug: string; free: boolean; suggestion: string } | null

/** The shape an address can take — the server's rule, said before asking. */
const SHAPE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/
const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/

/**
 * A new workspace, in two steps.
 *
 * Its name, its address and its mark on one page, because
 * they are one thing — what the workspace is called and how it looks — and
 * the address follows the name until somebody types one of their own; then,
 * once it exists, the people to ask in, by email. Each step can be left: the
 * workspace is made by the second, and the third is an offer.
 */
export function NewWorkspace({ onClose }: { onClose: () => void }) {
  /* Nothing asked here but the workspace itself: whatever the edition
     makes a new one on is changed where that is done, in its settings. */
  const [step, setStep] = useState<'about' | 'invite'>('about')
  /* How many a new workspace holds — the edition's to say: a plan's
     ceiling on the service, none on your own server. */
  const holds = edition.newWorkspaceCeiling
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  /* Whether the address is the person's own, or still following the name. */
  const [ownSlug, setOwnSlug] = useState(false)
  const [address, setAddress] = useState<Address>(null)
  const [icon, setIcon] = useState<string | null>(null)
  const [tint, setTint] = useState<number | null>(null)
  const [picture, setPicture] = useState<File | null>(null)
  const pictureUrl = usePreview(picture)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  const [made, setMade] = useState<{ slug: string } | null>(null)

  /* The address as it is typed: what the name would get, or whether the one
     typed is free and the nearest that is. Asked a moment after the typing
     stops, and only the newest answer is kept. */
  const asked = useRef(0)
  useEffect(() => {
    if (step !== 'about') return
    const want = ownSlug ? slug.trim().toLowerCase() : ''
    if (!want && !name.trim()) return setAddress(null)
    if (want && !SHAPE.test(want)) return setAddress({ slug: want, free: false, suggestion: '' })
    const mine = ++asked.current
    const wait = setTimeout(() => {
      const q = new URLSearchParams(want ? { want, name } : { name })
      void api<NonNullable<Address>>(`/workspaces/address?${q}`)
        .then((r) => {
          if (mine !== asked.current) return
          setAddress(r)
          if (!want) setSlug(r.slug)
        })
        .catch(() => mine === asked.current && setAddress(null))
    }, 200)
    return () => clearTimeout(wait)
  }, [name, slug, ownSlug, step])

  const ready = name.trim() !== '' && address?.free === true && !busy

  async function create() {
    if (!ready) return
    setBusy(true)
    setFailed(null)
    try {
      const s = await api<Session & { slug: string }>('/workspaces', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), slug: slug.trim().toLowerCase(), mark_icon: icon, mark_tint: tint }),
      })
      setSession(s)
      /* The picture goes up as the new workspace's own, with its session. */
      if (picture) {
        const form = new FormData()
        form.append('file', picture)
        await fetch('/api/workspace/icon', {
          method: 'POST',
          headers: { 'x-api-version': '1', 'x-tongue': now, authorization: `Bearer ${stored()?.access_token ?? ''}` },
          body: form,
        }).catch(() => {})
      }
      setMade({ slug: s.slug })
      setStep('invite')
    } catch (e) {
      /* Taken between being told it was free and pressing Create: asked
         again, so the nearest free one is offered under the field. */
      if (e instanceof Refused && e.status === 409) {
        const want = slug.trim().toLowerCase()
        const r = await api<NonNullable<Address>>(`/workspaces/address?${new URLSearchParams({ want, name })}`).catch(() => null)
        setAddress(r ?? { slug: want, free: false, suggestion: '' })
        setFailed(W.addressTaken)
      } else if (e instanceof Refused && (e.said as { error?: { code?: string } } | undefined)?.error?.code === 'owners_only')
        setFailed(W.onlyOwners)
      else setFailed(W.couldntCreate)
    } finally {
      setBusy(false)
    }
  }

  const go = () => made && location.assign(`/${made.slug}`)

  if (step === 'invite' && made) return <Invite name={name.trim()} slug={made.slug} holds={holds} onDone={go} />

  const button = (label: string, onClick: () => void, opts: { primary?: boolean; disabled?: boolean; testId?: string } = {}) => (
    <button
      data-testid={opts.testId}
      disabled={opts.disabled}
      onClick={onClick}
      className={`flex h-8 items-center rounded-full px-4 text-base font-medium disabled:opacity-40 ${opts.primary ? '' : 'px-3'}`}
      style={opts.primary ? { background: 'var(--accent)', color: 'var(--on-accent)' } : { color: 'var(--ink-2)' }}
    >
      {label}
    </button>
  )

  const look = { name: name.trim() || 'W', mark_icon: icon, mark_tint: tint, icon_url: pictureUrl }
  return (
    <Dialog
      title={W.newWorkspace}
      testId="new-workspace"
      onClose={onClose}
      footer={
        <div className="flex flex-1 items-center justify-end gap-2">
          {failed && (
            <span data-testid="workspace-failed" className="mr-auto text-sm text-danger">
              {failed}
            </span>
          )}
          {button(busy ? W.creating : W.create, () => void create(), {
            primary: true,
            disabled: !ready,
            testId: 'workspace-create',
          })}
        </div>
      }
    >
      <div className="flex flex-col gap-4 px-4 pt-2 pb-4">
        {/* The mark first, as an avatar is set: what it looks like, the
            picture or the way to one beside it, and the glyph and colour
            under; then the name and the address it makes. */}
        <div className="flex flex-col gap-2">
          <span className="text-sm text-ink-3">{W.icon}</span>
          <div className="flex items-center gap-3">
            <WorkspaceMark look={look} size={48} />
            {picture ? (
              <div className="flex items-center gap-3 text-base">
                <span className="text-ink-2">{picture.name}</span>
                <button data-testid="workspace-picture-remove" onClick={() => setPicture(null)} className="font-medium text-accent">
                  {W.removePicture}
                </button>
              </div>
            ) : (
              <label className="flex h-8 cursor-pointer items-center gap-2 rounded-full px-3 text-base font-medium bg-hover text-ink">
                <Icon name="upload" size={16} />
                {W.uploadPicture}
                <input
                  type="file"
                  accept="image/*"
                  data-testid="workspace-picture"
                  className="hidden"
                  onChange={async (e) => {
                    const f = e.target.files?.[0]
                    e.target.value = ''
                    if (!f) return
                    /* Made fit as every mark is — `data/picture.ts` — and a
                       refusal said rather than the press doing nothing. */
                    const fit = await pictureFor(f)
                    if ('refused' in fit) return setFailed(fit.refused)
                    setFailed(null)
                    setPicture(fit)
                  }}
                />
              </label>
            )}
          </div>
          {!picture && (
            <>
              <div
                role="radiogroup"
                aria-label={W.symbol}
                className="flex flex-wrap items-center gap-1 self-start p-1 bg-track"
                style={{ borderRadius: 'var(--r-panel)' }}
              >
                {[null, ...PROJECT_MARKS].map((g) => {
                  const on = icon === g
                  return (
                    <button
                      key={g ?? 'letter'}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      data-workspace-glyph={g ?? 'letter'}
                      title={g ? (MARK_SAID[g] ?? g) : W.firstLetter}
                      onClick={() => setIcon(g)}
                      className="flex size-8 items-center justify-center text-base font-semibold"
                      style={{
                        borderRadius: 'var(--r-pill)',
                        background: on ? 'var(--track-on)' : 'transparent',
                        boxShadow: on ? 'var(--control-shadow)' : undefined,
                        color: on ? 'var(--ink)' : 'var(--ink-2)',
                      }}
                    >
                      {g ? <Icon name={g} size={16} /> : (name.trim()[0] ?? 'A').toUpperCase()}
                    </button>
                  )
                })}
              </div>
              <div
                role="radiogroup"
                aria-label={W.colour}
                className="flex flex-wrap items-center gap-1 self-start p-1 bg-track"
                style={{ borderRadius: 'var(--r-panel)' }}
              >
                {Array.from({ length: 10 }, (_, i) => i).map((i) => {
                  const on = (tint ?? -1) === i
                  return (
                    <button
                      key={i}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      data-workspace-tint={i}
                      onClick={() => setTint(i)}
                      className="flex size-8 items-center justify-center"
                      style={{
                        borderRadius: 'var(--r-pill)',
                        background: on ? 'var(--track-on)' : 'transparent',
                        boxShadow: on ? 'var(--control-shadow)' : undefined,
                      }}
                    >
                      <span className="size-4 rounded-full" style={{ background: `var(--face-${i})` }} />
                    </button>
                  )
                })}
              </div>
            </>
          )}
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-sm text-ink-3">{W.name}</span>
          <input
            {...notALogin}
            autoFocus
            data-testid="workspace-name"
            value={name}
            maxLength={80}
            placeholder="Acme Studio"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void create()}
            className="h-10 rounded-[var(--r-row)] px-3 text-base outline-none bg-sunken text-ink"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm text-ink-3">{W.address}</span>
          <span className="flex h-10 items-center rounded-[var(--r-row)] pl-3 text-base bg-sunken">
            <span className="shrink-0 text-ink-3">{location.host}/</span>
            <input
              {...notALogin}
              {...asTyped}
              data-testid="workspace-slug"
              value={slug}
              maxLength={40}
              spellCheck={false}
              autoCapitalize="off"
              onChange={(e) => {
                setOwnSlug(e.target.value.trim() !== '')
                setSlug(e.target.value.toLowerCase().replace(/\s+/g, '-'))
              }}
              onKeyDown={(e) => e.key === 'Enter' && void create()}
              className="h-full min-w-px flex-1 bg-transparent pr-3 outline-none text-ink"
            />
          </span>
          <AddressSays
            address={address}
            onUse={(s) => {
              setOwnSlug(true)
              setSlug(s)
            }}
          />
        </label>
      </div>
    </Dialog>
  )
}

/** What the address field says under itself. */
function AddressSays({ address, onUse }: { address: Address; onUse: (slug: string) => void }) {
  if (!address) return <span className="h-5" />
  if (address.free) {
    return (
      <span data-testid="workspace-slug-free" className="flex h-5 items-center gap-1 text-sm" style={{ color: 'var(--ok, #34c759)' }}>
        <Icon name="check" size={12} /> {W.available}
      </span>
    )
  }
  if (!SHAPE.test(address.slug)) {
    return (
      <span data-testid="workspace-slug-shape" className="h-5 text-sm text-danger">
        {W.shape}
      </span>
    )
  }
  return (
    <span data-testid="workspace-slug-taken" className="flex h-5 items-center gap-1 text-sm text-danger">
      {W.taken}
      {address.suggestion && (
        <button
          type="button"
          data-testid="workspace-slug-use"
          onClick={() => onUse(address.suggestion)}
          className="font-medium text-accent"
        >
          {W.isAvailable(address.suggestion)}
        </button>
      )}
    </span>
  )
}

/**
 * The people to ask in, once the workspace exists. Addresses typed, pasted
 * as a list, or one by one; each becomes a chip. Each is sent an invitation
 * by email — `POST /api/invites` with `email`, which mails it. Skipping is as
 * good an answer as sending: Members does the same any day. On a server
 * with no mail, the answer carries each invitation's link instead, and the
 * step stays open to show them.
 */
function Invite({
  name,
  slug,
  holds,
  onDone,
}: {
  name: string
  slug: string
  holds: WebEdition['newWorkspaceCeiling']
  onDone: () => void
}) {
  const [emails, setEmails] = useState<string[]>([])
  const [typing, setTyping] = useState('')
  const [sending, setSending] = useState(false)
  const [refused, setRefused] = useState<string[]>([])
  const [handed, setHanded] = useState<{ email: string; link: string }[]>([])
  const room = holds?.people ?? null
  const left = room === null ? null : room - 1

  async function sendAll() {
    const all = [...emails, ...(EMAIL.test(typing.trim()) ? [typing.trim().toLowerCase()] : [])]
    if (all.length === 0) return onDone()
    setSending(true)
    const failed: string[] = []
    const byHand: { email: string; link: string }[] = []
    for (const email of all) {
      try {
        const r = await api<InviteMade>('/invites', { method: 'POST', body: JSON.stringify({ role: 'member', email, rights: [] }) })
        if (r.token) byHand.push({ email, link: linkOf(r.token) })
      } catch {
        failed.push(email)
      }
    }
    setSending(false)
    const links = [...handed, ...byHand]
    if (failed.length === 0 && links.length === 0) return onDone()
    setHanded(links)
    setRefused(failed)
    setEmails(failed)
    setTyping('')
  }

  const count = emails.length + (EMAIL.test(typing.trim()) ? 1 : 0)
  /* More addresses than the workspace has places is not sent at all: each
     invitation holds a place, and the server refuses the ones past the
     ceiling. The edition says so beside the button. */
  const over = left !== null && count > left
  return (
    <Dialog
      title={W.newWorkspace}
      testId="new-workspace"
      onClose={onDone}
      footer={
        <div className="flex flex-1 items-center justify-end gap-2">
          <button data-testid="invite-skip" onClick={onDone} className="h-8 px-3 text-base font-medium text-ink-2">
            {refused.length || handed.length ? W.goToWorkspace : W.skip}
          </button>
          <button
            data-testid="invite-send"
            disabled={count === 0 || over || sending}
            onClick={() => void sendAll()}
            className="flex h-8 items-center rounded-full px-4 text-base font-medium disabled:opacity-40 bg-accent text-on-accent"
          >
            {sending ? W.sending : count > 1 ? W.sendMany(count) : W.sendOne}
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-3 px-4 pt-2 pb-4">
        <h2 className="text-lg font-medium text-ink">{W.isReady(name)}</h2>
        <p className="text-base text-ink-2">{W.peopleHint}</p>
        <EmailChips
          emails={emails}
          setEmails={setEmails}
          typing={typing}
          setTyping={setTyping}
          refused={refused}
          onSubmit={() => void sendAll()}
        />
        {/* Full is said with the way out of it, the edition's. */}
        {over && holds && left !== null && <holds.Over slug={slug} left={left} />}
        <HandedLinks handed={handed} />
        {refused.length > 0 && (
          <p data-testid="invite-refused" className="text-sm text-danger">
            {refused.length === 1 ? W.notSentOne : W.notSentMany(refused.length)}
            {holds ? ` ${holds.refused}` : ''}
          </p>
        )}
      </div>
    </Dialog>
  )
}

/** A local picture's address for as long as it is held. */
function usePreview(f: File | null): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!f) return setUrl(null)
    const u = URL.createObjectURL(f)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [f])
  return url
}
