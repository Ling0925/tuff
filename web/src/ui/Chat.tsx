import { SAYS } from '../data/words.js'
import { CHAT as W } from '../words/chat.js'
import { Icon } from './glyphs.jsx'
import { Avatar, Find, PageTitle, Segments, Toolbar } from './kit.jsx'
import { PersonFace } from './PersonCard.jsx'
import { RoomNotify, asChannelName } from './Channels.jsx'

import { roomCount, roomName, type Room as Conversation } from './Sidebar.jsx'
import { LABEL } from '../data/tools.js'
import { ThreadPane } from './chat/thread.jsx'
import { FirstAndMore, Round } from './chat/roomPeople.jsx'
import { roomView } from './chat/roomView.jsx'
import { useRoomTools } from './chat/useRoomTools.jsx'
import { useRoomHistory } from './chat/useRoomHistory.js'

/**
 * Chat around the work.
 *
 * A project has one channel by default; extra ones are made inside it and do
 * not live apart from it. A room for a few people is a different room on the
 * same project rather than the same room with a filter — a filter is
 * something somebody forgets, and the people left out never find out.
 */
export type ChatProps = {
  /**
   * A message to open the room at, from its address — found in search:
   * read back to it and lit, a reply in its thread.
   */
  at?: { id: string; thread: string | null } | undefined
  /** Who is reading, so the line counts what they have not said themselves. */
  meId?: string | undefined
  /** Inside a project: its rooms, with a switcher. */
  projectId?: string
  /** From the sidebar: one room, already chosen. */
  conversationId?: string
  /**
   * Every room this person is in, if the caller already has it.
   *
   * The sidebar fetches this list on every load of the app, and this screen
   * used to fetch it again — the same query, the slowest one in the product,
   * run twice to open one room. Given it, nothing is asked for.
   */
  all?: Conversation[] | undefined
  /* `channel.create` and `channel.delete` on this project. Both default to
     off: this screen is also reached from the sidebar, where there is no
     project to hold either, and a button that appears by default is a button
     somebody presses and is refused. */
  canMake?: boolean
  canDelete?: boolean
  /** `task.create` on this project, for Make a task on a message. */
  canMakeTask?: boolean
  /** `content.edit.said` here: deleting what somebody else said in a
      project's room — `docs/specs/message-edit.md`. */
  canDeleteSaid?: boolean
  /** A room renamed, its people changed or thrown away: the list that the
      sidebar draws is the caller's, so the caller asks again. */
  onRoomsChanged?: (() => Promise<void>) | undefined
  /** The room on screen was thrown away. */
  onRoomGone?: (() => void) | undefined
  /** A thread opened beside the room, or closed: the project's bar widens
      with the two of them — `docs/specs/chat-threads.md`. */
  onWide?: ((wide: boolean) => void) | undefined
  /** The room of this project the address names — `/:ws/:project/messages/:room`. */
  open?: string | undefined
  /**
   * The room on the screen changed: pressed (a step in the history), or
   * settled on because the address named none (`settle`, which replaces it).
   * The address is what the sidebar lights its row from.
   */
  onRoom?: ((id: string, how?: 'settle') => void) | undefined
  /** On a phone, where the app's bar steps aside in a room: back to the
      rooms, from the room's own head. */
  onBack?: (() => void) | undefined
  /** Beside the work: what ends the room's
      head in place of its own controls — Open in Chat and Close. */
  ends?: React.ReactNode
}

export function Chat({
  projectId,
  conversationId,
  all,
  meId,
  canMake = false,
  canDelete = false,
  canMakeTask = false,
  canDeleteSaid = false,
  onRoomsChanged,
  onRoomGone,
  onWide,
  open,
  onRoom,
  onBack,
  at,
  ends,
}: ChatProps) {
  const {
    setFetched,
    messages,
    setMessages,
    ready,
    listedSelf,
    thread,
    setThread,
    field,
    broad,
    phone,
    members,
    few,
    setMembersBeat,
    bottom,
    sheet,
    back,
    setBack,
    fetching,
    atBottom,
    keep,
    mark,
    column,
    pinning,
    rooms,
    roomId,
    setRoomId,
    readsAsked,
    readDrawn,
    heard,
    load,
    older,
    beat,
    setBeat,
    typists,
    working,
    sayTyping,
  } = useRoomHistory({ projectId, conversationId, all, meId, open, onRoom })
  const {
    room,
    alone,
    group,
    refreshRooms,
    newCount,
    firstNew,
    attach,
    send,
    head,
    shutThread,
    paneHead,
    openThread,
    words,
    setWords,
    asked,
    hits,
    hitsNext,
    moreHits,
    reach,
    frame,
    beside,
    react,
    made,
    canPromote,
    promote,
    edit,
    remove,
    mayDeleteSaid,
    newChannel,
    people,
    settings,
  } = useRoomTools({
    projectId,
    conversationId,
    meId,
    onRoomsChanged,
    onRoomGone,
    onWide,
    at,
    canMake,
    canDelete,
    canMakeTask,
    canDeleteSaid,
    setFetched,
    messages,
    setMessages,
    ready,
    thread,
    setThread,
    field,
    broad,
    phone,
    members,
    few,
    setMembersBeat,
    sheet,
    back,
    setBack,
    fetching,
    atBottom,
    keep,
    mark,
    pinning,
    rooms,
    roomId,
    setRoomId,
    readsAsked,
    readDrawn,
    heard,
    load,
    setBeat,
  })

  return (
    /*
     * A reading column down the middle of the screen.
     *
     * A line of chat is one sentence, and at 1200px a sentence runs the width
     * of the window and the eye loses the start of the next one. Centred
     * rather than left-aligned: a room is the only tool here that is read
     * rather than scanned, and a column of text with the whole window to one
     * side of it reads as a thing that failed to fill its space.
     */
    <div ref={frame} className={`thread-ease mx-auto flex h-full w-full ${head && beside ? 'max-w-[1184px]' : 'max-w-[800px]'}`}>
      {/* The room. Kept, not unmounted, while a thread is over it on a narrow
        screen — coming back is to where it was read to. */}
      <div className={`min-w-px flex-1 flex-col ${head && !beside ? 'hidden' : 'flex'}`}>
        {/*
        Which room, on the project's own bar beside the tabs.
        
        It was a row of chips under them, which is a second bar of chrome for
        a choice that is usually between two things. Up here it takes no
        height at all, and the room fills the screen.
      */}
        {/*
        The room's head, when it was opened from the sidebar: a channel's `#`
        and name, or the person a direct conversation is with — their face
        and their name, which open their card. And how loud the room is, at
        the end of the line.
      */}
        {conversationId && room && (
          /* One bar across the whole sheet, as an open task has: the room,
           who is in it, and its controls as round buttons at the end — on
           the bar `RoomBar` lays above the room (`App.tsx`), not in the
           reading column. `docs/specs/room-people.md`. */
          <Toolbar>
            {onBack && (
              <button
                type="button"
                aria-label={W.back}
                data-testid="room-back"
                onClick={onBack}
                className="flex shrink-0 transition-transform active:scale-[0.94]"
              >
                <Round icon="chevL" />
              </button>
            )}
            {alone ? (
              <PersonFace actorId={room.other_id ?? ''} name={room.others ?? ''} meId={meId}>
                <span data-dm-head className="flex min-w-px items-center gap-2 pl-2">
                  <Avatar
                    name={room.others ?? 'Direct'}
                    id={room.other_id ?? ''}
                    url={members.find((x) => x.actor_id === room.other_id)?.avatar_url ?? null}
                    size={28}
                    {...(room.other_presence ? { presence: room.other_presence } : {})}
                  />
                  <h1 className="truncate text-lg font-medium text-ink">{room.others}</h1>
                </span>
              </PersonFace>
            ) : (
              <h1 data-room-title className={`min-w-px pl-2 text-lg font-medium ${group && phone ? 'flex' : 'truncate'} text-ink`}>
                {(room.channel ?? Boolean(room.project_id)) && (
                  <Icon name="hash" size={16} className="text-ink-3" style={{ display: 'inline', marginRight: 4, verticalAlign: -2 }} />
                )}
                {/* A group's name is all of its people, and on a phone that
                  is the first of them and how many more. */}
                {group && phone ? <FirstAndMore names={(room.others ?? '').split(', ')} /> : roomName(room)}
              </h1>
            )}
            {people && !phone && <span className="ml-2 flex min-w-px items-center">{people}</span>}
            {/* The room's controls, round, at the end of its one head — the
              gear too on a phone, where it sat on the row of names under
              the head and the names ran under it. */}
            <span className="ml-auto flex shrink-0 items-center gap-2">
              {ends ?? (
                <>
                  <Find value={words} onChange={setWords} label={W.findInConversation} testId="find-room" />
                  <RoomNotify round room={room} onChanged={refreshRooms} />
                  {!alone && settings}
                </>
              )}
            </span>
          </Toolbar>
        )}

        <Toolbar>
          {/* The bar the tasks have: the name and a round plus beside it on
            the left, the rooms on the right — TRA-98. On a phone the name is
            the tab menu's, and the plus goes to the end of the row, where
            what it opens has room to open into.

            An extra room is made inside the project and does not live apart
            from it. A room for a few people is a different room on the same
            project rather than the same room with a filter. */}
          {!conversationId && (
            <span className="mr-auto flex shrink-0 items-center gap-3">
              <PageTitle>{LABEL.messages}</PageTitle>
              {broad && newChannel}
            </span>
          )}
          {/*
          Tabs and not a menu.
          
          A project has two or three rooms and they are read against each
          other — which one has something in it, which one you are in. A menu
          shows one at a time and hides that comparison behind a click.
        */}
          {!conversationId && rooms.length > 0 && (
            /* Shrinks and scrolls rather than spilling over the tab menu
             on a phone, where a third room is wider than the bar. */
            <div className="flex min-w-px overflow-x-auto [scrollbar-width:none]">
              <Segments
                /*
                 * Each room says what is waiting in it.
                 *
                 * The Chat tab counts every room of the project, so reading one
                 * of two rooms leaves a 1 on the tab with nothing under it
                 * saying where — which reads as a badge that did not clear. The
                 * strip is the only place that can answer it: the tab says
                 * there is something in Chat, and this says which room.
                 *
                 * The room being read is zero whatever the last fetch said, the
                 * same rule the sidebar goes by: nothing to undo if the server
                 * is slow and nothing to go stale if it never answers.
                 */
                items={rooms.map((r) => ({
                  key: r.id,
                  label: asChannelName(r.name ?? 'main'),
                  attrs: { 'data-room': asChannelName(r.name ?? 'main') },
                  count: r.id === roomId ? 0 : roomCount(r).count,
                }))}
                value={roomId ?? ''}
                onPick={(id) => {
                  setRoomId(id)
                  setThread(null)
                }}
              />
            </div>
          )}
          {!conversationId && room && <Find value={words} onChange={setWords} label={W.findInChannel} testId="find-room" />}
          {!broad && !conversationId && newChannel}
        </Toolbar>

        {/*
        Who is in the room, said out loud.
        
        It was never said anywhere: a channel for four people out of nine
        looked exactly like one for all nine, and the only way to find out was
        to say something in it and see who answered.
      */}
        {/*
        Drawn as soon as there is a room, filled when the names arrive.
        
        Behind `members.length > 0` it appeared a moment after the room did
        and pushed the whole conversation down thirty-six pixels — which is
        what "the chat jumps when it opens" was. A row that exists only once
        its contents do is a row that moves everything below it, and the eye
        is already reading by then. So it reserves its height and fills in.
      */}
        {room && !alone && (!conversationId || phone) && (
          <div className="flex h-6 shrink-0 items-center gap-2 pb-3 box-content max-md:px-2">
            {people}
            {/* Its name, its people, and throwing it away — for whoever the
              server says may. */}
            <span className="ml-auto flex shrink-0 items-center gap-1">
              {!conversationId && <RoomNotify room={room} onChanged={refreshRooms} />}
              {!conversationId && settings}
            </span>
          </div>
        )}

        {(all ? true : listedSelf) && !room && <p className="text-base text-ink-2">{SAYS.noChannelHere}</p>}

        {roomView({
          meId,
          messages,
          ready,
          thread,
          field,
          members,
          bottom,
          sheet,
          atBottom,
          column,
          pinning,
          roomId,
          load,
          older,
          room,
          newCount,
          firstNew,
          attach,
          send,
          openThread,
          asked,
          hits,
          hitsNext,
          moreHits,
          reach,
          react,
          made,
          canPromote,
          promote,
          edit,
          remove,
          mayDeleteSaid,
          typists,
          working,
          sayTyping,
        })}
      </div>
      {paneHead && room && roomId && (
        <Beside on={beside} shutting={!head}>
          <ThreadPane
            roomId={roomId}
            head={paneHead}
            roomName={room.name ?? room.others ?? ''}
            meId={meId}
            people={members}
            projectId={room.project_id ?? null}
            beat={beat}
            beside={beside}
            onClose={shutThread}
            onSent={() => void load()}
            onReact={react}
            onPromote={canPromote ? promote : undefined}
            made={made}
            mayDelete={mayDeleteSaid}
            onEdit={edit}
            onDelete={remove}
            typists={typists}
            working={working}
            onTyping={() => sayTyping(paneHead.id)}
            alsoTo={(room.channel ?? Boolean(room.project_id)) ? `#${roomName(room)}` : roomName(room)}
            onAlso={{
              put: (m) => setMessages((had) => [...had, m].sort((a, b) => a.created_at.localeCompare(b.created_at))),
              drop: (id) => setMessages((had) => had.filter((m) => m.id !== id)),
            }}
          />
        </Beside>
      )}
    </div>
  )
}

/*
 * The thread's room beside the room, opening from nothing as the frame
 * widens by the same amount over the same time — so the room itself keeps
 * its width the whole way and only the edges move. Over the room on a
 * narrow window it is simply there. `docs/specs/chat-threads.md`.
 */
function Beside({ on, shutting, children }: { on: boolean; shutting: boolean; children: React.ReactNode }) {
  if (!on) return shutting ? null : <>{children}</>
  return (
    /* The gap is a child and not padding: a box with padding cannot fold
       below its padding, so the pane stopped twenty-four pixels short of
       nothing and the room jumped that much when it went. */
    <div data-thread-shutting={shutting || undefined} className="thread-beside flex shrink-0 overflow-hidden">
      <div aria-hidden className="w-6 shrink-0" />
      {children}
    </div>
  )
}
