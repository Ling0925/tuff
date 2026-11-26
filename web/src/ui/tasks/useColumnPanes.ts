import { useRef, useState, useCallback, useEffect } from 'react'
import { near } from '../TaskDetail.jsx'
import { type Task } from './model.jsx'
import { LEFT_AT, LEFT_REACH } from './board.jsx'
import { type TasksProps } from '../Tasks.jsx'
import { type TaskData } from './useTaskData.js'
import { type TaskActions } from './useTaskActions.js'
import { type ListShape } from './useListShape.js'

/**
 * The board's columns as panes: which one is in view on a phone, and
 * paging between them.
 */
export function useColumnPanes({
  projectId,
  mode,
  list,
  view,
  isShut,
  open,
  setOpen,
  lists,
  byColumn,
  setTriageStart,
  walkable,
  indexOf,
  setAt,
  peopleWalk,
}: Pick<TasksProps, 'projectId' | 'mode' | 'list'> &
  Pick<TaskData, 'view' | 'isShut' | 'open' | 'setOpen' | 'lists' | 'byColumn'> &
  Pick<TaskActions, 'setTriageStart'> &
  Pick<ListShape, 'walkable' | 'indexOf' | 'setAt'> & {
    /** The people view's tasks, card by card. */
    peopleWalk: Task[]
  }) {
  /*
   * Where the list was left, so coming back out of a task is coming back.
   *
   * Opening a task returns `TaskDetail` instead of the list below — an early
   * return, so the pane and its scroll position are unmounted and a fresh one
   * starts at the top. On a long list that means scrolling to the fortieth
   * task, opening it, closing it and being back at the first.
   *
   * Written on the way out rather than on every scroll event: the position
   * only matters at the moment the pane is about to go, and a listener on a
   * pane that holds a thousand rows is a cost paid continuously for a value
   * read once.
   *
   * Kept per project and per view, because they are different lists: the
   * place somebody reached in Backlog says nothing about where they are in
   * the board, and restoring one into the other is a jump to a row they were
   * never looking at.
   */
  /*
   * Where the list was left, so coming back out of a task is coming back.
   *
   * Opening a task returns `TaskDetail` instead of the list — an early
   * return, so the pane is unmounted and a fresh one starts at the top. On a
   * long list that means scrolling to the fortieth task, opening it, closing
   * it, and being back at the first.
   *
   * Through a ref callback rather than an effect. Two attempts failed before
   * this one and both for the same reason: an effect runs against whatever
   * the ref holds at that moment, and this pane lives inside `view === 'list'`
   * below an early return, so on the way out there is no cleanup to run and
   * on the way back the node does not exist yet. A ref callback is called
   * exactly when the node appears and again when it goes, which is the two
   * moments this needs and nothing in between.
   *
   * Kept per project and per view, because they are different lists: the
   * place somebody reached in Backlog says nothing about where they are on
   * the board, and restoring one into the other is a jump to a row they were
   * never looking at.
   */
  /* One node per column, so each column's fade can ask its own scroller
     how much is left below it. Keyed by list id and written by the ref on
     the scroller, which is the only place the node is known. */
  const columnPanes = useRef(new Map<string, { current: HTMLDivElement | null }>())
  const columnPane = (id: string) => {
    let r = columnPanes.current.get(id)
    if (!r) {
      r = { current: null }
      columnPanes.current.set(id, r)
    }
    return r
  }
  /*
   * Outside the component, because the component is what goes.
   *
   * It was a `useRef`, which lives exactly as long as the `Tasks` that
   * holds it — and every path that loses the place unmounts `Tasks`:
   * opening a tab, switching to the board, going to a task and back. The
   * number was saved correctly and then thrown away with the thing
   * holding it, so the restore asked for a key that had just stopped
   * existing.
   *
   * A module-level map is the scope the thing actually has: where
   * somebody is in a list belongs to the session, not to one mounting of
   * one screen. Keyed by project, view and list, so two lists cannot
   * restore into each other.
   */
  const place = LEFT_AT
  /* How far each pane could scroll when its place was taken — see `on`. */
  const reached = LEFT_REACH
  const where = `${projectId}:${mode}:${list ?? ''}`
  const fixed = useRef<{ node: HTMLDivElement; off: () => void } | null>(null)
  /* The same node, as a plain ref. `ListBar` beside the pane needs something
     to read, and the callback above is where the node is actually known —
     so it is written here on the way through rather than kept twice. */
  const paneNode = useRef<HTMLDivElement | null>(null)
  const [paneReady, setPaneReady] = useState(0)
  const pane = useCallback(
    (node: HTMLDivElement | null) => {
      /*
       * Going: take the number, unless something already took a better one.
       *
       * This has to read `scrollTop` — a pane can be scrolled and then
       * left by a route change the listener never sees — and it is also
       * the one reading that cannot be trusted on its own. By the time a
       * pane is handed back, the panel beside it has taken its width, the
       * rows have rewrapped and the browser has moved the scroll to keep
       * something in view: the number here was nineteen pixels above
       * where the list actually was, and it overwrote the good one the
       * listener had saved a moment earlier.
       *
       * So it only writes where nothing is written. The listener's number
       * came from a gesture and this one did not, and between two
       * answers the one a person caused is the right one.
       */
      if (fixed.current) {
        const going = fixed.current.node
        const key = going.dataset.place ?? ''
        if (going.scrollTop > 0) place.current.set(key, going.scrollTop)
        fixed.current.off()
        fixed.current = null
      }
      paneNode.current = node
      /* A number rather than a boolean: the pane is torn down and rebuilt
         when the view changes, and the bar has to re-measure each time. */
      setPaneReady((n) => n + 1)
      if (!node) return
      node.dataset.place = where
      /* And while it is here, keep it current — a pane can be scrolled and
         then left by a route change that never touches this callback. */
      /* Zero is never worth remembering: a pane being torn down reports it,
         and that was overwriting the real place on the way out. Somebody
         genuinely at the top has nothing to restore either way. */
      /*
       * And neither is the shove on the way out.
       *
       * Opening a task fires one last `scroll` on this pane before it goes
       * — the panel beside it takes width, the rows rewrap, and the
       * browser moves the scroll to keep something in view. The listener
       * wrote that number over the real one, so coming back landed
       * nineteen pixels above where the list had been left. The height
       * either side was identical, which is why this looked like a
       * failing restore for as long as it did: the restore was perfect
       * and the number it restored was wrong.
       *
       * A scroll nobody asked for is one with no gesture behind it. The
       * pane remembers when it was last touched, and a `scroll` arriving
       * more than a moment after the last wheel, drag or key is the
       * browser's, not a person's.
       */
      /*
       * Saved with the reach it was measured against.
       *
       * Opening a task fires one last `scroll` on this pane while it is
       * going: the panel beside it takes width, the rows rewrap, and the
       * browser moves the scroll to keep something in view. That number
       * is real — it is where the pane is — and it is not where the
       * person left the list, so writing it plainly lost nineteen pixels
       * on every trip into a task and back.
       *
       * What tells the two apart is the pane's own reach. A scroll a
       * person made happens at the height the list had; a shove on the
       * way out happens as that height collapses. So the reach is kept
       * beside the place, and a write is refused when the pane has less
       * of it than the write before — the list is shrinking, and nothing
       * measured against a shrinking box is where anybody was.
       */
      const on = () => {
        if (node.scrollTop <= 0) return
        const reach = node.scrollHeight - node.clientHeight
        const had = reached.current.get(where)
        if (had !== undefined && reach < had) return
        reached.current.set(where, reach)
        place.current.set(where, node.scrollTop)
      }
      node.addEventListener('scroll', on, { passive: true })
      fixed.current = { node, off: () => node.removeEventListener('scroll', on) }
      /*
       * Arriving: put it back once there is something to scroll.
       *
       * Setting it here alone does nothing. The node exists before its rows
       * do — a pane 756 tall with no children clamps 900 to 0, and nothing
       * afterwards tries again, which is why two earlier attempts at this
       * looked like the position was never saved when in fact it was never
       * restorable yet.
       *
       * So the attempt is repeated until the content is tall enough to hold
       * it, and the observer stops as soon as it lands. It also stops if the
       * list came back genuinely shorter — a narrowed view, a task deleted —
       * because then there is no such place to return to and the top is the
       * honest answer.
       */
      const was = place.current.get(where)
      if (!was) return
      /*
       * Landed means it is *there*, not that it was asked for.
       *
       * The guard was "is the content tall enough", which is true a frame
       * before the last rows have their real height: the assignment is
       * clamped to whatever the pane can reach at that instant and the
       * observer disconnects having succeeded. Coming back from a task
       * left the list nineteen pixels above where it was, every time,
       * with the saved number perfectly correct.
       *
       * So it writes and then reads: the browser clamps on assignment, so
       * `scrollTop` afterwards is the truth about whether the place
       * exists yet. A pixel of slack for a subpixel layout.
       */
      const land = () => {
        if (node.scrollHeight - node.clientHeight < was) return false
        node.scrollTop = was
        return Math.abs(node.scrollTop - was) <= 1
      }
      if (!land()) {
        /* Observing the pane itself watches a box that never changes — it is
           the content inside that grows. `subtree` is what catches the rows
           arriving. */
        const watch = new MutationObserver(() => {
          if (land()) watch.disconnect()
        })
        watch.observe(node, { childList: true, subtree: true })
        /* A list that never grows tall enough is a list that changed while
           the task was open. Stop looking rather than watching for ever. */
        setTimeout(() => watch.disconnect(), 2000)
      }
    },
    [where],
  )

  /*
   * What ← and → page through while a task is open — `docs/specs/keyboard.md`.
   *
   * The list behind the task, in the order it draws its rows: the address
   * still says how it is being looked at, so the same grouping, ordering
   * and narrowing that drew the list draw this. On the list that is the walk
   * the cursor takes, parts under their task and nothing from a shut band;
   * on the board, each open column top to bottom, left to right; in the
   * people view, card by card, each task once.
   */
  const pagesThrough: Task[] = !open
    ? []
    : view === 'board'
      ? lists.filter((l) => !isShut(l.id)).flatMap((l) => byColumn.get(l.id) ?? [])
      : view === 'people'
        ? peopleWalk
        : walkable
  const here = open ? pagesThrough.findIndex((t) => t.id === open) : -1
  const before = here > 0 ? pagesThrough[here - 1] : undefined
  const after = here >= 0 ? pagesThrough[here + 1] : undefined
  /* Both neighbours read ahead, so the one the key opens is drawn whole —
     the same bargain the pointer makes with the row it is resting on. */
  // biome-ignore lint/correctness/useExhaustiveDependencies: warmed by id: the same task in a new object is not a new task
  useEffect(() => {
    if (before) near(before.id)
    if (after) near(after.id)
  }, [before?.id, after?.id])
  /* The cursor goes with it, so Escape comes back to the list on the task
     the reader paged to rather than the one they started from. */
  const pageTo = (t: Task | undefined) =>
    t
      ? () => {
          if (view === 'list') setAt(indexOf.get(t.id) ?? -1)
          setTriageStart(null)
          setOpen(t.id)
        }
      : undefined
  return {
    columnPane,
    paneNode,
    paneReady,
    pane,
    before,
    after,
    pageTo,
  } as const
}
export type ColumnPanes = ReturnType<typeof useColumnPanes>
