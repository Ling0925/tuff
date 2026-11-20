import { useState, useRef, useCallback, useEffect } from 'react'
import { useWidth, useWide, usePhone } from '../kit.jsx'
import { tabs } from '../../data/tools.js'
import { warmRoom } from '../../data/warm.js'
import { digit } from '../../data/keys.js'
import { roomCount } from '../Sidebar.jsx'
import { recall } from '../../data/memory.js'
import { type Post, type FileRow, firstTool, type ProjectProps } from '../Project.jsx'

/**
 * The frame of an open project: which tool is shown, how wide its columns
 * are, and what is held for a moment while a screen arrives.
 */
export function useProjectFrame({
  project,
  canReadActivity,
  rooms,
  waitingPosts,
  can,
  tool,
  objectId,
  navigate,
}: { navigate: ProjectProps['onNavigate'] } & Pick<
  ProjectProps,
  'project' | 'canReadActivity' | 'rooms' | 'waitingPosts' | 'can' | 'tool' | 'objectId'
>) {
  /* Settings is the holder of `manage`'s — the owner, or whoever was given it. */
  const canSettings = can.includes('project.tools')
  /* A row drawn before the server has answered has no address yet — its id
     is the screen's own — so opening one waits for the real row instead of
     asking for something that cannot exist. */
  /* Each such row's request, which answers with the id it will have. A
     press on the row waits for it and then opens the real thing — a dead
     press reads as a broken row. */
  const resolving = useRef(new Map<string, Promise<string | null>>())
  const onNavigate = useCallback<typeof navigate>(
    (to, how) => {
      const id = to.objectId
      if (id?.startsWith('pending:')) {
        void resolving.current.get(id)?.then((real) => real && navigate({ ...to, objectId: real }, how))
        return
      }
      navigate(to, how)
    },
    [navigate],
  )

  /* `null` until the first answer. An empty list is a claim — "nothing has
     been posted here" — and one made before the server has spoken is a claim
     that is usually false, held for a frame and taken back. */
  const [posts, setPosts] = useState<Post[] | null>(() => recall(`posts:${project.id}`))
  const [files, setFiles] = useState<FileRow[] | null>(() => recall(`files:${project.id}`))

  /** Which folder is being looked into; null is the top level. */
  const [folder] = useState<string | null>(null)
  /** Bumped by the socket, so the tools below refetch too. */
  const [beat, setBeat] = useState(0)
  /* State and not a ref: the portal has to render again once the node is
     there, and a ref changing does not say so. */
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  const { width: toolsWidth, set: setToolsWidth, initial: toolsInitial } = useWidth('tools-width', 256, 168, 320)
  const wide = useWide()
  const phone = usePhone()
  /** The scrolling tab row, which says it scrolls. */

  /*
   * A project opened without a tab settles on its first one.
   *
   * Said in the address bar rather than kept here, so the tab survives a
   * reload and can be linked to. The tab used to live in this component and
   * depend on `project.tools` by identity — a new array on every refetch —
   * which threw you back to Tasks mid-edit with nothing on screen to explain
   * it.
   */
  /*
   * A project opened without a tab is drawn on its first one straight away,
   * not once the address has been corrected.
   *
   * The correction below is still what makes the address true, and still a
   * `replace` so the back button does not walk through it. But waiting for
   * it meant a frame with no tool at all: every section gone, the screen
   * empty, and then everything mounted again.
   */
  /* `tool` is a segment of the address, so it is any string somebody can
     type; `tools` is the four the contract names. Widened at the comparison
     rather than loosening the type, because the question here is "is this
     one of them" and the answer for anything else is no. */
  const has = (t: string) => (project.tools as readonly string[]).includes(t)
  const shown = tool && ((tool === 'settings' && canSettings) || tool === 'activity' || has(tool)) ? tool : firstTool(project.tools)

  /*
   * 1…6 open the tabs, in the order they are drawn.
   *
   * The numbers are positions and not names: `2` is whatever is second in
   * this project, which for a project with every tool is Chat and for one
   * without a chat is Docs. A fixed number per tool would mean a project
   * missing one has a hole in its keyboard, and somebody learning "2 is the
   * second tab" learns it once for every project.
   *
   * The same guards as `c` and ⌘K: a bare key belongs to whoever is typing,
   * so this stands down for fields, for anything editable, and for a dialog
   * or the palette already asking a question. And for the row menus, whose
   * own digits are picking — a menu open over the list is one question, and
   * answering it with a tab switch is the wrong answer to it.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return
      const n = digit(e)
      if (n === null) return
      const el = e.target as HTMLElement | null
      if (el?.isContentEditable) return
      if (el && ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return
      if (document.querySelector('[role="dialog"], [data-testid="palette-input"]')) return
      if (document.querySelector('[data-status-menu],[data-priority-menu],[data-who-menu]')) return
      const where = tabs(project.tools as string[], canReadActivity, canSettings)[n - 1]
      if (!where) return
      e.preventDefault()
      onNavigate({ tool: where, objectId: null })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [project.tools, canReadActivity, canSettings, onNavigate])

  /*
   * The measure the pane is held to, and the tool that is not.
   *
   * Tasks takes the width. The board has to — columns of cards are not
   * lines of text, and held to 1200 a board of five lists showed three on a
   * screen with room for six — and the list cannot be held while the board
   * is not, because they are two views of one screen: switching between
   * them moved everything sideways, which is a jump in the middle of a
   * gesture that is supposed to change only how the work is drawn.
   *
   * So the exception is the screen, not the view. What is left under the
   * measure is the tools that are columns of words — a document, an
   * announcement, the settings — and an open task, which holds itself to
   * the same 1200 from inside `TaskDetail` because it is a screen within
   * this one.
   */
  /*
   * How wide each tool's column of work is, and its bar with it.
   *
   * Tasks runs the window's width. The rest read at the chat's measure —
   * eight hundred and the gutter either side — with the bar the same width
   * as the work under it, so the name and the controls sit over the column
   * they are about. (The bar ran the window's width for a while; we
   * asked for it back over the content.) A room keeps room for a thread
   * beside it in the column of work, and its bar stays at the room's
   * measure. `docs/specs/tool-bar.md`.
   */
  const measure = 'max-w-[calc(800px+2*var(--gutter))]'
  /* The column of work runs the full width so its scrollbar is at the
     window's edge rather than in the middle of the screen; what scrolls in
     it is held to the measure by `.reads`, padding rather than a width. A
     room centres itself. */
  const held = shown === 'messages' ? 'max-w-[calc(1184px+2*var(--gutter))]' : ''
  /* A thread open beside the room widens the room's column, and the bar
     over it with it, over the same fast ease — `docs/specs/chat-threads.md`. */
  const [threadWide, setThreadWide] = useState(false)
  /* A task or a document open: its head runs the width, padded the same
     on every side, with a line under it — one head for the two things a
     project opens. `docs/specs/docs.md`. */
  const objectHead = (shown === 'tasks' || shown === 'files' || shown === 'posts') && Boolean(objectId)
  const barHeld =
    shown === 'tasks' || objectHead
      ? ''
      : shown === 'messages'
        ? `thread-ease ${threadWide ? 'max-w-[calc(1184px+2*var(--gutter))]' : measure}`
        : measure

  /*
   * What is waiting behind each tab.
   *
   * One place, so a number cannot be drawn two ways. Chat is every room of
   * this project added up — the column below says which room, and the tab
   * only has to say there is something to go and see.
   */
  const waiting: Record<string, number> = {
    /* Keyed by the tool's own name — `messages`, which the tabs call Chat. */
    messages: rooms.filter((r) => r.project_id === project.id).reduce((n, r) => n + roomCount(r).count, 0),
    posts: waitingPosts,
  }

  /*
   * The project's rooms, warmed while somebody is anywhere in it — their
   * newest messages and the pictures in them — so the Chat tab opens on a
   * conversation that is already drawn, pictures sharp. Once per project
   * per visit, when the browser is idle; and at once under the pointer on
   * the tab itself. `data/warm.ts`.
   */
  const ownRooms = rooms.filter((r) => r.project_id === project.id)
  const roomKey = ownRooms.map((r) => r.id).join(',')
  const warmedHere = useRef('')
  const warmRooms = useCallback(() => {
    if (!roomKey || warmedHere.current === `${project.id}:${roomKey}`) return
    warmedHere.current = `${project.id}:${roomKey}`
    for (const id of roomKey.split(',').slice(0, 3)) void warmRoom(id).catch(() => {})
  }, [project.id, roomKey])
  useEffect(() => {
    if (shown === 'messages') return
    const idle = (f: () => void) =>
      'requestIdleCallback' in window ? window.requestIdleCallback(f, { timeout: 4000 }) : setTimeout(f, 2000)
    idle(warmRooms)
  }, [warmRooms, shown])

  const available = [...project.tools].sort().join(',')
  // biome-ignore lint/correctness/useExhaustiveDependencies: a project opened without a tab, or on one it no longer has, goes to its first: asked when the project, its tools or the tab change
  useEffect(() => {
    if (tool && ((tool === 'settings' && canSettings) || tool === 'activity' || has(tool))) return
    onNavigate({ tool: firstTool(project.tools) })
  }, [project.id, available, tool])

  /*
   * The last read asked for is the only one drawn.
   *
   * A delete reloads the list, and so does every event the project's
   * socket hears — and a read sent a moment before the delete, for the
   * comment just made, could land after the one sent after it, putting the
   * deleted announcement back on the screen until the next event. Answers
   * arrive in whatever order the network gives; this keeps the newest
   * question's.
   */
  const asked = useRef(0)
  return {
    canSettings,
    resolving,
    onNavigate,
    posts,
    setPosts,
    files,
    setFiles,
    folder,
    beat,
    setBeat,
    slot,
    setSlot,
    toolsWidth,
    setToolsWidth,
    toolsInitial,
    wide,
    phone,
    shown,
    held,
    setThreadWide,
    objectHead,
    barHeld,
    waiting,
    warmRooms,
    asked,
  } as const
}
export type ProjectFrame = ReturnType<typeof useProjectFrame>
