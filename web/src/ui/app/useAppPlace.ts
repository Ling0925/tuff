import { useRef, useEffect, useCallback, useLayoutEffect, useMemo } from 'react'
import { untilAnswered, api, readsInFlight } from '../../data/api.js'
import { type Route, type Numbered, carrying, numbered } from '../../data/route.js'
import { isKey } from '../../data/keys.js'
import { faviconDot } from '../../data/favicon.js'
import { warmRoom } from '../../data/warm.js'
import { remember } from '../../data/memory.js'
import { badge } from '../../data/push.js'
import { lastLook, rememberLook } from '../../data/look.js'
import { letGo, ARRIVAL_CAP, inboxCount } from './model.js'
import { leftRoom } from '../Sidebar.jsx'
import { type AppState } from './useAppState.js'
import { type AppLoad } from './useAppLoad.js'

/**
 * Where in the workspace the window is, what it is looking at, and what
 * is read ahead of the next place somebody goes.
 */
export function useAppPlace({
  me,
  projects,
  archivedProjects,
  people,
  route,
  navigate,
  replace,
  phone,
  beneath,
  view,
  rooms,
  loaded,
  found,
  setFound,
  setMaking,
  unread,
  signedIn,
  loadInvites,
  stranded,
  kept,
}: Pick<
  AppState,
  | 'me'
  | 'projects'
  | 'archivedProjects'
  | 'people'
  | 'route'
  | 'navigate'
  | 'replace'
  | 'phone'
  | 'beneath'
  | 'view'
  | 'rooms'
  | 'loaded'
  | 'found'
  | 'setFound'
  | 'setMaking'
  | 'unread'
  | 'signedIn'
  | 'loadInvites'
> &
  Pick<AppLoad, 'stranded' | 'kept'>) {
  /*
   * And a project's tasks, opened without saying how to look at them.
   *
   * Silent used to mean the list, always — so choosing the board and then
   * going anywhere at all threw the choice away, and coming back to a project
   * you run as a board showed it as a list. One project is a board and
   * another is a list, and which is which is not a thing a team has an answer
   * to.
   *
   * Corrected rather than merely drawn, and with `replace`: the address is
   * the single source of truth for the open screen, so it has to say what is
   * on it — and a resolution the back button walks through is one that traps
   * somebody in the project they are trying to leave.
   */
  /*
   * The project *and* whether the tasks screen was the one on it.
   *
   * It held the project alone, and the two questions below both asked "same
   * project?" when what they mean is "was this person already looking at
   * this project's tasks?". Pressing Chat and then Tasks in the tools column
   * never leaves the project, so the write below read it as a choice and
   * stored the empty address — which `rememberLook` correctly treats as
   * nothing to keep, and so deleted the board somebody had chosen. The read
   * above it was false for the same reason, so the board was not restored
   * either. One press, both halves wrong.
   */
  const wasOn = useRef<string | null>(null)
  /*
   * The project, whether or not the address has got round to saying `tasks`.
   *
   * Coming in from the sidebar the address is the project and nothing else,
   * and the tool is settled a moment later by an effect — but the screen does
   * not wait for that: it draws its first tool straight away, because waiting
   * meant a frame with no tool at all. So the look has to be resolved on the
   * same terms. Resolved only once the address said `tasks`, it arrived a
   * paint too late: the bar drew Everything, the address became the board,
   * and the chip crossed the screen to catch up — the animation nobody asked
   * for, on every single arrival.
   */
  const onProject = beneath.view === 'projects' && beneath.projectId ? beneath : null

  /*
   * On a phone, Projects keeps where you were in it.
   * A tab of the phone's own reopens on the screen you left it on, and
   * Projects reopened on the list every time, so getting back to the one
   * project somebody works in was two taps every time. The project and its
   * tab are kept for the workspace; back from the project, or the tab
   * pressed while already in a project, goes to the list and forgets it.
   */
  const lastProjectKey = me ? `tracker:phone-project:${me.workspace.id}` : null
  useEffect(() => {
    if (!phone || !lastProjectKey || !onProject?.projectId) return
    try {
      localStorage.setItem(lastProjectKey, JSON.stringify({ projectId: onProject.projectId, tool: onProject.tool ?? null }))
    } catch {
      /* Without storage the tab opens on the list, as it did. */
    }
  }, [phone, lastProjectKey, onProject?.projectId, onProject?.tool])
  const forgetProject = () => {
    try {
      if (lastProjectKey) localStorage.removeItem(lastProjectKey)
    } catch {
      /* Nothing kept, nothing to forget. */
    }
  }
  const goTab = (v: string) => {
    if (v === 'projects-all' && phone) {
      if (onProject) {
        forgetProject()
        return navigate({ view: 'projects-all' })
      }
      let kept: { projectId: string; tool: string | null } | null = null
      try {
        kept = JSON.parse((lastProjectKey && localStorage.getItem(lastProjectKey)) || 'null')
      } catch {
        kept = null
      }
      const still = kept && projects.find((p) => p.id === kept!.projectId && !p.archived_at)
      if (kept && still) {
        return navigate({ view: 'projects', projectId: kept.projectId, ...(kept.tool ? { tool: kept.tool } : {}) } as Route)
      }
    }
    navigate({ view: v } as Route)
  }
  const drawingTasks = onProject && (onProject.tool === 'tasks' || !onProject.tool)
  /* Written back only from the address that says so. Anywhere else in the
     project — settings, the feed — has no look in it, and remembering that
     would erase what somebody chose on the way past. */
  const onTasks = onProject && onProject.tool === 'tasks' ? onProject : null
  const here = onProject?.projectId ?? null
  const said = Boolean(
    onProject && (onProject.mode || onProject.list || onProject.group || onProject.sort || onProject.dir || onProject.who),
  )
  /*
   * Resolved while the screen is being drawn, not after it.
   *
   * The correction below makes the address true, and an address corrected in
   * an effect is corrected *after* a paint — so a project remembered as a
   * board drew as a list for one frame and then became a board, and the one
   * control on the bar slid from Everything to Board on the way. A `replace`
   * says "this was always the address"; nothing should move to agree with it.
   *
   * `wasOn` still holds where the last paint was, because the effect that
   * writes it has not run yet — which is exactly the question being asked.
   */
  const onHere = here ? `${here}:${onProject?.tool ?? 'tasks'}` : null
  const look = drawingTasks && here && wasOn.current !== onHere && !said ? (lastLook(here) ?? {}) : {}

  useEffect(() => {
    const cameFrom = wasOn.current
    /* Only once the address has settled on a tool: the half-resolved one is
       the same project, and treating it as a new arrival would make every
       project look like two. */
    if (onProject && !onProject.tool) return
    wasOn.current = onHere
    if (!onTasks || !here) return

    /*
     * Changing it here is a choice; arriving is a question.
     *
     * An empty address is both — pressing "Everything" with the list already
     * showing leaves exactly the address somebody gets from the sidebar. So
     * the two are told apart by where the person was a moment ago: already
     * on this project's tasks means they just chose this, including choosing
     * the defaults, and the memory follows them. Anywhere else means they
     * have arrived and are owed the way they left it.
     */
    /*
     * And an arrival whose address says something is remembered too: the
     * address won, so it is how this project was last looked at. Kept only
     * for a choice, a board reached by a link or by the back button was
     * shown and forgotten — and the next door that names the project and
     * not the look (the palette, a note) opened the list.
     */
    if (cameFrom === onHere || said) {
      rememberLook(here, {
        ...(onTasks.mode ? { mode: onTasks.mode } : {}),
        ...(onTasks.list ? { list: onTasks.list } : {}),
        ...(onTasks.group ? { group: onTasks.group } : {}),
        ...(onTasks.sort ? { sort: onTasks.sort } : {}),
        ...(onTasks.dir ? { dir: onTasks.dir } : {}),
        ...(onTasks.who ? { who: onTasks.who } : {}),
      })
      return
    }

    /* Arrived, and the address said nothing: what was remembered fills it.
       One that says anything was chosen by whoever sent it, and filling the
       rest in behind them would be the product arguing with a link — which
       is why `look` is empty when `said`. */
    if (Object.keys(look).length > 0) replace({ ...route, ...look })
  }, [route, replace, onProject, onTasks, here, onHere, said, look])

  /*
   * A door from outside the tasks screen into the project it is open over.
   *
   * The palette, a note, a task named on somebody's card: each names the
   * task and not how the list is being looked at. Into another project that
   * is an arrival, and the memory above fills it in. Into this one it read
   * as a choice — the same project's tasks a moment ago — so a board with a
   * task opened from ⌘K turned into the list under it, and that empty look
   * was what got remembered. The look on the screen goes with the door
   * instead, as the tasks screen's own navigations carry it.
   */
  const keepLook = (r: Route): Route => {
    if (r.view !== 'projects' || r.tool !== 'tasks' || !onTasks || r.projectId !== onTasks.projectId) return r
    const kept: Partial<Record<'mode' | 'list' | 'group' | 'sort' | 'dir' | 'who' | 'labels', string>> = {}
    for (const key of ['mode', 'list', 'group', 'sort', 'dir', 'who', 'labels'] as const) {
      const value = r[key] ?? onTasks[key]
      if (value) kept[key] = value
    }
    return { ...r, ...kept }
  }

  /*
   * What number 41 is, when the address arrives before the screen that knows.
   *
   * A link is opened cold: nothing here has drawn the project's rows yet, so
   * the number has to be asked about. Clicked from inside, the list has
   * already said which id carries which number and this never runs.
   */
  const at = beneath.view === 'projects' ? (beneath.at ?? null) : null
  /* Which counter the number is off, from the tab the address names:
     tasks count on their own, posts and files together. */
  const atKind: Numbered =
    beneath.view === 'projects' && beneath.tool === 'posts'
      ? 'post'
      : beneath.view === 'projects' && beneath.tool === 'files'
        ? 'file'
        : 'task'
  const key = beneath.view === 'projects' && beneath.projectId && at !== null ? `${beneath.projectId}:${atKind}:${at}` : ''
  const carriedAt = (k: string): string | null => {
    const [p, kind, n] = k.split(':') as [string, Numbered, string]
    return carrying(p, Number(n), kind)
  }
  useEffect(() => {
    if (!key || key in found) return
    const [id, kind, number] = key.split(':') as [string, Numbered, string]
    /* Asked of what has already been drawn first. Clicked from a list, the
       answer is in hand — the list said which id carries which number a
       moment ago — and going to the server for it is a round trip before
       anything can be shown. */
    const already = carrying(id, Number(number), kind)
    if (already) {
      setFound((was) => ({ ...was, [key]: already }))
      return
    }
    /* Not there is an answer, and only a 404 says it: the screen then says
       the thing is gone rather than waiting for something never coming.
       Anything else — the server restarting, a 500 — was remembered as
       "nothing is number 118" for the rest of the session, about a task
       that was there. It is asked again instead. `docs/specs/not-there.md`. */
    return untilAnswered(
      () =>
        api<{ id: string; kind: string }>(`/projects/${id}/at/${number}?kind=${kind}`).then((r) => {
          numbered([{ id: r.id, number: Number(number) }], id, kind)
          setFound((was) => ({ ...was, [key]: r.id }))
        }),
      () => setFound((was) => ({ ...was, [key]: '' })),
    )
  }, [key, found, setFound])

  // The list is only on one screen, so it is fetched when that screen opens
  // rather than on every load of the app.
  useEffect(() => {
    if (view === 'members') void loadInvites()
  }, [view, loadInvites])

  /**
   * `c` makes something, the way `⌘K` goes somewhere.
   *
   * A bare letter is only free while nobody is typing, so this stands down
   * for a field, for anything editable, and for a dialog or the palette that
   * is already open and already asking for an answer. Without that guard the
   * letter `c` cannot be typed into a task title, which is a shortcut that
   * breaks the thing it opens.
   *
   * The key, not the character — see `isKey`. On a Russian layout this
   * arrives as `с` and the shortcut would exist only for people typing in
   * English.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isKey(e, 'c') || e.metaKey || e.ctrlKey || e.altKey) return
      const el = e.target as HTMLElement | null
      if (el?.isContentEditable) return
      if (el && ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return
      if (document.querySelector('[role="dialog"], [data-testid="palette-input"]')) return
      e.preventDefault()
      setMaking(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setMaking])

  /*
   * A project asked for while the pointer is still on its way to it.
   *
   * A cold project opens on its chrome and fills a frame later — the data
   * cannot be there before it is asked for, so it is asked for earlier. The
   * gap between a pointer landing on a sidebar row and the button going down
   * is longer than any of these requests.
   *
   * Once per project per session: this is a head start, not a refresh, and
   * running down the sidebar with the mouse must not cost a request per row
   * it passes over. `data/memory.ts` is where the answers go, which is where
   * the screens read from.
   */
  const asked = useRef(new Set<string>())
  const projectNear = useCallback((id: string) => {
    if (asked.current.has(id)) return
    asked.current.add(id)
    void api<{ tasks: unknown[] }>(`/projects/${id}/tasks`)
      .then((r) => remember(`tasks:${id}`, r.tasks))
      .catch(() => asked.current.delete(id))
    void api<{ lists: unknown[] }>(`/projects/${id}/lists`)
      .then((r) => remember(`lists:${id}`, r.lists ?? []))
      .catch(() => {})
    void api<{ members: unknown[] }>(`/projects/${id}/members`)
      .then((r) => remember(`members:${id}`, r.members))
      .catch(() => {})
  }, [])

  /*
   * The rooms with something new in them, warmed once the shell is drawn and
   * the browser has nothing else to do — their newest messages and the
   * pictures in them, so the room somebody opens next opens sharp. A handful,
   * not every room: this is for what is waiting, not a download of the chat.
   */
  const warmedRooms = useRef(false)
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, when the rooms first arrive; roomNear is new on every render
  useEffect(() => {
    if (warmedRooms.current || rooms.length === 0) return
    warmedRooms.current = true
    const waiting = rooms.filter((r) => Number(r.unread ?? 0) > 0).slice(0, 6)
    const idle = (f: () => void) =>
      'requestIdleCallback' in window ? window.requestIdleCallback(f, { timeout: 3000 }) : setTimeout(f, 1500)
    idle(() => {
      for (const r of waiting) roomNear(r.id)
    })
  }, [rooms])

  const roomNear = useCallback((id: string) => {
    if (asked.current.has(id)) return
    asked.current.add(id)
    /* The room's newest page and the pictures in its last messages, so it
       opens drawn — `data/warm.ts`. */
    void warmRoom(id).catch(() => asked.current.delete(id))
  }, [])

  /*
   * The frame `index.html` painted is taken away in the frame the app first
   * draws something of its own over it — the shell, which covers it sheet
   * for sheet, or the sign-in, which it must not show through. A layout
   * effect, so the two are never on the screen apart.
   * `docs/specs/arrival.md`.
   */
  const drawn = !signedIn || Boolean(me) || stranded
  useLayoutEffect(() => {
    if (drawn) document.getElementById('frame')?.remove()
    if (!signedIn || stranded) letGo()
  }, [drawn, signedIn, stranded])

  /*
   * The contents arrive once, together.
   *
   * The shell is drawn the moment `/me` answers, and every screen in it asks
   * for its own data then — so for a few hundred milliseconds the sidebar,
   * the bar and the work each filled in on their own beat, which reads as
   * the screen assembling itself. Held clear instead while those first
   * reads are on their way, two frames running with none left, and faded in
   * together; never longer than `ARRIVAL_CAP`, because a slow answer is a
   * reason to show what is there, not to keep showing nothing. Once per page
   * load: after this, moving around is instant and nothing fades.
   */
  /*
   * Kept on the element, not in state.
   *
   * It was state, and every step of it — held, fading, done — re-rendered
   * the whole shell a few hundred milliseconds after load, which is exactly
   * when a person (or a test) starts pressing things. Three renders nobody
   * needed, landing on whatever was half-open. The attribute is the only
   * thing that changes, so it is the only thing written.
   */
  const shell = useRef<HTMLDivElement | null>(null)
  const shown = Boolean(me)
  // biome-ignore lint/correctness/useExhaustiveDependencies: kept is a ref, read when the shell is shown
  useLayoutEffect(() => {
    const el = shell.current
    if (!shown) return
    /* Drawn from the shelf, the contents are already the last ones this
       person saw: there is nothing to hold them clear for. */
    if (!el || kept.current) return letGo()
    el.dataset.arriving = 'wait'
    const start = performance.now()
    let quiet = 0
    let done: ReturnType<typeof setTimeout> | undefined
    let frame = requestAnimationFrame(function tick() {
      quiet = readsInFlight() === 0 ? quiet + 1 : 0
      if (quiet >= 2 || performance.now() - start > ARRIVAL_CAP) {
        el.dataset.arriving = 'go'
        letGo()
        done = setTimeout(() => delete el.dataset.arriving, 400)
      } else frame = requestAnimationFrame(tick)
    })
    return () => {
      cancelAnimationFrame(frame)
      clearTimeout(done)
      delete el.dataset.arriving
    }
  }, [shown])

  /*
   * The number on the icon, for the copy somebody keeps in their dock: what
   * the inbox holds and what the rooms hold, as the sidebar counts them.
   * It was the inbox alone and only at load, so a
   * direct message never reached the icon and a room read left its number
   * there until a reload. A mention is the inbox's, so a room adds what
   * arrived beyond its mentions; the room on the screen adds nothing.
   */
  const openRoom = beneath.view === 'chat' ? (beneath.roomId ?? null) : null
  useEffect(() => {
    if (!loaded) return
    const inbox = inboxCount(unread)
    const waiting = rooms.reduce(
      (n, r) =>
        r.id === openRoom || r.project_archived || leftRoom(r) || (r.notify ?? 'all') !== 'all'
          ? n
          : n + Math.max(0, Number(r.unread ?? 0) - Number(r.mentions ?? 0)),
      0,
    )
    badge(inbox + waiting)
    /* And a red dot on the tab's icon, where a browser tab has no number. */
    faviconDot(inbox + waiting > 0)
  }, [loaded, unread, rooms, openRoom])

  /* Who is an agent, for the mark beside what they wrote — `ui/Origin.tsx`. */
  const agentIds = useMemo(() => new Set(people.filter((p) => p.agent).map((p) => p.actor_id)), [people])
  const projectMarks = useMemo(
    () => new Map([...archivedProjects, ...projects].map((p) => [p.id, p] as const)),
    [projects, archivedProjects],
  )
  return {
    onProject,
    forgetProject,
    goTab,
    look,
    keepLook,
    at,
    key,
    carriedAt,
    projectNear,
    roomNear,
    shell,
    agentIds,
    projectMarks,
  } as const
}
export type AppPlace = ReturnType<typeof useAppPlace>
