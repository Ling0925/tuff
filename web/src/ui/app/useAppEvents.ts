import { useState, useEffect } from 'react'
import { isOnline, onReach, whenSignedOut, Unreachable, api } from '../../data/api.js'
import { heard } from '../../data/live.js'
import { type Room } from '../Sidebar.jsx'
import { keepOpen } from '../../data/socket.js'
import { watching, chime, readyChime } from '../../data/chime.js'
import { warmRoom } from '../../data/warm.js'
import { type Unread } from './model.js'
import { type Note } from './notes.jsx'
import { setQuestions, type Question } from '../../data/needsYou.js'
import { type AppState } from './useAppState.js'
import { type AppLoad } from './useAppLoad.js'

/**
 * What reaches the shell while it is open: the connection coming and
 * going, and the changes other people make.
 */
export function useAppEvents({
  me,
  projects,
  route,
  replace,
  setRooms,
  roomsNow,
  setRevision,
  setNotes,
  setUnread,
  signedIn,
  setSignedIn,
  load,
  shelve,
  setStranded,
  fromShelf,
}: Pick<
  AppState,
  'me' | 'projects' | 'route' | 'replace' | 'setRooms' | 'roomsNow' | 'setRevision' | 'setNotes' | 'setUnread' | 'signedIn' | 'setSignedIn'
> &
  Pick<AppLoad, 'load' | 'shelve' | 'setStranded' | 'fromShelf'>) {
  /*
   * And back when the connection is: the frame reloaded and every screen
   * asked again, the same refetch a reload would do.
   */
  const [, setOnline] = useState(isOnline)
  useEffect(
    () =>
      onReach((now) => {
        setOnline(now)
        if (!now || !signedIn) return
        void load()
          .then(() => setStranded(false))
          .catch(() => {})
        setRevision((r) => r + 1)
      }),
    [signedIn, load, setRevision, setStranded],
  )

  useEffect(() => {
    /* A session ended from elsewhere is a fresh page at the door, not this
       one with the last person's sidebar still in it. */
    whenSignedOut(() => location.replace('/signin'))
    if (!signedIn) return
    void fromShelf(true)
    void load().catch((e: unknown) => {
      /*
       * A server that cannot be reached is not a session that has ended.
       *
       * Any failure here used to sign the person out, so a window opened on
       * a train showed the sign-in — which cannot work either — instead of
       * what they were reading ten minutes ago. Now the last answers this
       * machine kept are drawn, and a fresh load follows the connection
       * back. `docs/specs/offline.md`.
       */
      if (e instanceof Unreachable) void fromShelf()
      else setSignedIn(false)
    })
  }, [signedIn, load, fromShelf, setSignedIn])

  /*
   * The shell hears what is addressed to this person, and reads it again.
   *
   * The rooms and the inbox were fetched once when the shell loaded and never
   * after, so a message in a channel nobody was looking at — or a task
   * somebody else put on you — arrived on the next reload. The open room has
   * had a socket since chat was built; this is the one for everything the
   * screen is *not* showing.
   *
   * It carries a word, and the answer is the same refetch a reload would do:
   * one path into the data rather than two that can drift apart.
   */
  useEffect(() => {
    if (!signedIn) return
    /*
     * Each word reads what it is about, and nothing else.
     *
     * Every word read the whole shell again — who I am, every project,
     * every person, every room, the inbox, the archive — so one message in
     * a room of a thousand was nine thousand requests, the workspace's
     * minute of them gone on the first one, and everybody in it refused
     * until the minute was out.
     *
     * - **message**: somebody else said something in a room. Counted
     *   here, on the room's row; the list is read only for a room it does
     *   not have or one put away, which the message brings back.
     * - **notification**: the inbox, and the rooms with it when it is a
     *   mention — together, see `readBoth`.
     * - **read**: this person read something on another screen. Both, now.
     *
     * Whatever is read is read a second or so later, spread over two more,
     * so a thousand windows hearing one word do not ask in the same instant.
     */
    const timers = new Map<'rooms' | 'notes' | 'both', ReturnType<typeof setTimeout>>()
    const warming = new Set<string>()
    const readRooms = () =>
      api<{ conversations: Room[] }>('/conversations')
        .then((r) => {
          setRooms(r.conversations)
          shelve({ rooms: r.conversations })
        })
        .catch(() => {})
    const readNotes = () =>
      api<{ notifications: Note[]; unread: Unread; questions?: Question[] }>('/inbox')
        .then((r) => {
          setNotes(r.notifications)
          setUnread(r.unread)
          setQuestions(r.questions)
          shelve({ notes: r.notifications, unread: r.unread, questions: r.questions ?? [] })
        })
        .catch(() => {})
    /*
     * The rooms and the inbox in one go, drawn in one go. A mention is in
     * both — the room's count less its mentions, plus the inbox — and read
     * as two requests a second apart, the inbox arrived first and the icon
     * said 2 for one mention until the rooms caught up and took one back.
     */
    const readBoth = () =>
      Promise.all([
        api<{ conversations: Room[] }>('/conversations'),
        api<{ notifications: Note[]; unread: Unread; questions?: Question[] }>('/inbox'),
      ])
        .then(([r, n]) => {
          setRooms(r.conversations)
          setNotes(n.notifications)
          setUnread(n.unread)
          setQuestions(n.questions)
          shelve({ rooms: r.conversations, notes: n.notifications, unread: n.unread, questions: n.questions ?? [] })
        })
        .catch(() => {})
    const soon = (what: 'rooms' | 'notes' | 'both') => {
      if (timers.has(what)) return
      timers.set(
        what,
        setTimeout(
          () => {
            timers.delete(what)
            void (what === 'rooms' ? readRooms() : what === 'notes' ? readNotes() : readBoth())
          },
          1000 + Math.random() * 2000,
        ),
      )
    }
    const onWord = (ev: MessageEvent) => {
      /* Passed on to whatever else is open — `web/src/data/live.ts`. A
         screen that wanted this would otherwise hold a second socket of its
         own, which is two connections per tab for the same words. */
      let word = ''
      let room = ''
      let reason = ''
      try {
        const said = JSON.parse(String(ev.data)) as {
          kind?: string
          payload?: { conversation_id?: string; reason?: string }
        }
        word = String(said.kind ?? '')
        room = String(said.payload?.conversation_id ?? '')
        reason = String(said.payload?.reason ?? '')
      } catch {
        word = ''
      }
      heard(word)
      /* A sound for something said to you — `docs/specs/chime.md`: every
         message in a room left at "all", unless it is the room on the
         screen; a mention wherever, unless the room was told to say
         nothing, in which case the server made no note to hear. */
      if (word === 'message' && room) {
        const level = roomsNow.current.find((r) => r.id === room)?.notify ?? 'all'
        if (level === 'all' && !watching(room)) chime()
      }
      if (word === 'notification' && reason === 'mentioned') chime()

      if (word === 'message' && room) {
        const known = roomsNow.current.find((r) => r.id === room)
        if (!known || known.hidden) soon('rooms')
        else if (!watching(room)) {
          /* The server counts to a hundred and the badge says 99+ past it. */
          setRooms((all) => all.map((r) => (r.id === room ? { ...r, unread: String(Math.min(Number(r.unread ?? 0) + 1, 100)) } : r)))
        }
        /* Its newest messages and their pictures, fetched now, so the room
           opens on them sharp rather than on their glance — for a room near
           the top of a window somebody is looking at, once a few seconds
           per room. Every window warming every room was a read of every
           room for every message said in it. */
        const near = roomsNow.current
          .filter((r) => !r.hidden)
          .slice(0, 8)
          .some((r) => r.id === room)
        if (near && document.visibilityState === 'visible' && !warming.has(room)) {
          warming.add(room)
          setTimeout(
            () => {
              warming.delete(room)
              void warmRoom(room).catch(() => {})
            },
            800 + Math.random() * 1200,
          )
        }
        return
      }
      if (word === 'notification') {
        soon(reason === 'mentioned' ? 'both' : 'notes')
        return
      }
      /* Being read is one word and not a burst — and the one the badges
         are waiting on: the hand already pressed the row. */
      if (word === 'read') void readBoth()
    }
    /* Opened again when it drops — a deploy, a laptop waking — and the shell
       read again, whole, when it is back: what arrived meanwhile was said to
       nobody. `data/socket.ts` spreads the coming back. */
    readyChime()
    const socket = keepOpen('/ws/me', onWord, () => void load().catch(() => {}))
    /*
     * And the same socket says "still here" — `docs/specs/presence.md`.
     *
     * While the tab is **visible**, not merely while the socket is open: a
     * laptop asleep with this page in front of it holds the connection for
     * hours, and a connection is not a person. A backgrounded tab says
     * nothing and its person goes away in five minutes, which is what
     * somebody expects when they switch to another app.
     *
     * On the socket rather than through an endpoint, because the socket is
     * already there: no new route, no round trip, one write a minute.
     */
    const here = () => {
      if (document.visibilityState !== 'visible') return
      socket.send('here')
    }
    const beat = setInterval(here, 60_000)
    document.addEventListener('visibilitychange', here)
    /*
     * And the counts read again when the window comes back to somebody, and
     * now and then while it is in front of them.
     *
     * The badge on the bell was only ever as good as the last word the
     * socket carried, and a word can be missed with the socket looking
     * fine: the server's listening connection coming back after a hiccup
     * drops what was said meanwhile, a request refused at the minute's
     * ceiling is swallowed, a tab away for less than the minute that
     * reopens the socket hears nothing on return, and a note held for
     * quiet hours is never announced when it is released — it was said
     * when it was written, while it still could not be counted. Each left
     * the bell bare over notifications that were there. The server's count
     * is the truth; this asks for it on return and every few minutes,
     * spread, rather than trusting that nothing was missed.
     */
    /* From now: the shell has just read them whole. */
    let asked = Date.now()
    const freshen = () => {
      if (document.visibilityState !== 'visible') return
      if (Date.now() - asked < 5_000) return
      asked = Date.now()
      void readBoth()
    }
    const nowAndThen = setInterval(freshen, 240_000 + Math.random() * 120_000)
    document.addEventListener('visibilitychange', freshen)
    window.addEventListener('focus', freshen)
    return () => {
      for (const t of timers.values()) clearTimeout(t)
      clearInterval(beat)
      clearInterval(nowAndThen)
      document.removeEventListener('visibilitychange', here)
      document.removeEventListener('visibilitychange', freshen)
      window.removeEventListener('focus', freshen)
      socket.stop()
    }
  }, [signedIn, load, shelve, roomsNow, setNotes, setUnread, setRooms])

  /*
   * A bare /p with no project resolves to the first one, said again more
   * precisely. Replacing rather than pushing keeps that resolution out of the
   * history: the back button should leave the project, not walk through the
   * app deciding which project it meant.
   */
  useEffect(() => {
    if (route.view === 'projects' && !route.projectId && !route.unknown && projects[0]) {
      replace({ view: 'projects', projectId: projects[0].id })
    }
    /* And a bare `/` settles on the workspace you are in, once it is known.
       The address is where you are, and "nowhere in particular" is not a
       place. */
    if (me && location.pathname === '/') replace(route)
  }, [route, projects, me, replace])
}
export type AppEvents = ReturnType<typeof useAppEvents>
