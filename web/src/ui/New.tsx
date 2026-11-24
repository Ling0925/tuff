import type { Repeat } from '@tracker/shared-schema'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { PersonInWorkspace } from '@tracker/shared-schema'
import { FACTS, HEADS, MAKE, MORE } from '../data/words.js'
import { NEW as W } from '../words/new.js'
import { api, everyPage } from '../data/api.js'
import { recall, remember } from '../data/memory.js'
import { LABEL, ORDER } from '../data/tools.js'
import { goTo, known, numbered, parse, type Route } from '../data/route.js'
import { openOnBoard } from '../data/boardApi.js'
import { CreateButton, type Variant } from './Create.jsx'
import { Editor, type Callable, type EditorHandle } from './Editor.jsx'
import { DropHere, useDropFiles } from './DropFiles.jsx'
import { EDITOR } from '../words/editor.js'
import { Fact } from './TaskDetail.jsx'
import { Icon } from './glyphs.jsx'
import { Glass } from './Glass.jsx'
import { ProjectMark, markOf, markRadius, type Marked } from './icons.jsx'
import {
  Button,
  CyclePick,
  DateButton,
  Dialog,
  LabelChip,
  LabelPick,
  PRIORITY_SAID,
  PriorityPick,
  ProjectPick,
  RepeatMark,
  Status,
  Switch,
  Toggle,
  WhoPick,
  namesOf,
  usePhone,
  writtenDay,
  type Label,
  type Placed,
  type Priority,
  notALogin,
} from './kit.jsx'

/**
 * Making the three things that have more than a name to say.
 *
 * The create spec is the argument. The short of it: the server has
 * always taken a description, a list, an assignee, a date and the client
 * switch on a task, and the interface offered a title. So every task made
 * from the web arrived unassigned, undated and in Unsorted, and had to be
 * opened again to mean anything — which is the second step the create was
 * there to avoid.
 *
 * Everything with one field to fill keeps the inline field: a token, a post,
 * a document, a link. A dialog for one field is a door in front of a doorway.
 */

export type What =
  | {
      kind: 'task'
      /** Null from the global button, where no project has been decided yet. */
      projectId: string | null
      /** The list being looked at, if any — the task lands there. */
      list: string | null
      /**
       * Who it is for, when the screen already knows.
       *
       * Set by the button on a band of one person's work: the band says whose
       * this is, and asking again is asking somebody to repeat the heading
       * they pressed. Dates are not carried the same way — a band of them is
       * a range, and a task given a day because it was made under "Later"
       * would be the interface inventing one.
       */
      who?: string
    }
  | { kind: 'project' }
  /** An announcement: a title and its words. */
  | { kind: 'post'; projectId: string }

export type Made = { id: string; projectId: string | null }

const TITLE: Record<What['kind'], string> = {
  task: MAKE.newTask,
  project: MAKE.newProject,
  post: MAKE.newPost,
}

/**
 * The button and what it opens.
 *
 * One component so a callsite is one line and cannot forget to render the
 * dialog.
 */
export function NewButton({
  label,
  variant = 'accent',
  testId,
  what,
  onMade,
}: {
  label: string
  variant?: Variant
  testId?: string
  what: What
  onMade: (made: Made) => Promise<void> | void
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <CreateButton label={label} variant={variant} {...(testId ? { testId } : {})} onClick={() => setOpen(true)} />
      <NewDialog open={open} what={what} onClose={() => setOpen(false)} onMade={onMade} />
    </>
  )
}

/* ------------------------------------------------------------------ draft */

type Draft = {
  title: string
  /** The words — a task's description, an announcement's body — written in
      the editor a task has, as a document. */
  doc?: unknown
  /** A picture or a file in the words still on its way up — the editor's
      word for it, since `doc` leaves such a file out until it lands. */
  sending?: boolean
  project: string
  list: string
  /** Who it is for, in order. */
  assignees: string[]
  due: string
  /** How it repeats, set in the due date's calendar. */
  repeat: Repeat | null
  priority: Priority | null
  labels: Label[]
  cycle: string
  tools: string[]
}

const EMPTY: Draft = {
  title: '',
  project: '',
  list: '',
  assignees: [],
  due: '',
  repeat: null,
  priority: null,
  labels: [],
  cycle: '',
  tools: [...ORDER],
}

/** What follows the project when it changes: each belonged to the one it
    was chosen in. */
const OF_THE_PROJECT: Partial<Draft> = { list: '', assignees: [], labels: [], cycle: '' }

/**
 * The dialog, which outlives being closed.
 *
 * Rendered always and drawing nothing while shut, rather than mounted when
 * opened: Escape closes without asking and opening again brings back what
 * was typed. Unmounted it would take the draft with it, and throwing away a
 * description somebody wrote because they reached for the wrong key is the
 * interface losing work.
 */
export function NewDialog({
  open,
  what,
  onClose,
  onMade,
}: {
  open: boolean
  what: What
  onClose: () => void
  onMade: (made: Made) => Promise<void> | void
}) {
  const [d, setD] = useState<Draft>(EMPTY)
  /*
   * Where it goes is taken from the screen every time it is opened, not once
   * when the button was drawn. The project and the list being looked at can
   * both change between the two, and a task that lands somewhere the screen
   * stopped showing looks like a task that was never made.
   *
   * Before paint, so the pills never show the last answer for a frame.
   *
   * Opened where no project is being looked at, it is the one at the top of
   * the sidebar — not the project the last task went to, which the head
   * then showed as though the screen had chosen it. A draft still being
   * written keeps the project it was being written for.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: taken up when the dialog opens: a draft being written keeps the project it was written for
  useLayoutEffect(() => {
    if (!open || what.kind !== 'task') return
    setD((was) => {
      const writing = Boolean(was.title.trim()) || written(was.doc)
      const project = what.projectId ?? (writing && was.project ? was.project : (recall<Marked[]>(TOP)?.[0]?.id ?? ''))
      return {
        ...was,
        ...(project !== was.project ? OF_THE_PROJECT : {}),
        project,
        list: what.list ?? '',
        assignees: what.who ? [what.who] : project === was.project ? was.assignees : [],
      }
    })
  }, [open])

  /* The task just made while the window stays open for the next one —
     said at the foot of the screen, with the way into it, and outliving
     the window if it is shut meanwhile. */
  const [told, setTold] = useState<Told | null>(null)
  useEffect(() => {
    if (!told) return
    const gone = setTimeout(() => setTold(null), 6000)
    return () => clearTimeout(gone)
  }, [told])

  const toast = told && <MadeToast told={told} onOpen={() => (setTold(null), onClose(), opened(told.made))} />
  if (!open) return toast || null
  const props = { d, setD, onClose, onMade, onMore: setTold }
  return (
    <>
      {what.kind === 'task' ? (
        <TaskMaker what={what} {...props} />
      ) : what.kind === 'post' ? (
        <PostMaker what={what} {...props} />
      ) : (
        <Maker what={what} {...props} />
      )}
      {toast}
    </>
  )
}

/** A task made with "Create more" on: its title, for the toast to say. */
type Told = { made: Made; title: string; at: number }

/**
 * Opening what was made: its own screen, beside the list it went into.
 * The list keeps how it was being looked at; another project is opened on
 * its tasks.
 */
function opened(made: Made) {
  if (!made.projectId) return
  /* On a board's page, beside the board. */
  if (openOnBoard(made.id)) return
  const here = parse(location.href)
  let there: Route = { view: 'projects', projectId: made.projectId, tool: 'tasks', objectId: made.id }
  if (here.view === 'projects' && here.projectId === made.projectId && here.tool === 'tasks') {
    /* Without the number of whatever was open before it. */
    const { at: _was, ...view } = here
    there = { ...view, objectId: made.id }
  }
  goTo(there)
}

/**
 * "Create more", remembered on this device. Off
 * until somebody turns it on: the window's ordinary end is the task opening.
 */
const MORE_KEY = 'tracker:create-more'
function useCreateMore(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(() => {
    try {
      return localStorage.getItem(MORE_KEY) === '1'
    } catch {
      return false
    }
  })
  const set = useCallback((next: boolean) => {
    setOn(next)
    try {
      if (next) localStorage.setItem(MORE_KEY, '1')
      else localStorage.removeItem(MORE_KEY)
    } catch {
      /* Storage refused: on for as long as the page is. */
    }
  }, [])
  return [on, set]
}

/** "Task created", at the foot of the screen, with the way into it. */
function MadeToast({ told, onOpen }: { told: Told; onOpen: () => void }) {
  return createPortal(
    <div
      key={told.at}
      data-made-toast
      role="status"
      className="fixed left-1/2 z-[60] -translate-x-1/2"
      /* Above a phone's tabs, which are at the foot too. */
      style={{ bottom: 'calc(24px + var(--foot))' }}
    >
      <Glass radius={16} className="flex items-center gap-4 py-2 pr-2 pl-4">
        <span className="flex min-w-px items-center gap-2 text-base">
          <Icon name="check" size={16} className="text-accent" style={{ flexShrink: 0 }} />
          <span className="shrink-0 text-ink">{W.taskCreated}</span>
          <span className="max-w-[240px] truncate text-ink-3">{told.title}</span>
        </span>
        <button
          type="button"
          data-testid="open-made"
          onClick={onOpen}
          className="flex h-8 shrink-0 items-center px-3 text-base font-medium text-accent"
          style={{ borderRadius: 'var(--r-pill)' }}
        >
          {W.openIt}
        </button>
      </Glass>
    </div>,
    document.body,
  )
}

type MakerProps<W extends What = What> = {
  what: W
  d: Draft
  setD: React.Dispatch<React.SetStateAction<Draft>>
  onClose: () => void
  onMade: (made: Made) => Promise<void> | void
  /** A task made with "Create more" on, for the toast. */
  onMore?: (told: Told) => void
}

/** The one way a draft becomes a thing, for both windows. */
function useMake({ what, setD, onClose, onMade, onMore }: MakerProps, more = false) {
  const [busy, setBusy] = useState(false)
  /* Counted up each time the window is cleared for the next one, so the
     title can take the caret back. */
  const [again, setAgain] = useState(0)
  const submit = useCallback(
    /* `kept`: an announcement saved as its author's draft rather than
       posted. */
    async (draft: Draft, kept = false) => {
      /*
       * The same test the Create button is disabled by.
       *
       * It only asked for a title, so Enter would send a task with no
       * project — a POST to `/projects//tasks` that answers nothing useful
       * — while the button beside it was greyed out for exactly that reason.
       * Two ways to commit and one of them checked less.
       */
      const title = draft.title.trim()
      if (!ready(what, draft) || busy) return
      setBusy(true)
      try {
        const made = await make(what, draft, title, kept)
        /*
         * "Create more": the window stays, the words go, and where it goes
         * and who has it stay for the next one.
         * The task is said at the foot of the screen with the way into it,
         * rather than opened, which is what the switch is for.
         */
        if (more && what.kind === 'task') {
          /* Only what was sent: words typed while the request was out are
             the next task's, not this one's to throw away. */
          setD((was) => (was.title === draft.title && was.doc === draft.doc ? { ...was, title: '', doc: undefined, sending: false } : was))
          setAgain((n) => n + 1)
          onMore?.({ made, title, at: Date.now() })
          void Promise.resolve(onMade(made)).catch(() => {})
          return
        }
        /*
         * Made is made, and the dialog's work is over.
         *
         * What the caller does next — refetch a list, go to where it landed
         * — is a separate concern that must not be waited on. Awaited, a
         * slow refresh left the dialog open with the title still in it as
         * though nothing had happened; it had, and pressing Enter again
         * would have made a second one. A failure there must not do that
         * either, hence the catch on a promise nobody holds.
         */
        /*
         * Made, so the dialog is done — unless "Create more" is on, above.
         * It was here once before, on by default and drawn as a pill with a
         * verb beside Create, so it read as a second way to create and
         * changed what Create did without saying so. It is a switch now,
         * off until somebody turns it on.
         */
        onClose()
        /*
         * And the draft goes with it.
         *
         * The dialog outlives being shut so that Escape does not throw away
         * a description somebody wrote — but a thing that was *made* is not
         * work in progress, and keeping it meant opening the dialog again
         * showed the title of the task just created, waiting to be made a
         * second time. Closed without making, the draft stays; made, it is
         * spent.
         */
        setD(EMPTY)
        /*
         * And a task opens, where it was made — its own screen, beside the
         * list it went into. Made and left behind in a list, it had to be
         * found again to be written into, which is the thing a window this
         * size is for. The list keeps how it was being looked at; another
         * project is opened on its tasks.
         */
        if (what.kind === 'task') opened(made)
        void Promise.resolve(onMade(made)).catch(() => {})
      } finally {
        setBusy(false)
      }
    },
    [busy, onClose, onMade, onMore, setD, what, more],
  )
  return { submit, busy, again }
}

/** A project: a name and its tools. A task and an announcement are written
    in the large window — `Writing`. */
function Maker({ what, d, setD, onClose, onMade }: MakerProps) {
  const first = useRef<HTMLInputElement>(null)
  useEffect(() => first.current?.focus(), [])
  const set = (part: Partial<Draft>) => setD((was) => ({ ...was, ...part }))
  const { submit, busy } = useMake({ what, d, setD, onClose, onMade })

  /* One chord that works from every field in the dialog, including the
     description, where Enter has to mean a new line. */
  const chord = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      void submit(d)
    }
  }

  return (
    <Dialog
      title={TITLE[what.kind]}
      onClose={onClose}
      testId={`new-${what.kind}`}
      footer={
        <>
          <div className="flex-1" />
          <Button tone="primary" data-testid="make" disabled={!ready(what, d) || busy} onClick={() => void submit(d)}>
            {MORE.create}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-1 px-4 pt-1 pb-3" onKeyDown={chord}>
        <input
          {...notALogin}
          ref={first}
          data-testid="new-title"
          className="bg-transparent text-xl font-medium outline-none placeholder:text-[var(--ink-3)]"
          style={{ color: 'var(--ink)', letterSpacing: 'var(--track-title)' }}
          placeholder={W.projectName}
          value={d.title}
          /* Read from the field, never from state: React batches the update
             from typing, so a handler that closes over `d` and runs in the
             same movement as the keystroke sees the render before it. That
             bug shipped once in the field this replaces. */
          onChange={(e) => set({ title: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void submit({ ...d, title: e.currentTarget.value })
            }
          }}
        />

        {/* No description for a project, which has a name and its tools —
            `docs/specs/projects-index.md`. */}

        <div className="flex flex-wrap items-center gap-2 pt-3">
          {what.kind === 'project' &&
            ORDER.map((t) => (
              <Toggle
                key={t}
                testId={`new-tool-${t}`}
                on={d.tools.includes(t)}
                onChange={(on) => set({ tools: on ? [...d.tools, t] : d.tools.filter((x) => x !== t) })}
              >
                {LABEL[t]}
              </Toggle>
            ))}
        </div>
      </div>
    </Dialog>
  )
}

/** A title, and for a task a project to put it in — and nothing of it
    still on its way up, or the task would keep a picture with no file. */
function ready(what: What, d: Draft): boolean {
  if (!d.title.trim()) return false
  const waiting = d.sending || sending(d.doc)
  if (what.kind === 'post') return !waiting
  return what.kind !== 'task' || (Boolean(d.project) && !waiting)
}

/** Whether a picture or a file in the words has not landed yet. */
function sending(doc: unknown): boolean {
  let found = false
  const walk = (n: unknown) => {
    if (found || !n || typeof n !== 'object') return
    const node = n as { type?: string; attrs?: { fileId?: unknown }; content?: unknown[] }
    if (node.type === 'attachment' && !node.attrs?.fileId) found = true
    node.content?.forEach(walk)
  }
  walk(doc)
  return found
}

/** Whether the words say anything — an empty paragraph is no description. */
function written(doc: unknown): boolean {
  const content = (doc as { content?: { type?: string; content?: unknown[] }[] } | null)?.content ?? []
  return content.some((n) => n.type !== 'paragraph' || (n.content?.length ?? 0) > 0)
}

/* ------------------------------------------------------------- the task */

/**
 * What a project offers a task — its lists, its people, its labels and its
 * sprints — read for whichever project is chosen.
 *
 * From what was last read first, so a window opened inside a project is
 * drawn with its answers in it rather than filling them in a beat later;
 * the server's answer replaces them in place. The keys are the ones the
 * tasks screen keeps, so having looked at a project is enough.
 */
function useOffered(projectId: string) {
  const kept = <T,>(key: string): T[] => (projectId ? (recall<T[]>(`${key}:${projectId}`) ?? []) : [])
  const [lists, setLists] = useState<Placed[]>(() => kept('lists'))
  const [people, setPeople] = useState<PersonInWorkspace[]>(() => kept('members'))
  const [labels, setLabels] = useState<Label[]>(() => kept('labels'))
  const [cycles, setCycles] = useState<{ id: string; name: string; starts_on?: string; ends_on?: string }[]>(() => kept('cycles'))
  // biome-ignore lint/correctness/useExhaustiveDependencies: what was kept is read when the project changes; kept is new on every render
  useEffect(() => {
    setLists(kept('lists'))
    setPeople(kept('members'))
    setLabels(kept('labels'))
    setCycles(kept('cycles'))
    if (!projectId) return
    let live = true
    const read = <T,>(path: string, key: string, field: string, put: (v: T[]) => void) =>
      void api<Record<string, T[]>>(`/projects/${projectId}/${path}`)
        .then((r) => live && put(remember(`${key}:${projectId}`, r[field] ?? [])))
        .catch(() => {})
    read<Placed>('lists', 'lists', 'lists', setLists)
    read<PersonInWorkspace>('members', 'members', 'members', setPeople)
    read<Label>('labels', 'labels', 'labels', setLabels)
    read<{ id: string; name: string }>('cycles', 'cycles', 'cycles', setCycles)
    return () => {
      live = false
    }
  }, [projectId])

  /* Made by name from the picker, as on the open task. */
  const makeLabel = useCallback(
    async (name: string, color?: string | null): Promise<Label | null> => {
      if (!projectId) return null
      const made = await api<Label>(`/projects/${projectId}/labels`, {
        method: 'POST',
        body: JSON.stringify({ name, ...(color ? { color } : {}) }),
      }).catch(() => null)
      if (made) setLabels((had) => (had.some((l) => l.id === made.id) ? had : [...had, made]))
      return made
    },
    [projectId],
  )
  return { lists, people, labels, cycles, makeLabel }
}

/** Where the projects are kept, in the sidebar's order — `/projects`
    answers in it — so the first is the one at the top. */
const TOP = 'projects:pick'

/** Every project this person is on, for the head — remembered, so the head
    is drawn named. */
function useProjects(): Marked[] {
  const [projects, setProjects] = useState<Marked[]>(() => recall<Marked[]>(TOP) ?? [])
  useEffect(() => {
    void (everyPage<Marked>('/projects', 'projects') as Promise<{ projects: Marked[] }>)
      .then((r) => setProjects(remember(TOP, r.projects)))
      .catch(() => {})
  }, [])
  return projects
}

/**
 * The window something is written in — a task, an announcement: the place
 * at the head, a title as tall as what it says, whatever the thing has to
 * say about itself, and the open task's editor whole, taking files dropped
 * anywhere on it.
 */
function Writing({
  what,
  testId,
  head,
  d,
  set,
  submit,
  busy,
  onClose,
  projectId,
  titleSaid,
  bodySaid,
  bodyTestId,
  children,
  more,
  again = 0,
  people,
}: {
  what: What
  testId: string
  head: React.ReactNode
  d: Draft
  set: (part: Partial<Draft>) => void
  submit: (draft: Draft, kept?: boolean) => Promise<void>
  busy: boolean
  onClose: () => void
  /** Where a file put into the words becomes a row; none yet, none taken. */
  projectId: string
  titleSaid: string
  bodySaid: string
  bodyTestId: string
  children?: React.ReactNode
  /** "Create more" and its switch, where the window offers it — a task. */
  more?: { on: boolean; set: (on: boolean) => void }
  /** Counts the times the window was cleared for the next one. */
  again?: number
  /** Who `@` offers in the words — `docs/specs/task-mentions.md`. */
  people?: readonly Callable[]
}) {
  const title = useRef<HTMLTextAreaElement>(null)
  const into = useRef<EditorHandle | null>(null)
  /* Into the title when it opens, and again when it is cleared for the next
     task. */
  // biome-ignore lint/correctness/useExhaustiveDependencies: again is the trigger: the title takes the hand back after each task made
  useEffect(() => title.current?.focus(), [again])
  /* Files held over the window, which takes them anywhere — not only on the
     line of words, which is all the editor itself listens on. */
  const drop = useDropFiles(Boolean(projectId), (files) => into.current?.files?.(files))

  /* As tall as what it says, the way the open task's title is — and again
     when the window is narrowed or widened, which rewraps it. */
  // biome-ignore lint/correctness/useExhaustiveDependencies: the field is fitted to its words whenever the words change
  useLayoutEffect(() => {
    const fit = () => {
      const f = title.current
      if (!f) return
      f.style.height = '0px'
      f.style.height = `${f.scrollHeight}px`
    }
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [d.title])

  const chord = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      void submit(d)
    }
  }

  return (
    <Dialog
      title={TITLE[what.kind]}
      size="large"
      /* A sheet the height of the screen on a phone, as the iPhone app
         makes a task. */
      sheet
      onClose={onClose}
      testId={testId}
      head={head}
      footer={
        <>
          <span className="text-sm max-sm:hidden text-ink-3">
            {d.sending || sending(d.doc) ? W.waitingForUpload : what.kind === 'post' ? W.toPost : W.toCreate}
          </span>
          <div className="flex-1" />
          {/* A switch, said as one, off until turned on: on, Create makes
              the task and clears the window for the next. */}
          {more && (
            <label className="mr-2 flex min-w-0 cursor-pointer items-center gap-2 text-sm text-ink-2">
              <Switch on={more.on} onChange={more.set} testId="create-more" said={W.createMore} />
              <span aria-hidden className="truncate">
                {W.createMore}
              </span>
            </label>
          )}
          {/* An announcement can wait: kept its author's until they press
              Publish on it. Quiet, beside the
              one action, which says what it does now that there are two. */}
          {what.kind === 'post' && (
            <span className="mr-2 inline-flex">
              <Button data-testid="save-draft" disabled={!ready(what, d) || busy} onClick={() => void submit(d, true)}>
                {W.saveDraft}
              </Button>
            </span>
          )}
          <Button tone="primary" data-testid="make" disabled={!ready(what, d) || busy} onClick={() => void submit(d)}>
            {what.kind === 'post' ? W.post : MORE.create}
          </Button>
        </>
      }
    >
      <div
        data-new-body
        data-new-task-body={what.kind === 'task' ? '' : undefined}
        data-dropping={drop.held || undefined}
        className="relative flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-6 pt-2 pb-6 max-sm:px-4"
        onKeyDown={chord}
        {...drop.handlers}
      >
        {/* Said while they are held over it, where they will go. */}
        {drop.held && <DropHere said={what.kind === 'post' ? EDITOR.dropIntoPost : EDITOR.dropIntoDescription} />}
        <textarea
          ref={title}
          data-testid="new-title"
          rows={1}
          className="block w-full shrink-0 resize-none overflow-hidden bg-transparent text-xl leading-[1.3] font-medium outline-none placeholder:text-[var(--ink-3)]"
          style={{ color: 'var(--ink)', letterSpacing: 'var(--track-title)' }}
          placeholder={titleSaid}
          value={d.title}
          /* Read from the field, never from state — the handler closing
             over `d` sees the render before the keystroke. */
          onChange={(e) => set({ title: e.target.value.replace(/\s*\n\s*/g, ' ') })}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return
            if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
              e.preventDefault()
              void submit({ ...d, title: e.currentTarget.value })
            }
            /* Down from the title is into the words, as on the open task. */
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              into.current?.enter()
            }
          }}
        />

        {children}

        {/*
          The open task's editor, whole: `/` and the `+`, headings, lists,
          tables, pictures and files — a file becoming a row in the chosen
          project's Docs, which is why it is drawn again for another
          project: the editor holds where its files go from when it was
          made. The room under it is part of it, so a press anywhere below
          the words is a press at their end.
        */}
        <div
          className="flex min-h-[240px] flex-1 cursor-text flex-col pt-1 max-sm:min-h-24"
          onMouseDown={(e) => {
            if (e.target !== e.currentTarget) return
            e.preventDefault()
            into.current?.end?.()
          }}
        >
          <Editor
            key={projectId}
            testId={bodyTestId}
            handle={into}
            onUp={() => {
              const f = title.current
              if (!f) return
              f.focus()
              f.setSelectionRange(f.value.length, f.value.length)
            }}
            size={15}
            tone="color-mix(in oklch, var(--ink) 72%, var(--ink-2))"
            value={d.doc ?? { type: 'doc', content: [{ type: 'paragraph' }] }}
            projectId={projectId}
            {...(people ? { people } : {})}
            placeholder={bodySaid}
            onChange={(doc) => set({ doc })}
            onSending={(sending) => set({ sending })}
          />
        </div>
      </div>
    </Dialog>
  )
}

/** The head's place and what is being made: "▣ Website › New task". */
function Where({ place, making }: { place: React.ReactNode; making: string }) {
  return (
    <span className="flex min-w-px items-center gap-2">
      {place}
      <Icon name="chevR" size={12} className="text-ink-3" style={{ flexShrink: 0 }} />
      <span className="truncate text-ink-2" style={{ letterSpacing: 'var(--track-body)' }}>
        {making}
      </span>
    </span>
  )
}

/**
 * A task, made in the shape it is read in.
 *
 * The open task's head, its facts two to a row with their glyphs and their
 * own controls, and its editor — `/`, the `+`, pictures and files. It was a
 * title, a plain box and four of the browser's selects, so the place a task
 * started looked nothing like the place it lived, and nothing in its
 * description could be more than a line of text until it was opened again.
 */
function TaskMaker({ what, d, setD, onClose, onMade, onMore }: MakerProps<Extract<What, { kind: 'task' }>>) {
  const set = (part: Partial<Draft>) => setD((was) => ({ ...was, ...part }))
  const [more, setMore] = useCreateMore()
  const { submit, busy, again } = useMake({ what, d, setD, onClose, onMade, ...(onMore ? { onMore } : {}) }, more)
  const chips = usePhone()
  const projects = useProjects()
  const { lists, people, labels, cycles, makeLabel } = useOffered(d.project)
  /* The top project, once the list has been read for the first time —
     before that there was nothing remembered to take it from. Asked of the
     draft as it is now, not as this render saw it: on the frame the window
     opens, the screen's own project is written in a moment after, and a
     check against the older draft put every task made inside Website into
     whichever project led the list. */
  const top = projects[0]?.id
  useEffect(() => {
    if (!top) return
    setD((was) => (was.project ? was : { ...was, ...OF_THE_PROJECT, project: top }))
  }, [top, setD])

  /* Where it will land when nobody says: the first list, which is where the
     server puts it — said, rather than an empty status the task never has. */
  const status = d.list || (lists.find((l) => !l.intake) ?? lists[0])?.id || null
  const named = W.theNewTask
  /* Nobody chosen, in a list an agent takes: the agent is who it goes to,
     said in the quiet ink. */
  const into = lists.find((l) => l.id === status)
  const takes =
    d.assignees.length === 0 && into?.agent_id && !into.agent_gone && !into.finishes
      ? people.find((p) => p.actor_id === into.agent_id)
      : undefined

  return (
    <Writing
      what={what}
      testId="new-task"
      head={
        <Where
          making={MAKE.newTask}
          place={
            <ProjectPick
              projects={projects}
              value={d.project}
              testId="new-project-pick"
              onPick={(id) => id !== d.project && set({ project: id, ...OF_THE_PROJECT })}
            />
          }
        />
      }
      d={d}
      set={set}
      submit={submit}
      busy={busy}
      onClose={onClose}
      projectId={d.project}
      titleSaid={W.taskTitle}
      bodySaid={MAKE.whatIsThisAbout}
      bodyTestId="new-task-body"
      more={{ on: more, set: setMore }}
      again={again}
      people={people}
    >
      {/* The open task's facts, in its order and with its controls. */}
      <div
        data-task-facts
        data-chips={chips || undefined}
        className={`shrink-0 ${chips ? 'flex flex-wrap gap-2 py-1' : 'grid grid-cols-1 gap-x-8 py-1 sm:grid-cols-2'}`}
      >
        <Fact chip={chips} icon="statusDoing" label={MORE.status} testId="new-status">
          <Status lists={lists} value={status} said={named} onPick={(id) => set({ list: id })} />
          <span className="truncate" style={{ color: status ? 'var(--ink)' : 'var(--ink-3)' }}>
            {lists.find((l) => l.id === status)?.name ?? W.noList}
          </span>
        </Fact>
        <Fact chip={chips} icon="person" label={MORE.assigned} testId="new-assignee">
          <WhoPick people={people} value={d.assignees} said={named} size={20} onPick={(to) => set({ assignees: to })} />
          <span className="truncate" style={{ color: d.assignees.length ? 'var(--ink)' : 'var(--ink-3)' }}>
            {namesOf(people, d.assignees) || takes?.name || (chips ? MORE.assigned : W.noOne)}
          </span>
        </Fact>
        <Fact chip={chips} icon="tag" label={FACTS.labels} testId="new-labels">
          <LabelPick
            all={labels}
            value={d.labels}
            said={named}
            onMake={makeLabel}
            /* As a chip, the open task's face: one label is itself, more
                 are a count, none is the word. */
            {...(chips
              ? {
                  face:
                    d.labels.length === 1 ? (
                      <LabelChip label={d.labels[0]!} size={14} />
                    ) : (
                      <span className="flex items-center gap-2" style={{ color: d.labels.length ? 'var(--ink)' : 'var(--ink-3)' }}>
                        <Icon name="tag" size={14} />
                        {d.labels.length ? W.labels(d.labels.length) : FACTS.labels}
                      </span>
                    ),
                }
              : {})}
            onPick={(next) => set({ labels: next })}
          />
        </Fact>
        <Fact chip={chips} icon="flag" label={FACTS.priority} testId="new-priority">
          <PriorityPick value={d.priority} said={named} onPick={(to) => set({ priority: to })} />
          <span style={{ color: d.priority ? 'var(--ink)' : 'var(--ink-3)' }}>
            {d.priority ? PRIORITY_SAID[d.priority] : chips ? FACTS.priority : HEADS.none}
          </span>
        </Fact>
        <Fact chip={chips} lead icon="cal" label={FACTS.due}>
          <DateButton
            testId="new-due"
            said={W.dueOfNewTask}
            {...(chips ? { empty: FACTS.due } : {})}
            value={d.due || null}
            onPick={(to) => set({ due: to ?? '' })}
            repeat={{ value: d.repeat, onPick: (rule, due) => set({ repeat: rule, ...(due ? { due } : {}) }) }}
          >
            {d.due ? (
              <span className="flex min-w-0 items-center gap-2">
                {writtenDay(d.due)}
                {d.repeat && (
                  <span className="text-ink-3">
                    <RepeatMark rule={d.repeat} words={!chips} />
                  </span>
                )}
              </span>
            ) : undefined}
          </DateButton>
        </Fact>
        {/* Only where there are sprints to pick, as on the open task. */}
        {cycles.length > 0 && (
          <Fact chip={chips} lead icon="cycle" label={FACTS.cycle} testId="new-sprint">
            <CyclePick
              cycles={cycles}
              value={d.cycle || null}
              said={named}
              onPick={(to) => set({ cycle: to ?? '' })}
              face={
                <span className="truncate" style={{ color: d.cycle ? 'var(--ink)' : 'var(--ink-3)' }}>
                  {cycles.find((y) => y.id === d.cycle)?.name ?? (chips ? FACTS.cycle : HEADS.none)}
                </span>
              }
            />
          </Fact>
        )}
      </div>
    </Writing>
  )
}

/**
 * An announcement, in the same window. It is what
 * it says, so it is the title and the words with nothing between them; its
 * project is the one being looked at, said at the head and not chosen.
 */
function PostMaker({ what, d, setD, onClose, onMade }: MakerProps<Extract<What, { kind: 'post' }>>) {
  const set = (part: Partial<Draft>) => setD((was) => ({ ...was, ...part }))
  const { submit, busy } = useMake({ what, d, setD, onClose, onMade })
  const here = useProjects().find((p) => p.id === what.projectId)
  return (
    <Writing
      what={what}
      testId="new-post"
      head={
        <Where
          making={MAKE.newPost}
          place={
            here && (
              <span
                className="flex h-7 min-w-px items-center gap-2 pr-3 pl-1 text-sm font-medium bg-track text-ink"
                /* Concentric with the mark inside it, as the project picker is. */
                style={{ borderRadius: markRadius(20) + 4 }}
              >
                <ProjectMark {...markOf(here)} size={20} />
                <span className="truncate">{here.name}</span>
              </span>
            )
          }
        />
      }
      d={d}
      set={set}
      submit={submit}
      busy={busy}
      onClose={onClose}
      projectId={what.projectId}
      titleSaid={W.postTitle}
      bodySaid={W.writePost}
      bodyTestId="new-post-body"
    />
  )
}

/** The one request, so the dialog above holds no knowledge of the contract. */
async function make(what: What, d: Draft, title: string, kept = false): Promise<Made> {
  if (what.kind === 'project') {
    const r = await api<{ id: string; slug?: string }>('/projects', {
      method: 'POST',
      body: JSON.stringify({
        name: title,
        // Never an empty array: the endpoint refuses one, and a project with
        // no tools is a project with nothing in it.
        tools: d.tools.length ? ORDER.filter((t) => d.tools.includes(t)) : undefined,
      }),
    })
    /*
     * Its address, known before the list that would have taught it arrives.
     *
     * The router reads a project's name out of a registry the shell fills
     * from `GET /projects`, so a project opened the instant it was made had
     * an address nothing could spell: the screen was right and the URL was a
     * uuid until a refetch landed. The endpoint answers with the slug now.
     */
    if (r.slug) known({ projects: [{ id: r.id, slug: r.slug }] })
    return { id: r.id, projectId: r.id }
  }
  if (what.kind === 'post') {
    /* The client that draws Publish asks for the draft; left out, it is
       posted, as every other client's is. */
    const r = await api<{ id: string }>(`/projects/${what.projectId}/posts`, {
      method: 'POST',
      body: JSON.stringify({ title, body: d.doc ?? {}, ...(kept ? { audience: 'author' } : {}) }),
    })
    return { id: r.id, projectId: what.projectId }
  }
  /* Everything the window asked, in the one request — the endpoint has
     taken all of it, the sprint since the window offered it. */
  const r = await api<{ id: string; number?: number }>(`/projects/${d.project}/tasks`, {
    method: 'POST',
    body: JSON.stringify({
      title,
      list_id: d.list || null,
      assignee_ids: d.assignees,
      due_on: d.due || null,
      ...(d.repeat ? { repeat: d.repeat } : {}),
      priority: d.priority,
      labels: d.labels.map((l) => l.id),
      cycle_id: d.cycle || null,
      body: written(d.doc) ? d.doc : null,
    }),
  })
  /* Its number, so the address it opens at is the one a person reads. */
  numbered([{ id: r.id, number: r.number ?? null }], d.project, 'task')
  return { id: r.id, projectId: d.project }
}
