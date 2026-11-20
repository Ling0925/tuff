import { useEffect, useState } from 'react'
import { api, Refused } from '../data/api.js'
import { ahead, know, known } from '../data/ahead.js'
import { INSTANCE as W } from '../words/instance.js'
import { checkState, releaseLink, UPDATE_COMMAND, type ServerVersion } from '../data/release.js'
import { Button, Field, Hairline, InboxCode, Panel, SectionHead, Switch, quietLook } from './kit.jsx'
import { PasswordField } from './Access.jsx'
import { Line } from './WorkspaceSettings.jsx'
import { MailFields, mailSummary } from './MailSettings.jsx'
import { draftOf, draftReady, inputOf, type MailDraft, type MailSetup } from '../data/mailSetup.js'
import { MAIL_SETTINGS as M } from '../words/mailSettings.js'

/**
 * Your own server's owner screen, `/:ws/instance`.
 *
 * Four things about the machine and nothing about a workspace: whether
 * anybody may sign up, who owns the server, whether mail leaves it, and
 * which version it runs — with a newer one when there is.
 * Drawn only for an owner; every answer behind it is the server's to
 * refuse, and on the service there is no such screen.
 */

type Owner = { actor_id: string; name: string; email: string | null; added_at: string }
export type Whole = { sign_up_open: boolean; owners: Owner[]; mail: boolean; mail_setup?: MailSetup; version?: ServerVersion }

export function Instance({ meId }: { meId: string }) {
  const [whole, setWhole] = useState<Whole | null>(() => known<Whole>('/instance'))
  const [email, setEmail] = useState('')
  const [adding, setAdding] = useState(false)
  const [ownersSaid, setOwnersSaid] = useState<string | null>(null)
  const [signUpSaid, setSignUpSaid] = useState<string | null>(null)
  const [letter, setLetter] = useState<'sending' | 'sent' | 'log' | 'failed' | 'many' | null>(null)

  useEffect(() => {
    void ahead<Whole>('/instance')
      .then(setWhole)
      .catch(() => {})
  }, [])

  const keep = (w: Whole) => setWhole(know('/instance', w))

  if (!whole) return null

  async function signUp(on: boolean) {
    if (!whole) return
    const was = whole
    /* The switch moves now; the server's answer replaces it, or puts it back. */
    setWhole({ ...whole, sign_up_open: on })
    setSignUpSaid(null)
    try {
      keep(await api<Whole>('/instance', { method: 'PATCH', body: JSON.stringify({ sign_up_open: on }) }))
    } catch {
      setWhole(was)
      setSignUpSaid(W.failed)
    }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault()
    const typed = email.trim()
    if (!typed || adding) return
    setAdding(true)
    setOwnersSaid(null)
    try {
      keep(await api<Whole>('/instance/owners', { method: 'POST', body: JSON.stringify({ email: typed }) }))
      setEmail('')
    } catch (err) {
      setOwnersSaid(
        err instanceof Refused && (err.status === 404 || err.status === 400)
          ? W.noAccount
          : err instanceof Refused && err.status === 409
            ? W.unconfirmed
            : W.failed,
      )
    } finally {
      setAdding(false)
    }
  }

  async function remove(id: string) {
    if (!whole) return
    const was = whole
    setWhole({ ...whole, owners: whole.owners.filter((o) => o.actor_id !== id) })
    setOwnersSaid(null)
    try {
      const w = await api<Whole | undefined>(`/instance/owners/${id}`, { method: 'DELETE' })
      /* Taken off themselves: the screen is no longer theirs. */
      if (!w) location.assign('/')
      else keep(w)
    } catch (err) {
      setWhole(was)
      setOwnersSaid(err instanceof Refused && err.status === 409 ? W.lastOwner : W.failed)
    }
  }

  async function test() {
    if (letter === 'sending') return
    setLetter('sending')
    try {
      const r = await api<{ sent: boolean; mail: boolean }>('/instance/test-letter', { method: 'POST', body: '{}' })
      setLetter(!r.sent ? 'failed' : r.mail ? 'sent' : 'log')
    } catch (err) {
      setLetter(err instanceof Refused && err.status === 429 ? 'many' : 'failed')
    }
  }

  const alone = whole.owners.length <= 1

  return (
    <div data-whole="instance" data-testid="instance">
      <section className="flex flex-col gap-3">
        <SectionHead>{W.signUp}</SectionHead>
        <Panel>
          <Line label={W.anyone} hint={signUpSaid ?? W.anyoneHint}>
            <Switch on={whole.sign_up_open} testId="instance-sign-up" said={W.anyone} onChange={(on) => void signUp(on)} />
          </Line>
        </Panel>
      </section>

      <section className="mt-9 flex flex-col gap-3">
        <SectionHead>{W.owners}</SectionHead>
        <Panel>
          {whole.owners.map((o, i) => (
            <div key={o.actor_id} className="contents">
              {i > 0 && <Hairline inset={16} />}
              <div data-testid="instance-owner" data-id={o.actor_id}>
                <Line label={o.actor_id === meId ? `${o.name} (${W.you})` : o.name} hint={o.email ?? undefined}>
                  {!alone && (
                    <Button tone="danger" data-testid="instance-owner-remove" onClick={() => void remove(o.actor_id)}>
                      {W.remove}
                    </Button>
                  )}
                </Line>
              </div>
            </div>
          ))}
          <Hairline inset={16} />
          <form onSubmit={(e) => void add(e)} className="flex flex-wrap items-center gap-2 px-4 py-3">
            <div className="min-w-[160px] flex-1">
              <Field
                wide
                type="email"
                data-testid="instance-owner-email"
                aria-label={W.addPlaceholder}
                placeholder={W.addPlaceholder}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <Button type="submit" data-testid="instance-owner-add" disabled={!email.trim() || adding}>
              {W.add}
            </Button>
          </form>
        </Panel>
        <p
          className="h-5 px-1 text-sm"
          role={ownersSaid ? 'alert' : undefined}
          style={{ color: ownersSaid ? 'var(--danger)' : 'var(--ink-3)' }}
        >
          {ownersSaid ?? W.ownersHint}
        </p>
      </section>

      <section className="mt-9 flex flex-col gap-3">
        <SectionHead>{W.email}</SectionHead>
        <Panel>
          <Line
            label={whole.mail ? W.mailOn : W.mailOff}
            hint={
              letter === 'sent'
                ? W.sent
                : letter === 'log'
                  ? W.sentToLog
                  : letter === 'failed'
                    ? W.notSent
                    : letter === 'many'
                      ? W.tooMany
                      : whole.mail_setup?.source
                        ? mailSummary(whole.mail_setup)
                        : W.testHint
            }
          >
            <Button data-testid="instance-test-letter" disabled={letter === 'sending'} onClick={() => void test()}>
              {W.testLetter}
            </Button>
          </Line>
          {whole.mail_setup && (
            <>
              <Hairline inset={16} />
              {whole.mail_setup.source === 'env' ? (
                <Line testId="instance-mail-env" label={M.fromEnv} hint={M.fromEnvHint} />
              ) : (
                <MailForm
                  setup={whole.mail_setup}
                  onSaved={(w) => {
                    setLetter(null)
                    keep(w)
                  }}
                />
              )}
            </>
          )}
        </Panel>
      </section>

      {whole.version && <Version v={whole.version} />}
    </div>
  )
}

/** What proving it is them asks of this account — `/api/me/email`'s `asks`. */
type Asks = { password: boolean; code: boolean }

/**
 * Mail, set up here. The form starts from what
 * is saved, its password or key left empty and keeping the saved one.
 * Connect, Save and Disconnect each ask the owner to prove it is them —
 * the password, the authenticator's code, or six digits from the inbox for
 * an account with neither — because whoever sets the mail server reads
 * every reset link the server sends. The fields for it are there from the
 * start, read with the page, so nothing moves when they are needed. Never
 * drawn while the environment sends.
 */
function MailForm({ setup, onSaved }: { setup: MailSetup; onSaved: (w: Whole) => void }) {
  const [draft, setDraft] = useState<MailDraft>(() => draftOf(setup))
  const [asks, setAsks] = useState<Asks | null>(() => known<{ asks: Asks }>('/me/email')?.asks ?? null)
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<{ text: string; bad: boolean } | null>(null)
  const saved = setup.source === 'saved'
  useEffect(() => {
    void ahead<{ asks: Asks }>('/me/email')
      .then((r) => setAsks(r.asks))
      .catch(() => {})
  }, [])

  const inbox = Boolean(asks && !asks.password && !asks.code)
  const proved =
    Boolean(asks) &&
    (!asks!.password || password.length > 0) &&
    (!asks!.code || code.trim().length > 0) &&
    (!inbox || code.trim().length >= 6)
  const proof = () => ({ ...(asks?.password ? { password } : {}), ...(asks?.code || inbox ? { code: code.trim() } : {}) })

  /** What a refusal says: not them, too many, or the server's own words. */
  const refusal = (err: unknown, fallback: string) =>
    err instanceof Refused && err.status === 403
      ? W.notThem
      : err instanceof Refused && err.status === 429
        ? W.tooMany
        : err instanceof Refused && err.status < 500 && err.message
          ? err.message
          : fallback

  async function save() {
    if (busy || !proved || !draftReady(setup, draft)) return
    setBusy(true)
    setSaid(null)
    try {
      const w = await api<Whole>('/instance/mail', { method: 'PUT', body: JSON.stringify({ mail: inputOf(draft), ...proof() }) })
      onSaved(w)
      setDraft(draftOf(w.mail_setup ?? null))
      setPassword('')
      setCode('')
      setSaid({ text: W.savedSaid, bad: false })
    } catch (err) {
      setSaid({ text: refusal(err, M.couldntSave), bad: true })
    } finally {
      setBusy(false)
    }
  }

  async function disconnect() {
    if (busy || !proved) return
    setBusy(true)
    setSaid(null)
    try {
      const w = await api<Whole>('/instance/mail', { method: 'DELETE', body: JSON.stringify(proof()) })
      onSaved(w)
      setDraft(draftOf(null, draft.sender))
      setPassword('')
      setCode('')
    } catch (err) {
      setSaid({ text: refusal(err, W.failed), bad: true })
    } finally {
      setBusy(false)
    }
  }

  const look = {
    className: 'h-10 w-full rounded-[var(--r-row)] px-3 text-base outline-none',
    style: { background: 'var(--sunken)', color: 'var(--ink)' },
  }
  return (
    <div className="flex flex-col gap-3 px-4 py-3" data-testid="instance-mail-form">
      <MailFields look="window" setup={setup} draft={draft} onChange={setDraft} />
      <div className="mt-2 flex flex-col gap-3" data-testid="instance-mail-proof">
        <span className="px-1 text-sm text-ink-3">{W.proveIt}</span>
        {asks?.password && (
          <div className="flex flex-col gap-2">
            <span aria-hidden className="px-1 text-sm text-ink-3">
              {W.yourPassword}
            </span>
            <PasswordField
              look="window"
              rule={false}
              placeholder={W.yourPassword}
              testId="instance-mail-proof-password"
              value={password}
              onChange={setPassword}
            />
          </div>
        )}
        {asks?.code && (
          <label className="flex flex-col gap-2">
            <span className="px-1 text-sm text-ink-3">{W.codeFromAuthenticator}</span>
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              data-testid="instance-mail-proof-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className={look.className}
              style={look.style}
            />
          </label>
        )}
        {inbox && (
          <div className="flex flex-col gap-2">
            <span className="px-1 text-sm text-ink-3">{W.codeFromEmail}</span>
            <InboxCode value={code} onChange={setCode} testId="instance-mail-proof-inbox" purpose="mail" look={look} />
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Button
          tone="primary"
          data-testid="instance-mail-save"
          disabled={busy || !proved || !draftReady(setup, draft)}
          onClick={() => void save()}
        >
          {busy ? W.saving : saved ? W.save : W.connect}
        </Button>
        {saved && (
          <Button
            type="button"
            tone="danger"
            data-testid="instance-mail-disconnect"
            disabled={busy || !proved}
            onClick={() => void disconnect()}
          >
            {W.disconnect}
          </Button>
        )}
      </div>
      {/* One line, kept whether or not it says anything, so nothing under it moves. */}
      <p
        className="flex min-h-5 items-center px-1 text-sm"
        role={said?.bad ? 'alert' : undefined}
        aria-live="polite"
        style={{ color: said?.bad ? 'var(--danger)' : 'var(--ink-3)' }}
      >
        {said?.text ?? ''}
      </p>
    </div>
  )
}

/**
 * The version it runs, and a quiet row when a newer one is out: its
 * notes and the one command. A security release carries the same red dot
 * as the owner's face in the bar. When the daily check is off, one line
 * says so.
 */
export function Version({ v }: { v: ServerVersion }) {
  const state = checkState(v)
  const latest = v.latest
  const notes = latest ? releaseLink(latest.url) : null
  return (
    <section className="mt-9 flex flex-col gap-3" data-testid="instance-version">
      <SectionHead>{W.version}</SectionHead>
      <Panel>
        <Line
          label={<span data-testid="instance-version-current">{W.running(v.current)}</span>}
          hint={state === 'off' ? W.checkOff : state === 'unreleased' ? W.unreleased : W.checkOn}
        />
        {latest && (
          <>
            <Hairline inset={16} />
            <div data-testid="instance-version-latest" data-security={latest.security ? 'yes' : 'no'}>
              <Line
                label={
                  <span className="inline-flex items-center gap-2">
                    {latest.security && <Dot label={W.securityUpdate} />}
                    {W.isOut(latest.version)}
                    {latest.security && <span className="text-ink-3">· {W.securityUpdate}</span>}
                  </span>
                }
                hint={
                  <span className="flex flex-wrap items-center gap-1">
                    {W.howToUpdate}
                    <code className="select-all text-ink-2">{UPDATE_COMMAND}</code>
                  </span>
                }
              >
                {notes && (
                  <a
                    data-control
                    data-testid="instance-version-notes"
                    href={notes}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex shrink-0 items-center gap-2 rounded-full px-4 text-sm font-medium transition-transform active:scale-[0.97]"
                    style={{ height: 'var(--control-h)', ...quietLook }}
                  >
                    {W.releaseNotes}
                  </a>
                )}
              </Line>
            </div>
          </>
        )}
      </Panel>
    </section>
  )
}

/** The red dot of a security release: on the owner's face, on the door to
    Server settings, and on the row that says which release. Eight pixels. */
export function Dot({ label, style }: { label?: string; style?: React.CSSProperties }) {
  return (
    <span
      data-testid="security-dot"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className="inline-block size-2 shrink-0 rounded-full bg-danger"
      style={{ ...style }}
    />
  )
}
