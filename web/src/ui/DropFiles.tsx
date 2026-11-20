import { useState } from 'react'

/*
 * Files dropped on a screen that has a body — `docs/specs/drop-files.md`.
 *
 * The editor takes a file let go on its words; this is the rest of the
 * screen around them, which used to take nothing, and the page beyond,
 * where a miss opened the file in the tab in place of the product.
 */

/* Something dragged inside the page — a card, a picture in a body being
   moved — is not a file being added, though Chrome lists an image dragged
   off the page as one. A file from outside starts no drag here. */
let fromPage = false

/** Whether a drag carries files from outside the page. */
function carriesFiles(data: DataTransfer | null): boolean {
  return !fromPage && Boolean(data?.types.includes('Files'))
}

/**
 * Once, for the whole page: a file let go where nothing takes it is
 * refused rather than opened in the tab. What takes files has already
 * said so by the time the event reaches the window.
 */
export function guardDrops() {
  window.addEventListener('dragstart', () => {
    fromPage = true
  })
  /* Not only on its end: a drag whose source left the page before it was
     let go never says so, and no pointer moves during one. Not on the
     drop, which the screen still has to read it on. */
  for (const over of ['dragend', 'pointermove']) {
    window.addEventListener(
      over,
      () => {
        fromPage = false
      },
      true,
    )
  }
  window.addEventListener('dragover', (e) => {
    if (e.defaultPrevented || !e.dataTransfer?.types.includes('Files')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'none'
  })
  window.addEventListener('drop', (e) => {
    if (!e.defaultPrevented && e.dataTransfer?.types.includes('Files')) e.preventDefault()
  })
}

/* Over words that can be written in, the editor shows where the file goes
   and takes it there — the body's, or a comment being written. */
function overWords(target: EventTarget | null): boolean {
  return Boolean((target as Element | null)?.closest?.('[contenteditable="true"]'))
}

/**
 * The handlers for a screen that takes files anywhere on it, and whether
 * one is held over it — not over words, which take it themselves.
 */
export function useDropFiles(on: boolean, take: (files: File[]) => void) {
  const [held, setHeld] = useState(false)
  return {
    held,
    handlers: {
      onDragOver: (e: React.DragEvent) => {
        if (!on || !carriesFiles(e.dataTransfer)) return
        e.preventDefault()
        const words = overWords(e.target)
        if (!words) e.dataTransfer.dropEffect = 'copy'
        setHeld(!words)
      },
      onDragLeave: (e: React.DragEvent) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHeld(false)
      },
      onDrop: (e: React.DragEvent) => {
        setHeld(false)
        /* On the words the editor has already taken them. */
        if (e.defaultPrevented || !on || !carriesFiles(e.dataTransfer)) return
        const files = Array.from(e.dataTransfer.files)
        if (files.length === 0) return
        e.preventDefault()
        take(files)
      },
    },
  }
}

/**
 * Said across the screen while files are held over it, where they will go.
 * `bleed` for a screen whose scrolling runs out into the pane's gutter: the
 * ground stands eight in from the pane's edge rather than the words'.
 */
export function DropHere({ said, bleed = false }: { said: string; bleed?: boolean }) {
  return (
    <div
      aria-hidden
      data-drop-here
      className="pointer-events-none absolute inset-2 z-10 flex items-center justify-center text-base font-medium"
      style={{
        ...(bleed ? { left: 'calc(8px - var(--gutter))', right: 'calc(8px - var(--gutter))' } : {}),
        borderRadius: 12,
        background: 'color-mix(in oklch, var(--accent) 8%, transparent)',
        boxShadow: 'inset 0 0 0 2px color-mix(in oklch, var(--accent) 48%, transparent)',
        color: 'var(--accent)',
      }}
    >
      {said}
    </div>
  )
}
