import { api } from './api.js'
import { TASK_DETAIL as W } from '../words/taskDetail.js'

/**
 * Where Triage sends a task. One answer for the
 * task's screen and the list's menu, so the two never disagree.
 */
type Placed = { id: string; finishes: boolean; icon: string; intake?: boolean }

/** Accepted: the first list after Triage that is not an ending. */
export const acceptInto = (lists: Placed[]) => lists.find((l) => !l.intake && !l.finishes)?.id ?? null

/**
 * Declined, or a duplicate: the project's Canceled — and a project with
 * none, made before it was a starting list or brought from elsewhere, is
 * given one the first time something is declined, rather than having
 * nowhere to say no to.
 */
export async function declineInto(projectId: string, lists: Placed[]): Promise<string | null> {
  const stop = lists.find((l) => l.finishes && l.icon === 'stopped') ?? lists.find((l) => l.finishes && l.icon !== 'done')
  if (stop) return stop.id
  const made = await api<{ id: string }>(`/projects/${projectId}/lists`, {
    method: 'POST',
    body: JSON.stringify({ name: W.triageCanceled, icon: 'stopped', finishes: true }),
  }).catch(() => null)
  return made?.id ?? null
}
