import type { Repeat } from '@tracker/shared-schema'
import { type PullOnTask, type PersonInWorkspace } from '@tracker/shared-schema'
import { api } from '../../data/api.js'
import { type Priority, type Label, whoOf } from '../kit.jsx'
import { primeUrls } from '../../data/files.js'
import { warmPictures as warmFiles } from '../../data/warm.js'
import { recall, remember } from '../../data/memory.js'
import { type Comment } from '../Comments.jsx'
import { type Event } from '../../data/said.js'
import { SHOWN } from './time.jsx'
import { readAside } from './triage.jsx'
import { type Related } from './blockers.jsx'

/**
 * A part of this task.
 *
 * It was a checklist item in its own little table; it is a task now, and the
 * things it gained — an assignee, a date, an address, comments — are the
 * things a task has. The key is still `steps`
 * because three clients read it, and renaming a field is a separate change
 * from changing what is behind it.
 */
export type Step = {
  id: string
  title: string
  done_at: string | null
  sort_key: string
  /** Everybody it is given to. Read through `whoOf`. */
  assignee_ids?: string[]
  assignee_id: string | null
  due_on: string | null
  priority: Priority | null
  labels?: Label[]
  icon: string | null
  /** The list's colour, or null for the mark's own. */
  color?: string | null
}
export type Full = {
  id: string
  /** What the address and a sentence both call it. */
  number: number
  title: string
  body: unknown
  /** When it last changed — with its list, what says an agent is at it. */
  updated_at?: string | null
  /** Which stretch of dates it is in, or nothing. */
  cycle_id?: string | null
  /** Whether **you** are watching it. */
  subscribed?: boolean
  /** **Your** reminder on it, or none. */
  my_reminder?: { at: string } | null
  /** Everybody it is given to. Read through `whoOf`. */
  assignee_ids?: string[]
  assignee_id: string | null
  due_on: string | null
  priority: Priority | null
  labels?: Label[]
  starts_at: string | null
  column: string | null
  completed_at: string | null
  list_id: string | null
  author_id: string
  author_name: string
  /** The tasks it is inside, outermost first — empty for a task of its own. */
  ancestors?: { id: string; number: number; title: string }[]
  /** What it waits on and what waits on it. */
  blocked_by?: Related[]
  blocks?: Related[]
  /** The task it is a part of, or none. */
  parent_id?: string | null
  /** How it repeats, or nothing. */
  repeat?: Repeat | null
}
/**
 * What a list already knows about a task, kept for the screen that opens it.
 *
 * This screen drew nothing until its own fetch landed, so opening a task
 * from My tasks was a blank window for a round trip — measured at 85ms on
 * the built app and three times that in development, which is the jerk
 * somebody feels and cannot name. The row that was pressed holds most of
 * what the first frame needs; the body, the comments and the hours are the
 * part worth waiting for.
 *
 * The fields a list cannot know are empty rather than absent, so the screen
 * fills in rather than appearing twice.
 */
export function seen(row: {
  id: string
  number?: number | null
  title: string
  assignee_ids?: string[]
  assignee_id?: string | null
  due_on?: string | null
  priority?: Priority | null
  labels?: Label[]
  completed_at?: string | null
  list_id?: string | null
}): void {
  const had = recall<Read>(`task:${row.id}`)
  if (had) return
  remember<Read>(`task:${row.id}`, {
    steps: [],
    comments: [],
    time: [],
    task: {
      id: row.id,
      number: row.number ?? 0,
      title: row.title,
      body: null,
      assignee_ids: whoOf(row),
      assignee_id: row.assignee_id ?? null,
      due_on: row.due_on ?? null,
      priority: row.priority ?? null,
      ...(row.labels ? { labels: row.labels } : {}),
      starts_at: null,
      column: null,
      completed_at: row.completed_at ?? null,
      list_id: row.list_id ?? null,
      author_id: '',
      author_name: '',
    },
  })
}

/**
 * The task under the pointer, a moment before it is opened.
 *
 * Seeded from the row, the screen opens on the title and the facts and the
 * words arrive with the fetch — measured, the title at 76ms and the body at
 * 112, which reads as the text turning up late rather than the screen
 * arriving. The hand is on the row for longer than that before it presses.
 *
 * The same bargain the sidebar makes for a room it is hovering: one request
 * for something that was about to be asked for anyway, and only once per
 * task.
 *
 * The screen that opens next still asks again, and that is deliberate. It
 * looks like an obvious saving not to: the prefetch landed milliseconds ago
 * on the same connection, so a second identical read is a round trip whose
 * answer is already on screen. Skipping it on a young enough answer was
 * written, measured, and taken back out — the body then arrived two frames
 * after the title, because the screen no longer had a second pass in which
 * to settle, and one frame of a title over an empty document is the thing
 * this whole file exists to prevent. The read costs a request nobody waits
 * for; the skip cost the frame somebody sees.
 */
export const asked = new Set<string>()

/*
 * When each task was last changed on this screen. A read asked for before
 * that moment answers with the task as it was, and remembering it would put
 * the past back over the change — which a slow read arriving after an edit
 * did, so the task opened again on its old title.
 */
export const editedAt = new Map<string, number>()
export const newerThanEdit = (taskId: string, askedAt: number) => (editedAt.get(taskId) ?? 0) <= askedAt

export function near(taskId: string): void {
  if (asked.has(taskId)) return
  const had = recall<Read>(`task:${taskId}`)
  if (had && had.task.author_id) return
  asked.add(taskId)
  /* Its history beside it, when the panel that shows it is the one this
     device keeps open — or the panel opens a beat after the task. */
  if (readAside() === 'history') void readHistory(taskId).catch(() => {})
  void readTask(taskId).catch(() => asked.delete(taskId))
}

/**
 * Whether what is remembered about a task is its whole read, and not the
 * row a list seeded it from — which has no body, no parts and no comments,
 * and is told apart by having no author.
 */
export const wholeRead = (r: Read | null): r is Read => Boolean(r?.task.author_id)

/*
 * One read of a task in the air at a time: the hover's and the screen's
 * waiting are the same request, so the screen can wait on what the hover
 * already asked rather than asking again behind it.
 */
const reading = new Map<string, Promise<Read>>()
/** The read of a task already on its way — the hover's — if there is one. */
export const readingTask = (taskId: string): Promise<Read> | undefined => reading.get(taskId)
export function readTask(taskId: string): Promise<Read> {
  let r = reading.get(taskId)
  if (r) return r
  const askedAt = Date.now()
  r = api<Read>(`/tasks/${taskId}`)
    .then((r) => {
      if (!newerThanEdit(taskId, askedAt)) return r
      /* And the pictures in it, while the hand is still on the row: their
         links came with the task, so their bytes can be on their way before
         the screen that draws them exists. */
      primeUrls(r.files, r.sizes, r.displays)
      /* Its pictures, and its comments' — fetched and decoded, so the
         screen draws them sharp from its first frame rather than over their
         glance. `data/warm.ts`. */
      void warmFiles([...picturesIn(r.task.body), ...r.comments.flatMap((c) => picturesIn(c.body))])
      remember<Read>(`task:${taskId}`, { ...r, time: r.time ?? [] })
      return r
    })
    .finally(() => reading.delete(taskId))
  reading.set(taskId, r)
  return r
}

/**
 * A task's history — the panel beside it — read and kept, so the panel
 * opens on it rather than growing its rows a beat after the task.
 */
const historyAsked = new Map<string, Promise<Event[]>>()
export const historyPath = (taskId: string) => `/activity?object=${taskId}&limit=${SHOWN + 1}`
export function readHistory(taskId: string): Promise<Event[]> {
  let r = historyAsked.get(taskId)
  if (r) return r
  r = api<{ events: Event[] }>(historyPath(taskId))
    .then((a) => remember(`history:${taskId}`, a.events ?? []))
    .finally(() => historyAsked.delete(taskId))
  historyAsked.set(taskId, r)
  return r
}

/**
 * Whether what is kept about a task is enough to draw its screen whole: its
 * read, and its history when that is the panel this device keeps open.
 */
export const drawable = (taskId: string): boolean =>
  wholeRead(recall<Read>(`task:${taskId}`)) && (readAside() !== 'history' || recall(`history:${taskId}`) !== null)

/*
 * When a press last stopped waiting for a task — see `taskReady`. A screen
 * opened inside that moment has had its four hundred milliseconds already.
 */
const waitedAt = new Map<string, number>()
export const waitedFor = (taskId: string): boolean => Date.now() - (waitedAt.get(taskId) ?? 0) < 1_000

/**
 * Resolved when a task can be drawn whole, or after 400 ms — whichever is
 * first.
 *
 * For a press that leaves a whole screen to open the task: the screen
 * waited for its read by drawing nothing, which from a project's list is
 * the list's half of the window empty for a moment, and from My tasks was
 * the whole window — four to seven blank frames on a slow machine, where
 * the hover's read had not landed when the press did. The press
 * waits here instead, with the list still on the screen, and the task
 * opens drawn. A thread's "N replies" waits the same way
 * (`chat/threadRead.ts`).
 */
export function taskReady(taskId: string): Promise<void> {
  if (drawable(taskId)) return Promise.resolve()
  const history = readAside() === 'history' && recall(`history:${taskId}`) === null ? readHistory(taskId) : null
  const read = wholeRead(recall<Read>(`task:${taskId}`)) ? null : (readingTask(taskId) ?? readTask(taskId))
  const settled = (p: Promise<unknown> | null) =>
    p?.then(
      () => undefined,
      () => undefined,
    )
  return Promise.race([Promise.all([settled(read), settled(history)]), new Promise<void>((r) => setTimeout(r, 400))]).then(() => {
    waitedAt.set(taskId, Date.now())
  })
}

/**
 * Everything one read of a task says.
 *
 * `/tasks/:id` answers with the task, its parts, its comments and its hours
 * in one response, and that whole answer is what is remembered — not the
 * task alone. It used to be the task alone, and the cost was visible: the
 * hand rests on a row, `near` fetches all four, three of them are thrown
 * away, and the screen opens on a title with an empty body, no sub-tasks and
 * no comments until its own identical fetch lands. Measured on the built
 * app: title at 659ms, sub-tasks and comments at 710ms — a screen arriving
 * in two pieces, which is the "sub-tasks are late" somebody sees.
 *
 * Remembering the answer costs nothing extra, because the request was made
 * anyway.
 */
export type Read = {
  task: Full
  steps: Step[]
  comments: Comment[]
  time: Spent[]
  /** What AI tools reported spending on it. */
  spend?: AiSpent[]
  /** Signed links for the files its body and comments hold. */
  files?: Record<string, string>
  /** The copies to draw, for the pictures that have one. */
  displays?: Record<string, string>
  /** And their sizes in bytes. */
  sizes?: Record<string, number>
  /** What GitHub says about it. */
  github?: { pulls: PullOnTask[]; issue?: { number: number; repo_name: string; url: string } | null }
  /** Asked for on the project's feedback page. */
  feedback?: { email: string | null } | null
}

/** The pictures a body holds, by file id — to ask for their bytes early. */
function picturesIn(body: unknown): string[] {
  const out: string[] = []
  const walk = (n: unknown) => {
    if (!n || typeof n !== 'object') return
    const node = n as { type?: string; attrs?: Record<string, unknown>; content?: unknown[] }
    if (node.type === 'attachment' && node.attrs?.kind === 'image' && typeof node.attrs.fileId === 'string') {
      out.push(node.attrs.fileId)
    }
    node.content?.forEach(walk)
  }
  walk(body)
  return out
}

/* From the contract — `shared-schema/src/responses.ts`. */
export type Person = PersonInWorkspace
/** A named stretch of dates a task can be in. */
export type Cycle = { id: string; name: string; starts_on: string; ends_on: string }
/** What an AI tool reported spending on this task. */
export type AiSpent = {
  id: string
  actor_id: string
  actor_name: string | null
  client: string
  model?: string | null
  tokens: number
  cost_usd?: number | null
  created_at?: string
}
/** An hour somebody wrote about this task. */
export type Spent = {
  id: string
  actor_id: string
  actor_name: string
  actor_avatar_url?: string | null
  minutes: number
  spent_on: string
  note: string | null
}
