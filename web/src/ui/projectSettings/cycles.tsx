import { useState, useEffect } from 'react'
import { MORE, now, MAKE } from '../../data/words.js'
import { PROJECT_SETTINGS as W } from '../../words/projectSettings.js'
import { api, stored } from '../../data/api.js'
import { Icon } from '../icons.jsx'
import { DateButton, RowActions, notALogin } from '../kit.jsx'
import { today as todayHere, daysAfter } from '../../data/calendar.js'
import { type Cycle } from '../ProjectSettings.jsx'

/**
 * The project itself, rather than what is in it.
 *
 * Not a fifth tool: tools are what a project contains and this is about the
 * container. It sits apart from them for the same reason the workspace's own
 * settings sit at the bottom of the sidebar.
 */
/**
 * One sprint, changed where it is listed: its name typed over, its dates
 * picked, and a way to take it away — asked first when tasks are in it, and
 * saying what happens to them: they stay, out of any sprint.
 */
export function CycleRow({ cycle, onChanged }: { cycle: Cycle; onChanged: () => Promise<void> }) {
  const [name, setName] = useState(cycle.name)
  const [asking, setAsking] = useState(false)
  const [said, setSaid] = useState<string | null>(null)
  useEffect(() => setName(cycle.name), [cycle.name])

  async function patch(body: Record<string, string>) {
    try {
      await api(`/cycles/${cycle.id}`, { method: 'PATCH', body: JSON.stringify(body) })
      setSaid(null)
    } catch {
      setSaid(W.endBeforeStart)
    }
    await onChanged()
  }
  async function remove() {
    await api(`/cycles/${cycle.id}`, { method: 'DELETE' })
    await onChanged()
  }

  return (
    <div className="group flex flex-col gap-1 px-4 py-2" data-cycle={cycle.id}>
      <div className="flex items-center gap-3">
        <input
          {...notALogin}
          data-cycle-name
          aria-label={W.nameOf(cycle.name)}
          value={name}
          maxLength={200}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          onBlur={(e) => {
            const next = e.target.value.trim()
            if (!next || next === cycle.name) return setName(cycle.name)
            void patch({ name: next })
          }}
          className="h-7 min-w-0 flex-1 bg-transparent text-base outline-none text-ink"
        />
        <DateButton
          testId="cycle-starts"
          said={W.startOf(cycle.name)}
          value={cycle.starts_on}
          clearable={false}
          onPick={(on) => on && void patch({ starts_on: on })}
          className="flex h-7 shrink-0 items-center text-sm tabular-nums"
          style={{ color: 'var(--ink-2)' }}
        />
        <DateButton
          testId="cycle-ends"
          said={W.endOf(cycle.name)}
          value={cycle.ends_on}
          clearable={false}
          onPick={(on) => on && void patch({ ends_on: on })}
          className="flex h-7 shrink-0 items-center text-sm tabular-nums"
          style={{ color: 'var(--ink-2)' }}
        />
        {/* How many are in it, the way a list says so. */}
        <span className="w-14 shrink-0 text-right text-sm tabular-nums text-ink-3">{W.tasks(cycle.tasks)}</span>
        <RowActions>
          {asking ? (
            <span className="flex items-center gap-3">
              <button data-testid="delete-cycle-yes" onClick={() => void remove()} className="text-sm text-danger">
                {W.removeKeepTasks}
              </button>
              <button onClick={() => setAsking(false)} className="text-sm text-ink-3">
                {MORE.cancel}
              </button>
            </span>
          ) : (
            <button
              data-testid="delete-cycle"
              onClick={() => (cycle.tasks > 0 ? setAsking(true) : void remove())}
              className="text-sm text-ink-3"
            >
              {MORE.remove}
            </button>
          )}
        </RowActions>
      </div>
      {said && <p className="text-sm text-danger">{said}</p>}
    </div>
  )
}

/**
 * A name and two dates, which is the whole of a cycle.
 *
 * A row rather than a dialog, like the one that adds a list: making three
 * sprints in a row should be typing, not three trips through a modal. The
 * dates default to a fortnight from today, because that is the commonest
 * answer and a form that starts empty makes somebody do arithmetic to
 * agree with it.
 */
export function NewCycle({ projectId, onMade }: { projectId: string; onMade: () => Promise<void> }) {
  const today = todayHere()
  const fortnight = daysAfter(today, 13)
  const [name, setName] = useState('')
  const [from, setFrom] = useState(today)
  const [to, setTo] = useState(fortnight)
  const [said, setSaid] = useState<string | null>(null)

  async function make() {
    const title = name.trim()
    if (!title) return
    const r = await fetch(`/api/projects/${projectId}/cycles`, {
      method: 'POST',
      headers: {
        'x-api-version': '1',
        'x-tongue': now,
        'content-type': 'application/json',
        authorization: `Bearer ${stored()?.access_token ?? ''}`,
      },
      body: JSON.stringify({ name: title, starts_on: from, ends_on: to }),
    })
    if (!r.ok) {
      const body = (await r.json().catch(() => null)) as { error?: { message?: string } } | null
      setSaid(body?.error?.message ?? W.couldNotAddSprint)
      return
    }
    setSaid(null)
    setName('')
    await onMade()
  }

  /*
   * Said as the way to add one, the way Add a list and Add a label are —
   * a plus and the words in the accent — not as a row that looked like a
   * sprint called "Sprint 14" with dates beside it. The dates and the
   * button come once there is a name, each said for what it is.
   */
  const named = name.trim().length > 0
  return (
    <div className="flex flex-col gap-2 px-4 py-2">
      <div className="flex flex-wrap items-center gap-3">
        <Icon name="plusThin" size={14} className="text-accent" />
        <input
          {...notALogin}
          data-testid="cycle-name"
          value={name}
          placeholder={MAKE.cycleExample}
          aria-label={W.sprintName}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void make()
          }}
          className="h-9 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-[var(--accent)]"
          style={{ color: 'var(--ink)', letterSpacing: 'var(--track-body)' }}
        />
        {named && (
          <span className="flex shrink-0 items-center gap-3 text-sm transition-opacity duration-150 starting:opacity-0">
            <span className="flex items-center gap-1 text-ink-3">
              {W.starts}
              <DateButton
                testId="cycle-from"
                said={W.sprintStarts}
                value={from || null}
                clearable={false}
                onPick={(on) => on && setFrom(on)}
                className="flex h-7 shrink-0 items-center rounded-[var(--r-row)] px-2 tabular-nums mouse:hover:bg-[var(--hover)]"
                style={{ color: 'var(--ink)' }}
              />
            </span>
            <span className="flex items-center gap-1 text-ink-3">
              {W.ends}
              <DateButton
                testId="cycle-to"
                said={W.sprintEnds}
                value={to || null}
                clearable={false}
                onPick={(on) => on && setTo(on)}
                className="flex h-7 shrink-0 items-center rounded-[var(--r-row)] px-2 tabular-nums mouse:hover:bg-[var(--hover)]"
                style={{ color: 'var(--ink)' }}
              />
            </span>
            <button
              data-testid="add-cycle"
              data-control
              onClick={() => void make()}
              className="inline-flex h-7 shrink-0 items-center rounded-full px-4 text-sm font-medium bg-accent text-on-accent"
            >
              {MORE.addCycle}
            </button>
          </span>
        )}
      </div>
      {said && <p className="text-sm text-danger">{said}</p>}
    </div>
  )
}
