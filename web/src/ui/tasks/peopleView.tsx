import { memo, useLayoutEffect, useRef, useState } from 'react'
import type { PersonInWorkspace } from '@tracker/shared-schema'
import { TASKS as W } from '../../words/tasks.js'
import { useWorkingOf } from '../../data/working.js'
import { Avatar, EmptyState, Fluid, Dot, doingSaid, whoOf } from '../kit.jsx'
import { Icon } from '../glyphs.jsx'
import { near } from '../TaskDetail.jsx'
import { type Task, type List } from './model.jsx'
import { ViewPanel } from './view.jsx'
import { ListBar } from './listBar.jsx'
import { type TasksProps } from '../Tasks.jsx'
import { type TaskData } from './useTaskData.js'
import { type ListShape } from './useListShape.js'
import { type ColumnPanes } from './useColumnPanes.js'

/**
 * One assignee's open work: who, what they are on, and how much is behind
 * them.
 */
export type PersonCard = {
  /** The actor's id; `~` for nobody, `?` for people no longer on the project. */
  key: string
  person: Member | null
  /** Their open tasks, in the board's order: list by list, then as each list orders them. */
  open: Task[]
  /** How many of their tasks are in a list that finishes them. */
  done: number
}

type Member = TaskData['people'][number] & Pick<PersonInWorkspace, 'agent' | 'avatar_url'>

const NOBODY = '~'
const GONE = '?'

/**
 * The cards, from what the board already holds.
 *
 * `byColumn` is the board's: narrowed by whose and by labels, and each list
 * in the order asked for — so a card cannot hold a task the board or the
 * list would leave out. A task given to two people is in both cards; one
 * given to nobody is in the last card. Whose narrows the cards too: "mine"
 * is my card, not every card that shares a task with me.
 *
 * In the project's order of people (people first, the agents under them,
 * each by name), never by how much they hold: a card does not change places
 * because somebody finished a task.
 */
export function personCards({
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
}): PersonCard[] {
  const known = new Map(people.map((p, at) => [p.actor_id, at]))
  const cards = new Map<string, PersonCard>()
  const cardOf = (key: string): PersonCard => {
    let c = cards.get(key)
    if (!c) {
      const at = known.get(key)
      c = { key, person: at === undefined ? null : people[at]!, open: [], done: 0 }
      cards.set(key, c)
    }
    return c
  }
  for (const l of lists) {
    for (const t of byColumn.get(l.id) ?? []) {
      const ids = whoOf(t)
      const here = ids.filter((id) => known.has(id))
      const keys = ids.length === 0 ? [NOBODY] : here.length > 0 ? here : [GONE]
      for (const k of keys) {
        const c = cardOf(k)
        if (l.finishes) c.done++
        else c.open.push(t)
      }
    }
  }
  const only = who === 'all' ? null : who === 'mine' ? meId : who === 'none' ? NOBODY : who
  const rank = (k: string) => known.get(k) ?? (k === GONE ? people.length : people.length + 1)
  return [...cards.values()].filter((c) => c.open.length > 0 && (only === null || c.key === only)).sort((a, b) => rank(a.key) - rank(b.key))
}

/** Every open task once, in the order the cards draw them — what ← and → page through. */
export function peopleWalk(cards: PersonCard[]): Task[] {
  const seen = new Set<string>()
  const out: Task[] = []
  for (const c of cards)
    for (const t of c.open)
      if (!seen.has(t.id)) {
        seen.add(t.id)
        out.push(t)
      }
  return out
}

/* The board's column: never narrower than a card can be, never wider than
   a card is drawn — `boardView.tsx` argues both numbers. */
const NARROWEST = 256
const WIDEST = 336
const GAP = 12
/* The last width measured, so coming back draws the columns at once rather
   than one column for a frame. */
let lastWidth = 0

/**
 * How tall a card will be, worked out rather than measured.
 *
 * The cards are dealt into columns before anything is drawn, so nothing is
 * moved after it appears. A title's lines are guessed from its length
 * against the column's width: a guess that is a line out puts a card in a
 * column a little longer than it might have been, which nobody sees, where
 * measuring and dealing again moves cards under the reader, which everybody
 * does.
 */
function tallness(c: PersonCard, column: number): number {
  /* The lane's 4 each side, the row's 12 before the mark, the mark's 24,
     the 12 after it and the 16 at the end. */
  const text = column - 8 - 12 - 24 - 12 - 16
  const perLine = Math.max(8, Math.floor(text / 7.4))
  let h = 8 + 56
  for (const t of c.open) h += 16 + 20 * Math.max(1, Math.ceil(t.title.length / perLine)) + 20
  return h
}

/** The cards into `n` columns, each to the shortest so far, leftmost on a tie. */
function deal(cards: PersonCard[], n: number, column: number): PersonCard[][] {
  const cols: PersonCard[][] = Array.from({ length: n }, () => [])
  const h = new Array<number>(n).fill(0)
  for (const c of cards) {
    let at = 0
    for (let i = 1; i < n; i++) if (h[i]! < h[at]!) at = i
    cols[at]!.push(c)
    h[at]! += tallness(c, column) + GAP
  }
  return cols
}

/**
 * The tasks as people: a card for each assignee, holding what they have
 * open and what list each task is in. On a desk only — the option is not
 * offered under 1024 and `?view=people` draws the list there.
 */
export function peopleView({
  view,
  wide,
  panel,
  shows,
  setShows,
  people,
  lists,
  setOpen,
  tasks,
  group,
  sort,
  dir,
  who,
  list,
  labels,
  meId,
  onNavigate,
  allLabels,
  cards,
  pane,
  paneNode,
  paneReady,
}: Pick<TasksProps, 'group' | 'sort' | 'dir' | 'who' | 'list' | 'onNavigate' | 'meId'> &
  Required<Pick<TasksProps, 'labels'>> &
  Pick<TaskData, 'view' | 'wide' | 'panel' | 'shows' | 'setShows' | 'people' | 'lists' | 'setOpen' | 'tasks'> &
  Pick<ListShape, 'allLabels'> &
  Pick<ColumnPanes, 'pane' | 'paneNode' | 'paneReady'> & { cards: PersonCard[] }): React.ReactNode {
  return (
    view === 'people' && (
      <div className="flex min-h-0 flex-1 flex-col gap-4">
        <div className="flex min-h-0 flex-1">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {tasks && cards.length === 0 && (
              <EmptyState art="board" title={W.noOpenTasks}>
                {W.noOpenTasksBody}
              </EmptyState>
            )}
            {tasks && cards.length > 0 && (
              /* Down into the tool body's own foot, as the list's sheet
                 does: the cards run on to the edge while there are more. */
              <div className="relative -mb-6 flex min-h-0 flex-1">
                <div
                  ref={pane}
                  data-people-view
                  data-reads-down
                  data-own-bar
                  className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto"
                >
                  <Columns cards={cards} lists={lists} setOpen={setOpen} />
                  <div aria-hidden className="h-6 shrink-0" />
                </div>
                <ListBar of={paneNode} key={paneReady} over outside />
              </div>
            )}
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
  )
}

/**
 * The cards, dealt into as many columns as the width holds.
 *
 * Columns of their own rather than CSS columns: CSS fills the first column
 * to the bottom before starting the next, so the order reads down and a
 * task arriving in the first card pushed the last card of a column to the
 * top of the next. Dealt in order, the cards read across, and a card only
 * changes column when the width does or the dealing comes out differently.
 */
function Columns({ cards, lists, setOpen }: { cards: PersonCard[]; lists: List[]; setOpen: (id: string | null) => void }) {
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(lastWidth)
  /* Before the first paint, and again whenever the room changes — the
     panel opening beside it, the window. */
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const take = (w: number) => {
      lastWidth = Math.floor(w)
      setWidth(lastWidth)
    }
    take(el.getBoundingClientRect().width)
    const watch = new ResizeObserver(([e]) => e && take(e.contentRect.width))
    watch.observe(el)
    return () => watch.disconnect()
  }, [])
  const n = Math.max(1, Math.floor((width + GAP) / (NARROWEST + GAP)))
  const column = Math.min(WIDEST, (width - GAP * (n - 1)) / n)
  const listOf = new Map(lists.map((l) => [l.id, l]))
  return (
    <div ref={box} className="flex items-start gap-3">
      {deal(cards, n, column).map((col, i) => (
        <div key={i} className="flex min-w-0 flex-1 flex-col gap-3" style={{ maxWidth: WIDEST }}>
          {col.map((c) => (
            <Card key={c.key} card={c} listOf={listOf} setOpen={setOpen} />
          ))}
        </div>
      ))}
    </div>
  )
}

/**
 * One assignee's card: the list's band, laid out for a person.
 *
 * The same two grounds as a list grouped by anything — the lane round the
 * heading and the work, the card's white under the tasks — so the people
 * view reads as this product's list cut into pieces rather than a new
 * surface. No glass: it is content.
 */
const Card = memo(function Card({
  card,
  listOf,
  setOpen,
}: {
  card: PersonCard
  listOf: Map<string, List>
  setOpen: (id: string | null) => void
}) {
  const p = card.person
  const agent = p?.agent ? p.actor_id : null
  const { status, now } = useWorkingOf(agent)
  const name = p?.name ?? (card.key === NOBODY ? W.noAssignee : W.notOnProject)
  /*
   * The second line, always there so the card is the same height with a
   * status and without one: what the agent says it is doing now, or how
   * much of this person's work is done.
   */
  const second = status ? status.doing : card.done > 0 ? W.doneCount(card.done) : W.noneDone
  return (
    <section
      data-person-card={card.key}
      aria-label={name}
      className="flex flex-col p-1"
      style={{ background: 'var(--lane)', borderRadius: 'var(--r-card)' }}
    >
      {/* The face over the column of marks below it and the name over the
          titles: 4 + 8 + 32 + 8 puts the name at 52, where the rows' titles
          start, and the face's middle at 28, where their marks' is. */}
      <div className="flex items-center gap-2 py-2 pr-4 pl-2">
        <span className="relative flex shrink-0">
          {status && <span data-agent-working aria-hidden className="agent-working pointer-events-none absolute -inset-1 rounded-full" />}
          {p ? (
            <Avatar id={p.actor_id} name={p.name} url={p.avatar_url} size={32} live={Boolean(status)} on="var(--lane)" />
          ) : (
            <span
              aria-hidden
              className="flex size-8 items-center justify-center bg-hover text-ink-3"
              style={{ borderRadius: 999, opacity: 0.7 }}
            >
              <Icon name="person" size={16} />
            </span>
          )}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span
            data-person-name
            className="truncate text-base leading-5 font-medium text-ink"
            style={{ letterSpacing: 'var(--track-body)' }}
          >
            {name}
          </span>
          <span
            data-person-second
            data-person-doing={status ? status.agent_id : undefined}
            title={status ? doingSaid(status, now) : undefined}
            className="truncate text-sm leading-5 text-ink-3"
            style={{ letterSpacing: 'var(--track-body)' }}
          >
            {second}
          </span>
        </span>
        <span data-count aria-label={W.openCount(card.open.length)} className="shrink-0 text-base tabular-nums text-ink-3">
          {card.open.length}
        </span>
      </div>
      <div
        className="relative flex flex-col overflow-hidden py-1"
        style={{ background: 'var(--card)', borderRadius: 'calc(var(--r-card) - 4px)' }}
      >
        <Fluid what="[data-person-task]" />
        {card.open.map((t) => {
          const l = t.list_id ? listOf.get(t.list_id) : undefined
          return (
            <button
              key={t.id}
              type="button"
              data-person-task={t.id}
              /* Read ahead, as a card and a row do, so the task opens whole. */
              onPointerEnter={() => near(t.id)}
              onClick={() => setOpen(t.id)}
              className="relative flex w-full items-start gap-3 py-2 pr-4 pl-3 text-left"
            >
              {/* The list's own mark: in Tuff the list a task is in is its
                  status, and this is the ring every row and column draws. */}
              <span className="flex h-5 w-6 shrink-0 items-center justify-center">
                <Dot icon={l?.icon ?? null} color={l?.color} />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span
                  className="text-base leading-5 font-medium [overflow-wrap:anywhere] text-ink"
                  style={{ letterSpacing: 'var(--track-body)' }}
                >
                  {t.title}
                </span>
                <span
                  data-person-task-status
                  className="truncate text-sm leading-5 text-ink-3"
                  style={{ letterSpacing: 'var(--track-body)' }}
                >
                  {l?.name}
                </span>
              </span>
            </button>
          )
        })}
      </div>
    </section>
  )
})
