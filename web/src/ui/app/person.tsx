import { useState, useEffect } from 'react'
import { SAYS, PLACES, MAKE, MORE, HEADS } from '../../data/words.js'
import { APP as W } from '../../words/app.js'
import { api } from '../../data/api.js'
import { ProjectMark, markOf } from '../icons.jsx'
import { ON_JOINING, RIGHTS } from '../../data/rights.js'
import { type Theirs, type Week, readPerson, Stats, Hours } from '../Stats.jsx'
import { TheirWork } from '../TheirWork.jsx'
import { Avatar, writtenDay, Popover, Dialog, Button, GroupLabel, Panel, Hairline } from '../kit.jsx'
import { recall } from '../../data/memory.js'
import { type PersonInWorkspace } from '@tracker/shared-schema'
import { Icon } from '../glyphs.jsx'
import { type Project } from './model.js'

/* From the contract, not written again here — `shared-schema/src/responses.ts`.
   Twelve files each kept their own idea of a person, and three times this
   session a face failed to draw because one of them refused a field the
   server was already sending. */
export type Person = PersonInWorkspace

/**
 * One person, opened from the roster.
 *
 * `/members/:actorId` was an address that highlighted a row and rendered
 * nothing beside it. So a role could only be chosen at the moment somebody
 * was invited — `PATCH /api/people/:id` had never been called — and nobody
 * could be taken out of a workspace at all.
 *
 * Neither is offered against yourself. The server refuses both anyway; this
 * is so nobody reaches for a control that will say no. Demoting yourself
 * from owner is the same door that locks behind you as the guest box.
 */

export function Person({
  who,
  meId,
  can,
  onChanged,
  onReload,
  onBack,
  onMessage,
  onOpen,
  onProject,
  allProjects,
  openLinks,
}: {
  who: Person | null
  meId: string
  can: string[]
  /** The workspace's open invite links still standing, offered for
      revoking in the dialog that removes somebody. */
  openLinks: number
  onChanged: () => Promise<void>
  /** Asks the roster again and stays on this person. */
  onReload: () => Promise<void>
  /** Back to the roster, on a phone where the two are not side by side. */
  onBack: () => void
  onMessage: (actorId: string) => void
  onOpen: (projectId: string, taskId: string) => void
  onProject: (projectId: string) => void
  /** The workspace's projects, for each one's own mark. */
  allProjects: Project[]
}) {
  /*
   * What is on them, which is the question anybody opening a colleague's
   * name is asking. The panel used to answer three ways to administer
   * somebody and nothing at all about their work.
   */
  const [work, setWork] = useState<{
    projects: { id: string; name: string }[]
    open: Theirs[]
    weeks: Week[]
    hours?: import('../Stats.jsx').Spent[]
    days?: import('../Stats.jsx').Day[]
    email: string | null
    timezone: string | null
  } | null>(null)
  /* Removing asks first: one press in a menu had everything behind it —
     `docs/specs/removing-someone.md`. */
  const [removing, setRemoving] = useState(false)
  /* Whether that dialog also revokes the open links — unticked until the
     owner ticks it: it ends links other people made. */
  const [revokeLinks, setRevokeLinks] = useState(false)
  const actorId = who?.actor_id ?? null
  useEffect(() => {
    /* Opened on what was read ahead or last time — the roster reads a
       person as the pointer reaches their row — so the numbers and the
       charts are there with the name, not a beat after it. */
    setWork(actorId ? (recall<typeof work>(`person:${actorId}`) ?? null) : null)
    if (!actorId) return
    const signal = { stale: false }
    void readPerson(actorId, true)
      .then((r) => {
        // An answer for the person you have already left is not this one's.
        if (!signal.stale) setWork(r)
      })
      .catch(() => {
        if (!signal.stale) setWork({ projects: [], open: [], weeks: [], email: null, timezone: null })
      })
    return () => {
      signal.stale = true
    }
  }, [actorId])

  if (!who) {
    return <div className="min-w-px flex-1 text-sm max-sm:hidden text-ink-3">{SAYS.pickSomebody}</div>
  }
  /* Drawn whole: until their numbers are in, nothing — rather than the
     name, then the numbers pushing everything under them down. */
  if (!work) return <div className="min-w-px flex-1" />
  const self = who.actor_id === meId
  return (
    /* Capped, not stretched to the window. The rows here are the same rows
       the task lists draw, and a line of text three times the width of the
       same line on another screen reads as a different product. */
    <div data-person-open className="min-w-px max-w-[640px] flex-1">
      <button
        data-testid="person-back"
        onClick={onBack}
        className="mb-3 flex items-center gap-1 text-base font-medium sm:hidden text-accent"
      >
        <Icon name="chevL" size={16} />
        {PLACES.members}
      </button>
      <div className="flex items-center gap-3">
        <Avatar
          name={who.name}
          id={who.actor_id}
          url={who.avatar_url}
          size={40}
          on="var(--surface)"
          {...(who.presence ? { presence: who.presence } : {})}
        />
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-lg font-medium text-ink">{who.name}</span>
          <span className="text-sm text-ink-3">
            {[who.role !== 'member' ? W.role(who.role) : null, who.joined_at ? W.joined(writtenDay(who.joined_at.slice(0, 10))) : null]
              .filter(Boolean)
              .join(' · ')}
          </span>
          {/* How to reach them, where the reader may know it. */}
          {work?.email && (
            <a data-person-email href={`mailto:${work.email}`} className="text-sm text-accent">
              {work.email}
            </a>
          )}
        </div>
        {/* At the head, on the name's line, in its corner. */}
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {!self && (
            <button
              data-testid="message-person"
              onClick={() => onMessage(who.actor_id)}
              className="rounded-full px-4 text-sm font-medium bg-hover text-ink"
              style={{ height: 'var(--control-h)' }}
            >
              {MAKE.message}
            </button>
          )}
          {/*
          The rarer act behind ⋯, where a task keeps its delete: a removal
          that cannot be taken lightly stood as a red sentence beside
          Message, the loudest thing on the page for the least used. The
          owner's alone, as the server has it.
        */}
          {!self && can.includes('people.role') && (
            <Popover
              shape="bare"
              width={240}
              align="right"
              testId="person-menu"
              said={W.more}
              sheet={false}
              label={
                <span data-control className="flex size-9 items-center justify-center rounded-full bg-hover text-ink-2">
                  <Icon name="ellipsis" size={16} />
                </span>
              }
            >
              {(close) => (
                <div data-menu className="py-1">
                  {/* No role to change here: a workspace has one owner, who
                    hands it over from the workspace's settings. */}
                  {can.includes('people.role') && (
                    <button
                      data-row
                      data-testid="remove-person"
                      onClick={() => {
                        close()
                        setRevokeLinks(false)
                        setRemoving(true)
                      }}
                      className="flex w-full items-center gap-3 px-3 text-left text-base text-danger"
                      style={{ height: 'var(--row-h)' }}
                    >
                      <Icon name="trash" size={16} />
                      {W.removeFromWorkspace}
                    </button>
                  )}
                </div>
              )}
            </Popover>
          )}
        </div>
      </div>
      {removing && (
        <Dialog
          title={W.removeName(who.name)}
          testId="remove-person-dialog"
          onClose={() => setRemoving(false)}
          footer={
            <div className="flex flex-1 items-center justify-end gap-2">
              <button onClick={() => setRemoving(false)} className="h-8 px-3 text-base font-medium text-ink-2">
                {MORE.cancel}
              </button>
              <Button
                tone="danger"
                data-testid="remove-person-go"
                onClick={async () => {
                  setRemoving(false)
                  /* The links go only when the box was ticked, in this
                     press's own request — `docs/specs/removing-someone.md`. */
                  const links = revokeLinks && openLinks > 0
                  await api(`/people/${who.actor_id}`, {
                    method: 'DELETE',
                    ...(links ? { body: JSON.stringify({ withdraw_links: true }) } : {}),
                  })
                  await onChanged()
                }}
              >
                {W.remove}
              </Button>
            </div>
          }
        >
          <p className="px-4 pt-2 pb-4 text-base leading-5 text-ink-2">{W.removeSays}</p>
          {openLinks > 0 && (
            <label
              data-testid="remove-person-links"
              className="mx-4 mb-4 flex cursor-pointer items-start gap-3 text-base leading-5 text-ink"
            >
              {/* As tall as the first line, so the box sits on it. */}
              <span className="flex h-5 shrink-0 items-center">
                <input
                  type="checkbox"
                  checked={revokeLinks}
                  onChange={(e) => setRevokeLinks(e.target.checked)}
                  className="size-4 accent-[var(--accent)]"
                />
              </span>
              <span className="min-w-px flex-1">
                <span className="block">{W.removeLinks(openLinks)}</span>
                <span className="block text-sm text-ink-3">{W.removeLinksSays}</span>
              </span>
            </label>
          )}
        </Dialog>
      )}

      {/* How their weeks have gone. */}
      {work && <Stats open={work.open} weeks={work.weeks} days={work.days ?? []} />}
      {work && <Hours hours={work.hours ?? []} onOpen={onOpen} />}

      {can.includes('people.role') && !self && who.role !== 'owner' && !who.agent && <MayStart who={who} onChanged={onReload} />}

      {/*
        Where they are working and what is on them.

        Both are a slice: what is shown is what is in the projects the person
        *reading* is on, because the query runs as them under row-level
        security. So it says "here" — a screen that shows part of somebody's
        work and reads as all of it is worse than one that shows none.
      */}
      {work &&
        (work.projects.length > 0 ||
          (can.includes('project.member.add') && who.role !== 'client' && who.actor_id !== meId && allProjects.length > 0)) && (
          <div className="mt-5">
            <GroupLabel>{HEADS.projects}</GroupLabel>
            {/* A card each, the way the numbers above are drawn: the
              project's mark, its name, and what of it is on this person.
              It was a row of bare chips that read as a footnote. */}
            <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3" data-person-projects>
              {work.projects.map((pr) => {
                const theirs = work.open.filter((t) => t.project_id === pr.id)
                const late = theirs.filter((t) => t.overdue).length
                const full = allProjects.find((p) => p.id === pr.id)
                return (
                  <button
                    key={pr.id}
                    data-person-project={pr.id}
                    onClick={() => onProject(pr.id)}
                    className="flex min-w-px items-center gap-3 px-4 py-3 text-left transition-colors mouse:hover:bg-[var(--hover)]"
                    style={{ background: 'var(--panel)', borderRadius: 'var(--r-card)' }}
                  >
                    <ProjectMark {...(full ? markOf(full) : { id: pr.id, name: pr.name })} size={32} />
                    <span className="flex min-w-px flex-1 flex-col gap-1">
                      <span className="truncate text-base font-medium text-ink">{pr.name}</span>
                      <span className="truncate text-sm text-ink-3">
                        {theirs.length ? W.nOpen(theirs.length) : W.nothingOpen}
                        {late > 0 && <span className="text-due">{W.nOverdue(late)}</span>}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
            {/* Put on another project from here, with what they may do there.
              The projects offered are the ones the
              reader is on and this person is not; what they may do past
              the ordinary two is offered only where the reader runs the
              project, as the project's own settings do. */}
            {can.includes('project.member.add') && who.actor_id !== meId && (
              <AddToProject
                who={who}
                offered={allProjects.filter((p) => !work.projects.some((x) => x.id === p.id))}
                owner={can.includes('workspace.billing')}
                onAdded={async () => {
                  const r = await readPerson(who.actor_id, true).catch(() => null)
                  if (r) setWork(r)
                }}
              />
            )}
          </div>
        )}

      {work && <TheirWork open={work.open} onOpen={onOpen} />}
    </div>
  )
}

/**
 * Putting somebody on a project from their own page.
 *
 * A way in at the foot of their projects, the same "Add …" every list here
 * ends with; pressed, the project and what they may do there, and Add. The
 * rights past the ordinary two are open only on a project the reader runs:
 * the server refuses them anywhere else, and a chip that is refused on the
 * press is one that should not have been offered.
 */
function AddToProject({ who, offered, owner, onAdded }: { who: Person; offered: Project[]; owner: boolean; onAdded: () => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [onto, setOnto] = useState<string>('')
  const [rights, setRights] = useState<string[]>([...ON_JOINING])
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<string | null>(null)
  const project = offered.find((p) => p.id === onto) ?? offered[0]
  if (!offered.length) return null
  const runs = owner || Boolean(project?.can?.includes('project.tools'))
  const ordinary = (r: string) => ON_JOINING.includes(r)

  async function add() {
    if (!project || busy) return
    setBusy(true)
    setSaid(null)
    try {
      await api(`/projects/${project.id}/members`, {
        method: 'POST',
        body: JSON.stringify({ actor_id: who.actor_id, ...(runs ? { rights } : {}) }),
      })
      setOpen(false)
      setOnto('')
      setRights([...ON_JOINING])
      await onAdded()
    } catch {
      setSaid(W.couldNotAdd)
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        data-testid="person-add-project"
        onClick={() => setOpen(true)}
        className="mt-2 flex h-9 items-center gap-2 self-start rounded-[var(--r-row)] px-2 text-base transition-colors mouse:hover:bg-[var(--hover)] text-accent"
        style={{ letterSpacing: 'var(--track-body)' }}
      >
        <Icon name="plusThin" size={14} />
        {W.addToAProject}
      </button>
    )
  }
  return (
    <div
      data-person-adding
      className="mt-2 flex flex-col gap-3 p-4 transition-[opacity,transform] duration-200 ease-[var(--ease-out)] starting:-translate-y-1 starting:opacity-0 bg-panel"
      style={{ borderRadius: 'var(--r-card)' }}
    >
      <label className="flex items-center gap-3 text-base">
        <span className="w-24 shrink-0 text-ink-2">{W.project}</span>
        <select
          data-testid="person-add-which"
          value={project?.id ?? ''}
          onChange={(e) => setOnto(e.target.value)}
          className="h-8 min-w-px flex-1 rounded-[var(--r-row)] px-2 outline-none bg-track text-ink"
        >
          {offered.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <div className="flex items-start gap-3 text-base">
        <span className="w-24 shrink-0 pt-2 text-ink-2">{W.may}</span>
        <div data-person-add-rights className="flex min-w-px flex-1 flex-wrap gap-2">
          {RIGHTS.map(([right, label]) => {
            const locked = !runs && !ordinary(right)
            const on = rights.includes(right) && !locked
            return (
              <label
                key={right}
                className="relative flex h-8 cursor-pointer items-center gap-2 rounded-full px-3 text-sm font-medium"
                style={{
                  background: on ? 'var(--accent-soft)' : 'var(--sunken)',
                  color: on ? 'var(--accent)' : 'var(--ink-2)',
                  opacity: locked ? 0.4 : 1,
                }}
              >
                <input
                  type="checkbox"
                  className="absolute inset-0 cursor-pointer opacity-0 disabled:cursor-default"
                  aria-label={label}
                  disabled={locked || !runs}
                  checked={on}
                  onChange={(e) => setRights((was) => (e.target.checked ? [...was, right] : was.filter((r) => r !== right)))}
                />
                {on && <Icon name="check" size={12} />}
                {label}
              </label>
            )
          })}
        </div>
      </div>
      {!runs && <p className="text-sm text-ink-3">{W.ordinaryOnly}</p>}
      {said && (
        <p role="alert" className="text-sm text-danger">
          {said}
        </p>
      )}
      <div className="flex items-center gap-3">
        <button
          type="button"
          data-testid="person-add-confirm"
          disabled={busy}
          onClick={() => void add()}
          className="inline-flex h-8 items-center rounded-full px-4 text-sm font-medium transition-transform active:scale-[0.97] disabled:opacity-40 bg-accent text-on-accent"
        >
          {busy ? W.adding : W.addTo(project?.name)}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-ink-3">
          {MORE.cancel}
        </button>
      </div>
    </div>
  )
}

/**
 * What this one person may start — `docs/specs/member-rights.md`.
 *
 * The owner's word about somebody, beside their name rather than in the
 * workspace's settings: "not her" and "only him" are said about a person,
 * and the switch there says it about everybody at once. Moves on the press;
 * the list is asked again after, which puts it back if the server refused.
 */
const SAID = {
  may_create_projects: 'projects',
  may_create_channels: 'channels',
  may_see_members: 'members',
  may_invite_people: 'invites',
  may_connect_agents: 'agents',
} as const

function MayStart({ who, onChanged }: { who: Person; onChanged: () => Promise<void> }) {
  const [said, setSaid] = useState<{ projects?: boolean; channels?: boolean; members?: boolean; invites?: boolean; agents?: boolean }>({})
  // biome-ignore lint/correctness/useExhaustiveDependencies: what was said is about one person, and goes with them
  useEffect(() => setSaid({}), [who.actor_id])
  const projects = said.projects ?? who.creates_projects ?? false
  const channels = said.channels ?? who.may_create_channels !== false
  /* The answer, as Projects shows it: lit where the switch lets them before
     the owner has said anything about this person. */
  const members = said.members ?? who.sees_members ?? true
  const invites = said.invites ?? who.invites_people ?? false
  const agents = said.agents ?? who.connects_agents ?? false
  const set = (field: keyof typeof SAID, on: boolean) => {
    setSaid((s) => ({ ...s, [SAID[field]]: on }))
    void api(`/people/${who.actor_id}`, { method: 'PATCH', body: JSON.stringify({ [field]: on }) })
      .catch(() => setSaid({}))
      .finally(() => void onChanged())
  }
  return (
    <div className="mt-5" data-may-start>
      <GroupLabel>{W.canCreate}</GroupLabel>
      <div className="mt-2">
        <Panel>
          <Allowed
            testId="may-create-projects"
            label={HEADS.projects}
            hint={projects ? W.canProjects : W.cantProjects}
            on={projects}
            onChange={(on) => set('may_create_projects', on)}
          />
          <Hairline inset={16} />
          <Allowed
            testId="may-create-channels"
            label={W.channels}
            hint={channels ? W.canChannels : W.cantChannels}
            on={channels}
            onChange={(on) => set('may_create_channels', on)}
          />
        </Panel>
      </div>
      {/* Whom they see and whom they bring in — the workspace's switches for
          everybody, said here about this one person. Members off is the
          screen only: they still pick anybody for a task or a project.
          `docs/specs/member-rights.md`. */}
      <div className="mt-5" data-may-people>
        <GroupLabel>{SAYS.people}</GroupLabel>
        <div className="mt-2">
          <Panel>
            <Allowed
              testId="may-see-members"
              label={W.membersPage}
              hint={members ? W.canMembers : W.cantMembers}
              on={members}
              onChange={(on) => set('may_see_members', on)}
            />
            <Hairline inset={16} />
            <Allowed
              testId="may-invite-people"
              label={W.invitePeople}
              hint={invites ? W.canInvite : W.cantInvite}
              on={invites}
              onChange={(on) => set('may_invite_people', on)}
            />
            <Hairline inset={16} />
            {/* Connecting an agent puts it where they are, with their
                rights. */}
            <Allowed
              testId="may-connect-agents"
              label={W.connectAgents}
              hint={agents ? W.canAgents : W.cantAgents}
              on={agents}
              onChange={(on) => set('may_connect_agents', on)}
            />
          </Panel>
        </div>
      </div>
    </div>
  )
}

/** One yes-or-no about a person: what it is, what it means now, and the switch. */
function Allowed({
  testId,
  label,
  hint,
  on,
  onChange,
}: {
  testId: string
  label: string
  hint: string
  on: boolean
  onChange: (on: boolean) => void
}) {
  return (
    <label className="flex cursor-pointer items-center gap-4 px-4 py-3">
      <span className="flex min-w-px flex-1 flex-col gap-1">
        <span className="text-base font-medium text-ink">{label}</span>
        <span className="text-sm text-ink-3">{hint}</span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-pressed={on}
        aria-label={label}
        data-testid={testId}
        onClick={() => onChange(!on)}
        className="relative h-6 w-10 shrink-0 rounded-full transition-colors"
        /* Off is a track you can see and a white knob, as the account's
           switches are: the surface's own grey for both read as switched
           off and greyed out at once, which is "not allowed to touch". */
        style={{ background: on ? 'var(--accent)' : 'color-mix(in oklch, var(--ink) 18%, transparent)' }}
      >
        <span
          className="absolute top-1 left-1 size-4 rounded-full transition-transform"
          style={{
            background: '#fff',
            boxShadow: '0 1px 2px rgb(0 0 0 / 0.2)',
            transform: on ? 'translateX(16px)' : 'none',
          }}
        />
      </button>
    </label>
  )
}
