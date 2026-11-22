import { z } from 'zod'
import {
  Uuid, Timestamp, DateOnly, SortKey, RichText, Slug,
  baseColumns, objectColumns,
} from './primitives.js'
import { Role, Tool, Origin } from './enums.js'
import { WorkspaceSettings } from './permissions.js'
import { Repeat } from './repeat.js'

/* ------------------------------------------------------------------ people */

/**
 * A person. In v1 an agent has no account of its own: it works under someone's
 * token and inherits exactly their rights, so there is nobody else to be an
 * actor. What a record needs instead is the channel, which `Origin` carries.
 */
export const Actor = z.object({
  id: Uuid,
  name: z.string().min(1).max(200),
  /*
   * A link this product made, not one pointing out of it.
   *
   * It was `z.url()`, from when the column was a text field somebody was
   * expected to paste a gravatar into. The bytes live in storage now and the
   * API hands back a signed path — `/api/blob/<key>?token=…`, relative, the
   * way a project's `icon_url` already was — so an absolute URL is the one
   * shape this must not be. `docs/specs/avatar.md`.
   */
  avatar_url: z.string().nullable(),
  /** What they do, in their own words — `docs/specs/person-card.md`. */
  title: z.string().max(80).nullable().optional(),
  created_at: Timestamp,
  updated_at: Timestamp,
  deleted_at: Timestamp.nullable(),
})

export const User = z.object({
  actor_id: Uuid,
  email: z.email(),
  email_verified_at: Timestamp.nullable(),
  /** Two-factor from day one, not as a later hardening pass. */
  totp_enabled: z.boolean(),
  created_at: Timestamp,
  updated_at: Timestamp,
})

export const Workspace = z.object({
  ...baseColumns,
  name: z.string().min(1).max(200),
  slug: Slug,
  settings: WorkspaceSettings,
  /** Flat price per workspace, so the plan lives here and not on a seat. */
  plan: z.string(),
  limits: z.record(z.string(), z.unknown()),
})

export const Membership = z.object({
  ...baseColumns,
  actor_id: Uuid,
  role: Role,
  invited_by: Uuid.nullable(),
  joined_at: Timestamp.nullable(),
})

/* ---------------------------------------------------------------- projects */

export const Project = z.object({
  ...baseColumns,
  /**
   * What the address calls it.
   *
   * Unique in its workspace, filled from the name by a trigger when nothing
   * supplies one, and **stable**: renaming a project does not move it,
   * because a slug worked out from the name every time it is read is not an
   * address but a rendering of a name, and every link anybody sent would
   * break the first time somebody fixed a typo in a title.
   */
  slug: Slug,
  /**
   * What a sentence calls it.
   *
   * Two to five letters with the number after them: `STU-41`, the thing
   * people say out loud, paste into a message and search for. An address
   * can be long because nobody types it; a label in front of forty titles
   * cannot be, and neither can a word somebody says.
   */
  key: z.string().regex(/^[A-Z]{1,3}[0-9]*$/),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).nullable(),
  /** Which of the four this project has switched on. */
  tools: z.array(Tool),
  archived_at: Timestamp.nullable(),
  /**
   * A sample to look around in, not anybody's work.
   * Kept out of My tasks, and deleted for good rather than to the bin.
   */
  sample: z.boolean(),
})

/**
 * A person is in a project or is not. This is what makes a client safe: the
 * role says what they may do, this says where.
 */
export const ProjectMember = z.object({
  ...baseColumns,
  project_id: Uuid,
  actor_id: Uuid,
  added_by: Uuid.nullable(),
})

/* ------------------------------------------------------- the four entities */

/**
 * An announcement, and a recurring check-in — one type. A poll is a post that
 * arrives on a schedule, which is why `schedule` is a field here rather than a
 * fifth entity.
 */
export const Post = z.object({
  ...objectColumns,
  /**
   * What the address calls it inside its project.
   *
   * One counter per project, shared by tasks, posts and documents: two
   * objects in a project never share a number, so 41 names one thing
   * whatever kind it is. Sparse for any one kind, which is the price.
   */
  number: z.int().positive(),
  title: z.string().min(1).max(300),
  body: RichText,
  category: z.string().max(100).nullable(),
  published_at: Timestamp.nullable(),
  /** null for a one-off; an RRULE-shaped string for a recurring check-in. */
  schedule: z.string().nullable(),
})

/**
 * A task, a board card and a calendar event are the same row. List, board and
 * calendar are views on it.
 *
 * `decided_at` is what the board's card age counts from — the design asks for
 * age since the last decision, not since creation, because a card nobody has
 * touched is the one worth seeing.
 */
/**
 * How urgent a task is.
 *
 * Four answers and a missing one. Urgent is not "high, but more" — it is the
 * thing that stops the other work, which is why it is drawn differently
 * rather than as a fourth bar.
 */
export const Priority = z.enum(['urgent', 'high', 'medium', 'low'])
export type Priority = z.infer<typeof Priority>

export const Task = z.object({
  ...objectColumns,
  /**
   * What the address calls it inside its project.
   *
   * One counter per project, shared by tasks, posts and documents: two
   * objects in a project never share a number, so 41 names one thing
   * whatever kind it is. Sparse for any one kind, which is the price.
   */
  number: z.int().positive(),
  list_id: Uuid.nullable(),
  title: z.string().min(1).max(300),
  body: RichText.nullable(),
  /**
   * Everybody it is given to, in the order they were put on it; empty for
   * nobody yet.
   */
  assignee_ids: z.array(Uuid),
  /**
   * The first of them, worked out by the database and never written: what
   * the apps that draw one face read. Whether a task is somebody's is asked
   * of `assignee_ids`.
   */
  assignee_id: Uuid.nullable(),
  due_on: DateOnly.nullable(),
  /**
   * How urgent it is, or nothing.
   *
   * A word rather than a number, because three clients read this field and
   * the contract is copied into repositories whose authors cannot ask what
   * `2` meant. The order here is the order it sorts in, and no priority is
   * not a fifth level at the bottom: it is the absence of an answer, and it
   * comes after the four that are answers.
   */
  priority: Priority.nullable(),
  starts_at: Timestamp.nullable(),
  ends_at: Timestamp.nullable(),
  sort_key: SortKey,
  completed_at: Timestamp.nullable(),
  decided_at: Timestamp,
  /**
   * The task this one is a part of.
   *
   * Not a fifth entity and not a new kind of row: a subtask is a task, which
   * is what answers every question about it — it has an assignee, a date, an
   * address, comments and a soft delete because that is what a task has.
   *
   * One level. A subtask cannot have subtasks, refused by a trigger rather
   * than only by the endpoint, because arbitrary nesting turns a list into a
   * tree and a tree needs decisions nobody asked for.
   */
  parent_id: Uuid.nullable(),
  /**
   * How it repeats, or nothing.
   *
   * Finishing a task that has one makes the next, due on the next date the
   * rule names, and hands the rule on: only the open one of a series
   * carries it. Optional as well as nullable, so the apps' generated
   * decoders read answers from before it existed.
   */
  repeat: Repeat.nullable().optional(),
  /** The next one this task made when it was finished, while it is kept. */
  repeat_next_id: Uuid.nullable().optional(),
})

/**
 * A list of tasks, and the place the progress curve lives: the design makes the
 * position a field of the list with a history, not a separate object.
 */
/**
 * The mark on a list, which is how far round the ring its work has gone.
 *
 * A closed set, and one shape filling up rather than a free choice of
 * pictures: a list's mark says what stage the work in it is at, and a list
 * called "Screens" with a star on it says nothing anybody can act on. The
 * two that are not stages — done and stopped — are endings.
 */
export const ListIcon = z.enum([
  // Not picked up yet, which is not the same as not started: a project
  // starts with both, and two lists sharing one mark is the fault the marks
  // were introduced to fix.
  'backlog',
  'open',
  'started',
  'doing',
  'review',
  'done',
  'stopped',
])
export type ListIcon = z.infer<typeof ListIcon>

/**
 * What a project has before anybody puts anything in it.
 *
 * Here rather than in the endpoint because it was written in three places —
 * the endpoint, the seed and the demo studio — and three copies of one fact
 * drift without anything failing. Three clients read this contract too, and a
 * native client inventing its own starting lists is the same product with a
 * different vocabulary.
 *
 * Two of them end the work: **Done** and **Canceled**. Cancelled work is not
 * open work — it has no business in anybody's list of what is on them, and
 * the alternative is a task nobody will ever do sitting in somebody's count
 * for ever. What the two endings say apart is *why* it stopped, which is the
 * only thing either of them is for.
 *
 * Every one of them can be renamed, removed or added to. This is where a
 * project starts, not what a project is.
 */
export const STARTING_LISTS: readonly {
  readonly name: string
  readonly icon: ListIcon
  readonly finishes: boolean
  readonly color: ListColor
  /** Drawn narrowed on a board until somebody opens it — Canceled. */
  readonly narrow: boolean
}[] = [
  /*
   * Coloured on the way in rather than left to the mark.
   *
   * Null means "the mark decides", and what it decides is one accent for
   * every stage and grey for every ending — so a project opened for the
   * first time was three blue marks and two grey ones, and the column
   * somebody is actually working in looked like the two either side of it.
   *
   * These five are a sequence, so they are given the colours of one:
   * nothing yet, picked up, being made, made, not going to be. A person
   * can change any of them, and a list they make themselves still gets
   * null and still lets the mark decide.
   */
  { name: 'Backlog', icon: 'backlog', finishes: false, color: 'grey', narrow: false },
  { name: 'Todo', icon: 'open', finishes: false, color: 'blue', narrow: false },
  { name: 'In Progress', icon: 'doing', finishes: false, color: 'orange', narrow: false },
  /* Where a pull request ready for review puts a task.
     Without it the review had nowhere to be but In Progress, and a task
     waiting on somebody's eyes looked the same as one still being made. */
  { name: 'In Review', icon: 'review', finishes: false, color: 'yellow', narrow: false },
  { name: 'Done', icon: 'done', finishes: true, color: 'green', narrow: false },
  /* Narrowed from the start: what was not going to be done is looked at
     rarely, and a full column of it is a fifth of the board spent on it. */
  { name: 'Canceled', icon: 'stopped', finishes: true, color: 'grey', narrow: true },
]

/**
 * What the mark is drawn in, when somebody has said.
 *
 * The ten tints the product already has — a project's tile and a person's
 * avatar are drawn in them. Ten colours the eye can name, not a picker: a
 * hundred greens are one thing nobody can learn, and a second palette beside
 * the first is two products. Named rather than stored as hex, so the palette
 * can be retuned without rewriting rows.
 */
export const ListColor = z.enum([
  'red', 'orange', 'yellow', 'green', 'teal',
  'blue', 'indigo', 'purple', 'pink', 'grey',
])
export type ListColor = z.infer<typeof ListColor>

export const TaskList = z.object({
  ...objectColumns,
  name: z.string().min(1).max(200),
  sort_key: SortKey,
  /** 0 = still figuring it out, 1 = making it. Moved by hand. */
  progress: z.number().min(0).max(1).nullable(),
  /**
   * Whether the work in this list is finished.
   *
   * The list is where a task is and the only place that says so — board
   * column, done mark and list were three answers to one question and could
   * disagree. Not the name and not the position, because both are the
   * person's to change.
   */
  finishes: z.boolean(),
  /**
   * Whether this is the project's triage: where what did not come from the
   * team's own hands waits to be accepted. One a
   * project at most, drawn first.
   */
  intake: z.boolean().default(false),
  icon: ListIcon,
  /**
   * What the mark is drawn in.
   *
   * Null is not the absence of a colour: it means the mark decides, which is
   * what it has always done — a stage is the accent, an ending is grey.
   */
  color: ListColor.nullable(),
  /**
   * Whether a board draws it narrowed until somebody opens it.
   *
   * Only the starting point: opening or narrowing a column is remembered on
   * the machine it was done on, and that choice wins. True for the Canceled
   * a new project starts with.
   */
  narrow: z.boolean(),
  /**
   * The agent of its project that takes its new tasks, or null.
   * A task made in it, or moved into it, with
   * nobody on it is given to this agent. Optional, so an answer from before
   * it still reads.
   */
  agent_id: Uuid.nullable().optional(),
})

/** A document is a file that is edited in place, so there is one entity. */
export const File = z.object({
  ...objectColumns,
  /**
   * What the address calls it inside its project.
   *
   * One counter per project, shared by tasks, posts and documents: two
   * objects in a project never share a number, so 41 names one thing
   * whatever kind it is. Sparse for any one kind, which is the price.
   */
  number: z.int().positive(),
  folder_id: Uuid.nullable(),
  name: z.string().min(1).max(300),
  /** Set for a document; null for an upload, which lives in object storage. */
  body: RichText.nullable(),
  /** Whether it is an upload. Its bytes are reached by `GET /api/files/:id/url`,
      never by where they are kept. */
  upload: z.boolean(),
  content_type: z.string().nullable(),
  size_bytes: z.int().nonnegative().nullable(),
  /** A PNG, JPEG, GIF or WebP's own pixels, read when it was uploaded; null otherwise. */
  pixel_width: z.int().positive().nullable(),
  pixel_height: z.int().positive().nullable(),
  version: z.int().positive(),
  /** Every write of the body, the shared state's included — what a `PATCH`
      says it read as `base_rev`. */
  rev: z.int().nonnegative().optional(),
  /** Read with it, one file at a time: whether the reader may change it
      (`content.edit.own` / `content.edit.any`, as a PATCH asks). */
  may_edit: z.boolean().optional(),
  /** What a written document wears: one of `MarkIcon` and an index into
      the ten tints, or null for a document's own look — `docs/specs/docs.md`,
      "A document's mark". */
  mark_icon: z.string().nullable().optional(),
  mark_tint: z.int().min(0).max(9).nullable().optional(),
})

/** A project channel and a direct conversation are one type. */
export const Conversation = z.object({
  ...baseColumns,
  /** null for a direct conversation, which belongs to no project. */
  project_id: Uuid.nullable(),
  name: z.string().max(200).nullable(),
})

export const Message = z.object({
  ...baseColumns,
  conversation_id: Uuid,
  author_id: Uuid,
  /** Threads hang off a message rather than the channel being one flat river. */
  parent_id: Uuid.nullable(),
  body: RichText,
  origin: Origin,
  edited_at: Timestamp.nullable(),
})

/* --------------------------------------------------------- service records */

export const Comment = z.object({
  ...baseColumns,
  /** Everything is commentable on one schema, so the target is a pair. */
  object_type: z.enum(['post', 'task', 'file', 'message']),
  object_id: Uuid,
  author_id: Uuid,
  body: RichText,
  origin: Origin,
})

export const Subscription = z.object({
  ...baseColumns,
  object_type: z.enum(['post', 'task', 'file', 'conversation']),
  object_id: Uuid,
  actor_id: Uuid,
})

export const TimeEntry = z.object({
  ...baseColumns,
  project_id: Uuid,
  object_type: z.enum(['post', 'task', 'file', 'project']).nullable(),
  object_id: Uuid.nullable(),
  actor_id: Uuid,
  minutes: z.int().positive(),
  spent_on: DateOnly,
  note: z.string().max(1000).nullable(),
})

/** A link from any object to any object; the reverse side is created with it. */
export const ObjectLink = z.object({
  ...baseColumns,
  from_type: z.enum(['post', 'task', 'file', 'message']),
  from_id: Uuid,
  to_type: z.enum(['post', 'task', 'file', 'message']),
  to_id: Uuid,
  created_by: Uuid,
})

/**
 * Immutable, and it names the author of every action including the ones that
 * arrived through a tool. A client is never served this.
 */
export const ActivityEvent = z.object({
  id: Uuid,
  workspace_id: Uuid,
  project_id: Uuid.nullable(),
  actor_id: Uuid,
  action: z.string(),
  object_type: z.string().nullable(),
  object_id: Uuid.nullable(),
  origin: Origin,
  at: Timestamp,
  meta: z.record(z.string(), z.unknown()),
})

export const Notification = z.object({
  ...baseColumns,
  actor_id: Uuid,
  /** One inbox, split by why it arrived rather than by a grid of checkboxes. */
  reason: z.enum(['mentioned', 'assigned', 'subscribed', 'messaged', 'joined']),
  object_type: z.string(),
  object_id: Uuid,
  read_at: Timestamp.nullable(),
})

/* ------------------------------------------------------------ credentials */

export const Invite = z.object({
  ...baseColumns,
  email: z.email().nullable(),
  role: Role,
  /** A client's link opens one project, never the workspace. */
  project_ids: z.array(Uuid),
  created_by: Uuid,
  expires_at: Timestamp,
  used_at: Timestamp.nullable(),
  used_by: Uuid.nullable(),
})

/**
 * A token for a tool somebody connects. A credential, not data: never listed
 * with its secret, stored only as a hash.
 */
export const ApiToken = z.object({
  ...baseColumns,
  actor_id: Uuid,
  name: z.string().min(1).max(100),
  /** Empty means every project the person is on. */
  project_ids: z.array(Uuid),
  last_used_at: Timestamp.nullable(),
  last_used_ip: z.string().nullable(),
  expires_at: Timestamp,
  revoked_at: Timestamp.nullable(),
})

export type Actor = z.infer<typeof Actor>
export type Workspace = z.infer<typeof Workspace>
export type Membership = z.infer<typeof Membership>
export type Project = z.infer<typeof Project>
export type ProjectMember = z.infer<typeof ProjectMember>
export type Post = z.infer<typeof Post>
export type Task = z.infer<typeof Task>
export type File = z.infer<typeof File>
export type Message = z.infer<typeof Message>
export type Conversation = z.infer<typeof Conversation>
