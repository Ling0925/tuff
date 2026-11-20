import { useState, useRef, useEffect, useCallback } from 'react'
import { pictureFor } from '../../data/picture.js'
import { now, MORE } from '../../data/words.js'
import { ACCOUNT as W } from '../../words/account.jsx'
import { stored, api, authHeaders, Refused } from '../../data/api.js'
import { known, ahead } from '../../data/ahead.js'
import { PASSWORD_MIN, PasswordField } from '../Access.jsx'
import { SectionHead, Panel, Avatar, quietLook, Hairline, Dialog, Button } from '../kit.jsx'
import { type Address, field, fieldStyle, EMAIL } from '../Account.jsx'
import { Line } from './line.jsx'

/**
 * The person: their picture, their name, their address and what they do.
 *
 * The name was fixed on the day the account was made and the address for
 * good. Both are theirs here: the name saves on leaving the field, as the
 * workspace's does, and the address goes through a window that asks what
 * signing in asks, and a link to the new one.
 *
 * The picture is the same control a project's icon has, because it is the
 * same act — put a picture where the generated mark is, or take it off
 * again — and there is no permission to check, because there is nobody else
 * this could be changing. `docs/specs/avatar.md`.
 */
export function Face({
  me,
  onChanged,
}: {
  me: { actor: { id: string; name: string; avatar_url?: string | null; title?: string | null } }
  onChanged: () => Promise<void> | void
}) {
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState(me.actor.name)
  /* What they do, under their picture — `docs/specs/person-card.md`. */
  const [title, setTitle] = useState(me.actor.title ?? '')
  /* What was last sent, rather than what `me` says: `me` comes back with
     the rest of the shell a moment after a save, and a second edit in that
     moment was compared with the name before the first and dropped. */
  const sent = useRef({ name: me.actor.name, title: me.actor.title ?? '' })
  /*
   * And the account as the server says it, once it says it.
   *
   * The screen can open on what this machine kept from last time
   * (`docs/specs/arrival.md`), and a field set once from that copy kept it
   * after the fresh one arrived — a title changed on another device read
   * as the old one until the next reload. Taken up only where nobody has
   * typed: a field being edited keeps what is being written.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: taken up when the account's name changes, and only where nobody has typed
  useEffect(() => {
    const fresh = me.actor.name
    setName((now) => (now === sent.current.name ? fresh : now))
    if (sent.current.name !== fresh && name === sent.current.name) sent.current.name = fresh
  }, [me.actor.name])
  // biome-ignore lint/correctness/useExhaustiveDependencies: taken up when the account's title changes, and only where nobody has typed
  useEffect(() => {
    const fresh = me.actor.title ?? ''
    setTitle((now) => (now === sent.current.title ? fresh : now))
    if (sent.current.title !== fresh && title === sent.current.title) sent.current.title = fresh
  }, [me.actor.title])
  const [said, setSaid] = useState<string | null>(null)
  /* Kept from the last visit, so the line is drawn with its address in it. */
  const [address, setAddress] = useState<Address | null>(() => known<Address>('/me/email'))
  const [changing, setChanging] = useState(false)
  const [changingPassword, setChangingPassword] = useState(false)
  const [passwordSaid, setPasswordSaid] = useState<string | null>(null)
  const [resent, setResent] = useState(false)
  const has = Boolean(me.actor.avatar_url)

  const loadAddress = useCallback(async () => {
    const r = await ahead<Address>('/me/email').catch(() => null)
    if (r) setAddress(r)
  }, [])
  useEffect(() => {
    void loadAddress()
  }, [loadAddress])

  const waiting = address?.pending ?? null

  return (
    <section className="mt-9 flex flex-col gap-3">
      <SectionHead>{MORE.profile}</SectionHead>
      <Panel>
        <Line
          label={W.picture}
          hint={
            /* The letter is what a person who uploads nothing has, and it is
               finished rather than waiting to be replaced. */
            <span style={said ? { color: 'var(--danger)' } : undefined}>{said ?? (busy ? W.uploading : W.pictureHint)}</span>
          }
          wrap
        >
          <Avatar name={me.actor.name} id={me.actor.id} url={me.actor.avatar_url} size={32} />
          <label
            data-control
            className="inline-flex h-8 cursor-pointer items-center rounded-full px-4 text-sm font-medium"
            style={quietLook}
          >
            {has ? W.change : W.uploadPicture}
            <input
              type="file"
              accept="image/*"
              data-testid="my-avatar"
              className="hidden"
              onChange={async (e) => {
                const chosen = e.target.files?.[0]
                e.target.value = ''
                if (!chosen) return
                setBusy(true)
                setSaid(null)
                /* Made fit first: an SVG drawn as a PNG, a big photo made
                   small, a HEIC refused in words — `data/picture.ts`. */
                const picked = await pictureFor(chosen)
                if ('refused' in picked) {
                  setBusy(false)
                  setSaid(picked.refused)
                  return
                }
                const form = new FormData()
                form.append('file', picked)
                // Not through api(): multipart sets its own content type.
                const r = await fetch('/api/me/avatar', {
                  method: 'POST',
                  headers: {
                    'x-api-version': '1',
                    'x-tongue': now,
                    authorization: `Bearer ${stored()?.access_token ?? ''}`,
                  },
                  body: form,
                })
                setBusy(false)
                /* What the server refused and why, rather than a picture
                   that silently did not change. */
                if (!r.ok) {
                  const body = (await r.json().catch(() => null)) as { error?: { message?: string } } | null
                  setSaid(body?.error?.message ?? W.couldntUpload)
                  return
                }
                await onChanged()
              }}
            />
          </label>
          {has && (
            <button
              data-testid="drop-avatar"
              onClick={async () => {
                await api('/me/avatar', { method: 'DELETE' })
                await onChanged()
              }}
              className="inline-flex h-8 shrink-0 items-center rounded-full px-4 text-sm font-medium text-ink-2"
            >
              {MORE.backToTheLetter}
            </button>
          )}
        </Line>
        <Hairline inset={16} />
        <Line label={W.name} hint={W.nameHint} wrap>
          <input
            autoComplete="name"
            data-testid="my-name"
            aria-label={W.yourName}
            maxLength={200}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            // Read from the field: leaving it in the same tick as the last
            // keystroke would send what was there before.
            onBlur={async (e) => {
              const next = e.target.value.trim()
              if (!next) return setName(sent.current.name)
              if (next === sent.current.name) return
              sent.current.name = next
              await api('/me', { method: 'PATCH', body: JSON.stringify({ name: next }) })
              await onChanged()
            }}
            className={`${field} w-[280px] max-w-full`}
            style={fieldStyle}
          />
        </Line>
        <Hairline inset={16} />
        <Line label={W.title} hint={W.titleHint} wrap>
          <input
            autoComplete="organization-title"
            data-testid="my-title"
            maxLength={80}
            placeholder={W.titleExample}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            onBlur={async () => {
              if (title.trim() === sent.current.title) return
              sent.current.title = title.trim()
              await api('/me', { method: 'PATCH', body: JSON.stringify({ title: title.trim() || null }) })
              await onChanged()
            }}
            className={`${field} w-[280px] max-w-full`}
            style={fieldStyle}
          />
        </Line>
        <Hairline inset={16} />
        <Line
          label={W.email}
          hint={
            waiting ? (
              <span data-testid="email-pending">
                {waiting.approve ? W.approveFirst(address?.email ?? W.yourCurrentAddress, waiting.email) : W.openLinkSentTo(waiting.email)}{' '}
                {/* The two go together, so a narrow line breaks before them
                    rather than between them. */}
                <span className="whitespace-nowrap">
                  <button
                    data-testid="email-again"
                    disabled={resent}
                    onClick={async () => {
                      setResent(true)
                      await api('/me/email/again', { method: 'POST' }).catch(() => setResent(false))
                    }}
                    className="font-medium disabled:opacity-60 text-accent"
                  >
                    {resent ? W.sent : W.sendAgain}
                  </button>
                  {' · '}
                  <button
                    data-testid="email-cancel"
                    onClick={async () => {
                      setAddress((was) => (was ? { ...was, pending: null } : was))
                      await api('/me/email', { method: 'DELETE' }).catch(() => undefined)
                      await loadAddress()
                    }}
                    className="font-medium text-accent"
                  >
                    {W.cancel}
                  </button>
                </span>
              </span>
            ) : (
              W.emailHint
            )
          }
          wrap
        >
          <span data-testid="my-email" className="max-w-[280px] truncate text-base text-ink-2">
            {address?.email ?? ''}
          </span>
          <button
            data-testid="email-change"
            data-control
            disabled={!address}
            onClick={() => setChanging(true)}
            className="inline-flex h-8 shrink-0 items-center rounded-full px-4 text-sm font-medium transition-transform active:scale-[0.97] disabled:opacity-40"
            style={quietLook}
          >
            {W.change}
          </button>
        </Line>
        <Hairline inset={16} />
        {/* Changed here with the one there is now; an account with none —
            made through Google or Apple — gets its first by the link a
            forgotten one sends, because a session alone is not proof enough
            to add a way in. */}
        <Line label={W.password} hint={passwordSaid ?? (address && !address.asks.password ? W.noPasswordYet : W.changingSignsOut)} wrap>
          {address && !address.asks.password ? (
            <button
              data-testid="password-set"
              data-control
              onClick={async () => {
                const r = await fetch('/auth/password/forgot', {
                  method: 'POST',
                  headers: authHeaders(),
                  body: JSON.stringify({ email: address.email }),
                }).catch(() => null)
                setPasswordSaid(r?.ok ? W.linkToSet(address.email) : W.couldntSendLink)
              }}
              className="inline-flex h-8 shrink-0 items-center rounded-full px-4 text-sm font-medium transition-transform active:scale-[0.97]"
              style={quietLook}
            >
              {W.setPassword}
            </button>
          ) : (
            <button
              data-testid="password-change"
              data-control
              disabled={!address}
              onClick={() => setChangingPassword(true)}
              className="inline-flex h-8 shrink-0 items-center rounded-full px-4 text-sm font-medium transition-transform active:scale-[0.97] disabled:opacity-40"
              style={quietLook}
            >
              {W.change}
            </button>
          )}
        </Line>
      </Panel>
      {changingPassword && address && (
        <ChangePassword
          asks={address.asks}
          onClose={() => setChangingPassword(false)}
          onDone={(n) => setPasswordSaid(n === 0 ? W.passwordChanged : W.passwordChangedOut(n))}
        />
      )}
      {changing && address && (
        <ChangeEmail
          address={address}
          onClose={() => setChanging(false)}
          onSent={() => {
            setResent(false)
            void loadAddress()
          }}
        />
      )}
    </section>
  )
}

/**
 * The window that asks for a new address.
 *
 * It asks what signing in asks, so a borrowed laptop or a copied session is
 * not enough to move somebody's account: the password, and the code when
 * there is a second factor. An account with neither is told its current
 * address will be asked instead.
 */
function ChangeEmail({ address, onClose, onSent }: { address: Address; onClose: () => void; onSent: () => void }) {
  const [to, setTo] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<string | null>(null)
  const { asks } = address
  const ready = EMAIL.test(to.trim()) && (!asks.password || password.length > 0) && (!asks.code || code.trim().length > 0)

  async function go() {
    if (!ready || busy) return
    setBusy(true)
    setSaid(null)
    try {
      await api('/me/email', {
        method: 'POST',
        body: JSON.stringify({
          email: to.trim(),
          ...(asks.password ? { password } : {}),
          ...(asks.code ? { code: code.trim() } : {}),
        }),
      })
      onSent()
      onClose()
    } catch (e) {
      const status = e instanceof Refused ? e.status : 0
      setSaid(
        status === 403
          ? asks.code
            ? W.wrongPasswordOrCode
            : W.wrongPassword
          : status === 429
            ? W.tooManyTries
            : status === 400
              ? (e as Error).message
              : W.couldntSendLink,
      )
    } finally {
      setBusy(false)
    }
  }

  const input = 'h-10 rounded-[var(--r-row)] px-3 text-base outline-none placeholder:text-[var(--ink-3)]'
  const ground = { background: 'var(--sunken)', color: 'var(--ink)' }
  return (
    <Dialog
      title={W.changeYourEmail}
      testId="email-dialog"
      onClose={onClose}
      footer={
        <div className="flex flex-1 items-center justify-end gap-2">
          <button onClick={onClose} className="h-8 px-3 text-base font-medium text-ink-2">
            {MORE.cancel}
          </button>
          <Button tone="primary" data-testid="email-send" disabled={!ready || busy} onClick={() => void go()}>
            {busy ? W.sending : W.sendTheLink}
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
        <p className="text-sm leading-[1.5] text-ink-3">{asks.inbox ? W.approveByInbox(address.email) : W.linkToNew(address.email)}</p>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-ink-3">{W.newEmail}</span>
          <input
            autoFocus
            type="email"
            autoComplete="email"
            data-testid="email-new"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className={input}
            style={ground}
          />
        </label>
        {asks.password && (
          <label className="flex flex-col gap-1">
            <span className="text-sm text-ink-3">{W.yourPassword}</span>
            <input
              type="password"
              autoComplete="current-password"
              data-testid="email-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={input}
              style={ground}
            />
          </label>
        )}
        {asks.code && (
          <label className="flex flex-col gap-1">
            <span className="text-sm text-ink-3">{W.codeOrRecovery}</span>
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              data-testid="email-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className={input}
              style={ground}
            />
          </label>
        )}
        {said && (
          <p role="alert" data-testid="email-said" className="text-sm text-danger">
            {said}
          </p>
        )}
        {/* Enter sends, as it does in every other form here. */}
        <button type="submit" hidden />
      </form>
    </Dialog>
  )
}

/**
 * The window that changes the password.
 *
 * The one there is now first, as signing in asks for it, and the code when
 * there is a second factor; then the new one, which says what it needs while
 * it is typed. This device stays signed in, and the others are signed out.
 */
function ChangePassword({ asks, onClose, onDone }: { asks: Address['asks']; onClose: () => void; onDone: (signedOut: number) => void }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<string | null>(null)
  const ready = current.length > 0 && next.length >= PASSWORD_MIN && (!asks.code || code.trim().length > 0)

  async function go() {
    if (!ready || busy) return
    setBusy(true)
    setSaid(null)
    try {
      const r = await api<{ signed_out: number }>('/me/password', {
        method: 'POST',
        body: JSON.stringify({ current, password: next, ...(asks.code ? { code: code.trim() } : {}) }),
      })
      onDone(r.signed_out)
      onClose()
    } catch (e) {
      const status = e instanceof Refused ? e.status : 0
      setSaid(
        status === 403
          ? asks.code
            ? W.wrongPasswordOrCode
            : W.wrongPassword
          : status === 429
            ? W.tooManyAttempts
            : status === 400
              ? (e as Error).message
              : W.couldntChangePassword,
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      title={W.changePassword}
      testId="password-dialog"
      onClose={onClose}
      footer={
        <div className="flex flex-1 items-center justify-end gap-2">
          <button onClick={onClose} className="h-8 px-3 text-base font-medium text-ink-2">
            {MORE.cancel}
          </button>
          <Button tone="primary" data-testid="password-send" disabled={!ready || busy} onClick={() => void go()}>
            {busy ? W.changing : W.changePassword}
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
        <p className="text-sm leading-[1.5] text-ink-3">{W.staySignedIn}</p>
        <div className="flex flex-col gap-1">
          <span className="text-sm text-ink-3">{W.currentPassword}</span>
          <PasswordField
            look="window"
            rule={false}
            autoFocus
            placeholder={W.currentPassword}
            testId="password-current"
            value={current}
            onChange={setCurrent}
          />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-sm text-ink-3">{W.newPassword}</span>
          <PasswordField look="window" rule="new" placeholder={W.newPassword} testId="password-new" value={next} onChange={setNext} />
        </div>
        {asks.code && (
          <label className="flex flex-col gap-1">
            <span className="text-sm text-ink-3">{W.codeOrRecovery}</span>
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              data-testid="password-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="h-10 rounded-[var(--r-row)] px-3 text-base outline-none bg-sunken text-ink"
            />
          </label>
        )}
        {said && (
          <p role="alert" data-testid="password-said" className="text-sm text-danger">
            {said}
          </p>
        )}
        <button type="submit" hidden />
      </form>
    </Dialog>
  )
}
