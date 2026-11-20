import { useState, useRef, useEffect, useCallback } from 'react'
import { membersDoor } from '../../data/doors.js'
import { api, stored } from '../../data/api.js'
import { useRoute, type Route } from '../../data/route.js'
import { type Room } from '../Sidebar.jsx'
import { warmPush, pushKnown } from '../Account.jsx'
import { useAgents } from '../Agents.jsx'
import { usePhone, useWide, useColumn } from '../kit.jsx'
import { auditPath, AUDIT_PEOPLE } from '../AuditLog.jsx'
import { workspaceSettingsReads, accountReads, instanceReads, membersReads, ahead, known } from '../../data/ahead.js'
import { type Me, type Project, useWhole, type Unread, type Invitation } from './model.js'
import { Person } from './person.jsx'
import { type Note } from './notes.jsx'
import { readShutGroups, SHUT_GROUPS } from './members.jsx'

/**
 * What the shell holds: who is signed in, the projects, people and rooms,
 * where the address says we are, and the windows open over the work.
 */
export function useAppState() {
  const [me, setMe] = useState<Me | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  /* The ones put away, so an archived project still opens as it was —
     `docs/specs/projects-index.md`. Not in the sidebar, which is `projects`. */
  const [archivedProjects, setArchivedProjects] = useState<Project[]>([])
  const [people, setPeople] = useState<Person[]>([])
  /* Whose window is open over the screen — `docs/specs/person-card.md`. */
  const [shownPerson, setShownPerson] = useState<string | null>(null)
  /* A channel of the workspace's own, being named. */
  const [channelDraft, setChannelDraft] = useState(false)
  /*
   * Where you are lives in the address bar, not in this component.
   *
   * Two places that both believe they know which screen is open disagree the
   * first time the back button is pressed — so there is one, and it is the
   * one people can copy out of the browser and send to somebody.
   */
  const { route, go: navigate, replace } = useRoute()
  /*
   * Two addresses are something over a screen rather than a screen of
   * their own: search, and what is addressed to you.
   *
   * `/:ws/search?q=` is an address because a search has to be sendable, and
   * the view spec says it opens the palette over whatever was there
   * and puts the address back on closing. But `view` went to `search`, and
   * nothing under this draws for that name — so the work area went blank
   * behind the palette and the screen somebody was reading was erased by
   * the act of searching it.
   *
   * `/:ws/notifications` is the same shape for the same reason. It was a
   * page, and a page is the wrong size for it: what is addressed to you is
   * a thing you glance at and dismiss — nine times out of ten to open one
   * of them and get back to work — and a page makes that a departure and a
   * return. A panel over the screen is read and shut without leaving
   * anywhere. The address stays, because a link to your inbox is still a
   * link, and closing puts back the one underneath.
   *
   * So the screen underneath is the last one that was a screen. Held in a
   * ref rather than state: it is read during the same render that sets it,
   * and setting state here would be a second render whose only job is to
   * draw what the first one already knew.
   */
  /* Below 640 the places are tabs along the foot, and Search is one of
     them: a screen there, not a box over one. */
  const phone = usePhone()
  const over = (v: Route['view']) => (v === 'search' && !phone) || v === 'notifications'
  const under = useRef<Route>(route)
  if (!over(route.view)) under.current = route
  const beneath = over(route.view) ? under.current : route
  const view = beneath.view
  /* The workspace's settings drawn whole: what its sections read, read
     first — and on the door, while the pointer is on it. `data/ahead.ts`. */
  /* And the audit log under them, which reads its first page and the people
     it can be narrowed to. */
  const audit = beneath.view === 'settings' && beneath.audit ? beneath : null
  const settingsReads = me ? workspaceSettingsReads(me.can) : []
  const settingsWhole = useWhole(settingsReads, view === 'settings' && !audit)
  /* Its own wait, so going from the settings to it waits for its answers
     rather than counting the settings' as its own. A filter changed later
     keeps the page standing: the list replaces itself in place. */
  const auditReads = me?.can.includes('audit.read') && audit ? [auditPath(audit.type, audit.who), AUDIT_PEOPLE] : []
  const auditWhole = useWhole(auditReads, Boolean(audit))
  const accountWhole = useWhole(me ? accountReads(me.can) : [], view === 'account', { ask: warmPush, known: pushKnown })
  /* Your own server's, for its owner. */
  const instanceOpen = view === 'instance' && Boolean(me?.can.includes('instance'))
  const instanceWhole = useWhole(instanceOpen ? instanceReads : [], instanceOpen)
  const [rooms, setRooms] = useState<Room[]>([])
  /* The rooms as they are now, for the socket's handler, which was made
     once and would otherwise read the list it was made with. */
  const roomsNow = useRef(rooms)
  roomsNow.current = rooms
  /** Set once the first load has finished, so nothing claims emptiness early. */
  const [loaded, setLoaded] = useState(false)

  /**
   * Bumped when something is made from outside the screen showing it.
   *
   * The palette can add a task to the project already open, and the list
   * there has no way to know: it fetched when it mounted and nothing
   * remounted it. Without this the interface says it worked and shows
   * nothing, which is the worst of the three possible answers.
   */
  const [revision, setRevision] = useState(0)
  /** Numbers already looked up: `<project id>:<number>` to the object's id. */
  const [found, setFound] = useState<Record<string, string>>({})
  const [palette, setPalette] = useState(false)
  /*
   * The sidebar, on a screen with no room for it as a column.
   *
   * Not a screen and not an address: a drawer has no URL, does not survive a
   * reload and is not what the back button closes. Back leaves the project,
   * here as on a laptop — `docs/specs/narrow.md`.
   */
  const [drawer, setDrawer] = useState(false)
  const wide = useWide()

  /*
   * Members opens on its first person where the roster and the profile sit
   * side by side. Half the screen saying "pick
   * someone" is a screen with nothing on it. `replace`, as any default the
   * app resolves: back leaves Members rather than walking through it. On a
   * phone the roster is the screen, and nobody is opened for them.
   */
  /* The Agents tab's list. Asked for only where
     Members can be opened. */
  const [agents, loadAgents] = useAgents(route.view === 'members' && !!me && membersDoor(me.can))
  /* The column drawn whole: the agents and the invitations are groups in it,
     and each grew in under the people a beat after them. Read on the door
     while the pointer is on it, and waited for here — `data/ahead.ts`. */
  const membersWhole = useWhole(me ? membersReads(me.can) : [], view === 'members')
  useEffect(() => {
    if (route.view !== 'members' || route.actorId || !me) return
    if (!matchMedia('(min-width: 640px)').matches) return
    // The agents' tab opens on its first agent, as the people's on its
    // first person; somebody who has only that tab is always on it.
    if (route.agents || !me.can.includes('members.read')) {
      if (membersDoor(me.can) && agents?.[0]) replace({ view: 'members', actorId: agents[0].actor_id })
      return
    }
    // Not to a page that is not there to open.
    const first = people.find((p) => !p.agent)
    if (first) replace({ view: 'members', actorId: first.actor_id })
  }, [route, people, agents, replace, me])
  /* One number for the column, the bar above it and the handle between
     them. */
  const column = useColumn('sidebar-width', 248, 200, 380)
  /** The global create, opened by the sidebar's button and by `c`. */
  const [making, setMaking] = useState(false)
  /* `null` until the inbox answers — see `Empty` in the kit. */
  const [notes, setNotes] = useState<Note[] | null>(null)
  /*
   * Opening the panel is reading it — `docs/specs/inbox.md`. Everything in
   * it is marked read on the server and the count on the bell goes, but the
   * rows keep their tint for as long as the panel is open: what was new is
   * still worth seeing as new while you look at it. Closed, they are read.
   */
  const notesOpen = route.view === 'notifications'
  /*
   * What was new while this panel has been open, kept here rather than read
   * off `read_at`: the server has it read the moment the panel opens, and
   * the next answer from it — a note arriving, another device reading —
   * took every tint away while the person was still looking at them.
   */
  const [newHere, setNewHere] = useState<ReadonlySet<string>>(() => new Set())
  useEffect(() => {
    if (!notesOpen) {
      setNewHere((had) => (had.size ? new Set() : had))
      return
    }
    if (!notes) return
    setNewHere((had) => {
      const add = notes.filter((n) => !n.read_at && !had.has(n.id))
      return add.length ? new Set([...had, ...add.map((n) => n.id)]) : had
    })
  }, [notesOpen, notes])
  useEffect(() => {
    if (notesOpen) {
      setUnread({ mentioned: '0', assigned: '0', subscribed: '0' })
      void api('/inbox/read', { method: 'POST', body: '{}' }).catch(() => null)
      return
    }
    setNotes((had) => had && had.map((n) => (n.read_at ? n : { ...n, read_at: new Date().toISOString() })))
  }, [notesOpen])
  const [unread, setUnread] = useState<Unread>({ mentioned: '0', assigned: '0', subscribed: '0' })

  const [signedIn, setSignedIn] = useState(Boolean(stored()))
  /* The members screen's find field, and the plus's window, open on the
     tab it was opened for. */
  const [findPeople, setFindPeople] = useState('')
  const [adding, setAdding] = useState<'people' | 'agents' | null>(null)
  /* Its two groups folded or not, kept in this browser for whoever is
     signed in to it: signing out clears every `tracker:` key. */
  const [shutGroups, setShutGroups] = useState<string[]>(readShutGroups)
  const foldGroup = (g: string) =>
    setShutGroups((had) => {
      const next = had.includes(g) ? had.filter((x) => x !== g) : [...had, g]
      try {
        localStorage.setItem(SHUT_GROUPS, JSON.stringify(next))
      } catch {
        /* A private window: folded until the page goes. */
      }
      return next
    })
  /*
   * The invitations still standing.
   *
   * The link was made, shown once and forgotten by the product: nothing ever
   * read `GET /api/invites` and nothing could call the revoke endpoint. An
   * invitation is a credential — a secret URL that makes an account in your
   * workspace — and one that cannot be listed cannot be withdrawn. Somebody
   * pastes it in the wrong chat and the only remedy was waiting a week for
   * it to expire.
   */
  /* From the last answer, so the column opens with them — `data/ahead.ts`. */
  const [invites, setInvites] = useState<Invitation[]>(() => known<{ invites: Invitation[] }>('/invites')?.invites ?? [])
  const loadInvites = useCallback(async () => {
    if (!me?.can.includes('people.invite')) return
    try {
      setInvites((await ahead<{ invites: Invitation[] }>('/invites')).invites)
    } catch {
      setInvites([])
    }
  }, [me?.can])
  return {
    me,
    setMe,
    projects,
    setProjects,
    archivedProjects,
    setArchivedProjects,
    people,
    setPeople,
    shownPerson,
    setShownPerson,
    channelDraft,
    setChannelDraft,
    route,
    navigate,
    replace,
    phone,
    under,
    beneath,
    view,
    audit,
    settingsWhole,
    auditWhole,
    accountWhole,
    instanceWhole,
    rooms,
    setRooms,
    roomsNow,
    loaded,
    setLoaded,
    revision,
    setRevision,
    found,
    setFound,
    palette,
    setPalette,
    drawer,
    setDrawer,
    wide,
    agents,
    loadAgents,
    membersWhole,
    column,
    making,
    setMaking,
    notes,
    setNotes,
    newHere,
    setNewHere,
    unread,
    setUnread,
    signedIn,
    setSignedIn,
    findPeople,
    setFindPeople,
    adding,
    setAdding,
    shutGroups,
    foldGroup,
    invites,
    setInvites,
    loadInvites,
  } as const
}
export type AppState = ReturnType<typeof useAppState>
