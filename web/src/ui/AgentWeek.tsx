import { useEffect, useRef, useState } from 'react'
import { api } from '../data/api.js'
import { recall, remember } from '../data/memory.js'
import { asDollars, asTokens } from '../data/spend.js'
import type { Event } from '../data/said.js'
import { MORE } from '../data/words.js'
import { AGENT_WEEK as W } from '../words/agentWeek.js'
import { Dot, Hairline, ProjectChip, Segments } from './kit.jsx'
import { EventRow } from './Activity.jsx'
import { short } from './MyTasks.jsx'

/*
 * What an agent did this week or this month, on its page in Members.
 * The tasks it took, finished and holds, the
 * questions it asked, what it spent, and its latest lines in the feed;
 * each number opens the tasks it counted.
 */

export type Period = 'week' | 'month'
export type Of = 'took' | 'finished' | 'open' | 'asked' | 'answered' | 'spend'

export type AgentWorkRead = {
  period: Period
  since: string
  took: number
  finished: number
  open: number
  asked: number
  answered: number
  tokens: number
  cost_usd: number | null
  spent_on: number
  events: Event[]
}

export type WorkTask = {
  id: string
  number: number | null
  title: string
  due_on: string | null
  completed_at: string | null
  project_id: string
  project_name: string
  project_key: string | null
  overdue: boolean | null
  icon: string | null
  color?: string | null
  tokens?: number | null
  cost_usd?: number | null
  questions?: number
}
type TasksRead = { tasks: WorkTask[]; next_cursor: string | null }

const workKey = (id: string, period: Period) => `agent-work:${id}:${period}`
const tasksKey = (id: string, period: Period, of: Of) => `agent-work-tasks:${id}:${period}:${of}`

/* Once per question per half minute: a pointer crossing the roster or the
   tiles is not a request for every one it passes. Opening asks again
   regardless — what was read ahead draws it, and this puts in what changed. */
const reading = new Map<string, { at: number; read: Promise<unknown> }>()
function once<T>(key: string, fresh: boolean, ask: () => Promise<T>): Promise<T> {
  const hit = reading.get(key)
  if (!fresh && hit && Date.now() - hit.at < 30_000) return hit.read as Promise<T>
  const read = ask()
  reading.set(key, { at: Date.now(), read })
  /* A refusal is not kept: the next pointer asks again. */
  read.catch(() => reading.delete(key))
  return read
}

/** An agent's week or month, read and kept — ahead, from its row in the roster. */
export function readAgentWork(id: string, period: Period, fresh = false): Promise<AgentWorkRead> {
  const key = workKey(id, period)
  return once(key, fresh, () => api<AgentWorkRead>(`/agents/${id}/work?period=${period}`).then((r) => remember(key, r)))
}

/** One number's first page of tasks, read and kept — ahead, under the pointer. */
export function readAgentTasks(id: string, period: Period, of: Of, fresh = false): Promise<TasksRead> {
  const key = tasksKey(id, period, of)
  return once(key, fresh, () => api<TasksRead>(`/agents/${id}/work/tasks?period=${period}&of=${of}`).then((r) => remember(key, r)))
}

/** How long a press waits for its list before drawing it without one — "Nothing jerks". */
const WAIT = 400

export function AgentWeek({
  agentId,
  onOpenTask,
  onOpenLine,
}: {
  agentId: string
  onOpenTask: (projectId: string, taskId: string) => void
  /** A line in the feed opens what it happened to, in its project. */
  onOpenLine: (projectId: string, tool: string, objectId: string) => void
}) {
  const [period, setPeriod] = useState<Period>('week')
  /* Opened on what was read ahead, and on the last answer while another is
     asked: switching to a month changes the numbers in place. */
  const [work, setWork] = useState<AgentWorkRead | null>(() => recall<AgentWorkRead>(workKey(agentId, 'week')))
  const [opened, setOpened] = useState<Of | null>(null)
  const [list, setList] = useState<(TasksRead & { of: Of; period: Period }) | null>(null)
  const [more, setMore] = useState(false)
  /* Which press is the latest, so an answer to an earlier one is dropped. */
  const asked = useRef(0)

  useEffect(() => {
    const kept = recall<AgentWorkRead>(workKey(agentId, period))
    if (kept) setWork(kept)
    let gone = false
    readAgentWork(agentId, period, true)
      .then((r) => !gone && setWork(r))
      .catch(() => {
        /* Not the reader's to see, or no connection: the block stays as it was. */
      })
    return () => {
      gone = true
    }
  }, [agentId, period])

  /* The list that is open follows the period: the same number, the other span. */
  // biome-ignore lint/correctness/useExhaustiveDependencies: the period is the trigger; a press opens its own list
  useEffect(() => {
    if (opened) void show(opened, true)
  }, [period])

  async function show(of: Of, keepOpen = false) {
    const n = ++asked.current
    const kept = recall<TasksRead>(tasksKey(agentId, period, of))
    if (kept) {
      setList({ ...kept, of, period })
      setOpened(of)
    }
    const read = readAgentTasks(agentId, period, of, Boolean(kept))
    if (!kept) {
      /* Drawn with its rows: wait for them a moment before drawing the
         frame at all, so a list is not a box that fills a beat later. */
      const first = await Promise.race([read.catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), WAIT))])
      if (n !== asked.current) return
      if (first) setList({ ...first, of, period })
      else if (!keepOpen) setList(null)
      setOpened(of)
    }
    const r = await read.catch(() => null)
    if (r && n === asked.current) setList({ ...r, of, period })
  }

  async function press(of: Of) {
    if (opened === of) {
      asked.current++
      setOpened(null)
      return
    }
    await show(of)
  }

  async function showMore() {
    if (!list?.next_cursor) return
    setMore(true)
    try {
      const r = await api<TasksRead>(
        `/agents/${agentId}/work/tasks?period=${list.period}&of=${list.of}&cursor=${encodeURIComponent(list.next_cursor)}`,
      )
      setList((had) => (had && had.of === list.of ? { ...had, tasks: [...had.tasks, ...r.tasks], next_cursor: r.next_cursor } : had))
    } finally {
      setMore(false)
    }
  }

  if (!work) return null
  const other: Period = period === 'week' ? 'month' : 'week'
  const tiles: { of: Of; n: string; label: string; also?: string | undefined }[] = [
    { of: 'took', n: String(work.took), label: W.took },
    { of: 'finished', n: String(work.finished), label: W.finished },
    { of: 'open', n: String(work.open), label: W.open },
    { of: 'asked', n: String(work.asked), label: W.questions, also: W.nAnswered(work.answered) },
    {
      of: 'spend',
      n: asTokens(work.tokens),
      label: W.tokens,
      also: work.cost_usd != null ? asDollars(work.cost_usd) : work.tokens > 0 ? W.noPrice : undefined,
    },
  ]
  const shown = opened && list && list.of === opened ? list : null

  return (
    /* A block of its own on the list's ground, as the stats above it are:
       its heading and the switch, the numbers on white under them. */
    <div className="mt-5 flex flex-col gap-1 p-1" data-agent-week style={{ background: 'var(--lane)', borderRadius: 'var(--r-card)' }}>
      <div className="flex h-10 items-center gap-2 pl-3">
        <span className="min-w-px flex-1 truncate text-base font-medium text-ink-2" style={{ letterSpacing: 'var(--track-body)' }}>
          {period === 'week' ? W.thisWeek : W.thisMonth}
        </span>
        {/* The other span read ahead under the pointer, so the switch
            changes the numbers in place rather than to nothing. */}
        <div onPointerEnter={() => void readAgentWork(agentId, other).catch(() => {})}>
          <Segments
            items={[
              { key: 'week' as const, label: W.week, testId: 'agent-week-week' },
              { key: 'month' as const, label: W.month, testId: 'agent-week-month' },
            ]}
            value={period}
            onPick={setPeriod}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-1 sm:grid-cols-5">
        {tiles.map((t) => (
          <button
            key={t.of}
            data-agent-tile={t.of}
            data-on={opened === t.of || undefined}
            aria-expanded={opened === t.of}
            aria-label={W.tile(t.label, t.n)}
            onPointerEnter={() => void readAgentTasks(agentId, period, t.of).catch(() => {})}
            onFocus={() => void readAgentTasks(agentId, period, t.of).catch(() => {})}
            onClick={() => void press(t.of)}
            className="flex flex-col items-start gap-1 px-4 py-3 text-left transition-[background-color,transform] duration-150 ease-[var(--ease-out)] active:scale-[0.98] mouse:hover:bg-[var(--hover)]"
            style={{
              background: opened === t.of ? 'var(--hover)' : 'var(--card)',
              borderRadius: 'calc(var(--r-card) - 4px)',
            }}
          >
            <span className="text-title font-medium tabular-nums text-ink" data-n>
              {t.n}
            </span>
            {/* One line, whatever the number: the tiles keep one height. */}
            <span className="w-full truncate text-sm text-ink-3">
              {t.label}
              {t.also && ` · ${t.also}`}
            </span>
          </button>
        ))}
      </div>

      {opened && (
        <div
          data-agent-week-list={opened}
          className="flex flex-col overflow-hidden transition-opacity duration-200 ease-[var(--ease-out)] starting:opacity-0 motion-reduce:transition-none"
          style={{ background: 'var(--card)', borderRadius: 'calc(var(--r-card) - 4px)' }}
        >
          {shown && shown.tasks.length === 0 && <p className="px-4 py-3 text-sm text-ink-3">{W.noTasks}</p>}
          {shown?.tasks.map((t, i) => (
            <div key={t.id} className="contents">
              {i > 0 && <Hairline inset={14} />}
              <WorkRow t={t} of={shown.of} onOpen={onOpenTask} />
            </div>
          ))}
          {shown?.next_cursor && (
            <button
              data-testid="agent-week-more"
              disabled={more}
              onClick={() => void showMore()}
              className="mx-auto my-1 flex h-8 shrink-0 items-center px-3 text-base font-medium text-accent"
              style={{ borderRadius: 'var(--r-pill)' }}
              data-control
            >
              {more ? MORE.loading : W.showMore}
            </button>
          )}
        </div>
      )}

      {/* Its latest lines in the period, as Activity draws them. */}
      <div
        className="flex flex-col overflow-hidden"
        data-agent-latest
        style={{ background: 'var(--card)', borderRadius: 'calc(var(--r-card) - 4px)' }}
      >
        <span className="px-4 pt-3 pb-1 text-sm text-ink-2">{W.latest}</span>
        {work.events.length === 0 ? (
          <p className="px-4 pb-3 text-sm text-ink-3">{period === 'week' ? W.nothingThisWeek : W.nothingThisMonth}</p>
        ) : (
          work.events.map((e, i) => (
            <EventRow
              key={e.id}
              e={e}
              first={i === 0}
              dated
              onOpen={(tool, objectId) => {
                if (e.project_id) onOpenLine(e.project_id, tool, objectId)
              }}
            />
          ))
        )}
      </div>
    </div>
  )
}

/** One task a number counted: the row *On it* draws, with what this number says of it. */
function WorkRow({ t, of, onOpen }: { t: WorkTask; of: Of; onOpen: (projectId: string, taskId: string) => void }) {
  const said =
    of === 'spend'
      ? `${asTokens(t.tokens ?? 0)}${t.cost_usd != null ? ` · ${asDollars(t.cost_usd)}` : ''}`
      : of === 'asked' || of === 'answered'
        ? W.nQuestions(t.questions ?? 1)
        : of === 'finished' && t.completed_at
          ? short(t.completed_at.slice(0, 10))
          : t.due_on
            ? short(t.due_on)
            : ''
  return (
    <div
      data-agent-week-task={t.id}
      data-row
      onClick={(e) => {
        if ((e.target as Element).closest('button,a')) return
        onOpen(t.project_id, t.id)
      }}
      className="flex items-center gap-3 py-3 pr-4"
      style={{ paddingLeft: 16 }}
    >
      <span className="flex size-5 shrink-0 items-center justify-center">
        <Dot icon={t.icon} color={t.color} />
      </span>
      <button data-open-work onClick={() => onOpen(t.project_id, t.id)} className="min-w-px flex-1 truncate text-left text-base text-ink">
        {t.title}
      </button>
      <span className="w-[74px] shrink-0 font-mono text-sm max-sm:hidden text-ink-3">
        {t.project_key}-{t.number}
      </span>
      <span
        className="shrink-0 text-base tabular-nums"
        style={{ color: of !== 'spend' && of !== 'finished' && t.overdue ? 'var(--due)' : 'var(--ink-3)' }}
      >
        {said}
      </span>
      <span className="flex w-[150px] shrink-0 items-center overflow-hidden max-sm:hidden">
        <ProjectChip id={t.project_id} name={t.project_name} />
      </span>
    </div>
  )
}
