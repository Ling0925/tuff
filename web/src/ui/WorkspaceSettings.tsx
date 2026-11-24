import { useEffect, useState } from 'react'
import { api, Refused, stored } from '../data/api.js'
import { ahead, known } from '../data/ahead.js'
import { edition } from '../edition.jsx'
/* `now` is the screen's language; renamed because `Identity` has a `now` of its own. */
import { MORE, now as language } from '../data/words.js'
import { WORKSPACE_SETTINGS as W } from '../words/workspaceSettings.js'
import { PasswordField } from './Access.jsx'
import { pictureFor } from '../data/picture.js'
import { Icon } from './glyphs.jsx'
import { Button, Dialog, Hairline, InboxCode, Panel, MARK_SAID, PROJECT_MARKS, SectionHead, Select, quietLook, notALogin } from './kit.jsx'
import { WorkspaceMark } from './WorkspaceMark.jsx'

/**
 * The workspace's own settings page, the parts that are not the edition's
 * or the machinery: what it is called and what it looks
 * like, and the three switches.
 *
 * Laid out as the account page is, a panel of lines with the control on the
 * right of each. The switches were raw keys — `who_creates_projects`,
 * `documents_too` — in a list with no panel round it, the one page in the
 * product that read as a database's.
 */

type Look = { id: string; name: string; slug: string; mark_icon?: string | null; mark_tint?: number | null; icon_url?: string | null }

/** A setting as a line of the lists: what it is and a sentence on the left, the control on the right. */
export function Line({
  label,
  hint,
  children,
  testId,
}: {
  label: React.ReactNode
  hint?: React.ReactNode
  children?: React.ReactNode
  testId?: string
}) {
  return (
    <div data-testid={testId} className="flex min-h-[56px] flex-wrap items-center gap-4 px-4 py-3">
      <div className="flex min-w-[160px] flex-1 flex-col gap-1">
        <span className="text-base text-ink">{label}</span>
        {hint && <span className="text-sm text-ink-3">{hint}</span>}
      </div>
      {children && <div className="flex shrink-0 flex-wrap items-center gap-2">{children}</div>}
    </div>
  )
}

const pill =
  'inline-flex h-8 shrink-0 cursor-pointer items-center rounded-full px-4 text-sm font-medium transition-transform active:scale-[0.97]'

/**
 * What the workspace is called and what it looks like — its name, its mark
 * or a picture of its own. The owner's, as everything on this page is.
 *
 * The mark is the way to its two rails, as a project's is: pressed, they
 * open under it; a picture in its place hides them, and taking the picture
 * off brings back what was chosen.
 */
export function Identity({ look, onChanged }: { look: Look; onChanged: () => Promise<void> | void }) {
  const [name, setName] = useState(look.name)
  const [marking, setMarking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<string | null>(null)
  /* What was pressed, drawn before the server has answered. */
  const [shown, setShown] = useState<{ mark_icon?: string | null; mark_tint?: number | null }>({})
  const now = { ...look, ...shown, name: name.trim() || look.name }

  const patch = async (change: { name?: string; mark_icon?: string | null; mark_tint?: number | null }) => {
    if ('mark_icon' in change || 'mark_tint' in change) setShown((was) => ({ ...was, ...change }))
    try {
      await api('/workspace', { method: 'PATCH', body: JSON.stringify(change) })
      await onChanged()
    } catch {
      setSaid(W.couldNotSave)
    } finally {
      setShown({})
    }
  }

  const picture = async (chosen: File) => {
    setBusy(true)
    setSaid(null)
    /* Made fit first — an SVG drawn as a PNG, a big photo made small, a
       HEIC refused in words — `data/picture.ts`. */
    const picked = await pictureFor(chosen)
    if ('refused' in picked) {
      setBusy(false)
      return setSaid(picked.refused)
    }
    const form = new FormData()
    form.append('file', picked)
    // Not through api(): multipart sets its own content type.
    const r = await fetch('/api/workspace/icon', {
      method: 'POST',
      headers: { 'x-api-version': '1', 'x-tongue': language, authorization: `Bearer ${stored()?.access_token ?? ''}` },
      body: form,
    }).catch(() => null)
    setBusy(false)
    if (!r?.ok) {
      const body = (await r?.json().catch(() => null)) as { error?: { message?: string } } | null
      return setSaid(body?.error?.message ?? W.couldNotUpload)
    }
    setMarking(false)
    await onChanged()
  }

  return (
    <section data-workspace-identity className="mt-9 flex flex-col gap-3">
      <SectionHead>{W.workspace}</SectionHead>
      <Panel>
        <div className="flex flex-wrap items-center gap-4 px-4 py-4">
          {look.icon_url ? (
            <WorkspaceMark look={now} size={48} />
          ) : (
            <button
              type="button"
              data-testid="workspace-mark-toggle"
              aria-expanded={marking}
              aria-label={W.changeIcon}
              title={W.changeIcon}
              onClick={() => setMarking((v) => !v)}
              className="flex shrink-0 rounded-[12px] transition-transform active:scale-[0.96]"
              style={{ boxShadow: marking ? '0 0 0 2px var(--accent)' : undefined }}
            >
              <WorkspaceMark look={now} size={48} />
            </button>
          )}
          <div className="flex min-w-[200px] flex-1 flex-col gap-1">
            <input
              {...notALogin}
              data-testid="workspace-name-field"
              aria-label={W.workspaceName}
              maxLength={80}
              className="w-full bg-transparent text-lg font-medium outline-none text-ink"
              style={{ letterSpacing: 'var(--track-title)' }}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
              // Read from the field rather than from state: leaving it in the
              // same tick as the last keystroke sends what was there before.
              onBlur={(e) => {
                const next = e.target.value.trim()
                if (!next) return setName(look.name)
                if (next !== look.name) void patch({ name: next })
              }}
            />
            <span className="truncate text-sm" style={{ color: said ? 'var(--danger)' : 'var(--ink-3)' }}>
              {said ?? (busy ? W.uploading : `${location.host}/${look.slug}`)}
            </span>
          </div>
          <span className="flex shrink-0 items-center gap-2">
            <label data-control className={pill} style={quietLook}>
              <Icon name="upload" size={14} />
              <span className="ml-2">{look.icon_url ? W.changePicture : W.uploadPicture}</span>
              <input
                type="file"
                accept="image/*"
                data-testid="workspace-icon"
                className="hidden"
                onChange={(e) => {
                  const chosen = e.target.files?.[0]
                  e.target.value = ''
                  if (chosen) void picture(chosen)
                }}
              />
            </label>
            {look.icon_url && (
              <button
                type="button"
                data-testid="workspace-icon-drop"
                onClick={async () => {
                  await api('/workspace/icon', { method: 'DELETE' })
                  await onChanged()
                }}
                className={`${pill} text-ink-2`}
              >
                {W.removePicture}
              </button>
            )}
          </span>
        </div>
        {!look.icon_url && marking && (
          <>
            <Hairline inset={16} />
            <div className="flex flex-col gap-2 px-4 py-3">
              <div
                role="radiogroup"
                aria-label={W.symbol}
                data-workspace-glyphs={now.mark_icon ?? 'letter'}
                className="flex max-w-full flex-wrap items-center gap-1 self-start p-1 bg-track"
                style={{ borderRadius: 'var(--r-panel)' }}
              >
                {[null, ...PROJECT_MARKS].map((g) => {
                  const on = (now.mark_icon ?? null) === g
                  return (
                    <button
                      key={g ?? 'letter'}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      data-workspace-glyph={g ?? 'letter'}
                      title={g ? (MARK_SAID[g] ?? g) : W.firstLetter}
                      onClick={() => !on && void patch({ mark_icon: g })}
                      className="flex size-8 items-center justify-center text-base font-semibold"
                      style={{
                        borderRadius: 'var(--r-pill)',
                        background: on ? 'var(--track-on)' : 'transparent',
                        boxShadow: on ? 'var(--control-shadow)' : undefined,
                        color: on ? 'var(--ink)' : 'var(--ink-2)',
                      }}
                    >
                      {g ? <Icon name={g} size={16} /> : (now.name.trim()[0] ?? 'A').toUpperCase()}
                    </button>
                  )
                })}
              </div>
              <div
                role="radiogroup"
                aria-label={W.colour}
                className="flex max-w-full flex-wrap items-center gap-1 self-start p-1 bg-track"
                style={{ borderRadius: 'var(--r-panel)' }}
              >
                {Array.from({ length: 10 }, (_, i) => i).map((i) => {
                  const on = (now.mark_tint ?? null) === i
                  return (
                    <button
                      key={i}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      data-workspace-tint={i}
                      onClick={() => !on && void patch({ mark_tint: i })}
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
            </div>
          </>
        )}
      </Panel>
    </section>
  )
}

/*
 * The four switches, said as what they decide. The values are the
 * schema's; the words are a person's.
 */
export const SWITCHED: { key: string; label: string; hint: string; options: [string, string][] }[] = [
  {
    key: 'who_creates_projects',
    label: W.creatingProjects,
    hint: W.creatingProjectsHint,
    options: [
      ['members', W.everyone],
      ['owner', W.onlyTheOwner],
    ],
  },
  {
    key: 'who_invites_people',
    label: W.invitingPeople,
    hint: W.invitingPeopleHint,
    options: [
      ['owner', W.onlyTheOwner],
      ['members', W.everyone],
    ],
  },
  {
    key: 'edit_others_content',
    label: W.editingOthers,
    hint: W.editingOthersHint,
    options: [
      ['documents_too', W.allowed],
      ['own_only', W.notAllowed],
    ],
  },
  /* The screen and not the people. The
     hint says what stays, because "hide Members" reads as hiding them. */
  {
    key: 'who_sees_members',
    label: W.membersPage,
    hint: W.membersPageHint,
    options: [
      ['members', W.everyone],
      ['owner', W.onlyTheOwner],
    ],
  },
]

/** The four switches — and only four: everything else has a sensible default. */
export function Switches({ settings, onChange }: { settings: Record<string, string>; onChange: (key: string, value: string) => void }) {
  return (
    <section className="mt-9 flex flex-col gap-3">
      <SectionHead>{W.permissions}</SectionHead>
      <Panel>
        {SWITCHED.map((s, i) => (
          <div key={s.key} className="contents">
            {i > 0 && <Hairline inset={16} />}
            <div data-switch>
              <Line label={s.label} hint={s.hint}>
                <Select
                  label={s.key}
                  value={settings[s.key] ?? s.options[0]![0]}
                  onPick={(value) => onChange(s.key, value)}
                  options={s.options.map(([id, label]) => ({ id, label }))}
                />
              </Line>
            </div>
          </div>
        ))}
      </Panel>
    </section>
  )
}

type Asks = { password: boolean; code: boolean; inbox: boolean }
type Somebody = { actor_id: string; name: string; role: string; joined_at: string | null }

/**
 * Handing the workspace over.
 *
 * A workspace has one owner, and this is the one way that changes: no
 * invitation makes an owner, and nobody's card does. Who to hand it to and
 * the password, in one window; the people and what the window will ask are
 * read when the page opens, so it opens whole.
 */
export function Handover({ meId }: { meId: string }) {
  const others = (r: { people: Somebody[] } | null) => (r?.people ?? []).filter((p) => p.actor_id !== meId && p.joined_at)
  const [people, setPeople] = useState<Somebody[]>(() => others(known('/people')))
  const [asks, setAsks] = useState<Asks | null>(() => known<{ asks: Asks }>('/me/email')?.asks ?? null)
  const [open, setOpen] = useState(false)
  // biome-ignore lint/correctness/useExhaustiveDependencies: asked again for another person; others is new on every render
  useEffect(() => {
    void ahead<{ people: Somebody[] }>('/people')
      .then((r) => setPeople(others(r)))
      .catch(() => {})
    void ahead<{ asks: Asks }>('/me/email')
      .then((r) => setAsks(r.asks))
      .catch(() => {})
  }, [meId])
  return (
    <section className="mt-9 flex flex-col gap-3">
      <SectionHead>{W.owner}</SectionHead>
      <Panel>
        <Line label={W.handOver} hint={people.length ? W.handOverHint : W.inviteFirst}>
          <button
            data-testid="handover"
            disabled={!people.length || !asks}
            onClick={() => setOpen(true)}
            className={`${pill} disabled:cursor-default disabled:opacity-40`}
            style={quietLook}
          >
            {W.handOverEllipsis}
          </button>
        </Line>
      </Panel>
      {open && asks && <HandoverWindow people={people} asks={asks} onClose={() => setOpen(false)} />}
    </section>
  )
}

function HandoverWindow({ people, asks, onClose }: { people: Somebody[]; asks: Asks; onClose: () => void }) {
  const [to, setTo] = useState(people[0]!.actor_id)
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<string | null>(null)
  const who = people.find((p) => p.actor_id === to)
  /* Nothing to type — an account made through Google or Apple — is asked
     a code from its inbox instead. */
  const inbox = !asks.password && !asks.code
  const ready = (!asks.password || password.length > 0) && (!asks.code || code.trim().length > 0) && (!inbox || code.trim().length >= 6)

  async function go() {
    if (!ready || busy) return
    setBusy(true)
    setSaid(null)
    try {
      await api('/workspace/transfer', {
        method: 'POST',
        body: JSON.stringify({ to, ...(asks.password ? { password } : {}), ...(asks.code || inbox ? { code: code.trim() } : {}) }),
      })
      /* Everything on the screen was drawn for the owner: read it again as
         who they are now. */
      location.assign('/')
    } catch (e) {
      const status = e instanceof Refused ? e.status : 0
      setSaid(
        status === 403
          ? asks.code
            ? W.wrongPasswordOrCode
            : inbox
              ? W.codeDidNotMatch
              : W.wrongPassword
          : status === 429
            ? W.tooManyAttempts
            : (e as Error).message || W.couldNotHandOver,
      )
      setBusy(false)
    }
  }

  return (
    <Dialog
      title={W.handOver}
      testId="handover-dialog"
      onClose={onClose}
      footer={
        <div className="flex flex-1 items-center justify-end gap-2">
          <button onClick={onClose} className="h-8 px-3 text-base font-medium text-ink-2">
            {MORE.cancel}
          </button>
          <Button tone="primary" data-testid="handover-send" disabled={!ready || busy} onClick={() => void go()}>
            {busy ? W.handingOver : W.makeTheOwner(who?.name ?? null)}
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
        <p className="text-sm leading-[1.5] text-ink-3">{edition.settingsSays?.newOwnerTakes ?? W.whatTheyWillDo}</p>
        <div className="flex flex-col gap-1">
          <span className="text-sm text-ink-3">{W.newOwner}</span>
          <Select
            label={W.newOwner}
            testId="handover-to"
            value={to}
            onPick={setTo}
            options={people.map((p) => ({ id: p.actor_id, label: p.name }))}
          />
        </div>
        {asks.password && (
          <div className="flex flex-col gap-1">
            <span className="text-sm text-ink-3">{W.yourPassword}</span>
            <PasswordField
              look="window"
              rule={false}
              autoFocus
              placeholder={W.password}
              testId="handover-password"
              value={password}
              onChange={setPassword}
            />
          </div>
        )}
        {asks.code && (
          <label className="flex flex-col gap-1">
            <span className="text-sm text-ink-3">{W.codeFromAuthenticator}</span>
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              data-testid="handover-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="h-10 rounded-[var(--r-row)] px-3 text-base outline-none bg-sunken text-ink"
            />
          </label>
        )}
        {inbox && (
          <div className="flex flex-col gap-1">
            <span className="text-sm text-ink-3">{W.codeFromEmail}</span>
            <InboxCode
              value={code}
              onChange={setCode}
              testId="handover-inbox-code"
              look={{
                className: 'h-10 rounded-[var(--r-row)] px-3 text-base outline-none',
                style: { background: 'var(--sunken)', color: 'var(--ink)' },
              }}
            />
          </div>
        )}
        {said && (
          <p role="alert" data-handover-said className="text-sm text-danger">
            {said}
          </p>
        )}
      </form>
    </Dialog>
  )
}

type Erasing = {
  name: string
  projects: number
  people: number
  agents: number
  paid: boolean
  asks: 'password' | 'password_and_code' | 'code' | 'email'
}

/**
 * Deleting the workspace. The
 * owner's, at the very end of the page. What goes is read when the page
 * opens, so the window opens whole; it asks the name typed and the same
 * proof handing over asks, and sends them in the one request.
 */
export function DeleteWorkspace() {
  const [facts, setFacts] = useState<Erasing | null>(null)
  const [open, setOpen] = useState(false)
  /* Refused before it is asked: the server's last owner who can sign in
     would be left with nowhere to sign in to. */
  const [lastOwner, setLastOwner] = useState(false)
  useEffect(() => {
    void api<Erasing>('/workspace/delete', { method: 'POST', body: JSON.stringify({ dry: true }) })
      .then(setFacts)
      .catch((e: unknown) => {
        if (e instanceof Refused && e.status === 409) setLastOwner(true)
      })
  }, [])
  return (
    <section className="mt-9 flex flex-col gap-3">
      <Panel>
        <Line label={W.deleteWorkspace} hint={lastOwner ? W.deleteLastOwner : W.deleteHint}>
          <button
            data-testid="delete-workspace"
            disabled={!facts}
            onClick={() => setOpen(true)}
            className={`${pill} disabled:cursor-default disabled:opacity-40`}
            style={{ ...quietLook, color: 'var(--danger)' }}
          >
            {W.deleteWorkspaceEllipsis}
          </button>
        </Line>
      </Panel>
      {open && facts && <DeleteWindow facts={facts} onClose={() => setOpen(false)} />}
    </section>
  )
}

function DeleteWindow({ facts, onClose }: { facts: Erasing; onClose: () => void }) {
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<string | null>(null)
  const inbox = facts.asks === 'email'
  /* What the account has to prove it with: a password, an authenticator's
     code, both, or — with neither — a code sent to its inbox. */
  const withPassword = facts.asks === 'password' || facts.asks === 'password_and_code'
  const withCode = facts.asks === 'password_and_code' || facts.asks === 'code'
  const ready =
    name.trim() === facts.name.trim() &&
    (inbox ? code.trim().length >= 6 : (!withPassword || password.length > 0) && (!withCode || code.trim().length > 0))

  async function go() {
    if (!ready || busy) return
    setBusy(true)
    setSaid(null)
    try {
      await api('/workspace/delete', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          ...(withPassword ? { password } : {}),
          ...(inbox || withCode ? { code: code.trim() } : {}),
        }),
      })
      /* Nothing here is theirs any more, and the session that was in it has
         ended: to sign in again, into whatever else they are in. */
      location.assign('/')
    } catch (e) {
      const status = e instanceof Refused ? e.status : 0
      setSaid(
        status === 403
          ? withCode
            ? W.wrongPasswordOrCode
            : inbox
              ? W.codeDidNotMatch
              : W.wrongPassword
          : status === 429
            ? W.tooManyAttempts
            : (e as Error).message || W.couldNotDelete,
      )
      setBusy(false)
    }
  }

  const field = 'h-10 rounded-[var(--r-row)] px-3 text-base outline-none'
  const ground = { background: 'var(--sunken)', color: 'var(--ink)' }
  return (
    <Dialog
      title={W.deleteName(facts.name)}
      testId="delete-workspace-dialog"
      onClose={onClose}
      footer={
        <div className="flex flex-1 items-center justify-end gap-2">
          <button onClick={onClose} className="h-8 px-3 text-base font-medium text-ink-2">
            {MORE.cancel}
          </button>
          <Button tone="danger" data-testid="delete-workspace-go" disabled={!ready || busy} onClick={() => void go()}>
            {busy ? W.deleting : W.deleteGo}
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
        <p className="text-base leading-5 text-ink-2">
          {W.deleteWhat(facts.projects, facts.people, facts.agents)}{' '}
          {facts.paid && edition.settingsSays ? edition.settingsSays.paidCancelled : ''}
        </p>
        <p className="text-sm leading-5 text-ink-3">{edition.vendor ? W.deleteBack(edition.vendor.support) : W.deleteBackOwn}</p>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-ink-3">{W.typeName(facts.name)}</span>
          <input
            {...notALogin}
            data-testid="delete-workspace-name"
            autoFocus
            autoComplete="off"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={field}
            style={ground}
          />
        </label>
        {withPassword && (
          <div className="flex flex-col gap-1">
            <span className="text-sm text-ink-3">{W.yourPassword}</span>
            <PasswordField
              look="window"
              rule={false}
              placeholder={W.password}
              testId="delete-workspace-password"
              value={password}
              onChange={setPassword}
            />
          </div>
        )}
        {withCode && (
          <label className="flex flex-col gap-1">
            <span className="text-sm text-ink-3">{W.codeFromAuthenticator}</span>
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              data-testid="delete-workspace-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className={field}
              style={ground}
            />
          </label>
        )}
        {inbox && (
          <div className="flex flex-col gap-1">
            <span className="text-sm text-ink-3">{W.codeFromEmail}</span>
            <InboxCode value={code} onChange={setCode} testId="delete-workspace-inbox-code" look={{ className: field, style: ground }} />
          </div>
        )}
        {said && (
          <p role="alert" data-delete-workspace-said className="text-sm text-danger">
            {said}
          </p>
        )}
      </form>
    </Dialog>
  )
}
