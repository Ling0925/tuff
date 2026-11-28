import { useCallback, useEffect, useRef, useState } from 'react'
import type { ProjectInList, TaskCopied } from '@tracker/shared-schema'
import { MORE } from '../data/words.js'
import { TASK_DETAIL as W } from '../words/taskDetail.js'
import { TASKS } from '../words/tasks.js'
import { api } from '../data/api.js'
import { recall } from '../data/memory.js'
import { Button, Dialog } from './kit.jsx'
import { Icon } from './glyphs.jsx'
import { ProjectMark, markOf } from './icons.jsx'

type TaskList = { id: string; name: string; finishes: boolean; intake: boolean }
type Moved = TaskCopied & { comments?: number }

/**
 * Moving tasks to another project. The same project-and-plan shape Copy
 * has: the server answers what the move will be before it is made. More
 * than one id is moved one press at a time; the plan shown is the first
 * task's, and every task is moved with the same target and list.
 */
export function MoveTasksDialog({
  taskIds,
  projectId,
  onClose,
  onMoved,
}: {
  taskIds: string[]
  projectId: string
  onClose: () => void
  onMoved: (ids: string[]) => void
}) {
  const first = taskIds[0]
  const [every, setEvery] = useState<ProjectInList[]>(() => recall<{ projects?: ProjectInList[] }>('shell')?.projects ?? [])
  useEffect(() => {
    void api<{ projects: ProjectInList[] }>('/projects')
      .then((r) =>
        setEvery((had) => {
          const fresh = new Map(r.projects.map((p) => [p.id, p]))
          const kept = had.map((p) => fresh.get(p.id) ?? p)
          const known = new Set(had.map((p) => p.id))
          return [...kept, ...r.projects.filter((p) => !known.has(p.id))]
        }),
      )
      .catch(() => {})
  }, [])
  const projects = every.filter((p) => !p.archived_at && p.id !== projectId && (p.can ?? []).includes('task.create'))
  const [chosen, setChosen] = useState<string | null>(null)
  const [plan, setPlan] = useState<Moved | 'failed' | null>(null)
  const [lists, setLists] = useState<TaskList[]>([])
  const [listId, setListId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<string | null>(null)
  const asked = useRef<string | null>(null)

  const ask = useCallback(
    (to: string) => {
      if (asked.current === to) return
      asked.current = to
      setPlan(null)
      setListId(null)
      void api<Moved>(`/tasks/${first}/move`, { method: 'POST', body: JSON.stringify({ project_id: to, dry: true }) })
        .then((p) => setPlan(p))
        .catch(() => setPlan('failed'))
      void api<{ lists: TaskList[] }>(`/projects/${to}/lists`)
        .then((r) => setLists(r.lists))
        .catch(() => setLists([]))
    },
    [first],
  )
  useEffect(() => {
    if (chosen) ask(chosen)
  }, [chosen, ask])

  const target = projects.find((p) => p.id === chosen)
  const ready = Boolean(target && plan && plan !== 'failed')
  const go = async () => {
    if (!target || !ready) return
    setBusy(true)
    setSaid(null)
    try {
      for (const id of taskIds) {
        await api<Moved>(`/tasks/${id}/move`, {
          method: 'POST',
          body: JSON.stringify({ project_id: target.id, ...(listId ? { list_id: listId } : {}) }),
        })
      }
      onMoved(taskIds)
    } catch {
      setSaid(W.couldntMove)
      setBusy(false)
    }
  }
  const names = (people: { name: string }[]) => people.map((p) => p.name).join(', ')
  const lines =
    target && plan && plan !== 'failed'
      ? [
          W.moveThere(target.name),
          plan.list_name ? W.copyList(listId ? (lists.find((l) => l.id === listId)?.name ?? plan.list_name) : plan.list_name) : null,
          plan.subtasks > 0 ? W.copyParts(plan.subtasks) : null,
          (plan.comments ?? 0) > 0 ? W.moveComments(plan.comments!) : null,
          plan.files > 0 ? W.copyFiles(plan.files) : null,
          plan.labels_dropped.length ? W.copyLabels(plan.labels_dropped.join(', ')) : null,
          plan.assignees_dropped.length ? W.copyUnassigned(names(plan.assignees_dropped), target.name) : null,
          W.moveNotCarried,
        ].filter((l): l is string => Boolean(l))
      : []

  return (
    <Dialog
      title={taskIds.length === 1 ? W.moveTitle : W.moveManyTitle(taskIds.length)}
      testId="move-task-dialog"
      onClose={onClose}
      footer={
        <div className="flex flex-1 items-center justify-end gap-2">
          <p role="alert" className="mr-auto min-w-px truncate text-sm text-danger">
            {said}
          </p>
          <button onClick={onClose} className="h-8 px-3 text-base font-medium text-ink-2">
            {MORE.cancel}
          </button>
          <Button tone="primary" data-testid="move-task-go" disabled={!ready || busy} onClick={() => void go()}>
            {busy ? W.moving : W.move}
          </Button>
        </div>
      }
    >
      {projects.length === 0 ? (
        <p className="px-4 pt-2 pb-4 text-base leading-5 text-ink-2">{W.moveNowhere}</p>
      ) : (
        <div className="flex flex-col">
          <div role="radiogroup" aria-label={W.moveTitle} className="flex max-h-[220px] flex-col overflow-y-auto px-2 pt-1 pb-2">
            {projects.map((p) => {
              const on = p.id === chosen
              return (
                <button
                  key={p.id}
                  data-row
                  role="radio"
                  aria-checked={on}
                  data-testid="move-task-project"
                  onPointerEnter={() => ask(p.id)}
                  onFocus={() => ask(p.id)}
                  onClick={() => setChosen(p.id)}
                  className="flex w-full shrink-0 items-center gap-3 px-2 text-left text-base text-ink"
                  style={{ height: 'var(--row-h)', borderRadius: 'var(--r-row)', background: on ? 'var(--hover)' : undefined }}
                >
                  <ProjectMark {...markOf(p)} size={20} />
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                  <Icon name="check" size={16} className="text-accent" style={{ opacity: on ? 1 : 0 }} />
                </button>
              )
            })}
          </div>
          <div
            className="flex h-[190px] flex-col gap-1 overflow-y-auto px-4 pt-3 pb-4 text-sm leading-5 text-ink-2"
            style={{ borderTop: '1px solid var(--line)' }}
            data-testid="move-task-plan"
          >
            {!target ? (
              <p className="text-ink-3">{W.movePick}</p>
            ) : plan === 'failed' ? (
              <p className="text-danger">{W.couldntMove}</p>
            ) : (
              lines.map((l) => <p key={l}>{l}</p>)
            )}
            {target && lists.length > 0 && (
              <label className="mt-2 flex items-center gap-2 text-ink">
                <span>{TASKS.columnsLists}</span>
                <select
                  data-testid="move-task-list"
                  value={listId ?? ''}
                  onChange={(e) => setListId(e.target.value || null)}
                  className="h-8 rounded border border-line bg-panel px-2 text-sm"
                >
                  <option value="">{W.moveDefaultList}</option>
                  {lists
                    .filter((l) => !l.intake)
                    .map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                </select>
              </label>
            )}
          </div>
        </div>
      )}
    </Dialog>
  )
}
