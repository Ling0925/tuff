import { useEffect, useRef, useState } from 'react'
import type { PersonInWorkspace, RoomHook } from '@tracker/shared-schema'
import { api, unlessOffline } from '../data/api.js'
import { offerUndo } from '../data/undo.js'
import { Icon } from './glyphs.jsx'
import { Avatar, Dialog, Hairline, Popover, Segments, notALogin, findField } from './kit.jsx'
import { roomName, type Room } from './Sidebar.jsx'
import { recall, remember } from '../data/memory.js'
import { MORE, PLACES, SAYS } from '../data/words.js'
import { CHANNELS as W } from '../words/channels.js'
import { RoomHooksWindow, hooksAhead, warmHooks } from './chat/roomHooks.jsx'
import { LeaveChannelDialog } from './Leaving.jsx'
import { SIDEBAR } from '../words/sidebar.js'

/**
 * Channels as Slack has them.
 *
 * One outside every project, made from the sidebar; and any channel's name
 * and people changed after it was made, from the room itself. A project's
 * channels are still made inside the project, by the plus on its Chat bar.
 */

/** Written the way the server stores it, so the field shows what will be kept. */
export const asChannelName = (raw: string) =>
  raw
    .replace(/^[\s#]+/, '')
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80)

/** Who could be in a room: the project's people, or the workspace's. */
const candidatesPath = (projectId: string | null) => (projectId ? `/projects/${projectId}/members` : '/people')

/**
 * Asked for ahead of the panel — on the pointer reaching the gear — and
 * kept, so the list is drawn whole the moment it opens rather than growing
 * under the hand.
 */
export function warmCandidates(projectId: string | null): Promise<PersonInWorkspace[]> {
  const path = candidatesPath(projectId)
  return api<{ members?: PersonInWorkspace[]; people?: PersonInWorkspace[] }>(path).then((r) =>
    remember(`candidates:${path}`, r.members ?? r.people ?? []),
  )
}

export function useCandidates(projectId: string | null, open: boolean, start: PersonInWorkspace[] = []) {
  const [people, setPeople] = useState<PersonInWorkspace[]>(
    () => recall<PersonInWorkspace[]>(`candidates:${candidatesPath(projectId)}`) ?? start,
  )
  useEffect(() => {
    if (!open) return
    void warmCandidates(projectId)
      .then(setPeople)
      .catch(unlessOffline(() => {}))
  }, [open, projectId])
  return people
}

export function PeoplePicker({
  people,
  picked,
  onPick,
  everyone,
  noneIs,
  locked,
  disabled = false,
  second,
}: {
  people: PersonInWorkspace[]
  picked: Set<string>
  onPick: (next: Set<string>) => void
  /** What every box ticked means here. */
  everyone: string
  /** What no box ticked means, where that is allowed. */
  noneIs?: string
  /** Somebody whose box cannot be unticked: whoever is editing the room. */
  locked?: string | undefined
  /** Drawn as it stands and not to be changed — a document open to its
      whole project shows everybody ticked. */
  disabled?: boolean
  /** A quieter line under somebody's name, where there is one to say —
      whose agent it is, in a document's list. */
  second?: ((p: PersonInWorkspace) => string | null) | undefined
}) {
  const every = people.length > 0 && people.every((p) => picked.has(p.actor_id))
  /*
   * Who is in it, first. In the order of the alphabet the four in a room of
   * eleven were wherever their names fell, and a list opened at E to J
   * looked like a room nobody was in. Sorted by who was in it when the list
   * arrived, and not again: a row that jumped to the top when its box was
   * ticked would move out from under the pointer that ticked it.
   */
  const inFirst = useRef<Set<string> | null>(null)
  if (!inFirst.current && people.length > 0) inFirst.current = new Set([...picked, ...(locked ? [locked] : [])])
  const was = inFirst.current
  const [typed, setTyped] = useState('')
  const q = typed.trim().toLowerCase()
  const ordered = (was ? [...people].sort((a, b) => Number(was.has(b.actor_id)) - Number(was.has(a.actor_id))) : people).filter(
    (p) => !q || p.name.toLowerCase().includes(q),
  )
  return (
    <>
      {/* Found by name once there are enough to hunt through — eleven
          people is already a scroll. */}
      {people.length > 7 && (
        <div className="px-4 pt-2">
          <input
            {...findField}
            data-testid="find-people"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={PLACES.findSomebody}
            className="h-8 w-full rounded-full px-3 text-base outline-none placeholder:text-[var(--ink-3)] bg-track"
            style={{ color: 'var(--ink)' }}
          />
        </div>
      )}

      <div className="flex items-center gap-2 px-4 pt-3 pb-1 text-base text-ink-2">
        <span className="min-w-px flex-1 truncate">
          {every
            ? everyone
            : picked.size === 0
              ? (noneIs ?? W.pickAtLeastOne)
              : W.pickedOf(people.filter((p) => picked.has(p.actor_id)).length, people.length)}
        </span>
        {/* All of them at once, and none — a list of forty boxes is not
            forty presses. */}
        {people.length > 1 && (
          <button
            type="button"
            data-testid="pick-all"
            onClick={() => onPick(every ? new Set() : new Set(people.map((p) => p.actor_id)))}
            /* Kept in its place when there is nothing to choose, so the
               row does not change height. */
            disabled={disabled}
            className={`shrink-0 text-sm font-medium text-accent ${disabled ? 'invisible' : ''}`}
          >
            {every ? W.clear : W.selectAll}
          </button>
        )}
      </div>
      <div className="max-h-[240px] overflow-y-auto pb-1">
        {ordered.map((p) => (
          <label
            key={p.actor_id}
            data-pick-member={p.actor_id}
            className={`flex items-center gap-3 px-4 py-2 ${disabled ? '' : 'cursor-pointer'}`}
          >
            <input
              type="checkbox"
              className="size-4 shrink-0"
              checked={picked.has(p.actor_id) || p.actor_id === locked}
              disabled={disabled || p.actor_id === locked}
              title={p.actor_id === locked ? W.notYourself : undefined}
              onChange={(e) => {
                const next = new Set(picked)
                if (e.target.checked) next.add(p.actor_id)
                else next.delete(p.actor_id)
                onPick(next)
              }}
            />
            <Avatar name={p.name} id={p.actor_id} url={p.avatar_url} size={24} />
            <PickedName name={p.name} under={second?.(p) ?? null} />
          </label>
        ))}
      </div>
    </>
  )
}

/** A name in the picker, and under it the quieter line when there is one. */
function PickedName({ name, under }: { name: string; under: string | null }) {
  if (!under) return <span className="flex-1 truncate text-base text-ink">{name}</span>
  return (
    <span className="flex min-w-px flex-1 flex-col">
      <span className="truncate text-base text-ink">{name}</span>
      <span data-pick-second className="truncate text-sm text-ink-3">
        {under}
      </span>
    </span>
  )
}

const primary = {
  background: 'var(--accent)',
  borderRadius: 'var(--r-pill)',
  color: 'var(--on-accent)',
} as const

/**
 * What the plus over Chat opens: a channel first, a direct message second.
 *
 * It was a native menu of people with "New channel…" squeezed in at its
 * head — two different things in one list, and the more common of them
 * (a channel, once a team has more than a few people) the easier to miss.
 * Tabs say there are two, and which one this is.
 */
export function NewChat({
  canChannel,
  people,
  onClose,
  onDirect,
  onMade,
}: {
  /** Whether a channel is this person's to open; without, only the second tab. */
  canChannel: boolean
  /** Everybody but the one asking. */
  people: PersonInWorkspace[]
  onClose: () => void
  onDirect: (actorId: string) => void
  onMade: (id: string) => Promise<void> | void
}) {
  const [tab, setTab] = useState<'channel' | 'direct'>(canChannel ? 'channel' : 'direct')
  const [name, setName] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const everybody = useCandidates(null, canChannel)
  const make = async () => {
    const n = asChannelName(name).replace(/-$/, '')
    if (!n || busy) return
    setBusy(true)
    try {
      const r = await api<{ id: string }>('/conversations/channels', {
        method: 'POST',
        body: JSON.stringify({ name: n, ...(picked.size ? { member_ids: [...picked] } : {}) }),
      })
      onClose()
      await onMade(r.id)
    } finally {
      setBusy(false)
    }
  }
  const found = q.trim() ? people.filter((p) => `${p.name} ${p.title ?? ''}`.toLowerCase().includes(q.trim().toLowerCase())) : people
  return (
    <Dialog
      title={W.newConversation}
      testId="new-chat"
      onClose={onClose}
      footer={
        tab === 'channel' ? (
          <div className="flex flex-1 items-center justify-end gap-2">
            <button onClick={onClose} className="h-8 px-3 text-base font-medium text-ink-2">
              {MORE.cancel}
            </button>
            <button
              data-testid="make-workspace-channel"
              disabled={!asChannelName(name).replace(/-$/, '') || busy}
              onClick={() => void make()}
              className="flex h-8 items-center px-4 text-base font-medium disabled:opacity-40"
              style={primary}
            >
              {MORE.create}
            </button>
          </div>
        ) : null
      }
    >
      <div className="flex flex-col">
        {/* Sixteen on every side of the switch: the title's row leaves four
            under itself, so twelve more above, and sixteen below. */}
        {canChannel && (
          <div className="px-4 pt-3 pb-4">
            <Segments
              fill
              items={[
                { key: 'channel' as const, label: W.channel, icon: 'hash', testId: 'new-chat-channel' },
                { key: 'direct' as const, label: W.directMessage, icon: 'bubble', testId: 'new-chat-direct' },
              ]}
              value={tab}
              onPick={setTab}
            />
          </div>
        )}
        {tab === 'channel' ? (
          <>
            <label className="flex items-center gap-2 px-4 py-3">
              <Icon name="hash" size={16} className="text-ink-3" />
              <input
                {...notALogin}
                autoFocus
                data-testid="draft-workspace-channel"
                className="min-w-px flex-1 bg-transparent text-base outline-none placeholder:text-[var(--ink-3)]"
                style={{ color: 'var(--ink)' }}
                placeholder={W.nameExample}
                value={name}
                onChange={(e) => setName(asChannelName(e.target.value))}
                onKeyDown={(e) => e.key === 'Enter' && void make()}
              />
            </label>
            <Hairline inset={16} />
            <PeoplePicker
              people={everybody}
              picked={picked}
              onPick={setPicked}
              everyone={W.everyoneInWorkspace}
              noneIs={W.everyoneInWorkspace}
            />
          </>
        ) : (
          <>
            <label className="flex items-center gap-2 px-4 py-3">
              <Icon name="search" size={16} className="text-ink-3" />
              <input
                {...findField}
                autoFocus
                data-testid="find-person"
                className="min-w-px flex-1 bg-transparent text-base outline-none placeholder:text-[var(--ink-3)]"
                style={{ color: 'var(--ink)' }}
                placeholder={W.whoToMessage}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && found[0]) onDirect(found[0].actor_id)
                }}
              />
            </label>
            <Hairline inset={16} />
            <div className="max-h-[320px] overflow-y-auto px-2 py-1">
              {found.map((p) => (
                <button
                  key={p.actor_id}
                  data-direct-to={p.name}
                  onClick={() => onDirect(p.actor_id)}
                  className="flex h-12 w-full items-center gap-3 rounded-[var(--r-row)] px-2 text-left mouse:hover:bg-[var(--hover)]"
                >
                  <Avatar name={p.name} id={p.actor_id} url={p.avatar_url} size={32} {...(p.presence ? { presence: p.presence } : {})} />
                  <span className="flex min-w-px flex-col">
                    <span className="truncate text-base font-medium text-ink">{p.name}</span>
                    {p.title && <span className="truncate text-xs text-ink-3">{p.title}</span>}
                  </span>
                </button>
              ))}
              {found.length === 0 && <p className="px-2 py-3 text-sm text-ink-3">{SAYS.nobodyByThatName}</p>}
            </div>
          </>
        )}
      </div>
    </Dialog>
  )
}

/**
 * A channel's name and people, from the room — and throwing it away.
 *
 * Behind one button beside the people row, for whoever may: the server says
 * per room in `can`, so nothing here works out a permission.
 */
export function RoomSettings({
  room,
  members,
  chosen,
  meId,
  onChanged,
  onDeleted,
  onLeft,
  round = false,
}: {
  room: Room
  /** Who is in it, as the row beside the gear already knows. */
  members: PersonInWorkspace[]
  /** Whether those people were chosen rather than being the whole project. */
  chosen: boolean
  /** Who is changing it — they cannot take themselves out. */
  meId?: string | undefined
  onChanged: () => Promise<void> | void
  onDeleted: () => Promise<void> | void
  /** Left from here, with the window that says what leaving does. */
  onLeft?: (() => Promise<void> | void) | undefined
  /** A round grey button, on a bar of them — a room's own bar. */
  round?: boolean
}) {
  const may = room.can ?? []
  /* Leaving is the room's own business, so it is in the room's settings
     rather than in the side column's menu, where it stood beside Hide —
     two ways to make a room go from the list, one of them for good. */
  const [quitting, setQuitting] = useState(false)
  /* The room's incoming webhooks, in a window of their own, opened with
     their list in hand. */
  const [hooks, setHooks] = useState<RoomHook[] | null>(null)
  if (may.length === 0) return null
  return (
    <span
      onPointerEnter={() => {
        if (may.includes('edit')) void warmCandidates(room.project_id).catch(() => {})
        if (may.includes('hooks')) void warmHooks(room.id).catch(() => {})
      }}
    >
      {hooks && <RoomHooksWindow roomId={room.id} roomSaid={`#${roomName(room)}`} first={hooks} onClose={() => setHooks(null)} />}
      {quitting && (
        <LeaveChannelDialog
          room={{ id: room.id, name: roomName(room), chosen: Boolean(room.chosen) || !room.project_id }}
          onClose={() => setQuitting(false)}
          onLeft={() => {
            setQuitting(false)
            void onLeft?.()
          }}
        />
      )}
      <Popover
        shape="bare"
        width={320}
        align="right"
        testId="room-settings"
        said={W.settingsFor(roomName(room))}
        label={
          <span
            data-control
            className={`flex items-center justify-center rounded-full ${round ? 'size-9' : 'size-8 mouse:hover:bg-[var(--hover)]'} text-ink-2`}
            style={{ ...(round ? { background: 'var(--track)' } : {}) }}
          >
            <Icon name="gear" size={16} />
          </span>
        }
      >
        {(close) => (
          <RoomSettingsBody
            room={room}
            members={members}
            chosen={chosen}
            meId={meId}
            close={close}
            onChanged={onChanged}
            onDeleted={onDeleted}
            onLeave={() => {
              close()
              setQuitting(true)
            }}
            onHooks={async () => {
              const first = await hooksAhead(room.id)
              close()
              setHooks(first)
            }}
          />
        )}
      </Popover>
    </span>
  )
}

function RoomSettingsBody({
  room,
  members,
  chosen,
  meId,
  close,
  onChanged,
  onDeleted,
  onLeave,
  onHooks,
}: {
  room: Room
  members: PersonInWorkspace[]
  chosen: boolean
  meId?: string | undefined
  close: () => void
  onChanged: () => Promise<void> | void
  onDeleted: () => Promise<void> | void
  onLeave: () => void
  onHooks: () => Promise<void>
}) {
  const may = room.can ?? []
  const [name, setName] = useState(room.name ?? '')
  /* Who is in it, ticked from the first frame — taken from the row the gear
     sits on rather than asked for again. A project's room nobody was chosen
     for is everyone on the project, so all of them are. */
  const [started] = useState(() => new Set(members.map((m) => m.actor_id)))
  const [picked, setPicked] = useState<Set<string> | null>(() => new Set(started))
  const [busy, setBusy] = useState(false)
  /* Deleting it, asked about first. */
  const [asking, setAsking] = useState(false)
  /* Until the full list is back, the people already in it stand for it:
     for a room that is the whole project they are the whole list. */
  const fetched = useCandidates(room.project_id, may.includes('edit'), members)
  const people = fetched.length ? fetched : members

  const save = async () => {
    if (busy) return
    setBusy(true)
    try {
      const n = asChannelName(name).replace(/-$/, '')
      if (n && n !== room.name) {
        await api(`/conversations/${room.id}`, { method: 'PATCH', body: JSON.stringify({ name: n }) })
      }
      const same = picked && picked.size === started.size && [...picked].every((x) => started.has(x))
      if (picked && picked.size > 0 && !same) {
        const ids = [...picked]
        // Every box on a project's room is the project — later joiners too.
        const toEveryone = Boolean(room.project_id) && people.length > 0 && people.every((p) => picked.has(p.actor_id))
        if (!toEveryone || chosen) {
          await api(`/conversations/${room.id}/members`, {
            method: 'PUT',
            body: JSON.stringify({ member_ids: toEveryone ? null : ids }),
          })
        }
      }
      close()
      await onChanged()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div data-room-settings className="flex flex-col">
      {may.includes('edit') && (
        <>
          <label className="flex items-center px-4 pt-4 pb-3">
            <Icon name="hash" size={16} className="text-ink-3" style={{ marginRight: 8 }} />
            {room.project_slug && <span className="shrink-0 text-base text-ink-3">{room.project_slug}-</span>}
            <input
              {...notALogin}
              data-testid="room-name"
              aria-label={W.channelName}
              className="min-w-px flex-1 bg-transparent text-base outline-none text-ink"
              value={name}
              onChange={(e) => setName(asChannelName(e.target.value))}
              onKeyDown={(e) => e.key === 'Enter' && void save()}
            />
          </label>
          <Hairline inset={16} />
          {picked && (
            <PeoplePicker
              people={people}
              picked={picked}
              onPick={(next) => setPicked(meId && started.has(meId) ? new Set([...next, meId]) : next)}
              everyone={room.project_id ? W.everyoneOnProject : W.everyoneInWorkspace}
              locked={meId && started.has(meId) ? meId : undefined}
            />
          )}
          <Hairline inset={16} />
        </>
      )}
      {may.includes('hooks') && (
        <>
          <button
            type="button"
            data-testid="room-hooks-open"
            onClick={() => void onHooks()}
            className="flex w-full items-center gap-3 px-4 text-left text-base text-ink mouse:hover:bg-[var(--hover)]"
            style={{ height: 'var(--row-h)' }}
          >
            <Icon name="link" size={16} className="text-ink-3" />
            <span className="flex-1">{W.hooks}</span>
            <Icon name="chevron" size={12} className="text-ink-3" />
          </button>
          <Hairline inset={16} />
        </>
      )}
      {asking && (
        /* A channel goes for everyone in it, with everything said there, so
           it is asked about first — what goes, in a sentence, and the red
           word is the second press. Undo follows it all the same, for the
           press made a moment too soon. */
        <div data-testid="delete-channel-ask" className="flex flex-col gap-3 px-4 py-3">
          <p className="m-0 text-base text-ink">{W.deleteChannelAsk(roomName(room))}</p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setAsking(false)}
              className="h-8 rounded-[var(--r-row)] px-3 text-base text-ink-2 mouse:hover:bg-[var(--hover)]"
            >
              {W.keep}
            </button>
            <button
              type="button"
              data-testid="delete-channel-confirm"
              onClick={async () => {
                close()
                const deleting = api(`/conversations/${room.id}`, { method: 'DELETE' })
                offerUndo(
                  W.channelDeleted(roomName(room)),
                  deleting,
                  () => api(`/conversations/${room.id}/restore`, { method: 'POST' }),
                  onChanged,
                )
                await deleting
                await onDeleted()
              }}
              className="h-8 rounded-[var(--r-row)] bg-danger px-3 text-base font-medium text-white"
            >
              {W.deleteChannel}
            </button>
          </div>
        </div>
      )}
      <div className={`flex items-center gap-2 px-4 py-3 ${asking ? 'hidden' : ''}`}>
        {may.includes('leave') && (
          <button data-testid="room-leave" className="h-8 text-base font-medium text-danger" onClick={onLeave}>
            {SIDEBAR.leaveChannel}
          </button>
        )}
        {may.includes('delete') && (
          <button data-testid="delete-channel" className="h-8 text-base font-medium text-danger" onClick={() => setAsking(true)}>
            {W.deleteChannel}
          </button>
        )}
        {may.includes('edit') && (
          <button
            data-testid="save-room"
            disabled={busy || picked?.size === 0}
            onClick={() => void save()}
            className="ml-auto flex h-8 items-center px-4 text-base font-medium disabled:opacity-40"
            style={primary}
          >
            {MORE.save}
          </button>
        )}
      </div>
    </div>
  )
}

const LEVELS: { id: 'all' | 'mentions' | 'none'; label: string; said: string }[] = [
  { id: 'all', label: W.allNew, said: W.allNewSaid },
  { id: 'mentions', label: W.mentionsOnly, said: W.mentionsOnlySaid },
  { id: 'none', label: W.nothing, said: W.nothingSaid },
]

/**
 * How loud this room is for you.
 *
 * Slack's three, behind a bell beside the room's name. Moves on the press;
 * the list is asked again after, which puts it back if the server refused.
 */
export function RoomNotify({
  room,
  onChanged,
  round = false,
}: {
  room: Room
  onChanged: () => Promise<void> | void
  /** A round grey button, on a bar of them — a room's own bar. */
  round?: boolean
}) {
  const [said, setSaid] = useState<Room['notify'] | null>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: what was said is about one room's setting, and goes when either changes
  useEffect(() => setSaid(null), [room.id, room.notify])
  const level = said ?? room.notify ?? 'all'
  return (
    <Popover
      shape="bare"
      width={280}
      align="right"
      testId="room-notify"
      said={W.notificationsFor(roomName(room))}
      label={
        <span
          data-control
          data-level={level}
          className={`flex items-center justify-center rounded-full ${round ? 'size-9' : 'size-8 mouse:hover:bg-[var(--hover)]'}`}
          style={{ color: level === 'all' ? 'var(--ink-2)' : 'var(--accent)', ...(round ? { background: 'var(--track)' } : {}) }}
        >
          <Icon name={level === 'none' ? 'bellOff' : 'bell'} size={16} />
        </span>
      }
    >
      {(close) => (
        <div role="radiogroup" aria-label={W.notifyMeAbout} className="flex flex-col p-2">
          {LEVELS.map((l) => (
            <button
              key={l.id}
              role="radio"
              aria-checked={l.id === level}
              data-notify={l.id}
              onClick={() => {
                close()
                setSaid(l.id)
                void api(`/conversations/${room.id}/notify`, {
                  method: 'PUT',
                  body: JSON.stringify({ notify: l.id }),
                })
                  .catch(() => setSaid(null))
                  .finally(() => void onChanged())
              }}
              className="flex items-start gap-3 rounded-[var(--r-row)] px-2 py-2 text-left mouse:hover:bg-[var(--hover)]"
            >
              <span className="flex size-4 shrink-0 items-center justify-center pt-1 text-accent">
                {l.id === level && <Icon name="check" size={14} />}
              </span>
              <span className="flex min-w-px flex-col gap-1">
                <span className="text-base font-medium text-ink">{l.label}</span>
                <span className="text-xs text-ink-3">{l.said}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </Popover>
  )
}
