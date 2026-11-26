import { MAKE } from '../../data/words.js'
import { TASKS as W } from '../../words/tasks.js'
import { Fluid, LabelChip, type Label } from '../kit.jsx'
import { NewButton } from '../New.jsx'
import { type Task, type List, inOrder } from './model.jsx'
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

/** One label's column: the label, and the open work wearing it. */
export type LabelColumn = {
  /** The label's id; `~` for the work with no label. */
  key: string
  label: Label | null
  /** Its open tasks, in the board's order: list by list, then as each list orders them. */
  open: Task[]
  /** How many of its tasks are in a list that finishes them. */
  done: number
}

export const UNLABELED = '~'

/**
 * The columns, from what the board already holds.
 *
 * `byColumn` is the board's: narrowed by whose and by labels, and each list
 * in the order asked for — so a column cannot hold a task the board or the
 * list would leave out. A task with two labels is in both columns; one with
 * none is in No labels, which is always there and always first. Every label
 * of the project is drawn, empty ones included, because the columns are the
 * grouping rather than a count of what happens to be used.
 *
 * Inside a column, Manual is the board's order — list by list, each list as
 * its cards were placed — because a task's place is kept within its list
 * and means nothing against another list's. Any other Ordering sorts the
 * whole column by it.
 */
export function labelColumns({
  lists,
  byColumn,
  allLabels,
  sort,
  dir,
}: {
  lists: List[]
  byColumn: Map<string, Task[]>
  allLabels: Label[]
  sort: string
  dir: string
}): LabelColumn[] {
  const known = new Map(allLabels.map((l, at) => [l.id, { label: l, at }]))
  const columns = new Map<string, LabelColumn>()
  const columnOf = (key: string, label: Label | null): LabelColumn => {
    let c = columns.get(key)
    if (!c) {
      c = { key, label, open: [], done: 0 }
      columns.set(key, c)
    }
    return c
  }
  const none = columnOf(UNLABELED, null)
  for (const l of allLabels) columnOf(l.id, l)
  for (const l of lists) {
    for (const t of byColumn.get(l.id) ?? []) {
      const ids = [...new Set((t.labels ?? []).map((x) => x.id))]
      const keys = ids.length > 0 ? ids : [UNLABELED]
      for (const k of keys) {
        const label = known.get(k)?.label ?? t.labels?.find((x) => x.id === k) ?? null
        const c = columnOf(k, label)
        if (l.finishes) c.done++
        else c.open.push(t)
      }
    }
  }
  if (sort !== 'manual') for (const c of columns.values()) c.open = inOrder(c.open, sort, dir)
  const rank = (c: LabelColumn) => (c.key === UNLABELED ? -1 : (known.get(c.key)?.at ?? allLabels.length))
  return [...columns.values()]
    .sort((a, b) => rank(a) - rank(b) || a.key.localeCompare(b.key))
    .filter((c) => c.key !== UNLABELED || c === none)
}

/** Every open task once, in the order the columns draw them — what ← and → page through. */
export function labelWalk(columns: LabelColumn[]): Task[] {
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

/** The columns as the card's own selection knows them: shift-click runs down one label, never across two. */
export function labelByColumn(columns: LabelColumn[]): Map<string, Task[]> {
  return new Map(columns.map((c) => [c.key, c.open]))
}

/**
 * The tasks as labels: the board, with a column for each label instead of
 * each list.
 *
 * Cards are not draggable here. A task can wear several labels, so the
 * column a card is seen under is not the whole truth about it: dropping it
 * elsewhere could mean adding a label, replacing one, or taking one off,
 * and the wrong one of those is a fact deleted by a gesture. The ordinary
 * card interactions — opening, choosing, the menu and the keyboard — are
 * unchanged; labels themselves are changed on the task or in the selection
 * bar, where the set being written is explicit.
 */
export function labelView({
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
  board,
}: Pick<TasksProps, 'projectId' | 'canMake' | 'group' | 'sort' | 'dir' | 'who' | 'list' | 'onNavigate' | 'meId'> &
  Required<Pick<TasksProps, 'labels'>> &
  Pick<TaskData, 'view' | 'wide' | 'panel' | 'shows' | 'setShows' | 'people' | 'lists' | 'load'> &
  Pick<ListShape, 'allLabels'> &
  Pick<ColumnPanes, 'columnPane'> &
  Pick<BoardMoves, 'taken' | 'board'> &
  Pick<TaskKeys, 'look' | 'partsSaid'> &
  Pick<CardRenderer, 'card'> & {
    columns: LabelColumn[]
    /** The board card's handlers, drawing each card for its column. */
    fns: React.RefObject<CardFns>
  }): React.ReactNode {
  if (view !== 'labels') return null
  /* The list the board's own + would use: the first open one, never Triage. */
  const into = (lists.find((l) => !l.intake && !l.finishes) ?? lists.find((l) => !l.intake) ?? lists[0])?.id ?? null
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      {/* Down into the tool body's foot, as the board does: its columns are the floor. */}
      <div className="-mb-6 flex min-h-0 flex-1">
        <div className="flex min-h-0 min-w-px flex-1 flex-col">
          <div ref={board} data-board data-label-board className="flex min-h-0 min-w-px flex-1 gap-3 overflow-x-auto">
            {columns.map((c) => {
              const name = c.label?.name ?? W.noLabels
              const pane = columnPane(`label:${c.key}`)
              return (
                <div
                  key={c.key}
                  data-list={c.key}
                  data-label-column={c.key}
                  data-column={name}
                  className="relative flex min-w-[256px] max-w-[336px] flex-1 flex-col gap-2 p-2"
                  style={{ background: 'var(--lane)', borderRadius: 'var(--r-panel)' }}
                >
                  <div className="flex shrink-0 items-center gap-2 pt-1 pr-1 pb-2 pl-2">
                    {c.label ? (
                      <LabelChip label={c.label} size={14} />
                    ) : (
                      <span className="min-w-0 truncate text-lg leading-7 font-medium text-ink">{name}</span>
                    )}
                    <span
                      data-count
                      aria-label={W.openCount(c.open.length)}
                      className="text-lg leading-7 font-medium tabular-nums text-ink-3"
                      style={{ letterSpacing: 'var(--track-title)' }}
                    >
                      {c.open.length}
                    </span>
                    <span className="ml-auto flex items-center gap-1" data-no-drag>
                      {canMake && (
                        <NewButton
                          label={MAKE.addTask}
                          variant="bare"
                          testId={`add-for-label-${c.key}`}
                          what={{ kind: 'task', projectId, list: into, labels: c.label ? [c.label] : [] }}
                          onMade={load}
                        />
                      )}
                    </span>
                  </div>
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
                      <Fluid what="[data-card]" tone="over" />
                      {c.open.map((t) => (
                        <BoardCard
                          key={t.id}
                          t={t}
                          col={c.key}
                          slot={`${c.key}/${t.id}`}
                          taken={taken.has(t.id)}
                          look={look}
                          parts={partsSaid(t.id)}
                          fns={fns}
                          drag={false}
                        />
                      ))}
                      {/* Finished work is counted, not drawn — quietly, under the rest. */}
                      {c.done > 0 && (
                        <div data-label-done className="shrink-0 px-2 py-1 text-sm tabular-nums text-ink-3">
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
          </div>
          <BoardBar of={board} />
        </div>
        {wide && (
          <ViewPanel
            open={panel}
            on="labels"
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
