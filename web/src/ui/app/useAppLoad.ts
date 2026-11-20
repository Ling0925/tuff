import { edition } from '../../edition.jsx'
import { setZone } from '../../data/zone.js'
import { useCallback, useState, useRef } from 'react'
import { readTongue, now, chooseTongue } from '../../data/words.js'
import { api, setSession, type Session, everyPage, stored } from '../../data/api.js'
import { askedFor, known, parse } from '../../data/route.js'
import { type Room } from '../Sidebar.jsx'
import { dealFaces } from '../../data/faces.js'
import { scopeTo, remember, recall, lastScope, hydrate } from '../../data/memory.js'
import { type Me, type Project, type Unread } from './model.js'
import { Person } from './person.jsx'
import { type Note } from './notes.jsx'
import { setQuestions, type Question } from '../../data/needsYou.js'
import { workingFrom } from '../../data/working.js'
import { type AppState } from './useAppState.js'

/**
 * Reading the workspace: everything the shell draws, from the server or
 * from what this device kept of it.
 */
export function useAppLoad({
  setMe,
  setProjects,
  setArchivedProjects,
  setPeople,
  setRooms,
  setLoaded,
  setNotes,
  setUnread,
}: Pick<AppState, 'setMe' | 'setProjects' | 'setArchivedProjects' | 'setPeople' | 'setRooms' | 'setLoaded' | 'setNotes' | 'setUnread'>) {
  /**
   * Everything the frame of the app is made of, at once.
   *
   * This was five requests in a chain — me, then projects, then people, then
   * rooms, then the inbox — each waiting on the one before it for no reason
   * but the order it was written in. Five round trips instead of two, and
   * worse than slow: the sidebar filled in stages, so the projects arrived
   * and pushed Chat down, then the rooms arrived and pushed the rest down
   * again, while somebody was already reading it. A hundred and two pixels
   * of movement, measured, on every load of the app.
   *
   * Only `/people` genuinely waits, because whether to ask at all is an
   * answer `/me` carries: a guest has no people list and asking anyway is a
   * 403 on every load rather than a missing screen.
   */
  const load = useCallback(async () => {
    /* A session in no workspace has none of this; its own screen asks for
       what it needs — `ui/Nowhere.tsx`. */
    if (stored()?.workspace_id === null) return
    const m = await api<Me>('/me')
    /* Whose shelf this session's answers go on — `docs/specs/offline.md`. */
    scopeTo(`${m.actor.id}:${m.workspace.id}`)
    /*
     * The address says which workspace, the session proves you may be in it.
     *
     * A link into another workspace is answered by getting a session for it,
     * which is the same thing the switcher does, and then by reloading:
     * everything on the screen belongs to the one being left. If there is no
     * such workspace for this person the address is wrong, and the segment
     * is put right rather than left lying about where they are.
     */
    const wanted = askedFor()
    if (wanted && wanted !== m.workspace.slug) {
      const { workspaces } = await api<{ workspaces: { id: string; slug: string }[] }>('/workspaces')
      const into = workspaces.find((w) => w.slug === wanted)
      if (into) {
        setSession(await api<Session>(`/workspaces/${into.id}/enter`, { method: 'POST' }))
        location.reload()
        return
      }
      history.replaceState(null, '', location.pathname.replace(`/${wanted}`, `/${m.workspace.slug}`) + location.search)
    }
    const [p, people_, conversations, inbox, putAway] = await Promise.all([
      everyPage<Project>('/projects', 'projects') as Promise<{ projects: Project[] }>,
      m.can.includes('people.read') ? api<{ people: Person[] }>('/people') : Promise.resolve({ people: [] as Person[] }),
      // Every room this person is in, for the sidebar. One list, because a
      // conversation is reached from the sidebar and from its project and
      // both have to agree about which rooms exist.
      api<{ conversations: Room[] }>('/conversations'),
      // One inbox for everything, so it is loaded once rather than per screen.
      api<{ notifications: Note[]; unread: Unread; questions?: Question[] }>('/inbox'),
      // The archived ones, for their addresses — a short list, and an
      // archived project opened by a link is still one somebody can read.
      (everyPage<Project>('/projects?archived=true', 'projects') as Promise<{ projects: Project[] }>).catch(() => ({
        projects: [] as Project[],
      })),
    ])
    /* Kept for a window opened with no connection: the frame of the app is
       these five answers, and without them there is nothing to draw the
       rest into. */
    remember('shell', {
      me: m,
      projects: p.projects,
      people: people_.people,
      rooms: conversations.conversations,
      notes: inbox.notifications,
      unread: inbox.unread,
      questions: inbox.questions ?? [],
    })
    /*
     * Where this person is, said by the device while the account still
     * holds the default — `docs/specs/person-card.md`. Nothing else set it,
     * so every card would have put everyone in London's night. A zone
     * somebody chose is not the default and stays chosen.
     */
    try {
      const here = Intl.DateTimeFormat().resolvedOptions().timeZone
      /* The zone a reminder's "tomorrow at nine" is read in — the account's,
         or the device's while the account is being told it. */
      setZone(m.actor.timezone === 'UTC' && here ? here : m.actor.timezone)
      if (here && m.actor.timezone === 'UTC' && here !== 'UTC' && here !== 'Etc/UTC') {
        void api('/inbox/settings', { method: 'PATCH', body: JSON.stringify({ timezone: here }) }).catch(() => {})
      }
    } catch {
      // A browser that cannot name its zone leaves the account as it was.
    }
    /*
     * The language, which the account keeps so the mail speaks it too.
     * Chosen on this device, it is told to the
     * account; never chosen here, the account's is taken, once, before
     * anything is drawn in the other one.
     */
    const said = readTongue()
    const kept = m.actor.language ?? null
    if (said === 'en' || said === 'fr') {
      if (kept !== said) void api('/me', { method: 'PATCH', body: JSON.stringify({ language: said }) }).catch(() => {})
    } else if (said === 'system' && (kept === 'en' || kept === 'fr') && kept !== now) {
      chooseTongue(kept)
      return
    }
    /* Set together, so the sidebar is drawn once rather than four times,
       each one moving what is below it. */
    /* What the edition asks before the app is drawn, which may take the
       browser somewhere else first. */
    if (await edition.beforeApp(m.can)) return
    fresh.current = true
    setMe(m)
    /* Before the screens are drawn: until this lands, an address naming a
       project is a name the router cannot read. */
    known({ workspace: m.workspace.slug, projects: [...p.projects, ...putAway.projects] })
    setProjects(p.projects)
    setArchivedProjects(putAway.projects)
    setPeople(people_.people)
    /* What the agents say they are doing now. */
    workingFrom(people_.people)
    dealFaces(people_.people.map((p) => p.actor_id))
    setRooms(conversations.conversations)
    setNotes(inbox.notifications)
    setUnread(inbox.unread)
    setQuestions(inbox.questions)
    setLoaded(true)
  }, [setProjects, setArchivedProjects, setMe, setRooms, setUnread, setPeople, setLoaded, setNotes])

  /* One part of the shelf read again — the rooms, the inbox — kept beside
     the rest, so a window opened with no connection draws the last of it. */
  const shelve = useCallback((part: Record<string, unknown>) => {
    const had = recall<Record<string, unknown>>('shell')
    if (had) remember('shell', { ...had, ...part })
  }, [])

  /*
   * The app's frame from this machine's shelf, when the server is not there.
   * `stranded` is the one case with nothing to draw: offline, and nothing
   * kept yet for whoever was last signed in here.
   */
  const [stranded, setStranded] = useState(false)
  /*
   * And at every start, not only an offline one — `docs/specs/arrival.md`.
   *
   * The shell waited for `/me` and then for five more answers before it drew
   * anything, two round trips on a phone's connection with a blank screen
   * all through them. Now the last answers this machine kept are drawn the
   * moment they are read off the disk, and the server's replace them in
   * place when they come — a screen opens on what it showed last.
   *
   * `early` is that case, and it is careful where the offline one need not
   * be: only the shelf of the session that is signed in now, not a link
   * into another workspace, not an address naming a project the shelf has
   * never heard of, and never after the server has already answered.
   */
  const fresh = useRef(false)
  const kept = useRef(false)
  const fromShelf = useCallback(
    async (early = false) => {
      const owner = lastScope()
      const session = stored()
      if (session?.workspace_id === null) return
      if (early && (!owner || !session || owner !== `${session.actor_id}:${session.workspace_id}`)) return
      if (owner) await hydrate(owner, early)
      if (fresh.current) return
      const shelf = recall<{
        me: Me
        projects: Project[]
        people: Person[]
        rooms: Room[]
        notes: Note[]
        unread: Unread
        questions?: Question[]
      }>('shell')
      if (!owner || !shelf) {
        if (!early) setStranded(true)
        return
      }
      if (early) {
        const wanted = askedFor()
        if (wanted && wanted !== shelf.me.workspace.slug) return
        known({ workspace: shelf.me.workspace.slug, projects: shelf.projects })
        const at = parse(location.href)
        if ('unknown' in at && at.unknown) return
      }
      kept.current = true
      scopeTo(owner)
      known({ workspace: shelf.me.workspace.slug, projects: shelf.projects })
      setProjects(shelf.projects)
      setPeople(shelf.people)
      dealFaces(shelf.people.map((p) => p.actor_id))
      setRooms(shelf.rooms)
      setNotes(shelf.notes)
      setUnread(shelf.unread)
      setQuestions(shelf.questions)
      setMe(shelf.me)
      setLoaded(true)
    },
    [setLoaded, setNotes, setRooms, setUnread, setProjects, setMe, setPeople],
  )
  return { load, shelve, stranded, setStranded, kept, fromShelf } as const
}
export type AppLoad = ReturnType<typeof useAppLoad>
