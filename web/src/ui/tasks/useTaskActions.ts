import { useState, useCallback } from 'react'
import { dropUndo } from '../../data/undo.js'
import { TASKS as W } from '../../words/tasks.js'
import { api } from '../../data/api.js'
import { today as todayHere } from '../../data/calendar.js'
import { type Task } from './model.jsx'
import { type TaskData } from './useTaskData.js'
import { type BoardMoves } from './useBoardMoves.js'

/**
 * What can be done to a task from its menu: duplicate, delete, put back.
 */
export function useTaskActions({
  tasks,
  setTasks,
  load,
  lay,
  setTaken,
  undone,
  undo,
  setUndo,
  gone,
  back,
}: Pick<TaskData, 'tasks' | 'setTasks' | 'load' | 'lay'> & Pick<BoardMoves, 'setTaken' | 'undone' | 'undo' | 'setUndo' | 'gone' | 'back'>) {
  const today = todayHere()

  /**
   * One line of the list, whole task or part.
   *
   * Written once because it is drawn in three places — in a band, under its
   * parent, and in the folded Done section — and three copies of a row is
   * three chances for one of them to stop matching the others. The only
   * difference a part makes is the indent and the missing count.
   */
  /*
   * Whether the column is worth its 150 pixels on this list.
   *
   * The facts are drawn whether or not a row has them, which is what makes
   * them columns — but a project where nobody has ever used a label would
   * give up a fifth of its titles to a column that is empty on every line.
   * Asked of the list rather than of the row, so the column is there for
   * all of them or for none, which is the whole point of a column.
   */
  const anyLabels = (tasks ?? []).some((t) => (t.labels?.length ?? 0) > 0)

  /*
   * What a right-click offers on a row or a card.
   *
   * Two verbs, because they are the two a list has that the task's own
   * screen makes you travel for. Everything else about a task is already
   * on the row — the list, the priority, the date, who has it — and a
   * menu repeating controls that are an inch away is a second way to do
   * what the hand is already on.
   *
   */
  const [onTask, setOnTask] = useState<{ id: string; x: number; y: number } | null>(null)
  /* A task opened from the menu to be marked a duplicate. */
  const [triageStart, setTriageStart] = useState<'duplicate' | null>(null)
  /*
   * What was just deleted, for as long as it can be put back.
   *
   * Asking first was built and taken out: a dialog on every delete is a
   * press everybody learns to click through, and the thing it protects
   * against — a right-click gone wrong on a trackpad — is better answered
   * by letting the delete happen and offering it back. The work is gone
   * from the screen at once, which is what was wanted, and the way out is
   * one press rather than one press prevented.
   *
   * Deleting is soft, so there is a row to restore for as long as the
   * clear-out leaves it. Ten seconds is the offer; after that the toast
   * goes and the task is in the clear-out's hands like everything else.
   */

  /* The copy is on the screen under its original at once — the same place
     the server puts it — and the server's rows, which the answer carries,
     take its place. It read the whole project again for them, and waited
     for both before that. */
  const duplicate = useCallback(
    async (id: string) => {
      setOnTask(null)
      const pending = `pending:${Date.now()}`
      setTasks((prev) => {
        const all = prev ?? []
        const from = all.find((t) => t.id === id)
        if (!from) return all
        const at = all.indexOf(from)
        const copy = { ...from, id: pending, number: null, completed_at: null } as unknown as Task
        return [...all.slice(0, at + 1), copy, ...all.slice(at + 1)]
      })
      const made = await api<{ id: string; tasks?: Task[] }>(`/tasks/${id}/duplicate`, { method: 'POST' }).catch(() => null)
      setTasks((prev) => (prev ?? []).filter((t) => t.id !== pending))
      if (made?.tasks?.length) lay(made.tasks)
      else if (made) await load()
    },
    [load, lay, setTasks],
  )

  // biome-ignore lint/correctness/useExhaustiveDependencies: gone only sends a request, and undone is a ref
  const remove = useCallback(
    async (id: string, title: string) => {
      setOnTask(null)
      /* Gone from the screen before the server answers, like every other
         write here. Put back by the refetch if it refused. */
      setTasks((prev) => (prev ?? []).filter((t) => t.id !== id && t.parent_id !== id))
      setUndo({ ids: [id], said: W.deletedOne(title) })
      /* The newest delete is the one offered back — `data/undo.ts`. */
      dropUndo()
      undone.current.push({ kind: 'delete', ids: [id] })
      await gone(id)
      await load()
    },
    [load, setUndo, setTasks],
  )

  /*
   * Everything taken, deleted in one press and put back by one.
   *
   * The same delete a row's own menu makes, done to each — soft, with the
   * restore window everything has — and recorded as one step, so the toast
   * and ⌘Z offer the whole set back rather than the last card of it. No
   * confirmation, for the reason the single delete has none: it is
   * reversible, and asking about a reversible thing is how people learn to
   * click through the asking. `docs/specs/many-at-once.md`.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: gone only sends a request, and undone is a ref
  const removeAll = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0) return
      const leaving = new Set(ids)
      setTasks((prev) => (prev ?? []).filter((t) => !leaving.has(t.id) && !leaving.has(t.parent_id ?? '')))
      setTaken(new Set())
      setUndo({ ids, said: W.deletedMany(ids.length) })
      dropUndo()
      undone.current.push({ kind: 'delete', ids })
      await Promise.all(ids.map(gone))
      await load()
    },
    [load, setTaken, setUndo, setTasks],
  )

  // biome-ignore lint/correctness/useExhaustiveDependencies: back is new on every render and only sends a request
  const putBack = useCallback(async () => {
    const it = undo
    if (!it) return
    setUndo(null)
    /* Taken back by the toast, so not again by the key. */
    undone.current = undone.current.filter((st) => !(st.kind === 'delete' && st.ids.join() === it.ids.join()))
    await Promise.all(it.ids.map(back))
    await load()
  }, [undo, load, undone, setUndo])

  /* The offer expires with the toast that makes it — `UndoBar`. */
  return {
    today,
    anyLabels,
    onTask,
    setOnTask,
    triageStart,
    setTriageStart,
    duplicate,
    remove,
    removeAll,
    putBack,
  } as const
}
export type TaskActions = ReturnType<typeof useTaskActions>
