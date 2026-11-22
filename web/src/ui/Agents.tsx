import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { AGENTS as W } from '../words/agents.js'
import { APP } from '../words/app.js'
import { MORE, now } from '../data/words.js'
import { api, Refused, stored } from '../data/api.js'
import { ahead, known } from '../data/ahead.js'
import { recall } from '../data/memory.js'
import { pictureFor } from '../data/picture.js'
import { AGENT_PROMPT, CLIENTS, mcpSetup, type AgentClient } from '../data/agentSetup.js'
import {
  AgentDoingOf,
  AgentFaceMark,
  Avatar,
  Button,
  Dialog,
  GroupLabel,
  Popover,
  quietLook,
  SecretInput,
  findField,
  notALogin,
  urlField,
  type Framed,
} from './kit.jsx'
import { readWorking } from '../data/working.js'
import { AGENT_FACES, AGENT_FACE_IDS, agentFaceOf } from '../data/agentFaces.js'
import type { AgentFace } from '@tracker/shared-schema'
import { Icon } from './glyphs.jsx'
import { ProjectMark, markOf } from './icons.jsx'
import { Stats, readPerson, type PersonRead } from './Stats.jsx'
import { TheirWork } from './TheirWork.jsx'
import { AgentWeek } from './AgentWeek.jsx'
import { ROUTINE_URL, keyFits } from './WebhookKey.jsx'
import { ReachEditor, ReachPicker, ReachShown, reachName, reachOfRow, type Reach } from './AgentReach.jsx'
import { WEBHOOK_KEY as K } from '../words/webhookKey.js'

type Agent_ = {
  actor_id: string
  name: string
  avatar_url?: string | null
  reach: string
  created_by: string
  created_by_name: string
  created_at: string
  project_ids: string[]
  /** Where the reader could put it. */
  offered_project_ids: string[]
  active_at: string | null
  /** `agent.remove`: disconnecting it, ending a connection made as it — the owner too. */
  can_disconnect: boolean
  /** `agent.manage`: its face, name, token and reach — whoever connected it alone. */
  can_manage: boolean
  /** To whoever manages one reached by webhook: whether it sends the
      receiver's own key, never the key. */
  authorization_set?: boolean
  /** `tuff` or `claude_routine`. */
  webhook_shape?: string
  /** To whoever manages it: where its webhook is sent — migration 268. */
  webhook_url?: string
  /** To whoever manages it: its webhook was turned off when the account
      that connected it changed hands; its reach set again starts it. */
  webhook_stopped?: boolean
  /** To whoever manages it: what Tuff's connector signed in as it. */
  connections?: { id: string; client: string; created_at: string; linked_by_name: string }[]
  /** Stopped because whoever connected it was put out of the account; a
      new token starts it again. */
  stopped?: boolean
}
export type Agent = Agent_
type Listed = { agents: Agent[] }
type Project = {
  id: string
  name: string
  archived_at?: string | null
  icon_url?: string | null | undefined
  mark_icon?: string | null | undefined
  mark_tint?: number | null | undefined
  /** What the reader may do there — running it is `project.tools`. */
  can?: string[] | undefined
}

/** How long ago, as the people list says it. */
function since(at: string): string {
  const s = (Date.now() - new Date(at).getTime()) / 1000
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
  if (s < 3600) return rtf.format(-Math.max(1, Math.round(s / 60)), 'minute')
  if (s < 86_400) return rtf.format(-Math.round(s / 3600), 'hour')
  return rtf.format(-Math.round(s / 86_400), 'day')
}

/**
 * The workspace's agents, for the Agents tab in Members.
 * Opened on the last answer, so the tab is there whole with the screen.
 */
export function useAgents(on: boolean): [Agent[] | null, () => Promise<void>] {
  const [listed, setListed] = useState<Listed | null>(() => known<Listed>('/agents'))
  const load = useCallback(async () => setListed(await ahead<Listed>('/agents')), [])
  useEffect(() => {
    if (on) void load().catch(() => {})
  }, [on, load])
  /* What was read ahead counts from the render it is known in, not from
     the effect after it: the state was taken once, when the shell first
     drew and nothing was known, so the column the read was waited for
     drew its people with the agents still null and the agents a render
     later — a group arriving under the others on the first opening. */
  return [(listed ?? known<Listed>('/agents'))?.agents ?? null, load]
}

/** A block to copy: a command, a config, the prompt. */
function Copyable({ label, text, testId }: { label: string; text: string; testId: string }) {
  const [copied, setCopied] = useState(false)
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new text is a new copy to make, so the tick goes
  useEffect(() => setCopied(false), [text])
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-ink-3">{label}</span>
        <button
          type="button"
          data-testid={`${testId}-copy`}
          onClick={() => {
            void navigator.clipboard
              .writeText(text)
              .then(() => setCopied(true))
              .catch(() => {})
          }}
          className="text-sm font-medium text-accent"
        >
          {copied ? W.copied : W.copy}
        </button>
      </div>
      <pre
        data-testid={testId}
        className="max-h-[240px] overflow-auto rounded-[var(--r-row)] p-3 text-xs leading-4 whitespace-pre-wrap bg-sunken text-ink"
      >
        {text}
      </pre>
    </div>
  )
}

/**
 * How their agent reaches Tuff from where it works:
 * the MCP server with its token, for the agent they run,
 * and what to tell it. Shown once with the token, and on the agent's page
 * after, with a placeholder where the token was.
 */
export function McpSteps({ token }: { token?: string }) {
  const [client, setClient] = useState<AgentClient>('claude')
  return (
    <div data-agent-mcp-steps className="flex flex-col gap-3 text-sm">
      <div className="flex flex-wrap gap-2">
        {CLIENTS.map((c) => (
          <button
            type="button"
            key={c.client}
            data-agent-client={c.client}
            aria-pressed={client === c.client}
            onClick={() => setClient(c.client)}
            className="h-8 rounded-full px-4 text-sm font-medium"
            style={client === c.client ? { background: 'var(--accent)', color: 'var(--on-accent)' } : quietLook}
          >
            {c.client === 'other' ? W.otherClient : c.name}
          </button>
        ))}
      </div>
      <ol className="flex list-decimal flex-col gap-2 pl-5 leading-5 text-ink-2">
        <li>{token ? W.stepServer : W.stepServerLater}</li>
        <li>{W.stepPrompt}</li>
        <li>{client === 'claude' ? W.stepWakeClaude : W.stepWake}</li>
      </ol>
      <Copyable label={W.serverLabel} text={mcpSetup(location.origin, client, token)} testId="agent-mcp-setup" />
      <Copyable label={W.promptLabel} text={AGENT_PROMPT} testId="agent-prompt" />
    </div>
  )
}

/** How it is reached, in a word, for its row in the list. */
export const reachOf = (a: Agent) => reachName(reachOfRow(a))

/**
 * One agent, opened beside the list as a person is.
 *
 * The blocks a person's page has, each on its own ground: its numbers, how
 * it is reached, where it works (put on a project and taken off one here),
 * what is open on it, and how to set it up. Its face takes a picture from
 * whoever manages it.
 */
export function AgentPage({
  agent,
  projects,
  canStaff,
  onBack,
  onGone,
  onChanged,
  onProject,
  onOpen,
  onOpenIn,
  onMessage,
}: {
  agent: Agent
  /** The reader's projects: where they could take it off one. */
  projects: Project[]
  /** `project.member.add`, from `/api/me`. */
  canStaff: boolean
  onBack: () => void
  onGone: () => void
  /** Asks the list again, and stays here. */
  onChanged: () => Promise<void>
  onProject: (projectId: string) => void
  onOpen: (projectId: string, taskId: string) => void
  /** A line of its week opens what it happened to. */
  onOpenIn?: (projectId: string, tool: string, objectId: string) => void
  /** The conversation with it — beside this page where there is room, */
  onMessage?: (actorId: string) => void
}) {
  const [leaving, setLeaving] = useState(false)
  const [rekeying, setRekeying] = useState(false)
  /* Its name as it is being typed, for whoever manages it; the list's
     answer puts it back where a rename did not take. */
  const [name, setName] = useState(agent.name)
  useEffect(() => setName(agent.name), [agent.name])
  async function rename(to: string) {
    const next = to.trim()
    if (!next || next === agent.name) return setName(agent.name)
    try {
      await api(`/agents/${agent.actor_id}`, { method: 'PATCH', body: JSON.stringify({ name: next }) })
    } catch {
      setName(agent.name)
      setSaid(W.couldntRename)
    }
    await onChanged()
  }
  /* Where it is, moved on the press and put back by the list's answer. */
  const [ids, setIds] = useState(agent.project_ids)
  useEffect(() => setIds(agent.project_ids), [agent.project_ids])
  const [said, setSaid] = useState<string | null>(null)
  const [face, setFace] = useState<'busy' | string | null>(null)
  /* What it wears until the list says so: a pick moves the face at once. */
  const [wearing, setWearing] = useState<string | null | undefined>(undefined)
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new picture is a new chance to load, so what was lost is forgotten
  useEffect(() => setWearing(undefined), [agent.avatar_url])
  const shownUrl = wearing === undefined ? (agent.avatar_url ?? null) : wearing
  /* Its numbers and its open work, as a person's are read — opened on what
     was read ahead under the pointer, so the page is there whole. */
  const [work, setWork] = useState<PersonRead | null>(() => recall<PersonRead>(`person:${agent.actor_id}`) ?? null)
  const reread = useCallback(async () => {
    const r = await readPerson(agent.actor_id, true).catch(() => null)
    setWork((had) => r ?? had ?? { projects: [], open: [], weeks: [], hours: [], days: [], email: null, timezone: null })
  }, [agent.actor_id])
  useEffect(() => {
    void reread()
  }, [reread])
  /* What it says it is doing, asked again while the page is open: no
     project's socket is listening here. */
  useEffect(() => {
    void readWorking()
    const again = setInterval(() => void readWorking(), 30_000)
    return () => clearInterval(again)
  }, [])

  const where = ids.map((id) => projects.find((p) => p.id === id)).filter((p): p is Project => Boolean(p))
  const offered = canStaff
    ? agent.offered_project_ids
        .filter((id) => !ids.includes(id))
        .map((id) => projects.find((p) => p.id === id))
        .filter((p): p is Project => Boolean(p))
    : []
  const fileId = `agent-face-${agent.actor_id}`

  async function add(projectId: string) {
    setSaid(null)
    setIds((was) => [...was, projectId])
    try {
      await api(`/projects/${projectId}/members`, { method: 'POST', body: JSON.stringify({ actor_id: agent.actor_id }) })
    } catch {
      setIds((was) => was.filter((x) => x !== projectId))
      setSaid(W.couldntAdd)
    }
    await onChanged()
  }
  /* A connection ended goes at once, and comes back if the server refused. */
  const [ended, setEnded] = useState<string[]>([])
  const [endSaid, setEndSaid] = useState<string | null>(null)
  async function endConnection(id: string) {
    setEndSaid(null)
    setEnded((was) => [...was, id])
    try {
      await api(`/agents/${agent.actor_id}/connections/${id}`, { method: 'DELETE' })
    } catch {
      setEnded((was) => was.filter((x) => x !== id))
      setEndSaid(W.couldntEndConnection)
    }
    await onChanged()
  }
  const connections = (agent.connections ?? []).filter((o) => !ended.includes(o.id))
  async function remove(projectId: string) {
    setSaid(null)
    setIds((was) => was.filter((x) => x !== projectId))
    try {
      await api(`/projects/${projectId}/members/${agent.actor_id}`, { method: 'DELETE' })
    } catch {
      setIds((was) => (was.includes(projectId) ? was : [...was, projectId]))
      setSaid(W.couldntRemove)
    }
    await onChanged()
  }
  async function upload(chosen: File) {
    setFace('busy')
    /* Made fit first, as a person's own: `data/picture.ts`. */
    const picked = await pictureFor(chosen)
    if ('refused' in picked) return setFace(picked.refused)
    const form = new FormData()
    form.append('file', picked)
    // Not through api(): multipart sets its own content type.
    const r = await fetch(`/api/agents/${agent.actor_id}/avatar`, {
      method: 'POST',
      headers: { 'x-api-version': '1', 'x-tongue': now, authorization: `Bearer ${stored()?.access_token ?? ''}` },
      body: form,
    }).catch(() => null)
    if (!r?.ok) {
      const body = (await r?.json().catch(() => null)) as { error?: { message?: string } } | null
      return setFace(body?.error?.message ?? W.couldntUpload)
    }
    await onChanged()
    setFace(null)
  }
  async function dropFace() {
    setFace(null)
    setWearing(null)
    await api(`/agents/${agent.actor_id}/avatar`, { method: 'DELETE' }).catch(() => setFace(W.couldntUpload))
    await onChanged()
  }
  /* A premade face, worn on the press and put back if the server says no. */
  async function wear(id: AgentFace) {
    setFace(null)
    const was = shownUrl
    setWearing(`/faces/${id}.png`)
    try {
      await api(`/agents/${agent.actor_id}/avatar`, { method: 'PUT', body: JSON.stringify({ preset: id }) })
    } catch {
      setWearing(was)
      setFace(W.couldntChangeAvatar)
    }
    await onChanged()
  }

  /* The face, and for whoever manages it the way to change it: pressed
     with no picture, it asks for one; with one, change or remove. */
  const mark = (
    <span className="relative flex shrink-0">
      <Avatar id={agent.actor_id} name={agent.name} url={shownUrl} size={40} on="var(--surface)" live />
      {agent.can_manage && (
        <span
          aria-hidden
          className="absolute -right-1 -bottom-1 flex size-5 items-center justify-center rounded-full bg-surface text-ink-2"
          style={{ boxShadow: '0 0 0 2px var(--chrome)' }}
        >
          <Icon name="camera" size={12} />
        </span>
      )}
    </span>
  )
  const pressable = 'flex rounded-full transition-transform duration-150 ease-[var(--ease-out)] active:scale-[0.97]'

  /* Drawn whole: until its numbers are in, nothing — rather than the name,
     then the numbers pushing everything under them down. As a person's. */
  if (!work) return <div className="min-w-px flex-1" />

  return (
    <div data-agent-open={agent.actor_id} className="min-w-px max-w-[640px] flex-1">
      <button
        data-testid="agent-back"
        onClick={onBack}
        className="mb-3 flex items-center gap-1 text-base font-medium sm:hidden text-accent"
      >
        <Icon name="chevL" size={16} />
        {W.head}
      </button>
      <div className="flex items-center gap-3">
        {!agent.can_manage ? (
          mark
        ) : (
          /* Pressed, the faces it can wear, and a picture of its own
             below them. */
          <Popover
            shape="bare"
            width={272}
            testId="agent-face"
            said={W.pictureOf(agent.name)}
            sheet={false}
            label={<span className={pressable}>{mark}</span>}
          >
            {(close) => (
              <div data-menu className="py-1">
                <div className="px-3 pt-2 pb-3">
                  <FacePicker
                    on={agentFaceOf(shownUrl)}
                    onPick={(id) => {
                      close()
                      if (id) void wear(id)
                    }}
                  />
                </div>
                <button
                  data-row
                  data-testid="agent-change-avatar"
                  onClick={() => {
                    /* Asked while the press is still the person's own,
                       before the menu goes. */
                    document.getElementById(fileId)?.click()
                    close()
                  }}
                  className="flex w-full items-center gap-3 px-3 text-left text-base text-ink"
                  style={{ height: 'var(--row-h)' }}
                >
                  <Icon name="camera" size={16} />
                  {shownUrl && !agentFaceOf(shownUrl) ? W.changePicture : W.uploadPicture}
                </button>
                {shownUrl && (
                  <button
                    data-row
                    data-testid="agent-drop-avatar"
                    onClick={() => {
                      close()
                      void dropFace()
                    }}
                    className="flex w-full items-center gap-3 px-3 text-left text-base text-ink"
                    style={{ height: 'var(--row-h)' }}
                  >
                    <Icon name="close" size={16} />
                    {agentFaceOf(shownUrl) ? W.initials : W.removePicture}
                  </button>
                )}
              </div>
            )}
          </Popover>
        )}
        {agent.can_manage && (
          <input
            id={fileId}
            type="file"
            accept="image/*"
            data-testid="agent-avatar"
            className="hidden"
            onChange={(e) => {
              const chosen = e.target.files?.[0]
              e.target.value = ''
              if (chosen) void upload(chosen)
            }}
          />
        )}
        <div className="flex min-w-0 flex-col">
          {agent.can_manage ? (
            /* Its name is a field for whoever manages it — Enter or leaving
               keeps it, Escape puts it back. */
            <input
              {...notALogin}
              data-testid="agent-name"
              aria-label={W.nameLabel}
              value={name}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur()
                if (e.key === 'Escape') {
                  setName(agent.name)
                  requestAnimationFrame(() => (document.activeElement as HTMLElement | null)?.blur())
                }
              }}
              onBlur={(e) => void rename(e.target.value)}
              className="-mx-1 min-w-px truncate rounded-[var(--r-row)] bg-transparent px-1 text-lg font-medium text-ink outline-none focus:bg-[var(--sunken)]"
            />
          ) : (
            <span className="truncate text-lg font-medium text-ink">{agent.name}</span>
          )}
          {/* What happened to its picture, in the line under its name, for
              as long as it matters; then who connected it again. */}
          {/* Or what it says it is doing now, in the same line while it
              lasts, pressed to open the task. */}
          <AgentDoingOf agentId={agent.actor_id}>
            {(status, doing) =>
              status && !face ? (
                <button
                  type="button"
                  data-agent-doing={agent.actor_id}
                  title={doing}
                  disabled={!status.task_id || !status.project_id}
                  onClick={() => status.task_id && status.project_id && onOpen(status.project_id, status.task_id)}
                  className="truncate text-left text-sm text-ink-3"
                >
                  {doing}
                </button>
              ) : (
                <span
                  data-agent-said={face ? '' : undefined}
                  className="truncate text-sm"
                  style={{ color: face && face !== 'busy' ? 'var(--danger)' : 'var(--ink-3)' }}
                >
                  {face === 'busy'
                    ? W.uploading
                    : (face ??
                      [
                        ...(agent.stopped ? [W.stopped] : []),
                        W.connectedBy(agent.created_by_name),
                        agent.active_at ? W.activeAgo(since(agent.active_at)) : W.neverActive,
                      ].join(' · '))}
                </span>
              )
            }
          </AgentDoingOf>
        </div>
        {onMessage && (
          <button
            data-testid="agent-message"
            onClick={() => onMessage(agent.actor_id)}
            className="ml-auto shrink-0 rounded-full px-4 text-sm font-medium bg-hover text-ink"
            style={{ height: 'var(--control-h)' }}
          >
            {W.message}
          </button>
        )}
        {agent.can_manage && (
          <button
            data-testid="agent-new-token"
            onClick={() => setRekeying(true)}
            className={`${onMessage ? '' : 'ml-auto '}shrink-0 rounded-full px-4 text-sm font-medium bg-hover text-ink`}
            style={{ height: 'var(--control-h)' }}
          >
            {W.newToken}
          </button>
        )}
        {agent.can_disconnect && (
          <button
            data-testid="agent-disconnect"
            onClick={() => setLeaving(true)}
            className={`${agent.can_manage || onMessage ? '' : 'ml-auto '}shrink-0 rounded-full px-4 text-sm font-medium bg-hover text-ink`}
            style={{ height: 'var(--control-h)' }}
          >
            {W.disconnect}
          </button>
        )}
      </div>

      {/* Its numbers, the person's block. No
          hours: an agent logs no time. */}
      {work && <Stats open={work.open} weeks={work.weeks} days={work.days} />}

      {/* What it did this week, and what that cost.
          Drawn only for whoever may read it; the server says who. */}
      <AgentWeek
        agentId={agent.actor_id}
        onOpenTask={onOpen}
        onOpenLine={(projectId, tool, objectId) => (tool === 'tasks' ? onOpen(projectId, objectId) : onOpenIn?.(projectId, tool, objectId))}
      />

      {/* How it is reached, on a ground of its own, with the picker the
          window that connected it drew — changed here by whoever manages
          it, shown to anybody else. */}
      <div className="mt-5">
        <GroupLabel>{W.reachedHead}</GroupLabel>
        <div className="mt-2 px-4 py-4 bg-panel" data-agent-reach-card style={{ borderRadius: 'var(--r-card)' }}>
          {agent.can_manage && agent.webhook_stopped && (
            <p data-agent-reach-stopped className="mb-4 text-sm leading-5 text-ink-2">
              {W.reachStopped}
            </p>
          )}
          {agent.can_manage ? <ReachEditor agent={agent} onChanged={onChanged} /> : <ReachShown r={reachOfRow(agent)} />}
        </div>
      </div>

      <div className="mt-5">
        <GroupLabel>{W.projects}</GroupLabel>
        {where.length === 0 ? (
          <p className="mt-2 px-3 text-sm text-ink-3">{W.noProjects}</p>
        ) : (
          /* A card each, as a person's: its mark, its name, and what of it
             is on the agent — and a cross to take it off, where the reader
             staffs that project. */
          <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3" data-agent-projects>
            {where.map((p) => {
              const theirs = work?.open.filter((t) => t.project_id === p.id) ?? []
              const late = theirs.filter((t) => t.overdue).length
              return (
                <div
                  key={p.id}
                  data-agent-project-card={p.id}
                  className="group flex min-w-px items-center transition-colors mouse:hover:bg-[var(--hover)]"
                  style={{ background: 'var(--panel)', borderRadius: 'var(--r-card)' }}
                >
                  <button onClick={() => onProject(p.id)} className="flex min-w-px flex-1 items-center gap-3 py-3 pr-2 pl-4 text-left">
                    <ProjectMark {...markOf(p)} size={32} />
                    <span className="flex min-w-px flex-1 flex-col gap-1">
                      <span className="truncate text-base font-medium text-ink">{p.name}</span>
                      <span className="truncate text-sm text-ink-3">
                        {theirs.length ? APP.nOpen(theirs.length) : APP.nothingOpen}
                        {late > 0 && <span className="text-due">{APP.nOverdue(late)}</span>}
                      </span>
                    </span>
                  </button>
                  {/* Taking somebody off is running the project, and the
                      server says where: `project.member.remove` on its can. */}
                  {Boolean(p.can?.includes('project.member.remove')) && (
                    /* Behind the pointer where there is one; a finger has
                       no hover, so there it stays. */
                    <button
                      data-testid="agent-remove-project"
                      aria-label={W.removeFrom(p.name)}
                      title={W.removeFrom(p.name)}
                      onClick={() => void remove(p.id)}
                      className="mr-2 flex size-8 shrink-0 items-center justify-center rounded-full transition-[opacity,transform] duration-150 ease-[var(--ease-out)] group-focus-within:opacity-100 active:scale-[0.97] mouse:opacity-0 mouse:on-group-hover:opacity-100 mouse:hover:bg-[var(--hover)] text-ink-3"
                    >
                      <Icon name="close" size={14} />
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}
        {offered.length > 0 && (
          /* The projects it would be taken on, and nothing it would be
             refused: no rights to choose, so a press on one is the add. */
          <div className="mt-2 flex">
            <Popover
              shape="bare"
              width={280}
              testId="agent-add-project"
              said={W.addToProject}
              label={
                <span
                  className="flex h-9 items-center gap-2 rounded-[var(--r-row)] px-2 text-base transition-colors mouse:hover:bg-[var(--hover)] text-accent"
                  style={{ letterSpacing: 'var(--track-body)' }}
                >
                  <Icon name="plusThin" size={14} />
                  {W.addToProject}
                </span>
              }
            >
              {(close) => (
                <div className="flex max-h-[320px] flex-col overflow-y-auto py-1" data-menu data-agent-offered>
                  {offered.map((p) => (
                    <button
                      key={p.id}
                      data-row
                      data-agent-offer={p.id}
                      onClick={() => {
                        close()
                        void add(p.id)
                      }}
                      className="flex w-full shrink-0 items-center gap-3 px-3 text-left text-base text-ink"
                      style={{ height: 'var(--row-h)' }}
                    >
                      <ProjectMark {...markOf(p)} size={20} />
                      <span className="min-w-px flex-1 truncate">{p.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </Popover>
          </div>
        )}
        {said && (
          <p role="alert" className="mt-2 px-3 text-sm text-danger">
            {said}
          </p>
        )}
      </div>

      {/* What Tuff's connector signed in as it, for whoever may take it
          away — its connector, and the owner: seen, and ended one by one. */}
      {agent.can_disconnect && (connections.length > 0 || endSaid) && (
        <div className="mt-5" data-agent-connections>
          <GroupLabel>{W.signedInHead}</GroupLabel>
          <div className="mt-2 flex flex-col bg-panel" style={{ borderRadius: 'var(--r-card)' }}>
            {connections.map((o) => (
              <div key={o.id} data-agent-connection={o.id} className="flex items-center gap-3 py-3 pr-2 pl-4">
                <span className="flex min-w-px flex-1 flex-col gap-1">
                  <span className="truncate text-base font-medium text-ink">{o.client}</span>
                  <span className="truncate text-sm text-ink-3">{W.signedInBy(o.linked_by_name, since(o.created_at))}</span>
                </span>
                <button
                  data-testid="agent-end-connection"
                  aria-label={W.endConnectionOf(o.client)}
                  onClick={() => void endConnection(o.id)}
                  className="shrink-0 rounded-full px-4 text-sm font-medium bg-hover text-ink"
                  style={{ height: 'var(--control-h)' }}
                >
                  {W.endConnection}
                </button>
              </div>
            ))}
          </div>
          {endSaid && (
            <p role="alert" className="mt-2 px-3 text-sm text-danger">
              {endSaid}
            </p>
          )}
        </div>
      )}

      {work && <TheirWork open={work.open} onOpen={onOpen} />}

      {agent.reach === 'mcp' && agent.can_disconnect && (
        <div className="mt-5 flex flex-col">
          <GroupLabel>{W.setUp}</GroupLabel>
          <div className="mt-2 px-4 py-4 bg-panel" data-agent-setup style={{ borderRadius: 'var(--r-card)' }}>
            <McpSteps />
          </div>
        </div>
      )}

      {leaving && <Disconnect agent={agent} onClose={() => setLeaving(false)} onGone={onGone} />}
      {rekeying && <NewToken agent={agent} onClose={() => setRekeying(false)} />}
    </div>
  )
}

/** The tab with nobody on it yet: what an agent is, and the way to connect one. */
export function NoAgents({ canConnect, onConnect }: { canConnect: boolean; onConnect: () => void }) {
  return (
    <div data-agents-none className="flex max-w-[480px] flex-col items-start gap-3">
      <p className="text-base leading-5 text-ink-2">{W.about}</p>
      {canConnect && (
        <Button tone="primary" data-testid="agent-connect-open" onClick={onConnect}>
          {W.connect}
        </Button>
      )}
    </div>
  )
}

/** The premade faces offered: the ten robots.
    The other two sets are drawn and taken by the server; offering them is
    this line. */
const OFFERED = AGENT_FACE_IDS.filter((id) => AGENT_FACES[id].set === 'bot')

/** The faces in a row, the one worn ringed; each alive, since this is
    where somebody is looking at them. */
function FacePicker({
  on,
  onPick,
  letters,
}: {
  on: AgentFace | null
  onPick: (id: AgentFace | null) => void
  letters?: { id: string; name: string }
}) {
  const tile = (key: string, pressed: boolean, label: string, child: ReactNode, pick: () => void) => (
    <button
      type="button"
      key={key}
      data-agent-face-pick={key}
      aria-pressed={pressed}
      aria-label={label}
      title={label}
      onClick={pick}
      className="flex size-10 items-center justify-center rounded-full transition-transform duration-150 ease-[var(--ease-out)] active:scale-[0.97]"
      style={{ boxShadow: pressed ? '0 0 0 2px var(--chrome), 0 0 0 4px var(--accent)' : 'none' }}
    >
      {child}
    </button>
  )
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label={W.avatar}>
      {OFFERED.map((id, i) => tile(id, on === id, W.robot(i + 1), <AgentFaceMark id={id} size={40} live at={i * 1.3} />, () => onPick(id)))}
      {letters &&
        tile('initials', on === null, W.initials, <Avatar id={letters.id} name={letters.name || '?'} size={40} />, () => onPick(null))}
    </div>
  )
}

type ConnectProps = {
  projects: Project[]
  onClose: () => void
  onMade: (agentId: string) => void
}

/** The window that connects one, and then shows, once, what it holds. */
export function ConnectAgent(props: ConnectProps) {
  const f = useConnect(props)
  return (
    <Dialog title={f.title} testId={f.testId} onClose={props.onClose} footer={f.footer}>
      {f.body}
    </Dialog>
  )
}

/** What the window holds, apart from the window — also the plus's second tab. */
export function useConnect({ projects, onClose, onMade }: ConnectProps): Framed & { made: boolean } {
  /* How it is reached comes first: from where it works, through MCP, or
     called at an address. Named as what it is until they name it —
     several agents may be connected. */
  /* A routine is a webhook of Claude Code's shape. */
  const [reach, setReach] = useState<'mcp' | 'webhook' | 'routine'>('mcp')
  /* The receiver's own key: optional for a webhook, a routine's token. */
  const [key, setKey] = useState('')
  const [name, setName] = useState<string>(W.defaultName)
  const [chosen, setChosen] = useState<string[]>(() => (projects.length === 1 ? [projects[0]!.id] : []))
  const [url, setUrl] = useState('')
  const [find, setFind] = useState('')
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<string | null>(null)
  const [made, setMade] = useState<{ token: string; secret?: string; routine?: boolean } | null>(null)
  /* A robot to start from, dealt at random so two agents connected one
     after the other are not twins; its initials are one press away. */
  const [face, setFace] = useState<AgentFace | null>(() => OFFERED[Math.floor(Math.random() * OFFERED.length)] ?? null)
  const ready =
    name.trim().length > 0 &&
    chosen.length > 0 &&
    (reach === 'mcp' ||
      (reach === 'webhook' && /^https:\/\/\S+$/.test(url.trim()) && (!key.trim() || keyFits(key))) ||
      (reach === 'routine' && ROUTINE_URL.test(url.trim()) && keyFits(key)))

  async function go() {
    if (!ready || busy) return
    setBusy(true)
    setSaid(null)
    try {
      const r = await api<{ agent_id: string; token: string; secret?: string }>('/agents', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          project_ids: chosen,
          reach: reach === 'mcp' ? 'mcp' : 'webhook',
          ...(reach === 'mcp' ? {} : { url: url.trim() }),
          ...(reach === 'routine' ? { shape: 'claude_routine' } : {}),
          ...(reach !== 'mcp' && key.trim() ? { authorization: key.trim() } : {}),
        }),
      })
      /* Its face, once it is there to wear one. A face that does not
         take leaves it its initials, which is a face too. */
      if (face) {
        await api(`/agents/${r.agent_id}/avatar`, { method: 'PUT', body: JSON.stringify({ preset: face }) }).catch(() => null)
      }
      setKey('')
      setMade({ ...r, routine: reach === 'routine' })
      onMade(r.agent_id)
    } catch (e) {
      setSaid(e instanceof Refused && e.status !== 500 ? e.message : W.couldntConnect)
    } finally {
      setBusy(false)
    }
  }

  const input = 'h-10 rounded-[var(--r-row)] px-3 text-base outline-none placeholder:text-[var(--ink-3)]'
  const ground = { background: 'var(--sunken)', color: 'var(--ink)' }
  if (made) {
    return {
      made: true,
      title: W.ready(name.trim()),
      testId: 'agent-made',
      footer: (
        <div className="flex flex-1 justify-end">
          <Button tone="primary" onClick={onClose}>
            {W.done}
          </Button>
        </div>
      ),
      body: (
        <div className="flex flex-col gap-3 px-4 pt-2 pb-4 text-sm">
          <p className="leading-5 text-ink-3">{made.routine ? K.routineMade : made.secret ? W.copyBoth : W.copyToken}</p>
          {(
            [
              [W.token, made.token, 'agent-token'],
              ...(made.secret && !made.routine ? ([[W.secret, made.secret, 'agent-secret']] as const) : []),
            ] as const
          ).map(([label, value, id]) => (
            <div key={id} className="flex flex-col gap-1">
              <span className="text-ink-3">{label}</span>
              <code data-testid={id} className="block break-all select-all rounded-[var(--r-row)] p-3" style={ground}>
                {value}
              </code>
            </div>
          ))}
          {/* Through MCP: what to give the agent they run, with its token. */}
          {!made.secret && !made.routine && <McpSteps token={made.token} />}
        </div>
      ),
    }
  }
  const q = find.trim().toLowerCase()
  const shown = projects.filter((p) => chosen.includes(p.id) || !q || p.name.toLowerCase().includes(q))
  return {
    made: false,
    title: W.connect,
    testId: 'agent-connect',
    footer: (
      <div className="flex flex-1 items-center justify-end gap-2">
        <button onClick={onClose} className="h-8 px-3 text-base font-medium text-ink-2">
          {MORE.cancel}
        </button>
        <Button tone="primary" data-testid="agent-connect-go" disabled={!ready || busy} onClick={() => void go()}>
          {busy ? W.connecting : W.connectShort}
        </Button>
      </div>
    ),
    body: (
      <form
        className="flex flex-col gap-5 px-4 pt-2 pb-4"
        onSubmit={(e) => {
          e.preventDefault()
          void go()
        }}
      >
        <Part title={W.reachedHead}>
          <ReachPicker
            value={reach}
            onChange={(r) => {
              setReach(r)
              setUrl('')
              setKey('')
            }}
          />
        </Part>

        <Part title={W.name}>
          <input
            {...notALogin}
            data-testid="agent-name"
            value={name}
            maxLength={60}
            placeholder={W.namePlaceholder}
            onChange={(e) => setName(e.target.value)}
            className={input}
            style={ground}
          />
        </Part>

        <Part title={W.avatar}>
          <FacePicker on={face} onPick={setFace} letters={{ id: 'new-agent', name: name.trim() || W.defaultName }} />
        </Part>

        <Part title={W.projects} hint={W.projectsWebhook}>
          {/* As the invitation lists them: each with its mark, in a box
              that scrolls, narrowed by a field when there are many. */}
          {projects.length > 8 && (
            <input
              {...findField}
              aria-label={W.findProject}
              placeholder={W.findProject}
              value={find}
              onChange={(e) => setFind(e.target.value)}
              className="h-8 rounded-full px-3 text-base outline-none placeholder:text-[var(--ink-3)]"
              style={ground}
            />
          )}
          <div className="flex max-h-[240px] flex-col overflow-y-auto rounded-[var(--r-row)] bg-sunken">
            {shown.map((p) => {
              const on = chosen.includes(p.id)
              return (
                <button
                  type="button"
                  key={p.id}
                  data-agent-project={p.id}
                  aria-pressed={on}
                  onClick={() => setChosen((was) => (on ? was.filter((x) => x !== p.id) : [...was, p.id]))}
                  className="flex h-10 shrink-0 items-center gap-3 px-3 text-left text-base mouse:hover:bg-[var(--hover)] text-ink"
                >
                  <ProjectMark {...markOf(p)} size={20} />
                  <span className="min-w-px flex-1 truncate">{p.name}</span>
                  <span
                    className="flex size-5 shrink-0 items-center justify-center rounded-full"
                    style={on ? { background: 'var(--accent)', color: 'var(--on-accent)' } : { boxShadow: 'inset 0 0 0 1px var(--ink-3)' }}
                  >
                    {on && <Icon name="check" size={12} />}
                  </span>
                </button>
              )
            })}
          </div>
        </Part>

        {/* What the chosen way needs, with the other two drawn unseen in
            the same cell: the cell is as tall as the tallest, so choosing
            one never changes the window's height. */}
        <div className="grid">
          {(['mcp', 'webhook', 'routine'] as const).map((r) => (
            <div
              key={r}
              className="col-start-1 row-start-1 flex flex-col gap-3"
              style={r === reach ? undefined : { visibility: 'hidden' }}
              aria-hidden={r === reach ? undefined : true}
              inert={r === reach ? undefined : true}
            >
              <ReachNeeds r={r} live={r === reach} url={url} setUrl={setUrl} keyValue={key} setKey={setKey} />
            </div>
          ))}
        </div>
        {said && (
          <p role="alert" data-testid="agent-said" className="text-sm text-danger">
            {said}
          </p>
        )}
        <button type="submit" hidden />
      </form>
    ),
  }
}

/**
 * What one way of reaching it asks for in the connect window. Drawn for
 * all three, the two not chosen unseen and without their test ids, so the
 * window keeps one height.
 */
function ReachNeeds({
  r,
  live,
  url,
  setUrl,
  keyValue,
  setKey,
}: {
  r: Reach
  live: boolean
  url: string
  setUrl: (v: string) => void
  keyValue: string
  setKey: (v: string) => void
}) {
  const input = 'h-10 rounded-[var(--r-row)] px-3 text-base outline-none placeholder:text-[var(--ink-3)] bg-sunken text-ink'
  const id = (name: string) => (live ? name : undefined)
  if (r === 'mcp') {
    /* What happens after Connect, on a ground that fills the slot the
       other two ways' fields take, so the window keeps its height with
       nothing empty in it. */
    return (
      <div data-agent-mcp-how={live ? '' : undefined} className="flex flex-1 flex-col gap-4 rounded-[var(--r-card)] bg-sunken p-4">
        {/* What it works with, beside what this is: the three clients the
            setup after Connect is written for. */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-medium text-ink-2">{W.mcpHow}</span>
          <span className="flex items-center gap-2">
            {CLIENTS.filter((c) => c.client !== 'other').map((c) => (
              <span
                key={c.client}
                className="flex h-6 items-center rounded-full px-2 text-sm text-ink-2"
                style={{ background: 'var(--track)' }}
              >
                {c.name}
              </span>
            ))}
          </span>
        </div>
        <ol className="flex flex-col gap-3">
          {(
            [
              [W.mcpStepConnect, W.mcpStepToken],
              [W.mcpStepServerHead, W.mcpStepServer],
              [W.mcpStepRunHead, W.mcpStepRun],
            ] as const
          ).map(([head, line], i) => (
            <li key={head} className="flex items-start gap-3">
              <span
                aria-hidden
                className="flex size-5 shrink-0 items-center justify-center rounded-full text-xs font-medium"
                style={{ background: 'var(--track)', color: 'var(--ink-2)' }}
              >
                {i + 1}
              </span>
              <span className="flex min-w-px flex-col">
                <span className="text-sm leading-5 font-medium text-ink">{head}</span>
                <span className="text-sm leading-5 text-ink-3">{line}</span>
              </span>
            </li>
          ))}
        </ol>
      </div>
    )
  }
  return (
    <>
      <Part title={r === 'routine' ? K.routineUrl : W.webhook} hint={r === 'routine' ? K.routineUrlHint : W.webhookHint}>
        <input
          data-testid={id('agent-url')}
          {...urlField}
          aria-label={r === 'routine' ? K.routineUrl : W.webhook}
          placeholder={r === 'routine' ? 'https://api.anthropic.com/v1/claude_code/routines/…/fire' : 'https://'}
          value={live ? url : ''}
          onChange={(e) => setUrl(e.target.value)}
          className={input}
        />
      </Part>
      {/* The receiver's own key — a routine's token, or what a receiver
          like n8n or a bot's gateway asks for. Never shown again. */}
      <Part title={r === 'routine' ? K.routineToken : K.head} hint={r === 'routine' ? K.routineTokenHint : K.hint}>
        <SecretInput
          data-testid={id('agent-key-value')}
          maxLength={1024}
          aria-label={r === 'routine' ? K.routineToken : K.head}
          placeholder={K.placeholder}
          value={live ? keyValue : ''}
          onChange={(e) => setKey(e.target.value)}
          className={input}
        />
      </Part>
      {r === 'routine' && (
        /* Whose rights it works with, said where it is chosen. */
        <p data-testid={id('agent-routine-rights')} className="text-sm leading-5 text-ink-2">
          {K.routineRights}
        </p>
      )}
    </>
  )
}

/** A part of the window: what it asks, and a line on it — as the invitation's. */
function Part({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium text-ink-2">{title}</span>
        {hint && <span className="text-sm leading-5 text-ink-3">{hint}</span>}
      </div>
      {children}
    </div>
  )
}

/** Asked first: it comes off its work at once. */
function Disconnect({ agent, onClose, onGone }: { agent: Agent; onClose: () => void; onGone: () => void }) {
  const [said, setSaid] = useState<string | null>(null)
  return (
    <Dialog
      title={W.disconnectName(agent.name)}
      testId="agent-disconnect-dialog"
      onClose={onClose}
      footer={
        <div className="flex flex-1 items-center justify-end gap-2">
          <button onClick={onClose} className="h-8 px-3 text-base font-medium text-ink-2">
            {MORE.cancel}
          </button>
          <Button
            tone="danger"
            data-testid="agent-disconnect-go"
            onClick={async () => {
              try {
                await api(`/agents/${agent.actor_id}`, { method: 'DELETE' })
                onGone()
                onClose()
              } catch {
                setSaid(W.couldntDisconnect)
              }
            }}
          >
            {W.disconnect}
          </Button>
        </div>
      }
    >
      <p className="px-4 pt-2 pb-4 text-base leading-5" style={{ color: said ? 'var(--danger)' : 'var(--ink-2)' }}>
        {said ?? W.disconnectSays}
      </p>
    </Dialog>
  )
}

/**
 * A new token, asked first: the agent stops working with the old one at
 * once. Then shown once, as connecting shows it.
 */
function NewToken({ agent, onClose }: { agent: Agent; onClose: () => void }) {
  const [said, setSaid] = useState<string | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  return (
    <Dialog
      title={token ? W.newTokenFor(agent.name) : W.newTokenAsk(agent.name)}
      testId="agent-new-token-dialog"
      onClose={onClose}
      footer={
        <div className="flex flex-1 items-center justify-end gap-2">
          {token ? (
            <Button tone="primary" onClick={onClose}>
              {W.done}
            </Button>
          ) : (
            <>
              <button onClick={onClose} className="h-8 px-3 text-base font-medium text-ink-2">
                {MORE.cancel}
              </button>
              <Button
                tone="primary"
                data-testid="agent-new-token-go"
                disabled={busy}
                onClick={async () => {
                  setBusy(true)
                  try {
                    setToken((await api<{ token: string }>(`/agents/${agent.actor_id}/token`, { method: 'POST' })).token)
                  } catch {
                    setSaid(W.couldntNewToken)
                  } finally {
                    setBusy(false)
                  }
                }}
              >
                {W.newTokenGo}
              </Button>
            </>
          )}
        </div>
      }
    >
      {token ? (
        <div className="flex flex-col gap-3 px-4 pt-2 pb-4 text-sm">
          <p className="leading-5 text-ink-3">{W.copyToken}</p>
          <code
            data-testid="agent-token"
            className="block break-all select-all rounded-[var(--r-row)] p-3"
            style={{ background: 'var(--sunken)', color: 'var(--ink)' }}
          >
            {token}
          </code>
          {agent.reach === 'mcp' && <McpSteps token={token} />}
        </div>
      ) : (
        <p className="px-4 pt-2 pb-4 text-base leading-5" style={{ color: said ? 'var(--danger)' : 'var(--ink-2)' }}>
          {said ?? W.newTokenSays}
        </p>
      )}
    </Dialog>
  )
}
