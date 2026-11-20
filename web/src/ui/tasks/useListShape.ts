import { useMemo, useCallback, useState, useEffect } from 'react'
import { HEADS } from '../../data/words.js'
import { TASKS as W } from '../../words/tasks.js'
import { type Label, PRIORITY_SAID, PRIORITIES, useListKeys } from '../kit.jsx'
import { near } from '../TaskDetail.jsx'
import { type Task, inKeyOrder, inOrder } from './model.jsx'
import { type TasksProps } from '../Tasks.jsx'
import { type TaskData } from './useTaskData.js'
import { type BoardMoves } from './useBoardMoves.js'
import { type TaskActions } from './useTaskActions.js'

/**
 * The list as drawn: sub-tasks under their parents, the bands, and the
 * cursor that walks the rows.
 */
export function useListShape({
  projectId,
  group,
  sort,
  dir,
  list,
  tasks,
  folds,
  justDone,
  setOpen,
  people,
  lists,
  cycles,
  fitsWho,
  fitsLabels,
  setTaken,
  anchor,
  today,
}: Pick<TasksProps, 'projectId' | 'group' | 'sort' | 'dir' | 'list'> &
  Pick<TaskData, 'tasks' | 'folds' | 'justDone' | 'setOpen' | 'people' | 'lists' | 'cycles' | 'fitsWho' | 'fitsLabels'> &
  Pick<BoardMoves, 'setTaken' | 'anchor'> &
  Pick<TaskActions, 'today'>) {
  /**
   * A task's parts, by the task they are parts of.
   *
   * Always in `sort_key` order, whatever the list is sorted by. The order of
   * a task's parts is a fact about that task; re-sorting them by due date
   * every time somebody sorts the list would shuffle the inside of a task
   * for a reason that is about the outside of it.
   */
  const parts = useMemo(() => {
    const map = new Map<string, Task[]>()
    for (const t of tasks ?? []) {
      if (!t.parent_id) continue
      const at = map.get(t.parent_id)
      if (at) at.push(t)
      else map.set(t.parent_id, [t])
    }
    for (const rows of map.values()) rows.sort(inKeyOrder)
    return map
  }, [tasks])

  /**
   * What the list is showing, and in what order.
   *
   * It used to be every task in `sort_key` order, which is an order nobody
   * can name: the dates ran 18, 17, 20, 19 September and the eye read that as
   * unordered. Sorting, filtering and grouping are how somebody looking at
   * forty rows finds the one they came for.
   *
   * Only whole tasks are rows here. A part is never a row of its own — it is
   * drawn under the task it belongs to, in that task's place, because a part
   * that floats away from its parent under a sort is a line nobody can read.
   */
  const shown = useMemo(() => {
    const keep = (t: Task) => (list === null || t.list_id === list) && fitsWho(t) && fitsLabels(t)

    /* A whole task is drawn when it survives, or when something under it
       does — otherwise filtering to "mine" hides my subtask along with the
       task it is a part of, and the work goes missing rather than narrowing. */
    const rows = (tasks ?? []).filter((t) => !t.parent_id && (keep(t) || (parts.get(t.id) ?? []).some(keep)))

    return inOrder(rows, sort, dir)
  }, [tasks, parts, list, fitsWho, fitsLabels, sort, dir])

  /** The parts of one task that survive the same narrowing its parent did. */
  // biome-ignore lint/correctness/useExhaustiveDependencies: justDone is the trigger: a task just finished stays in view until the view changes
  const partsShown = useCallback(
    (parent: Task) => (parts.get(parent.id) ?? []).filter((t) => (fitsWho(t) || fitsWho(parent)) && (fitsLabels(t) || fitsLabels(parent))),
    [parts, fitsWho, fitsLabels, justDone],
  )

  /*
   * Finished work goes to the bottom, folded.
   *
   * Left in place it is most of the list within a month, and every row of it
   * is a row somebody has to read past to reach the work that is not done.
   */
  /* Declared here and loaded further down, because the bands read it. */
  const [allLabels, setAllLabels] = useState<Label[]>([])

  /*
   * The list, in bands.
   *
   * It has only ever been flat: the list chips filtered to one list, which
   * answers "show me only this" rather than "show me how it divides".
   *
   * Grouped or not, the rows come out in one order and the keyboard walks
   * that order — a cursor that counts rows the screen has rearranged is a
   * cursor that lands somewhere else.
   */
  /* A band's name in storage. The project and the grouping are in it because
     "0" under Due and "0" under Assignee are not the same band, and neither
     are two projects' Backlogs. */
  const foldKey = (key: string) => `${projectId}:${group}:${key}`
  const shut = (key: string) => folds.has(foldKey(key))

  const bands = useMemo(() => {
    /*
     * A band's `at` is where the thing it is named after stands, not where
     * the first task that happened to be in it landed. Bands used to come
     * out in the order the rows were read, so a project whose oldest task
     * was finished drew Backlog, Done, Doing, In review — the lists in the
     * order somebody's work had touched them, which is no order at all.
     * Backlog before Done is the whole reason a list has a place.
     */
    const named = (t: Task): { key: string; said: string; at: number } => {
      if (group === 'who') {
        const id = t.assignee_id
        const at = people.findIndex((x) => x.actor_id === id)
        const p = at < 0 ? undefined : people[at]
        return { key: id ?? '~', said: p?.name ?? W.noAssignee, at: p ? at : Infinity }
      }
      if (group === 'label') {
        /* One band per label, and a task under each of its own — the one
           place in this product where a row appears twice. A task that is
           both a bug and a client request is in both bands, and showing it
           once under whichever label came first would be a lie about which
           band it is in. */
        const first = t.labels?.[0]
        return first
          ? { key: first.id, said: first.name, at: allLabels.findIndex((l) => l.id === first.id) }
          : { key: '~', said: W.noLabels, at: Infinity }
      }
      if (group === 'priority') {
        const p = t.priority
        return {
          key: p ?? '~',
          said: p ? PRIORITY_SAID[p] : W.noPriority,
          at: p ? PRIORITIES.indexOf(p) : Infinity,
        }
      }
      if (group === 'due') {
        if (!t.due_on) return { key: '~', said: W.noDueDate, at: Infinity }
        return t.due_on <= today ? { key: '0', said: W.dueByToday, at: 0 } : { key: '1', said: W.dueLater, at: 1 }
      }
      if (group === 'cycle') {
        /* In the order the cycles run, newest first — the same order the
           picker offers them in, so a band and a menu agree. */
        const at = cycles.findIndex((y) => y.id === t.cycle_id)
        const y = at < 0 ? undefined : cycles[at]
        return { key: y?.id ?? '~', said: y?.name ?? HEADS.noCycle, at: y ? at : Infinity }
      }
      const at = lists.findIndex((x) => x.id === t.list_id)
      const l = at < 0 ? undefined : lists[at]
      return { key: l?.id ?? '~', said: l?.name ?? W.noList, at: l ? at : Infinity }
    }
    const out: { key: string; said: string | null; at: number; rows: Task[] }[] = []
    for (const t of shown) {
      const { key, said, at } = named(t)
      const band = out.find((b) => b.key === key)
      if (band) band.rows.push(t)
      else out.push({ key, said, at, rows: [t] })
    }
    /* Whatever has no answer goes last — `at` is Infinity for it. A band
       called "Nobody" at the top is the first thing read on a screen about
       what people are doing. The sort is stable, so two bands standing in
       the same place keep the order the rows gave them. */
    return out.sort((a, b) => a.at - b.at)
  }, [shown, group, lists, cycles, people, allLabels, today])

  /*
   * Every row the screen draws, in the order it draws them: a task, then its
   * parts, then the next task. The keyboard walks this, so a part is reached
   * by pressing down from its parent — which is where the eye already is.
   */
  /* A row inside a shut band is not walked. The keyboard moving onto
     something nobody can see is a cursor that has left the screen. */
  const walkable = bands.flatMap((b) => (shut(b.key) ? [] : b.rows.flatMap((t) => [t, ...partsShown(t)])))

  /*
   * Where each row is in that walk, asked by id.
   *
   * It was arithmetic before — `bands.slice(0, b).reduce(…) + j` in one
   * place and a count of the open work plus `i` in another, for the same
   * row. The two
   * agreed only while every band row was exactly one line on screen, which
   * stopped being true the moment a task could have parts under it. An id is
   * the thing that does not need the two sums to match.
   */
  const indexOf = useMemo(() => {
    const at = new Map<string, number>()
    walkable.forEach((t, i) => at.set(t.id, i))
    return at
  }, [walkable])
  const { at, setAt } = useListKeys(walkable, (t) => setOpen(t.id))
  /* The row the keys are on is read ahead, as the one under the pointer is:
     moving down a list with j and opening with Enter is the same gesture. */
  useEffect(() => {
    const t = at >= 0 ? walkable[at] : undefined
    if (t) near(t.id)
  }, [at, walkable])

  const take = useCallback(
    /* `along` is the order a range runs in. The list has one order and passes
       nothing; the board has one per column and passes that column. */
    (id: string, how: 'one' | 'range', along?: { id: string }[]) => {
      setTaken((was) => {
        const next = new Set(was)
        if (how === 'range' && anchor.current) {
          const order = (along ?? walkable).map((t) => t.id)
          const from = order.indexOf(anchor.current)
          const to = order.indexOf(id)
          if (from >= 0 && to >= 0) {
            for (const x of order.slice(Math.min(from, to), Math.max(from, to) + 1)) next.add(x)
            return next
          }
        }
        if (next.has(id)) next.delete(id)
        else next.add(id)
        anchor.current = id
        return next
      })
    },
    [walkable, setTaken, anchor],
  )
  return {
    parts,
    partsShown,
    allLabels,
    setAllLabels,
    foldKey,
    shut,
    bands,
    walkable,
    indexOf,
    at,
    setAt,
    take,
  } as const
}
export type ListShape = ReturnType<typeof useListShape>
