import { TASKS as W } from '../../words/tasks.js'
import { Avatar } from '../kit.jsx'
import { type List } from './model.jsx'

/**
 * The face of the agent a list gives its new tasks to, small, beside the
 * list's name — on the board's column and the list's band.
 * Nothing while the list names none, or
 * names one that has left the project: it gives nothing then, and its
 * settings say so.
 */
export function ListTaker({
  list,
  people,
  on,
}: {
  list: Pick<List, 'agent_id' | 'agent_gone'> | undefined
  people: { actor_id: string; name: string; avatar_url?: string | null }[]
  /** What is behind it, for the face's ring. */
  on?: string
}) {
  if (!list?.agent_id || list.agent_gone) return null
  const agent = people.find((p) => p.actor_id === list.agent_id)
  if (!agent) return null
  const said = W.takesHere(agent.name)
  return (
    <span data-list-taker={agent.actor_id} role="img" aria-label={said} title={said} className="flex shrink-0 items-center">
      <Avatar id={agent.actor_id} name={agent.name} url={agent.avatar_url} size={20} {...(on ? { on } : {})} />
    </span>
  )
}
