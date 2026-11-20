import { useState, useEffect, useRef, useCallback, useLayoutEffect } from 'react'
import { type PersonInWorkspace } from '@tracker/shared-schema'
import { api } from '../../data/api.js'
import { useWide, usePhone } from '../kit.jsx'
import { type ChatComposerHandle } from '../ChatComposer.jsx'
import { type Room as Conversation } from '../Sidebar.jsx'
import { remember, recall } from '../../data/memory.js'
import { keepOpen } from '../../data/socket.js'
import { warmWithin, picturesOf } from '../../data/warm.js'
import { type Message } from './lines.jsx'
import { sending } from './thread.jsx'
import { useAgentsWorking, useSayTyping, useTypists } from './typing.jsx'
import { type ChatProps } from '../Chat.jsx'

/**
 * The room's history: which room, its messages read in pages, where the
 * reader is in them, and the place kept when the window comes back.
 */
export function useRoomHistory({
  projectId,
  conversationId,
  all,
  meId,
  open,
  onRoom,
}: {
  projectId: ChatProps['projectId']
  conversationId: ChatProps['conversationId']
  all: ChatProps['all']
  meId: ChatProps['meId']
  open: ChatProps['open']
  onRoom: ChatProps['onRoom']
}) {
  /* Only for the case where nobody handed the list down — see `mine`. */
  const [fetched, setFetched] = useState<Conversation[] | null>(null)
  /*
   * The room last open in this project, kept on this machine: back on the
   * Chat tab after Tasks it opened on the first room again, and somebody
   * mid-conversation in the fourth had to find it every time.
   */
  const keptAs = projectId ? `tracker:room:${projectId}` : null
  const [picked, setPickedNow] = useState<string | null>(() => {
    try {
      return keptAs ? localStorage.getItem(keptAs) : null
    } catch {
      return null
    }
  })
  const setPicked = (id: string | null) => {
    setPickedNow(id)
    try {
      if (keptAs && id) localStorage.setItem(keptAs, id)
    } catch {
      /* Storage refused: it opens on the first room, as before. */
    }
  }
  /* Named by the address: kept, so the tab comes back to it. */
  // biome-ignore lint/correctness/useExhaustiveDependencies: named by the address: setPicked is new on every render and reads nothing that changes
  useEffect(() => {
    if (open) setPicked(open)
  }, [open])
  const [messages, setMessages] = useState<Message[]>([])
  /*
   * Whether this room's messages have arrived.
   *
   * Not the same question as whether there are any, and the screen said the
   * wrong one for a frame: opening a room rendered "Nothing yet" over an
   * empty column and then filled it. An empty list is a claim, and a claim
   * made before the answer is back is a claim that is usually false.
   */
  const [ready, setReady] = useState(false)
  /* Same for the list of rooms: "No channel here" is a statement, not a
     waiting state, and it flashed on every open. Handed the list, it is
     known from the first frame. */
  const [listedSelf, setListed] = useState(false)
  const [thread, setThread] = useState<string | null>(null)
  const field = useRef<ChatComposerHandle>(null)
  const broad = useWide()
  /* On a phone the head has room for the name and nothing else, so who is
     in the room keeps its own line under it. */
  const phone = usePhone()
  const [members, setMembers] = useState<PersonInWorkspace[]>([])
  /* Whether this room was made for a few people or belongs to the project.
     Told by counting: a room for everybody has as many people in it as the
     project does, which is the answer the server gives either way. */
  const [few, setFew] = useState(false)
  /* Counted up when the room's people were changed here, so they are asked
     for again. */
  const [membersBeat, setMembersBeat] = useState(0)
  const bottom = useRef<HTMLDivElement | null>(null)
  /** The column the history scrolls in, for reading back through it. */
  const sheet = useRef<HTMLDivElement | null>(null)
  /** Where the next page back starts, or null at the beginning of the room. */
  const [back, setBack] = useState<string | null>(null)
  const fetching = useRef(false)
  /*
   * Whether the reader is at the newest message.
   *
   * True until they scroll away from it, which is what decides whether a
   * message arriving moves the sheet. Held in a ref and not in state because
   * it is read inside a layout effect that must not re-run for it, and
   * because it starts true: a room opens at the bottom.
   */
  const atBottom = useRef(true)
  /*
   * How far the top of the loaded history was from the bottom, while a page
   * older than it is on its way.
   *
   * Prepending rows moves everything below them down by their height, so a
   * reader looking at a sentence ends up looking at one from twenty minutes
   * earlier. Put back after the rows are in the document and before the
   * frame is painted — tried in a `requestAnimationFrame` first, which
   * sometimes ran before React had committed the new rows and restored
   * against the old height, which is how the sheet ended up at the very top
   * and stopped asking for more.
   */
  const keep = useRef<number | null>(null)
  /*
   * Where this person had read up to when they opened the room, and how much
   * had arrived since — `docs/specs/history.md`.
   *
   * Frozen, because both answers stop being true the moment the screen says
   * it has read them: the room is marked read on opening and the count in
   * the list goes to nothing. A line that disappeared as it was drawn would
   * be worse than no line. It is kept until the room is left, so somebody
   * reading back through twelve messages can still see where the twelve
   * began.
   */
  const mark = useRef<{ roomId: string; since: string; count: number } | null>(null)
  /** Which room the sheet has already been put in position for. */
  const placed = useRef<string | null>(null)
  /** What is said in the sheet, to notice it growing under the reader. */
  const column = useRef<HTMLDivElement | null>(null)
  /*
   * To the bottom, as this screen's own doing.
   *
   * Marked for the two frames its scroll event takes to arrive, so the
   * handler does not read that event as the reader scrolling away.
   */
  const pinning = useRef(false)
  const pin = () => {
    const box = sheet.current
    if (!box) return
    pinning.current = true
    box.scrollTop = box.scrollHeight
    atBottom.current = true
    requestAnimationFrame(() => requestAnimationFrame(() => (pinning.current = false)))
  }

  /*
   * The rooms, from whoever already has them.
   *
   * This asked the server for the whole list on every mount — the same list
   * the sidebar had just fetched, and the slowest request in the product by
   * an order of magnitude. Opening a chat ran it twice.
   *
   * Reached from the sidebar it is one named room; reached from a project it
   * is that project's rooms with a switcher. Either way the room has to be
   * in the list, because that is where its name and its audience come from —
   * holding an id and no row is how a room renders as empty.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: fetched is the answer this asks for; asked again only when the rooms handed in change
  useEffect(() => {
    if (all || fetched) return
    let alive = true
    void api<{ conversations: Conversation[] }>('/conversations')
      .then((r) => {
        if (!alive) return
        setFetched(r.conversations)
        setListed(true)
      })
      .catch(() => alive && setListed(true))
    return () => {
      alive = false
    }
  }, [all])

  /*
   * Which rooms and which one, worked out while rendering rather than in an
   * effect afterwards.
   *
   * As an effect this cost a frame: the first paint had no room, so the
   * name, the people in it and the line to write on were all absent and
   * then appeared. The screen measured 0% of itself for that frame — the
   * emptiest thing in the product, and the "empty space then the chat" of
   * it. The list is a prop; deriving it needs no round trip and no render.
   */
  /* What was fetched here wins over what was handed down, because the only
     reason this ever fetches is that a channel was just made and the owner
     of the list does not know about it yet. */
  const source = fetched ?? all
  const rooms = source
    ? conversationId
      ? source.filter((c) => c.id === conversationId)
      : source.filter((c) => c.project_id === projectId)
    : []
  /* The address's room first, then the one last open here, then the
     first: the same order whether the tab was pressed or a link followed. */
  const roomId =
    conversationId ??
    (open && rooms.some((r) => r.id === open) ? open : rooms.some((r) => r.id === picked) ? picked : (rooms[0]?.id ?? null))
  /* A room chosen here is a room in the address. */
  const setRoomId = (id: string | null) => {
    setPicked(id)
    if (id && projectId) onRoom?.(id)
  }
  /*
   * The room the tab settled on, said in the address.
   *
   * Opened as `/messages` it shows the room last open here; the address
   * said only the tab, so the sidebar — which reads the address and
   * nothing else — had no room to light. Replaced, not pushed: back leaves
   * the project rather than walking through the app deciding what it
   * meant. And only once the list is known, so a room still arriving is
   * not overwritten with the first one.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: settled once the list is known; onRoom is the opener's, and source matters only as there or not
  useEffect(() => {
    if (!projectId || conversationId || !roomId || roomId === open || !source) return
    onRoom?.(roomId, 'settle')
  }, [roomId, open, projectId, conversationId, Boolean(source)])

  /*
   * Arriving at a room puts the hand in its field — `docs/specs/keyboard.md`.
   *
   * A room is opened to say something in it, so the field is where the
   * keys go: the room, the thread, the next room over. With a mouse and a
   * keyboard only — on a phone a focused field is the keyboard sliding over
   * half the room somebody came to read. And not out of another field, a
   * dialog or the palette: focus is not taken from where somebody already is.
   * Escape in an empty field gives the bare keys back, 1…6 among them.
   */
  useEffect(() => {
    if (!roomId || !ready) return
    if (!matchMedia('(pointer: fine)').matches) return
    const now = document.activeElement as HTMLElement | null
    if (now && !now.closest('[data-chat-composer]') && (now.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(now.tagName))) return
    if (document.querySelector('[role="dialog"], [data-testid="palette-input"]')) return
    field.current?.focus({ preventScroll: true })
  }, [roomId, ready])

  /*
   * The newest read drawn is the room as it is; an older one landing after
   * it is old news. Two reads overlap whenever two things happen together —
   * an emoji taken back and given again, each followed by a read — and the
   * first, answered last, put back the room from before the second.
   */
  const readsAsked = useRef(0)
  const readDrawn = useRef(0)
  /* Whether the server's page of this room is in, rather than only what
     this machine kept of it — `reach` below waits for it. */
  const [heard, setHeard] = useState(false)
  const load = useCallback(async () => {
    if (!roomId) return
    const mine = ++readsAsked.current
    /*
     * Enough of the room to hold the line.
     *
     * A page is fifty and the line goes above the first unread message, so
     * a room with ninety unread in it would open at the bottom with the
     * line out of sight — the one case where somebody most needs to be told
     * where they stopped. Asked for once, on opening, and only when there
     * is a count to answer: two hundred is the ceiling the endpoint has.
     */
    const waiting = mark.current?.roomId === roomId ? mark.current.count : 0
    const wide = waiting > 40 ? `limit=${Math.min(200, waiting + 20)}` : ''
    const r = await api<{ messages: Message[]; next_cursor?: string | null }>(`/conversations/${roomId}/messages${wide ? `?${wide}` : ''}`)
    if (mine < readDrawn.current) return
    remember(`room-messages:${roomId}`, r.messages)
    /*
     * A picture arriving in the room somebody is reading comes in sharp.
     *
     * Somebody else's new message with a picture in it waits for that
     * picture's bytes — a second and a half at most — before it is drawn,
     * so it appears whole rather than as a blur that sharpens under the
     * reader's eyes. Only for what arrives while the room is open: the room
     * itself opens at once, on what it has. `data/warm.ts`.
     */
    if (drawnOnce.current) {
      const fresh = r.messages.filter((m) => !drawn.current.has(m.id) && m.author_id !== meId)
      await warmWithin(
        fresh.flatMap((m) => picturesOf(m.body)),
        1500,
      )
    }
    if (mine < readDrawn.current) return
    readDrawn.current = mine
    /*
     * The newest page, over whatever was read back — not instead of it.
     *
     * This runs again whenever anything happens in the room, and it asks for
     * the newest fifty. Replacing with them threw away everything somebody
     * had scrolled back to read, so a message arriving while you were
     * looking at last Tuesday put you at the bottom of this afternoon.
     */
    setMessages((had) => {
      const byId = new Map(had.map((m) => [m.id, m]))
      for (const m of r.messages) byId.set(m.id, m)
      const all = [...byId.values()]
      /* Anything the newest page should have carried and did not has been
         deleted; older than its window, we have no opinion. */
      const edge = r.messages[0]?.created_at
      /* Except one of ours still on its way: the page was asked for
         before it was sent, so it could not carry it. Dropped, it went off
         the screen and came back a moment later — and a menu opened on it
         went with it, under the pointer. */
      const kept = edge ? all.filter((m) => m.created_at < edge || r.messages.some((n) => n.id === m.id) || sending.has(m.id)) : all
      return kept.sort((a, b) => a.created_at.localeCompare(b.created_at))
    })
    setBack((was) => was ?? r.next_cursor ?? null)
    setReady(true)
    setHeard(true)
  }, [roomId, meId])

  /*
   * One page further back, when the hand reaches the top of what is loaded.
   *
   * A room holds everything ever said in it and the screen asks for fifty.
   * Without this, a channel with three hundred messages in it is a channel
   * with the last fifty — the rest is on the server and unreachable, which
   * nobody notices on a fixture with five.
   */
  const older = useCallback(async () => {
    const box = sheet.current
    if (!roomId || !back || fetching.current || !box) return
    fetching.current = true
    try {
      const r = await api<{ messages: Message[]; next_cursor?: string | null }>(`/conversations/${roomId}/messages?cursor=${back}`)
      // Where the top of the loaded history sits, to put it back there.
      keep.current = box.scrollHeight - box.scrollTop
      setMessages((had) => {
        const byId = new Map(r.messages.map((m) => [m.id, m]))
        for (const m of had) byId.set(m.id, m)
        return [...byId.values()].sort((a, b) => a.created_at.localeCompare(b.created_at))
      })
      setBack(r.next_cursor ?? null)
    } catch {
      keep.current = null
      fetching.current = false
    }
  }, [roomId, back])

  /*
   * A different room is a different screen, so it starts empty rather than
   * holding the last one's messages until the new ones land. Fifty
   * milliseconds of a blank column is nothing; fifty milliseconds of another
   * room's conversation is a line somebody reads in the wrong place.
   */
  useEffect(() => {
    /* What this room had last time, while what it has now is on its way. A
       room read before opens on its own conversation rather than on
       nothing. */
    const had = recall<Message[]>(`room-messages:${roomId}`)
    setReady(had !== null)
    setHeard(false)
    setMessages(had ?? [])
    /* And its history starts again: the page back belongs to the room it
       came from, and asking this room for that one's cursor is a page of
       somebody else's conversation. */
    setBack(null)
    atBottom.current = true
    placed.current = null
  }, [roomId])

  /* What has been drawn, to tell a message arriving from one already here. */
  const drawn = useRef(new Set<string>())
  const drawnOnce = useRef(false)
  useEffect(() => {
    for (const m of messages) drawn.current.add(m.id)
    if (ready && messages.length) drawnOnce.current = true
  }, [messages, ready])
  // biome-ignore lint/correctness/useExhaustiveDependencies: another room has drawn nothing yet
  useEffect(() => {
    drawn.current = new Set()
    drawnOnce.current = false
  }, [roomId])

  useEffect(() => void load(), [load])

  /*
   * Held at the newest message while it grows.
   *
   * Opening a room puts it at the bottom, and then what is in it keeps
   * arriving: pictures sent before their size was recorded, a video's
   * frame, a font. Each one pushes the bottom down past where the sheet was
   * put, so a room refreshed at its last message opened somewhere above it
   * and drifted further up with every picture. While the reader is at the
   * bottom — and only then — the bottom is kept.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: one watcher per room; pin reads refs
  useEffect(() => {
    const box = column.current
    if (!box) return
    const watch = new ResizeObserver(() => {
      if (!atBottom.current || keep.current !== null) return
      pin()
    })
    watch.observe(box)
    return () => watch.disconnect()
  }, [roomId])

  /* Who is in it, asked of the room rather than assumed from the project:
     the two are the same thing until somebody makes a channel for four
     people, and then they are not. */
  // biome-ignore lint/correctness/useExhaustiveDependencies: membersBeat is the trigger: the people are read again when the room says they changed
  useEffect(() => {
    if (!roomId) return
    /*
     * The people in the room, remembered per room.
     *
     * Switching rooms left the last room's faces up there until the new
     * ones came back — the wrong people, named, above a conversation they
     * are not in. Clearing first instead is honest but it is the flicker
     * this is about: a row of avatars going out and coming in on every
     * switch. So a room you have been in before shows its own people at
     * once, and one you have not shows nobody until it knows.
     */
    const known = recall<{ members: PersonInWorkspace[]; chosen: boolean }>(`room-members:${roomId}`)
    setMembers(known?.members ?? [])
    setFew(known?.chosen ?? false)

    let alive = true
    void api<{ members: PersonInWorkspace[]; chosen: boolean }>(`/conversations/${roomId}/members`)
      .then((r) => {
        const said = { members: r.members ?? [], chosen: r.chosen }
        remember(`room-members:${roomId}`, said)
        if (!alive) return
        setMembers(said.members)
        setFew(said.chosen)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [roomId, membersBeat])

  /*
   * Opening a room is what marks it read.
   *
   * Sent from here rather than inferred on the server from the fetch: an
   * agent listing messages under a token has not read anything, and marking
   * them for it is how somebody misses a mention.
   */
  const marked = useRef('')
  /* Whether the window is being looked at: a room open in a tab behind
     others has not been read, and marking it read is what kept a direct
     message off the phone. */
  const [shown, setShown] = useState(() => document.visibilityState === 'visible')
  useEffect(() => {
    const look = () => setShown(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', look)
    return () => document.removeEventListener('visibilitychange', look)
  }, [])
  useEffect(() => {
    /*
     * Once per newest message, not three times per open.
     *
     * On `[roomId, messages.length]` this fired on mount, again when what
     * was remembered was drawn, and again when the fetch landed — three
     * writes, three words round the socket and three refetches of the
     * sidebar for one room being opened, which the shell now answers
     * without waiting. Nothing is owed until the newest message changes.
     */
    if (!roomId || !ready || !shown) return
    const key = `${roomId}:${messages[messages.length - 1]?.id ?? ''}`
    if (marked.current === key) return
    marked.current = key
    void api(`/conversations/${roomId}/read`, { method: 'POST' }).catch(() => {})
  }, [roomId, ready, messages, shown])

  /*
   * And again on the way out.
   *
   * The mark above goes up to the newest message the screen has *seen*, and
   * what it sees comes round the socket. A word that never arrives — a
   * socket that dropped, a tab asleep, a notify lost — leaves the room read
   * up to where the screen got to and the server counting past it, so the
   * badge returns the moment somebody leaves. The room was read; only the
   * mark was short.
   *
   * Leaving is the one moment it is certainly finished with. Keyed on the
   * room alone, so it is one request per room rather than one per message,
   * and the server marks up to its own newest rather than to a number sent
   * from here — this cannot mark anything that was not there to read.
   */
  useEffect(() => {
    if (!roomId) return
    return () => {
      void api(`/conversations/${roomId}/read`, { method: 'POST' }).catch(() => {})
    }
  }, [roomId])

  /* A socket word for the room, counted, so the thread hears it too. */
  const [beat, setBeat] = useState(0)

  // Realtime carries the fact, not the row: hearing "a message arrived" is
  // followed by the same fetch a reload would do, so there is one path into
  // the data rather than two that can drift apart.
  /* Who is typing, heard on the same socket. */
  const typing = useTypists()
  const say = useRef<((word: string) => void) | null>(null)
  const sayTyping = useSayTyping(say)
  /* And the agents at work in it. */
  const agents = useAgentsWorking(roomId)
  // biome-ignore lint/correctness/useExhaustiveDependencies: typing's handlers only set its state
  useEffect(() => {
    if (!roomId) return
    typing.clear()
    /* Opened again when it drops, and the room read again when it is back —
       `data/socket.ts`. */
    const again = () => {
      void load()
      setBeat((b) => b + 1)
    }
    /* Opened again after a drop: what it missed of the agents too. */
    const reopened = () => {
      again()
      void agents.read()
    }
    const word = (ev: MessageEvent) => {
      type Word = { kind?: string; payload?: { actor_id?: string; author_id?: string; thread?: string | null } }
      const said = ((): Word | null => {
        try {
          return JSON.parse(String(ev.data)) as Word
        } catch {
          return null
        }
      })()
      /* Somebody typing is not something that happened to the room: it is
         drawn, and nothing is read again for it. */
      if (said?.kind === 'typing') {
        if (said.payload?.actor_id) typing.heard(said.payload.actor_id, said.payload.thread ?? null)
        return
      }
      /* An agent at work is drawn too, and only its list is read again. */
      if (said?.kind === 'agent.working') {
        void agents.read()
        return
      }
      if (said?.kind === 'message' && said.payload?.author_id) {
        typing.said(said.payload.author_id)
        agents.said(said.payload.author_id)
      }
      again()
    }
    const socket = keepOpen(`/ws/conversations/${roomId}`, word, reopened)
    say.current = socket.send
    return () => {
      say.current = null
      socket.stop()
    }
  }, [roomId, load])

  /*
   * Before the frame is painted, not after it.
   *
   * As an effect this ran once the browser had already drawn the list at the
   * top, so every open showed the oldest messages for one frame and then
   * jumped to the newest. That jump is the whole of what a room opening
   * "feels wrong" is made of — the request had been fast for a while by
   * then.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: kept at the bottom when a message arrives; pin reads refs
  useLayoutEffect(() => {
    /* Only while they are at the bottom — which they are until they scroll
       away. Jumping somebody to the newest message because another one
       arrived is taking the page out of their hands while they read it. */
    if (!atBottom.current || keep.current !== null) return
    /*
     * At the line, when there is one, and at the newest message otherwise.
     *
     * Opening at the bottom of twelve unread messages means scrolling up to
     * find where they started, which is the thing the line is for. Put at
     * the top of the sheet rather than in the middle: what is under it is
     * what has not been read, and it should be the next thing read. A room
     * with one unread message cannot scroll that far and lands at the
     * bottom anyway, which is also right.
     */
    if (roomId && placed.current !== roomId) {
      const line = sheet.current?.querySelector('[data-unread-line]')
      if (line) {
        placed.current = roomId
        line.scrollIntoView({ block: 'start' })
        atBottom.current = false
        return
      }
      if (ready) placed.current = roomId
    }
    pin()
  }, [messages.length, ready, roomId])

  /*
   * And a page read back is put under the same pixel it was read from.
   *
   * After the rows are in the document and before the frame is painted, so
   * nothing is ever drawn in the wrong place. If that lands near the top
   * again — a short page, or a sheet taller than what arrived — it asks for
   * the next one, because a reader holding at the top sends no further
   * scroll events to ask with.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: the place is put back after the older messages are drawn, which is when messages changes
  useLayoutEffect(() => {
    const box = sheet.current
    if (!box || keep.current === null) return
    box.scrollTop = box.scrollHeight - keep.current
    keep.current = null
    fetching.current = false
    if (box.scrollTop < 400) void older()
  }, [messages, older])
  return {
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
    typists: typing.typists,
    working: agents.working,
    sayTyping,
  } as const
}
export type RoomHistory = ReturnType<typeof useRoomHistory>
