import { useRef, useCallback, useState, useEffect } from 'react'
import { api } from '../../data/api.js'
import { isKey } from '../../data/keys.js'
import { type Spot, columnAt, slid, useBoardDrag } from '../useDrag.js'
import { type Task, chainKeys } from './model.jsx'
import { type TasksProps } from '../Tasks.jsx'
import { type TaskData } from './useTaskData.js'

/**
 * Carrying cards: where a drop lands, the run that moves with it, the
 * write that follows, and ⌘Z.
 */
export function useBoardMoves({
  canWrite,
  sort,
  tasks,
  setTasks,
  lists,
  load,
  patch,
  byColumn,
  EDGE,
}: Pick<TasksProps, 'canWrite' | 'sort'> & Pick<TaskData, 'tasks' | 'setTasks' | 'lists' | 'load' | 'patch' | 'byColumn' | 'EDGE'>) {
  /**
   * What is taken, for `resolve` to read without being rebuilt on every
   * press — the drag hook holds the callback it was handed.
   */
  const carrying = useRef<Set<string>>(new Set())
  // biome-ignore lint/correctness/useExhaustiveDependencies: board is a ref, read when the pointer moves
  const resolve = useCallback(
    (x: number, y: number, id: string, mid: number, h: number): Spot | null => {
      /*
       * The column under the pointer, found by walking up.
       *
       * It asked for an element that carries `data-list` itself, which is the
       * column and nothing inside it — true while every column was a stack of
       * cards over a scroller, and false the moment one could be narrowed: a
       * narrow column is a single button, so the topmost thing under the
       * pointer was the button and the search walked past the column to the
       * board. `resolve` returned null, no hole was drawn anywhere, and the
       * drop still worked only because `useDrag` keeps the last place a card
       * could have landed. A silent drop, which is the thing this screen
       * promises not to do.
       *
       * And from the columns' boxes now rather than a hit test, which costs
       * in proportion to the cards on the board — `columnAt`. A narrow
       * column is still the element carrying `data-list`, so it is found the
       * same way as a wide one.
       */
      const column = columnAt(board.current, x, y)
      if (!column) return null

      /* The pane's own children, not a search of the column: a search walks
       every node inside every card, 600 cards deep. */
      const pane = column.querySelector('[data-column-scroll]')
      const slots = [...(pane?.children ?? [])].filter((n): n is HTMLElement => n instanceof HTMLElement && n.dataset.slot !== undefined)
      /*
       * Measured against the slots the card is not in.
       *
       * Every slot's midpoint was the threshold, the card's own among them —
       * and its own slot is the hole, which travels with the hand. So the
       * first half of a gesture was spent crossing the middle of the gap the
       * card had just left: to move one place down, the pointer had to reach
       * the middle of the card *after* the next one, 386 pixels where the
       * next boundary was at 308. One slot of intent, two slots of travel,
       * and in between the card appeared to be going nowhere — which is
       * what “I drag it one down and it disappears somewhere below” was.
       *
       * Taking the hole out leaves the cards that are actually staying, and
       * their boundaries are the real ones. The index that comes out is
       * already in “the cards that are staying” terms, which is what every
       * caller wants, so the correction that used to follow is gone with it.
       *
       * The rest of a selection is not staying either. It was counted, and
       * `arranged` splices into a column with all of it taken out, so every
       * taken card above the hand's pushed the hole one place further than
       * it was meant to go: three taken from one column and picked up by the
       * middle one, held still, and the card that had been below them was
       * drawn above the gap. `self` is the hand's place among the staying.
       */
      const along = (slot: HTMLElement) =>
        slot.dataset.slot !== id && !(carrying.current.has(id) && carrying.current.has(slot.dataset.slot!))
      const at = slots.findIndex((slot) => slot.dataset.slot === id)
      const self = at === -1 ? -1 : slots.slice(0, at).filter(along).length
      const others = slots.filter(along)
      let index = others.length
      for (const [i, slot] of others.entries()) {
        /*
         * Measured where the layout put it, not where it looks.
         *
         * The cards close up with a slide — FLIP, below — so for 160ms after
         * the hole moves, a neighbour's box is somewhere between where it was
         * and where it is going. Read as the threshold, that is a feedback
         * loop: the answer moves the hole, the neighbour starts sliding, and
         * part-way through the slide its middle crosses back over the card's
         * and the answer reverts, which starts the slide the other way. Two
         * cards trembling against each other under a still hand, at sixty
         * flips a second, and no nest opening between them — that was the
         * whole of "it jitters", and no rule about *where* the threshold sits
         * could cure a fault about *when* it was read. Every variant tried —
         * tops, edges by direction, the grab point, the seam between
         * neighbours, allowing for the hole's height — trembled the same way,
         * because every one of them read the box mid-slide.
         *
         * `getBoundingClientRect` includes the transform; the layout's own
         * answer is that box less whatever is translating it, which is how
         * the slide itself measures. Against the layout the rule below is
         * stable: moving the hole shifts a neighbour by the hole's height in
         * exactly the direction that keeps the comparison true.
         */
        const sliding = slid.has(slot) ? new DOMMatrixReadOnly(getComputedStyle(slot).transform).m42 : 0
        const box = slot.getBoundingClientRect()
        /*
         * The card's leading edge against the neighbour's middle.
         *
         * It was the card's middle against theirs, which is symmetric and
         * wrong as soon as two cards differ in height. A 160-pixel card laid
         * with its top eight pixels above a 100-pixel one has its middle 72
         * pixels down, past the short card's 50 — so it went under the card
         * it had plainly been put above, and the hand had to lift it another
         * thirty pixels to be believed. The other way round costs travel: to
         * pass a neighbour, the middle had to cover half of *both* cards.
         *
         * The edge that is leading — the top going up, the bottom going down
         * — crossing the middle of the card in the way. Which edge is leading
         * is read from where the neighbour is: above the hole, the card can
         * only be going up past it, and below, only down. So travel is half
         * the neighbour and nothing of the card's own height, whatever either
         * of them measures, and a card whose top is over a neighbour's upper
         * half is above it.
         *
         * It cannot tremble. Passing a neighbour moves it by the card's height
         * plus the gap, the other way, and the edge that would bring it back
         * is the opposite one — a gap plus `EDGE` twice away. A column with no
         * hole in it is judged as if every card were above one, which is the
         * same answer that column will give once the hole has opened there,
         * so arriving from another column does not jump a place either.
         */
        const middle = box.top - sliding + box.height / 2
        const below = self !== -1 && i >= self
        if (below ? mid + h / 2 <= middle + EDGE : mid - h / 2 < middle - EDGE) {
          index = i
          break
        }
      }
      /*
       * With an order on, the only question is which column.
       *
       * The index is what the hole is drawn from, and under a sort it is a
       * place the card will not land — so it was a gap travelling with the
       * pointer, promising a position the drop then ignored. The card's own
       * place is reported instead, which keeps the hole where the card
       * was: nothing moves while it is carried, and the column says where
       * it is going.
       */
      if (sort !== 'manual') return { column: column.dataset.list!, index: self === -1 ? 0 : self }
      return { column: column.dataset.list!, index }
    },
    [sort, EDGE],
  )

  /*
   * What is taken, as against where the cursor is — `docs/specs/many-at-once.md`.
   *
   * Two different things that look alike for one frame: the cursor is where
   * the hand is and moves with it, and a selection has to survive the cursor
   * moving on. Kept as ids rather than positions, because the list rearranges
   * under it — group by assignee while three rows are taken and the positions
   * mean somebody else's work.
   */
  const [taken, setTaken] = useState<Set<string>>(new Set())
  /*
   * The selection bar's own life, a beat longer than the selection's: it
   * stays mounted while it closes, showing the count it closed on, and is
   * lit a frame after it mounts so there is a closed state to open from.
   */
  const [bar, setBar] = useState({ mounted: false, lit: false, count: 0 })
  useEffect(() => {
    if (taken.size > 0) {
      setBar((b) => ({ mounted: true, lit: b.lit, count: taken.size }))
      const frame = requestAnimationFrame(() => requestAnimationFrame(() => setBar((b) => ({ ...b, lit: true }))))
      return () => cancelAnimationFrame(frame)
    }
    setBar((b) => ({ ...b, lit: false }))
    const gone = setTimeout(() => setBar((b) => ({ ...b, mounted: false })), 200)
    return () => clearTimeout(gone)
  }, [taken.size])
  /** Where the last one was taken, so Shift can take the run between. */
  const anchor = useRef<string | null>(null)

  carrying.current = taken

  /**
   * What a drag of this card carries, in the order it lands.
   *
   * Written once because two places need the same answer: `arranged`, which
   * draws the cards in the air, and `commit`, which puts them down. They
   * were two expressions that happened to agree, and the second one was not
   * an order at all — it fired the rest of the selection off at once, each
   * "after the dragged card", so they landed in whatever order the requests
   * arrived and drew by keys from the column they had left.
   *
   * The hand's card first, because it is the one the hand is on and the
   * others follow it. Then the rest as they stood on the board — columns
   * left to right, each top to bottom — rather than in the order of the
   * array, which is the server's order with every optimistic splice since
   * the last load mixed in: three taken top to bottom came down as the
   * middle one, the bottom one, the top one.
   */
  const carriedWith = useCallback(
    (id: string): Task[] => {
      const moved = tasks?.find((t) => t.id === id)
      if (!moved) return []
      if (!taken.has(id)) return [moved]
      const seen = new Set([id])
      const rest: Task[] = []
      const take = (t: Task) => {
        seen.add(t.id)
        rest.push(t)
      }
      for (const l of lists) {
        for (const t of byColumn.get(l.id) ?? []) {
          if (taken.has(t.id) && !seen.has(t.id)) take(t)
        }
      }
      // Anything taken that the board does not draw, after what it does.
      for (const t of tasks ?? []) if (taken.has(t.id) && !seen.has(t.id)) take(t)
      return [moved, ...rest]
    },
    [tasks, taken, lists, byColumn],
  )

  /*
   * Moves made on this board, newest last, so ⌘Z can put them back —
   * `docs/specs/many-at-once.md`.
   *
   * Not the undo the rebuild gave up. Nothing is reversed: a move taken back
   * is another move, through the same `PATCH`, to the column the card left
   * and after the card that was above it then. Kept for as long as the
   * board is open, because that is as long as "the last thing I dragged"
   * means anything.
   */
  type Back = { id: string; list: string | null; after: string | null; key: string }
  /*
   * One history for ⌘Z, moves and deletes together, newest last.
   *
   * They were two: the delete's own Cmd+Z, from before moves could be taken
   * back, and the move's — both listening, so one press after "move two
   * cards, delete one" undid the move and the delete at once. One stack and
   * one key: the press takes back the last thing done, whichever it was.
   */
  type Step = { kind: 'move'; back: Back[] } | { kind: 'delete'; ids: string[] }
  const undone = useRef<Step[]>([])
  /** The last delete, while the toast still offers it back. */
  const [undo, setUndo] = useState<{ ids: string[]; said: string } | null>(null)
  /*
   * Deletes still on their way, by task.
   *
   * Undo is offered the moment the row leaves, before the server has
   * answered, and a quick press sent the restore ahead of the delete: the
   * restore found nothing deleted and said 404, then the delete landed, and
   * the task was gone after all — taken back on the screen and not on the
   * server. A restore waits for its delete.
   */
  const deleting = useRef(new Map<string, Promise<unknown>>())
  const gone = (id: string) => {
    const p = api(`/tasks/${id}`, { method: 'DELETE' }).catch(() => null)
    deleting.current.set(id, p)
    void p.finally(() => {
      if (deleting.current.get(id) === p) deleting.current.delete(id)
    })
    return p
  }
  const back = async (id: string) => {
    await deleting.current.get(id)
    return api(`/tasks/${id}/restore`, { method: 'POST' }).catch(() => null)
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: firstIn is new on every render and reads only its arguments
  const commit = useCallback(
    (id: string, spot: Spot) => {
      const carried = carriedWith(id)
      if (carried.length === 0) return
      const going = new Set(carried.map((t) => t.id))
      /*
       * The column as `arranged` drew it: everything carried taken out, and
       * the drop's index counted among what is left. Taking out only the
       * hand's card counted the rest of a selection still sitting in the
       * column, so the card named as the one to land after was not the one
       * the gap was drawn after.
       */
      const staying = (byColumn.get(spot.column) ?? []).filter((t) => !going.has(t.id))
      /*
       * Where it was dropped, unless an order is deciding that.
       *
       * With a sort on, the column is not in the order anybody dragged it
       * into — so "after this one" would write a key the next draw
       * ignores, and the card would settle somewhere else a frame later.
       * The drag still moves it between columns, which is a list change
       * and the thing a board is mostly for; where it sits inside one is
       * the sort's answer while the sort is on.
       */
      const ordered = sort !== 'manual'
      const after = !ordered && spot.index > 0 ? (staying[spot.index - 1]?.id ?? null) : null

      /* Where each one stood, as the card above it — read top to bottom, so
         putting them back in this order finds every anchor already home. A
         drop where it was picked up is not a move and is not kept. */
      const back: Back[] = []
      for (const l of lists) {
        const rows = byColumn.get(l.id) ?? []
        rows.forEach((t, i) => {
          if (!going.has(t.id)) return
          back.push({
            id: t.id,
            list: t.list_id,
            after: ordered || i === 0 ? null : rows[i - 1]!.id,
            key: t.sort_key,
          })
        })
      }
      if (back.some((b) => b.list !== spot.column || (!ordered && b.after !== after)) || back.length > 1)
        undone.current.push({ kind: 'move', back })

      /*
       * The board moves first, and it moves all the way.
       *
       * Changing only the column would leave a card sorted by the key it had
       * before, so it would land in the right column at the wrong height and
       * settle a moment later. The board draws `byColumn`, and `byColumn`
       * sorts every column by `sort_key`: array order is not what is
       * rendered, so every card carried gets the key it is going to have.
       * Spliced without one, a card is held in place by `arranged` only
       * until the 170ms settle ends, and then drawn by its old key.
       *
       * Going to have, not merely a key that sorts right. The requests go
       * one after another, each after the card before it, and the server
       * keys each between its anchor and the next card it finds — so this
       * walks the same column the same way, through the same function, and
       * its answers confirm these keys rather than correcting them. The
       * server still decides: `patch` writes the real key over each one.
       */
      const keys = chainKeys(tasks ?? [], spot.column, carried, after)
      const now = new Date().toISOString()
      setTasks((prev) => {
        const without = (prev ?? []).filter((t) => !going.has(t.id))
        const next = carried.map((t) => {
          const key = keys.get(t.id)
          return { ...t, list_id: spot.column, ...(key ? { sort_key: key } : {}), decided_at: now }
        })
        const at = after ? without.findIndex((t) => t.id === after) + 1 : firstIn(without, spot.column)
        without.splice(at, 0, ...next)
        return without
      })

      /*
       * And the rest of the selection comes with it, one after another.
       *
       * Dragging a card that is one of four taken and leaving the other three
       * behind is the gesture half-done: the selection said these four are
       * one thing and the drag said only this one is. They land after the
       * dragged card rather than at the pointer, because there is one pointer
       * and four cards. `docs/specs/many-at-once.md`.
       *
       * In a chain, each after the one before it and each sent when the one
       * before it has landed. Sent at once and each "after the dragged card",
       * the server put every one directly after it — so the last to arrive
       * was first — and those that arrived before the dragged card's own move
       * were placed after its old key, in a column it was leaving. One request
       * per card, the same endpoint as one card dragged: a list of ids in one
       * request is a second path into the data. A failure stops the chain
       * rather than anchoring the next card on a move that did not happen;
       * `patch` has already put the board back to what the server holds.
       *
       * The list is where it is, so moving it is a list change and nothing
       * else. Whether it counts as finished follows
       * from the list it landed in, decided on the server.
       */
      void (async () => {
        let prior = after
        for (const t of carried) {
          if (!(await patch(t.id, {}, { list_id: spot.column, after: prior }))) return
          prior = t.id
        }
      })()
    },
    [byColumn, tasks, patch, sort, carriedWith, lists, setTasks],
  )

  /** The last move put back, if there is one. Says whether there was. */
  // biome-ignore lint/correctness/useExhaustiveDependencies: back is new on every render and only sends a request
  const takeBack = useCallback((): boolean => {
    const step = undone.current.pop()
    if (!step) return false
    if (step.kind === 'delete') {
      setUndo((u) => (u && u.ids.join() === step.ids.join() ? null : u))
      void Promise.all(step.ids.map(back)).then(() => load())
      return true
    }
    const last = step.back
    const was = new Map(last.map((b) => [b.id, b]))
    setTasks((prev) =>
      (prev ?? []).map((t) => {
        const b = was.get(t.id)
        return b ? { ...t, list_id: b.list, sort_key: b.key } : t
      }),
    )
    void (async () => {
      for (const b of last) {
        if (!(await patch(b.id, {}, { list_id: b.list, after: b.after }))) return
      }
    })()
    return true
  }, [patch, load, setTasks])

  /*
   * ⌘Z, and Ctrl+Z off a Mac — by the key, not the letter, so it is the
   * same key on a Russian layout. Not while somebody is typing: a field's
   * own undo is the one they mean there. Not under a dialog either, which
   * is asking a question of its own.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isKey(e, 'z') || !(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return
      const el = e.target as HTMLElement | null
      if (el?.isContentEditable) return
      if (el && ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return
      if (document.querySelector('[role="dialog"]')) return
      if (takeBack()) e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [takeBack])

  /** Where the top of a column starts in the flat list. */
  function firstIn(rows: Task[], listId: string): number {
    const at = rows.findIndex((t) => t.list_id === listId)
    return at === -1 ? rows.length : at
  }

  const { drag, board, layer, handlers } = useBoardDrag({
    enabled: canWrite,
    resolve,
    onDrop: commit,
  })
  return {
    taken,
    setTaken,
    bar,
    anchor,
    carriedWith,
    undone,
    undo,
    setUndo,
    gone,
    back,
    drag,
    board,
    layer,
    handlers,
  } as const
}
export type BoardMoves = ReturnType<typeof useBoardMoves>
