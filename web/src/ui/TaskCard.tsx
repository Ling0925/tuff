import { useContext, useEffect, useState } from 'react'
import type { Priority } from '@tracker/shared-schema'
import { api, Refused } from '../data/api.js'
import { Avatar, Dot, LabelChip, PriorityMark, type Label } from './kit.jsx'
import { Icon } from './glyphs.jsx'
import { PersonDoorsContext } from './PersonCard.jsx'
import { dayMonth } from '../data/words.js'
import { TASK_CARD as W } from '../words/taskCard.js'
import { FILE_DETAIL } from '../words/fileDetail.js'
import { today as todayHere } from '../data/calendar.js'

/**
 * A task named in a message.
 *
 * In the words, its number and title, pressed to open it. Under the
 * message, its card as the board draws it: where it stands, its handle,
 * its title, its due date and who has it — read when it is drawn, so it
 * says where the task stands now rather than when it was named.
 */

type Card = {
  id: string
  number: number | null
  title: string
  project_id: string
  project_key: string | null
  list_name: string | null
  list_icon: string | null
  list_color: string | null
  completed_at: string | null
  due_on: string | null
  priority: Priority | null
  assignee_id: string | null
  assignee_name: string | null
  assignee_avatar_url: string | null
  /** Everybody on it, in order — the three above are the first. A card kept
      from before the list existed has none, and is drawn from those. */
  assignees?: { id: string; name: string; avatar_url: string | null }[]
  created_at: string | null
  decided_at: string | null
  cycle_name: string | null
  labels: Label[]
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/*
 * A card, `null` when the server says there is none — the task deleted, or
 * never this reader's to see, which the server answers alike — and
 * `undefined` when it could not be asked. Only the second keeps what was
 * drawn before: a chip whose task was deleted went on being drawn alive,
 * and its press opened a task that was not there.
 */
const cards = new Map<string, Promise<Card | null | undefined>>()
function cardOf(id: string): Promise<Card | null | undefined> {
  let hit = cards.get(id)
  if (!hit) {
    /* An id out of a body is what somebody wrote: only a uuid becomes part
       of an address, so `../../people` cannot steer the request. */
    if (!UUID.test(id)) return Promise.resolve(null)
    hit = api<{ card: Card }>(`/tasks/${id}/card`)
      .then((r) => r.card)
      .catch((e: unknown) => (e instanceof Refused && e.status === 404 ? null : undefined))
    cards.set(id, hit)
    // Read again after a minute: a card says where a task stands now.
    setTimeout(() => cards.delete(id), 60_000)
  }
  return hit
}

/*
 * A card says where its task stands now.
 *
 * It was read once and kept for a minute, so a task moved to Done while its
 * card sat in a room still said Doing until the page was loaded again. Each
 * card on the screen now listens for its task: read again when the project's
 * socket says the task changed (this tab's own changes included), when the
 * window comes back to the front, and every half-minute while it is looked
 * at — the last for a room outside any open project, whose socket says
 * nothing about tasks.
 */
const listening = new Map<string, Set<() => void>>()
export function taskChanged(id: string): void {
  cards.delete(id)
  for (const again of listening.get(id) ?? []) again()
}
let lastAll = 0
function freshenAll(): void {
  if (Date.now() - lastAll < 5000) return
  lastAll = Date.now()
  for (const id of listening.keys()) taskChanged(id)
}
if (typeof window !== 'undefined') {
  window.addEventListener('focus', freshenAll)
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && freshenAll())
  setInterval(() => document.visibilityState === 'visible' && listening.size > 0 && freshenAll(), 30_000)
}

/**
 * A task's card, kept where it stands now: read when asked for and again
 * whenever it is said to have changed — the listening a message's card
 * does, for a chip in a document.
 * `undefined` while it is read, `null` for a task the reader cannot see.
 */
export function useTaskCard(id: string | null): Card | null | undefined {
  const [card, setCard] = useState<Card | null | undefined>(undefined)
  useEffect(() => {
    if (!id) return setCard(undefined)
    let alive = true
    const read = () => void cardOf(id).then((c) => alive && setCard((was) => (c === undefined ? was : c)))
    read()
    const set = listening.get(id) ?? new Set()
    set.add(read)
    listening.set(id, set)
    return () => {
      alive = false
      set.delete(read)
      if (set.size === 0) listening.delete(id)
    }
  }, [id])
  return card
}

export type { Card as TaskCardData }

/** The tasks a body names, once each, in the order it names them. */
export function tasksIn(body: unknown): { id: string }[] {
  const out: { id: string }[] = []
  const walk = (n: unknown) => {
    if (!n || typeof n !== 'object') return
    const node = n as { type?: string; attrs?: { id?: unknown }; content?: unknown[] }
    if (node.type === 'taskref' && typeof node.attrs?.id === 'string' && !out.some((t) => t.id === node.attrs!.id)) {
      out.push({ id: node.attrs.id })
    }
    node.content?.forEach(walk)
  }
  walk(body)
  return out
}

export function TaskName({
  id,
  projectId,
  number,
  handle,
  title,
}: {
  id: string
  projectId: string | null
  number: unknown
  handle?: string | null
  title: string
}) {
  const doors = useContext(PersonDoorsContext)
  return (
    <button
      type="button"
      data-taskref={id}
      onClick={() => {
        /* A name written before its project was recorded asks the card,
           which knows — rather than opening a project called nothing,
           which was My tasks. */
        if (projectId) return doors?.openTask(projectId, id)
        void cardOf(id).then((c) => c && doors?.openTask(c.project_id, id))
      }}
      className="chat-taskref"
    >
      {handle ? `${handle}-` : '#'}
      {typeof number === 'number' ? number : ''} {title}
    </button>
  )
}

/** A document named in a message: its title, pressed to open it. */
export function DocName({ id, projectId, title }: { id: string; projectId: string | null; title: string }) {
  const doors = useContext(PersonDoorsContext)
  return (
    <button type="button" data-docref={id} onClick={() => projectId && doors?.openFile?.(projectId, id)} className="chat-taskref">
      <Icon name="doc" size={12} style={{ display: 'inline', verticalAlign: -1, marginRight: 4 }} />
      {/* Named without its title where the project does not have it. */}
      {title || FILE_DETAIL.privateDocument}
    </button>
  )
}

/** As the board writes a date: "18 Oct" — "18 oct." in French — the year
    only when it is not this one. */
function short(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return iso
  return `${dayMonth(new Date(y, m - 1, d))}${y === new Date().getFullYear() ? '' : ` ${String(y).slice(2)}`}`
}
const days = (since: string) => Math.floor((Date.now() - Date.parse(since)) / 86_400_000)

/**
 * The card the board draws, read-only — the same four bands: the handle
 * and who has it, the title, what is true about it as chips, and when.
 * One drawing of a task, wherever a task is drawn as a card.
 */
export function TaskCard({ id }: { id: string }) {
  const doors = useContext(PersonDoorsContext)
  const [card, setCard] = useState<Card | null | undefined>(undefined)
  useEffect(() => {
    let alive = true
    const read = () => void cardOf(id).then((c) => alive && setCard((was) => (c === undefined ? was : c)))
    read()
    /* And again whenever the task is said to have changed — the old card
       stays drawn until the new one is in. */
    const set = listening.get(id) ?? new Set()
    set.add(read)
    listening.set(id, set)
    return () => {
      alive = false
      set.delete(read)
      if (set.size === 0) listening.delete(id)
    }
  }, [id])

  /* The card's own height while it is read, so the message does not grow
     under the reader when it arrives. */
  if (card === undefined) return <div data-task-card className="h-[120px] w-full max-w-[440px]" />
  if (card === null) {
    return (
      <span data-task-card className="text-sm text-ink-3">
        {W.gone}
      </span>
    )
  }
  const today = todayHere()
  const faces =
    card.assignees ??
    (card.assignee_id ? [{ id: card.assignee_id, name: card.assignee_name ?? '', avatar_url: card.assignee_avatar_url }] : [])
  const chip = 'inline-flex h-6 shrink-0 items-center gap-1 px-2 text-sm'
  const edge = { color: 'var(--ink-2)', borderRadius: 'var(--r-pill)', boxShadow: 'inset 0 0 0 1px var(--line)' }
  return (
    <button
      type="button"
      data-task-card={card.id}
      onClick={() => doors?.openTask(card.project_id, card.id)}
      className="flex w-full max-w-[440px] flex-col px-4 py-3 text-left transition-[filter] mouse:hover:brightness-[0.98]"
      style={{ background: 'var(--said-card)', borderRadius: 'var(--r-card)', boxShadow: 'var(--card-shadow)' }}
    >
      <span className="flex items-start gap-2">
        <span
          data-id
          className="min-w-0 flex-1 truncate font-mono text-sm whitespace-nowrap text-ink-3"
          style={{ letterSpacing: 'var(--track-body)' }}
        >
          {card.project_key ? `${card.project_key}-${card.number}` : `#${card.number}`}
        </span>
        {faces.length > 0 && (
          /* Up to three, overlapping, each ringed in the card so the edge
             between two faces reads; a fourth is a number. */
          <span className="ml-auto flex shrink-0 items-center">
            {faces.slice(0, 3).map((a, i) => (
              <span
                key={a.id}
                className="rounded-full"
                style={{ marginLeft: i ? -4 : 0, boxShadow: i ? '0 0 0 2px var(--card)' : undefined }}
              >
                <Avatar id={a.id} name={a.name} url={a.avatar_url} size={20} />
              </span>
            ))}
            {faces.length > 3 && <span className="ml-1 text-xs tabular-nums text-ink-3">+{faces.length - 3}</span>}
          </span>
        )}
      </span>
      <span
        className="mt-1 block w-full text-base font-medium [overflow-wrap:anywhere] text-ink"
        style={{
          letterSpacing: 'var(--track-body)',
          textDecoration: card.completed_at ? 'line-through' : undefined,
        }}
      >
        {card.title}
      </span>
      {(card.priority || card.decided_at || card.due_on || card.cycle_name || card.labels.length > 0 || card.list_name) && (
        <span className="mt-2 flex flex-wrap items-center gap-1">
          {card.list_name && (
            <span className={chip} style={edge}>
              <Dot icon={card.list_icon} color={card.list_color} />
              {card.list_name}
            </span>
          )}
          {card.priority && (
            <span className={chip} style={edge}>
              <PriorityMark value={card.priority} size={14} />
            </span>
          )}
          {card.decided_at && days(card.decided_at) > 0 && (
            <span className={`${chip} tabular-nums`} style={edge}>
              {W.age(days(card.decided_at))}
            </span>
          )}
          {card.due_on && (
            <span
              className={`${chip} tabular-nums`}
              style={{ ...edge, color: !card.completed_at && card.due_on <= today ? 'var(--due)' : 'var(--ink-3)' }}
            >
              <Icon name="cal" size={14} />
              {short(card.due_on)}
            </span>
          )}
          {card.cycle_name && (
            <span className={chip} style={edge}>
              {card.cycle_name}
            </span>
          )}
          {card.labels.map((l) => (
            <LabelChip key={l.id} label={l} size={13} />
          ))}
        </span>
      )}
      <span className="mt-2 flex flex-wrap items-center gap-3 text-sm text-ink-3" style={{ letterSpacing: 'var(--track-body)' }}>
        {card.created_at && <span className="whitespace-nowrap">{W.created(short(card.created_at))}</span>}
        {card.decided_at && <span className="whitespace-nowrap">{W.updated(short(card.decided_at))}</span>}
      </span>
    </button>
  )
}
