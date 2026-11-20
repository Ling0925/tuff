import { useState, useRef } from 'react'
import { TASK_DETAIL as W } from '../../words/taskDetail.js'
import { api } from '../../data/api.js'
import { acceptInto, declineInto } from '../../data/triage.js'
import { type Placed, Button, notALogin } from '../kit.jsx'
import { Icon } from '../glyphs.jsx'

/** How long a side panel takes to arrive. Shorter than the list's view
    panel: this one is a fade of a few pixels, not a width travelling, and
    at the view's 240 it read as waiting for the panel. */
export const QUICK = 160

const ASIDE_KEY = 'task-aside'

export function readAside(): 'history' | 'time' | null {
  try {
    const v = localStorage.getItem(ASIDE_KEY)
    return v === 'history' || v === 'time' ? v : null
  } catch {
    // Private window, blocked storage: shut is the default anyway.
    return null
  }
}

export function keepAside(to: 'history' | 'time' | null): void {
  try {
    localStorage.setItem(ASIDE_KEY, to ?? '')
  } catch {
    // Nothing to do and nothing to say: the panel still opened.
  }
}

/* The branch a task is worked on, as Linear names it: the person, the
   handle, then the title in lower case. The
   server names it the same way (`github.ts`). */
export function branchName(who: string, key: string, number: number, title: string): string {
  const words = title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '')
  const person = who.toLowerCase().replace(/[^a-z0-9-]+/g, '')
  return `${person ? `${person}/` : ''}${key.toLowerCase()}-${number}${words ? `-${words}` : ''}`
}

/** Words as a comment's body. */
export const said = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })

/**
 * A task in Triage: accept it, decline it with a reason, or fold it into the
 * task it repeats. Accepted, it goes to the first
 * list after Triage; declined or a duplicate, to the first list that
 * finishes and is not done.
 */
export function Triage({
  lists,
  projectId,
  projectKey,
  taskId,
  number,
  onMove,
  start = null,
}: {
  lists: Placed[]
  projectId: string
  projectKey: string
  taskId: string
  number: number
  onMove: (into: string) => Promise<void>
  /** Opened from the list's menu with Duplicate pressed already. */
  start?: 'duplicate' | null
}) {
  const [asking, setAsking] = useState<'decline' | 'duplicate' | null>(start)
  const [text, setText] = useState('')
  const [trouble, setTrouble] = useState<string | null>(null)
  /* The tasks it might repeat, found as it is typed — by its words or its
     number, the palette's own search, in this project only. */
  type Found = { id: string; number: number; title: string }
  const [found, setFound] = useState<Found[]>([])
  const [chosen, setChosen] = useState<Found | null>(null)
  const [lit, setLit] = useState(0)
  const asked = useRef(0)
  const look = (q: string) => {
    const mine = ++asked.current
    if (q.trim().length < 1) return setFound([])
    void api<{ results: { type: string; id: string; number: number; title: string }[] }>(
      `/search?q=${encodeURIComponent(q.trim())}&type=task&project=${projectId}`,
    )
      .then((r) => {
        if (mine !== asked.current) return
        setFound(r.results.filter((x) => x.type === 'task' && x.id !== taskId).slice(0, 6))
        setLit(0)
      })
      .catch(() => {})
  }
  const accept = acceptInto(lists)
  const stopping = () => declineInto(projectId, lists)
  const comment = (on: string, words: string) =>
    api(`/tasks/${on}/comments`, { method: 'POST', body: JSON.stringify({ body: said(words) }) })

  /*
   * The move first, as every write here is: the task leaves Triage the
   * moment it is pressed. The words follow, and a word refused — somebody
   * who may move a task but not comment on it — is said, not lost, and the
   * move is not undone for it.
   */
  async function finish() {
    setTrouble(null)
    const words = text.trim()
    if (asking === 'decline') {
      const to = await stopping()
      if (!to) return setTrouble(W.triageNotSaid)
      void onMove(to)
      /* Said as the decision it is, so a month later the task in Canceled
         says why it is there — and that somebody decided it, reason or not. */
      await comment(taskId, words ? W.triageDeclinedBecause(words) : W.triageDeclined).catch(() => setTrouble(W.triageNotSaid))
      return
    }
    /* Enter on the field: the one lit in the list. */
    return finishWith(chosen ?? found[lit] ?? null)
  }

  async function finishWith(it: Found | null) {
    if (!it || it.id === taskId) return setTrouble(W.triageWhichOne)
    const to = await stopping()
    if (!to) return setTrouble(W.triageNotSaid)
    void onMove(to)
    await Promise.all([
      comment(taskId, W.triageDuplicateOf(`${projectKey}-${it.number}`)),
      comment(it.id, W.triageFoldedIn(`${projectKey}-${number}`)),
    ]).catch(() => setTrouble(W.triageNotSaid))
  }

  const open = (which: 'decline' | 'duplicate') => {
    setAsking(asking === which ? null : which)
    setText('')
    setTrouble(null)
    setFound([])
    setChosen(null)
  }
  /* The whole style when given, since a style replaces the button's own;
     nothing when not, so the button keeps it. */
  const pressed = (which: 'decline' | 'duplicate') =>
    asking === which ? { style: { height: 'var(--control-h)', background: 'var(--track)', color: 'var(--ink)' } } : {}

  return (
    <div
      data-testid="triage"
      className="mt-4 flex flex-col overflow-hidden rounded-[16px] bg-sunken"
      /* Flat, as a content surface is: the words and the buttons say what
         state the task is in. */
    >
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <span className="flex min-w-px flex-1 flex-col">
          <span className="text-base font-medium text-ink">{W.triageHead}</span>
          <span className="text-sm text-ink-2">{W.triageWaits}</span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <Button data-testid="triage-decline" aria-expanded={asking === 'decline'} onClick={() => open('decline')} {...pressed('decline')}>
            <Icon name="close" size={14} />
            {W.triageDecline}
          </Button>
          <Button
            data-testid="triage-duplicate"
            aria-expanded={asking === 'duplicate'}
            onClick={() => open('duplicate')}
            {...pressed('duplicate')}
          >
            <Icon name="copy" size={14} />
            {W.triageDuplicate}
          </Button>
          {accept && (
            <Button tone="primary" data-testid="triage-accept" onClick={() => void onMove(accept)}>
              <Icon name="check" size={14} />
              {W.triageAccept}
            </Button>
          )}
        </span>
      </div>
      {asking && (
        <form
          className="flex flex-col gap-2 px-4 pb-4"
          onSubmit={(e) => {
            e.preventDefault()
            void finish()
          }}
        >
          <div className="flex items-center gap-2">
            <label
              className="flex h-9 min-w-px flex-1 items-center gap-2 rounded-[var(--r-tile)] px-3 bg-surface"
              style={{ boxShadow: 'inset 0 0 0 1px var(--line)' }}
            >
              {asking === 'duplicate' && <Icon name="search" size={14} className="text-ink-3" />}
              <input
                {...notALogin}
                autoFocus
                data-testid="triage-text"
                value={text}
                onChange={(e) => {
                  setText(e.target.value)
                  setChosen(null)
                  if (asking === 'duplicate') look(e.target.value)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.preventDefault()
                    setAsking(null)
                    return
                  }
                  if (asking !== 'duplicate' || !found.length) return
                  if (e.key === 'ArrowDown') {
                    e.preventDefault()
                    setLit((i) => Math.min(i + 1, found.length - 1))
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault()
                    setLit((i) => Math.max(i - 1, 0))
                  }
                }}
                role={asking === 'duplicate' ? 'combobox' : undefined}
                aria-expanded={asking === 'duplicate' ? found.length > 0 : undefined}
                placeholder={asking === 'decline' ? W.triageWhy : W.triageFind}
                aria-label={asking === 'decline' ? W.triageWhy : W.triageWhichOne}
                className="h-full min-w-px flex-1 bg-transparent text-base outline-none placeholder:text-[var(--ink-3)]"
                style={{ color: 'var(--ink)' }}
              />
            </label>
            {/* A reason is confirmed by a press; a duplicate by picking it. */}
            {asking === 'decline' && (
              <Button type="submit" data-testid="triage-confirm">
                {W.triageDecline}
              </Button>
            )}
          </div>
          {asking === 'duplicate' && found.length > 0 && (
            <div
              role="listbox"
              data-testid="triage-found"
              data-menu
              className="flex flex-col overflow-hidden rounded-[var(--r-card)] py-1 bg-surface"
              style={{ boxShadow: 'inset 0 0 0 1px var(--line)' }}
            >
              {found.map((f, i) => (
                <button
                  key={f.id}
                  type="button"
                  role="option"
                  aria-selected={i === lit}
                  data-row
                  onMouseEnter={() => setLit(i)}
                  onClick={() => {
                    setChosen(f)
                    setLit(i)
                    void finishWith(f)
                  }}
                  className="flex w-full items-center gap-3 px-3 text-left text-base text-ink"
                  style={{ height: 'var(--row-h)', background: i === lit ? 'var(--hover)' : 'transparent' }}
                >
                  <span className="w-16 shrink-0 tabular-nums text-sm text-ink-3">
                    {projectKey}-{f.number}
                  </span>
                  <span className="min-w-px flex-1 truncate">{f.title}</span>
                  {i === lit && <span className="shrink-0 text-xs text-ink-3">{W.triageMarkAs}</span>}
                </button>
              ))}
            </div>
          )}
          {trouble && <span className="text-sm text-danger">{trouble}</span>}
        </form>
      )}
    </div>
  )
}
