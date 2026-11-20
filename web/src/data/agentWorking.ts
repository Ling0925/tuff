import type { PersonInWorkspace } from '@tracker/shared-schema'

/**
 * Whether an agent is working on a task.
 *
 * Nothing says so in so many words; it is read off what the agent does: it
 * moved the task into progress, it is one of those the task is given to,
 * and it has been here lately — its last visit, or the task's last change,
 * within the hour. One that went quiet stops showing it by itself, and a
 * task moved on to review stops showing it at once.
 */
const LATELY = 60 * 60_000

export function workingAgent(
  task: { assignee_ids?: string[] | null; updated_at?: string | null },
  inProgress: boolean,
  people: PersonInWorkspace[],
  now = Date.now(),
): PersonInWorkspace | null {
  if (!inProgress) return null
  const changed = task.updated_at ? Date.parse(task.updated_at) : 0
  for (const id of task.assignee_ids ?? []) {
    const p = people.find((x) => x.actor_id === id)
    if (!p?.agent) continue
    const seen = Math.max(changed, p.active_at ? Date.parse(p.active_at) : 0)
    if (now - seen < LATELY) return p
  }
  return null
}

/** A list that means the work is under way — the ring drawn as begun. */
export const underWay = (icon: string | null | undefined) => icon === 'doing'

/**
 * Whether an agent is around to answer. An
 * agent that works from somebody's machine is not there while the machine
 * is off; said where it is mentioned or given a task, so nobody waits on an
 * answer that is not coming yet. `null` for a person, or an agent here
 * within the half hour; otherwise when it was last here, or `0` for never.
 */
const AROUND = 30 * 60_000
export function agentAway(p: PersonInWorkspace | undefined | null, now = Date.now()): Date | 0 | null {
  if (!p?.agent) return null
  if (!p.active_at) return 0
  const at = new Date(p.active_at)
  return now - at.getTime() < AROUND ? null : at
}

/** When, as the time today and the day before that. */
export function awaySince(at: Date, locale?: string): string {
  const today = new Date().toDateString() === at.toDateString()
  return today
    ? at.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
    : at.toLocaleDateString(locale, { day: 'numeric', month: 'short' })
}
