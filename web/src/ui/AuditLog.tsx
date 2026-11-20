import { useEffect, useState } from 'react'
import { AUDIT_TYPES } from '@tracker/shared-schema'
import { HEADS, LOCALE, dayMonthLong } from '../data/words.js'
import { ADMIN as A } from '../words/admin.js'
import { AUDIT as W } from '../words/audit.js'
import { api } from '../data/api.js'
import { edition } from '../edition.jsx'
import { ahead, known } from '../data/ahead.js'
import { Avatar, Empty, Hairline, PageTitle, Panel, SectionHead, Select, quietLook } from './kit.jsx'
import { SWITCHED } from './WorkspaceSettings.jsx'

/**
 * The audit log.
 *
 * Who did what across the whole workspace, for its owner: the security
 * record and the workspace's own lines of the feed, as one list of
 * sentences under the day they happened. A page of its own under the
 * workspace's settings, so "who removed Sam" has an address to send, and
 * its two filters are in that address.
 */

export type AuditEvent = {
  id: string
  kind: string
  ip: string | null
  user_agent: string | null
  at: string
  meta?: Record<string, unknown> | null
  origin?: string | null
  actor_id?: string | null
  actor_name?: string | null
  subject_id?: string | null
  subject_name?: string | null
  to_name?: string | null
  project_id?: string | null
  project_name?: string | null
}
type Page = { events: AuditEvent[]; next_cursor: string | null }
type Person = { actor_id: string; name: string; here: boolean }

/** The first page's address, for this page and for the door that warms it. */
export function auditPath(type?: string, who?: string): string {
  const q = new URLSearchParams()
  if (type) q.set('type', type)
  if (who) q.set('who', who)
  const said = q.toString()
  return `/audit${said ? `?${said}` : ''}`
}
export const AUDIT_PEOPLE = '/audit/people'

/** Which switch changed, and to what, from the two settings the line kept. */
function switched(meta: Record<string, unknown> | null | undefined): { what: string; to: string } | 'many' | null {
  const from = (meta?.from ?? {}) as Record<string, string>
  const to = (meta?.to ?? {}) as Record<string, string>
  const changed = SWITCHED.filter((s) => to[s.key] !== undefined && to[s.key] !== from[s.key])
  if (changed.length !== 1) return changed.length ? 'many' : null
  const s = changed[0]!
  const value = s.options.find(([id]) => id === to[s.key])?.[1] ?? to[s.key]!
  return { what: s.label, to: value }
}

/** A line of the log as a sentence a person reads, not its code. */
export function sentence(e: AuditEvent): string {
  const who = e.actor_name || A.logSomebody
  const said = (k: string) => (typeof e.meta?.[k] === 'string' ? (e.meta[k] as string) : '')
  const role = A.logRole[said('role')] ?? said('role')
  const them = e.subject_name || e.to_name || W.someone
  const project = e.project_name || said('name') || W.aProject
  const named = (what: string, detail: string) => (detail ? `${what} (${detail})` : what)
  switch (e.kind) {
    case 'login':
      return A.logLogin(who)
    case 'register':
      return A.logRegister(who)
    case 'workspace_created':
      return A.logWorkspace(who)
    case 'token_issued':
      return A.logTokenIssued(who, said('name') || A.logATool)
    case 'token_revoked':
      return A.logTokenRevoked(who)
    case 'invite_created':
      return A.logInvited(who, role)
    case 'invite_accepted':
      return A.logJoined(who, role)
    case 'ownership_transferred':
      return A.logHandedOver(who, e.subject_name || e.to_name || A.logSomebody)
    case 'email_changed':
      return A.logEmail(who)
    case 'password_changed':
      return A.logPassword(who)
    case 'password_reset':
      return A.logReset(who)
    case 'project.purged':
      return A.logPurged(who, said('name') ? `“${said('name')}”` : A.logAProject)
    case 'people.remove':
      return W.removed(who, them)
    case 'people.leave':
      return W.leftWorkspace(who)
    case 'people.rights':
      return W.rightsChanged(who, them)
    case 'project.member.rights':
      return W.projectRights(who, them, project)
    case 'project.member.add':
      return W.addedTo(who, them, project)
    case 'project.member.remove':
      return W.removedFrom(who, them, project)
    case 'project.leave':
      return W.left(who, project)
    case 'workspace.settings': {
      const s = switched(e.meta)
      return s && s !== 'many' ? W.switched(who, s.what, s.to) : W.settingsChanged(who)
    }
    case 'project.delete':
      return W.binned(who, project)
    case 'project.restore':
      return W.restored(who, project)
    case 'workspace.delete':
      return W.workspaceDeleted(who)
    case 'workspace.restore':
      return W.workspaceRestored
    case 'slack.connect':
      return W.connected(who, named('Slack', said('team')))
    case 'slack.disconnect':
      return W.disconnected(who, 'Slack')
    case 'github.install':
      return W.connected(who, named('GitHub', said('account')))
    case 'github.remove':
      return W.disconnected(who, named('GitHub', said('account')))
    case 'agent.connect':
      return W.connected(who, said('name') || W.anAgent)
    case 'agent.disconnect':
      return W.disconnected(who, W.anAgent)
    case 'agent.reach':
      return W.agentReach(who, said('name') || W.anAgent)
    case 'agent_linked':
      return W.linkedAs(who, said('client') || W.anAgent, e.subject_name || W.anAgent)
    case 'agent_unlinked':
      return W.unlinkedFrom(who, said('client') || W.anAgent, e.subject_name || W.anAgent)
    case 'webhook.create':
      return W.webhookAdded(who, said('host') || W.aWebhook)
    case 'webhook.remove':
      return W.webhookRemoved(who, said('host') || W.aWebhook)
    case 'webhook.update': {
      const key = said('authorization')
      const line =
        key === 'set'
          ? W.webhookKeySet
          : key === 'changed'
            ? W.webhookKeyChanged
            : key === 'removed'
              ? W.webhookKeyRemoved
              : e.meta?.enabled === false
                ? W.webhookOff
                : W.webhookChanged
      return line(who, said('host') || W.aWebhook)
    }
    /* A line only the edition writes, or failing that the kind as the
       server wrote it. */
    default:
      return edition.auditLine(e.kind, who) ?? `${who} · ${e.kind.replace(/[._]/g, ' ')}`
  }
}

/** Which browser on which machine, from what it said it was — a hint, not proof. */
function device(ua: string | null): string | null {
  if (!ua) return null
  const system = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /Mac OS X|Macintosh/.test(ua)
          ? 'Mac'
          : /Windows/.test(ua)
            ? 'Windows'
            : /Linux/.test(ua)
              ? 'Linux'
              : null
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Firefox\//.test(ua)
      ? 'Firefox'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : /Safari\//.test(ua)
          ? 'Safari'
          : /Tuff/i.test(ua)
            ? 'Tuff'
            : null
  return browser && system ? A.logOn(browser, system) : (browser ?? system)
}

/** The day a run of lines happened on, said as people say it. */
function dayOf(at: string): string {
  const d = new Date(at)
  const today = new Date()
  const yesterday = new Date(today.getTime() - 86_400_000)
  if (d.toDateString() === today.toDateString()) return A.logToday
  if (d.toDateString() === yesterday.toDateString()) return A.logYesterday
  return dayMonthLong(d, d.getFullYear() !== today.getFullYear())
}

export function AuditLog({
  type,
  who,
  allowed,
  onNarrow,
}: {
  type?: string | undefined
  who?: string | undefined
  /** `audit.read`, from `/api/me`: anybody else is told whose this is. */
  allowed: boolean
  onNarrow: (type: string | undefined, who: string | undefined) => void
}) {
  const path = auditPath(type, who)
  /*
   * What is on the screen and which question it answers. A filter changed
   * keeps the lines it had until the new answer replaces them — or starts
   * from the last answer to that filter — so the list never goes blank
   * between two of them.
   */
  const [shown, setShown] = useState<{ path: string; page: Page } | null>(() => {
    const k = known<Page>(path)
    return k ? { path, page: k } : null
  })
  const [older, setOlder] = useState<{ path: string; events: AuditEvent[]; next: string | null } | null>(null)
  const [people, setPeople] = useState<Person[]>(() => known<{ people: Person[] }>(AUDIT_PEOPLE)?.people ?? [])
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!allowed) return
    let live = true
    const k = known<Page>(path)
    if (k) setShown({ path, page: k })
    ahead<Page>(path)
      .then((page) => {
        if (!live) return
        setShown({ path, page })
        setFailed(false)
      })
      .catch(() => live && setFailed(true))
    return () => {
      live = false
    }
  }, [path, allowed])

  useEffect(() => {
    if (!allowed) return
    void ahead<{ people: Person[] }>(AUDIT_PEOPLE)
      .then((r) => setPeople(r.people))
      .catch(() => {})
  }, [allowed])

  if (!allowed) return <Empty>{W.ownerOnly}</Empty>

  const mine = older && shown && older.path === shown.path ? older : null
  const rows = shown ? [...shown.page.events, ...(mine?.events ?? [])] : []
  const next = mine ? mine.next : (shown?.page.next_cursor ?? null)

  const showMore = async () => {
    if (!next || !shown || busy) return
    setBusy(true)
    try {
      const at = shown.path
      const page = await api<Page>(`${at}${at.includes('?') ? '&' : '?'}cursor=${encodeURIComponent(next)}`)
      setOlder((was) => ({
        path: at,
        events: [...(was && was.path === at ? was.events : []), ...page.events],
        next: page.next_cursor,
      }))
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  /* Everybody, here first; whoever has gone, said so. One the address names
     who is not in the list yet still has a line to stand on. */
  const options = [
    { id: '', label: W.everyone },
    ...people.map((p) => ({ id: p.actor_id, label: p.here ? p.name : W.formerly(p.name) })),
    ...(who && !people.some((p) => p.actor_id === who) ? [{ id: who, label: W.someone }] : []),
  ]
  const kinds = [{ id: '', label: W.allKinds }, ...Object.keys(AUDIT_TYPES).map((k) => ({ id: k, label: W.types[k] ?? k }))]

  return (
    <div data-audit-log>
      <div className="flex flex-wrap items-center gap-2">
        <Select
          label={W.kind}
          testId="audit-type"
          value={type && type in AUDIT_TYPES ? type : ''}
          onPick={(v) => onNarrow(v || undefined, who)}
          options={kinds}
        />
        <Select label={W.person} testId="audit-who" value={who ?? ''} onPick={(v) => onNarrow(type, v || undefined)} options={options} />
      </div>

      <div className="mt-4">
        {failed && !shown && <Empty>{W.couldNotLoad}</Empty>}
        {shown && rows.length === 0 && <Empty>{type || who ? W.nothingNarrowed : W.nothing}</Empty>}
        {rows.length > 0 && (
          <Panel>
            {/* A sentence a line — who did what — under the day it happened,
                with the time, the browser and the address beneath it. */}
            {rows.map((e, at) => {
              const heading = at === 0 || dayOf(rows[at - 1]!.at) !== dayOf(e.at) ? dayOf(e.at) : null
              const where = [
                new Date(e.at).toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' }),
                e.origin === 'mcp' ? W.viaAgent : e.origin === 'github' ? W.viaGithub : null,
                device(e.user_agent),
                e.ip,
              ].filter(Boolean)
              return (
                <div key={e.id} className="contents">
                  {heading && (
                    <>
                      {at > 0 && <Hairline inset={16} />}
                      <div className="px-4 pb-1 pt-3 text-xs font-medium text-ink-3">{heading}</div>
                    </>
                  )}
                  <div data-audit data-audit-kind={e.kind} className="flex min-h-[48px] items-center gap-3 px-4 py-2">
                    <Avatar name={e.actor_name || A.logSomebody} {...(e.actor_id ? { id: e.actor_id } : {})} size={24} />
                    <div className="flex min-w-px flex-1 flex-col">
                      <span className="text-base text-ink">{sentence(e)}</span>
                      <span className="truncate text-xs tabular-nums text-ink-3">{where.join(' · ')}</span>
                    </div>
                  </div>
                </div>
              )
            })}
          </Panel>
        )}
        {next && rows.length > 0 && (
          <div className="mt-4 flex justify-center">
            <button
              data-testid="audit-more"
              data-control
              disabled={busy}
              onClick={() => void showMore()}
              className="inline-flex h-8 items-center rounded-full px-4 text-sm font-medium transition-transform active:scale-[0.97]"
              style={quietLook}
            >
              {W.more}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * The door to it, among the workspace's settings, where the security log's
 * Show was. Its first page and the people are asked while the pointer is on
 * it, so the page opens whole.
 */
export function AuditDoor({ onOpen }: { onOpen: () => void }) {
  const warm = () => {
    void ahead(auditPath()).catch(() => {})
    void ahead(AUDIT_PEOPLE).catch(() => {})
  }
  return (
    <section className="mt-9 flex flex-col gap-3">
      <SectionHead>{HEADS.securityLog}</SectionHead>
      <Panel>
        <div className="flex min-h-[56px] items-center gap-4 px-4 py-3">
          <div className="flex min-w-px flex-1 flex-col gap-1">
            <span className="text-base text-ink">{W.what}</span>
            <span className="text-sm text-ink-3">{W.hint}</span>
          </div>
          <button
            data-testid="open-audit"
            data-control
            onPointerEnter={warm}
            onFocus={warm}
            onClick={onOpen}
            className="inline-flex h-8 shrink-0 items-center rounded-full px-4 text-sm font-medium transition-transform active:scale-[0.97]"
            style={quietLook}
          >
            {W.open}
          </button>
        </div>
      </Panel>
    </section>
  )
}

/** The page's title: where it is under, and what it is. */
export function AuditTitle({ onBack }: { onBack: () => void }) {
  return (
    <PageTitle>
      <button
        data-testid="audit-back"
        onClick={onBack}
        className="transition-colors hover:text-[var(--ink)]"
        style={{ color: 'var(--ink-3)' }}
      >
        {W.back}
      </button>
      <span aria-hidden className="text-ink-3">
        {' / '}
      </span>
      {HEADS.securityLog}
    </PageTitle>
  )
}
