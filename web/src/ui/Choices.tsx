import { useState } from 'react'
import type { QuestionChoice } from '@tracker/shared-schema'
import { api, Refused } from '../data/api.js'
import { COMMENTS as W } from '../words/comments.js'
import { Icon } from './glyphs.jsx'

/**
 * An agent's question, answered with one press.
 *
 * The choices in the order the agent gave them, the recommended one marked.
 * Pressed, the buttons give way at once to the answer in the same height,
 * and the server's answer replaces it in place; refused because somebody
 * was first, the line says their answer. Nobody to answer — no right to
 * comment here — sees the choices as they are, not as buttons.
 */
export function Choices({
  id,
  choices,
  answer,
  answeredBy,
  canAnswer,
  onAnswered,
  meName,
}: {
  /** The comment that asks. */
  id: string
  choices: readonly QuestionChoice[]
  answer: number | null | undefined
  answeredBy: string | null | undefined
  canAnswer: boolean
  /** Read again once the server has said. */
  onAnswered?: () => void | Promise<void>
  /** Who is pressing, said beside the answer before the server says it. */
  meName?: string
}) {
  /* What this press said, before the server has, or the answer that stands
     when it was refused because somebody was first. */
  const [picked, setPicked] = useState<{ answer: number; by: string | null } | null>(null)
  const [failed, setFailed] = useState(false)
  const shown = answer ?? picked?.answer ?? null
  const by = answer != null ? answeredBy : (picked?.by ?? null)

  async function press(i: number) {
    setFailed(false)
    setPicked({ answer: i, by: meName ?? null })
    try {
      await api(`/comments/${id}/answer`, { method: 'PUT', body: JSON.stringify({ choice: i }) })
      await onAnswered?.()
    } catch (e) {
      const stands = e instanceof Refused ? (e.said as { answer?: number; answered_by_name?: string } | undefined) : undefined
      if (stands && typeof stands.answer === 'number') {
        setPicked({ answer: stands.answer, by: stands.answered_by_name ?? null })
        await onAnswered?.()
      } else {
        setPicked(null)
        setFailed(true)
      }
    }
  }

  if (shown !== null) {
    return (
      <div data-answered className="flex min-h-8 items-center gap-2 text-sm text-ink-2">
        <Icon name="check" size={14} className="shrink-0 text-accent" />
        <span className="min-w-px break-words">
          <span className="text-ink">{W.answered(choices[shown]?.label ?? '')}</span>
          {by && <span className="text-ink-3"> · {by}</span>}
        </span>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-2">
      <div data-choices className="flex flex-wrap gap-2">
        {choices.map((c, i) =>
          canAnswer ? (
            <button
              key={i}
              type="button"
              data-choice={i}
              data-recommended={c.recommended || undefined}
              onClick={() => void press(i)}
              className="flex min-h-8 items-center gap-2 px-3 text-left text-sm text-ink mouse:hover:brightness-110"
              style={{
                borderRadius: 'var(--r-field)',
                background: c.recommended ? 'color-mix(in srgb, var(--accent) 16%, transparent)' : 'var(--hover)',
              }}
            >
              <span className="break-words">{c.label}</span>
              {c.recommended && <span className="shrink-0 text-xs text-accent">{W.recommended}</span>}
            </button>
          ) : (
            <span
              key={i}
              data-choice={i}
              className="flex min-h-8 items-center gap-2 px-3 text-sm text-ink-2"
              style={{ borderRadius: 'var(--r-field)', boxShadow: 'inset 0 0 0 1px var(--line)' }}
            >
              {c.label}
              {c.recommended && <span className="text-xs text-ink-3">{W.recommended}</span>}
            </span>
          ),
        )}
      </div>
      {failed && <span className="text-xs text-danger">{W.couldNotAnswer}</span>}
    </div>
  )
}
