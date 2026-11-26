import { useCallback } from 'react'
import type { PersonInWorkspace } from '@tracker/shared-schema'
import { MAKE } from '../../data/words.js'
import { TASKS as W } from '../../words/tasks.js'
import { useWorkingOf } from '../../data/working.js'
import { columnAt, useBoardDrag, type Spot } from '../useDrag.js'
import { Avatar, Fluid, doingSaid, whoOf } from '../kit.jsx'
import { Icon } from '../glyphs.jsx'
import { NewButton, type What } from '../New.jsx'
import { type Task, type List, given } from './model.jsx'
import { ViewPanel } from './view.jsx'
import { ListBar } from './listBar.jsx'
import { BoardCard, BoardBar, ColumnFade, type CardFns } from './board.jsx'
import { type TasksProps } from '../Tasks.jsx'
import { type TaskData } from './useTaskData.js'
import { type ListShape } from './useListShape.js'
import { type ColumnPanes } from './useColumnPanes.js'
import { type BoardMoves } from './useBoardMoves.js'
import { type CardRenderer } from './cardRenderer.jsx'
import { type TaskKeys } from './useTaskKeys.js'

/**
 * One assignee's column: who, and the open work on them.
 */
export type PersonColumn = {
  /** The actor's id; `~` for nobody, `?` for people no longer on the project. */
  key: string
  person: Member | null
  /** Their open tasks, in the board's order: list by list, then as each list orders them. */
  open: Task[]
  /** How many of their tasks are in a list that finishes them. */
  done: number
}

type Member = TaskData['people'][number] & Pick<PersonInWorkspace, 'agent' | 'avatar_url'>

export const NOBODY = '~'
export const GONE = '?'

/** What the drag calls a card: its column and its task, since one task can stand in two. */
const slotOf = (column: string, task: string) => `${column}/${task}`
const partsOf = (slot: string) => {
  const at = slot.lastIndexOf('/')
  return { column: slot.slice(0, at), task: slot.slice(at + 1) }
}

/**
 * The columns, from what the board already holds.
 *
 * `byColumn` is the board's: narrowed by whose and by labels, and each list
 * in the order asked for — so a column cannot hold a task the board or the
 * list would leave out. A task given to two people is in both columns; one
 * given to nobody is in No assignee, which is always there and always last,
 * because it is where a card goes to be given to nobody. Whose narrows the
 * columns too: "mine" is my column, not every column that shares a task
 * with me.
 *
 * In the project's order of people (people first, the agents under them,
 * each by name), never by how much they hold: a column does not change
 * places because somebody finished a task.
 */
export function personColumns({
  lists,
  byColumn,
  people,
  who,
  meId,
}: {
  lists: List[]
  byColumn: Map<string, Task[]>
  people: Member[]
  who: string
  meId: string
}): PersonColumn[] {
  const known = new Map(people.map((p, at) => [p.actor_id, at]))
  const columns = new Map<string, PersonColumn>()
  const columnOf = (key: string): PersonColumn => {
    let c = columns.get(key)
    if (!c) {
      const at = known.get(key)
      c = { key, person: at === undefined ? null : people[at]!, open: [], done: 0 }
      columns.set(key, c)
    }
    return c
  }
  for (const l of lists) {
    for (const t of byColumn.get(l.id) ?? []) {
      const ids = whoOf(t)
      const here = ids.filter((id) => known.has(id))
      const keys = ids.length === 0 ? [NOBODY] : here.length > 0 ? here : [GONE]
      for (const k of keys) {
        const c = columnOf(k)
        if (l.finishes) c.done++
        else c.open.push(t)
      }
    }
  }
  const only = who === 'all' ? null : who === 'mine' ? meId : who === 'none' ? NOBODY : who
  const rank = (k: string) => known.get(k) ?? (k === GONE ? people.length : people.length + 1)
  const shown = [...columns.values()].filter((c) => c.key !== NOBODY && c.open.length > 0 && (only === null || c.key === only))
  return [...shown.sort((a, b) => rank(a.key) - rank(b.key)), columns.get(NOBODY) ?? { key: NOBODY, person: null, open: [], done: 0 }]
}

/** Every open task once, in the order the columns draw them — what ← and → page through. */
export function peopleWalk(columns: PersonColumn[]): Task[] {
  const seen = new Set<string>()
  const out: Task[] = []
  for (const c of columns)
    for (const t of c.open)
      if (!seen.has(t.id)) {
        seen.add(t.id)
        out.push(t)
      }
  return out
}

/**
 * Who a task is given to once its card is carried from one column to
 * another: the column it left is taken off, the one it landed in is put on,
 * and everybody else on it stays. Already on it, the one it landed in is
 * not added twice. Left from Not on this project, every one of those people
 * is taken off — that column is all of them.
 */
export function reassigned(was: string[], from: string, to: string, known: Set<string>): string[] {
  let next = from === GONE ? was.filter((id) => known.has(id)) : was.filter((id) => id !== from)
  if (to !== NOBODY && to !== GONE && !next.includes(to)) next = [...next, to]
  return next
}

/**
 * Carrying a card to another person — the board's drag, with a different
 * drop.
 *
 * The board's machinery picks the card up, follows the pointer, scrolls the
 * board at its edges and flies the copy home; what is different is the
 * question a drop answers. On the board it is which list and where in it;
 * here it is only whose. Where in a column is not anybody's to choose — a
 * column is in the lists' order — so the card's own slot stays open while it
 * is carried, the column under the pointer lights as a whole, and a card let
 * go in its own column simply goes back.
 *
 * Through the same `PATCH` the face's picker sends, optimistic: the card is
 * in its new column before the server answers, and a refusal puts it back
 * (`patch`). One step on ⌘Z's history, beside the board's moves.
 */
export function usePeopleMoves({
  canWrite,
  tasks,
  patch,
  undone,
  people,
}: Pick<TasksProps, 'canWrite'> & Pick<TaskData, 'tasks' | 'patch' | 'people'> & Pick<BoardMoves, 'undone'>) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: board is a ref, read when the pointer moves
  const resolve = useCallback((x: number, y: number, id: string): Spot | null => {
    const column = columnAt(board.current, x, y)
    if (!column) return null
    const pane = column.querySelector('[data-column-scroll]')
    const slots = [...(pane?.children ?? [])].filter((n): n is HTMLElement => n instanceof HTMLElement && n.dataset.slot !== undefined)
    const at = slots.findIndex((s) => s.dataset.slot === id)
    return { column: column.dataset.list!, index: at === -1 ? 0 : at }
  }, [])
  const commit = useCallback(
    (id: string, spot: Spot) => {
      const { column: from, task } = partsOf(id)
      if (spot.column === from || spot.column === GONE) return
      const t = tasks?.find((x) => x.id === task)
      if (!t) return
      const was = whoOf(t)
      const next = reassigned(was, from, spot.column, new Set(people.map((p) => p.actor_id)))
      if (next.join() === was.join()) return
      undone.current.push({ kind: 'assign', id: task, before: was })
      void patch(task, given(next), given(next))
    },
    [tasks, patch, undone, people],
  )
  const { drag, board, layer, handlers } = useBoardDrag({ enabled: canWrite, resolve, onDrop: commit })
  return { drag, board, layer, handlers } as const
}
export type PeopleMoves = ReturnType<typeof usePeopleMoves>

/**
 * The tasks as people: the board, with a column for each assignee instead
 * of each list. On a desk only — the option is not offered under 1024 and
 * `?view=members` draws the list there.
 */
export function peopleView({
  projectId,
  canMake,
  view,
  wide,
  panel,
  shows,
  setShows,
  people,
  lists,
  load,
  group,
  sort,
  dir,
  who,
  list,
  labels,
  meId,
  onNavigate,
  allLabels,
  columns,
  columnPane,
  taken,
  look,
  partsSaid,
  card,
  fns,
  moves,
}: Pick<TasksProps, 'projectId' | 'canMake' | 'group' | 'sort' | 'dir' | 'who' | 'list' | 'onNavigate' | 'meId'> &
  Required<Pick<TasksProps, 'labels'>> &
  Pick<TaskData, 'view' | 'wide' | 'panel' | 'shows' | 'setShows' | 'people' | 'lists' | 'load'> &
  Pick<ListShape, 'allLabels'> &
  Pick<ColumnPanes, 'columnPane'> &
  Pick<BoardMoves, 'taken'> &
  Pick<TaskKeys, 'look' | 'partsSaid'> &
  Pick<CardRenderer, 'card'> & {
    columns: PersonColumn[]
    /** The board card's handlers, drawing each card for its column. */
    fns: React.RefObject<CardFns>
    moves: PeopleMoves
  }): React.ReactNode {
  if (view !== 'people') return null
  const { drag, board, layer, handlers } = moves
  /* The list the board's own + would use: the first open one, never Triage. */
  const into = (lists.find((l) => !l.intake && !l.finishes) ?? lists.find((l) => !l.intake) ?? lists[0])?.id ?? null
  const from = drag ? partsOf(drag.id).column : null
  const held = drag ? (columns.flatMap((c) => c.open).find((t) => t.id === partsOf(drag.id).task) ?? null) : null
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      {/* Down into the tool body's foot, as the board does: its columns are the floor. */}
      <div className="-mb-6 flex min-h-0 flex-1">
        <div className="flex min-h-0 min-w-px flex-1 flex-col">
          <div ref={board} data-board data-people-board {...handlers} className="flex min-h-0 min-w-px flex-1 gap-3 overflow-x-auto">
            {columns.map((c) => {
              const name = c.person?.name ?? (c.key === NOBODY ? W.noAssignee : W.notOnProject)
              /* The column a card is carried over lights as a whole, as an
                 ordered column on the board does: the drop answers whose,
                 not where. Not the column it came from, and never Not on
                 this project, which nobody can be given to. */
              const over = drag?.spot?.column === c.key && c.key !== from && c.key !== GONE
              const pane = columnPane(`person:${c.key}`)
              return (
                <div
                  key={c.key}
                  data-list={c.key}
                  data-person-column={c.key}
                  data-column={name}
                  className="relative flex min-w-[256px] max-w-[336px] flex-1 flex-col gap-2 p-2"
                  style={{
                    background: over ? 'color-mix(in oklch, var(--accent) 18%, var(--lane))' : 'var(--lane)',
                    borderRadius: 'var(--r-panel)',
                    boxShadow: over ? 'inset 0 0 0 1px var(--accent)' : undefined,
                    transition: 'background 120ms var(--ease-out), box-shadow 120ms var(--ease-out)',
                  }}
                >
                  <PersonHead
                    column={c}
                    name={name}
                    newTask={canMake ? { kind: 'task', projectId, list: into, who: c.key === NOBODY || c.key === GONE ? '' : c.key } : null}
                    onMade={load}
                  />
                  <div className="relative flex min-h-0 flex-1 flex-col">
                    <div
                      data-column-scroll
                      data-fluid
                      data-own-bar
                      ref={(n) => {
                        pane.current = n
                      }}
                      className="relative flex min-h-0 flex-1 flex-col gap-2 overflow-x-hidden overflow-y-auto"
                    >
                      {!drag && <Fluid what="[data-card]" tone="over" />}
                      {c.open.map((t) => {
                        const slot = slotOf(c.key, t.id)
                        /* The card's own place, held open while it is in the
                           air, with its markup hidden inside so a finger's
                           drag is not ended — the board's hole, `boardView`. */
                        if (drag?.id === slot && !drag.settling)
                          return (
                            <div
                              key={t.id}
                              data-slot={slot}
                              data-hole
                              className="shrink-0 bg-sunken"
                              style={{
                                height: drag.h,
                                borderRadius: 'var(--r-card)',
                                boxShadow: 'inset 0 0 0 1px var(--line), inset 0 1px 3px rgb(0 0 0 / 0.12)',
                              }}
                            >
                              <div hidden>{card(t, c.key, c.key)}</div>
                            </div>
                          )
                        /* Where it lands answers to the drag's name while the
                           copy flies home, so it flies to this column. */
                        const landing = drag?.settling && drag.spot?.column === c.key && partsOf(drag.id).task === t.id
                        return (
                          <BoardCard
                            key={t.id}
                            t={t}
                            col={c.key}
                            slot={landing ? drag.id : slot}
                            taken={taken.has(t.id)}
                            look={look}
                            parts={partsSaid(t.id)}
                            fns={fns}
                          />
                        )
                      })}
                      {/* Finished work is counted, not drawn — quietly, under the rest. */}
                      {c.done > 0 && (
                        <div data-person-done className="shrink-0 px-2 py-1 text-sm tabular-nums text-ink-3">
                          {W.doneCount(c.done)}
                        </div>
                      )}
                    </div>
                    <ColumnFade of={pane} />
                    <ListBar of={pane} over />
                  </div>
                </div>
              )
            })}
            {/* The card in flight, outside every column — `boardView`. */}
            {drag && held && (
              <div
                ref={layer}
                data-in-flight
                className="pointer-events-none fixed z-50"
                style={{ left: drag.x - drag.grabX, top: drag.y - drag.grabY, width: drag.w }}
              >
                <div
                  className="relative px-4 py-3"
                  style={{
                    background: 'color-mix(in oklch, var(--ink) 4%, var(--surface))',
                    borderRadius: 'var(--r-card)',
                    boxShadow: 'var(--glass-shadow)',
                    transform: 'scale(1.02)',
                    transformOrigin: `${drag.grabX}px ${drag.grabY}px`,
                  }}
                >
                  {card(held, from ?? '', from ?? '')}
                </div>
              </div>
            )}
          </div>
          <BoardBar of={board} />
        </div>
        {wide && (
          <ViewPanel
            open={panel}
            on="people"
            group={group}
            sort={sort}
            dir={dir}
            who={who}
            labels={labels}
            people={people}
            meId={meId}
            allLabels={allLabels}
            lists={lists}
            list={list}
            shows={shows}
            onShows={setShows}
            onPick={onNavigate}
          />
        )}
      </div>
    </div>
  )
}

/**
 * A column's head: the board's, with a person where the list was — face,
 * name, how many are open, and the + at the end.
 *
 * The same height as the board's: the face is the ring's size, and what an
 * agent says it is doing is on the face's ring and under the pointer rather
 * than a line of its own, which would push the cards down whenever it came
 * and went.
 */
function PersonHead({ column, name, newTask, onMade }: { column: PersonColumn; name: string; newTask: What | null; onMade: () => void }) {
  const p = column.person
  const { status, now } = useWorkingOf(p?.agent ? p.actor_id : null)
  const doing = status ? doingSaid(status, now) : undefined
  const count = column.open.length
  return (
    <div className="flex shrink-0 items-center gap-2 pt-1 pr-1 pb-2 pl-2" title={doing}>
      <span className="relative flex shrink-0 items-center">
        {status && <span data-agent-working aria-hidden className="agent-working pointer-events-none absolute -inset-1 rounded-full" />}
        {p ? (
          <Avatar id={p.actor_id} name={p.name} url={p.avatar_url} size={20} live={Boolean(status)} on="var(--lane)" />
        ) : (
          <span
            aria-hidden
            className="flex size-5 items-center justify-center bg-hover text-ink-3"
            style={{ borderRadius: 999, opacity: 0.7 }}
          >
            <Icon name="person" size={12} />
          </span>
        )}
      </span>
      <span
        data-person-name
        className="min-w-0 truncate text-lg leading-7 font-medium text-ink"
        style={{ letterSpacing: 'var(--track-title)' }}
      >
        {name}
      </span>
      <span
        data-count
        aria-label={W.openCount(count)}
        className="text-lg leading-7 font-medium tabular-nums text-ink-3"
        style={{ letterSpacing: 'var(--track-title)' }}
      >
        {count}
      </span>
      {doing && (
        <span data-person-doing={status!.agent_id} className="sr-only">
          {doing}
        </span>
      )}
      <span className="ml-auto flex items-center gap-1" data-no-drag>
        {newTask && <NewButton label={MAKE.addTask} variant="bare" testId={`add-for-${column.key}`} what={newTask} onMade={onMade} />}
      </span>
    </div>
  )
}
