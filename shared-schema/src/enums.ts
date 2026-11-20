import { z } from 'zod'

/**
 * Four roles, and the set does not change. What is configurable is three
 * switches on the workspace, not the composition of a role — see
 * `permissions.ts`.
 *
 * A client is a role, not a separate product: the same account, the same
 * screens, a narrower answer from `can`.
 */
export const Role = z.enum(['owner', 'member'])

/** Which of the four a project has switched on. */
export const Tool = z.enum(['posts', 'tasks', 'files', 'messages'])

/**
 * What a new project can start from besides nothing.
 * Each is the five lists and a handful of first tasks on whoever made it;
 * leaving it out is a blank project.
 */
export const ProjectTemplate = z.enum(['launch', 'client', 'sprint'])

/**
 * Whether somebody is reachable — `docs/specs/presence.md`.
 *
 * Derived, never stored: `presence_of(seen_at, presence)` answers it from
 * when somebody was last active and which of the three they chose, so no
 * screen invents its own threshold. It is in the contract because every
 * client draws it, not because a column holds it.
 */
export const Presence = z.enum(['here', 'away', 'busy'])

/**
 * The five things the one create button offers.
 *
 * An event is a task with a start and an end, so there are five menu items and
 * four entities. This is the rule the design leans on hardest: a new feature is
 * a property of one of these, not a fifth.
 */
export const ObjectType = z.enum(['post', 'task', 'file', 'message'])

/**
 * The glyphs a project may wear.
 *
 * Sixteen offered, each something a project is about — a site, a launch, a
 * client, code, design, a goal. They were twelve of the product's own
 * glyphs once — a document, a list, a paper clip, a calendar — which said
 * what the product does and nothing about the project.
 *
 * The old twelve are still accepted, and drawn, for the projects that
 * chose one: refusing them would make a rename fail on a mark nobody
 * touched. They are no longer offered (`PROJECT_MARKS` in the web).
 *
 * Here rather than in the web, because the server has to refuse anything
 * else and the web has to offer only these. Two lists is two lists that
 * stop matching.
 */
export const MarkIcon = z.enum([
  'globe',
  'rocket',
  'briefcase',
  'code',
  'palette',
  'camera',
  'book',
  'chart',
  'target',
  'bolt',
  'star',
  'heart',
  'home',
  'bag',
  'leaf',
  'music',
  // No longer offered; kept for the projects that wear one.
  'flag',
  'spark',
  'board',
  'doc',
  'list',
  'cal',
  'folder',
  'bubble',
  'megaphone',
  'people',
  'clip',
])

/**
 * Which of the ten tints, by index.
 *
 * An index and not a hex: the tints turn over with the theme, and a project
 * that stored `#ff3b30` in June would be the one thing on the screen not
 * following the dark mode it is being looked at in.
 */
export const MarkTint = z.number().int().min(0).max(9)

/** How a request reached the server. */
export const Origin = z.enum(['web', 'macos', 'ios', 'android', 'mcp', 'system', 'import', 'github'])

export type MarkIcon = z.infer<typeof MarkIcon>
export type Role = z.infer<typeof Role>
export type Tool = z.infer<typeof Tool>
export type Presence = z.infer<typeof Presence>
export type ObjectType = z.infer<typeof ObjectType>
export type Origin = z.infer<typeof Origin>

/**
 * What a workspace's webhook can be sent. Each
 * is an action the feed records, sent from the same transaction that
 * records it. A webhook holding none of them is sent every event; one
 * holding some is sent only those.
 */
export const WEBHOOK_EVENTS = [
  'task.create',
  'task.update',
  'task.delete',
  'task.comment',
  'post.create',
  'post.update',
  'post.delete',
  'post.comment',
  'file.create',
  'file.upload',
  'file.update',
  'file.delete',
  /* Deleted for good from Recently Deleted. */
  'file.purge',
  'file.comment',
  /* A document published to the project. */
  'file.publish',
  /* Who a published document is for, changed. */
  'file.access',
  'project.create',
  'project.archive',
  'project.member.add',
  'time.log',
] as const
export const WebhookEvent = z.enum(WEBHOOK_EVENTS)
export type WebhookEvent = z.infer<typeof WebhookEvent>
