import { useState, useEffect } from 'react'
import { ToolbarSlot } from '../kit.jsx'
import { setPlace } from '../../data/title.js'

/**
 * A room opened from the column: a bar across the whole sheet for its name,
 * its people and its controls — the bar an open task has — and the room
 * under it. `docs/specs/room-people.md`.
 */
export function RoomBar({ children }: { children: React.ReactNode }) {
  const [bar, setBar] = useState<HTMLElement | null>(null)
  return (
    <div className="flex h-full flex-col">
      <div ref={setBar} data-room-bar className="flex shrink-0 items-center gap-2 border-b p-2" style={{ borderColor: 'var(--line)' }} />
      {/* Slack's margins on a narrow window: the room runs nearly to the
          edges, because a sentence is the thing being read and every pixel
          of frame comes out of its line. Little under the line to write on:
          the typing slot below it is already twenty of air. */}
      <div className="min-h-0 flex-1 px-6 pb-1 max-md:px-2 max-md:pb-2">
        <ToolbarSlot value={bar}>{children}</ToolbarSlot>
      </div>
    </div>
  )
}

/* Its own component so its effect has a fixed place among the hooks: the
   shell computes the title after it knows who is signed in, which is after
   the returns that hooks may not follow. */
export function WindowTitle({ title }: { title: string }) {
  useEffect(() => setPlace(title), [title])
  return null
}
