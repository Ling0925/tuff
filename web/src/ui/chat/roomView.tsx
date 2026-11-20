import { CHAT as W } from '../../words/chat.js'
import { PushOffer } from '../PushOffer.jsx'
import { SlackImport } from '../SlackImport.jsx'
import { EmptyState, Avatar } from '../kit.jsx'
import { ChatComposer } from '../ChatComposer.jsx'
import { sharedGif } from '../../data/gifs.js'
import { day, hand, dayLabel, clock, litLine } from './lines.jsx'
import { MessageRow, editLastIn } from './messageRow.jsx'
import { TypingLine } from './typing.jsx'
import { quoteOf } from './quote.js'
import { type Message } from './lines.jsx'
import { type ChatProps } from '../Chat.jsx'
import { type RoomHistory } from './useRoomHistory.js'
import { type RoomTools } from './useRoomTools.jsx'

/**
 * The open room: its history, the composer under it, and a thread beside it.
 */
export function roomView({
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
}: { meId: ChatProps['meId'] } & Pick<
  RoomHistory,
  | 'messages'
  | 'ready'
  | 'thread'
  | 'field'
  | 'members'
  | 'bottom'
  | 'sheet'
  | 'atBottom'
  | 'column'
  | 'pinning'
  | 'roomId'
  | 'load'
  | 'older'
  | 'typists'
  | 'working'
  | 'sayTyping'
> &
  Pick<
    RoomTools,
    | 'room'
    | 'newCount'
    | 'firstNew'
    | 'attach'
    | 'send'
    | 'openThread'
    | 'asked'
    | 'hits'
    | 'hitsNext'
    | 'moreHits'
    | 'reach'
    | 'react'
    | 'made'
    | 'canPromote'
    | 'promote'
    | 'edit'
    | 'remove'
    | 'mayDeleteSaid'
  >): React.ReactNode {
  return (
    room && (
      <>
        {/* The history is the work here, so it is a white sheet like a
              list or a document, and the composer sits below it on the
              page for why neither is glass. */}
        {/*
            Pushed down by a spacer, not by `justify-end`.
            
            A flex column that ends its children at the bottom puts the
            overflow out of the *top*, where there is no scrolling to it:
            `scrollHeight` only counts what is below, so the box reported
            itself as not overflowing and the wheel did nothing. Three
            hundred messages in a room and the last fifty were all anyone
            could reach — invisible on a fixture with five in it.
            
            An auto margin on an empty first child does the one thing
            `justify-end` was there for: it takes up the slack while the
            conversation is short, and resolves to nothing once it is long
            enough to scroll.
          */}
        <div className="relative flex min-h-0 flex-1 flex-col">
          <div
            ref={sheet}
            data-history
            onScroll={(e) => {
              const box = e.currentTarget
              /* A scroll this screen made is not the reader leaving: by the
                 time its event arrives a picture may have grown under it,
                 and reading the gap then said "not at the bottom" — which
                 stopped the room being held there, every other refresh. */
              if (pinning.current) return
              atBottom.current = box.scrollHeight - box.scrollTop - box.clientHeight < 120
              if (box.scrollTop < 400) void older()
            }}
            /* No sheet under the history at any width — the messages stand
               on the room itself, as Slack's do, rather than inside a card
               inside a card. It was dropped on a narrow window first; on a
               wide one the grey card left a field of empty grey over a short
               conversation, and history is content, which stays flat. */
            className="flex min-h-0 flex-1 flex-col gap-1 overflow-x-hidden overflow-y-auto py-2"
            style={{
              /* The browser's own scroll anchoring off. When a picture above
                 grew it moved the sheet to keep its anchor still, which
                 fired a scroll that said the reader had left the bottom —
                 so every other refresh opened 800 pixels up. Where the sheet
                 stands is decided here: at the bottom while the reader is,
                 and put back by hand when older pages arrive (`keep`). */
              overflowAnchor: 'none',
            }}
          >
            {/* The slack, while the conversation is shorter than the sheet. */}
            <div aria-hidden className="mt-auto" />
            {/* Everything said, in one box whose height is watched, so the
                room stays at its last message while pictures arrive. An
                empty room has nothing to sit at the foot of, so what it says
                stands in the middle of the sheet instead. */}
            <div ref={column} className={`flex shrink-0 flex-col gap-1 ${ready && messages.length === 0 ? 'mb-auto' : ''}`}>
              {ready && messages.length === 0 && (
                /* In the middle of the sheet: it sat at the foot, where the
                 last message would be, and an empty room read as a page
                 that had not finished drawing. */
                <EmptyState
                  art="talk"
                  title={W.noMessagesYet}
                  /* A team coming across has its history in Slack, and an empty
                   room is where it can be brought. */
                  action={roomId ? <SlackImport roomId={roomId} onDone={() => void load()} /> : undefined}
                >
                  {room?.project_id ? W.projectCanSee : (room?.channel ?? false) ? W.channelCanSee : W.conversationCanSee}
                </EmptyState>
              )}
              {/*
              A reply belongs to its thread, and the channel is not it.
              
              `load` already draws that line — `?thread=` asks for one and
              its absence asks for the top level — but a message drawn
              before it is sent has not been through `load`, so for as long
              as the request is in flight the list holds a row the server
              would not have given it.
              
              Written after a CI failure that looked like this and was not:
              the test passed here nine times, and holding the POST for a
              full second did not reproduce it either. So this closes a gap
              that is real in the code and that nothing has been seen to
              fall through — the window is the length of one request, and
              on a laptop that is fifteen milliseconds.
            */}
              {messages
                /* And a reply said in the room as well — one message, drawn
                   in both places: `docs/specs/chat-threads.md`. */
                .filter((m) => !m.parent_id || m.also_in_room)
                .map((m, i, top) => {
                  /* The one before it in the channel, not in the list a reply
                 still in flight sits in. */
                  const before = top[i - 1]
                  const newDay = day(before?.created_at) !== day(m.created_at)
                  /*
                   * A run of messages from one person in one minute is one thing
                   * somebody said, not four. Repeating the name and the time
                   * above each line turns a conversation into a table.
                   */
                  const opens = m.id === firstNew
                  const sameHand =
                    !newDay &&
                    // A run broken by the line is two runs: the message under it
                    // says who again, or the line reads as pointing at nothing.
                    !opens &&
                    hand(before) === hand(m) &&
                    Date.parse(m.created_at) - Date.parse(before?.created_at ?? '') < 5 * 60_000

                  return (
                    <div key={m.id} className="contents">
                      {opens && (
                        /*
                         * Where you left off, and how much is under it.
                         *
                         * A room opened to a count of twelve and then showed
                         * twelve the same as the four hundred above them: the
                         * number in the sidebar was the only place anybody was
                         * told how much they had missed, and it went the moment
                         * they arrived. The line is the answer, and it carries
                         * the number so the question is answered without
                         * counting rows.
                         *
                         * Drawn across the width, unlike the day — a day is a
                         * label on one conversation and this is a seam in it.
                         */
                        <div data-unread-line className="flex items-center gap-2 px-3 pt-1 pb-2 text-accent">
                          <span className="h-px flex-1" style={{ background: 'currentColor', opacity: 0.45 }} />
                          <span className="shrink-0 text-sm font-medium">{W.newMessages(newCount)}</span>
                          <span className="h-px w-6" style={{ background: 'currentColor', opacity: 0.45 }} />
                        </div>
                      )}
                      {newDay && (
                        /* A pill in the middle, not a rule across the width. A
                       line the full width of the room reads as a divider
                       between two conversations; the day is a label on one. */
                        <div className="flex items-start justify-center pb-2" data-day-break>
                          <span className="px-3 py-1 text-base bg-line text-ink-2" style={{ borderRadius: 'var(--r-field)' }}>
                            {dayLabel(m.created_at)}
                          </span>
                        </div>
                      )}
                      <MessageRow
                        m={m}
                        sameHand={sameHand}
                        meId={meId}
                        people={members}
                        /* A reply said here opens the thread it is in. */
                        onThread={() => (m.parent_id ? void reach(m) : openThread(m))}
                        threadOpen={thread === m.id}
                        onReact={react}
                        {...(canPromote ? { onPromote: promote } : {})}
                        made={made[m.id]}
                        /* A webhook's message, too, for whoever manages the
                           room's webhooks. */
                        mayDelete={mayDeleteSaid || (Boolean(m.hook_id) && Boolean(room.can?.includes('hooks')))}
                        projectId={room?.project_id ?? null}
                        roomId={roomId}
                        onEdit={edit}
                        onDelete={remove}
                        {...(roomId ? { onQuote: (q: Message) => field.current?.quote(quoteOf(q, roomId)) } : {})}
                      />
                    </div>
                  )
                })}
              <div ref={bottom} />
            </div>
          </div>
          {/*
            What was found, over the history rather than instead of it: the
            history keeps its place and its pages underneath, and is there
            again the moment the field is emptied. `docs/specs/find.md`.
          */}
          {asked && (
            <div
              data-found
              className="absolute inset-0 flex flex-col overflow-y-auto py-2 max-md:!bg-[var(--canvas)]"
              /* Opaque, and the colour of the sheet the room is on: it
                 covers the history without looking like a second card. */
              style={{ background: 'var(--chrome)' }}
            >
              {hits && hits.length === 0 && (
                <p data-testid="found-nothing" className="px-3 py-2 text-base text-ink-3">
                  {W.noMatch(asked)}
                </p>
              )}
              {hits && hits.length > 0 && (
                <div className="px-3 pt-1 pb-2 text-sm text-ink-3">{W.hitCount(hits.length, Boolean(hitsNext))}</div>
              )}
              {hits?.map((h) => (
                <button
                  key={h.id}
                  type="button"
                  data-found-row={h.id}
                  onClick={() => void reach(h)}
                  className="flex w-full shrink-0 items-start gap-3 rounded-[var(--r-row)] px-3 py-2 text-left mouse:hover:bg-[var(--hover)]"
                >
                  <Avatar
                    name={h.author_name ?? ''}
                    {...(h.author_id ? { id: h.author_id } : {})}
                    url={h.author_avatar_url ?? null}
                    size={24}
                  />
                  <span className="flex min-w-px flex-1 flex-col gap-1">
                    <span className="flex items-baseline gap-2 text-sm">
                      <span className="truncate font-medium text-ink">{h.author_name}</span>
                      <span className="shrink-0 text-ink-3">
                        {W.hitWhen(dayLabel(h.created_at), clock(h.created_at), Boolean(h.parent_id))}
                      </span>
                    </span>
                    <span className="line-clamp-3 text-base text-ink-2">{litLine(h.body, asked)}</span>
                  </span>
                </button>
              ))}
              {hitsNext && (
                <button
                  type="button"
                  data-control
                  onClick={() => void moreHits()}
                  className="mx-auto my-2 flex h-8 shrink-0 items-center px-3 text-base font-medium text-accent"
                  style={{ borderRadius: 'var(--r-pill)' }}
                >
                  {W.showMore}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Notifications offered, once, the first time a room is open.
              Standing on the line to write on, over
              the newest messages, and taking no height of its own. */}
        <div className="relative h-0">
          <PushOffer />
        </div>
        <div {...(room.others_gone ? {} : attach.drop)}>
          {/* Somebody removed from the workspace reads nothing written here,
                so there is no line to write on: the history stays —
                `docs/specs/removing-someone.md`. */}
          {room.others_gone ? (
            <div
              data-testid="room-gone"
              className="mx-[var(--gutter)] mb-3 flex min-h-[48px] items-center rounded-[var(--r-field)] px-4 text-base bg-sunken text-ink-2"
            >
              {W.noLongerHere(room.others ?? '')}
            </div>
          ) : (
            /* The clip in every room: a project's puts the file in its Docs,
               any other keeps it as the room's own. */
            <ChatComposer
              ref={field}
              key={roomId}
              placeholder={W.placeholder(room.name ?? '')}
              projectId={room.project_id ?? null}
              roomId={roomId}
              people={members.filter((p) => p.actor_id !== meId)}
              clip={attach.clip}
              tray={attach.strip}
              holding={attach.held.length > 0 || attach.uploading}
              dropping={attach.over}
              onSend={(doc, text) => void send(doc, text)}
              onGif={(g, q) => sharedGif(g.slug, q)}
              onPaste={(data) => attach.take(data)}
              onTyping={() => sayTyping(null)}
              onEditLast={() => editLastIn(sheet.current, () => field.current?.focus())}
            />
          )}
          {/* Who is writing, in a slot that is always there. */}
          <TypingLine typists={typists} thread={null} people={members} meId={meId} working={working} />
        </div>
        {/* The line to write on stands above a phone's tabs, which float
              over the foot of the screen. Nothing inside a room, where they
              step aside. */}
        <div aria-hidden className="shrink-0" style={{ height: 'var(--foot)' }} />
      </>
    )
  )
}
