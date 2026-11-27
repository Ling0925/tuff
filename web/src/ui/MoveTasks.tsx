import { useEffect, useRef, useState } from 'react'
import type { ProjectInList, TaskMoved } from '@tracker/shared-schema'
import { MORE, PLACES } from '../data/words.js'
import { TASK_DETAIL as W } from '../words/taskDetail.js'
import { TASKS } from '../words/tasks.js'
import { api } from '../data/api.js'
import { recall } from '../data/memory.js'
import { Button, Dialog, Dot, ProjectPick, Select } from './kit.jsx'

type TaskList = { id: string; name: string; finishes: boolean; intake: boolean; icon: string; color?: string | null }
type Moved = TaskMoved

/**
 * Moving tasks to another project.
 *
 * Compact because the question is compact: where, and where in it. The
 * projects live behind the same picker a new task uses rather than as a
 * second, permanent list; the server's dry run underneath says what the
 * move will carry before the press. More than one id is moved one press at
 * a time; the plan shown is the first task's, and with no status chosen
 * each task keeps its own.
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
  const asking = useRef(0)

  /* Read the plan again when either answer changes: the target, and whether
     the person has overridden where in it the work lands. A slow answer for
     the project somebody has since left is dropped. */
  useEffect(() => {
    if (!chosen) {
      setPlan(null)
      setLists([])
      return
    }
    const round = ++asking.current
    const to = chosen
    const override = listId
    setPlan(null)
    void api<Moved>(`/tasks/${first}/move`, {
      method: 'POST',
      body: JSON.stringify({ project_id: to, dry: true, ...(override ? { list_id: override } : {}) }),
    })
      .then((p) => {
        if (asking.current === round) setPlan(p)
      })
      .catch(() => {
        if (asking.current === round) setPlan('failed')
      })
    void api<{ lists: TaskList[] }>(`/projects/${to}/lists`)
      .then((r) => {
        if (asking.current === round) setLists(r.lists)
      })
      .catch(() => {
        if (asking.current === round) setLists([])
      })
  }, [chosen, listId, first])

  const pickProject = (id: string) => {
    if (id === chosen) return
    setChosen(id)
    setListId(null)
    setLists([])
    setPlan(null)
  }

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
          plan.list_name ? W.copyList(plan.list_name) : null,
          plan.list_created ? W.moveStatusCreated(plan.list_name ?? '') : null,
          plan.subtasks > 0 ? W.copyParts(plan.subtasks) : null,
          plan.comments > 0 ? W.moveComments(plan.comments) : null,
          plan.files > 0 ? W.copyFiles(plan.files) : null,
          plan.labels_created.length ? W.moveLabelsCreated(plan.labels_created.join(', ')) : null,
          plan.labels_dropped.length ? W.copyLabels(plan.labels_dropped.join(', ')) : null,
          plan.assignees_dropped.length ? W.copyUnassigned(names(plan.assignees_dropped), target.name) : null,
          W.moveNotCarried,
          plan.github_to ? W.copyGithubTo(target.name) : null,
        ].filter((l): l is string => Boolean(l))
      : []

  const shownList = listId
    ? lists.find((l) => l.id === listId)
    : plan && plan !== 'failed'
      ? lists.find((l) => l.id === plan.list_id)
      : null
  const statusIcon = shownList?.icon ?? (plan && plan !== 'failed' ? plan.list_icon : null)
  const statusColor = shownList?.color ?? (plan && plan !== 'failed' ? plan.list_color : null)

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
        <div className="flex flex-col px-4 pt-1 pb-4">
          {/* The two answers the move needs, in labelled rows rather than a
              page of radio buttons. */}
          <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2 pb-3">
            <span className="text-sm text-ink-2">{PLACES.project}</span>
            <div className="flex min-w-px items-center">
              <ProjectPick projects={projects} value={chosen ?? ''} onPick={pickProject} testId="move-task-project" />
            </div>
            {target && (
              <>
                <span className="text-sm text-ink-2">{TASKS.columnsLists}</span>
                <div className="flex min-w-px items-center gap-1.5">
                  <Dot icon={statusIcon} color={statusColor} />
                  <Select
                    testId="move-task-list"
                    label={TASKS.columnsLists}
                    value={listId ?? ''}
                    onPick={(id) => setListId(id || null)}
                    options={[
                      { id: '', label: W.moveSameStatus },
                      ...lists.filter((l) => !l.intake).map((l) => ({ id: l.id, label: l.name })),
                    ]}
                  />
                </div>
              </>
            )}
          </div>
          {/* What the server says the first move will be. This grows with
              what there is to say rather than keeping a blank panel open. */}
          <div data-testid="move-task-plan" className="flex flex-col gap-1 border-t border-line pt-3 text-sm leading-5 text-ink-2">
            {!target ? (
              <p className="text-ink-3">{W.movePick}</p>
            ) : plan === 'failed' ? (
              <p className="text-danger">{W.couldntMove}</p>
            ) : !plan ? (
              <p className="text-ink-3">{W.moveReading}</p>
            ) : (
              lines.map((l) => <p key={l}>{l}</p>)
            )}
          </div>
        </div>
      )}
    </Dialog>
  )
}
