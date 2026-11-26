import { useCallback, useEffect, useState } from 'react'
import { leaveFor } from './host.js'

/**
 * Where you are, in the address bar.
 *
 * The design lists a stable URL among the properties every object has, next to
 * its author and its subscribers — and there was no routing at all: the whole
 * app was state in one component, so nothing could be linked to, the back
 * button did nothing, and a reload put you on the first screen.
 *
 * Hand-written rather than a router package. What is needed is parse, format
 * and a listener for `popstate`; a dependency for that is a dependency to
 * keep, and the chosen stack does not name one.
 *
 * **The address speaks names and the app speaks ids**.
 * Everything else in the product passes the keys
 * the database uses; only these two functions know that a project is also
 * called `website-redesign` and a task in it is also called 41, and they
 * translate through the table below.
 */
export type Route =
  | {
      view: 'my'
      /** How the work is mine. Assigned when absent. */
      tab?: string
    }
  | { view: 'search'; q?: string }
  | { view: 'notifications' }
  | { view: 'members'; actorId?: string; agents?: true }
  /** The workspace's settings — its switches, webhooks. */
  | {
      view: 'settings'
      /**
       * The audit log, a page of its own under the settings, narrowed by
       * kind and by person.
       */
      audit?: true
      type?: string
      who?: string
    }
  /** The person's own: face, notifications, second factor, devices, tokens. */
  | { view: 'account' }
  /** A phone's More tab. */
  | { view: 'more' }
  /**
   * The screen of the people who run the product, where the edition has
   * one. The rest of its address is handed over as
   * it came and the edition reads it: what is under it is the service's,
   * not the core's.
   */
  | { view: 'admin'; path?: string }
  /** Your own server's owner screen. Not on the service. */
  | { view: 'instance' }
  | { view: 'projects-all' }
  /**
   * A room, and in it a message to open at — a reply under the message its
   * thread started from.
   */
  | { view: 'chat'; roomId?: string; messageId?: string; threadId?: string }
  | {
      view: 'projects'
      projectId?: string
      /**
       * What the address said, when nothing here can turn it into an id yet.
       *
       * A cold link is a slug arriving before the list it resolves against.
       * The screen waits rather than guessing: a link to a project somebody
       * cannot see must not quietly open a different one.
       */
      unknown?: string
      /** Which of the five tabs. */
      tool?: string
      /** The task or document open inside it. */
      objectId?: string
      /** Its number, while the id behind it is still being looked up. */
      at?: number
      /**
       * Which of Files' places is open — a kind, or Recently Deleted
       * (`FILE_PLACES`). In the path, `/files/images`, because each is a
       * place somebody can be sent to; a word never collides with a file's
       * number. Absent is a bare `/files`, which the screen settles on the
       * remembered kind.
       */
      kind?: string
      /** List, board or calendar — a way of looking, so it lives in the query. */
      mode?: string
      /*
       * The rest of how the list is being looked at.
       *
       * In the address because they change what is on the screen, and a
       * screen somebody can see is a screen they can send: "grouped by
       * person, mine, by due date" is a sentence worth passing on. What a
       * row *shows* is not here, because that is how somebody likes it
       * drawn rather than what they are looking at, and it stays on their
       * machine.
       */
      group?: string
      sort?: string
      dir?: string
      who?: string
      /** Which labels, by id, comma-separated; absent is any. */
      labels?: string
      /**
       * Which one list is on the screen, or absent for all of them.
       *
       * It was state and nothing else, so the answer went the moment anybody
       * pressed Board, reloaded, or came back to the project — and it is the
       * same kind of answer as the five above, which have been in the
       * address since the day it was written. Narrowing to Doing and sending
       * somebody the link should show them Doing.
       */
      list?: string
    }

/**
 * The ten names the app uses where a project's would go.
 *
 * `is_a_screen` in the database holds the same ten and refuses them as
 * slugs, because the seed and the import write projects without going
 * through an endpoint. Neither list is allowed to grow alone.
 */
/**
 * Files' places after `/files/`: its four kinds and Recently Deleted.
 * Words, so `/files/7` is still a file.
 */
export const FILE_PLACES = ['docs', 'images', 'uploads', 'links', 'deleted'] as const

const SCREENS = ['notifications', 'members', 'chat', 'settings', 'search', 'projects', 'more', 'admin', 'account', 'instance']

/**
 * What the address calls things, and what the app calls them.
 *
 * Filled as the app learns: the workspace from `/api/me`, the projects from
 * the list the sidebar draws anyway. Kept here rather than passed in,
 * because `format` is called from a hundred places and none of them should
 * have to carry a dictionary.
 */
let ws = ''
const idOf = new Map<string, string>()
const numberOf = new Map<string, number>()
const slugOf = new Map<string, string>()
const listeners = new Set<() => void>()

/**
 * Somewhere new, from outside the shell — what `go` does inside it, for the
 * one place that moves the screen without owning it: a task made in the
 * window opens itself, whichever button the window came from.
 */
export function goTo(r: Route): void {
  const next = withBeside(format(r))
  if (next === location.pathname + location.search) return
  /* From a workspace's own domain, another workspace is usetuff.com's. */
  const away = leaveFor(next)
  if (away) return location.assign(away)
  history.pushState(null, '', next)
  for (const said of listeners) said()
}

/**
 * A link to this product pressed in something somebody wrote — a quote's
 * *View message* (`docs/specs/chat-composer.md`): opened here, as a step in
 * the history, rather than in a new tab. Answers whether it was ours.
 */
export function followHere(href: string): boolean {
  let at: URL
  try {
    at = new URL(href, location.href)
  } catch {
    return false
  }
  if (at.origin !== location.origin) return false
  /* Only a message's address, and only inside the app's own shell: a
     public document drawn with nobody routing would go nowhere. */
  if (listeners.size === 0 || parse(at.href).view !== 'chat') return false
  const next = withBeside(at.pathname + at.search)
  if (next !== location.pathname + location.search) history.pushState(null, '', next)
  for (const said of listeners) said()
  return true
}

/** Told the current workspace and the projects in it. */
export function known(next: { workspace?: string; projects?: { id: string; slug: string }[] }): void {
  let moved = false
  if (next.workspace && next.workspace !== ws) {
    ws = next.workspace
    moved = true
  }
  for (const p of next.projects ?? []) {
    if (idOf.get(p.slug) !== p.id) moved = true
    idOf.set(p.slug, p.id)
    slugOf.set(p.id, p.slug)
  }
  // The address may have been unreadable until this arrived, so whoever is
  // watching reads it again.
  if (moved) for (const said of listeners) said()
}

/**
 * Signing out forgets the names.
 *
 * They belonged to the session that just ended: the next person at this
 * browser may not be in that workspace at all, and an address still asking
 * for it is an address asking them to enter somewhere they cannot go.
 */
export function forget(): void {
  ws = ''
  idOf.clear()
  slugOf.clear()
  numberOf.clear()
  idAt.clear()
  for (const said of listeners) said()
}

/** The workspace the address is asking for, which may not be the open one. */
export function askedFor(url: string = location.href): string {
  const [, a] = new URL(url, location.origin).pathname.split('/')
  return a && !SCREENS.includes(a) && a !== '' ? a : ''
}

/** One place that knows the shapes, so parse and format cannot disagree. */
export function parse(url: string): Route {
  const u = new URL(url, location.origin)
  /*
   * The workspace is the first segment and is not read here: which one is
   * open is the session's answer, and the app enters the one the address
   * asks for before anything is drawn.
   *
   * Unless the first segment is one of the app's own screens, in which case
   * there is no workspace in front of it: `/search?q=` is a link somebody
   * sent before there was one, and it still means the search screen.
   */
  const [, one, two, three, four, five] = u.pathname.split('/')
  const [a, b, c, d] = SCREENS.includes(one ?? '') ? [one, two, three, four] : [two, three, four, five]
  const q = u.searchParams

  if (a === 'search') return { view: 'search', ...(q.get('q') ? { q: q.get('q')! } : {}) }
  if (a === 'notifications') return { view: 'notifications' }
  /* The agents' tab; an agent opened has the address a person has. */
  if (a === 'members' && b === 'agents') return { view: 'members', agents: true }
  if (a === 'members') return { view: 'members', ...(b ? { actorId: b } : {}) }
  if (a === 'settings' && b === 'audit') {
    return {
      view: 'settings',
      audit: true,
      ...(q.get('type') ? { type: q.get('type')! } : {}),
      ...(q.get('who') ? { who: q.get('who')! } : {}),
    }
  }
  if (a === 'settings') return { view: 'settings' }
  if (a === 'more') return { view: 'more' }
  if (a === 'account') return { view: 'account' }
  if (a === 'instance') return { view: 'instance' }
  if (a === 'admin') {
    /* Up to two more segments, each a plain word or an id, or none at all. */
    const rest = [b, c].filter((s): s is string => !!s)
    const path = rest.every((s) => /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(s)) ? rest.join('/') : ''
    return { view: 'admin', ...(path ? { path } : {}) }
  }
  if (a === 'projects') return { view: 'projects-all' }
  if (a === 'chat') {
    const id = (s?: string) => (s && /^[0-9a-f-]{36}$/i.test(s) ? s : undefined)
    const room = id(b)
    if (!room) return { view: 'chat' }
    /* `/chat/:room/:message`, or `/chat/:room/:thread/:message` for a reply. */
    const [first, second] = [id(c), id(d)]
    if (first && second) return { view: 'chat', roomId: room, threadId: first, messageId: second }
    return { view: 'chat', roomId: room, ...(first ? { messageId: first } : {}) }
  }
  if (a) {
    const id = idOf.get(a)
    const number = c && /^\d+$/.test(c) ? Number(c) : undefined
    const place = b === 'files' && (FILE_PLACES as readonly string[]).includes(c ?? '') ? c : undefined
    return {
      view: 'projects',
      ...(id ? { projectId: id } : { unknown: a }),
      ...(b ? { tool: b } : {}),
      ...(place ? { kind: place } : number ? { at: number } : c ? { objectId: c } : {}),
      ...(q.get('view') ? { mode: q.get('view')! } : {}),
      ...(q.get('group') ? { group: q.get('group')! } : {}),
      ...(q.get('sort') ? { sort: q.get('sort')! } : {}),
      ...(q.get('dir') ? { dir: q.get('dir')! } : {}),
      ...(q.get('who') ? { who: q.get('who')! } : {}),
      ...(q.get('labels') ? { labels: q.get('labels')! } : {}),
      ...(q.get('list') ? { list: q.get('list')! } : {}),
    }
  }
  // `?tab=` means something only on the workspace's own root: an unknown
  // address falls back here and should not bring a stray parameter with it.
  if (q.get('tab')) return { view: 'my', tab: q.get('tab')! }
  return { view: 'my' }
}

/**
 * What number an object is, so a link can say it.
 *
 * Filled by the screens as they draw — the tasks list, the index of posts,
 * the docs — because they are holding the rows anyway. An object nobody has
 * drawn yet has no number here, and its address falls back to its id, which
 * is ugly and works.
 */
/**
 * Which counter a number came off. Tasks count on their own; posts and files
 * share the project's — so 41 can be a task and a
 * document both, and the way back from a number has to know which.
 */
export type Numbered = 'task' | 'post' | 'file'
const counter = (kind: Numbered) => (kind === 'task' ? 'task' : 'other')

export function numbered(
  rows: { id: string; number?: number | null; project_id?: string | null; type?: Numbered }[],
  project?: string,
  kind?: Numbered,
): void {
  for (const r of rows) {
    if (!r.number) continue
    numberOf.set(r.id, r.number)
    const of = r.type ?? kind
    if (!of) continue
    /* And the way back, when the row says which project it is in.
     *
     * An address carries the number, so opening something from a list
     * formats its id to a number and then had to ask the server what that
     * number was — a round trip for a fact the list had just handed over,
     * and a screen that renders twice: once with nothing, once with the
     * task. */
    const inside = project ?? r.project_id
    if (inside) idAt.set(`${inside}:${counter(of)}:${r.number}`, r.id)
  }
  keep()
}

/** What carries that number in that project, if a list has said. */
export function carrying(project: string, number: number, kind: Numbered): string | null {
  return idAt.get(`${project}:${counter(kind)}:${number}`) ?? null
}

/*
 * Kept on this device between loads. A task open at its address and the
 * page reloaded asked the server what number 41 was before it could open
 * anything, and the board was drawn for that round trip and then replaced
 * by the task — the screen under it for a blink, every reload. The way from
 * a number to an id never changes, so the last two thousand are kept; only
 * ids, nothing anybody wrote.
 */
const KEPT = 'tracker:numbers'
const idAt: Map<string, string> = (() => {
  try {
    return new Map(JSON.parse(localStorage.getItem(KEPT) ?? '[]') as [string, string][])
  } catch {
    return new Map()
  }
})()
let keeping: ReturnType<typeof setTimeout> | 0 = 0
function keep(): void {
  if (keeping) return
  keeping = setTimeout(() => {
    keeping = 0
    try {
      localStorage.setItem(KEPT, JSON.stringify([...idAt].slice(-2000)))
    } catch {
      // Private window or full storage: the server is asked, as before.
    }
  }, 500)
}

export function format(r: Route): string {
  const here = ws ? `/${ws}` : ''
  switch (r.view) {
    case 'search':
      return r.q ? `${here}/search?q=${encodeURIComponent(r.q)}` : `${here}/search`
    case 'notifications':
      return `${here}/notifications`
    case 'members':
      return r.actorId ? `${here}/members/${r.actorId}` : r.agents ? `${here}/members/agents` : `${here}/members`
    case 'settings': {
      if (!r.audit) return `${here}/settings`
      const q = new URLSearchParams()
      if (r.type) q.set('type', r.type)
      if (r.who) q.set('who', r.who)
      const said = q.toString()
      return `${here}/settings/audit${said ? `?${said}` : ''}`
    }
    case 'more':
      return `${here}/more`
    case 'account':
      return `${here}/account`
    case 'instance':
      return `${here}/instance`
    case 'admin':
      return `${here}/admin${r.path ? `/${r.path}` : ''}`
    case 'projects-all':
      return `${here}/projects`
    case 'chat':
      if (!r.roomId) return `${here}/chat`
      return [`${here}/chat/${r.roomId}`, r.messageId && r.threadId, r.messageId].filter(Boolean).join('/')
    case 'projects': {
      const project = r.projectId ? slugOf.get(r.projectId) : r.unknown
      if (!project) return here || '/'
      /* A file open wins over the place it was opened from: `/files/7`,
         and back returns to `/files/images`. */
      const object = r.at ?? (r.objectId ? (numberOf.get(r.objectId) ?? r.objectId) : r.tool === 'files' && r.kind ? r.kind : undefined)
      const path = [here, project, r.tool, object].filter(Boolean).join('/')
      /*
       * How the list is being looked at belongs to the tasks tab and to
       * nothing else. Carrying `?view=board` into Docs is a parameter that
       * means nothing where it lands, and it comes back when you return by
       * the back button.
       *
       * And only what is not the default: an address carrying every answer
       * whether or not it was chosen is one nobody can read, and one that
       * changes the day a default does.
       */
      if (r.tool !== 'tasks') return path
      const q = new URLSearchParams()
      for (const [key, value, fallback] of [
        ['view', r.mode, 'list'],
        ['group', r.group, 'list'],
        ['sort', r.sort, 'manual'],
        ['dir', r.dir, 'asc'],
        ['who', r.who, 'all'],
        ['labels', r.labels, ''],
        // No fallback it is ever equal to: absent is "all of them", and the
        // id of a list is never the word.
        ['list', r.list, ''],
      ] as const) {
        if (value && value !== fallback) q.set(key, value)
      }
      const said = q.toString()
      return said ? `${path}?${said}` : path
    }
    case 'my':
      return r.tab && r.tab !== 'assigned' ? `${here}/?tab=${encodeURIComponent(r.tab)}` : here || '/'
    default:
      return here || '/'
  }
}

/**
 * The route, and the two ways to change it.
 *
 * `go` is a new entry in the history — what a click on a link does. `replace`
 * is the same place said more precisely, for when the app resolves a default:
 * opening a project settles on its first tool, and that should not be a step
 * the back button has to walk through.
 */
export function useRoute(): {
  route: Route
  go: (r: Route) => void
  replace: (r: Route) => void
} {
  const [route, setRoute] = useState<Route>(() => parse(location.href))

  useEffect(() => {
    const again = () => setRoute(parse(location.href))
    window.addEventListener('popstate', again)
    /* And when a name the address used becomes readable. The address does
       not change; what it means does. */
    listeners.add(again)
    return () => {
      window.removeEventListener('popstate', again)
      listeners.delete(again)
    }
  }, [])

  /*
   * Going where you already are is nothing at all.
   *
   * Both of these guarded the history entry and then set the route anyway —
   * a new object every time, so every screen keyed on it tore itself down,
   * refetched and drew again. Pressing the sidebar item you are already on,
   * or the tab you are already reading, reloaded the screen under you. It
   * looked like a bug in the screen and was a bug in the address: the app
   * was told it had moved when it had not.
   *
   * The address is the single source of truth for where you are, so the
   * test is the address and not the object that was passed in.
   */
  const go = useCallback((r: Route) => {
    const next = withBeside(format(r))
    if (next === location.pathname + location.search) return
    /* A path into another workspace from a workspace's own domain is a full
       navigation to the same path at usetuff.com. */
    const away = leaveFor(next)
    if (away) return location.assign(away)
    history.pushState(null, '', next)
    setRoute(parse(next))
  }, [])

  const replace = useCallback((r: Route) => {
    const next = withBeside(format(r))
    if (next === location.pathname + location.search) return
    history.replaceState(null, '', next)
    setRoute(parse(next))
  }, [])

  return { route, go, replace }
}

/*
 * A conversation open beside the work.
 *
 * `?beside=` is about the window and not the screen, so unlike `?view=` it
 * travels: every move inside the app carries it from the address it leaves
 * to the one it makes. `format` does not know it, so a link somebody copies
 * is still only the thing it points at.
 */
const ROOM_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const besideHeard = new Set<() => void>()

/** The conversation the address holds beside the work, if any. */
export function besideOf(url: string = location.href): string | null {
  const id = new URL(url, location.origin).searchParams.get('beside')
  return id && ROOM_ID.test(id) ? id : null
}

/** An address the app is about to make, with the panel the window has. */
function withBeside(path: string): string {
  const id = besideOf()
  if (!id) return path
  const u = new URL(path, location.origin)
  u.searchParams.set('beside', id)
  return u.pathname + u.search
}

/**
 * Open a conversation beside the work, or close it with null.
 *
 * In place, not a step: the panel is not a place, and Back walking through
 * it being opened and shut is bookkeeping pressed on the reader.
 */
export function setBeside(id: string | null): void {
  if (besideOf() === id) return
  const u = new URL(location.href)
  if (id) u.searchParams.set('beside', id)
  else u.searchParams.delete('beside')
  history.replaceState(history.state, '', u.pathname + u.search + u.hash)
  for (const said of besideHeard) said()
}

/** What is beside the work now, read again whenever the address moves. */
export function useBeside(): string | null {
  const [id, setId] = useState(() => besideOf())
  useEffect(() => {
    const again = () => setId(besideOf())
    window.addEventListener('popstate', again)
    besideHeard.add(again)
    listeners.add(again)
    return () => {
      window.removeEventListener('popstate', again)
      besideHeard.delete(again)
      listeners.delete(again)
    }
  }, [])
  return id
}
