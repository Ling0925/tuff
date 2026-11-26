import { useMemo, useRef } from 'react'
import { ACTS, HEADS, MAKE } from '../data/words.js'
import { TASKS as W } from '../words/tasks.js'
import { NewButton } from './New.jsx'
import { PageTitle, Segments, Toolbar } from './kit.jsx'
import { TaskDetail } from './TaskDetail.jsx'
import { Over } from './kit.jsx'
import { UndoBar } from './UndoToast.jsx'
import { View } from './tasks/view.jsx'
import { boardView } from './tasks/boardView.jsx'
import { listView } from './tasks/listView.jsx'
import { peopleView, personColumns, peopleWalk, usePeopleMoves } from './tasks/peopleView.jsx'
import { takenBar } from './tasks/takenBar.jsx'
import { taskMenu } from './tasks/taskMenu.jsx'
import { useColumnPanes } from './tasks/useColumnPanes.js'
import { useTaskKeys } from './tasks/useTaskKeys.js'
import { rowRenderer } from './tasks/rowRenderer.jsx'
import { cardRenderer } from './tasks/cardRenderer.jsx'
import { type CardFns } from './tasks/board.jsx'
import { useListShape } from './tasks/useListShape.js'
import { useTaskActions } from './tasks/useTaskActions.js'
import { useUndoOffer } from '../data/undo.js'
import { useBoardLayout } from './tasks/useBoardLayout.js'
import { useBoardMoves } from './tasks/useBoardMoves.js'
import { useTaskData } from './tasks/useTaskData.js'
export { given } from './tasks/model.jsx'
export type { Task } from './tasks/model.jsx'
export { readShut, readPanel, readFolds, readShows } from './tasks/view.jsx'
export type { Shows } from './tasks/view.jsx'

export type TasksProps = {
  projectId: string
  /** What a sentence calls this project: `STU`, for `STU-41`. */
  projectKey: string
  /** Editing and dragging what is already here. */
  canWrite: boolean
  /** `content.edit.said`: whether somebody else's words are yours to change. */
  canEditAny: boolean
  /** `task.create` on this project — making a task or a list to put one in. */
  canMake: boolean
  /** `task.delete` — somebody else's. Your own needs nothing. */
  canDelete: boolean
  /** `task.remind` — a reminder for yourself on a task. */
  canRemind?: boolean
  /** Whether a task's own history is drawn. */
  canReadActivity: boolean
  /** Changes when a task was added here from somewhere else, such as the palette. */
  revision: number
  /** The task open on top of the list, from the address bar. */
  openId: string | null
  /**
   * How the list is being looked at, all of it from the address.
   *
   * What somebody is looking at is a thing they can
   * send, so it lives in the query rather than in this component. What a row
   * *shows* is not here — that is how they like it drawn, and it stays on
   * their machine.
   */
  mode: string
  group: string
  sort: string
  dir: string
  /** Whose: `all`, `mine`, `none`, or one person's id. */
  who: string
  /** Which labels, by id, comma-separated; empty is any. */
  labels?: string
  /** Which one list is on the screen, or null for all of them. */
  list: string | null
  onNavigate: (to: {
    tool?: string | undefined
    objectId?: string | null | undefined
    mode?: string | undefined
    group?: string | undefined
    sort?: string | undefined
    dir?: string | undefined
    who?: string | undefined
    labels?: string | undefined
    list?: string | null | undefined
  }) => void
  /** Whose work "mine" means. */
  meId: string
}

export function Tasks({
  projectId,
  projectKey,
  canWrite,
  canEditAny,
  canMake,
  canDelete,
  canRemind = false,
  canReadActivity,
  revision,
  openId,
  mode,
  group,
  sort,
  dir,
  who,
  labels = '',
  list,
  onNavigate,
  meId,
}: TasksProps) {
  const {
    tasks,
    setTasks,
    view,
    wide,
    panel,
    setPanel,
    shows,
    setShows,
    phone,
    drawn,
    folds,
    setFoldsState,
    isShut,
    narrow,
    byKey,
    justDone,
    open,
    setOpen,
    people,
    lists,
    cycles,
    load,
    more,
    unread,
    patch,
    taskWhat,
    move,
    setPriority,
    fitsWho,
    fitsLabels,
    byColumn,
    EDGE,
    settle,
    write,
    lay,
    takeOff,
  } = useTaskData({
    projectId,
    revision,
    openId,
    mode,
    group,
    sort,
    dir,
    who,
    list,
    onNavigate,
    meId,
    labels,
  })
  const { taken, setTaken, bar, anchor, carriedWith, undone, undo, setUndo, gone, back, drag, board, layer, handlers } = useBoardMoves({
    canWrite,
    sort,
    tasks,
    setTasks,
    lists,
    load,
    patch,
    byColumn,
    EDGE,
  })
  const { arranged, held, stack } = useBoardLayout({
    tasks,
    lists,
    byColumn,
    taken,
    carriedWith,
    drag,
    board,
  })
  /* A newer delete elsewhere — a comment's — holds the foot until it goes. */
  const elsewhere = useUndoOffer()
  const { today, anyLabels, onTask, setOnTask, triageStart, setTriageStart, duplicate, remove, removeAll, putBack } = useTaskActions({
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
  })
  const { parts, partsShown, allLabels, setAllLabels, foldKey, shut, bands, walkable, indexOf, at, setAt, take } = useListShape({
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
  })
  const { card } = cardRenderer({
    projectKey,
    canWrite,
    shows,
    byKey,
    setOpen,
    people,
    lists,
    cycles,
    patch,
    move,
    setPriority,
    today,
    parts,
  })
  const { row } = rowRenderer({
    projectKey,
    canWrite,
    phone,
    drawn,
    setOpen,
    people,
    lists,
    cycles,
    patch,
    move,
    setPriority,
    taken,
    setTaken,
    today,
    anyLabels,
    setOnTask,
    parts,
    indexOf,
    at,
    setAt,
    take,
  })
  const { cardFns, look, partsSaid, makeLabel, sharedLabels, toAll, fold } = useTaskKeys({
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
  })
  /* Each assignee's open work as a column, from the board's own columns —
     only while the people view is on the screen. */
  const columns = useMemo(
    () => (view === 'people' ? personColumns({ lists, byColumn, people, who, meId }) : []),
    [view, lists, byColumn, people, who, meId],
  )
  const walk = useMemo(() => peopleWalk(columns), [columns])
  /* The board's drag with a drop of its own: carried to a column, a card
     is given to that person. */
  const peopleMoves = usePeopleMoves({ canWrite, tasks, patch, undone, people })
  /* The board card's handlers, drawing each card for the column it is in,
     with its status where the board draws the face. */
  const peopleFns = useRef<CardFns>(null as unknown as CardFns)
  peopleFns.current = { ...cardFns.current, card: (t, col) => card(t, col, col) }
  const { columnPane, paneNode, paneReady, pane, before, after, pageTo } = useColumnPanes({
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
    peopleWalk: walk,
  })

  if (open) {
    return (
      <TaskDetail
        taskId={open}
        projectId={projectId}
        projectKey={projectKey}
        revision={revision}
        allLabels={allLabels}
        onMakeLabel={makeLabel}
        people={people}
        canWrite={canWrite}
        canEditAny={canEditAny}
        canDelete={canDelete}
        canRemind={canRemind}
        canReadActivity={canReadActivity}
        onAllActivity={() => onNavigate({ tool: 'activity', objectId: null })}
        meId={meId}
        lists={lists}
        triageStart={triageStart}
        onOpen={(id) => {
          setTriageStart(null)
          setOpen(id)
        }}
        onPrev={pageTo(before)}
        onNext={pageTo(after)}
        onClose={() => {
          setTriageStart(null)
          setOpen(null)
        }}
        /* Every write there goes through this list's own: its row moves
           with the screen and the answer settles it in place. The project
           is not read again for an edit, which on ten thousand tasks was
           half a second. */
        behind={{ write, lay, takeOff, settle }}
        /* The board's own delete, so the toast and ⌘Z on the list it goes
           back to offer it back. */
        onDelete={(id, title) => void remove(id, title)}
      />
    )
  }

  return (
    <div className="flex h-full flex-col">
      {/* Where the pointer was, not where the row is: a menu opened by a
          right-click belongs under the hand that opened it. */}
      {onTask && <Over onClose={() => setOnTask(null)} />}
      {taskMenu({ projectId, tasks, setOpen, lists, move, onTask, setOnTask, setTriageStart, duplicate, remove })}
      {/*
        The way back, where a thing that just happened belongs.
        
        Bottom centre and over everything: it is about the whole screen
        rather than about a row, and the row it was about has gone. It
        carries the title, because "Deleted" alone makes somebody check
        which one — and checking is the thing the toast exists to spare.
      */}
      <UndoBar
        offer={undo && !elsewhere ? { key: undo.ids.join(), said: undo.said } : null}
        onUndo={() => void putBack()}
        onGone={() => setUndo(null)}
      />
      {/*
        Both create buttons sit on the project's own bar, beside the tabs,
        rather than on a second bar of their own — two bars of chrome above a
        board is a board that starts a hundred pixels down.

        The view switch used to be here and is in the View panel now: it is
        an answer about how this work is looked at, and the panel is where
        the rest of those live.
      */}
      <Toolbar>
        {/*
          What this is, and not how much of it there is.
          
          There was a count of the open work beside the name. Every band
          already carries the number of rows in it, and those are the numbers
          somebody is looking at — this one was the sum of them, said again
          in a place nobody was reading, and it changed under the eye every
          time a ring was pressed.
        */}
        <span className="mr-auto flex min-w-px items-center gap-3">
          <PageTitle>{HEADS.tasks}</PageTitle>
          {/*
            Making one, beside the name of the thing being made.
            
            It was a pill at the far right of the bar, the width of two
            words, with the whole of the bar between it and anything it
            relates to. A round plus next to "Tasks" is the same action said
            in a quarter of the room and read without crossing the screen.
          */}
          {/* Not on a phone, where a task is made from the menu down the
              side and this bar holds the tabs and the view. */}
          {canMake && wide && <NewButton label={MAKE.newTask} variant="round" what={taskWhat()} onMade={load} />}
        </span>
        {/*
          How this is drawn and how it is arranged, on the line with its
          name.
          
          They had a row of their own, which was there to hold a strip as
          wide as a project has lists. With the lists in the panel the strip
          is two chips, and a second row of chrome above a board is a board
          that starts forty pixels further down for no answer it gives.
        */}
        {/*
          And Members, on a desk: the board with a column per assignee.
          Not offered below 1024, where a
          board of people has no room to be one; `?view=members` draws the
          list there and keeps the address.
        */}
        <Segments
          items={[
            { key: 'list', label: ACTS.list, icon: 'list' as const, testId: 'view-list-mode' },
            { key: 'board', label: W.board, icon: 'board' as const, testId: 'view-board' },
            ...(wide ? [{ key: 'members', label: W.people, icon: 'people' as const, testId: 'view-members' }] : []),
          ]}
          value={view === 'people' ? 'members' : view}
          onPick={(k) => onNavigate({ mode: k })}
        />
        <View
          on={view}
          {...(wide ? { open: panel, onOpen: setPanel } : {})}
          group={group}
          sort={sort}
          dir={dir}
          who={who}
          labels={labels}
          people={people}
          meId={meId}
          allLabels={allLabels}
          lists={lists}
          list={list}
          shows={shows}
          onShows={setShows}
          onPick={onNavigate}
        />
      </Toolbar>

      {/*
        What is being looked at: everything, one list, or the board.
        
        One row, because it is one question. List and Board were a pair of
        pills on the bar above, which made "which of the two drawings" look
        like a different kind of choice from "which of the lists" — and it is
        not: both answer what is on the screen. The line before Board is
        there because the things left of it narrow the list and it replaces
        it.
      */}
      {/*
        While anything is taken, this strip says what is taken instead.
        
        The same strip, the same height, the same place — a panel floating
        over the work would be chrome on a content surface, which
        the glass spec refuses, and anything appearing beside the list
        moves the list. `docs/specs/many-at-once.md`.
      */}
      {takenBar({
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
      })}

      {listView({
        canWrite,
        canMake,
        group,
        sort,
        dir,
        who,
        list,
        onNavigate,
        meId,
        labels,
        tasks,
        view,
        wide,
        panel,
        shows,
        setShows,
        people,
        lists,
        load,
        more,
        unread,
        taskWhat,
        partsShown,
        allLabels,
        shut,
        bands,
        indexOf,
        at,
        setAt,
        row,
        fold,
        paneNode,
        paneReady,
        pane,
      })}

      {peopleView({
        projectId,
        canMake,
        view,
        wide,
        panel,
        shows,
        setShows,
        people,
        lists,
        load,
        group,
        sort,
        dir,
        who,
        list,
        labels,
        meId,
        onNavigate,
        allLabels,
        columns,
        columnPane,
        taken,
        look,
        partsSaid,
        card,
        fns: peopleFns,
        moves: peopleMoves,
      })}

      {boardView({
        canMake,
        group,
        sort,
        dir,
        who,
        list,
        onNavigate,
        meId,
        labels,
        view,
        wide,
        panel,
        shows,
        setShows,
        isShut,
        narrow,
        people,
        lists,
        load,
        more,
        unread,
        taskWhat,
        byColumn,
        taken,
        drag,
        board,
        layer,
        handlers,
        arranged,
        held,
        stack,
        allLabels,
        card,
        cardFns,
        look,
        partsSaid,
        columnPane,
      })}
    </div>
  )
}
