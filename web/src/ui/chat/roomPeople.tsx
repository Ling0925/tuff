import { useContext, useState } from 'react'
import { PLACES, SAYS } from '../../data/words.js'
import { CHAT as W } from '../../words/chat.js'
import { type PersonInWorkspace } from '@tracker/shared-schema'
import { Icon, type IconName } from '../glyphs.jsx'
import { Avatar, Popover, findField } from '../kit.jsx'
import { PersonDoorsContext, personOf } from '../PersonCard.jsx'

/**
 * Who is in the room, and opened, who each of them is — `docs/specs/room-people.md`.
 *
 * The faces and the count were a statement with nothing behind it: four
 * people, and no way to learn which four without saying something and
 * seeing who answered. Pressed, it lists them — face, whether they are here,
 * what they do — and each row is a door: the name to their page, the bubble
 * to a conversation with them.
 */
export function RoomPeople({
  members,
  meId,
  said,
  face,
}: {
  members: PersonInWorkspace[]
  meId?: string | undefined
  said: string
  /** What the line shows in place of `said`, which stays its name. */
  face?: React.ReactNode
}) {
  const doors = useContext(PersonDoorsContext)
  const [q, setQ] = useState('')
  const faces = (
    <span className="flex min-w-px items-center gap-2">
      <span className="flex items-center -space-x-2">
        {members.slice(0, 6).map((m) => (
          /* A box of the face's own size: inline, it took the line's height,
             and a picture sat on the baseline in a ring stretched into an oval. */
          <span
            key={m.actor_id}
            className="flex size-6 shrink-0 items-center justify-center"
            style={{ boxShadow: '0 0 0 2px var(--canvas)', borderRadius: 9999 }}
          >
            <Avatar name={m.name} id={m.actor_id} url={m.avatar_url} size={24} />
          </span>
        ))}
      </span>
      <span className={`${face ? 'flex min-w-px' : 'truncate'} text-base text-ink-2`}>{face ?? said}</span>
    </span>
  )
  if (members.length === 0) return faces
  const shown = q.trim() ? members.filter((m) => `${m.name} ${m.title ?? ''}`.toLowerCase().includes(q.trim().toLowerCase())) : members
  return (
    <Popover shape="bare" width={320} testId="room-people" said={W.peopleInChat(said)} label={faces}>
      {(close) => (
        <div data-room-people className="flex max-h-[420px] flex-col">
          <div className="flex items-center gap-2 px-4 pt-4 pb-2">
            <span className="text-base font-medium text-ink">{W.people(members.length)}</span>
          </div>
          {members.length > 8 && (
            <div className="px-4 pb-2">
              <input
                {...findField}
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={PLACES.findSomebody}
                className="h-8 w-full rounded-[var(--r-row)] px-3 text-base outline-none bg-sunken text-ink"
              />
            </div>
          )}
          <div className="flex min-h-0 flex-col gap-1 overflow-y-auto px-2 pb-2">
            {shown.map((m) => {
              const self = m.actor_id === meId
              return (
                <div
                  key={m.actor_id}
                  data-room-person={m.name}
                  /* `shrink-0`: in a column that scrolls, a flex row gives up its
                     height to fit the list in, and fifteen people were
                     squeezed to the height of their faces. */
                  className="group flex h-12 shrink-0 items-center gap-2 rounded-[var(--r-row)] px-2 mouse:hover:bg-[var(--hover)]"
                >
                  <button
                    data-testid="room-person-open"
                    onPointerEnter={() => void personOf(m.actor_id)}
                    className="flex min-w-px flex-1 items-center gap-3 text-left"
                    onClick={() => {
                      close()
                      /* Their window, as their face in a message opens. */
                      if (doors?.show) doors.show(m.actor_id)
                      else doors?.open?.(m.actor_id)
                    }}
                  >
                    <Avatar name={m.name} id={m.actor_id} url={m.avatar_url} size={32} {...(m.presence ? { presence: m.presence } : {})} />
                    <span className="flex min-w-px flex-col">
                      <span className="truncate text-base font-medium text-ink">
                        {m.name}
                        {self && (
                          <span className="text-ink-3" style={{ fontWeight: 400 }}>
                            {W.youMark}
                          </span>
                        )}
                      </span>
                      {(m.title || m.role === 'owner') && <span className="truncate text-xs text-ink-3">{m.title || W.owner}</span>}
                    </span>
                  </button>
                  {!self && doors && (
                    <button
                      data-testid="room-person-message"
                      aria-label={W.messageTo(m.name)}
                      title={W.messageTo(m.name)}
                      onClick={() => {
                        close()
                        doors.message(m.actor_id)
                      }}
                      className="flex size-8 shrink-0 items-center justify-center rounded-full opacity-0 transition-opacity on-group-hover:opacity-100 focus-visible:opacity-100 mouse:hover:bg-[var(--hover)] text-ink-2"
                    >
                      <Icon name="bubble" size={16} />
                    </button>
                  )}
                </div>
              )
            })}
            {shown.length === 0 && <p className="px-2 py-3 text-sm text-ink-3">{SAYS.nobodyByThatName}</p>}
          </div>
        </div>
      )}
    </Popover>
  )
}

/* The first name and how many more — "Emily Brooks +1" — for a line of
   names a phone has no width for. The name gives way and the count never
   does, so a long first name ends in an ellipsis and the "+1" still shows.
   `after` is what follows the names (" · everyone on the project"), the
   first thing to go. */
export function FirstAndMore({ names, after = '' }: { names: string[]; after?: string }) {
  const more = names.length - 1
  return (
    <span data-first-and-more className="flex min-w-px items-baseline">
      <span className="truncate">{names[0]}</span>
      {more > 0 && <span className="shrink-0 whitespace-pre">{` ${W.moreNames(more)}`}</span>}
      {after && <span className="min-w-px truncate">{after}</span>}
    </span>
  )
}

/* A round grey face for an icon — the bar's buttons, as an open task's
   are (`RoundFace` in `TaskDetail.tsx`). */
export function Round({ icon }: { icon: IconName }) {
  return (
    <span data-control className="flex size-9 items-center justify-center rounded-full bg-track text-ink-2">
      <Icon name={icon} size={16} />
    </span>
  )
}
