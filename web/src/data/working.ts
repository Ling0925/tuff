import { useSyncExternalStore } from 'react'
import type { AgentStatus, PersonInWorkspace } from '@tracker/shared-schema'
import { api } from './api.js'

/**
 * What the agents say they are doing now.
 *
 * One list for the whole window, taken from `/api/people` when the shell
 * loads and read again from `/api/working` when a project's socket says one
 * changed. Drawn on the task's card, its row, its screen and the agent's
 * page, which all read it here rather than each asking.
 *
 * A clock in the window moves the minutes and takes a line away at its
 * `until` without asking the server: the server leaves out a status three
 * minutes after it was last said, and says when that is.
 *
 * Each drawing asks for its own task or agent and is drawn again only when
 * what it shows changed — a board of six hundred cards with one agent at
 * work redraws one card a minute, not six hundred.
 */
let held: AgentStatus[] = []
let live: AgentStatus[] = []
let clock = Date.now()
const heard = new Set<() => void>()
let ticking: ReturnType<typeof setInterval> | null = null

function tell(): void {
  clock = Date.now()
  live = held.filter((s) => Date.parse(s.until) > clock)
  for (const f of heard) f()
  tickOrNot()
}

/* A tick while anything is shown, and none while nothing is: an idle
   window does no work for this. Every fifteen seconds is often enough for
   minutes, and for a line to go within moments of its `until`. */
function tickOrNot(): void {
  if (live.length && heard.size && !ticking) ticking = setInterval(tell, 15_000)
  else if ((!live.length || !heard.size) && ticking) {
    clearInterval(ticking)
    ticking = null
  }
}

/** What the server said, as it said it. */
export function keepWorking(list: AgentStatus[]): void {
  held = list
  tell()
}

/** From the roster the shell already read: each agent's own status. */
export function workingFrom(people: PersonInWorkspace[]): void {
  keepWorking(people.flatMap((p) => (p.status ? [p.status] : [])))
}

/** Whether anything is shown now — worth asking again when a task changes. */
export const anyWorking = (): boolean => live.length > 0

/* One read for a flurry: a second word while one is on its way waits for it. */
let asking: Promise<void> | null = null
export function readWorking(): Promise<void> {
  asking ??= api<{ working: AgentStatus[] }>('/working')
    .then((r) => keepWorking(r.working))
    .catch(() => {})
    .finally(() => {
      asking = null
    })
  return asking
}

const subscribe = (f: () => void) => {
  heard.add(f)
  tickOrNot()
  return () => {
    heard.delete(f)
    tickOrNot()
  }
}

/** Whole minutes since it began on this task — one at least. */
export function minutesAt(status: AgentStatus, now: number): number {
  return Math.max(1, Math.floor((now - Date.parse(status.since)) / 60_000))
}

/* What a drawing shows of one status, as a string: equal strings draw the
   same, so nothing else is drawn again. */
const keyOf = (s: AgentStatus | undefined) => (s ? `${s.agent_id}|${s.task_id}|${s.doing}|${minutesAt(s, clock)}` : '')

/** The live status on one task, if an agent says it is at it. */
export function useWorkingOn(taskId: string | null | undefined): { status: AgentStatus | null; now: number } {
  useSyncExternalStore(subscribe, () => (taskId ? keyOf(live.find((x) => x.task_id === taskId)) : ''))
  return { status: (taskId && live.find((x) => x.task_id === taskId)) || null, now: clock }
}

/** One agent's live status, for its page. */
export function useWorkingOf(agentId: string | null | undefined): { status: AgentStatus | null; now: number } {
  useSyncExternalStore(subscribe, () => (agentId ? keyOf(live.find((x) => x.agent_id === agentId)) : ''))
  return { status: (agentId && live.find((x) => x.agent_id === agentId)) || null, now: clock }
}
