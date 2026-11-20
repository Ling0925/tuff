import { MORE, ACTS, FACTS } from '../../data/words.js'
import { TASKS as W } from '../../words/tasks.js'
import { Status, PriorityPick, WhoPick, LabelPick, CyclePick } from '../kit.jsx'
import { Icon } from '../glyphs.jsx'
import { ACT, pressInside, given } from './model.jsx'
import { type TasksProps } from '../Tasks.jsx'
import { type TaskData } from './useTaskData.js'
import { type BoardMoves } from './useBoardMoves.js'
import { type TaskActions } from './useTaskActions.js'
import { type ListShape } from './useListShape.js'
import { type TaskKeys } from './useTaskKeys.js'

/**
 * The bar over the tasks while some are taken, and what can be done to them.
 */
export function takenBar({
  canWrite,
  tasks,
  people,
  lists,
  cycles,
  patch,
  taken,
  setTaken,
  bar,
  removeAll,
  allLabels,
  makeLabel,
  sharedLabels,
  toAll,
}: Pick<TasksProps, 'canWrite'> &
  Pick<TaskData, 'tasks' | 'people' | 'lists' | 'cycles' | 'patch'> &
  Pick<BoardMoves, 'taken' | 'setTaken' | 'bar'> &
  Pick<TaskActions, 'removeAll'> &
  Pick<ListShape, 'allLabels'> &
  Pick<TaskKeys, 'makeLabel' | 'sharedLabels' | 'toAll'>): React.ReactNode {
  return bar.mounted ? (
    /*
     * It opens rather than appears.
     *
     * Taking the first card put fifty-two pixels above the work in one
     * frame, and the whole board jumped down under the hand that had
     * just pressed it — and jumped back up on Clear. The row grows into
     * its height and the bar fades in as it does, and closes the same
     * way. Height through the grid's row, opacity on the bar: no
     * transform, which would make the bar the frame its menus are
     * placed in and shut them inside it.
     */
    <div
      className="grid shrink-0"
      style={{
        gridTemplateRows: bar.lit ? '1fr' : '0fr',
        transition: 'grid-template-rows 200ms var(--ease-out)',
      }}
    >
      <div className="min-h-0 overflow-hidden">
        <div
          data-taken-bar
          className="flex shrink-0 flex-wrap items-center gap-1 pb-4"
          style={{
            minHeight: 36,
            opacity: bar.lit ? 1 : 0,
            transition: 'opacity 160ms var(--ease-out)',
            pointerEvents: bar.lit ? undefined : 'none',
          }}
        >
          <span className="text-base font-medium text-ink">{W.selected(bar.count)}</span>
          {/* Beside the count it undoes, not at the far end of the line:
              the eye that has just read "3 selected" is where the way out
              should be, and at the far end it sat under the view button. */}
          <button
            data-testid="taken-clear"
            onClick={() => setTaken(new Set())}
            className="mr-2 flex h-8 items-center rounded-[var(--r-row)] px-2 text-base transition-colors hover:bg-[var(--hover)] text-ink-3"
          >
            {MORE.clear}
          </button>
          {canWrite && (
            <>
              {/* Each of these opens the menu one row already has: one
                  control per question, wherever the question is asked. */}
              <span className={ACT} onClick={pressInside}>
                <Status
                  lists={lists}
                  value={null}
                  said={W.nTasks(taken.size)}
                  onPick={(into) => {
                    const l = lists.find((x) => x.id === into)
                    toAll(
                      {
                        list_id: into,
                        completed_at: l?.finishes ? new Date().toISOString() : null,
                        decided_at: new Date().toISOString(),
                      },
                      { list_id: into },
                    )
                  }}
                />
                <span className="text-base text-ink-2">{ACTS.list}</span>
              </span>
              <span className={ACT} onClick={pressInside}>
                <PriorityPick value={undefined} said={W.nTasks(taken.size)} onPick={(to) => toAll({ priority: to }, { priority: to })} />
                <span className="text-base text-ink-2">{FACTS.priority}</span>
              </span>
              {/* The same face and the same menu every row has. It was the
                  platform's own select, which brought its keyboard and its
                  accessibility and looked like nothing else on the board —
                  a grey box with an ellipsis, beside two controls that are
                  the row's own. The menu has both now, and a field to
                  narrow by name. */}
              <span data-taken-assign className={ACT} onClick={pressInside}>
                <WhoPick
                  people={people}
                  value={undefined}
                  said={W.nTasks(taken.size)}
                  size={20}
                  onPick={(to) => toAll({ assignee_ids: to }, given(to))}
                />
                <span className="text-base text-ink-2">{MORE.assign}</span>
              </span>
              {/* Labels the way a task's own screen sets them, across all of
                  what is taken: ticked are the ones every one of them has;
                  ticking adds to each, unticking takes off each, and the rest
                  of every task's labels are left as they were. */}
              <span data-taken-labels className={ACT} onClick={pressInside}>
                <LabelPick
                  all={allLabels}
                  value={sharedLabels}
                  said={W.nTasks(taken.size)}
                  onMake={makeLabel}
                  face={<Icon name="tag" size={16} />}
                  onPick={(next) => {
                    const had = new Set(sharedLabels.map((l) => l.id))
                    const now = new Set(next.map((l) => l.id))
                    const added = next.filter((l) => !had.has(l.id))
                    const gone = new Set([...had].filter((id) => !now.has(id)))
                    for (const t of tasks ?? []) {
                      if (!taken.has(t.id)) continue
                      const own = (t.labels ?? []).filter((l) => !gone.has(l.id))
                      const set = [...own, ...added.filter((l) => !own.some((x) => x.id === l.id))]
                      void patch(t.id, { labels: set }, { labels: set.map((l) => l.id) })
                    }
                  }}
                />
                <span className="text-base text-ink-2">{FACTS.labels}</span>
              </span>
              {cycles.length > 0 && (
                <span data-taken-cycle className={ACT} onClick={pressInside}>
                  <CyclePick
                    cycles={cycles}
                    value={undefined}
                    said={W.nTasks(taken.size)}
                    onPick={(to) => toAll({ cycle_id: to }, { cycle_id: to })}
                  />
                  <span className="text-base text-ink-2">{FACTS.cycle}</span>
                </span>
              )}
              {/* Last and in red, as in a row's own menu: the one of these
                  that takes the work off the screen. */}
              <button
                data-testid="taken-delete"
                onClick={() => void removeAll([...taken])}
                className={ACT}
                style={{ color: 'var(--danger)' }}
              >
                <Icon name="trash" size={16} />
                <span className="text-base">{ACTS.delete}</span>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  ) : null
}
