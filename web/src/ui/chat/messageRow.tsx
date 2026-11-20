import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { dayMonth } from '../../data/words.js'
import { CHAT as W } from '../../words/chat.js'
import { type PersonInWorkspace } from '@tracker/shared-schema'
import { format } from '../../data/route.js'
import { Icon } from '../glyphs.jsx'
import { usePhone, Popover, SHOWING, Avatar, useShown } from '../kit.jsx'
import { Doc, LinkHostsContext } from '../Doc.jsx'
import { EmojiPicker } from '../LazyEmojiPicker.jsx'
import { PersonFace } from '../PersonCard.jsx'
import { Origin } from '../Origin.jsx'
import { tasksIn, TaskCard } from '../TaskCard.jsx'
import { frequent } from '../../data/frequent.js'
import { type Message, gutterClock, clock } from './lines.jsx'
import { readThread } from './threadRead.js'
import { MessageEditor, MessageMenu } from './messageMenu.jsx'
import { isKey } from '../../data/keys.js'

/** The words of a body, every one of them — mentions as their names. */
export function wordsOf(body: unknown): string {
  const out: string[] = []
  const walk = (n: unknown) => {
    if (!n || typeof n !== 'object') return
    const node = n as { type?: string; text?: string; attrs?: { label?: string }; content?: unknown[] }
    if (node.type === 'text' && node.text) out.push(node.text)
    if (node.type === 'mention' && node.attrs?.label) out.push(`@${node.attrs.label}`)
    if (node.type === 'paragraph' || node.type === 'listItem' || node.type === 'codeBlock') out.push(' ')
    node.content?.forEach(walk)
  }
  walk(body)
  return out.join('').replace(/\s+/g, ' ').trim()
}

/*
 * Editing from the keyboard — `docs/specs/keyboard.md`, "Editing a message".
 *
 * Asked of the row on the screen, by an event on its own element, rather
 * than by an id handed down: the same message can be drawn in the room and
 * in its thread at once, and the one meant is the one the hand is in —
 * under the line being written in, or under the pointer.
 */
const EDIT = 'tracker:edit-message'
type EditAsk = { back?: () => void }

/** Opens one row for editing, if it may be edited. `back` is where the
    hand goes once it is saved or let go of. */
function askEdit(row: Element, back?: () => void): boolean {
  if (!row.hasAttribute('data-may-edit')) return false
  row.dispatchEvent(new CustomEvent<EditAsk>(EDIT, { detail: back ? { back } : {} }))
  ;(row as HTMLElement).scrollIntoView({ block: 'nearest' })
  return true
}

/** ↑ in an empty line: the last message you wrote in the list `box`
    holds opens for editing, as Slack's does. */
export function editLastIn(box: Element | null | undefined, back?: () => void): boolean {
  const mine = box?.querySelectorAll('[data-message][data-may-edit]')
  const last = mine?.[mine.length - 1]
  return last ? askEdit(last, back) : false
}

/*
 * E over a message: the one under the pointer, or the one the keyboard is
 * on. One listener for the page, held while any row that may be edited is
 * drawn — not one per row.
 */
let editKeyHolders = 0
const onEditKey = (e: KeyboardEvent) => {
  if (!isKey(e, 'e') || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || e.repeat || e.defaultPrevented) return
  const el = e.target as HTMLElement | null
  if (el?.isContentEditable) return
  if (el && ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return
  if (document.querySelector('[role="dialog"], [data-popover], [data-testid="palette-input"], [data-message][data-editing]')) return
  const focused = document.activeElement?.closest('[data-message]')
  const hovered = Array.from(document.querySelectorAll('[data-message]:hover')).pop()
  const row = focused ?? hovered
  if (row && askEdit(row)) e.preventDefault()
}
function holdEditKey(): () => void {
  if (editKeyHolders++ === 0) window.addEventListener('keydown', onEditKey)
  return () => {
    if (--editKeyHolders === 0) window.removeEventListener('keydown', onEditKey)
  }
}

/**
 * One thing somebody said, with what can be done to it.
 *
 * The room's and the thread's, drawn by one function — two copies of a
 * message is two places a reaction can be drawn differently.
 */
export function MessageRow({
  m,
  sameHand,
  meId,
  people,
  inThread = false,
  onThread,
  threadOpen = false,
  onReact,
  onPromote,
  made: madeHere,
  mayDelete = false,
  projectId = null,
  roomId = null,
  onEdit,
  onDelete,
  onQuote,
}: {
  m: Message
  sameHand: boolean
  meId?: string | undefined
  /** The room's people, for the names behind a reaction. */
  people: PersonInWorkspace[]
  /** Drawn inside a thread: no way into one, and no count of one. */
  inThread?: boolean
  onThread?: () => void
  /** Its thread is the one open beside the room — lit, so the eye can go
      between the two and find where the answer belongs. */
  threadOpen?: boolean
  onReact: (m: Message, emoji: string, on: boolean) => void
  /** Only for somebody who may make a task here. */
  onPromote?: (m: Message) => void
  /** The task this message became in this tab, before the room is read
      again and says so itself. */
  made?: string | undefined
  /** Somebody else's, for whoever may change what is said in this room. */
  mayDelete?: boolean
  /** The room's project, for files added while editing. */
  projectId?: string | null
  /** The room itself, for the same: a room's list does not say on each
      line whose room it is, and the editor read `m.conversation_id`,
      which was never sent. */
  roomId?: string | null
  onEdit?: (m: Message, body: { type: 'doc'; content: unknown[] }) => void
  onDelete?: (m: Message) => void
  /** Into the line it is answered in, as a quote — `docs/specs/chat-composer.md`. */
  onQuote?: (m: Message) => void
}) {
  /* The room's answer is everybody's and survives a reload; the one here is
     only the press that has just been made. */
  const made = madeHere ?? m.promoted_task_id ?? undefined
  /* Said for a moment beside the actions once its link is copied. */
  const [copied, setCopied] = useState<string | null>(null)
  const reactions = m.reactions ?? []
  const [editing, setEditing] = useState(false)
  const mine = Boolean(meId) && m.author_id === meId
  const canDelete = Boolean(onDelete) && (mine || mayDelete)
  /*
   * A phone has no pointer to hover with, so the card of actions beside a
   * message never stood up there. A held finger opens them as a sheet
   * instead, as Slack, Telegram and Messages do.
   */
  const phone = usePhone()
  const [acting, setActing] = useState(false)
  /* Its words, chosen from the sheet: a phone's long press is the sheet's,
     so selecting is asked for rather than started by the same gesture. */
  const [selecting, setSelecting] = useState(false)
  const said = useRef<HTMLDivElement>(null)
  const hold = useHold(() => setActing(true), phone && !editing && !m.deleted && !selecting)
  const row = useRef<HTMLDivElement>(null)
  /* Opened for editing from the keyboard, and where the hand goes after. */
  const mayEdit = mine && Boolean(onEdit) && !m.deleted
  const back = useRef<(() => void) | undefined>(undefined)
  useEffect(() => {
    const el = row.current
    if (!mayEdit || !el) return
    const ask = (e: Event) => {
      back.current = (e as CustomEvent<EditAsk>).detail?.back
      setEditing(true)
    }
    el.addEventListener(EDIT, ask)
    const letGo = holdEditKey()
    return () => {
      el.removeEventListener(EDIT, ask)
      letGo()
    }
  }, [mayEdit])
  const doneEditing = () => {
    setEditing(false)
    const to = back.current
    back.current = undefined
    to?.()
  }
  /* How far it is lifted to stand above its sheet, in pixels (negative). */
  const [lift, setLift] = useState(0)
  useEffect(() => {
    if (!acting) return setLift(0)
    let frame = 0
    let tries = 0
    const place = () => {
      const el = row.current
      /* The sheet is placed a frame after it is asked for; its height is
         its own whatever transform it is arriving with. */
      const sheet = document.querySelector('[data-message-sheet]')?.closest('[data-popover]') as HTMLElement | null
      if (!el || !sheet) {
        if (tries++ < 6) frame = requestAnimationFrame(place)
        return
      }
      const top = window.innerHeight - sheet.offsetHeight - 8
      const r = el.getBoundingClientRect()
      if (r.bottom <= top) return
      /* Never above the top of what it scrolls in: a message taller than
         the room left over keeps its head in view and lets the sheet have
         its foot. */
      let floor = 0
      for (let p = el.parentElement; p; p = p.parentElement) {
        const o = getComputedStyle(p).overflowY
        if (o === 'auto' || o === 'scroll') {
          floor = p.getBoundingClientRect().top
          break
        }
      }
      setLift(Math.min(0, Math.max(top - r.bottom, floor - r.top)))
    }
    frame = requestAnimationFrame(place)
    return () => cancelAnimationFrame(frame)
  }, [acting])
  useEffect(() => {
    if (!selecting) return
    /* Selected whole, so the handles are there to narrow it, and given back
       to the sheet once the selection has gone. */
    const el = said.current
    const sel = getSelection()
    if (el && sel) {
      const r = document.createRange()
      r.selectNodeContents(el)
      sel.removeAllRanges()
      sel.addRange(r)
    }
    const gone = () => {
      const now = getSelection()
      if (!now || now.isCollapsed || !el?.contains(now.anchorNode)) setSelecting(false)
    }
    document.addEventListener('selectionchange', gone)
    return () => document.removeEventListener('selectionchange', gone)
  }, [selecting])

  /* Deleted with answers under it: a line that says so and nothing of what
     it said, so the thread still hangs off something. */
  if (m.deleted) {
    return (
      <div
        data-message
        data-message-id={m.id}
        data-deleted
        data-thread-open={threadOpen || undefined}
        className="flex gap-3 px-3 py-2"
        style={{ borderRadius: 12, background: threadOpen ? 'var(--accent-soft)' : undefined }}
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-line text-ink-3">
          <Icon name="trash" size={14} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="pt-1 text-base italic text-ink-3">{W.wasDeleted}</span>
          {Number(m.replies) > 0 && !inThread && onThread && <Replies m={m} onThread={onThread} roomId={roomId} />}
        </div>
      </div>
    )
  }
  /* "You", "Sam and You", "Robin, Sam and 3 others" — who, said as a
     sentence and not as a list. */
  const named = (ids: string[]) => {
    const names = ids.map((id, i) =>
      id === meId ? (i === 0 ? W.you : W.youAfter) : (people.find((p) => p.actor_id === id)?.name ?? W.someone),
    )
    if (names.length <= 1) return names[0] ?? ''
    if (names.length <= 3) return W.andLast(names.slice(0, -1).join(', '), names[names.length - 1]!)
    return W.andOthers(names.slice(0, 2).join(', '), names.length - 2)
  }
  const face = (testId: string, small: boolean) => (
    <Popover
      shape="bare"
      width={344}
      sheet={false}
      testId={testId}
      said={W.addReaction}
      label={
        <span
          data-control
          className={`flex items-center justify-center transition-colors mouse:hover:bg-[var(--hover)] ${
            small ? 'h-6 w-8 rounded-full' : 'size-7 rounded-[var(--r-row)]'
          } text-ink-2`}
          style={{ background: small ? 'var(--line)' : undefined }}
        >
          <Icon name="smile" size={small ? 14 : 16} />
        </span>
      }
    >
      {(close) => (
        <EmojiPicker
          onPick={(e) => {
            close()
            const mine = reactions.find((r) => r.emoji === e)?.actors.includes(meId ?? '')
            onReact(m, e, !mine)
          }}
        />
      )}
    </Popover>
  )
  /* One press on a quick reaction: on if it is not yours yet, off if it is. */
  const quick = (e: string) => onReact(m, e, !reactions.find((r) => r.emoji === e)?.actors.includes(meId ?? ''))
  const hasMenu = Boolean(roomId || onQuote || (mine && onEdit) || canDelete || (onPromote && !made))
  /*
   * What the ⋯ menu offers. A phone's sheet offers the same through these
   * same handlers: two lists of what can be done to a message are two
   * places to disagree about what is allowed.
   */
  const actions = (close: () => void) => ({
    ...(roomId
      ? {
          onCopyLink: () => {
            close()
            const at = format({ view: 'chat', roomId, messageId: m.id, ...(m.parent_id ? { threadId: m.parent_id } : {}) })
            void navigator.clipboard
              .writeText(`${location.origin}${at}`)
              .then(() => setCopied(W.linkCopied))
              .catch(() => setCopied(W.couldNotCopy))
              .finally(() => setTimeout(() => setCopied(null), 1800))
          },
        }
      : {}),
    ...(onQuote
      ? {
          onQuote: () => {
            close()
            onQuote(m)
          },
        }
      : {}),
    canEdit: mine && Boolean(onEdit),
    canDelete,
    ...(onPromote && !made
      ? {
          onPromote: () => {
            close()
            onPromote(m)
          },
        }
      : {}),
    onEdit: () => {
      close()
      back.current = undefined
      setEditing(true)
    },
    onDelete: () => {
      close()
      onDelete?.(m)
    },
  })

  return (
    <div
      data-message
      data-message-id={m.id}
      data-editing={editing || undefined}
      data-may-edit={mayEdit || undefined}
      data-thread-open={threadOpen || undefined}
      data-held={acting || undefined}
      data-selecting={selecting || undefined}
      ref={row}
      {...hold}
      /* Not lit under the pointer while it is being rewritten: the line in
         it is the same grey as the light, and it vanished into it. Nor while
         its thread is open: that light is its own, and holds. */
      className={`group relative flex gap-3 px-3 py-2 max-md:px-2 ${editing || threadOpen ? '' : 'hover:bg-[var(--line)]'}`}
      style={{
        borderRadius: 12,
        /* Held, it stands up off the room for as long as its sheet is open,
           so it is plain which message the actions are about. */
        background: acting ? 'var(--surface)' : threadOpen ? 'var(--accent-soft)' : undefined,
        boxShadow: acting ? 'var(--card-shadow)' : undefined,
        ...(phone
          ? {
              /* And it rises clear of the sheet, with it and on its curve —
                 the newest message is the one most often held, and it sits
                 exactly where the sheet arrives. */
              transform: lift ? `translateY(${lift}px)` : undefined,
              transition: `background-color 150ms ease, box-shadow 150ms ease, transform ${SHOWING}ms var(--ease-out)`,
              zIndex: acting ? 1 : undefined,
            }
          : {}),
      }}
    >
      {sameHand ? (
        // The time sits where the avatar would be, and only under the
        // pointer: it is there when wanted and not in the way when it is not.
        <span className="w-8 shrink-0 pt-px text-right text-sm whitespace-nowrap tabular-nums opacity-0 on-group-hover:opacity-100 text-ink-3">
          {gutterClock(m.created_at)}
        </span>
      ) : /* Their card, on their face and their name — `docs/specs/person-card.md`.
           Somebody brought across from Slack has no card here: initials,
           and the name they were said under. */
      m.author_id ? (
        <PersonFace actorId={m.author_id} name={m.author_name} meId={meId}>
          <Avatar name={m.author_name} id={m.author_id} url={m.author_avatar_url} size={32} />
        </PersonFace>
      ) : (
        <Avatar name={m.author_name} size={32} />
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {!sameHand && (
          <div className="flex items-center gap-2 text-base">
            {m.author_id ? (
              <PersonFace actorId={m.author_id} name={m.author_name} meId={meId}>
                <span className="font-medium mouse:hover:underline text-ink">{m.author_name}</span>
              </PersonFace>
            ) : (
              <span className="font-medium text-ink">{m.author_name}</span>
            )}
            {/* Every line brought across says so, its own author's too: a
                face is not proof somebody said it here. */}
            {(m.said_as || m.origin === 'import') && !m.hook_id && (
              <span data-from-slack className="text-sm text-ink-3">
                {W.fromSlack}
              </span>
            )}
            {/* A room's incoming webhook, marked as Slack marks an app. */}
            {m.hook_id && (
              <span
                data-from-hook
                className="inline-flex h-4 shrink-0 items-center rounded px-1 align-middle text-badge font-medium bg-track text-ink-2"
              >
                {W.app}
              </span>
            )}
            {/* A person must be able to tell their own message from one
                their tool sent for them. */}
            <Origin origin={m.origin} authorId={m.author_id} />
            <span className="shrink-0 whitespace-nowrap tabular-nums text-ink-2">{clock(m.created_at)}</span>
            {m.edited_at && (
              <span data-edited className="shrink-0 text-ink-3">
                {W.edited}
              </span>
            )}
          </div>
        )}
        {/* Drawn rather than flattened: a picture sent into a room would
            otherwise have been an empty line. */}
        {editing ? (
          <MessageEditor
            m={m}
            projectId={projectId}
            roomId={roomId}
            people={people}
            meId={meId}
            onCancel={doneEditing}
            onSave={(body) => {
              doneEditing()
              onEdit?.(m, body)
            }}
          />
        ) : (
          <>
            {/* A reply also said in the room: which thread it answers, pressed
                to open it — `docs/specs/chat-threads.md`. */}
            {m.also_in_room && !inThread && (
              <button
                type="button"
                data-replied-to-thread
                onClick={onThread}
                className="flex min-w-0 items-baseline gap-1 self-start text-left text-sm text-ink-3"
              >
                <span className="shrink-0">{W.repliedToThread}</span>
                <span className="min-w-0 truncate text-accent mouse:hover:underline">
                  {(m.thread_said ?? '').replace(/\s+/g, ' ').trim() || W.wasDeleted}
                </span>
              </button>
            )}
            <div ref={said} data-message-body>
              {/* A webhook's words are a stranger's: each link says where it
                  really goes. */}
              <LinkHostsContext.Provider value={Boolean(m.hook_id)}>
                <Doc body={m.body} className="whitespace-pre-wrap [color:var(--ink-2)]" />
              </LinkHostsContext.Provider>
            </div>
            {/* Each task it names, as the board draws it — `chat-tasks.md`. */}
            {tasksIn(m.body).map((t) => (
              <TaskCard key={t.id} id={t.id} />
            ))}
            {(m as Message & { uploading?: boolean }).uploading && (
              <span data-message-uploading className="text-sm text-ink-3">
                {W.uploading}
              </span>
            )}
            {m.also_in_room && inThread && (
              <span data-also-sent className="text-sm text-ink-3">
                {W.alsoSentToRoom}
              </span>
            )}
            {sameHand && m.edited_at && (
              <span data-edited className="text-sm text-ink-3">
                {W.edited}
              </span>
            )}
          </>
        )}
        {/* Each emoji once, lit where one of them is yours, the names
            behind it on hover — `docs/specs/chat-threads.md`. */}
        {reactions.length > 0 && (
          <div data-reactions className="flex flex-wrap items-center gap-1 pt-1">
            {reactions.map((r) => {
              const mine = r.actors.includes(meId ?? '')
              return (
                <span key={r.emoji} className="group/reaction relative flex">
                  {/*
                  Who, over the pill under the pointer — the emoji large and
                  the names as a sentence, as Slack draws it. After a beat,
                  so a pointer passing over a row of pills does not flash
                  four of these; never on a touch screen, where the press is
                  the reaction itself.
                */}
                  <span
                    role="tooltip"
                    data-reaction-who
                    className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-2 flex w-max max-w-[240px] -translate-x-1/2 flex-col items-center gap-2 px-3 py-3 text-center text-sm opacity-0 transition-opacity delay-0 duration-100 on-reaction-hover:opacity-100 on-reaction-hover:delay-300 [@media(hover:none)]:hidden bg-ink text-canvas"
                    style={{ borderRadius: 'var(--r-card)', boxShadow: 'var(--card-shadow)' }}
                  >
                    <span
                      className="flex size-12 items-center justify-center text-display leading-none bg-canvas"
                      style={{ borderRadius: 'var(--r-row)' }}
                    >
                      {r.emoji}
                    </span>
                    <span>
                      <span className="font-medium">{named(r.actors)}</span>
                      <span style={{ opacity: 0.7 }}>{W.reacted(r.actors.includes(meId ?? ''), r.actors.length > 1)}</span>
                    </span>
                    <span
                      aria-hidden
                      className="absolute top-full left-1/2 size-0 -translate-x-1/2"
                      style={{
                        borderLeft: '8px solid transparent',
                        borderRight: '8px solid transparent',
                        borderTop: '8px solid var(--ink)',
                      }}
                    />
                  </span>
                  <button
                    type="button"
                    data-reaction={r.emoji}
                    data-mine={mine || undefined}
                    aria-pressed={mine}
                    aria-label={W.reactedWith(named(r.actors), r.emoji, r.actors.includes(meId ?? ''), r.actors.length > 1)}
                    onClick={() => onReact(m, r.emoji, !mine)}
                    className="flex h-6 items-center gap-1 rounded-full pr-2 pl-2 text-sm tabular-nums"
                    style={{
                      background: mine ? 'var(--accent-soft)' : 'var(--line)',
                      color: mine ? 'var(--accent)' : 'var(--ink-2)',
                      boxShadow: mine ? 'inset 0 0 0 1px var(--accent)' : undefined,
                    }}
                  >
                    <span className="text-base">{r.emoji}</span>
                    {r.actors.length}
                  </button>
                </span>
              )
            })}
            {face('add-reaction-more', true)}
          </div>
        )}
        {Number(m.replies) > 0 && !inThread && onThread && <Replies m={m} onThread={onThread} roomId={roomId} />}
        {/* What it became, as its card — the one a `#` brings, pressed to
            open the task. A line saying "Task created" said that something
            had happened and not what. `docs/specs/chat-threads.md`. */}
        {made && (
          <span data-made-task className="flex flex-col gap-1.5">
            <span className="flex items-center gap-2 text-sm text-ink-3">
              <Icon name="tasks" size={14} />
              {W.madeIntoTask}
            </span>
            <TaskCard id={made} />
          </span>
        )}
      </div>

      {/*
        What can be done to a message, on a card beside it.

        Under the text they were two more lines in every message, so a room
        of forty was forty rows of grey verbs. Floated on hover they cost
        nothing until they are wanted — and they take the pointer only then,
        which is the lesson from the board's move buttons.
      */}
      {!editing && (
        <div
          data-message-actions
          className="pointer-events-none absolute top-1 right-2 flex gap-1 p-1 opacity-0 group-focus-within:pointer-events-auto group-focus-within:opacity-100 on-group-hover:pointer-events-auto on-group-hover:opacity-100 has-[[aria-expanded=true]]:pointer-events-auto has-[[aria-expanded=true]]:opacity-100 bg-surface"
          style={{
            border: '1px solid var(--line)',
            borderRadius: 'var(--r-field)',
            boxShadow: '0 4px 6px rgb(0 0 0 / 0.12)',
          }}
        >
          {/* The three this person reacts with most, one press each. */}
          {frequent().map((e) => {
            return (
              <button
                key={e}
                data-quick-reaction={e}
                aria-label={W.reactWith(e)}
                title={W.reactWith(e)}
                onClick={() => quick(e)}
                className="flex size-7 items-center justify-center rounded-[var(--r-row)] text-lg transition-colors mouse:hover:bg-[var(--hover)]"
              >
                {e}
              </button>
            )
          })}
          {face('add-reaction', false)}
          {!inThread && onThread && (
            <button
              data-testid="reply-in-thread"
              aria-label={W.replyInThread}
              title={W.replyInThread}
              onClick={onThread}
              className="flex size-7 items-center justify-center rounded-[var(--r-row)] transition-colors mouse:hover:bg-[var(--hover)] text-ink-2"
            >
              <Icon name="reply" size={16} />
            </button>
          )}
          {/* Its link, and changing it or taking it back. */}
          {copied && (
            <span role="status" className="flex items-center px-2 text-sm text-ink-2">
              {copied}
            </span>
          )}
          {hasMenu ? (
            <Popover
              shape="bare"
              width={240}
              sheet={false}
              align="right"
              testId="message-menu"
              said={W.moreActions}
              label={
                <span
                  data-control
                  className="flex size-7 items-center justify-center rounded-[var(--r-row)] transition-colors mouse:hover:bg-[var(--hover)] text-ink-2"
                >
                  <Icon name="ellipsis" size={16} />
                </span>
              }
            >
              {(close) => <MessageMenu {...actions(close)} />}
            </Popover>
          ) : null}
        </div>
      )}
      {/* Out of the row's flow, so its anchor is not one more gap on it. */}
      {phone && (
        <span className="absolute">
          <Popover label={null} open={acting} onOpenChange={setActing} fit panelLabel={W.messageActions}>
            {(close) => (
              <MessageSheet
                quick={(e) => {
                  close()
                  quick(e)
                }}
                {...actions(close)}
                {...(!inThread && onThread
                  ? {
                      onReply: () => {
                        close()
                        onThread()
                      },
                    }
                  : {})}
                onCopyText={() => {
                  close()
                  const text = said.current?.innerText.trim() || wordsOf(m.body)
                  void navigator.clipboard
                    .writeText(text)
                    .then(() => setCopied(W.textCopied))
                    .catch(() => setCopied(W.couldNotCopyText))
                    .finally(() => setTimeout(() => setCopied(null), 1800))
                }}
                onSelectText={() => {
                  close()
                  setSelecting(true)
                }}
              />
            )}
          </Popover>
        </span>
      )}
      {phone && <Note words={copied} />}
    </div>
  )
}

/*
 * A long press, told apart from a scroll and a tap by time and distance.
 *
 * 400ms: past a tap, and short of the half second at which iOS starts its
 * own selection. Eight pixels of travel before that is a scroll, and the
 * hold lets go with nothing refused, so the browser keeps the pan. A finger
 * that lands on something with a press of its own — a link, a picture, a
 * face, a task's card, a reaction — is left to it: a link's long press is
 * the platform's, and so is a picture's.
 *
 * Once it fires, the rest of the gesture is the sheet's. The release's
 * click and the platform's own long-press menu are swallowed until the
 * finger lifts: the sheet's backdrop is under that finger by then, and it
 * closes on either.
 */
const HOLD = 400
const HOLD_SLOP = 8
function useHold(fire: () => void, on: boolean) {
  const timer = useRef<number | null>(null)
  const from = useRef<{ x: number; y: number } | null>(null)
  const stop = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    from.current = null
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: on unmount alone; stop reads only refs, so the first render's stop clears whatever is held then
  useEffect(() => stop, [])
  if (!on) return {}
  return {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.pointerType === 'mouse' || !e.isPrimary) return
      const at = e.target as Element
      if (
        at.closest(
          'a[href], button, input, textarea, img, video, [contenteditable="true"], [role="button"], [data-lightbox], [data-no-hold]',
        )
      )
        return
      stop()
      from.current = { x: e.clientX, y: e.clientY }
      timer.current = window.setTimeout(() => {
        timer.current = null
        from.current = null
        swallowUntilLifted()
        if (navigator.vibrate) navigator.vibrate(8)
        fire()
      }, HOLD)
    },
    onPointerMove: (e: React.PointerEvent) => {
      const f = from.current
      if (f && Math.hypot(e.clientX - f.x, e.clientY - f.y) > HOLD_SLOP) stop()
    },
    onPointerUp: stop,
    onPointerCancel: stop,
    /* Android raises its own menu for a held finger; while ours is coming,
       the press is ours. */
    onContextMenu: (e: React.MouseEvent) => {
      if (timer.current) e.preventDefault()
    },
  }
}

function swallowUntilLifted() {
  const eat = (e: Event) => {
    e.preventDefault()
    e.stopPropagation()
  }
  const lifted = () => {
    window.removeEventListener('pointerup', lifted, true)
    window.removeEventListener('pointercancel', lifted, true)
    /* The click a release makes comes straight after it; a tenth of a
       second later it is past, and the sheet's rows are the finger's
       again — a quick next press is not eaten with it. */
    setTimeout(() => {
      window.removeEventListener('click', eat, true)
      window.removeEventListener('contextmenu', eat, true)
    }, 100)
  }
  window.addEventListener('click', eat, true)
  window.addEventListener('contextmenu', eat, true)
  window.addEventListener('pointerup', lifted, true)
  window.addEventListener('pointercancel', lifted, true)
}

/*
 * What can be done to a message, on a phone: the quick reactions across the
 * top as round targets a thumb can hit, and the ⋯ menu's rows under them —
 * the same rows from the same handlers, with the reply and the text added,
 * since the card that carries those beside a message on a desk is not
 * drawn here.
 */
function MessageSheet({ quick, ...menu }: { quick: (emoji: string) => void } & React.ComponentProps<typeof MessageMenu>) {
  const [more, setMore] = useState(false)
  return (
    <div data-message-sheet className="flex flex-col" style={{ paddingBottom: 'max(8px, env(safe-area-inset-bottom))' }}>
      {more ? (
        <EmojiPicker autoFocus={false} onPick={(e) => quick(e)} />
      ) : (
        <>
          <div className="flex items-center gap-2 px-4 pt-1 pb-2">
            {frequent().map((e) => (
              <button
                key={e}
                type="button"
                data-quick-reaction={e}
                aria-label={W.reactWith(e)}
                onClick={() => quick(e)}
                className="flex size-12 items-center justify-center rounded-full text-title bg-track"
              >
                {e}
              </button>
            ))}
            <button
              type="button"
              data-testid="sheet-add-reaction"
              aria-label={W.addReaction}
              onClick={() => setMore(true)}
              className="flex size-12 items-center justify-center rounded-full bg-track text-ink-2"
            >
              <Icon name="smile" size={20} />
            </button>
          </div>
          <MessageMenu {...menu} tall />
        </>
      )}
    </div>
  )
}

/*
 * "Link copied", said where a phone can see it. On a desk it stands in the
 * card beside the message, which a phone does not draw; here it floats over
 * the foot of the room for a moment and moves nothing under it.
 */
function Note({ words }: { words: string | null }) {
  const [last, setLast] = useState(words)
  if (words && words !== last) setLast(words)
  const { there, shown, ref } = useShown(Boolean(words), SHOWING)
  if (!there) return null
  return createPortal(
    <div
      ref={ref}
      role="status"
      data-copied-note
      className="pointer-events-none fixed left-1/2 z-50 flex h-10 items-center px-4 text-base font-medium whitespace-nowrap bg-ink text-canvas"
      style={{
        bottom: 'calc(env(safe-area-inset-bottom) + 112px)',
        borderRadius: 999,
        boxShadow: 'var(--card-shadow)',
        opacity: shown ? 1 : 0,
        transform: `translateX(-50%) translateY(${shown ? 0 : 8}px)`,
        transition: `opacity ${SHOWING}ms var(--ease-out), transform ${SHOWING}ms var(--ease-out)`,
      }}
    >
      {words ?? last}
    </div>,
    document.body,
  )
}

/** "Last reply 2h ago": the time a thread last moved, said the short way. */
export function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000)
  if (s < 60) return W.justNow
  if (s < 3600) return W.minutesAgo(Math.floor(s / 60))
  if (s < 86_400) return W.hoursAgo(Math.floor(s / 3600))
  if (s < 7 * 86_400) return W.daysAgo(Math.floor(s / 86_400))
  return W.onDay(dayMonth(new Date(iso)))
}

/**
 * A thread under the message it hangs off, as Slack draws it: the faces of
 * who answered, how many answers, and when the last came — a row that is
 * pressed to open the thread. The count alone said there was a thread and
 * nothing of who was in it.
 */
function Replies({ m, onThread, roomId }: { m: Message; onThread: () => void; roomId: string | null | undefined }) {
  const faces = m.repliers ?? []
  return (
    <button
      data-testid="open-thread"
      /* The replies read while the pointer is on the way — `threadRead.ts`. */
      onPointerEnter={() => roomId && void readThread(roomId, m.id).catch(() => {})}
      onClick={onThread}
      className="group/replies -ml-1 flex items-center gap-2 self-start rounded-[var(--r-row)] py-1 pr-2 pl-1 text-base transition-colors mouse:hover:bg-[var(--surface)]"
    >
      {faces.length > 0 && (
        <span data-replier-faces className="flex items-center -space-x-1">
          {faces.map((p) => (
            <span key={p.id} className="flex size-5 shrink-0" style={{ boxShadow: '0 0 0 2px var(--panel)', borderRadius: 9999 }}>
              <Avatar id={p.id} name={p.name} url={p.avatar_url ?? null} size={20} />
            </span>
          ))}
        </span>
      )}
      <span className="font-medium text-accent">{W.replies(Number(m.replies))}</span>
      {m.last_reply_at && <span className="text-sm text-ink-3">{W.lastReply(ago(m.last_reply_at))}</span>}
    </button>
  )
}
