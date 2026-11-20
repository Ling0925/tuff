import { useCallback, useEffect, useRef, useState } from 'react'
import type { ProjectInList, TaskCopied } from '@tracker/shared-schema'
import { MORE } from '../data/words.js'
import { TASK_DETAIL as W } from '../words/taskDetail.js'
import { api } from '../data/api.js'
import { recall } from '../data/memory.js'
import { numbered } from '../data/route.js'
import { Button, Dialog } from './kit.jsx'
import { Icon } from './glyphs.jsx'
import { ProjectMark, markOf } from './icons.jsx'

/**
 * A copy of a task in a project.
 *
 * The projects this person may make tasks in — this one too, which is a
 * duplicate — and under them what the copy will be: its list, its parts
 * and files, and what it leaves off. The plan is the server's (`dry:
 * true`), read ahead while the pointer is on a row so choosing draws it at
 * once, and the room for it is there before anything is chosen, so nothing
 * under the list moves.
 *
 * The press waits for the server: the copy's number is the server's to
 * give, and the screen opens the copy at its address once it has one.
 */
export function CopyTaskDialog({
  taskId,
  handle,
  projectId,
  onClose,
  onCopied,
}: {
  taskId: string
  /** What a sentence calls it: `STU-41`. */
  handle: string
  /** The project it is in, offered first: copied there, it is a duplicate. */
  projectId: string
  onClose: () => void
  /** Made: where the copy is. */
  onCopied: (to: { projectId: string; id: string; number: number; tasks: TaskCopied['tasks'] }) => void
}) {
  const [every, setEvery] = useState<ProjectInList[]>(() => recall<{ projects?: ProjectInList[] }>('shell')?.projects ?? [])
  /* And asked again behind it, for a project made since the shell last
     read: added at the foot, never reordering a row under the pointer. */
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
  const open = every.filter((p) => !p.archived_at && (p.can ?? []).includes('task.create'))
  /* This project first: the copy somebody most often wants is the next one
     beside it. */
  const projects = [...open.filter((p) => p.id === projectId), ...open.filter((p) => p.id !== projectId)]

  const [chosen, setChosen] = useState<string | null>(null)
  const [plans, setPlans] = useState<Record<string, TaskCopied | 'failed'>>({})
  const asked = useRef(new Set<string>())
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<string | null>(null)

  const ask = useCallback(
    (to: string) => {
      if (asked.current.has(to)) return
      asked.current.add(to)
      void api<TaskCopied>(`/tasks/${taskId}/copy`, {
        method: 'POST',
        body: JSON.stringify({ project_id: to, dry: true }),
      })
        .then((plan) => setPlans((was) => ({ ...was, [to]: plan })))
        .catch(() => {
          asked.current.delete(to)
          setPlans((was) => ({ ...was, [to]: 'failed' }))
        })
    },
    [taskId],
  )
  useEffect(() => {
    if (chosen) ask(chosen)
  }, [chosen, ask])

  const plan = chosen ? plans[chosen] : undefined
  const target = projects.find((p) => p.id === chosen)
  const ready = Boolean(target && plan && plan !== 'failed')

  const go = async () => {
    if (!target || !ready) return
    setBusy(true)
    setSaid(null)
    try {
      const made = await api<TaskCopied>(`/tasks/${taskId}/copy`, {
        method: 'POST',
        body: JSON.stringify({ project_id: target.id }),
      })
      if (!made.id || made.number == null) throw new Error('no copy')
      /* The address knows the copy's number before it is asked to say it. */
      numbered([{ id: made.id, number: made.number }], target.id, 'task')
      onCopied({ projectId: target.id, id: made.id, number: made.number, tasks: made.tasks })
    } catch {
      setSaid(W.couldntCopy)
      setBusy(false)
    }
  }

  const names = (people: { name: string }[]) => people.map((p) => p.name).join(', ')
  const lines =
    target && plan && plan !== 'failed'
      ? [
          target.id === projectId ? W.copyHere : W.copyThere(target.name),
          plan.list_name ? W.copyList(plan.list_name) : null,
          plan.subtasks > 0 ? W.copyParts(plan.subtasks) : null,
          plan.files > 0 ? W.copyFiles(plan.files) : null,
          plan.labels_dropped.length ? W.copyLabels(plan.labels_dropped.join(', ')) : null,
          plan.assignees_dropped.length ? W.copyUnassigned(names(plan.assignees_dropped), target.name) : null,
          W.copyNotCarried,
          plan.github_to ? W.copyGithubTo(target.name) : null,
        ].filter((l): l is string => Boolean(l))
      : []

  return (
    <Dialog
      title={W.copyTitle(handle)}
      testId="copy-task-dialog"
      onClose={onClose}
      footer={
        <div className="flex flex-1 items-center justify-end gap-2">
          {/* In the footer, whose height is fixed, so a refusal does not
              grow the window under the pointer. */}
          <p role="alert" className="mr-auto min-w-px truncate text-sm text-danger">
            {said}
          </p>
          <button onClick={onClose} className="h-8 px-3 text-base font-medium text-ink-2">
            {MORE.cancel}
          </button>
          <Button tone="primary" data-testid="copy-task-go" disabled={!ready || busy} onClick={() => void go()}>
            {busy ? W.copying : W.copy}
          </Button>
        </div>
      }
    >
      {projects.length === 0 ? (
        <p className="px-4 pt-2 pb-4 text-base leading-5 text-ink-2">{W.copyNowhere}</p>
      ) : (
        <div className="flex flex-col">
          <div role="radiogroup" aria-label={W.copyTitle(handle)} className="flex max-h-[240px] flex-col overflow-y-auto px-2 pt-1 pb-2">
            {projects.map((p) => {
              const on = p.id === chosen
              return (
                <button
                  key={p.id}
                  data-row
                  role="radio"
                  aria-checked={on}
                  data-testid="copy-task-project"
                  onPointerEnter={() => ask(p.id)}
                  onFocus={() => ask(p.id)}
                  onClick={() => setChosen(p.id)}
                  className="flex w-full shrink-0 items-center gap-3 px-2 text-left text-base text-ink"
                  style={{
                    height: 'var(--row-h)',
                    borderRadius: 'var(--r-row)',
                    background: on ? 'var(--hover)' : undefined,
                  }}
                >
                  <ProjectMark {...markOf(p)} size={20} />
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                  {p.id === projectId && <span className="text-sm text-ink-3">{W.copyThisProject}</span>}
                  {/* Always there, seen or not, so choosing does not move
                      the name beside it. */}
                  <Icon name="check" size={16} className="text-accent" style={{ opacity: on ? 1 : 0 }} />
                </button>
              )
            })}
          </div>
          {/* What the copy will be, in room kept for it from the start. */}
          <div
            data-testid="copy-task-plan"
            className="flex h-[168px] flex-col gap-1 overflow-y-auto px-4 pt-3 pb-4 text-sm leading-5 text-ink-2"
            style={{ borderTop: '1px solid var(--line)' }}
          >
            {!target ? (
              <p className="text-ink-3">{W.copyPick}</p>
            ) : plan === 'failed' ? (
              <p className="text-danger">{W.couldntCopy}</p>
            ) : (
              lines.map((l) => <p key={l}>{l}</p>)
            )}
          </div>
        </div>
      )}
    </Dialog>
  )
}
