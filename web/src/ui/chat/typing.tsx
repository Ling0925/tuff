import { useCallback, useEffect, useRef, useState } from 'react'
import { type AgentInRoom, type PersonInWorkspace } from '@tracker/shared-schema'
import { api } from '../../data/api.js'
import { CHAT as W } from '../../words/chat.js'

/*
 * Who is typing.
 *
 * Heard on the room's socket, kept here for six seconds after the last word
 * from each person, and drawn under the line in a slot that is always
 * there, so the line never moves when somebody starts or stops. An agent at
 * work in the room is said in the same slot.
 */

/** How long a name stays after the last word from them. */
const STAYS = 6000
/** How often a window says its own person is typing, at most. */
const SAYS_EVERY = 3000

export type Typist = { id: string; thread: string | null; at: number }

/** The typists, with what the socket heard folded in and the stale let go. */
export function useTypists() {
  const [typists, setTypists] = useState<Typist[]>([])
  /* The next one to go, gone when its time comes. */
  useEffect(() => {
    if (typists.length === 0) return
    const next = Math.min(...typists.map((t) => t.at)) + STAYS - Date.now()
    const t = setTimeout(() => setTypists((had) => had.filter((x) => Date.now() - x.at < STAYS)), Math.max(0, next) + 50)
    return () => clearTimeout(t)
  }, [typists])
  return {
    typists,
    heard(id: string, thread: string | null) {
      setTypists((had) => [...had.filter((x) => !(x.id === id && x.thread === thread)), { id, thread, at: Date.now() }])
    },
    /** A message of theirs arrived: they have stopped. */
    said(id: string) {
      setTypists((had) => (had.some((x) => x.id === id) ? had.filter((x) => x.id !== id) : had))
    },
    clear() {
      setTypists([])
    },
  }
}

/**
 * Saying that this person is typing, at most once every three seconds per
 * room or thread. `send` is the room's socket.
 */
export function useSayTyping(send: React.RefObject<((word: string) => void) | null>) {
  const last = useRef(new Map<string, number>())
  return (thread: string | null) => {
    const key = thread ?? ''
    const now = Date.now()
    if (now - (last.current.get(key) ?? 0) < SAYS_EVERY) return
    last.current.set(key, now)
    send.current?.(thread ? `typing ${thread}` : 'typing')
  }
}

/**
 * The agents at work in a room.
 * Read when the room opens and again when its socket says
 * `agent.working`; one of them writing in the room has answered, and is let
 * go at once, before the server's own word. Each goes at its `until`.
 */
export function useAgentsWorking(roomId: string | null) {
  const [working, setWorking] = useState<AgentInRoom[]>([])
  const asked = useRef(0)
  const read = useCallback(async () => {
    if (!roomId) return
    const n = ++asked.current
    try {
      const r = await api<{ working: AgentInRoom[] }>(`/conversations/${roomId}/working`)
      /* Only the newest answer: two words close together must not land
         the older answer last. */
      if (n === asked.current) setWorking(r.working)
    } catch {
      /* Nothing said is the same as nobody at work. */
    }
  }, [roomId])
  useEffect(() => {
    setWorking([])
    void read()
  }, [read])
  /* The next to go, gone when its time comes. */
  useEffect(() => {
    if (working.length === 0) return
    const next = Math.min(...working.map((w) => Date.parse(w.until))) - Date.now()
    const t = setTimeout(() => setWorking((had) => had.filter((w) => Date.parse(w.until) > Date.now())), Math.max(0, next) + 50)
    return () => clearTimeout(t)
  }, [working])
  return {
    working,
    read,
    /** A message of theirs arrived: they have answered. */
    said(id: string) {
      setWorking((had) => (had.some((w) => w.agent_id === id) ? had.filter((w) => w.agent_id !== id) : had))
    },
  }
}

/** Whether an agent at work belongs on this line: the room's, or a thread's. */
function here(w: AgentInRoom, thread: string | null) {
  return thread === null ? w.thread_id === null : w.thread_id === thread || (w.thread_id === null && w.message_id === thread)
}

/** What the line says of the agents at work on it, or nothing. */
export function workingWords(working: AgentInRoom[], thread: string | null): string {
  const on = working.filter((w) => here(w, thread))
  if (on.length === 0) return ''
  const one = on.length === 1 ? on[0]! : null
  if (one?.doing) return W.agentDoing(one.name, one.doing)
  return W.working(on.map((w) => w.name))
}

/**
 * The slot under a line: always a line tall, the words faded in and out in
 * it. Only the people this room knows, and never the reader.
 */
export function TypingLine({
  typists,
  thread,
  people,
  meId,
  working = [],
}: {
  typists: Typist[]
  thread: string | null
  people: PersonInWorkspace[]
  meId?: string | undefined
  /** Agents at work here — said when nobody is typing. */
  working?: AgentInRoom[]
}) {
  const names = typists
    .filter((t) => t.thread === thread && t.id !== meId)
    .map((t) => people.find((p) => p.actor_id === t.id)?.name)
    .filter((n): n is string => Boolean(n))
  /* The last words kept while they fade, so the line does not empty first
     and then fade nothing. */
  const [shown, setShown] = useState('')
  /* Somebody typing is said first: it is over in seconds, and the agent's
     line comes back the moment they stop. The words are set, not
     animated: the slot fades in once, and a new status only changes them. */
  const busy = names.length ? '' : workingWords(working, thread)
  const said = names.length ? W.typing(names) : busy
  if (said && said !== shown) setShown(said)
  return (
    <div
      data-typing={names.length ? '' : undefined}
      data-working={busy ? '' : undefined}
      title={busy || undefined}
      aria-live="polite"
      className="flex h-5 shrink-0 items-center truncate px-4 text-sm text-ink-3 transition-opacity duration-200 ease-[var(--ease-out)] motion-reduce:transition-none"
      style={{ opacity: said ? 1 : 0 }}
    >
      {said || shown}
    </div>
  )
}
