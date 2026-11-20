import { useRef, useMemo, useEffect, useCallback } from 'react'
import { api } from '../../data/api.js'
import { type Label } from '../kit.jsx'
import { type Task } from './model.jsx'
import { FOLDS_KEY } from './view.jsx'
import { type CardFns } from './board.jsx'
import { type TasksProps } from '../Tasks.jsx'
import { type TaskData } from './useTaskData.js'
import { type BoardMoves } from './useBoardMoves.js'
import { type TaskActions } from './useTaskActions.js'
import { type ListShape } from './useListShape.js'
import { type CardRenderer } from './cardRenderer.jsx'

/**
 * What a board card reads, the keys on the list — taking, and the letters
 * that open a row's own controls — the labels a task can be given, and
 * folding a band.
 */
export function useTaskKeys({
  projectId,
  projectKey,
  canWrite,
  tasks,
  shows,
  folds,
  setFoldsState,
  byKey,
  setOpen,
  people,
  lists,
  cycles,
  patch,
  byColumn,
  taken,
  setTaken,
  today,
  setOnTask,
  parts,
  allLabels,
  setAllLabels,
  foldKey,
  walkable,
  at,
  setAt,
  take,
  card,
}: Pick<TasksProps, 'projectId' | 'projectKey' | 'canWrite'> &
  Pick<
    TaskData,
    'tasks' | 'shows' | 'folds' | 'setFoldsState' | 'byKey' | 'setOpen' | 'people' | 'lists' | 'cycles' | 'patch' | 'byColumn'
  > &
  Pick<BoardMoves, 'taken' | 'setTaken'> &
  Pick<TaskActions, 'today' | 'setOnTask'> &
  Pick<ListShape, 'parts' | 'allLabels' | 'setAllLabels' | 'foldKey' | 'walkable' | 'at' | 'setAt' | 'take'> &
  Pick<CardRenderer, 'card'>) {
  /*
   * What a board card reads, for `BoardCard`: the handlers by reference,
   * and what it draws as one value that changes when any of it does.
   * `card` reads more than this — `move`, `patch`, `setPriority` — but
   * those act only on what is listed here, or are stable.
   */
  const cardFns = useRef<CardFns>(null as unknown as CardFns)
  cardFns.current = { canWrite, setOnTask, take, byColumn, taken, setTaken, setOpen, card }
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new object whenever anything a card draws changes, so BoardCard draws again then and only then
  const look = useMemo(() => ({}), [shows, projectKey, people, canWrite, lists, cycles, byKey, today])
  const partsSaid = (id: string): string => {
    const of = parts.get(id)
    return of ? `${of.filter((c) => c.completed_at).length}/${of.length}` : ''
  }

  /* Escape puts it down, and so does the screen changing under it: a
     selection that outlives what it was made from is a count nobody can
     account for. */
  useEffect(() => {
    if (taken.size === 0) return
    const key = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      if (e.key === 'Escape') {
        /* A menu open over the selection is what Escape is for first: it
           shuts, and the selection stays. One key took both away. */
        if (document.querySelector('[role="menu"]')) return
        e.preventDefault()
        setTaken(new Set())
      }
      /* The row the cursor is on, which is the one the arrow keys moved to.
         The gesture that was missing rather than a new idea. */
      if (e.key === 'x' || e.key === 'X') {
        const row = walkable[at]
        if (!row) return
        e.preventDefault()
        take(row.id, 'one')
      }
    }
    /* Heard first, in the capture phase. A menu shuts on Escape too, and
       React draws it gone between one listener and the next — so heard
       after it, this found no menu and took the selection as well. */
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [taken.size, at, walkable, take, setTaken])

  /* And `x` with nothing taken yet, which the effect above is not listening
     for because it only runs while something is. */
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      if (e.key !== 'x' && e.key !== 'X') return
      const row = walkable[at]
      if (!row) return
      e.preventDefault()
      take(row.id, 'one')
    }
    if (taken.size > 0) return
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [taken.size, at, walkable, take])

  /*
   * A letter opens the control that is already on the row — `docs/specs/keyboard.md`.
   *
   * It presses the thing the row draws rather than doing the work itself,
   * which is the whole rule: a letter that acts on its own is a letter
   * somebody presses by accident, and this product deliberately has no undo.
   * It also means there is one control per question — the key does not know
   * what assigning is, it finds the thing that already knows and presses it,
   * the way a hand would.
   */
  useEffect(() => {
    const WHICH: Record<string, string> = {
      s: '[data-status]',
      p: '[data-priority]',
      a: '[data-who]',
    }
    const key = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      /* A modifier means something else entirely — and cmd+p is the browser's. */
      if (e.metaKey || e.ctrlKey || e.altKey) return
      /* While a menu is open its own digits are picking; a second menu over
         the first is two questions and one answer. */
      if (document.querySelector('[data-status-menu],[data-priority-menu],[data-who-menu]')) return
      const want = WHICH[e.key.toLowerCase()]
      if (!want) return
      const row = document.querySelector('[data-task][data-lit]')
      const control = row?.querySelector<HTMLElement>(want)
      if (!control || (control as HTMLButtonElement).disabled) return
      e.preventDefault()
      control.click()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])

  /*
   * Every label in the workspace, for the picker and for the bands.
   *
   * Once per screen rather than per row: a label is a word in a workspace,
   * not a property of the task that happens to carry it.
   *
   * The state itself is declared above the bands, because grouping by label
   * reads it: a `const` read before its line is a dead-zone error, and one
   * that only fires on the grouping that reaches it — every other grouping
   * draws fine while `?group=label` is a blank screen.
   */
  const loadLabels = useCallback(async () => {
    const r = await api<{ labels: Label[] }>(`/projects/${projectId}/labels`).catch(() => ({ labels: [] }))
    setAllLabels(r.labels)
  }, [projectId, setAllLabels])
  useEffect(() => {
    void loadLabels()
  }, [loadLabels])

  /**
   * Made by name, and the same name twice is the same label.
   *
   * The colour travels with it and may be nothing, which is the ordinary
   * answer: a label nobody had an opinion about takes the one its id works
   * out, as every label did before a colour could be chosen.
   */
  const makeLabel = useCallback(
    async (name: string, color?: string | null): Promise<Label | null> => {
      const made = await api<Label>(`/projects/${projectId}/labels`, {
        method: 'POST',
        body: JSON.stringify({ name, ...(color ? { color } : {}) }),
      }).catch(() => null)
      /* In the list at once; the full read can follow in its own time. */
      if (made) {
        setAllLabels((had) => (had.some((l) => l.id === made.id) ? had : [...had, made]))
        void loadLabels()
      }
      return made
    },
    [projectId, loadLabels, setAllLabels],
  )

  /** The labels every taken task has — the ones the bar's menu ticks. */
  const sharedLabels = useMemo(() => {
    const picked = (tasks ?? []).filter((t) => taken.has(t.id))
    if (picked.length === 0) return []
    return allLabels.filter((l) => picked.every((t) => (t.labels ?? []).some((x) => x.id === l.id)))
  }, [tasks, taken, allLabels])

  /** The same change to every one of them, one request each. */
  const toAll = useCallback(
    (change: Partial<Task>, body: Record<string, unknown>) => {
      for (const id of taken) void patch(id, change, body)
    },
    [taken, patch],
  )
  /*
   * Folding and unfolding a band.
   *
   * The cursor goes with it: it was counted against the rows the screen was
   * drawing, and folding away the band it was in leaves it pointing at a
   * row somewhere else. Nowhere is the honest answer, and the next arrow
   * press starts again from the top.
   */
  const fold = (key: string, on: boolean) => {
    const next = new Set(folds)
    if (on) next.add(foldKey(key))
    else next.delete(foldKey(key))
    setFoldsState(next)
    setAt(-1)
    try {
      localStorage.setItem(FOLDS_KEY, JSON.stringify([...next]))
    } catch {
      // Nothing to do and nothing to say: the band still moved.
    }
  }
  return {
    cardFns,
    look,
    partsSaid,
    makeLabel,
    sharedLabels,
    toAll,
    fold,
  } as const
}
export type TaskKeys = ReturnType<typeof useTaskKeys>
