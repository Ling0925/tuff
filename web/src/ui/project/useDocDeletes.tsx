import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../../data/api.js'
import { ACTS } from '../../data/words.js'
import { isKey } from '../../data/keys.js'
import { dropUndo, useUndoOffer } from '../../data/undo.js'
import { DOCS as W } from '../../words/docs.js'
import { Glass } from '../Glass.jsx'
import { type FileRow } from '../Project.jsx'

/**
 * Deleting a row in Docs, and taking it back.
 *
 * What the tasks have, for the other list: the row goes at once, a toast at
 * the foot offers it back for thirty seconds, and ⌘Z takes back the last
 * one while Docs is open. No question first, for the tasks' reason: a
 * dialog on every delete is a press everybody learns to click through, and
 * the slip it guards against is better answered by Undo.
 *
 * Held by the project rather than by the list, so a document deleted from
 * its own screen is offered back on the list it returns to.
 */
export function useDocDeletes({
  setFiles,
  load,
  active,
}: {
  setFiles: (f: (had: FileRow[] | null) => FileRow[] | null) => void
  load: () => Promise<void> | void
  /** Docs is the screen: ⌘Z is the tasks' own elsewhere. */
  active: boolean
}) {
  const [undo, setUndo] = useState<{ id: string; said: string } | null>(null)
  /* Deletes, newest last, for ⌘Z. */
  const done = useRef<string[]>([])
  /*
   * A restore waits for its delete, as a task's does: a quick Undo sent
   * ahead of the delete found nothing deleted, and the delete then landed.
   */
  const deleting = useRef(new Map<string, Promise<unknown>>())

  const remove = useCallback(
    (f: { id: string; name: string }) => {
      setFiles((had) => had && had.filter((x) => x.id !== f.id))
      setUndo({ id: f.id, said: W.deleted(f.name) })
      /* The newest delete is the one offered back — `data/undo.ts`. */
      dropUndo()
      done.current.push(f.id)
      const p = api(`/files/${f.id}`, { method: 'DELETE' }).catch(() => null)
      deleting.current.set(f.id, p)
      /* Read again either way: a refusal puts the row back. */
      void p.finally(() => {
        if (deleting.current.get(f.id) === p) deleting.current.delete(f.id)
        void load()
      })
    },
    [setFiles, load],
  )

  const back = useCallback(
    async (id: string) => {
      setUndo((u) => (u?.id === id ? null : u))
      done.current = done.current.filter((x) => x !== id)
      await deleting.current.get(id)
      await api(`/files/${id}/restore`, { method: 'POST' }).catch(() => null)
      await load()
    },
    [load],
  )

  /* The offer expires, as the tasks' does, after thirty seconds. */
  useEffect(() => {
    if (!undo) return
    const t = setTimeout(() => setUndo(null), 30_000)
    return () => clearTimeout(t)
  }, [undo])

  /* ⌘Z, by the key and not the letter; never while typing or under a dialog. */
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (!isKey(e, 'z') || !(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return
      const el = e.target as HTMLElement | null
      if (el?.isContentEditable) return
      if (el && ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return
      if (document.querySelector('[role="dialog"]')) return
      const last = done.current.at(-1)
      if (!last) return
      e.preventDefault()
      void back(last)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, back])

  /* A newer delete elsewhere — a comment's — holds the foot until it goes. */
  const elsewhere = useUndoOffer()
  const toast = active && undo && !elsewhere && (
    <div
      data-undo-toast
      className="fixed left-1/2 z-50 -translate-x-1/2"
      /* Above a phone's tabs, which are at the foot too. */
      style={{ bottom: 'calc(24px + var(--foot))' }}
      role="status"
    >
      <Glass radius={16} className="flex items-center gap-4 py-2 pr-2 pl-4">
        <span className="max-w-[320px] truncate text-base text-ink">{undo.said}</span>
        <button
          data-testid="undo-delete"
          onClick={() => void back(undo.id)}
          className="flex h-8 shrink-0 items-center px-3 text-base font-medium text-accent"
          style={{ borderRadius: 'var(--r-pill)' }}
        >
          {ACTS.undo}
        </button>
      </Glass>
    </div>
  )

  return { remove, toast } as const
}
