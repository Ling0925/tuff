import { useCallback, useLayoutEffect, useRef } from 'react'
import type { PersonInWorkspace } from '@tracker/shared-schema'
import { MAKE } from '../../data/words.js'
import { TASKS as W } from '../../words/tasks.js'
import { useWorkingOf } from '../../data/working.js'
import { columnAt, useBoardDrag, slid, stopSlides, type Drag, type Spot } from '../useDrag.js'
import { Avatar, Fluid, doingSaid, whoOf } from '../kit.jsx'
import { Icon } from '../glyphs.jsx'
import { NewButton, type What } from '../New.jsx'
import { type Task, type List, given, inOrder, inKeyOrder, chainKeys, takenBy } from './model.jsx'
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
 * given to nobody is in No assignee, which is always there and always first:
 * it is the work nobody has taken, read before anybody's, and where a card
 * goes to be given to nobody. Not on this project is last, the leftovers of
 * people who left. Whose narrows the columns too: "mine" is my column, not
 * every column that shares a task with me.
 *
 * In the project's order of people (people first, the agents under them,
 * each by name), never by how much they hold: a column does not change
 * places because somebody finished a task.
 *
 * Inside a column, Manual is the board's order — list by list, each list as
 * its cards were placed — because a task's place is kept within its list
 * and means nothing against another list's. Any other Ordering sorts the
 * whole column by it.
 */
export function personColumns({
  lists,
  byColumn,
  people,
  who,
  meId,
  sort,
  dir,
}: {
  lists: List[]
  byColumn: Map<string, Task[]>
  people: Member[]
  who: string
  meId: string
  sort: string
  dir: string
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
  if (sort !== 'manual') for (const c of columns.values()) c.open = inOrder(c.open, sort, dir)
  const only = who === 'all' ? null : who === 'mine' ? meId : who === 'none' ? NOBODY : who
  const rank = (k: string) => known.get(k) ?? people.length
  const shown = [...columns.values()].filter((c) => c.key !== NOBODY && c.open.length > 0 && (only === null || c.key === only))
  return [columns.get(NOBODY) ?? { key: NOBODY, person: null, open: [], done: 0 }, ...shown.sort((a, b) => rank(a.key) - rank(b.key))]
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
 * Carrying a card to another person, or to another place in a column — the
 * board's drag, with a different drop.
 *
 * The board's machinery picks the card up, follows the pointer, scrolls the
 * board at its edges and flies the copy home; what is different is the
 * question a drop answers. On the board it is which list and where in it;
 * here it is whose, and — with Manual ordering — where in that person's
 * column, anywhere in it. A task's manual place is kept within its list
 * (`sort_key`, compared only within a list on the server) and a column reads
 * list by list, so a place in it is a place in a list: let go among another
 * list's cards, the card takes that list (`landsIn`).
 *
 * With any other Ordering there is no place to choose: the card's own slot
 * stays open while it is carried, the column under the pointer lights as a
 * whole, and a card let go in its own column goes back.
 *
 * One `PATCH`, optimistic, with the new assignees and the place (`after`,
 * the card it lands behind in its list) — the requests the face's picker and
 * the board's move send, in one. A refusal puts it back (`patch`). One step
 * on ⌘Z's history, beside the board's moves, that takes back both.
 */
export function usePeopleMoves({
  canWrite,
  sort,
  tasks,
  patch,
  undone,
  people,
  lists,
  columns,
  EDGE,
}: Pick<TasksProps, 'canWrite' | 'sort'> &
  Pick<TaskData, 'tasks' | 'patch' | 'people' | 'lists' | 'EDGE'> &
  Pick<BoardMoves, 'undone'> & { columns: PersonColumn[] }) {
  /* What a drop is measured against, read when the pointer moves. */
  const now = useRef({ tasks, sort })
  now.current = { tasks, sort }

  // biome-ignore lint/correctness/useExhaustiveDependencies: board is a ref, read when the pointer moves
  const resolve = useCallback(
    (x: number, y: number, id: string, mid: number, h: number): Spot | null => {
      const column = columnAt(board.current, x, y)
      if (!column) return null
      const key = column.dataset.list!
      const task = partsOf(id).task
      const pane = column.querySelector('[data-column-scroll]')
      const slots = [...(pane?.children ?? [])].filter((n): n is HTMLElement => n instanceof HTMLElement && n.dataset.slot !== undefined)
      const at = slots.findIndex((s) => s.dataset.slot === id)
      const { sort } = now.current
      if (sort !== 'manual' || key === GONE) return { column: key, index: at === -1 ? 0 : at }
      /* The cards staying, as the board measures them: any card of this
         task left out, the hole and another person's copy of it alike. */
      const staying = (slot: HTMLElement) => partsOf(slot.dataset.slot!).task !== task
      const self = at === -1 ? -1 : slots.slice(0, at).filter(staying).length
      const others = slots.filter(staying)
      let index = others.length
      for (const [i, slot] of others.entries()) {
        /* The board's rule — the leading edge past a neighbour's middle,
           measured where the layout put it — `useBoardMoves`. */
        const sliding = slid.has(slot) ? new DOMMatrixReadOnly(getComputedStyle(slot).transform).m42 : 0
        const box = slot.getBoundingClientRect()
        const middle = box.top - sliding + box.height / 2
        const below = self !== -1 && i >= self
        if (below ? mid + h / 2 <= middle + EDGE : mid - h / 2 < middle - EDGE) {
          index = i
          break
        }
      }
      /* Anywhere in the column, to its very end: a place among another
         list's cards is that list — `landsIn`. */
      return { column: key, index }
    },
    [EDGE],
  )

  const commit = useCallback(
    (id: string, spot: Spot) => {
      const { column: from, task } = partsOf(id)
      if (spot.column === GONE) return
      const t = tasks?.find((x) => x.id === task)
      if (!t) return
      const was = whoOf(t)
      const next = spot.column === from ? was : reassigned(was, from, spot.column, new Set(people.map((p) => p.actor_id)))
      const moved = next.join() !== was.join()
      /* Where it lands, with Manual on — `landsIn`. Put back where it was
         picked up, it is not a move. */
      let place: Landing = null
      const into = columns.find((c) => c.key === spot.column)
      if (sort === 'manual' && into) {
        const at = into.open.findIndex((x) => x.id === task)
        if (!(spot.column === from && at === spot.index)) place = landsIn(t, into.open, spot.index)
        if (place && place.list === t.list_id && at !== -1 && JSON.stringify(landsIn(t, into.open, at)) === JSON.stringify(place))
          place = null
      }
      if (!moved && !place) return
      const list = place && place.list !== t.list_id ? lists.find((l) => l.id === place.list) : undefined
      /* For ⌘Z: who had it, its list, and the card above it in that list. */
      const own = (tasks ?? []).filter((x) => !x.parent_id && x.list_id === t.list_id).sort(inKeyOrder)
      const below = own.findIndex((x) => x.id === task)
      undone.current.push({
        kind: 'assign',
        id: task,
        before: was,
        ...(place ? { after: below > 0 ? own[below - 1]!.id : null, key: t.sort_key } : {}),
        ...(list ? { list: t.list_id } : {}),
      })
      const key = place?.list ? chainKeys(tasks ?? [], place.list, [t], place.after).get(task) : undefined
      void patch(
        task,
        {
          ...(moved ? given(next) : {}),
          /* Given to the list's agent when it takes the list's new tasks and
             nobody is on it — as a move on the board says before the server
             does. */
          ...(list ? { ...takenBy(list, { ...t, assignee_ids: next }), list_id: list.id } : {}),
          ...(list ? { completed_at: list.finishes ? (t.completed_at ?? new Date().toISOString()) : null } : {}),
          ...(key ? { sort_key: key } : {}),
          ...(place ? { decided_at: new Date().toISOString() } : {}),
        },
        {
          ...(moved ? given(next) : {}),
          ...(list ? { list_id: list.id } : {}),
          ...(place ? { after: place.after } : {}),
        },
      )
    },
    [tasks, patch, undone, people, columns, sort, lists],
  )
  const { drag, board, layer, handlers } = useBoardDrag({ enabled: canWrite, resolve, onDrop: commit })
  useSlides(board, drag, sort)
  return { drag, board, layer, handlers } as const
}

/** Where a drop puts a task: its list and the card it goes behind there, or null for no move. */
type Landing = { list: string | null; after: string | null } | null

/**
 * Where a card let go at `index` among a member column's other cards goes.
 *
 * The column reads in status order, list by list, so a place in it is a
 * place in a list. Beside cards of its own list it stays in its list — a
 * reorder, never a change of status. Otherwise it takes the list of the
 * card above it and goes behind that card; at the very top, the first
 * card's list, first. Into a column with nothing else in it there is no
 * neighbour to be placed against, and it keeps its list and its place.
 */
export function landsIn(t: Task, column: Task[], index: number): Landing {
  const rest = column.filter((x) => x.id !== t.id)
  const above = rest[index - 1]
  const below = rest[index]
  if (!above && !below) return null
  if (above && above.list_id === t.list_id) return { list: t.list_id, after: above.id }
  if (below && below.list_id === t.list_id) return { list: t.list_id, after: null }
  if (above) return { list: above.list_id, after: above.id }
  return { list: below!.list_id, after: null }
}

/**
 * The cards close up rather than jump while a card is carried with Manual
 * on — the board's FLIP (`useBoardLayout`, which argues every line of it),
 * for the columns a card can move in here: the one the gap is in, the one it
 * was in a step ago, and the one the card came from.
 */
function useSlides(board: React.RefObject<HTMLDivElement | null>, drag: Drag | null, sort: string) {
  const wasDragging = useRef(false)
  useLayoutEffect(() => {
    if (drag && !drag.settling) {
      wasDragging.current = true
      return
    }
    if (!wasDragging.current) return
    wasDragging.current = false
    stopSlides()
    if (slid.size > 0) void board.current?.offsetHeight
    for (const el of slid) el.style.transition = ''
    slid.clear()
  }, [drag, board])

  type Stood = { top: number; h: number; pane: Element | null; scroll: number }
  const were = useRef(new Map<string, Stood>())
  const lastColumn = useRef<string | null>(null)
  useLayoutEffect(() => {
    const root = board.current
    if (!root || sort !== 'manual') return
    const involved = new Set<string>()
    if (drag) {
      if (drag.spot) involved.add(drag.spot.column)
      if (lastColumn.current) involved.add(lastColumn.current)
      involved.add(partsOf(drag.id).column)
    }
    lastColumn.current = drag?.spot?.column ?? null
    const cards: HTMLElement[] = []
    const panes = new Map<HTMLElement, Element | null>()
    for (const column of root.querySelectorAll<HTMLElement>('[data-list]')) {
      if (!involved.has(column.dataset.list!)) continue
      const pane = column.querySelector('[data-column-scroll]')
      for (const el of pane?.children ?? []) {
        if (!(el instanceof HTMLElement) || el.dataset.card === undefined) continue
        cards.push(el)
        panes.set(el, pane)
      }
    }
    const stood = new Map<string, Stood>()
    const shown = new Map<Element, DOMRect>()
    for (const el of cards) {
      const id = el.dataset.card!
      const sliding = slid.has(el) ? new DOMMatrixReadOnly(getComputedStyle(el).transform).m42 : 0
      const pane = panes.get(el) ?? null
      const box = el.getBoundingClientRect()
      stood.set(id, { top: box.top - sliding, h: box.height, pane, scroll: pane?.scrollTop ?? 0 })
      if (pane && !shown.has(pane)) shown.set(pane, pane.getBoundingClientRect())
    }
    const moving: [HTMLElement, number][] = []
    if (drag && !drag.settling) {
      for (const el of cards) {
        const id = el.dataset.card!
        const was = were.current.get(id)
        const is = stood.get(id)
        if (!was || !is) continue
        const by = was.pane === is.pane ? was.top + was.scroll - (is.top + is.scroll) : was.top - is.top
        if (Math.abs(by) < 2) continue
        const seen = is.pane ? shown.get(is.pane) : undefined
        const off = (top: number) => !!seen && (top > seen.bottom || top + is.h < seen.top)
        if (off(is.top) && off(is.top + by)) continue
        moving.push([el, by])
      }
      for (const [el, by] of moving) {
        slid.add(el)
        el.style.transition = 'none'
        el.style.transform = `translateY(${by}px)`
      }
      if (moving.length > 0) {
        void root.offsetHeight
        for (const [el] of moving) {
          el.style.transition = 'transform 160ms var(--ease-out)'
          el.style.transform = ''
        }
      }
    }
    were.current = stood
  })
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
  const dragged = drag ? partsOf(drag.id).task : null
  const held = dragged ? (columns.flatMap((c) => c.open).find((t) => t.id === dragged) ?? null) : null
  /* With Manual on, the gap travels to where the card will land, as on the
     board; with any other Ordering it stays where the card was. */
  const spot = drag && !drag.settling && sort === 'manual' && drag.spot && drag.spot.column !== GONE ? drag.spot : null
  /**
   * A column as it would be if the card were let go of now — the board's
   * `arranged`: the card out of the column it left, and the gap where it
   * lands.
   *
   * Over a column that already holds the task — given to two, carried from
   * one to the other — that column's own card is what moves to the place,
   * rather than leaving for a gap: it is the card the drop will leave there.
   * Taken out instead, it vanished with its faces while the pointer crossed
   * its column and came back when it left — measured frame by frame, the
   * face in its corner gone for twenty-odd frames and back. Moved, it is the
   * same node the whole way and slides like any other card.
   */
  const rowsOf = (c: PersonColumn): { t: Task; hole: boolean }[] => {
    if (!drag || drag.settling) return c.open.map((t) => ({ t, hole: false }))
    if (!spot) return c.open.map((t) => ({ t, hole: c.key === from && t.id === dragged }))
    const own = c.key !== from && c.open.some((t) => t.id === dragged)
    const rows = c.open.filter((t) => !(t.id === dragged && (c.key === from || c.key === spot.column))).map((t) => ({ t, hole: false }))
    if (c.key === spot.column && held) rows.splice(spot.index, 0, { t: held, hole: !own })
    return rows
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      {/* Down into the tool body's foot, as the board does: its columns are the floor. */}
      <div className="-mb-6 flex min-h-0 flex-1">
        <div className="flex min-h-0 min-w-px flex-1 flex-col">
          <div ref={board} data-board data-people-board {...handlers} className="flex min-h-0 min-w-px flex-1 gap-3 overflow-x-auto">
            {columns.map((c) => {
              const name = c.person?.name ?? (c.key === NOBODY ? W.noAssignee : W.notOnProject)
              /* With an Ordering on, the column a card is carried over
                 lights as a whole, as an ordered column on the board does:
                 the drop answers whose, not where. Not the column it came
                 from, and never Not on this project, which nobody can be
                 given to. */
              const over = sort !== 'manual' && drag?.spot?.column === c.key && c.key !== from && c.key !== GONE
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
                      {rowsOf(c).map(({ t, hole }) => {
                        const slot = slotOf(c.key, t.id)
                        /* The place it will land, held open while it is in
                           the air, with its markup hidden inside so a
                           finger's drag is not ended — the board's hole,
                           `boardView`. */
                        if (hole && drag)
                          return (
                            <div
                              key={t.id}
                              data-slot={drag.id}
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
                            landing={!!landing}
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
                  data-lift
                  className="relative px-4 py-3"
                  style={{
                    background: 'color-mix(in oklch, var(--ink) 4%, var(--surface))',
                    borderRadius: 'var(--r-card)',
                    boxShadow: 'var(--glass-shadow)',
                    transform: 'scale(1.02)',
                    transformOrigin: `${drag.grabX}px ${drag.grabY}px`,
                  }}
                >
                  {/*
                   * Drawn for the column it is going to once it is let go of.
                   * Drawn for the one it came from, the copy took the new
                   * assignees with it on the drop and showed them from the old
                   * column's side: carried from an agent to me, my face
                   * appeared in its corner for the length of the flight and
                   * went with it, on a card that lands with no face at all —
                   * the face that flickered on release.
                   */}
                  {(() => {
                    const whose = drag.settling && drag.spot && drag.spot.column !== GONE ? drag.spot.column : (from ?? '')
                    return card(held, whose, whose)
                  })()}
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
      <span data-person-face className="relative flex shrink-0 items-center">
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
