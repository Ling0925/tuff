import { useCallback, useEffect, useState, useContext, useRef } from 'react'
import { PROJECT_SAID as W } from '../../words/project.js'
import { MAX_FILE_BYTES } from '@tracker/shared-schema'
import { api, TAB } from '../../data/api.js'
import { taskChanged } from '../TaskCard.jsx'
import { fileGone } from '../FileDetail.jsx'
import { type DocsFilter, type DocsWhose, type Going, byRecent, keepDocsView, kindOf, linkInfo, placeOf, readDocsView } from '../Docs.jsx'
import { upload } from '../../data/upload.js'
import { PersonDoorsContext } from '../PersonCard.jsx'
import { keepOpen } from '../../data/socket.js'
import { holdPictures } from '../../data/warm.js'
import { recall, remember } from '../../data/memory.js'
import { readTemplates } from '../../data/docTemplates.js'
import { anyWorking, readWorking } from '../../data/working.js'
import { type Post, keep, type FileRow, type ProjectProps } from '../Project.jsx'
import { type ProjectFrame } from './useProjectFrame.js'

/** A page of a project's Files. */
type FilesPage = { files: FileRow[]; next_cursor?: string | null; kinds?: string[] }
/** One of Files' lists, a kind and whose: the rows read so far, and the cursor for the rest. */
type FilesView = { rows: FileRow[]; next: string | null }
/** Every list a project's Files has read, by `kind:whose`, and which kinds hold anything at all. */
type FilesHeld = { views: Record<string, FilesView>; kinds: DocsFilter[] | null }
const KINDS: readonly DocsFilter[] = ['docs', 'images', 'uploads', 'links']
const WHOSE_ASKED: Record<DocsWhose, string> = { recent: '', mine: '&whose=mine', shared: '&whose=others' }
/** A page, and the deepest a list is read again in one answer. */
const PAGE = 100
const DEEPEST = 500
const filesAt = (projectId: string, kind: DocsFilter, whose: DocsWhose, rest: string) =>
  `/projects/${projectId}/files?kind=${kind}${WHOSE_ASKED[whose]}${rest}`
const viewOf = (kind: DocsFilter, whose: DocsWhose) => `${kind}:${whose}`
/* What memory held, if it is this shape: a build before pages kept the
   whole list as an array under another key, and that is not read. */
function heldFrom(had: unknown): FilesHeld {
  const h = had as FilesHeld | null
  return h && typeof h === 'object' && h.views && typeof h.views === 'object' ? h : { views: {}, kinds: null }
}
const kindsOf = (said: string[] | undefined) => (said ? KINDS.filter((k) => said.includes(k)) : null)
/* Rows read again over rows held. Up to the depth asked, the answer is the
   list; past it, the rows held after the answer's last are kept after it,
   so a list scrolled further than one answer reads does not shrink. */
function readAgain(had: FilesView | undefined, got: FilesPage, depth: number): FilesView {
  const fresh = { rows: got.files, next: got.next_cursor ?? null }
  const last = got.files[got.files.length - 1]
  if (!had || !last || !got.next_cursor || had.rows.length <= depth) return fresh
  const answered = new Set(got.files.map((f) => f.id))
  const beyond = had.rows.filter((r) => !answered.has(r.id) && !r.id.startsWith('pending:') && byRecent(r, last) >= 0)
  return beyond.length ? { rows: [...got.files, ...beyond], next: had.next } : fresh
}
/* A page added at the foot, nothing in it twice. */
function addPage(had: FilesView, got: FilesPage): FilesView {
  const there = new Set(had.rows.map((f) => f.id))
  return { rows: [...had.rows, ...got.files.filter((f) => !there.has(f.id))], next: got.next_cursor ?? null }
}

/**
 * What a project holds that its tabs read here: its announcements and
 * files, and making, uploading and linking them.
 */
export function useProjectContent({
  project,
  canWrite,
  revision,
  objectId,
  meId,
  resolving,
  onNavigate,
  setPosts,
  folder,
  beat,
  setBeat,
  shown,
  asked,
  kind,
}: Pick<ProjectProps, 'project' | 'canWrite' | 'revision' | 'objectId' | 'meId' | 'kind'> &
  Pick<ProjectFrame, 'resolving' | 'onNavigate' | 'setPosts' | 'folder' | 'beat' | 'setBeat' | 'shown' | 'asked'>) {
  /*
   * Which kind is open is the address's — `/files/images` — and the kind
   * last chosen on this machine only fills in a bare `/files`, settled with
   * `replace` so back does not walk through it. Whose stays a remembered
   * view of the list. Recently Deleted is a place of its own,
   * `/files/deleted`, and never remembered: Files opening on the bin would
   * surprise whoever left it there. `docs/specs/docs.md`, "Four kinds and
   * whose"; the deleting docs spec.
   */
  const [docsView, setDocsView] = useState(() => readDocsView(meId))
  const place = placeOf(kind)
  const inBin = place === 'deleted'
  const docsFilter: DocsFilter = place && place !== 'deleted' ? place : docsView.kind
  const docsWhose = docsView.whose
  const setDocsFilter = (next: DocsFilter) => onNavigate({ kind: next })
  const setDocsWhose = (whose: DocsWhose) => {
    setDocsView((v) => ({ ...v, whose }))
    keepDocsView(meId, { whose })
    /* A choice of whose from the bin's menu leaves the bin for the kind
       last open, as a kind's tab does. */
    if (inBin) onNavigate({ kind: docsView.kind })
  }
  const openBin = () => onNavigate({ kind: 'deleted' })
  /*
   * Files' lists. One per kind and whose, read
   * a page at a time and kept per project, so a tab opens on what it held
   * last and the server's answer replaces it in place.
   */
  const heldKey = `files-pages:${project.id}`
  const [held, setHeld] = useState<FilesHeld>(() => heldFrom(recall(heldKey)))
  const heldNow = useRef(held)
  heldNow.current = held
  const keepHeld = useCallback(
    (change: (h: FilesHeld) => FilesHeld) =>
      setHeld((h) => {
        const next = change(h)
        return next === h ? h : remember(heldKey, next)
      }),
    [heldKey],
  )
  const viewKey = viewOf(docsFilter, docsWhose)
  const view = held.views[viewKey]
  /* A list not read yet draws what another list of its kind holds — the
     screen narrows it to this one on the device — until its own answer
     comes: rows that are true, never an empty claim. */
  const standIn = view
    ? null
    : (['recent', 'mine', 'shared'] as const).map((w) => held.views[viewOf(docsFilter, w)]).find((v) => v !== undefined)
  /* Rows drawn before the server has them — a link just added — in no
     list until it is read again with them, and on top of whichever is open:
     the screen's narrowing puts each under its own kind. */
  const [pending, setPending] = useState<FileRow[]>([])
  const listRows = view?.rows ?? standIn?.rows ?? null
  const files = pending.length ? [...pending, ...(listRows ?? [])] : listRows
  /**
   * A change to rows already held, made to every list that holds them — a
   * row deleted, pinned, or drawn before the server has it. Each list's own
   * narrowing is the screen's, so a row put in all of them shows only where
   * it belongs.
   */
  const setFiles = useCallback(
    (change: (had: FileRow[] | null) => FileRow[] | null) =>
      keepHeld((h) => {
        const views: Record<string, FilesView> = {}
        for (const [k, v] of Object.entries(h.views)) views[k] = { ...v, rows: change(v.rows) ?? [] }
        return { ...h, views }
      }),
    [keepHeld],
  )

  // biome-ignore lint/correctness/useExhaustiveDependencies: revision and beat are triggers: a new load is a new read, for the effects that hold it
  const load = useCallback(async () => {
    const turn = ++asked.current
    if (shown === 'posts') {
      const got = (await api<{ posts: Post[] }>(`/projects/${project.id}/posts`)).posts
      if (turn !== asked.current) return
      setPosts(remember(`posts:${project.id}`, keep(got, project.id, 'post')))
    }
    if (shown === 'files') {
      /* As deep as the list is held — a hundred at least, five hundred at
         most — so a list somebody scrolled does not shrink under them. */
      const key = viewKey
      const depth = Math.min(DEEPEST, Math.max(PAGE, heldNow.current.views[key]?.rows.length ?? 0))
      const got = await api<FilesPage>(filesAt(project.id, docsFilter, docsWhose, `&limit=${depth}`))
      if (turn !== asked.current) return
      keep(got.files, project.id, 'file')
      keepHeld((h) => ({
        views: { ...h.views, [key]: readAgain(h.views[key], got, depth) },
        kinds: kindsOf(got.kinds) ?? h.kinds,
      }))
      holdPictures(got.files.map((f) => f.thumb_url))
      /* What "New document" offers, so its menu opens with it. */
      void readTemplates().catch(() => {})
    }
    /* `beat` too: a post or a document changed on its own screen says so
       through it, and the list it goes back to was waiting for the socket
       to bring the same news — which on a slow runner arrived after the
       test had looked, and showed the deleted announcement still there. */
  }, [project.id, shown, revision, beat, asked, setPosts, viewKey, keepHeld])
  useEffect(() => void load(), [load])
  /* The list open now, read again — for a write that awaited the server
     while the screen turned to the kind it lands in. */
  const loadNow = useRef(load)
  loadNow.current = load

  /** A list's first page, kept, unless it is held already. */
  const readFirst = useCallback(
    async (kind: DocsFilter, whose: DocsWhose): Promise<FilesPage | null> => {
      const key = viewOf(kind, whose)
      if (heldNow.current.views[key]) return null
      const got = await api<FilesPage>(filesAt(project.id, kind, whose, `&limit=${PAGE}`))
      keep(got.files, project.id, 'file')
      keepHeld((h) =>
        h.views[key]
          ? h
          : { views: { ...h.views, [key]: { rows: got.files, next: got.next_cursor ?? null } }, kinds: kindsOf(got.kinds) ?? h.kinds },
      )
      return got
    },
    [project.id, keepHeld],
  )
  /* Once the open list is in, the other three kinds' first pages, so a tab
     pressed is drawn at once — four pages of a hundred, where the whole
     project used to be read for the same purpose. */
  const viewHeld = Boolean(view)
  useEffect(() => {
    if (shown !== 'files' || !viewHeld) return
    const soon = setTimeout(() => {
      for (const k of KINDS) if (k !== docsFilter) void readFirst(k, docsWhose).catch(() => {})
    }, 250)
    return () => clearTimeout(soon)
  }, [shown, viewHeld, docsFilter, docsWhose, readFirst])

  /*
   * Find — `docs/specs/find.md`. The words narrow what is held at once, on
   * the screen; when the list has more pages than it holds, they go to the
   * server too, a beat after the last key, and its matches join the ones on
   * the screen. With every row held nothing is asked.
   */
  const [docsWords, setDocsWords] = useState('')
  const [found, setFound] = useState<{ key: string; words: string; rows: FileRow[]; next: string | null } | null>(null)
  const words = docsWords.trim()
  const whole = Boolean(view && !view.next)
  useEffect(() => {
    if (!words || shown !== 'files' || whole) return
    let alive = true
    const soon = setTimeout(() => {
      void api<FilesPage>(filesAt(project.id, docsFilter, docsWhose, `&limit=${PAGE}&q=${encodeURIComponent(words)}`))
        .then((got) => {
          if (!alive) return
          keep(got.files, project.id, 'file')
          setFound({ key: viewKey, words, rows: got.files, next: got.next_cursor ?? null })
        })
        .catch(() => {})
    }, 150)
    return () => {
      alive = false
      clearTimeout(soon)
    }
  }, [words, shown, whole, project.id, docsFilter, docsWhose, viewKey])
  const foundHere = found && found.key === viewKey && found.words === words ? found : null
  /** Whether the words have had their whole answer: every row is held, or the server's has come. */
  const findSettled = !words || whole || foundHere !== null

  /*
   * Scrolling reads further — the open list's next page, or the found
   * rows' when words are in the field. Asked once at a time; a page that
   * comes after the list moved on is let go.
   */
  const reading = useRef(false)
  const more = words && !whole ? (foundHere?.next ?? null) : (view?.next ?? null)
  const readMore = useCallback(async () => {
    if (reading.current || !more) return
    reading.current = true
    try {
      const key = viewKey
      if (words && !whole) {
        const got = await api<FilesPage>(
          filesAt(project.id, docsFilter, docsWhose, `&limit=${PAGE}&q=${encodeURIComponent(words)}&cursor=${encodeURIComponent(more)}`),
        )
        keep(got.files, project.id, 'file')
        setFound((f) =>
          f && f.key === key && f.words === words && f.next === more ? { ...f, ...addPage({ rows: f.rows, next: f.next }, got) } : f,
        )
        return
      }
      const got = await api<FilesPage>(filesAt(project.id, docsFilter, docsWhose, `&limit=${PAGE}&cursor=${encodeURIComponent(more)}`))
      keep(got.files, project.id, 'file')
      keepHeld((h) => {
        const had = h.views[key]
        return had && had.next === more ? { ...h, views: { ...h.views, [key]: addPage(had, got) } } : h
      })
    } catch {
      // Asked again when the foot comes into view again.
    } finally {
      reading.current = false
    }
  }, [more, viewKey, words, whole, project.id, docsFilter, docsWhose, keepHeld])

  /*
   * The other tools, fetched when the project opens rather than when they
   * are asked for.
   *
   * Filmed frame by frame, switching a tab produced two paints: the bar
   * changed in the frame of the click, because chrome is a pure render, and
   * the content arrived forty milliseconds later when its request came back.
   * Two paints where a person expects one, on every tab, every time — which
   * is what "it redraws with a jerk" is.
   *
   * A tool switch cannot be one paint while the data is still in the air. So
   * the data is not in the air: a project has four tools and somebody who
   * opened it is going to use them, they are four small requests in
   * parallel, and the answers go into the same memory the screens read from.
   * The one being looked at is already on its way from `load`; this is the
   * other three.
   *
   * Only once per project, and never for the tool already being fetched.
   * Deliberately no refresh: each screen refetches itself on arrival, so
   * this is a head start, not a second source of truth.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: once per project, not on every tab change: that is the thing being avoided
  useEffect(() => {
    let alive = true
    const warm = async () => {
      const jobs: Promise<unknown>[] = []
      if (project.tools.includes('tasks') && shown !== 'tasks') {
        jobs.push(
          api<{ tasks: unknown[] }>(`/projects/${project.id}/tasks`)
            .then((r) => remember(`tasks:${project.id}`, r.tasks))
            .catch(() => {}),
          api<{ lists: unknown[] }>(`/projects/${project.id}/lists`)
            .then((r) => remember(`lists:${project.id}`, r.lists ?? []))
            .catch(() => {}),
        )
      }
      if (project.tools.includes('posts') && shown !== 'posts') {
        jobs.push(
          api<{ posts: Post[] }>(`/projects/${project.id}/posts`)
            .then((r) => alive && setPosts(remember(`posts:${project.id}`, keep(r.posts, project.id, 'post'))))
            .catch(() => {}),
        )
      }
      if (project.tools.includes('files') && shown !== 'files') {
        /* The list Files opens on: the kind and whose last chosen here. */
        jobs.push(
          readFirst(docsView.kind, docsView.whose)
            .then((r) => {
              /* Its pictures decoded before Files is opened — `holdPictures`. */
              if (alive && r) holdPictures(r.files.map((f) => f.thumb_url))
            })
            .catch(() => {}),
        )
      }
      // The tasks screen asks for these itself, so warming them there is the
      // same request twice.
      if (shown !== 'tasks') {
        jobs.push(
          api<{ members: unknown[] }>(`/projects/${project.id}/members`)
            .then((r) => remember(`members:${project.id}`, r.members))
            .catch(() => {}),
        )
      }
      await Promise.all(jobs)
    }
    /*
     * After a pause, not on the click.
     *
     * Somebody walking down the sidebar opens five projects in two seconds
     * and wants none of them warmed; firing four requests per project makes
     * that twenty, which is a burst the rate limiter is right to refuse.
     * A quarter of a second is longer than passing through and shorter than
     * reading anything.
     */
    const soon = setTimeout(() => void warm(), 250)
    return () => {
      alive = false
      clearTimeout(soon)
    }
    // Once per project. Not on every tab change: that is the thing being
    // avoided, not a reason to ask again.
  }, [project.id, setPosts])

  /*
   * Somebody else's change arrives without a reload.
   *
   * The socket carries the fact and this refetches — one path into the data
   * rather than two that can disagree. It is per project, not per workspace:
   * a workspace-wide subscription wakes every device for every change in
   * every project.
   */
  useEffect(() => {
    let statusSoon: ReturnType<typeof setTimeout> | null = null
    const word = (ev: MessageEvent) => {
      /*
       * Somebody else's change, not the echo of your own.
       *
       * Every mutation publishes, so without this every action you take
       * comes back as a message and refetches the screen you are already
       * looking at — a round trip and a re-render for something that has
       * already happened, arriving just late enough to land under whatever
       * you clicked next.
       */
      try {
        const e = JSON.parse(String(ev.data)) as {
          kind?: string
          payload?: { actor_id?: string; tab?: string | null; object_type?: string | null; object_id?: string | null }
        }
        /* What an agent says it is doing changed: that short list is read
           again, and nothing else — the board's columns are not read for
           it. */
        if (e.kind === 'agent.status') {
          /* Once a second and a half after the last word, not once per word:
             an agent changing its line on every call would have every open
             window read once per call. */
          if (statusSoon) clearTimeout(statusSoon)
          statusSoon = setTimeout(() => {
            statusSoon = null
            void readWorking()
          }, 1500)
          return
        }
        /* Any task card on the screen for it reads again — this tab's own
           change too, which the screen below ignores as an echo but a card
           in a room has not seen. `TaskCard.tsx`. */
        if (e.payload?.object_type === 'task' && e.payload.object_id) taskChanged(e.payload.object_id)
        /* A document deleted from another window is said gone where it is
           open — this tab's own delete has already left it. */
        if (e.kind === 'file.delete' && e.payload?.object_id) {
          const gone = e.payload.object_id
          fileGone(gone)
          /* And every list here, the rows past the first page too, which
             reading the list again does not reach. */
          setFiles((had) => had && had.filter((f) => f.id !== gone))
        }
        /*
         * The echo is this tab's, not this person's.
         *
         * It was compared by `actor_id`, and that filtered out every
         * change the same person made from anywhere — so a phone and a
         * desktop signed in as one account each ignored the other's
         * moves and drifted apart until one was reloaded. Measured: a
         * card carried to the top on the desktop stayed third on the
         * phone.
         *
         * An event that names a tab is an echo only for that tab. One
         * that names none — an older server, or a change made through
         * the MCP token — falls back to the person, which is the old
         * behaviour and the safe direction: at worst one refetch.
         */
        if (e.payload?.tab) {
          if (e.payload.tab === TAB) return
        } else if (e.payload?.actor_id === meId) return
      } catch {
        // Unreadable: treat it as news, which is the safe way to be wrong.
      }
      later()
    }
    /*
     * Read once for a flurry, not once for each of it.
     *
     * Every change somebody else made read the screen again at once, so
     * twenty-five cards moved together were twenty-five reads for every
     * window on the project — a hundred windows, five thousand requests.
     * One read a beat after the first word, spread over a little more so
     * the windows do not all ask in the same instant; the words after it
     * are answered by the same read.
     */
    let soon: ReturnType<typeof setTimeout> | null = null
    const later = () => {
      if (soon) return
      soon = setTimeout(
        () => {
          soon = null
          void load()
          setBeat((b) => b + 1)
          /* A task finished takes away what an agent said about it. */
          if (anyWorking()) void readWorking()
        },
        200 + Math.random() * 600,
      )
    }
    /* Opened again when it drops, and the screen read again when it is back
       — whatever changed meanwhile was said to nobody. `data/socket.ts`. */
    const back = () => {
      void load()
      setBeat((b) => b + 1)
    }
    const socket = keepOpen(`/ws/projects/${project.id}?tab=${TAB}`, word, back)
    return () => {
      if (soon) clearTimeout(soon)
      if (statusSoon) clearTimeout(statusSoon)
      socket.stop()
    }
  }, [project.id, load, meId, setBeat, setFiles])

  const pendingFile = (name: string, kind: FileRow['kind'], request: Promise<{ id: string } | null>, url: string | null = null) => {
    const temp = `pending:${Date.now()}`
    setPending((had) => [
      { id: temp, name, kind, url, folder_id: folder, is_document: kind === 'document', author_id: meId, author_name: '' },
      ...had,
    ])
    resolving.current.set(
      temp,
      request.then((r) => r?.id ?? null),
    )
    return temp
  }

  /*
   * A new document opens in the editor at once — `docs/specs/docs.md`. It
   * was a field asking for a name first, which is a form standing between
   * somebody and the thing they meant to write; the name is the document's
   * first line, written where it is read.
   */
  const [writing, setWriting] = useState(false)
  async function newDocument(template?: string) {
    if (writing) return
    setWriting(true)
    try {
      /* Or from a template: the server writes it, in its maker's language
         and filled in. A draft, either way,
         until it is published. */
      const made = await api<{ id: string }>(`/projects/${project.id}/files`, {
        method: 'POST',
        body: JSON.stringify(
          template
            ? { template, folder_id: folder, audience: 'author' }
            : { name: 'Untitled', body: {}, folder_id: folder, audience: 'author' },
        ),
      })
      void load()
      onNavigate({ objectId: made.id })
    } finally {
      setWriting(false)
    }
  }
  /* The shell's doors, for a file's room, which is not this project's tab. */
  const doors = useContext(PersonDoorsContext)
  /* A bare `/files` settles on the kind last open. `kind` is `''`, not
     null, while the address names a file whose id is still being looked up
     — `/files/7` must not be replaced by a kind before it opens. */
  useEffect(() => {
    if (shown === 'files' && !objectId && kind === null) onNavigate({ kind: docsView.kind }, 'settle')
  }, [shown, objectId, kind, docsView.kind, onNavigate])
  /* The kind on the screen is the one remembered, however it was reached —
     a tab, back, or a link — so a bare `/files` later opens on it. */
  useEffect(() => {
    if (place && place !== 'deleted' && place !== docsView.kind) {
      setDocsView((v) => ({ ...v, kind: place }))
      keepDocsView(meId, { kind: place })
    }
  }, [place, docsView.kind, meId])
  /* Something just added is shown where it lands: its own kind, and not
     behind "Shared with me", which it can never be. Without it, a link
     added on Docs went into a list nobody was looking at. */
  const showAdded = (next: DocsFilter) => {
    if (docsFilter !== next || inBin) setDocsFilter(next)
    if (docsWhose === 'shared') setDocsWhose('recent')
  }
  /* The window a link is added in — `docs/specs/docs.md`. */
  const [linking, setLinking] = useState(false)
  const picker = useRef<HTMLInputElement>(null)

  /*
   * Files going up into Docs, each a row with how far it has got —
   * `docs/specs/docs.md`. From the button, dropped on the page, or pasted.
   */
  const [going, setGoing] = useState<Going[]>([])
  const goingFiles = useRef(new Map<string, { file: File; abort?: () => void }>())
  const [dropping, setDropping] = useState(false)
  const amend = (key: string, to: Partial<Going>) => setGoing((g) => g.map((x) => (x.key === key ? { ...x, ...to } : x)))
  async function sendUp(key: string) {
    const held = goingFiles.current.get(key)
    if (!held) return
    if (held.file.size > MAX_FILE_BYTES) {
      return amend(key, { failed: W.tooLarge(Math.round(MAX_FILE_BYTES / 1024 / 1024)) })
    }
    amend(key, { fraction: 0, failed: null })
    const made = await upload(project.id, held.file, {
      onProgress: (fraction) => amend(key, { fraction }),
      onAbortable: (abort) => (held.abort = abort),
    })
    /* Stopped by hand: the row is already gone. */
    if (!goingFiles.current.has(key)) return
    if (!made) return amend(key, { failed: W.couldNotUpload })
    /* The row gives way only once the list holds the file, so nothing
       blinks out between the two. */
    await loadNow.current()
    goingFiles.current.delete(key)
    setGoing((g) => g.filter((x) => x.key !== key))
  }
  function putUp(files: FileList | File[] | null | undefined) {
    const given = Array.from(files ?? [])
    if (given[0]) showAdded(kindOf({ kind: 'upload', content_type: given[0].type }))
    for (const file of given) {
      const key = crypto.randomUUID()
      goingFiles.current.set(key, { file })
      setGoing((g) => [{ key, name: file.name, size: file.size, fraction: 0, failed: null }, ...g])
      void sendUp(key)
    }
  }
  function stopUp(key: string) {
    goingFiles.current.get(key)?.abort?.()
    goingFiles.current.delete(key)
    setGoing((g) => g.filter((x) => x.key !== key))
  }

  /* A link pasted anywhere on Docs is a link added — the address of a Google
     Doc, a Figma file, a pull request is on the clipboard already, and a
     field to put it in is a step between. Not while typing somewhere. */
  // biome-ignore lint/correctness/useExhaustiveDependencies: one paste listener per folder; addLink and putUp are new on every render and read the folder
  useEffect(() => {
    if (shown !== 'files' || objectId || !canWrite) return
    const paste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t?.closest('input, textarea, [contenteditable="true"]')) return
      /* A file on the clipboard — a screenshot — goes up like a chosen one. */
      if (e.clipboardData?.files.length) {
        e.preventDefault()
        putUp(e.clipboardData.files)
        return
      }
      const text = e.clipboardData?.getData('text/plain').trim() ?? ''
      if (!/^https?:\/\/\S+$/i.test(text)) return
      e.preventDefault()
      void addLink(text)
    }
    window.addEventListener('paste', paste)
    return () => window.removeEventListener('paste', paste)
  }, [shown, objectId, canWrite, folder])

  /**
   * A link is a file kept somewhere else, so it is made the same way.
   *
   * The name defaults to the host rather than the whole address: a list of
   * full URLs is unreadable, and whoever added it can rename it.
   */
  async function addLink(url: string, given?: string) {
    /* Named by where it goes — "acme/web #41", the Figma file's own name,
       "Google Doc" — rather than by its host. `docs/specs/docs.md`. */
    const name = given?.trim() || linkInfo(url).name
    const request = api<{ id: string }>(`/projects/${project.id}/files`, {
      method: 'POST',
      body: JSON.stringify({ name, url, folder_id: folder }),
    }).catch(() => null)
    showAdded('links')
    const temp = pendingFile(name, 'link', request, url)
    await request
    /* The row gives way once the list holds the link, so nothing blinks
       out between the two. */
    await loadNow.current().catch(() => {})
    setPending((had) => had.filter((f) => f.id !== temp))
  }
  return {
    load,
    files,
    setFiles,
    kinds: held.kinds,
    answered: Boolean(view),
    found: foundHere?.rows ?? null,
    findSettled,
    more: Boolean(more),
    readMore,
    newDocument,
    doors,
    docsFilter,
    setDocsFilter,
    docsWhose,
    setDocsWhose,
    inBin,
    openBin,
    docsWords,
    setDocsWords,
    linking,
    setLinking,
    picker,
    going,
    dropping,
    setDropping,
    sendUp,
    putUp,
    stopUp,
    addLink,
  } as const
}
export type ProjectContent = ReturnType<typeof useProjectContent>
