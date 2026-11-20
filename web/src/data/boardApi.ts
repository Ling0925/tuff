import { keepApart } from './memory.js'
/**
 * The product's board, fed by a board's link.
 *
 * The board page draws the app's own board (`ui/Tasks.tsx`) and task panel,
 * which ask the app's routes as a signed-in person: `/projects/:id/tasks`,
 * `/tasks/:id` and the rest. On a board there is no person and no session,
 * so while the board page is open `api` asks the board's own routes instead
 * — `/api/board/app/…`, which answer in the same shapes — with the board's
 * secret as the credential. Anything a board does not have is refused here,
 * without a request: a board has no sprints, no hours, no history, no files
 * and no deleting.
 */
let board: { secret: string; projectId: string; name: string } | null = null

export function onBoard(secret: string, projectId: string, name = ''): void {
  board = { secret, projectId, name }
  /* Its answers kept apart from the app's — `data/memory.ts`. */
  keepApart(`board:${projectId}`)
}

/** The board as the one project there is, for the windows that name where a
    thing goes — the new-task window's head (`ui/New.tsx`). */
export function boardAsProjects(): { projects: { id: string; name: string }[]; next_cursor: null } | null {
  return board ? { projects: [{ id: board.projectId, name: board.name }], next_cursor: null } : null
}

export const boardSecret = (): string | null => board?.secret ?? null

/** Whether the screen is a board's page: the few things a board has none of
    — sub-tasks, copies, a prompt for an agent — are not offered there. */
export const onABoard = (): boolean => board !== null

/** Where the board answers what the app asked, or null for what a board does not have. */
export function boardPath(path: string, method: string): string | null {
  if (!board) return null
  const [bare] = path.split('?')
  const p = `/projects/${board.projectId}`
  const read = method === 'GET'
  if (bare === `${p}/tasks`) return read ? '/board/app/tasks' : method === 'POST' ? '/board/app/tasks' : null
  if (read && bare === `${p}/lists`) return '/board/app/lists'
  if (read && (bare === `${p}/members` || bare === '/people')) return '/board/app/members'
  if (read && bare === `${p}/labels`) return '/board/app/labels'
  if (read && bare === `${p}/cycles`) return '/board/app/cycles'
  const task = /^\/tasks\/([0-9a-f-]{36})$/i.exec(bare ?? '')
  if (task && (read || method === 'PATCH')) return `/board/app/task/${task[1]}`
  const comments = /^\/tasks\/([0-9a-f-]{36})\/comments$/i.exec(bare ?? '')
  if (comments && method === 'POST') return `/board/app/task/${comments[1]}/comments`
  return null
}

/* What was just made opens on the board, not at an address of the app's:
   the board's page is one address, and the task beside it is its state. */
let opener: ((taskId: string) => void) | null = null
export function boardOpens(fn: ((taskId: string) => void) | null): void {
  opener = fn
}
/** Opened on the board when there is one; false where the app opens it. */
export function openOnBoard(taskId: string): boolean {
  if (!board || !opener) return false
  opener(taskId)
  return true
}

/* What a board says about a picture it would not take — the board's page
   shows it, and past the tenth offers Save to Tuff. */
export type PictureRefusal = { why: 'type' | 'more' | 'refused'; message?: string | undefined }
let told: ((r: PictureRefusal) => void) | null = null
export function onPictureRefused(fn: ((r: PictureRefusal) => void) | null): void {
  told = fn
}
export function boardSays(why: PictureRefusal['why'], message?: string): void {
  told?.({ why, message })
}
