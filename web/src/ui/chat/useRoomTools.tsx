import { useEffect, useState, useRef, useLayoutEffect } from 'react'
import { CHAT as W } from '../../words/chat.js'
import { api, writingNow } from '../../data/api.js'
import { useAttach } from '../kit.jsx'
import { RoomSettings } from '../Channels.jsx'
import { type Room as Conversation } from '../Sidebar.jsx'
import { looking } from '../../data/chime.js'
import { used } from '../../data/frequent.js'
import { type Message } from './lines.jsx'
import { useSend, afterSent } from './thread.jsx'
import { threadReady } from './threadRead.js'
import { wordsOf } from './messageRow.jsx'
import { NewChannel } from './newChannel.jsx'
import { RoomPeople, FirstAndMore } from './roomPeople.jsx'
import { type ChatProps } from '../Chat.jsx'
import { type RoomHistory } from './useRoomHistory.js'

/**
 * What is done in a room: sending, threads, finding a message, reacting,
 * editing and removing, and the room's own people and settings.
 */
export function useRoomTools({
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
}: {
  projectId: ChatProps['projectId']
  conversationId: ChatProps['conversationId']
  meId: ChatProps['meId']
  onRoomsChanged: ChatProps['onRoomsChanged']
  onRoomGone: ChatProps['onRoomGone']
  onWide: ChatProps['onWide']
  at: ChatProps['at']
} & Required<Pick<ChatProps, 'canMake' | 'canDelete' | 'canMakeTask' | 'canDeleteSaid'>> &
  Pick<
    RoomHistory,
    | 'setFetched'
    | 'messages'
    | 'setMessages'
    | 'ready'
    | 'thread'
    | 'setThread'
    | 'field'
    | 'broad'
    | 'phone'
    | 'members'
    | 'few'
    | 'setMembersBeat'
    | 'sheet'
    | 'back'
    | 'setBack'
    | 'fetching'
    | 'atBottom'
    | 'keep'
    | 'mark'
    | 'pinning'
    | 'rooms'
    | 'roomId'
    | 'setRoomId'
    | 'readsAsked'
    | 'readDrawn'
    | 'heard'
    | 'load'
    | 'setBeat'
  >) {
  const room = rooms.find((r) => r.id === roomId) ?? null
  /* This is the room on the screen: no sound for what arrives in it. */
  useEffect(() => {
    looking(roomId)
    return () => looking(null)
  }, [roomId])
  /* A conversation with one other person, which is that person rather than
     a room: its head is their face and name, and it lists nobody. */
  const alone = Boolean(room && !(room.channel ?? Boolean(room.project_id)) && room.other_id)
  /* A direct conversation with more than one other person. */
  const group = Boolean(room && !(room.channel ?? Boolean(room.project_id)) && !room.other_id && (room.others ?? '').includes(', '))
  /* The list asked for again after something about a room changed here. */
  const refreshRooms = async () => {
    const r = await api<{ conversations: Conversation[] }>('/conversations')
    setFetched(r.conversations)
    await onRoomsChanged?.()
  }
  /* Taken while rendering, like the room itself: an effect would run after
     the first paint, which is one frame of the history drawn without the
     line in it and then jumping. Only once per room, and only when the list
     has arrived — before that there is nothing to take. */
  if (roomId && room && mark.current?.roomId !== roomId) {
    const n = Number(room.unread ?? 0)
    mark.current = {
      roomId,
      since: n > 0 ? (room.read_through ?? '') : '',
      count: n,
    }
  }
  const since = mark.current?.roomId === roomId ? mark.current.since : ''
  const newCount = mark.current?.roomId === roomId ? mark.current.count : 0
  /* The first thing said after that, by anybody but the reader — the count
     does not include their own words, so neither can the line, or the two
     disagree about the same messages. */
  const firstNew = since ? (messages.find((m) => m.created_at > since && m.author_id !== meId)?.id ?? null) : null
  /* A file put on a message is the room's: in a project's room also a row
     in the project's Docs, seen by whoever may see the room. */
  const attach = useAttach(room ? `room:${room.id}` : null)

  /* The room's line sends at the top level; a thread has its own. */
  const send = useSend({ roomId, parentId: null, people: members, meId, attach, setMessages, field })

  /*
   * A thread, beside the room — `docs/specs/chat-threads.md`. The message
   * it hangs off is held as it was when opened, so a page of the room
   * scrolling out of what is loaded does not take the thread's head with it.
   */
  const [held, setHeld] = useState<Message | null>(null)
  const head = thread ? (messages.find((m) => m.id === thread) ?? held) : null
  /*
   * A thread on its way shut, beside the room: kept on the screen for the
   * fifth of a second it takes to fold away, the way it opened, rather than
   * gone in a frame with the room jumping wide — `docs/specs/chat-threads.md`.
   */
  const [leaving, setLeaving] = useState<Message | null>(null)
  const shutThread = () => {
    if (head && matchMedia('(prefers-reduced-motion: no-preference)').matches) {
      setLeaving(head)
      setTimeout(() => setLeaving(null), 200)
    }
    setThread(null)
  }
  const paneHead = head ?? leaving
  /* Opened with its replies in it: the press waits for them, up to 400 ms,
     when the pointer did not already read them — `threadRead.ts`. */
  const openThread = (m: Message) => {
    if (!roomId) return
    void threadReady(roomId, m.id).then(() => {
      setHeld(m)
      setThread(m.id)
    })
  }

  /*
   * Finding in this room — `docs/specs/find.md`. While the field holds words
   * the history gives way to what matched; pressing one opens the room at it.
   */
  const [words, setWords] = useState('')
  const asked = words.trim().length >= 2 ? words.trim() : ''
  const [hits, setHits] = useState<Message[] | null>(null)
  const [hitsNext, setHitsNext] = useState<string | null>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: another room starts with an empty search
  useEffect(() => setWords(''), [roomId])
  useEffect(() => {
    if (!asked || !roomId) return setHits(null)
    let alive = true
    const wait = setTimeout(() => {
      void api<{ messages: Message[]; next_cursor: string | null }>(`/conversations/${roomId}/messages?q=${encodeURIComponent(asked)}`)
        .then((r) => {
          if (!alive) return
          setHits(r.messages)
          setHitsNext(r.next_cursor)
        })
        .catch(() => alive && (setHits([]), setHitsNext(null)))
    }, 150)
    return () => {
      alive = false
      clearTimeout(wait)
    }
  }, [asked, roomId])
  const moreHits = async () => {
    if (!roomId || !hitsNext) return
    const r = await api<{ messages: Message[]; next_cursor: string | null }>(
      `/conversations/${roomId}/messages?q=${encodeURIComponent(asked)}&cursor=${encodeURIComponent(hitsNext)}`,
    )
    setHits((had) => [...(had ?? []), ...r.messages])
    setHitsNext(r.next_cursor)
  }
  /* The message to put in front of the reader once it is drawn. */
  const [lit, setLit] = useState<string | null>(null)
  const loaded = useRef(messages)
  loaded.current = messages
  const backNow = useRef(back)
  backNow.current = back
  /*
   * The room opened at a found message: read back, a page of two hundred at
   * a time, until it is in what is loaded — the history stays one unbroken
   * stretch from the newest message down, so paging back from there still
   * works — and then lit. A reply opens its thread.
   */
  const reach = async (hit: Message) => {
    if (!roomId) return
    setWords('')
    const want = hit.parent_id ?? hit.id
    let have = loaded.current
    let cursor = backNow.current
    fetching.current = true
    try {
      for (let i = 0; i < 25 && !have.some((m) => m.id === want) && cursor; i++) {
        const r = await api<{ messages: Message[]; next_cursor?: string | null }>(
          `/conversations/${roomId}/messages?limit=200&cursor=${encodeURIComponent(cursor)}`,
        )
        const byId = new Map(have.map((m) => [m.id, m]))
        for (const m of r.messages) byId.set(m.id, m)
        have = [...byId.values()].sort((a, b) => a.created_at.localeCompare(b.created_at))
        cursor = r.next_cursor ?? null
      }
    } finally {
      fetching.current = false
    }
    atBottom.current = false
    keep.current = null
    setMessages(have)
    setBack(cursor)
    const head = have.find((m) => m.id === want)
    if (hit.parent_id && head) openThread(head)
    setLit(want)
  }
  /* Opened at a message: once the room is in, and again when the address
     names another. */
  /*
   * Not on what this machine kept: that is the room as it was last read,
   * and a message said since — the one a link was just copied from — is
   * not in it, with no page further back to look in either. The link then
   * opened the room unlit and its thread shut. On the server's
   * page, which is the room as it is.
   */
  const reached = useRef<string | null>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: reach reads what is loaded through refs; the message is what changes
  useEffect(() => {
    if (!ready || !heard || !at || reached.current === at.id) return
    reached.current = at.id
    void reach({ id: at.id, parent_id: at.thread } as Message)
    // `reach` reads what is loaded through refs; the message is what changes.
  }, [ready, heard, at?.id, at?.thread])
  // biome-ignore lint/correctness/useExhaustiveDependencies: the message found is lit once it is drawn, which is when messages changes
  useLayoutEffect(() => {
    if (!lit) return
    const row = sheet.current?.querySelector<HTMLElement>(`[data-message-id="${lit}"]`)
    if (!row) return
    pinning.current = true
    row.scrollIntoView({ block: 'center' })
    requestAnimationFrame(() => requestAnimationFrame(() => (pinning.current = false)))
    row.setAttribute('data-found-at', '')
    setTimeout(() => row.removeAttribute('data-found-at'), 2000)
    setLit(null)
  }, [lit, messages, pinning, sheet])

  /*
   * Beside the room where there is room for both — the room keeping the
   * width a sentence wants — and over it where there is not.
   */
  const frame = useRef<HTMLDivElement | null>(null)
  const [beside, setBeside] = useState(true)
  useLayoutEffect(() => {
    const host = frame.current?.parentElement
    if (!host) return
    /* The room keeps four hundred and some — a short line, but a line —
       beside a thread of 360 and the gap between them. */
    const measure = () => {
      const pad = getComputedStyle(host)
      const inner = host.clientWidth - parseFloat(pad.paddingLeft) - parseFloat(pad.paddingRight)
      setBeside(inner >= 820)
    }
    measure()
    const watch = new ResizeObserver(measure)
    watch.observe(host)
    return () => watch.disconnect()
  }, [])
  /* The bar over the room widens with it while a thread is beside it. */
  const wideNow = Boolean(head && beside)
  useEffect(() => {
    onWide?.(wideNow)
  }, [wideNow, onWide])
  useEffect(() => () => onWide?.(false), [onWide])
  /* Another room is another conversation: its threads are not this one's. */
  // biome-ignore lint/correctness/useExhaustiveDependencies: another room is another conversation: its threads are not this one's
  useEffect(() => setThread(null), [roomId, setThread])

  /*
   * An emoji on a message, or taken back, on the screen before the server
   * has it. The room's socket brings the truth back to everybody, this
   * screen included, and the load that follows replaces the guess.
   *
   * One emoji's presses on one message reach the server in the order they
   * were made: taken back and given again quickly, the two went out side by
   * side, and when the server happened to give before it took back, the
   * emoji was gone though the last press had put it there.
   */
  const reacting = useRef(new Map<string, Promise<unknown>>())
  function react(m: Message, emoji: string, on: boolean) {
    if (on) used(emoji)
    const me = meId ?? ''
    const turn = (x: Message): Message => {
      if (x.id !== m.id) return x
      const had = x.reactions ?? []
      const one = had.find((r) => r.emoji === emoji)
      const next = on
        ? one
          ? had.map((r) => (r.emoji === emoji && !r.actors.includes(me) ? { ...r, actors: [...r.actors, me] } : r))
          : [...had, { emoji, actors: [me] }]
        : had.map((r) => (r.emoji === emoji ? { ...r, actors: r.actors.filter((a) => a !== me) } : r)).filter((r) => r.actors.length > 0)
      return { ...x, reactions: next }
    }
    setMessages((had) => had.map(turn))
    setHeld((h) => (h ? turn(h) : h))
    setBeat((b) => b + 1)
    /* The screen now knows better than any read already on its way: one
       asked before this press, answered after it, put the emoji back that
       the press had taken away — and the next press, reading that, took
       it away again. */
    readDrawn.current = ++readsAsked.current
    const key = `${m.id} ${emoji}`
    const sent = (reacting.current.get(key) ?? afterSent(m.id))
      .then(() => api(`/messages/${m.id}/reactions/${encodeURIComponent(emoji)}`, { method: on ? 'PUT' : 'DELETE' }))
      .catch(() => {})
      .finally(() => {
        if (reacting.current.get(key) === sent) reacting.current.delete(key)
        void load()
      })
    reacting.current.set(key, sent)
  }

  /*
   * A message made into a task, and the message saying so.
   *
   * It said nothing before, and the task went into no list, so pressing it
   * looked like nothing happening — `docs/specs/chat-threads.md`. The title
   * is every word in the message, mentions included: one written as a list
   * had none at the top level, and an empty title was refused in silence.
   */
  const [made, setMade] = useState<Record<string, string>>({})
  const canPromote = canMakeTask && Boolean(room?.project_id)
  async function promote(m: Message) {
    const title = wordsOf(m.body).slice(0, 120) || W.messageFrom(m.author_name)
    /* A write from the press, not from when the message lands: the Tasks
       tab opened meanwhile reads after it (`afterWrites`). */
    const r = await writingNow(
      afterSent(m.id).then(() =>
        api<{ id: string }>(`/messages/${m.id}/promote`, {
          method: 'POST',
          body: JSON.stringify({ to: 'task', title }),
        }),
      ),
    )
    setMade((had) => ({ ...had, [m.id]: r.id }))
  }

  /*
   * Changing what was said, and taking it back — on the screen first, the
   * room's socket bringing the truth back after. `docs/specs/message-edit.md`.
   */
  function edit(m: Message, body: { type: 'doc'; content: unknown[] }) {
    const now = new Date().toISOString()
    const turn = (x: Message): Message => (x.id === m.id ? { ...x, body, edited_at: now } : x)
    setMessages((had) => had.map(turn))
    setHeld((h) => (h ? turn(h) : h))
    void afterSent(m.id)
      .then(() => api(`/messages/${m.id}`, { method: 'PATCH', body: JSON.stringify({ body }) }))
      .catch(() => {})
      .finally(() => {
        void load()
        setBeat((b) => b + 1)
      })
  }
  function remove(m: Message) {
    /* With answers it stays as a line; without, it goes. */
    const stone = (x: Message): Message => ({ ...x, body: null, reactions: [], deleted: true })
    setMessages((had) => (Number(m.replies) > 0 ? had.map((x) => (x.id === m.id ? stone(x) : x)) : had.filter((x) => x.id !== m.id)))
    setHeld((h) => (h && h.id === m.id ? stone(h) : h))
    void afterSent(m.id)
      .then(() => api(`/messages/${m.id}`, { method: 'DELETE' }))
      .catch(() => {})
      .finally(() => {
        void load()
        setBeat((b) => b + 1)
      })
  }
  const mayDeleteSaid = canDeleteSaid && Boolean(room?.project_id)

  const newChannel = !conversationId && projectId && canMake && (
    <NewChannel
      round
      wide={broad}
      projectId={projectId}
      meId={meId}
      onMade={async (id) => {
        const r = await api<{ conversations: Conversation[] }>('/conversations')
        setFetched(r.conversations)
        /* Made to be written in, so it is the room on the screen — as one
           made from the sidebar is. */
        setRoomId(id)
        setThread(null)
        await onRoomsChanged?.()
      }}
    />
  )

  /* Who is in the room, and the way to its settings — on the head's own line
     when the room was opened from the sidebar, on a line under the tabs
     inside a project. */
  const besides = room?.project_id && !few ? W.wholeProject : ''
  /* On a phone three names do not fit beside the faces, and they ran on
     under what came after them: the first of the others, and how many more. Somebody else first, since you know you are there. */
  const named = [...members].sort((a, b) => Number(a.actor_id === meId) - Number(b.actor_id === meId)).map((m) => m.name)
  const people =
    room && !alone ? (
      <span data-members={members.length} data-open={few ? undefined : ''} className="flex min-w-px items-center overflow-hidden">
        <RoomPeople
          members={members}
          meId={meId}
          said={(members.length <= 3 ? members.map((m) => m.name).join(', ') : W.peopleCount(members.length)) + besides}
          {...(phone && members.length > 1 && members.length <= 3
            ? /* A group's head already names them as "Emily Brooks +1",
                 counting the others; the row under it counting you too
                 said "+2" beside it. So it says how many. */
              { face: group ? W.peopleCount(members.length) : <FirstAndMore names={named} after={besides} /> }
            : {})}
        />
      </span>
    ) : null
  const settings = room ? (
    <RoomSettings
      round={Boolean(conversationId)}
      members={members}
      chosen={few}
      meId={meId}
      room={{
        ...room,
        can: room.can ?? (room.project_id ? [...(canMake ? ['edit' as const] : []), ...(canDelete ? ['delete' as const] : [])] : []),
      }}
      onChanged={async () => {
        const r = await api<{ conversations: Conversation[] }>('/conversations')
        setFetched(r.conversations)
        await onRoomsChanged?.()
        setMembersBeat((b) => b + 1)
      }}
      onDeleted={async () => {
        const r = await api<{ conversations: Conversation[] }>('/conversations')
        setFetched(r.conversations)
        setRoomId(null)
        await onRoomsChanged?.()
        onRoomGone?.()
      }}
      onLeft={async () => {
        /* A room of chosen people, or one outside every project, stops
           answering once left; an open project channel only moves under
           More chats and stays readable. */
        const gone = Boolean(room.chosen) || !room.project_id
        const r = await api<{ conversations: Conversation[] }>('/conversations')
        setFetched(r.conversations)
        if (gone) setRoomId(null)
        await onRoomsChanged?.()
        if (gone) onRoomGone?.()
      }}
    />
  ) : null
  return {
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
  } as const
}
export type RoomTools = ReturnType<typeof useRoomTools>
