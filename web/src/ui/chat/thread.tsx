import { useState, useRef, useEffect, useCallback, useLayoutEffect } from 'react'
import { MORE } from '../../data/words.js'
import { CHAT as W } from '../../words/chat.js'
import { type AgentInRoom, type PersonInWorkspace } from '@tracker/shared-schema'
import { api, newId } from '../../data/api.js'
import { Icon } from '../glyphs.jsx'
import { useAttach } from '../kit.jsx'
/* One pair of these for the whole product. Chat had its own copy of both,
   which is exactly the drift `data/doc.ts` was written to stop — and the copy
   here could not have carried a file if one had arrived. */
import { asDoc } from '../../data/doc.js'
import { type ChatComposerHandle, ChatComposer } from '../ChatComposer.jsx'
import { sharedGif } from '../../data/gifs.js'
import { type Message, hand } from './lines.jsx'
import { MessageRow, editLastIn } from './messageRow.jsx'
import { readThread, knownThread } from './threadRead.js'
import { type Typist, TypingLine } from './typing.jsx'
import { quoteOf } from './quote.js'

/**
 * A thread, beside the room rather than instead of it — TRA-102,
 * `docs/specs/chat-threads.md`.
 *
 * The message it hangs off at the head, the replies under a line that
 * counts them, and a line of its own to write on. It owns its replies: the
 * room keeps loading its own top level while this is open, and a socket
 * word for the room is a beat here too.
 */
export function ThreadPane({
  roomId,
  head,
  roomName,
  meId,
  people,
  projectId,
  beat,
  beside,
  onClose,
  onSent,
  onReact,
  onPromote,
  made,
  mayDelete,
  onEdit,
  onDelete,
  typists = [],
  working = [],
  onTyping,
  onAlso,
  alsoTo,
}: {
  roomId: string
  head: Message
  roomName: string
  meId?: string | undefined
  people: PersonInWorkspace[]
  projectId: string | null
  beat: number
  /** Beside the room, or over it where there is no beside. */
  beside: boolean
  onClose: () => void
  onSent: () => void
  onReact: (m: Message, emoji: string, on: boolean) => void
  onPromote?: ((m: Message) => void) | undefined
  made: Record<string, string>
  mayDelete: boolean
  onEdit: (m: Message, body: { type: 'doc'; content: unknown[] }) => void
  onDelete: (m: Message) => void
  /** Who is typing in the room, heard on its socket. */
  typists?: Typist[]
  /** Agents at work in the room. */
  working?: AgentInRoom[]
  onTyping?: () => void
  /** A reply also said in the room, put up there at once — and taken
      down again if it did not go. */
  onAlso?: { put: (m: Message) => void; drop: (id: string) => void }
  /** What the box under the line names: the room as the column writes it. */
  alsoTo?: string
}) {
  /* Opened on the last answer — read ahead under the pointer, or last time. */
  const [replies, setReplies] = useState<Message[]>(() => knownThread(head.id) ?? [])
  /* A reply changed or taken back here moves here first; the room's own
     handler sends it and reloads the room. */
  const editHere = (m: Message, body: { type: 'doc'; content: unknown[] }) => {
    setReplies((had) => had.map((x) => (x.id === m.id ? { ...x, body, edited_at: new Date().toISOString() } : x)))
    onEdit(m, body)
  }
  const deleteHere = (m: Message) => {
    setReplies((had) => had.filter((x) => x.id !== m.id))
    onDelete(m)
  }
  const [ready, setReady] = useState(() => knownThread(head.id) !== null)
  const field = useRef<ChatComposerHandle>(null)
  const bottom = useRef<HTMLDivElement | null>(null)
  const attach = useAttach(`room:${roomId}`)

  /*
   * Escape shuts the thread, as the × does — the same rule a task keeps
   * (`TaskDetail.tsx`): anything laid over the page or the palette answers
   * first, and a field keeps what is being typed in it. Except this
   * thread's own line when it is empty — it has the hand from the moment
   * the thread opens, so Escape there is the way out rather than a press
   * that only lets go of the field. A list open under @ or # takes it
   * first. Asked in the capture phase, while what is open is still open.
   */
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (document.querySelector('[data-over],[data-testid="palette-input"],[role="dialog"],[data-mention-list],[data-task-list]')) return
      const it = document.activeElement
      const ownEmptyLine =
        it instanceof HTMLElement &&
        !!it.closest('[data-thread]') &&
        it.isContentEditable &&
        !it.closest('[data-message-editor]') &&
        (it.textContent ?? '').trim() === ''
      if (!ownEmptyLine && it instanceof HTMLElement && (it.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(it.tagName))) return
      if (ownEmptyLine) e.preventDefault()
      requestAnimationFrame(() => onClose())
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [onClose])

  const load = useCallback(async () => {
    const r = { messages: await readThread(roomId, head.id) }
    setReplies((had) => {
      /* The server's, and ours still on their way — a reply sent a moment
         ago that this answer was asked for before. */
      const inFlight = had.filter(
        (m) => !r.messages.some((n) => n.id === m.id) && m.author_id === meId && Date.now() - Date.parse(m.created_at) < 15_000,
      )
      return [...r.messages, ...inFlight].sort((a, b) => a.created_at.localeCompare(b.created_at))
    })
    setReady(true)
  }, [roomId, head.id, meId])

  /* Another thread starts on what was read of it, or empty. */
  useEffect(() => {
    setReplies(knownThread(head.id) ?? [])
    setReady(knownThread(head.id) !== null)
  }, [head.id])
  // biome-ignore lint/correctness/useExhaustiveDependencies: beat is the trigger: the thread is read again when the room hears something
  useEffect(() => void load().catch(() => {}), [load, beat])

  // biome-ignore lint/correctness/useExhaustiveDependencies: the newest reply is kept in view when one arrives
  useLayoutEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' })
  }, [replies.length])

  /* The hand goes to the thread's line, as it goes to a room's on arrival. */
  // biome-ignore lint/correctness/useExhaustiveDependencies: the hand goes to the line of each thread opened
  useEffect(() => {
    if (!matchMedia('(pointer: fine)').matches) return
    field.current?.focus({ preventScroll: true })
  }, [head.id])

  /* Also said in the room — `docs/specs/chat-threads.md`. Off again after
     each reply, as Slack keeps it. */
  const [also, setAlso] = useState(false)
  const alsoNow = useRef(false)
  alsoNow.current = also
  // biome-ignore lint/correctness/useExhaustiveDependencies: another thread starts with the box off
  useEffect(() => setAlso(false), [head.id])
  const send = useSend({
    roomId,
    parentId: head.id,
    people,
    meId,
    attach,
    setMessages: setReplies,
    field,
    also: alsoNow,
    onAlso: {
      put: (m) => {
        setAlso(false)
        onAlso?.put(m)
      },
      drop: (id) => onAlso?.drop(id),
    },
    onSent: () => {
      onSent()
      void load().catch(() => {})
    },
  })

  return (
    <div
      data-thread
      className={`flex min-h-0 min-w-px flex-col ${beside ? 'shrink-0' : 'flex-1'}`}
      /* Beside the room, the width the reader gave it — `threadWidth.ts`. */
      style={beside ? { width: 'var(--thread-w, 360px)' } : undefined}
    >
      {/* Clear of the line above it by what the room's own head stands
          off its bar's edge, sixteen, and drawn on a row as tall as the ×'s
          round so the two share one middle. The words start where the
          messages' faces do; the × keeps the pane's right edge, the edge
          the line to write in ends on. */}
      <div data-thread-head className={`flex h-8 shrink-0 items-center gap-2 pt-4 pb-2 box-content ${beside ? 'pl-3' : ''}`}>
        {beside ? (
          <>
            <span data-thread-title className="text-base font-medium text-ink">
              {W.thread}
            </span>
            <span className="min-w-px truncate text-base text-ink-3">{roomName}</span>
          </>
        ) : (
          /* Over the room, the whole head is the way back: the arrow, the
             word and the room's name are one press, with one ground under
             the pointer — the arrow alone was a sixteen-pixel target beside
             words that looked like they ought to do something and did not.
             Pulled out by its own padding so the arrow stays where it was. */
          <button
            type="button"
            data-testid="close-thread"
            aria-label={MORE.backToTheChannel}
            title={MORE.backToTheChannel}
            onClick={onClose}
            className="-ml-2 flex h-8 min-w-px items-center gap-2 rounded-full pr-3 pl-2 transition-colors mouse:hover:bg-[var(--hover)]"
          >
            <span className="flex size-6 shrink-0 items-center justify-center text-ink-2">
              <Icon name="chevL" size={16} />
            </span>
            <span data-thread-title className="shrink-0 text-base font-medium text-ink">
              {W.thread}
            </span>
            <span className="min-w-px truncate text-base text-ink-3">{roomName}</span>
          </button>
        )}
        {beside && (
          <button
            data-testid="close-thread"
            aria-label={W.closeThread}
            title={W.closeThread}
            onClick={onClose}
            className="ml-auto flex size-8 shrink-0 items-center justify-center rounded-full transition-colors mouse:hover:bg-[var(--hover)] text-ink-2"
          >
            <Icon name="close" size={16} />
          </button>
        )}
      </div>
      <div data-thread-history className="flex min-h-0 flex-1 flex-col gap-1 overflow-x-hidden overflow-y-auto py-2">
        <MessageRow
          m={head}
          sameHand={false}
          meId={meId}
          people={people}
          inThread
          onReact={onReact}
          {...(onPromote ? { onPromote } : {})}
          made={made[head.id]}
          mayDelete={mayDelete}
          projectId={projectId}
          roomId={roomId}
          onEdit={onEdit}
          onDelete={onDelete}
          onQuote={(q) => field.current?.quote(quoteOf(q, roomId))}
        />
        {/* How many, on a line across: what is above it is what they
            answer, and what is below is the answers. */}
        <div data-thread-count className="flex items-center gap-3 px-3 py-1 text-ink-3">
          <span className="shrink-0 text-sm">{ready || replies.length ? W.replies(replies.length) : ' '}</span>
          <span className="h-px flex-1 bg-line" />
        </div>
        {replies.map((m, i) => {
          const before = replies[i - 1]
          const sameHand = hand(before) === hand(m) && Date.parse(m.created_at) - Date.parse(before?.created_at ?? '') < 5 * 60_000
          return (
            <MessageRow
              key={m.id}
              m={m}
              sameHand={sameHand}
              meId={meId}
              people={people}
              inThread
              onReact={onReact}
              {...(onPromote ? { onPromote } : {})}
              made={made[m.id]}
              mayDelete={mayDelete}
              projectId={projectId}
              roomId={roomId}
              onEdit={editHere}
              onDelete={deleteHere}
              onQuote={(q) => field.current?.quote(quoteOf(q, roomId))}
            />
          )
        })}
        <div ref={bottom} />
      </div>
      <div {...attach.drop}>
        {/* Also said in the room, one message with a field on it — a row
            of its own above the field, where it is read before the reply is
            sent rather than after; always there, so ticking it moves nothing. */}
        <label data-also-in-room className="flex h-6 shrink-0 cursor-pointer items-center gap-2 px-4 pb-2 text-sm text-ink-2 box-content">
          <input
            type="checkbox"
            data-testid="also-in-room"
            checked={also}
            onChange={(e) => setAlso(e.target.checked)}
            className="size-4 shrink-0 cursor-pointer"
            style={{ accentColor: 'var(--accent)' }}
          />
          <span className="min-w-px truncate">{W.alsoSendTo(alsoTo ?? roomName)}</span>
        </label>
        <ChatComposer
          ref={field}
          key={head.id}
          placeholder={W.reply}
          projectId={projectId}
          roomId={roomId}
          people={people.filter((p) => p.actor_id !== meId)}
          clip={attach.clip}
          tray={attach.strip}
          holding={attach.held.length > 0 || attach.uploading}
          dropping={attach.over}
          onSend={(doc, text) => void send(doc, text)}
          onGif={(g, q) => sharedGif(g.slug, q)}
          onPaste={(data) => attach.take(data)}
          {...(onTyping ? { onTyping } : {})}
          onEditLast={() => editLastIn(bottom.current?.parentElement, () => field.current?.focus())}
        />
        <TypingLine typists={typists} thread={head.id} people={people} meId={meId} working={working} />
      </div>
      {/* Above a phone's tabs, as the room's own line is. */}
      <div aria-hidden className="shrink-0" style={{ height: 'var(--foot)' }} />
    </div>
  )
}

/** Messages this window has put on the screen and the server does not have
    yet, by id: a reply to one waits for it (`useSend`). */
export const sending = new Map<string, Promise<void>>()

/**
 * After the message's own send, when it is still on its way — and at once
 * otherwise. Everything done to a message waits on this: it is on the
 * screen, with its menu, before the server has it, and a task made from
 * one that quickly was refused as a message that does not exist.
 */
export const afterSent = (id: string): Promise<void> => sending.get(id) ?? Promise.resolve()

/**
 * The message goes up, and the request goes out behind it — the room's and
 * a thread's alike.
 *
 * The id is made here so the row drawn now and the row stored there are one
 * row: `load` merges by id, so the real one lands on top of this one instead
 * of beside it.
 */
export function useSend({
  roomId,
  parentId,
  people,
  meId,
  attach,
  setMessages,
  field,
  onSent,
  also,
  onAlso,
}: {
  roomId: string | null
  parentId: string | null
  people: PersonInWorkspace[]
  meId?: string | undefined
  attach: ReturnType<typeof useAttach>
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>
  field: React.RefObject<ChatComposerHandle | null>
  onSent?: () => void
  /** A reply said in the room too, read when it is sent. */
  also?: React.RefObject<boolean>
  onAlso?: { put: (m: Message) => void; drop: (id: string) => void }
}) {
  return async function send(written: { type: 'doc'; content: unknown[] }, text: string) {
    // Words, or a file, or both: a picture sent with nothing typed is a
    // thing somebody meant to send.
    const gif = written.content.some((n) => (n as { type?: string }).type === 'gif')
    if ((!text && !gif && attach.held.length === 0 && !attach.uploading) || !roomId) return
    const id = newId()
    /* Until it is the server's, a reply to it waits — below. From here,
       because a message held for its file is on its way too. */
    let landed = () => {}
    sending.set(id, new Promise<void>((done) => (landed = done)))
    const waiting = attach.uploading
    const held = attach.spend()
    /* What was written, formatting and mentions and all, with the held
       files after it as attachment nodes — the shape `asDoc` gives them. */
    let doc = { type: 'doc', content: [...written.content, ...asDoc('', held).content] }
    const mine = people.find((p) => p.actor_id === meId)
    const alsoInRoom = Boolean(parentId && also?.current)
    const drawn = {
      id,
      conversation_id: roomId,
      author_id: meId ?? '',
      author_name: mine?.name ?? '',
      author_avatar_url: mine?.avatar_url ?? null,
      parent_id: parentId,
      body: doc,
      origin: 'web',
      created_at: new Date().toISOString(),
      edited_at: null,
      ...(alsoInRoom ? { also_in_room: true } : {}),
      ...(waiting ? { uploading: true } : {}),
    } as Message
    setMessages((had) => [...had, drawn].sort((a, b) => a.created_at.localeCompare(b.created_at)))
    /* And in the room at once, when it is said there too. */
    if (alsoInRoom) onAlso?.put(drawn)
    /*
     * Sent while a file was still going up: the words are on the screen at
     * once, and the message leaves when the file is the project's — not
     * without it, which is what Enter did before.
     */
    if (waiting) {
      await attach.ready().catch((e: unknown) => {
        /* Its file never went up: nothing of it is coming, and a reply to
           it waits no longer. */
        sending.delete(id)
        landed()
        throw e
      })
      held.push(...attach.spend())
      doc = { type: 'doc', content: [...written.content, ...asDoc('', held).content] }
      setMessages((had) => had.map((m) => (m.id === id ? ({ ...m, body: doc, uploading: false } as Message) : m)))
    }
    try {
      /*
       * A reply to a message still on its way waits for it.
       *
       * The message is on the screen before the server has it, and so is
       * its Reply — so an answer typed quickly went out first and was
       * refused as "a message from another room": its parent did not exist
       * yet. Taken back out of the thread, which on a slow server was most
       * fast replies.
       */
      if (parentId) await afterSent(parentId)
      await api(`/conversations/${roomId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ id, body: doc, parent_id: parentId, ...(alsoInRoom ? { also_in_room: true } : {}) }),
      })
      onSent?.()
    } catch {
      /*
       * Taken back out, and what was written put back in the line.
       *
       * Not greyed out and not retried: a message that quietly did not send
       * is worse than one that visibly did not, and the draft is the thing
       * somebody actually wants back when the network drops.
       */
      setMessages((had) => had.filter((m) => m.id !== id))
      if (alsoInRoom) onAlso?.drop(id)
      field.current?.set(written)
      // And the picture that was on it: the bytes are uploaded already, so
      // this is the strip remembering them rather than another upload.
      attach.restore(held)
    } finally {
      sending.delete(id)
      landed()
    }
  }
}
