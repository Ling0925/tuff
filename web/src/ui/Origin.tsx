import { createContext, useContext } from 'react'
import { SAID } from '../words/said.js'

/**
 * Who in the workspace is an agent, by actor id — handed down from the
 * shell, which already holds the people, so a comment, a message or a line
 * of history can say so without each screen fetching them again.
 */
export const AgentIdsContext = createContext<ReadonlySet<string>>(new Set())

/**
 * Where something someone said or did came from, beside their name.
 *
 * A person must be able to tell their own words from the ones an AI agent
 * wrote for them with their token, which is *via AI agent*. An agent's own
 * words are marked *Agent* instead, as Slack puts APP beside an app: it came
 * through MCP too, and 'via' an agent under an agent's name said it twice.
 * GitHub is named, since that is the one source known by name.
 */
export function Origin({
  origin,
  authorId,
  lead = false,
}: {
  origin: string | null | undefined
  authorId: string | null | undefined
  /** A space before it, where it follows words in one run of text. */
  lead?: boolean
}) {
  const agents = useContext(AgentIdsContext)
  if (authorId && agents.has(authorId)) {
    return (
      <>
        {lead && ' '}
        <span
          data-origin="agent"
          className="inline-flex h-4 shrink-0 items-center rounded px-1 align-middle text-badge font-medium bg-track text-ink-2"
        >
          {SAID.agent}
        </span>
      </>
    )
  }
  const said = origin === 'mcp' ? SAID.viaAgent : origin === 'github' ? SAID.viaGithub : null
  if (!said) return null
  return (
    <span data-origin={origin} className="text-accent">
      {lead && ' '}
      {said}
    </span>
  )
}
