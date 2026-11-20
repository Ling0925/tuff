import { RIGHTS_SAID as W } from '../words/rights.js'

/**
 * The permissions, in the order a person reads them, and what to call them.
 *
 * One list because two screens set the same thing: the project's settings
 * change what somebody already holds, and an invite decides what they hold
 * when they arrive. Written twice they drift, and the drift is invisible —
 * both screens keep working, they just stop agreeing about what the tick
 * beside "delete tasks" means.
 *
 * The access spec has why these six and not a matrix.
 */
export const RIGHTS: readonly (readonly [string, string])[] = [
  ['task.create', W.createTasks],
  ['task.delete', W.deleteTasks],
  ['channel.create', W.createChannels],
  ['channel.delete', W.deleteChannels],
  ['edit.any', W.editOthers],
  /* Everything on the project's Settings — which is a tab nobody without
     it is shown. */
  ['manage', W.changeSettings],
]

/** What being added to a project means on its own, before anybody decides. */
export const ON_JOINING: readonly string[] = ['task.create', 'channel.create']

/* What a right's short name leaves out, said under the pointer. "Edit
   others' tasks" is what people reach for it for, and it is wider than
   that. */
export const RIGHT_HINT: Readonly<Record<string, string>> = {
  'edit.any': W.editOthersHint,
  'task.delete': W.deleteTasksHint,
}

/*
 * What an agent can hold on a project, and so all its row offers: making
 * tasks and changing anybody's. The server is what holds it — the ceiling
 * in `agent_rights_hold()` (`server/migrations/173_an_agent_is_a_participant.sql`)
 * cuts anything else off the row whoever writes it, and `AGENT_RIGHTS` in
 * `server/src/http/agents.ts` is what connecting gives. A chip for the
 * other four would tick and spring back.
 */
export const AGENT_RIGHTS: readonly string[] = ['task.create', 'edit.any']

/** The rights somebody's row offers: all six, or an agent's two. */
export const rightsFor = (agent: boolean | undefined): typeof RIGHTS => (agent ? RIGHTS.filter(([r]) => AGENT_RIGHTS.includes(r)) : RIGHTS)
