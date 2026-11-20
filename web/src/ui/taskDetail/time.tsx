import { useState, useRef } from 'react'
import { SAYS } from '../../data/words.js'
import { TASK_DETAIL as W } from '../../words/taskDetail.js'
import { api } from '../../data/api.js'
import { writtenDay, HowLong, DateButton, notALogin } from '../kit.jsx'
import { Icon } from '../glyphs.jsx'
import { today, asHours } from '../../data/hours.js'
import { asTokens, asDollars, sumOf } from '../../data/spend.js'
import { type AiSpent, type Spent } from './model.js'

/**
 * Enough to answer "why is this like this", not enough to be the screen.
 *
 * Five was too few the moment a task had been worked on for a week: a label,
 * a move, a date and two saves of the body is five, and the move that
 * explains where it is had already scrolled off the end of a panel that does
 * not scroll. Twelve in a box of its own that does, so a long history is
 * readable here and the column below it does not move.
 */
export const SHOWN = 12

/**
 * The hours on this task: the total, what was written, and a line to write more.
 *
 * Its own hours and not its parts'. A parent showing the sum of its subtasks
 * shows a number nobody wrote, and the person who logged four on a part and
 * reads six here has to work out where the other two came from.
 */
export function Time({
  entries,
  projectId,
  taskId,
  meId,
  meName,
  canWrite,
  onSpent,
  onChanged,
  roomy = false,
  ai,
  onAi,
}: {
  /** In a phone's sheet: its controls on a ground and forty tall. */
  roomy?: boolean
  /** What AI tools reported spending on it, under the hours. */
  ai: AiSpent[]
  onAi: (update: (had: AiSpent[]) => AiSpent[]) => void
  entries: Spent[]
  projectId: string
  taskId: string
  meId: string
  meName: string
  canWrite: boolean
  /** The entries, changed on the screen before the server has them. */
  onSpent: (update: (had: Spent[]) => Spent[]) => void
  onChanged: () => Promise<void>
}) {
  /* Today, shown rather than implied. Empty, the control read `dd.mm.yyyy`
     beside the entries and looked like a row that had failed to fill in. */
  const [when, setWhen] = useState(today)
  const total = entries.reduce((n, e) => n + e.minutes, 0)
  /* Rows removed before their POST answered. */
  const droppedEarly = useRef(new Set<string>())

  /*
   * On the screen first, the server behind it — the rule every other write
   * here follows, and this one did not: it waited for the POST and then for
   * the whole task to be read again, two trips in a row to a server an ocean
   * away. The row drawn now is replaced by the server's when it answers; a
   * refusal takes it back out.
   */
  /* Whose entries are open — one person at a time. */
  const [opened, setOpened] = useState<string | null>(null)

  async function log(minutes: number) {
    const on = when || today()
    const temp = `pending:${Date.now()}`
    /* Where the server will put it: by day, the newest of a day last. */
    onSpent((had) =>
      [...had, { id: temp, actor_id: meId, actor_name: meName, minutes, spent_on: on, note: null }].sort((a, b) =>
        a.spent_on.localeCompare(b.spent_on),
      ),
    )
    setWhen(today())
    try {
      const r = await api<{ id: string }>('/time', {
        method: 'POST',
        body: JSON.stringify({
          project_id: projectId,
          object_type: 'task',
          object_id: taskId,
          minutes,
          spent_on: on,
        }),
      })
      /* Taken back while it was still on its way: it is taken back from
         the server too, now that there is an id to name. */
      if (droppedEarly.current.delete(temp)) void api(`/time/${r.id}`, { method: 'DELETE' }).catch(() => {})
      else onSpent((had) => had.map((e) => (e.id === temp ? { ...e, id: r.id } : e)))
    } catch {
      onSpent((had) => had.filter((e) => e.id !== temp))
    }
  }

  /* Changing one of your own: on the screen at once, put back if the
     server says no. */
  async function change(e: Spent, to: Partial<Pick<Spent, 'minutes' | 'spent_on' | 'note'>>) {
    if (e.id.startsWith('pending:')) return
    onSpent((had) => had.map((x) => (x.id === e.id ? { ...x, ...to } : x)).sort((a, b) => a.spent_on.localeCompare(b.spent_on)))
    try {
      await api(`/time/${e.id}`, { method: 'PATCH', body: JSON.stringify(to) })
    } catch {
      await onChanged()
    }
  }

  async function drop(e: Spent) {
    onSpent((had) => had.filter((x) => x.id !== e.id))
    try {
      if (e.id.startsWith('pending:')) droppedEarly.current.add(e.id)
      else await api(`/time/${e.id}`, { method: 'DELETE' })
    } catch {
      // Refused: what the server holds is what is true.
      await onChanged()
    }
  }

  return (
    <div className="flex flex-col" data-testid="task-time">
      <div className="flex items-center gap-3 px-4 py-3">
        <span className="flex-1 text-base text-ink-2">{SAYS.time}</span>
        <span data-testid="time-total" className="shrink-0 text-base" style={{ color: total ? 'var(--ink)' : 'var(--ink-3)' }}>
          {total ? asHours(total) : W.noTime}
        </span>
      </div>

      {/*
        Whose the hours are: a line a person with their sum, the most first,
        and their entries — each with its day, and theirs to take back —
        opened from it. Two lines of "45m Yuri" read as a list to add up in
        one's head; the sum is the answer to the question somebody opens
        this for.
      */}
      {(() => {
        const by = new Map<string, { name: string; minutes: number; rows: Spent[] }>()
        for (const e of entries) {
          const had = by.get(e.actor_id) ?? { name: e.actor_name, minutes: 0, rows: [] }
          had.minutes += e.minutes
          had.rows.push(e)
          by.set(e.actor_id, had)
        }
        return [...by.entries()]
          .sort((a, b) => b[1].minutes - a[1].minutes)
          .map(([id, p]) => {
            const open = opened === id
            return (
              <div key={id} data-time-person className="flex flex-col">
                <button
                  type="button"
                  data-testid="time-person"
                  aria-expanded={open}
                  onClick={() => setOpened(open ? null : id)}
                  className="flex items-center gap-2 px-4 py-2 text-left text-sm transition-colors mouse:hover:bg-[var(--hover)]"
                >
                  <Icon
                    name="chevR"
                    size={12}
                    className="text-ink-3"
                    style={{ transform: open ? 'rotate(90deg)' : undefined, transition: 'transform 200ms var(--ease-out)' }}
                  />
                  <span className="min-w-px flex-1 truncate text-ink-2">{p.name}</span>
                  <span className="shrink-0 tabular-nums text-ink">{asHours(p.minutes)}</span>
                </button>
                <div
                  aria-hidden={!open || undefined}
                  {...(!open ? { inert: '' as unknown as boolean } : {})}
                  className="grid transition-[grid-template-rows] duration-200 ease-[var(--ease-out)] motion-reduce:transition-none"
                  style={{ gridTemplateRows: open ? '1fr' : '0fr' }}
                >
                  <div className="min-h-0 overflow-hidden">
                    {p.rows.map((e) => (
                      <div key={e.id} data-entry data-row className="flex items-baseline gap-2 py-1 pr-4 pl-9 text-sm">
                        {e.actor_id === meId && canWrite ? (
                          /* Yours to change: another length picked from the
                             same menu, a note typed, another day picked. */
                          <>
                            <HowLong
                              testId="change-time"
                              said={W.changeHours(asHours(e.minutes))}
                              onPick={(minutes) => void change(e, { minutes })}
                              face={
                                <span data-control className="flex h-6 items-center rounded-[var(--r-field)] px-1 tabular-nums text-ink">
                                  {asHours(e.minutes)}
                                </span>
                              }
                            />
                            <NoteField note={e.note} onSave={(note) => void change(e, { note })} />
                            <DateButton
                              testId="change-time-day"
                              said={W.dayOfTheTime}
                              value={e.spent_on.slice(0, 10)}
                              clearable={false}
                              onPick={(to) => to && to !== e.spent_on.slice(0, 10) && void change(e, { spent_on: to })}
                              className="flex shrink-0 items-center tabular-nums"
                              style={{ color: 'var(--ink-3)' }}
                            >
                              {writtenDay(e.spent_on)}
                            </DateButton>
                          </>
                        ) : (
                          <>
                            <span className="shrink-0 tabular-nums text-ink">{asHours(e.minutes)}</span>
                            <span className="min-w-px flex-1 truncate text-ink-3">{e.note ?? ''}</span>
                            {/* The day with its month in words — `10-18` read as a code. */}
                            <span className="shrink-0 tabular-nums text-ink-3">{writtenDay(e.spent_on)}</span>
                          </>
                        )}
                        {/* Yours to take back. Somebody else's needs `time.any`,
                            which this screen does not know about — the server
                            decides. */}
                        {e.actor_id === meId && (
                          <button
                            data-control
                            data-testid="drop-time"
                            aria-label={W.removeHours(asHours(e.minutes))}
                            className={`flex shrink-0 items-center justify-center rounded-full ${
                              roomy ? 'size-10 text-lg' : 'size-4 text-xs'
                            } text-ink-3`}
                            style={{ ...(roomy ? { background: 'var(--track)' } : {}) }}
                            onClick={() => void drop(e)}
                          >
                            ×
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )
          })
      })()}

      {canWrite && (
        <div className="flex items-center gap-2 px-4 py-2">
          {/* Picked, not typed — and picking is the logging, so there is
              nothing to press afterwards. */}
          <HowLong testId="log-time" onPick={log} filled={roomy} />
          {/* The day it went into, today unless said otherwise — always
              one, so the calendar offers no Clear. */}
          <DateButton
            testId="log-time-day"
            said={W.dayOfTheTime}
            value={when}
            clearable={false}
            onPick={(to) => to && setWhen(to)}
            className={
              roomy
                ? 'ml-auto flex h-10 items-center rounded-[var(--r-row)] px-4 text-base tabular-nums'
                : 'ml-auto flex items-center text-sm tabular-nums'
            }
            style={{ color: 'var(--ink-2)', ...(roomy ? { background: 'var(--track)' } : {}) }}
          />
        </div>
      )}

      {ai.length > 0 && <AiUsage lines={ai} meId={meId} roomy={roomy} onAi={onAi} onChanged={onChanged} />}
    </div>
  )
}

/**
 * An entry's note, typed where it is read: kept on Enter or on leaving,
 * put back on Escape. Empty, it says what it is for.
 */
function NoteField({ note, onSave }: { note: string | null; onSave: (note: string | null) => void }) {
  const [text, setText] = useState(note ?? '')
  const [was, setWas] = useState(note)
  if (was !== note) {
    setWas(note)
    setText(note ?? '')
  }
  return (
    <input
      {...notALogin}
      data-testid="time-note"
      aria-label={W.noteOfTheTime}
      placeholder={W.addNote}
      value={text}
      maxLength={1000}
      onChange={(ev) => setText(ev.target.value)}
      onKeyDown={(ev) => {
        if (ev.key === 'Enter') ev.currentTarget.blur()
        if (ev.key === 'Escape') {
          ev.stopPropagation()
          setText(note ?? '')
          const field = ev.currentTarget
          requestAnimationFrame(() => field.blur())
        }
      }}
      onBlur={() => {
        const next = text.trim() || null
        if (next !== note) onSave(next)
      }}
      className="min-w-px flex-1 truncate bg-transparent text-ink-3 outline-none placeholder:text-[var(--ink-3)] placeholder:opacity-60 focus:text-ink"
    />
  )
}

/** `1.2M tokens · $4.80`, the cost left off when no client said one. */
const spendSaid = (tokens: number, cost: number | null | undefined) =>
  `${W.tokens(asTokens(tokens))}${cost != null ? ` · ${asDollars(cost)}` : ''}`

/**
 * What AI tools reported spending on this task, under its hours.
 * A total, then one line a tool — `Claude Code
 * 1.2M tokens · $4.80` — that opens who sent what. Its own and not its
 * parts', like the hours. Nothing to write here: the tool sends it.
 */
function AiUsage({
  lines,
  meId,
  roomy,
  onAi,
  onChanged,
}: {
  lines: AiSpent[]
  meId: string
  roomy: boolean
  onAi: (update: (had: AiSpent[]) => AiSpent[]) => void
  onChanged: () => Promise<void>
}) {
  const [opened, setOpened] = useState<string | null>(null)
  const total = sumOf(lines)
  const by = new Map<string, AiSpent[]>()
  for (const l of lines) by.set(l.client, [...(by.get(l.client) ?? []), l])

  async function drop(l: AiSpent) {
    onAi((had) => had.filter((x) => x.id !== l.id))
    try {
      await api(`/spend/${l.id}`, { method: 'DELETE' })
    } catch {
      // Refused: what the server holds is what is true.
      await onChanged()
    }
  }

  return (
    <div className="flex flex-col" data-testid="task-ai">
      <div className="flex items-center gap-3 px-4 pt-4 pb-2">
        <span className="flex-1 text-base text-ink-2">{W.aiUsage}</span>
        <span data-testid="ai-total" className="shrink-0 text-base tabular-nums text-ink">
          {spendSaid(total.tokens, total.cost)}
        </span>
      </div>
      {[...by.entries()]
        .map(([client, rows]) => ({ client, rows, sum: sumOf(rows) }))
        .sort((a, b) => b.sum.tokens - a.sum.tokens)
        .map(({ client, rows, sum }) => {
          const open = opened === client
          return (
            <div key={client} className="flex flex-col">
              <button
                type="button"
                data-testid="ai-client"
                aria-expanded={open}
                onClick={() => setOpened(open ? null : client)}
                className="flex items-center gap-2 px-4 py-2 text-left text-sm transition-colors mouse:hover:bg-[var(--hover)]"
              >
                <Icon
                  name="chevR"
                  size={12}
                  className="text-ink-3"
                  style={{ transform: open ? 'rotate(90deg)' : undefined, transition: 'transform 200ms var(--ease-out)' }}
                />
                <span className="min-w-px flex-1 truncate text-ink-2">{client}</span>
                <span className="shrink-0 tabular-nums text-ink">{spendSaid(sum.tokens, sum.cost)}</span>
              </button>
              <div
                aria-hidden={!open || undefined}
                {...(!open ? { inert: '' as unknown as boolean } : {})}
                className="grid transition-[grid-template-rows] duration-200 ease-[var(--ease-out)] motion-reduce:transition-none"
                style={{ gridTemplateRows: open ? '1fr' : '0fr' }}
              >
                <div className="min-h-0 overflow-hidden">
                  {rows.map((l) => (
                    <div
                      key={l.id}
                      data-ai-line
                      /* The model and the day on hover: in a panel this narrow, a
                         day on the line squeezed the name to its first letter. */
                      title={[l.model, l.created_at && writtenDay(l.created_at.slice(0, 10))].filter(Boolean).join(' · ') || undefined}
                      className="flex items-baseline gap-2 py-1 pr-4 pl-9 text-sm"
                    >
                      <span className="min-w-px flex-1 truncate text-ink-3">{l.actor_name ?? ''}</span>
                      <span className="shrink-0 tabular-nums text-ink">{spendSaid(l.tokens, l.cost_usd)}</span>
                      {l.actor_id === meId && (
                        <button
                          data-control
                          data-testid="drop-spend"
                          aria-label={W.removeSpend(spendSaid(l.tokens, l.cost_usd))}
                          className={`flex shrink-0 items-center justify-center rounded-full ${
                            roomy ? 'size-10 text-lg' : 'size-4 text-xs'
                          } text-ink-3`}
                          style={{ ...(roomy ? { background: 'var(--track)' } : {}) }}
                          onClick={() => void drop(l)}
                        >
                          ×
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )
        })}
    </div>
  )
}
