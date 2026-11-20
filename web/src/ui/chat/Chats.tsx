import { SAYS } from '../../data/words.js'
import { CHATS as W } from '../../words/chats.js'
import { CreateButton } from '../Create.jsx'
import { Icon } from '../glyphs.jsx'
import { Avatar, Empty, GroupLabel, Hairline, PageTitle, Panel } from '../kit.jsx'
import { roomCount, roomName, type Room } from '../Sidebar.jsx'

/**
 * Every room this person is in — project channels, channels outside every
 * project, direct and group conversations — on a page of its own at
 * `/:ws/chat`, the way the Projects screen is every project. Its heading in
 * the column is the way here, as Projects' is; on a phone it is the Chat
 * tab. At its foot, in a section of their own, the direct conversations
 * whose other people have left: kept to be read, opened read-only as they
 * always were, and no longer places in the list. `docs/specs/sidebar.md`,
 * "The Chats page".
 *
 * Drawn from the rooms the app already holds, so it opens whole: there is
 * nothing here the column did not already have.
 */
export function Chats({
  rooms,
  left,
  loaded,
  onOpen,
  onNew,
}: {
  /** The rooms the column lists, those put away under "more" included. */
  rooms: Room[]
  /** The direct conversations with people who left. */
  left: Room[]
  loaded: boolean
  onOpen: (id: string) => void
  onNew: () => void
}) {
  return (
    <div className="flex h-full flex-col">
      <div data-foot className="min-h-0 flex-1 overflow-y-auto px-[var(--gutter)] pt-5 pb-6" style={{ scrollbarGutter: 'stable' }}>
        <div data-chats-page className="mx-auto flex w-full max-w-[800px] flex-col gap-8">
          <PageTitle action={<CreateButton label={W.start} testId="chat-list-new" onClick={onNew} />}>{W.head}</PageTitle>
          {loaded && rooms.length === 0 && left.length === 0 && <Empty>{SAYS.noConversations}</Empty>}
          {rooms.length > 0 && (
            <Panel>
              {rooms.map((r, i) => (
                <div key={r.id} className="contents">
                  {i > 0 && <Hairline inset={60} />}
                  <ChatRow r={r} onOpen={onOpen} />
                </div>
              ))}
            </Panel>
          )}
          {left.length > 0 && (
            <section data-left-chats className="flex flex-col gap-2">
              <GroupLabel>
                {W.left} · {left.length}
              </GroupLabel>
              <p className="px-3 text-sm text-ink-3">{W.leftAbout}</p>
              <Panel>
                {left.map((r, i) => (
                  <div key={r.id} className="contents">
                    {i > 0 && <Hairline inset={60} />}
                    <ChatRow r={r} onOpen={onOpen} gone />
                  </div>
                ))}
              </Panel>
            </section>
          )}
        </div>
      </div>
    </div>
  )
}

/** One room: its face, its name, and what is waiting in it. */
function ChatRow({ r, onOpen, gone = false }: { r: Room; onOpen: (id: string) => void; gone?: boolean }) {
  const n = roomCount(r)
  const channel = r.channel ?? Boolean(r.project_id)
  return (
    <button
      data-row
      {...(gone ? { 'data-left-row': roomName(r) } : { 'data-chat-row': roomName(r) })}
      onClick={() => onOpen(r.id)}
      className="flex w-full items-center gap-3 px-4 text-left"
      style={{ minHeight: 56 }}
    >
      {channel ? (
        <span className="flex size-8 shrink-0 items-center justify-center text-ink-2">
          <Icon name="hash" size={18} />
        </span>
      ) : (
        /* Quieter for somebody who has gone, as an archived project's mark
           is on the Projects screen; and no presence, since they are not
           anywhere. */
        <span className={`flex shrink-0 ${gone ? 'opacity-60' : ''}`}>
          <Avatar
            name={r.others ?? W.direct}
            size={32}
            {...(r.other_id ? { id: r.other_id } : {})}
            url={r.other_avatar_url ?? null}
            {...(!gone && r.other_presence ? { presence: r.other_presence } : {})}
          />
        </span>
      )}
      <span
        className={`min-w-px flex-1 truncate text-base ${n.fresh && !gone ? 'font-semibold' : 'font-medium'}`}
        style={{ color: gone || r.notify === 'none' ? 'var(--ink-2)' : 'var(--ink)' }}
      >
        {roomName(r)}
      </span>
      {/* A turned-down room's unread, grey and lighter, as the column draws
          it. Nothing on a room with people
          who left: nothing in it asks anything of anybody. */}
      {!gone && (n.count > 0 || n.quiet > 0) && (
        <span
          data-quiet={n.count === 0 || undefined}
          className={`flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-2 text-xs tabular-nums ${n.count > 0 ? 'font-semibold' : 'font-medium'}`}
          style={{
            background: n.urgent ? 'var(--danger)' : 'var(--track)',
            color: n.urgent ? '#fff' : n.count > 0 ? 'var(--ink-2)' : 'var(--ink-3)',
          }}
        >
          {n.count || n.quiet}
        </span>
      )}
    </button>
  )
}
