import { useState, type ComponentType } from 'react'
import { APP as W } from '../words/app.js'
import { AGENTS } from '../words/agents.js'
import { useConnect } from './Agents.jsx'
import { useInvite } from './InviteDialog.jsx'
import { Dialog, Segments } from './kit.jsx'
import { ACTS } from '../data/words.js'
import { edition } from '../edition.jsx'

type Project = Parameters<typeof useConnect>[0]['projects'][number] & Parameters<typeof useInvite>[0]['projects'][number]
type Tab = 'people' | 'agents'

/**
 * The plus at the head of Members.
 *
 * One window for bringing anybody in, with a tab for each way: inviting
 * people and connecting an agent. Each tab is there only for whoever may do
 * it, and with one there are no tabs — nobody chooses between one thing.
 *
 * Both forms are held at once and laid over each other, the one not chosen
 * kept out of sight and out of reach. That keeps what was typed on one
 * while the other is looked at, and it keeps the window one height: it is
 * as tall as the taller of the two from its first frame, so a tab changed
 * never moves its edge or its buttons.
 *
 * Where the edition holds agents back (`edition.agentsLocked`), the agents
 * tab is there all the same, holding what the edition says instead of the
 * form.
 */
export function AddMembers({
  projects,
  owner,
  mayInvite,
  mayConnect,
  locked,
  start,
  onClose,
  onInvited,
  onConnected,
}: {
  projects: Project[]
  owner: boolean
  mayInvite: boolean
  mayConnect: boolean
  /** Agents are held back here, by the edition's answer: the tab says
      what it says rather than connecting. */
  locked?: { to?: string }
  /** The tab it opens on, where both are there. People, unless said. */
  start?: Tab
  onClose: () => void
  onInvited: () => void
  onConnected: (agentId: string) => void
}) {
  const [tab, setTab] = useState<Tab>(mayInvite && start !== 'agents' ? 'people' : 'agents')
  const invite = useInvite({ projects, owner, onClose, onMade: onInvited, autoFocus: tab === 'people' })
  const connect = useConnect({
    projects: projects.filter((p) => !p.archived_at),
    onClose,
    onMade: onConnected,
  })
  const upsell = locked && edition.agentsLocked ? lockedFrame(locked, edition.agentsLocked.Body, onClose) : null
  const agents = upsell ?? connect
  const both = mayInvite && (mayConnect || !!upsell)
  const on = tab === 'people' ? invite : agents

  /* What it holds, once shown, is the window's whole business: the token
     is said once, and a tab beside it is a way to lose it. */
  if (!upsell && connect.made) {
    return (
      <Dialog title={connect.title} testId={connect.testId} onClose={onClose} footer={connect.footer}>
        {connect.body}
      </Dialog>
    )
  }
  if (!both) {
    return (
      <Dialog title={on.title} testId={on.testId} onClose={onClose} footer={on.footer}>
        {on.body}
      </Dialog>
    )
  }

  const layer = (t: Tab, node: React.ReactNode) => (
    <div
      data-add-layer={t}
      className="[grid-area:1/1] min-w-0"
      {...(t === tab ? {} : { inert: true, 'aria-hidden': true, style: { visibility: 'hidden' as const } })}
    >
      {node}
    </div>
  )
  return (
    <Dialog
      title={on.title}
      testId={on.testId}
      onClose={onClose}
      head={
        /* Pressed, not keyed in: the tabs move nothing but the chip. */
        <Segments
          items={[
            { key: 'people' as const, label: W.invitePeople, testId: 'add-tab-people' },
            { key: 'agents' as const, label: AGENTS.connect, testId: 'add-tab-agents' },
          ]}
          value={tab}
          onPick={setTab}
        />
      }
      footer={
        <div className="grid flex-1">
          {layer('people', <div className="flex">{invite.footer}</div>)}
          {layer('agents', <div className="flex">{agents.footer}</div>)}
        </div>
      }
    >
      <div data-add-members className="grid">
        {layer('people', invite.body)}
        {layer('agents', agents.body)}
      </div>
    </Dialog>
  )
}

/**
 * The agents tab where the edition holds agents back: what it says instead
 * of the form, in the window's own frame.
 */
function lockedFrame(locked: { to?: string }, Body: ComponentType<{ to?: string }>, onClose: () => void) {
  return {
    title: AGENTS.connect,
    testId: 'agents-paid-only',
    footer: (
      <div className="flex flex-1 items-center justify-end gap-2">
        <button onClick={onClose} className="h-8 px-3 text-base font-medium text-ink-2">
          {ACTS.close}
        </button>
      </div>
    ),
    body: <Body {...locked} />,
  }
}
