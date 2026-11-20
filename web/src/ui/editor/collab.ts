import { Extension } from '@tiptap/react'
import * as Y from 'yjs'
import { redo, undo, yCursorPlugin, ySyncPlugin, yUndoPlugin, yXmlFragmentToProsemirrorJSON } from 'y-prosemirror'
import { FRAGMENT, type Carets } from '../../data/coedit.js'
import { fits, strangerIn } from '../../data/coeditCheck.js'
import { faceOf } from '../../data/faces.js'

/*
 * The editor bound to a document written together.
 *
 * What TipTap's Collaboration and CollaborationCaret extensions do, over
 * `y-prosemirror` itself: the sync, the carets, and an undo that takes back
 * only this page's edits. Kept in a file of its own and handed to the
 * editor as one extension, so the editor's own list of what it can do does
 * not change shape with it.
 */

export type Collab = {
  extension: Extension
  /** What the editor shows on its first frame, drawn from the shared state. */
  content: unknown
}

/** The caret of somebody else: a line in their face colour, their name over it. */
function caret(user: { id?: string; name?: string }): HTMLElement {
  const face = `var(--face-${faceOf(user.id ?? '')})`
  const el = document.createElement('span')
  el.setAttribute('data-caret', user.id ?? '')
  /* Nobody's caret is printed into the PDF. */
  el.setAttribute('data-print-skip', '')
  /* No width of its own, so the words around it do not move when it comes. */
  el.style.cssText = 'position:relative;pointer-events:none;user-select:none'
  const line = document.createElement('span')
  line.style.cssText = `position:absolute;top:0;bottom:0;left:0;width:2px;transform:translateX(-50%);background:${face}`
  const tag = document.createElement('span')
  tag.textContent = user.name ?? ''
  tag.style.cssText = `position:absolute;left:0;bottom:100%;padding:0 4px;border-radius:4px 4px 4px 0;background:${face};color:#fff;font-size:12px;line-height:16px;font-weight:500;white-space:nowrap`
  el.append('⁠', line, tag, '⁠')
  return el
}

const selection = (user: { id?: string }) => ({
  style: `background-color:color-mix(in oklch, var(--face-${faceOf(user.id ?? '')}) 24%, transparent)`,
})

/**
 * `onStranger` is told when the state holds what this editor does not
 * know; the page then stops sending and shows the document read-only.
 * `guard` is handed the check every later update is asked before it lands.
 */
export function collaboration(doc: Y.Doc, carets: Carets, onStranger: () => void, guard: (fn: (u: Uint8Array) => boolean) => void): Collab {
  const fragment = doc.getXmlFragment(FRAGMENT)
  const extension = Extension.create({
    name: 'collaboration',
    priority: 1000,
    addProseMirrorPlugins() {
      const schema = this.editor.schema
      guard((u) => strangerIn(u, schema))
      if (!fits(fragment, schema)) onStranger()
      return [ySyncPlugin(fragment), yCursorPlugin(carets as never, { cursorBuilder: caret, selectionBuilder: selection }), yUndoPlugin()]
    },
    addKeyboardShortcuts() {
      return {
        'Mod-z': () => undo(this.editor.state),
        'Mod-y': () => redo(this.editor.state),
        'Shift-Mod-z': () => redo(this.editor.state),
      }
    },
  })
  /* An empty state is an empty document, which the editor makes itself:
     a doc with no blocks at all is not one it can hold. */
  return { extension, content: fragment.length ? yXmlFragmentToProsemirrorJSON(fragment) : undefined }
}
