import { useEffect, useRef, useState } from 'react'
import { besideOf } from '../../data/route.js'
import { recall } from '../../data/memory.js'
import { warmRoom } from '../../data/warm.js'
import { CHAT as W } from '../../words/chat.js'
import { Chat } from '../Chat.jsx'
import { Round } from '../chat/roomPeople.jsx'
import { type Room } from '../Sidebar.jsx'
import { RoomBar } from './shell.jsx'
import { BAR } from '../../data/words.js'
import { Resizer, useWidth } from '../kit.jsx'

/** How long the panel takes to open or shut — the column's own time. */
const MS = 200

/*
 * How wide the panel may be: 400 to start with, which is a reading measure
 * already; down to 320, where a line of chat is still a sentence; and up to
 * 720 but never past half the window, so the work it sits beside is always
 * the larger of the two.
 */
const WIDTH = 400
const NARROWEST = 320
const WIDEST = 720

/**
 * A conversation beside the work — any room, opened from the Chat column,
 * and an agent's from where the agent is.
 *
 * The room itself, in a sheet of its own on the right that pushes the work
 * aside: the frame widens from nothing while the work narrows by the same
 * amount in the same frames, and the sheet inside it, fixed at its width,
 * rides in on the work's edge. Shutting runs the same path back.
 */
export function Beside({
  id,
  rooms,
  meId,
  canMakeTask = false,
  onClose,
  onFull,
  onRoomsChanged,
}: {
  /** The conversation to hold beside the work, or null for none. */
  id: string | null
  rooms: Room[]
  meId: string
  /** `task.create` on the room's project, for Make a task on a message. */
  canMakeTask?: boolean
  onClose: () => void
  onFull: (id: string) => void
  onRoomsChanged: () => Promise<void>
}) {
  /* The room drawn, which outlives `id` by the fifth of a second it takes
     to fold away, and waits for it by up to 400 ms so it opens with its
     conversation in it rather than as a sheet that fills. */
  const [shown, setShown] = useState<string | null>(null)
  const [shutting, setShutting] = useState(false)
  /* Opened by the address the window loaded with: there already, with no
     slide — the window opening on what it showed last. */
  const atLoad = useRef<string | null>(besideOf())
  const [still, setStill] = useState(false)
  /* Kept on this machine, as the columns' widths are — `useWidth`. */
  const { width, set: setWidth, initial } = useWidth('beside-width', WIDTH, NARROWEST, WIDEST)
  /* Held in the hand: the frame follows the pointer, not its own easing. */
  const [dragging, setDragging] = useState(false)

  // biome-ignore lint/correctness/useExhaustiveDependencies: what is shown follows the id asked for, not itself
  useEffect(() => {
    if (!id) {
      if (!shown) return
      if (!matchMedia('(prefers-reduced-motion: no-preference)').matches) {
        setShown(null)
        return
      }
      setShutting(true)
      const t = setTimeout(() => {
        setShown(null)
        setShutting(false)
      }, MS)
      return () => clearTimeout(t)
    }
    if (id === shown && !shutting) return
    let alive = true
    const show = () => {
      if (!alive) return
      setStill(atLoad.current === id && !shown)
      atLoad.current = null
      setShutting(false)
      setShown(id)
    }
    if (recall(`room-messages:${id}`) !== null) show()
    else {
      void Promise.race([warmRoom(id).catch(() => {}), new Promise((done) => setTimeout(done, 400))]).then(show)
    }
    return () => {
      alive = false
    }
  }, [id])

  /* Still only for the frame it arrives in: after that it shuts the way
     it would have opened. */
  useEffect(() => {
    if (!still) return
    let second = 0
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setStill(false))
    })
    return () => {
      cancelAnimationFrame(first)
      cancelAnimationFrame(second)
    }
  }, [still])

  if (!shown) return null
  return (
    <div
      data-beside={shown}
      data-beside-shutting={shutting || undefined}
      data-beside-still={still || dragging || undefined}
      className="beside flex shrink-0 overflow-hidden"
      /* The row's gap is inside the frame, as a child that folds with it:
         the row's own gap would stand there at once and push the work a
         step before the panel moved. The width is the reader's, and never
         past half the window — the one rule says it to the frame and the
         sheet both, so the two cannot disagree. */
      style={
        {
          marginLeft: 'calc(-1 * var(--lift))',
          '--beside-w': `min(${width}px, 50vw)`,
        } as React.CSSProperties
      }
    >
      <div aria-hidden className="shrink-0" style={{ width: 'var(--lift)' }} />
      <div className="relative flex shrink-0">
        {/* On the sheet's left edge, half of it over the gap: the panel
            grows into the work, so a drag left widens it. Double-click puts
            it back to 400. */}
        <Resizer
          side="left"
          label={BAR.besideWidth}
          width={width}
          onChange={(n) => setWidth(Math.min(n, Math.floor(window.innerWidth / 2)))}
          onReset={() => setWidth(initial)}
          onGrab={() => setDragging(true)}
          onDone={() => setDragging(false)}
          min={NARROWEST}
          max={WIDEST}
        />
        <section
          data-beside-panel
          aria-label={W.openBeside}
          className="flex shrink-0 flex-col overflow-hidden"
          style={{ width: 'var(--beside-w)', background: 'var(--chrome)', borderRadius: 'var(--r-lift)' }}
        >
          <RoomBar>
            <Chat
              key={shown}
              conversationId={shown}
              all={rooms}
              meId={meId}
              canMakeTask={canMakeTask}
              onRoomsChanged={onRoomsChanged}
              onRoomGone={onClose}
              ends={
                <>
                  <button
                    type="button"
                    aria-label={W.openInChat}
                    title={W.openInChat}
                    data-testid="beside-full"
                    onClick={() => onFull(shown)}
                    className="flex shrink-0 transition-transform active:scale-[0.94]"
                  >
                    <Round icon="grow" />
                  </button>
                  <button
                    type="button"
                    aria-label={W.close}
                    title={W.close}
                    data-testid="beside-close"
                    onClick={onClose}
                    className="flex shrink-0 transition-transform active:scale-[0.94]"
                  >
                    <Round icon="close" />
                  </button>
                </>
              }
            />
          </RoomBar>
        </section>
      </div>
    </div>
  )
}
