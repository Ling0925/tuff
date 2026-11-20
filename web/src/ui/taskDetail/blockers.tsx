import { useRef, useState } from 'react'
import { api, Refused } from '../../data/api.js'
import { goTo, numbered } from '../../data/route.js'
import { TASK_DETAIL as W } from '../../words/taskDetail.js'
import { Dot, Hairline, Panel, SectionHead, notALogin } from '../kit.jsx'
import { Round } from './aside.jsx'
import { Icon } from '../glyphs.jsx'

/** One end of a relation, as `GET /api/tasks/:id` answers it. */
export type Related = {
  id: string
  number: number
  title: string
  project_id: string
  project_key: string
  project_slug?: string | null
  completed_at: string | null
  list_icon: string | null
  list_color?: string | null
}

type Found = { id: string; number: number; title: string; project_id: string; key: string }

/**
 * Blocked by and Blocks.
 *
 * Under the sub-tasks. Shut and empty, one quiet line, the way the sub-tasks
 * are; with any, a panel each. A blocker is added by finding it, the
 * palette's own search across every project this person can read, and is
 * drawn at once — taken away again if the server refuses. Blocks is read
 * here and changed on the other task's screen, whose edit it is.
 */
export function Blockers({
  taskId,
  blockedBy,
  blocks,
  canWrite,
  keyOf,
  onChange,
  onSettled,
  adding: held,
  onAdding,
  bare = false,
}: {
  taskId: string
  blockedBy: Related[]
  blocks: Related[]
  canWrite: boolean
  /** A project's key by its id, for the handles of what search finds. */
  keyOf: (projectId: string) => string | null
  /** What the screen now holds. */
  onChange: (next: Related[]) => void
  /** The server took it. */
  onSettled?: () => void
  /** Opened from outside — a button the screen sets beside Add a sub-task. */
  adding?: boolean | undefined
  onAdding?: (to: boolean) => void
  /** No button of its own while there is nothing yet: the screen draws it. */
  bare?: boolean
}) {
  const [own, setOwn] = useState(false)
  const adding = held ?? own
  const setAdding = (to: boolean) => {
    setOwn(to)
    onAdding?.(to)
  }
  const [text, setText] = useState('')
  const [found, setFound] = useState<Found[]>([])
  const [lit, setLit] = useState(0)
  const [trouble, setTrouble] = useState<string | null>(null)
  const asked = useRef(0)

  const look = (q: string) => {
    const mine = ++asked.current
    if (q.trim().length < 1) return setFound([])
    void api<{ results: { type: string; id: string; number: number | null; title: string | null; project_id: string | null }[] }>(
      `/search?q=${encodeURIComponent(q.trim())}&type=task`,
    )
      .then((r) => {
        if (mine !== asked.current) return
        const have = new Set([taskId, ...blockedBy.map((b) => b.id)])
        setFound(
          r.results
            .filter((x) => x.type === 'task' && x.number && x.project_id && !have.has(x.id))
            .slice(0, 6)
            .map((x) => ({
              id: x.id,
              number: x.number!,
              title: x.title ?? '',
              project_id: x.project_id!,
              key: keyOf(x.project_id!) ?? '',
            })),
        )
        setLit(0)
      })
      .catch(() => {})
  }

  const shut = () => {
    setAdding(false)
    setText('')
    setFound([])
    setTrouble(null)
  }

  async function add(f: Found) {
    setTrouble(null)
    const drawn: Related = {
      id: f.id,
      number: f.number,
      title: f.title,
      project_id: f.project_id,
      project_key: f.key,
      completed_at: null,
      list_icon: null,
    }
    const before = blockedBy
    onChange([...before, drawn])
    shut()
    try {
      const r = await api<{ blocker: Related }>(`/tasks/${taskId}/blocked-by`, { method: 'POST', body: JSON.stringify({ task_id: f.id }) })
      onChange([...before, r.blocker])
      onSettled?.()
    } catch (e) {
      onChange(before)
      setTrouble(e instanceof Refused && e.status === 409 ? W.blockerLoop : W.blockerFailed)
    }
  }

  async function remove(b: Related) {
    const before = blockedBy
    onChange(before.filter((x) => x.id !== b.id))
    try {
      await api(`/tasks/${taskId}/blocked-by/${b.id}`, { method: 'DELETE' })
      onSettled?.()
    } catch {
      onChange(before)
    }
  }

  const open = (r: Related) => {
    numbered([{ id: r.id, number: r.number }], r.project_id, 'task')
    goTo({ view: 'projects', projectId: r.project_id, tool: 'tasks', objectId: r.id })
  }

  const row = (r: Related, removable: boolean) => (
    <div data-related={r.id} className="group flex items-center gap-3 px-4 py-3">
      <Dot icon={r.list_icon} color={r.list_color} />
      <button
        type="button"
        data-open-related
        onClick={() => open(r)}
        className="flex min-w-px flex-1 items-center gap-3 text-left text-base"
        style={{ color: r.completed_at ? 'var(--ink-3)' : 'var(--ink)' }}
      >
        <span className="shrink-0 font-mono text-sm tabular-nums text-ink-3">
          {r.project_key}-{r.number}
        </span>
        <span className="min-w-px flex-1 truncate">{r.title}</span>
      </button>
      {removable && (
        <button
          type="button"
          data-remove-blocker
          aria-label={W.removeBlocker(`${r.project_key}-${r.number}`)}
          onClick={() => void remove(r)}
          className="flex size-6 shrink-0 items-center justify-center rounded-full text-ink-3 mouse:hover:bg-[var(--hover)] mouse:hover:text-ink"
        >
          <Icon name="close" size={14} />
        </button>
      )}
    </div>
  )

  const finder = adding && (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        const f = found[lit]
        if (f) void add(f)
      }}
    >
      <label
        className="flex h-9 min-w-px items-center gap-2 rounded-[var(--r-card)] px-3 bg-surface"
        style={{ boxShadow: 'inset 0 0 0 1px var(--line)' }}
      >
        <Icon name="search" size={14} className="text-ink-3" />
        <input
          {...notALogin}
          enterKeyHint="search"
          autoFocus
          data-testid="blocker-find"
          value={text}
          role="combobox"
          aria-expanded={found.length > 0}
          aria-label={W.findBlocker}
          placeholder={W.findBlocker}
          onChange={(e) => {
            setText(e.target.value)
            look(e.target.value)
          }}
          onBlur={() => {
            if (!text.trim()) shut()
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              e.stopPropagation()
              shut()
              return
            }
            if (!found.length) return
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setLit((i) => Math.min(i + 1, found.length - 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setLit((i) => Math.max(i - 1, 0))
            }
          }}
          className="h-full min-w-px flex-1 bg-transparent text-base outline-none placeholder:text-[var(--ink-3)]"
          style={{ color: 'var(--ink)' }}
        />
      </label>
      {found.length > 0 && (
        <div
          role="listbox"
          data-testid="blocker-found"
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
              /* Pressed before the field lets go, so the blur does not shut
                 the list out from under the press. */
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setLit(i)}
              onClick={() => void add(f)}
              className="flex w-full items-center gap-3 px-3 text-left text-base text-ink"
              style={{ height: 'var(--row-h)', background: i === lit ? 'var(--hover)' : 'transparent' }}
            >
              <span className="w-20 shrink-0 font-mono text-sm tabular-nums text-ink-3">
                {f.key}-{f.number}
              </span>
              <span className="min-w-px flex-1 truncate">{f.title}</span>
            </button>
          ))}
        </div>
      )}
      {text.trim().length > 0 && found.length === 0 && <span className="px-1 text-sm text-ink-3">{W.noTaskFound}</span>}
    </form>
  )

  if (blockedBy.length === 0 && blocks.length === 0 && !canWrite) return null
  /* Nothing to show and its button drawn elsewhere: no empty section to
     leave a gap in the column. */
  if (bare && !adding && blockedBy.length === 0 && blocks.length === 0 && !trouble) return null

  return (
    <section data-testid="blockers" className="flex shrink-0 flex-col gap-3">
      {blockedBy.length > 0 && (
        <>
          <div className="flex items-center justify-between">
            <SectionHead>{W.blockedBy}</SectionHead>
            {canWrite && <Round icon="plusThin" label={W.addBlocker} testId="add-blocker" on={adding} onPress={() => setAdding(!adding)} />}
          </div>
          <Panel>
            {blockedBy.map((b, i) => (
              <div key={b.id} className="contents">
                {i > 0 && <Hairline />}
                {row(b, canWrite)}
              </div>
            ))}
          </Panel>
        </>
      )}
      {finder}
      {blockedBy.length === 0 && canWrite && !adding && !bare && (
        <button
          type="button"
          data-testid="add-blocker"
          onClick={() => setAdding(true)}
          className="flex h-8 items-center gap-2 self-start rounded-[var(--r-row)] bg-[var(--track)] pr-3 pl-2 text-base transition-colors mouse:hover:bg-[var(--badge)] text-ink-2"
        >
          <Icon name="wait" size={16} />
          {W.addBlocker}
        </button>
      )}
      {trouble && (
        <span role="alert" className="px-1 text-sm text-danger">
          {trouble}
        </span>
      )}
      {blocks.length > 0 && (
        <>
          <SectionHead>{W.blocks}</SectionHead>
          <Panel>
            {blocks.map((b, i) => (
              <div key={b.id} className="contents">
                {i > 0 && <Hairline />}
                {row(b, false)}
              </div>
            ))}
          </Panel>
        </>
      )}
    </section>
  )
}
