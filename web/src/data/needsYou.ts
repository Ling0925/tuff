import { useSyncExternalStore } from 'react'
import type { QuestionInInbox } from '@tracker/shared-schema'

/**
 * The inbox's Needs you: the open questions
 * asked of this person, as `GET /api/inbox` last answered them. Kept beside
 * the notes rather than in them: every read of the inbox sets both, and only
 * the panel reads this.
 */
export type Question = QuestionInInbox

let held: readonly Question[] | null = null
const told = new Set<() => void>()

export function setQuestions(list: readonly Question[] | null | undefined): void {
  held = list ?? []
  for (const f of told) f()
}

/** Answered here: gone from the list the next time the panel opens. */
export function dropQuestions(ids: ReadonlySet<string>): void {
  if (!held || ids.size === 0) return
  setQuestions(held.filter((q) => !ids.has(q.id)))
}

export function useQuestions(): readonly Question[] | null {
  return useSyncExternalStore(
    (f) => {
      told.add(f)
      return () => told.delete(f)
    },
    () => held,
  )
}
