import { ACTS } from '../../data/words.js'
import { TASK_DETAIL as DETAIL } from '../../words/taskDetail.js'
import { api } from '../../data/api.js'
import { onABoard } from '../../data/boardApi.js'
import { inWindow } from '../kit.jsx'
import { Icon } from '../glyphs.jsx'
import { acceptInto, declineInto } from '../../data/triage.js'
import { Glass } from '../Glass.jsx'
import { type TasksProps } from '../Tasks.jsx'
import { type TaskData } from './useTaskData.js'
import { type TaskActions } from './useTaskActions.js'

/**
 * The menu a right-click opens on a task, under the hand that opened it.
 */
export function taskMenu({
  projectId,
  tasks,
  setOpen,
  lists,
  move,
  onTask,
  setOnTask,
  setTriageStart,
  duplicate,
  remove,
}: Pick<TasksProps, 'projectId'> &
  Pick<TaskData, 'tasks' | 'setOpen' | 'lists' | 'move'> &
  Pick<TaskActions, 'onTask' | 'setOnTask' | 'setTriageStart' | 'duplicate' | 'remove'>): React.ReactNode {
  return (
    onTask && (
      <div data-over data-task-menu role="menu" className="fixed z-40" style={{ left: inWindow(onTask.x, 180), top: onTask.y, width: 180 }}>
        <Glass data-menu radius={16} className="overflow-hidden py-1">
          {/* Waiting in Triage: its three answers first, where the hand
                already is. Duplicate opens the
                task with its search ready, since it needs the one it
                repeats. */}
          {(() => {
            const t = (tasks ?? []).find((x) => x.id === onTask.id)
            if (!t || !lists.find((l) => l.id === t.list_id)?.intake || t.parent_id) return null
            const accept = acceptInto(lists)
            const item = (testId: string, icon: 'check' | 'close' | 'copy', said: string, act: () => void) => (
              <button
                key={testId}
                role="menuitem"
                data-row
                data-testid={testId}
                onClick={() => {
                  setOnTask(null)
                  act()
                }}
                className="flex w-full items-center gap-3 px-3 text-left text-base text-ink"
                style={{ height: 'var(--row-h)' }}
              >
                <Icon name={icon} size={16} className="text-ink-2" />
                {said}
              </button>
            )
            return (
              <>
                {accept && item('menu-triage-accept', 'check', DETAIL.triageAccept, () => move(t, accept))}
                {item('menu-triage-decline', 'close', DETAIL.triageDecline, () => {
                  void declineInto(projectId, lists).then((to) => {
                    if (!to) return
                    move(t, to)
                    void api(`/tasks/${t.id}/comments`, {
                      method: 'POST',
                      body: JSON.stringify({
                        body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: DETAIL.triageDeclined }] }] },
                      }),
                    }).catch(() => {})
                  })
                })}
                {item('menu-triage-duplicate', 'copy', DETAIL.triageMarkAs, () => {
                  setTriageStart('duplicate')
                  setOpen(t.id)
                })}
                <div className="mx-3 my-1 h-px bg-line" />
              </>
            )
          })()}
          {/* The glyph says which verb before the word is read, which is
                most of what a two-line menu is for. 16, the size every
                other glyph in a menu row is. */}
          {/* A board makes its tasks one by one. */}
          {!onABoard() && (
            <button
              role="menuitem"
              data-row
              data-testid="task-duplicate"
              onClick={() => void duplicate(onTask.id)}
              className="flex w-full items-center gap-3 px-3 text-left text-base text-ink"
              style={{ height: 'var(--row-h)' }}
            >
              <Icon name="copy" size={16} className="text-ink-2" />
              {ACTS.duplicate}
            </button>
          )}
          <button
            role="menuitem"
            data-row
            data-testid="task-delete"
            onClick={() => {
              const t = (tasks ?? []).find((x) => x.id === onTask.id)
              void remove(onTask.id, t?.title ?? '')
            }}
            className="flex w-full items-center gap-3 px-3 text-left text-base text-danger"
            style={{ height: 'var(--row-h)' }}
          >
            <Icon name="trash" size={16} />
            {ACTS.delete}
          </button>
        </Glass>
      </div>
    )
  )
}
