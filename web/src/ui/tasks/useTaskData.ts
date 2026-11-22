import { useState, useCallback, useEffect, useRef, useLayoutEffect, useMemo } from 'react'
import { api, unlessOffline } from '../../data/api.js'
import { onABoard } from '../../data/boardApi.js'
import { type What } from '../New.jsx'
import { useWide, usePhone, holdUntilMoved, type Priority, whoOf } from '../kit.jsx'
import { seen } from '../TaskDetail.jsx'
import { recall, remember } from '../../data/memory.js'
import { numbered } from '../../data/route.js'
import { type Task, type List, inOrder, takenBy } from './model.jsx'
import { readPanel, PANEL_KEY, readShows, type Shows, showsKey, readFolds, readShut, OPEN_KEY, SHUT_KEY } from './view.jsx'
import { type TasksProps } from '../Tasks.jsx'

/**
 * What the screen reads and how it is being looked at: the tasks, people,
 * lists and cycles; the view, the panel, what a row shows, which groups and
 * columns are folded, which task is open; and the filters that decide which
 * tasks are shown.
 */
export function useTaskData({
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
}: Pick<TasksProps, 'projectId' | 'revision' | 'openId' | 'mode' | 'group' | 'sort' | 'dir' | 'who' | 'list' | 'onNavigate' | 'meId'> &
  Required<Pick<TasksProps, 'labels'>>) {
  /* `null` until the first answer: an empty list is a claim, and one made
     before the server has spoken is a claim that is usually false. Seeded
     from the last answer, so coming back to this tab is not a cold start —
     see `data/memory.ts`. */
  const [tasks, setTasks] = useState<Task[] | null>(() => recall(`tasks:${projectId}`))
  const view = mode === 'board' ? 'board' : 'list'
  /* What a row carries beside its title. On this machine — see `View`. */
  /*
   * Whether the answers stand beside the work or wait behind the button.
   *
   * On this machine, not in the address: how wide somebody likes their
   * screen is not a thing a team has an answer to, and a link should not
   * open somebody else's panel. The same rule the row's columns follow.
   */
  const wide = useWide()
  const [panel, setPanelState] = useState<boolean>(readPanel)
  const setPanel = useCallback((next: boolean) => {
    setPanelState(next)
    try {
      localStorage.setItem(PANEL_KEY, next ? '1' : '')
    } catch {
      // Nothing to do and nothing to say: the panel still moved.
    }
  }, [])
  const [shows, setShowsState] = useState<Shows>(() => readShows(view))
  /* Re-read when the switcher moves: the two views keep their own answers,
     so arriving at one is arriving at what was left there. */
  useEffect(() => {
    setShowsState(readShows(view))
  }, [view])
  const setShows = useCallback(
    (next: Shows) => {
      setShowsState(next)
      try {
        localStorage.setItem(showsKey(view), JSON.stringify(next))
      } catch {
        // Nothing to do and nothing to say: the row still changed.
      }
    },
    [view],
  )

  /*
   * And what a phone draws, which is less.
   *
   * Laid over the choice rather than written into it: `shows` is kept on
   * this machine and a phone that saved its own answer would turn the
   * columns off on the laptop too. So the stored value stays whatever
   * somebody chose and this is what the row reads.
   *
   * At 390 the title had thirty pixels and the facts two hundred and
   * thirty-six — the one thing that has to be readable was the one thing
   * that was not. The first answer was to drop the number, the labels and
   * the cycle there, on the grounds that those are columns to be scanned
   * *down* a wide screen.
   *
   * It is the right diagnosis and the wrong remedy: they do not have to
   * share the line. Measured at 390, a number, two chips, a count and a
   * cycle come to 319 of 366 — a whole line with room to spare — so the
   * row wraps and they take the second one. Nothing is hidden, the title
   * keeps the first line to itself, and the panel has no switch that
   * turns nothing on.
   */
  const phone = usePhone()
  /*
   * A phone's row is the tick, the title and the face.
   *
   * At 390 the title had thirty pixels and the facts two hundred and
   * thirty-six: the facts take what they need and the one thing that has
   * to be readable takes what is left. Wrapping them to a second line was
   * tried and is worse — it doubles the height of every row in a list
   * somebody is scanning, to show columns that exist to be scanned *down*
   * a wide screen.
   *
   * So the title keeps the line and only the face stands beside it: who
   * has this is the one fact worth a glance on a phone, and the rest are
   * on the task's own screen, one press away.
   */
  const drawn: Shows = phone ? { ...shows, id: false, labels: false, cycle: false, dates: false, due: false, priority: false } : shows
  /*
   * Which bands are shut.
   *
   * On this machine, like the panel and the row's columns: which parts of a
   * list somebody has folded away is how they like it drawn, and a link
   * should not arrive with most of its lists closed. In the address it
   * would also have to name every band, which is a query string that grows
   * with the project.
   */
  const [folds, setFoldsState] = useState<Set<string>>(readFolds)
  const [shutCols, setShutCols] = useState<Set<string>>(readShut)
  /*
   * And the ones somebody opened, which is not the same as not having
   * narrowed them: a list can start narrowed (`narrow` from the server —
   * Canceled, in a new project), and opening it has to be remembered as an
   * answer or the next load narrows it again. With neither, the list's own
   * starting point decides.
   */
  const [openCols, setOpenCols] = useState<Set<string>>(() => readShut(OPEN_KEY))
  const shutKey = (id: string) => `${projectId}:${id}`
  const isShut = (id: string) => {
    const k = shutKey(id)
    if (shutCols.has(k)) return true
    if (openCols.has(k)) return false
    return lists.find((l) => l.id === id)?.narrow === true
  }
  /*
   * A column folds and opens rather than jumps.
   *
   * Narrowing swapped a column of cards for a forty-four pixel strip in one
   * frame and every column to its right leapt left; opening did the same the
   * other way. The width is measured before and after and the column is
   * carried between the two (the columns beside it follow it, because they
   * are laid out against it), and what is inside it fades in as it arrives —
   * cards reflowing through every width on the way would be the jump again,
   * only slower. Not on a reduced-motion setting, where it simply changes.
   */
  const folding = useRef<{ id: string; from: number } | null>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: the fold is animated when a column shuts or opens
  useLayoutEffect(() => {
    const f = folding.current
    if (!f) return
    folding.current = null
    const el = document.querySelector<HTMLElement>(`[data-list="${f.id}"]`)
    if (!el || matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const to = el.getBoundingClientRect().width
    if (Math.abs(to - f.from) < 1) return
    const at = (w: number) => ({ width: `${w}px`, minWidth: `${w}px`, maxWidth: `${w}px`, flexGrow: 0 })
    el.animate([at(f.from), at(to)], { duration: 220, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' })
    for (const child of el.children) {
      ;(child as HTMLElement).animate([{ opacity: 0 }, { opacity: 0, offset: 0.4 }, { opacity: 1 }], {
        duration: 260,
        easing: 'cubic-bezier(0.23, 1, 0.32, 1)',
      })
    }
  }, [shutCols, openCols])
  const narrow = (id: string, on: boolean) => {
    /* Columns travel under a pointer that has not moved, so nothing they
       carry under it is lit until it does — the card a column opens onto,
       the strip it folds into. The same hold a drop uses. */
    holdUntilMoved()
    const was = document.querySelector<HTMLElement>(`[data-list="${id}"]`)
    if (was) folding.current = { id, from: was.getBoundingClientRect().width }
    const next = new Set(shutCols)
    const opened = new Set(openCols)
    if (on) {
      next.add(shutKey(id))
      opened.delete(shutKey(id))
    } else {
      next.delete(shutKey(id))
      opened.add(shutKey(id))
    }
    setShutCols(next)
    setOpenCols(opened)
    try {
      localStorage.setItem(SHUT_KEY, JSON.stringify([...next]))
      localStorage.setItem(OPEN_KEY, JSON.stringify([...opened]))
    } catch {
      // Nothing to do and nothing to say: the column still moved.
    }
  }
  /*
   * Whether the last thing the hand did was a key.
   *
   * The board's move buttons are for the keyboard and are drawn on focus,
   * which a click gives too: pressing a card — or coming back to the board
   * from the task it opened — put a row of "→ Doing → In review → Done"
   * across it for somebody who had no use for it and had not asked. Focus is
   * not the question; how the focus arrived is.
   *
   * Asked here rather than with `:focus-visible`, which answers it by a
   * heuristic that differs between browsers and is not the same question
   * under a scripted focus.
   */
  const [byKey, setByKey] = useState(false)
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Tab') setByKey(true)
    }
    /* Except a press on the moves themselves. They are shown because a key
       showed them; taking them away under the finger that is landing on one
       means the press never arrives, which is the control that cannot be
       used at all. */
    const hand = (e: PointerEvent) => {
      if ((e.target as Element | null)?.closest?.('[data-moves]')) return
      setByKey(false)
    }
    window.addEventListener('keydown', key)
    window.addEventListener('pointerdown', hand, true)
    return () => {
      window.removeEventListener('keydown', key)
      window.removeEventListener('pointerdown', hand, true)
    }
  }, [])
  /*
   * Ticked while you were looking at it.
   *
   * A task that vanishes the moment it is finished makes the list reshuffle
   * under your finger, and ticking five things in a row becomes five
   * different lists. It stays where it is, with its ring filled and its
   * title gone quiet, until the screen is left — which is also when "done"
   * stops being news.
   */

  const [justDone, setJustDone] = useState<Set<string>>(new Set())
  const open = openId
  const setOpen = (id: string | null) => onNavigate({ objectId: id })
  /*
   * In the address, not in state.
   *
   * It was `useState(null)`, so narrowing to Doing lasted until anybody
   * pressed Board, reloaded, or left the project and came back — and it is
   * the same kind of answer as the grouping and the ordering beside it,
   * which have been in the address since it was written. What you are
   * looking at goes in the address; how you like it drawn stays on the
   * machine.
   */
  /* Who can be given this work: the people on this project, not everybody in
     the workspace. Assigning somebody who cannot see the project is how a
     task disappears. */
  const [people, setPeople] = useState<{ actor_id: string; name: string; avatar_url?: string | null; role: string }[]>(
    () => recall(`members:${projectId}`) ?? [],
  )
  /* A to-do list is what Basecamp is shaped around: work belongs to a named
     group, not to one flat pile per project. */
  const [lists, setLists] = useState<List[]>(() => recall(`lists:${projectId}`) ?? [])

  // biome-ignore lint/correctness/useExhaustiveDependencies: on a board, read again with what the board heard; in a project, once
  useEffect(() => {
    void api<{ members: { actor_id: string; name: string; role: string }[] }>(`/projects/${projectId}/members`)
      .then((r) => setPeople(remember(`members:${projectId}`, r.members)))
      .catch(unlessOffline(() => setPeople([])))
    /* On a board, an agent arrives with its first write: asked again with
       what the board heard. In a project, people change rarely enough that
       once is right. */
  }, [projectId, onABoard() ? revision : 0])

  /* The project's cycles, for grouping by one. A
     project with none pays an empty answer once. */
  const [cycles, setCycles] = useState<{ id: string; name: string; starts_on: string; ends_on?: string }[]>(
    () => recall(`cycles:${projectId}`) ?? [],
  )
  const refreshCycles = useCallback(
    () =>
      api<{ cycles: { id: string; name: string; starts_on: string }[] }>(`/projects/${projectId}/cycles`)
        /* Remembered for the task's own screen, which draws its Sprint row
           from this rather than appearing without one and growing it. */
        .then((r) => setCycles(remember(`cycles:${projectId}`, r.cycles)))
        .catch(unlessOffline(() => setCycles([]))),
    [projectId],
  )
  useEffect(() => void refreshCycles(), [refreshCycles])

  const loadLists = useCallback(async () => {
    const r = await api<{ lists: List[] }>(`/projects/${projectId}/lists`)
    setLists(remember(`lists:${projectId}`, r.lists ?? []))
  }, [projectId])
  // biome-ignore lint/correctness/useExhaustiveDependencies: revision is the trigger: the lists are read again when the project says something changed
  useEffect(() => void loadLists().catch(unlessOffline(() => setLists([]))), [loadLists, revision])

  // Leaving the view is when finished work stops being news.
  // biome-ignore lint/correctness/useExhaustiveDependencies: leaving the view is when finished work stops being news
  useEffect(() => setJustDone(new Set()), [projectId, list, who, view])

  /**
   * Writes still in the air, by task: a row's own answer replaces it only
   * when nothing newer was sent for it, or the first answer of two quick
   * edits would put the second one back for a moment.
   */
  const inAir = useRef(new Map<string, number>())
  const lift = useCallback((id: string, by: number) => {
    const n = (inAir.current.get(id) ?? 0) + by
    if (n > 0) inAir.current.set(id, n)
    else inAir.current.delete(id)
  }, [])

  /*
   * Read by list, or the whole project.
   *
   * The default way of looking — grouped by list (the board always is), in
   * the order the cards were dragged into, everybody's, no labels — reads
   * each list's head and the rest of a list as somebody scrolls down it. A
   * board whose Done held a hundred and sixty cards drew them all on a
   * phone and was ended for it. Any other answer needs every task to be
   * right and reads them all, as before.
   */
  /* Not on a scratch board, whose own read answers the whole board and
     knows no `by=list`. */
  const byList = !onABoard() && (view === 'board' || group === 'list') && sort === 'manual' && dir !== 'desc' && who === 'all' && !labels
  /** Where each list's read stands: how many it holds (parts left out),
      how many of those have been read, and where the rest is read from. */
  const [stands, setStands] = useState<Record<string, Stand>>(() => recall(`stands:${projectId}`) ?? {})
  const standsNow = useRef(stands)
  standsNow.current = stands
  const tasksNow = useRef(tasks)
  tasksNow.current = tasks
  useEffect(() => {
    remember(`stands:${projectId}`, stands)
  }, [stands, projectId])

  /*
   * Every task, not the first page of them — when the whole is wanted.
   *
   * The screen read one page of two hundred and drew it as the project: a
   * project of ten thousand showed two hundred, in the list and on the
   * board, and nothing said so. The first page is drawn at once; the rest
   * follow five hundred at a time and are drawn together when they are all
   * there. A newer read stops an older one.
   */
  const reading = useRef(0)
  // biome-ignore lint/correctness/useExhaustiveDependencies: revision is the trigger: a new load is a new read, for the effects that hold it
  const load = useCallback(async () => {
    const mine = ++reading.current
    type Page = { tasks: Task[]; next_cursor?: string | null }
    if (byList && (await readByList(mine))) return
    /* With each card's picture, whether or not the board is drawing them:
       turning Images on then draws them at once, rather than reading ten
       thousand rows again. */
    /* Open work first (the server's order — `docs/api.md`): a project of
       two hundred and ten drew its two hundred and then, a second later,
       the in-progress card the page boundary had cut. Now the first page
       holds the open tasks and what follows is Done. Not five hundred at
       once: a phone drew them all in one go and was ended for it. */
    const r = await api<Page>(`/projects/${projectId}/tasks?pictures=1`)
    if (mine !== reading.current) return
    /* The address says 41 rather than a uuid, and this is where it learns
       which is which. */
    numbered(r.tasks, projectId, 'task')
    /* And what each row says, so the task's own screen opens on it rather
       than on nothing while its fetch is in the air. */
    for (const t of r.tasks) seen(t)
    /* Read whole, so nothing is left unread in any list. */
    setStands({})
    setTasks(r.tasks)
    let all = r.tasks
    let cursor = r.next_cursor ?? null
    while (cursor) {
      const more: Page = await api<Page>(`/projects/${projectId}/tasks?pictures=1&limit=500&cursor=${encodeURIComponent(cursor)}`)
      if (mine !== reading.current) return
      numbered(more.tasks, projectId, 'task')
      for (const t of more.tasks) seen(t)
      all = [...all, ...more.tasks]
      cursor = more.next_cursor ?? null
    }
    if (all === r.tasks) return
    /* Laid over what is on the screen now, which may have moved since the
       first page: a row already there keeps what the screen did to it, a
       row taken off meanwhile stays off, and one made meanwhile stays. */
    const first = new Set(r.tasks.map((t) => t.id))
    const every = new Set(all.map((t) => t.id))
    setTasks((now) => {
      const shown = new Map((now ?? []).map((t) => [t.id, t]))
      const kept = all
        .filter((t) => !first.has(t.id) || shown.has(t.id))
        .map((t) => {
          const was = shown.get(t.id)
          /* The picture is the server's, not the screen's: nothing here
             writes one, and the link in a row kept from an earlier visit
             may have run out since. The same link keeps the same row, so a
             card is drawn again only when its picture changed. */
          if (!was || was.picture?.thumb_url === t.picture?.thumb_url) return was ?? t
          const { picture: _gone, ...rest } = was
          return t.picture ? { ...rest, picture: t.picture } : rest
        })
      return [...kept, ...(now ?? []).filter((t) => !every.has(t.id))]
    })
  }, [projectId, revision, byList])

  /*
   * Every list's head in one read, and each list as deep as the screen
   * holds it — a column somebody had scrolled down does not shrink under
   * them when another device's change reads it again. Drawn once, when it
   * is all in. Says false for a project with no lists, which has nothing
   * to read by and is read whole.
   */
  async function readByList(mine: number): Promise<boolean> {
    /* Only a list that was read by list before: rows a whole read left
       behind — or a shelf kept from one — are not a depth anybody
       scrolled to, and reading them all again is what this is for not
       doing. */
    const held = new Map<string, number>()
    for (const t of tasksNow.current ?? [])
      if (!t.parent_id && t.list_id && standsNow.current[t.list_id]) held.set(t.list_id, (held.get(t.list_id) ?? 0) + 1)
    const r = await api<ByListPage>(`/projects/${projectId}/tasks?by=list&pictures=1`)
    if (mine !== reading.current) return true
    /* An answer without its lists is one that does not read by list —
       read the whole instead, never assume them. */
    if (!Array.isArray(r.lists) || r.lists.length === 0) return false
    let rows = r.tasks
    const next: Record<string, Stand> = {}
    for (const l of r.lists) {
      let stand: Stand = { total: l.total, read: r.tasks.filter((t) => t.list_id === l.id && !t.parent_id).length, cursor: l.next_cursor }
      while (stand.cursor && stand.read < (held.get(l.id) ?? 0)) {
        const page = await api<OneListPage>(
          `/projects/${projectId}/tasks?list=${l.id}&pictures=1&limit=${Math.min(200, (held.get(l.id) ?? 0) - stand.read)}&cursor=${encodeURIComponent(stand.cursor)}`,
        )
        if (mine !== reading.current) return true
        rows = [...rows, ...page.tasks]
        stand = { total: page.total, read: stand.read + page.tasks.filter((t) => !t.parent_id).length, cursor: page.next_cursor }
      }
      next[l.id] = stand
    }
    numbered(rows, projectId, 'task')
    for (const t of rows) seen(t)
    setStands(next)
    /* The server's rows, except one this screen is still writing, which
       keeps what the screen drew until its own answer lands — `docs/specs/
       view.md`, "A refetch keeps the rows this screen is still writing". A
       picture keeps the link it was drawn with while it is the same file. */
    setTasks((now) => {
      const shown = new Map((now ?? []).map((t) => [t.id, t]))
      const fresh = new Set(rows.map((t) => t.id))
      const out = rows.map((t) => {
        const was = shown.get(t.id)
        if (!was) return t
        if (inAir.current.has(t.id)) return was
        return was.picture && t.picture?.file_id === was.picture.file_id ? { ...t, picture: was.picture } : t
      })
      return [...out, ...(now ?? []).filter((t) => !fresh.has(t.id) && inAir.current.has(t.id))]
    })
    return true
  }

  /*
   * The next page of one list, as somebody nears the end of what is drawn
   * of it. A row the screen already holds keeps what the screen did to it:
   * a page read before this screen's move landed would put the card back.
   */
  const asking = useRef(new Set<string>())
  const more = useCallback(
    async (listId: string) => {
      const stand = standsNow.current[listId]
      if (!stand?.cursor || asking.current.has(listId)) return
      asking.current.add(listId)
      const mine = reading.current
      try {
        const page = await api<OneListPage>(
          `/projects/${projectId}/tasks?list=${listId}&pictures=1&cursor=${encodeURIComponent(stand.cursor)}`,
        )
        if (mine !== reading.current) return
        numbered(page.tasks, projectId, 'task')
        for (const t of page.tasks) seen(t)
        const top = page.tasks.filter((t) => !t.parent_id).length
        setStands((was) => ({ ...was, [listId]: { total: page.total, read: (was[listId]?.read ?? 0) + top, cursor: page.next_cursor } }))
        setTasks((now) => {
          const have = new Set((now ?? []).map((t) => t.id))
          return [...(now ?? []), ...page.tasks.filter((t) => !have.has(t.id))]
        })
      } catch {
        // Nothing drawn and nothing said: the room is still there, and the
        // next time it comes into view it asks again.
      } finally {
        asking.current.delete(listId)
      }
    },
    [projectId],
  )
  /** How many of a list's tasks are not read yet — counted in its head,
      and the room held for them under what is drawn. */
  const unread = useCallback(
    (listId: string): number => {
      if (!byList) return 0
      const s = stands[listId]
      return s?.cursor ? Math.max(0, s.total - s.read) : 0
    },
    [stands, byList],
  )

  useEffect(() => void load(), [load])

  /*
   * What is kept is what the screen shows, not what the server last said.
   *
   * Kept only from the server's answers, a move made here never reached the
   * shelf: the writes landed, nothing asked for the list again, and the next
   * start — which draws the shelf before the server answers,
   * `docs/specs/arrival.md` — opened the board on the arrangement from
   * before the move and then rearranged it under the reader. Every change
   * the screen makes is kept as it is made, so it opens on what it showed.
   */
  useEffect(() => {
    if (tasks) remember(`tasks:${projectId}`, tasks)
  }, [tasks, projectId])

  /**
   * Rows the server handed back, put in place: a row already here is
   * replaced, a new one joins. The picture keeps the link it was drawn with
   * while it is the same file — a link signed a moment later is a new
   * address, and the card would draw its picture again for nothing.
   */
  const lay = useCallback(
    (rows: Task[]) => {
      if (rows.length === 0) return
      numbered(rows, projectId, 'task')
      for (const r of rows) seen(r)
      const by = new Map(rows.map((r) => [r.id, r]))
      setTasks((prev) => {
        const all = prev ?? []
        const out = all.map((t) => {
          const r = by.get(t.id)
          if (!r) return t
          return t.picture && r.picture?.file_id === t.picture.file_id ? { ...r, picture: t.picture } : r
        })
        const have = new Set(all.map((t) => t.id))
        return [...out, ...rows.filter((r) => !have.has(r.id))]
      })
    },
    [projectId],
  )

  /**
   * What a write did, put in place from its own answer — a move made here
   * and any edit made on the task's own screen alike.
   *
   * The row as the server has it now replaces the one on the screen, its
   * parts with it when it moved; the tasks it blocks get their marks; a
   * series gains its next one or loses the one taken back. Nothing is read
   * again. It was the whole project read again after every edit on the
   * task's screen, which on ten thousand tasks is twenty-one pages and half
   * a second for a title.
   */
  const settle = useCallback(
    (id: string, said: Changed | null | undefined, change?: Partial<Task>) => {
      if (change) setTasks((prev) => (prev ?? []).map((t) => (t.id === id ? { ...t, ...change } : t)))
      /*
       * Where the server put it, which is the one thing this cannot work
       * out for itself.
       *
       * A move sends "after this one" and the key is computed there —
       * three clients generating their own keys is three clients that
       * disagree about order the first time two people drag at once. So
       * the answer carries it back.
       *
       * Without this the board and the list disagreed: the board splices
       * the card into place optimistically and reads array order, while
       * the list sorts by `sort_key` and still held the old one. A card
       * dragged to the top of a column was first on the board and last in
       * the list, and stayed that way until the page was reloaded —
       * measured, and exactly what it looked like.
       */
      if (said?.sort_key) {
        const key = said.sort_key
        setTasks((prev) => (prev ?? []).map((t) => (t.id === id ? { ...t, sort_key: key } : t)))
      }
      /* The whole row, once nothing newer is on its way for it. */
      if (said?.task && !inAir.current.has(id)) lay([said.task])
      if (said?.parts?.length) lay(said.parts)
      /*
       * Finished or reopened: the tasks it blocks, with what they wait on
       * now, in the same answer. Only their
       * marks change, in place; nothing is read again and nothing moves.
       * It was the whole project read again, which on ten thousand tasks
       * is twenty-one pages for one mark.
       */
      if (said?.rewaits?.length) {
        const now = new Map(said.rewaits.map((w) => [w.id, w.waiting_on]))
        setTasks((prev) => (prev ?? []).map((t) => (now.has(t.id) ? { ...t, waiting_on: now.get(t.id)! } : t)))
      }
      if (said?.next || said?.withdrawn) {
        const made = said.next ?? null
        const parts = made ? (said.next_parts ?? []) : []
        const gone = said.withdrawn ?? null
        const rule = said.repeat !== undefined ? said.repeat : made ? null : undefined
        if (made) {
          numbered([made, ...parts], projectId, 'task')
          for (const r of [made, ...parts]) seen(r)
        }
        /*
         * In place, from the answer: the next one and its parts join the
         * rows, and a list or a board draws each by its own list and key,
         * which the server gave it — so it lands in its column and its
         * slot. The one withdrawn leaves with its parts, and the moved
         * one carries the rule the server says it carries now. It read
         * the whole project again here, which on ten thousand tasks was
         * half a second.
         */
        setTasks((prev) => {
          let all = (prev ?? []).filter((t) => t.id !== gone && (gone === null || t.parent_id !== gone))
          if (rule !== undefined) all = all.map((t) => (t.id === id ? { ...t, repeat: rule } : t))
          const have = new Set(all.map((t) => t.id))
          return made ? [...all, ...[made, ...parts].filter((r) => !have.has(r.id))] : all
        })
      }
    },
    [projectId, lay],
  )

  /**
   * One row changed now, before the server has it — and how to put it back.
   *
   * A move takes the task's parts along, as the server does.
   * Putting back restores only what this change
   * set and nothing has changed since: a refused title does not take back
   * the priority set after it.
   */
  const shift = useCallback((id: string, change: Partial<Task>): (() => void) => {
    const keys = Object.keys(change) as (keyof Task)[]
    if (keys.length === 0) return () => {}
    const follows = change.list_id !== undefined
    const partChange: Partial<Task> = follows
      ? { list_id: change.list_id ?? null, ...('completed_at' in change ? { completed_at: change.completed_at ?? null } : {}) }
      : {}
    const was = new Map<string, Partial<Task>>()
    setTasks((prev) =>
      (prev ?? []).map((t) => {
        const own = t.id === id
        const part = follows && t.parent_id === id
        if (!own && !part) return t
        const set = own ? change : partChange
        if (!was.has(t.id)) {
          const before: Partial<Task> = {}
          for (const k of Object.keys(set) as (keyof Task)[]) (before as Record<string, unknown>)[k] = t[k]
          was.set(t.id, before)
        }
        return { ...t, ...set }
      }),
    )
    return () =>
      setTasks((prev) =>
        (prev ?? []).map((t) => {
          const before = was.get(t.id)
          if (!before) return t
          const set = t.id === id ? change : partChange
          const out = { ...t } as Record<string, unknown>
          for (const k of Object.keys(before))
            if (out[k] === (set as Record<string, unknown>)[k]) out[k] = (before as Record<string, unknown>)[k]
          return out as Task
        }),
      )
  }, [])

  /**
   * The interface moves first and the server catches up.
   *
   * The design asks for writes to be optimistic, and a checkbox that waits
   * for a round trip is the most visible place to get that wrong: you tick
   * it, and nothing happens for as long as the network takes.
   *
   * The row moves, the request goes, and the answer settles it in place.
   * Refused, what moved is put back — pretending it worked is worse than a
   * flicker — and the refusal goes on to whoever asked. Shared by the list,
   * the board and the task's own screen, so the three cannot disagree
   * about what an edit did.
   */
  const write = useCallback(
    async <A extends Changed>(id: string, change: Partial<Task>, send: () => Promise<A>): Promise<A> => {
      const back = shift(id, change)
      lift(id, 1)
      let said: A
      try {
        said = await send()
      } catch (e) {
        lift(id, -1)
        back()
        throw e
      }
      lift(id, -1)
      settle(id, said)
      return said
    },
    [shift, settle, lift],
  )

  const patch = useCallback(
    async (id: string, change: Partial<Task>, body: Record<string, unknown>) => {
      try {
        await write(id, change, () => api<Changed>(`/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(body) }))
        return true
      } catch {
        /* A board's move places its cards itself before it asks, and says
           nothing here to put back: read again, the one case left. */
        if (Object.keys(change).length === 0) await load()
        /* Said, so that a chain of moves anchored on this one can stop
           rather than anchor the next card on a move that did not happen. */
        return false
      }
    },
    [load, write],
  )

  /**
   * Taken off the screen now — the task and its parts — and how to put
   * them back if the server refuses.
   */
  const takeOff = useCallback((id: string): (() => void) => {
    let taken: Task[] = []
    setTasks((prev) => {
      const all = prev ?? []
      taken = all.filter((t) => t.id === id || t.parent_id === id)
      return all.filter((t) => t.id !== id && t.parent_id !== id)
    })
    return () =>
      setTasks((prev) => {
        const all = prev ?? []
        const have = new Set(all.map((t) => t.id))
        return [...all, ...taken.filter((t) => !have.has(t.id))]
      })
  }, [])

  /**
   * Everything the dialog needs to know about where the button was pressed.
   *
   * On the board that is the column the button sits in; in the list there is
   * no column in view, so it lands in Unsorted and the board is where it
   * gets decided. The list being looked at travels the same way — a task
   * made while a list is open belongs to it, and asking again is asking
   * somebody to repeat what the screen already knows.
   */
  /* Into the list being looked at, or the first one — a task made with no
     list is a task with nowhere to be. */
  const taskWhat = (into?: string, forWhom?: string): What => ({
    kind: 'task',
    projectId,
    /* Never Triage by hand: that is for what did not come from the team. */
    list: into ?? list ?? (lists.find((l) => !l.intake) ?? lists[0])?.id ?? null,
    ...(forWhom ? { who: forWhom } : {}),
  })

  /**
   * Ticking one off.
   *
   * Which is moving it into the list that finishes, because that is what
   * finished means now. Where it goes when it is
   * un-ticked is the first list, because "not finished" has no other
   * address: the one it came from is not remembered, and inventing a memory
   * for it is a second placement by the back door.
   */
  /**
   * Putting a task somewhere, which is the only way its state changes now.
   *
   * There was a `toggle` beside this that moved between the finishing list
   * and the first one — the two-state remnant of the checkbox, and the three
   * lists in between were reachable only by dragging a card on the board.
   * One way in.
   */
  function move(t: Task, listId: string) {
    const into = lists.find((l) => l.id === listId)
    if (!into) return
    /* Finished while you are looking at it, it stays where it is until the
       next fresh look. A row that vanishes the moment it is done makes the
       list reshuffle under your finger, and ticking five things becomes five
       different lists. */
    if (into.finishes && !t.completed_at) setJustDone((prev) => new Set(prev).add(t.id))
    void patch(
      t.id,
      {
        /* Given to the list's agent, when it takes the list's new tasks. */
        ...takenBy(into, t),
        list_id: listId,
        // The server's trigger writes this from the list; the screen says the
        // same thing now so the row does not change its mind a tick later.
        completed_at: into.finishes ? (t.completed_at ?? new Date().toISOString()) : null,
        decided_at: new Date().toISOString(),
      },
      { list_id: listId },
    )
  }

  /**
   * How urgent it is, set from wherever the mark is drawn.
   *
   * Optimistic like every other write here: the mark changes under the
   * pointer and the request follows. Nothing moves on the screen as a
   * result — sorting by priority is a choice somebody made in the panel, and
   * a row that jumps out from under the finger that just triaged it makes
   * triaging the next one a search.
   */
  function setPriority(t: Task, to: Priority | null) {
    void patch(t.id, { priority: to }, { priority: to })
  }

  /**
   * The board's columns, and what the menu above them decided.
   *
   * It read every task, always. The list obeyed whose work it was and
   * whether finished work belonged in it; the board beside it obeyed
   * neither, so the same two answers gave two different projects and only
   * one of them was the one asked for.
   *
   * **The chosen list is not one of them.** It is the answer the board
   * replaces: the chips and Board are one control asking what is on the
   * screen, and a board drawing every list as a column while showing the
   * cards of one of them is a board pretending to be a list. Switching to
   * Doing and then to Board emptied every column but that one, which read
   * as the board having lost the work.
   *
   * It is kept rather than cleared, because the chips are where it is said
   * and pressing back from the board should come back to what was being
   * looked at. Forgotten on the way out, back would return to a screen
   * nobody had asked for.
   *
   * Grouping, ordering and direction are not here and are not offered on the
   * board: the columns are the grouping, and a card is where somebody put
   * it. An order that overrides the hand makes the drag lie about where the
   * card will land.
   */
  /*
   * Narrowed by whose and by which labels. Whose is
   * everyone, mine, nobody's, or one person's; labels are any of those
   * picked. One pair of tests for the list and the board both, so a card
   * cannot be on the board and missing from the list it was filtered by.
   */
  const wantLabels = useMemo(() => new Set(labels ? labels.split(',').filter(Boolean) : []), [labels])
  const fitsWho = useCallback(
    (t: Task) =>
      who === 'all' || (who === 'mine' ? whoOf(t).includes(meId) : who === 'none' ? whoOf(t).length === 0 : whoOf(t).includes(who)),
    [who, meId],
  )
  const fitsLabels = useCallback((t: Task) => wantLabels.size === 0 || (t.labels ?? []).some((l) => wantLabels.has(l.id)), [wantLabels])

  const byColumn = useMemo(() => {
    const map = new Map<string, Task[]>(lists.map((l) => [l.id, []]))
    for (const t of tasks ?? []) {
      /* A part is not a card. The board is for what is being worked on at
         the scale of a column, and four cards for one task's parts is noise
         — the card carries the count instead. */
      if (t.parent_id) continue
      if (!fitsWho(t) || !fitsLabels(t)) continue
      if (t.list_id) map.get(t.list_id)?.push(t)
    }
    /* Each column in the order asked for. The cards were pushed in the
       order the tasks arrived, so picking an Ordering changed the list
       beside the board and left the board as it was — a control that
       answers on one screen and not on the other it is drawn on. */
    for (const [id, rows] of map) map.set(id, inOrder(rows, sort, dir))
    return map
  }, [tasks, lists, fitsWho, fitsLabels, sort, dir])

  /**
   * Where the pointer is pointing, in the board's terms.
   *
   * Read from what is under it rather than from a stack of registered drop
   * targets: the DOM already knows what is where. A card passes a
   * neighbour when its leading edge crosses that neighbour's middle —
   * below, at the comparison itself. The copy that follows the pointer has no pointer events, so it is
   * not in this answer and the card cannot hit-test itself.
   */
  /**
   * How far past a neighbour's middle the leading edge has to go, each way.
   * With the gap between cards it is the margin a hand holding still has
   * before the answer changes — sixteen pixels between going and coming
   * back.
   */
  const EDGE = 4
  return {
    settle,
    write,
    lay,
    takeOff,
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
    byList,
    patch,
    taskWhat,
    move,
    setPriority,
    fitsWho,
    fitsLabels,
    byColumn,
    EDGE,
  } as const
}
export type TaskData = ReturnType<typeof useTaskData>

/** Where one list's read stands. */
type Stand = { total: number; read: number; cursor: string | null }
/** `GET /api/projects/:id/tasks?by=list` (`TaskPage` with `lists`). */
type ByListPage = { tasks: Task[]; lists?: { id: string; total: number; next_cursor: string | null }[] }
/** `GET /api/projects/:id/tasks?list=` (`TaskPage` with `total`). */
type OneListPage = { tasks: Task[]; next_cursor: string | null; total: number }

/** What `PATCH /api/tasks/:id` answers (`TaskChanged`). */
export type Changed = {
  sort_key?: string | null
  next?: Task | null
  next_parts?: Task[]
  withdrawn?: string | null
  repeat?: Task['repeat']
  rewaits?: { id: string; waiting_on: string[] }[]
  /** The task as the list draws it, after the change. */
  task?: Task
  /** Its parts, when it moved and took them along. */
  parts?: Task[]
}
