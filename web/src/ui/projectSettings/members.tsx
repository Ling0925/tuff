import { useState } from 'react'
import { MAKE, PLACES, SAYS, MORE } from '../../data/words.js'
import { PROJECT_SETTINGS as W } from '../../words/projectSettings.js'
import { RIGHTS } from '../../data/rights.js'
import { Icon } from '../icons.jsx'
import { usePhone, Popover, Hairline, Fluid, Avatar, agentLabel, findField } from '../kit.jsx'
import { type Person, type Member } from '../ProjectSettings.jsx'
import { Rights } from './rights.jsx'

/**
 * One person on the project.
 *
 * A line, not a form: their face, their name, the owner said where they are
 * one, and what they may do here in a few words. Pressed, it opens their
 * permissions under it, one person at a time — six chips under every name
 * was a wall of grey in which on and off could hardly be told apart. The
 * permissions are the invitation's chips: on is the accent with a tick.
 */
/**
 * Somebody already in the workspace, put on the project — picked by face.
 *
 * It was the browser's own select: a column of names out of the operating
 * system, on the one screen about *who*, where every other place a person
 * is chosen — a task's assignee first — shows their face. The same menu
 * now, the people and then the agents that may come here, each with the
 * face they wear everywhere else, narrowed by typing once there are
 * enough to hunt through. On a phone it is a sheet, as every menu is.
 *
 * One pick and it shuts: the row taken would leave the list under the
 * pointer, and the next name would slide into the place just pressed.
 */
export function AddMember({ offered, onPick }: { offered: Person[]; onPick: (who: Person) => void }) {
  const phone = usePhone()
  const [typed, setTyped] = useState('')
  const q = typed.trim().toLowerCase()
  const rows = q ? offered.filter((p) => p.name.toLowerCase().includes(q)) : offered
  return (
    <Popover
      shape="bare"
      width={260}
      fit
      testId="add-member"
      onOpenChange={(open) => !open && setTyped('')}
      label={
        <span className="flex h-8 items-center gap-3 text-base font-medium text-accent">
          <Icon name="plusThin" size={14} />
          {W.addPeople}
        </span>
      }
    >
      {(close) => (
        <div data-add-menu data-menu role="menu" aria-label={MAKE.addSomebody} className="py-1">
          {/* Only once there are enough to hunt through, as the assignee's
              menu has it. Not focused on a phone: the keyboard would come
              up over the faces it is meant to help find. */}
          {offered.length > 7 && (
            <>
              <input
                {...findField}
                data-testid="add-member-search"
                autoFocus={!phone}
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                onKeyDown={(e) => {
                  /* Enter takes the only one left. */
                  if (e.key === 'Enter' && rows.length === 1 && rows[0]) {
                    e.preventDefault()
                    close()
                    onPick(rows[0])
                  }
                }}
                placeholder={PLACES.findSomebody}
                aria-label={PLACES.findSomebody}
                className="w-full bg-transparent px-4 py-2 text-base outline-none text-ink"
              />
              <Hairline inset={0} />
            </>
          )}
          <div className={`relative py-1 ${phone ? '' : 'max-h-[288px] overflow-y-auto'}`} data-fluid data-reads-down>
            <Fluid />
            {rows.map((p) => (
              <button
                key={p.actor_id}
                type="button"
                role="menuitem"
                data-row
                data-add-pick={p.actor_id}
                onClick={() => {
                  close()
                  onPick(p)
                }}
                className="flex w-full items-center gap-3 px-4 text-left text-base text-ink"
                style={{ height: 'var(--row-h)' }}
              >
                <Avatar id={p.actor_id} name={p.name} url={p.avatar_url} size={20} on="var(--surface)" />
                <span className="min-w-px flex-1 truncate">{p.name}</span>
                {/* An agent, said, as the assignee's menu says it. */}
                {p.agent && <span className="shrink-0 text-xs text-ink-3">{agentLabel(p)}</span>}
              </button>
            ))}
            {rows.length === 0 && <div className="px-4 py-2 text-base text-ink-3">{SAYS.nobodyByThatName}</div>}
          </div>
        </div>
      )}
    </Popover>
  )
}

export function MemberRow({
  m,
  projectId,
  open,
  onToggle,
  mayRestrict,
  mayRemove,
  onRemove,
  onDone,
}: {
  m: Member
  projectId: string
  open: boolean
  onToggle: () => void
  mayRestrict: boolean
  mayRemove: boolean
  onRemove: () => Promise<void>
  onDone: () => Promise<void>
}) {
  const held = m.rights ?? []
  const summary =
    m.role === 'owner' || held.includes('manage')
      ? W.everything
      : held.length === 0
        ? W.readOnly
        : RIGHTS.filter(([r]) => held.includes(r))
            .map(([, said]) => said)
            .join(', ')
  return (
    <div className="group flex flex-col">
      <div className="flex items-center gap-3 px-4 py-3">
        <Avatar name={m.name} id={m.actor_id} url={m.avatar_url} size={24} />
        {/* The name gives way last: the rights' summary is cut four
            times as fast, and on a phone, where Remove stands beside the
            name for want of a hover, it goes altogether — the chevron
            opens the rights themselves. */}
        <span className="min-w-px truncate text-base font-medium text-ink">{m.name}</span>
        {/* Only what sets somebody apart: with one owner and everybody
            else a member, "member" on every row said nothing. */}
        {m.role !== 'member' && <span className="shrink-0 text-sm text-ink-3">{m.role != null ? W.role(m.role) : W.noLongerAMember}</span>}
        {/* Beside the name it takes off, rather than adrift in the
            middle of the row: `RowActions` pushes itself to the far edge,
            and with the rights at that edge already it stopped halfway.
            Shown under the pointer, and always where there is none to
            show it — a finger has no hover to find it with. */}
        {mayRemove && (
          <button
            type="button"
            data-testid="remove-member"
            onClick={() => void onRemove()}
            className="shrink-0 rounded-[var(--r-row)] px-1 text-sm transition-opacity mouse:opacity-0 mouse:group-hover:opacity-100 group-focus-within:opacity-100 text-ink-3"
          >
            {MORE.remove}
          </button>
        )}
        {mayRestrict ? (
          <button
            type="button"
            data-testid="member-rights-toggle"
            aria-expanded={open}
            onClick={onToggle}
            /* Open, the summary has faded but keeps its width, so the row
               does not jump; the hover then lights only the chevron, not a
               wide empty pill where the words were. */
            className={`group/rights ml-auto flex max-w-[50%] min-w-px shrink-[4] items-center gap-2 rounded-[var(--r-row)] py-1 pr-1 pl-2 text-sm transition-colors text-ink-3 ${open ? '' : 'mouse:hover:bg-[var(--hover)]'}`}
          >
            {/* Open, the chips say it; the words would say it twice. */}
            <span
              className={`truncate transition-opacity duration-200 ${mayRemove ? 'max-sm:hidden' : ''}`}
              style={{ opacity: open ? 0 : 1 }}
            >
              {summary}
            </span>
            <span
              className={`flex size-5 shrink-0 items-center justify-center rounded-[var(--r-row)] transition-colors ${open ? 'mouse:group-hover/rights:bg-[var(--hover)]' : ''}`}
            >
              <Icon
                name="chevR"
                size={12}
                style={{ transform: open ? 'rotate(90deg)' : undefined, transition: 'transform 200ms var(--ease-out)' }}
              />
            </span>
          </button>
        ) : (
          <span className="ml-auto max-w-[50%] min-w-px shrink-[4] truncate text-sm text-ink-3">{summary}</span>
        )}
      </div>
      {mayRestrict && (
        <div
          aria-hidden={!open || undefined}
          {...(!open ? { inert: '' as unknown as boolean } : {})}
          className="grid transition-[grid-template-rows] duration-200 ease-[var(--ease-out)] motion-reduce:transition-none"
          style={{ gridTemplateRows: open ? '1fr' : '0fr' }}
        >
          <div className="min-h-0 overflow-hidden">
            <div
              className="flex flex-wrap gap-2 pr-4 pb-3 pl-13 transition-opacity duration-200 motion-reduce:transition-none"
              style={{ opacity: open ? 1 : 0 }}
            >
              <Rights who={m} projectId={projectId} onDone={onDone} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
