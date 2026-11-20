import { TASKS as W } from '../../words/tasks.js'
import { Icon } from '../glyphs.jsx'

/**
 * "Waiting on RED-12", on a row and a card while what the task waits on is
 * open. Quiet ink and a small hourglass, not
 * red: a task waiting on another is ordinary work, not an alarm. A finished
 * task carries none, its work being done already.
 */
export function waitingSaid(t: { waiting_on?: string[] | undefined; completed_at: string | null }): string | null {
  const on = t.waiting_on ?? []
  if (t.completed_at || on.length === 0) return null
  return on.length === 1 ? W.waitingOn(on[0]!) : W.waitingOnMore(on[0]!, on.length - 1)
}

export function Waiting({ said, size = 14 }: { said: string; size?: number }) {
  return (
    <span data-waiting className="flex min-w-0 items-center gap-1 whitespace-nowrap text-sm text-ink-3" title={said}>
      <Icon name="wait" size={size} />
      <span className="truncate">{said}</span>
    </span>
  )
}
