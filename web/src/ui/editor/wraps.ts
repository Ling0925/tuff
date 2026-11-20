import { Extension } from '@tiptap/react'
import { Fragment, Slice, type Node as PMNode, type ResolvedPos } from '@tiptap/pm/model'
import { Plugin, PluginKey, Selection, TextSelection } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { isOpen } from './toggle.js'

/**
 * What a toggle and a callout share as blocks that hold blocks.
 *
 * - **The arrows go past their end.** One that ended the document had
 *   nothing after it, so Down and Right stopped inside it and there was no
 *   way to write after it without the mouse. From its last line — or a
 *   folded toggle's own line — Down or Right puts a line after it when
 *   there is none, and steps over a folded toggle's hidden body when
 *   there is.
 * - **Words copied out of one are words.** A copy carries the blocks it
 *   was taken from, and ProseMirror keeps a `defining` wrapper on paste:
 *   a sentence cut from a toggle's body came back as a new toggle with no
 *   line. Copied from inside one, the wrapper is left behind; only a copy
 *   of the whole of it — from the start of its first line to the end of
 *   its last — keeps it, and pastes as itself.
 */

const WRAPS = new Set(['details', 'callout'])

/** The wrapper the caret is innermost in, and its depth. */
function wrapAt($at: ResolvedPos): number | null {
  for (let d = $at.depth; d > 0; d--) if (WRAPS.has($at.node(d).type.name)) return d
  return null
}

/** Down or Right at the end of a wrapper: past it. */
function past(view: EditorView, dir: 'down' | 'right'): boolean {
  const { state } = view
  const sel = state.selection
  if (!sel.empty || !(sel instanceof TextSelection)) return false
  const $at = sel.$from
  const d = wrapAt($at)
  if (d === null) return false
  const wrap = $at.node(d)
  const start = $at.before(d)
  const folded = wrap.type.name === 'details' && !isOpen(view, start)
  /* At its end: a folded toggle's line, or the last line of what it holds. */
  if (folded) {
    if ($at.parent.type.name !== 'detailsSummary') return false
  } else {
    const last = Selection.findFrom(state.doc.resolve($at.end(d)), -1, true)
    if (!last || last.$from.start() !== $at.start()) return false
  }
  if (dir === 'right' ? $at.parentOffset !== $at.parent.content.size : !view.endOfTextblock('down')) return false
  const end = $at.after(d)
  const outer = $at.node(d - 1)
  const index = $at.index(d - 1) + 1
  if (index < outer.childCount) {
    /* Something follows: the browser goes there itself, except over a folded body. */
    if (!folded) return false
    const next = Selection.findFrom(state.doc.resolve(end), 1, true)
    if (!next) return false
    view.dispatch(state.tr.setSelection(next).scrollIntoView())
    return true
  }
  const paragraph = state.schema.nodes.paragraph!
  if (!outer.canReplaceWith(index, index, paragraph)) return false
  const tr = state.tr.insert(end, paragraph.create())
  view.dispatch(tr.setSelection(TextSelection.create(tr.doc, end + 1)).scrollIntoView())
  return true
}

/**
 * The copy, without the wrappers it was only partly taken from.
 *
 * `selection.content()` is the selection with every block it sits in, open
 * down to it; level `d` of its open start is `$from.node(d)`, of its open
 * end `$to.node(d)`. A wrapper the selection starts after its beginning,
 * or ends before its end, is taken off, and a toggle's two parts with it:
 * its line becomes a paragraph, its body's blocks stand on their own.
 */
export function plainCopy(slice: Slice, view: EditorView): Slice {
  const sel = view.state.selection
  if (!(sel instanceof TextSelection) || slice.openStart === 0) return slice
  const { doc, schema } = view.state
  const { $from, $to, from, to } = sel
  const cutAtStart = (d: number) => {
    const first = Selection.findFrom(doc.resolve($from.start(d)), 1, true)
    return Boolean(first && from > first.from)
  }
  const cutAtEnd = (d: number) => {
    const last = Selection.findFrom(doc.resolve($to.end(d)), -1, true)
    return Boolean(last && to < last.to)
  }
  let changed = false
  /** One level: its children, its edges cleaned, and how many levels each edge lost. */
  const clean = (frag: Fragment, d: number, openS: number, openE: number, gone: boolean): [Fragment, number, number] => {
    const out: PMNode[] = []
    let lostS = 0
    let lostE = 0
    frag.forEach((child, _o, i) => {
      const atStart = i === 0 && openS > 0
      const atEnd = i === frag.childCount - 1 && openE > 0
      const name = child.type.name
      const off = (WRAPS.has(name) && ((atStart && cutAtStart(d)) || (atEnd && cutAtEnd(d)))) || (gone && name === 'detailsContent')
      const [inner, s, e] = child.isTextblock
        ? [child.content, 0, 0]
        : clean(child.content, d + 1, atStart ? openS - 1 : 0, atEnd ? openE - 1 : 0, off && name === 'details')
      if (off) {
        changed = true
        inner.forEach((n) => out.push(n))
        if (atStart) lostS = 1 + s
        if (atEnd) lostE = 1 + e
        return
      }
      if (gone && name === 'detailsSummary') {
        changed = true
        out.push(schema.nodes.paragraph!.create(null, inner))
      } else out.push(child.copy(inner))
      if (atStart) lostS = s
      if (atEnd) lostE = e
    })
    return [Fragment.from(out), lostS, lostE]
  }
  const [content, lostS, lostE] = clean(slice.content, 1, slice.openStart, slice.openEnd, false)
  return changed ? new Slice(content, slice.openStart - lostS, slice.openEnd - lostE) : slice
}

export const Wraps = Extension.create({
  name: 'wraps',
  /* Before the toggle's own arrows, which put a gap cursor after a folded one. */
  priority: 200,
  addKeyboardShortcuts() {
    return {
      ArrowDown: ({ editor }) => past(editor.view, 'down'),
      ArrowRight: ({ editor }) => past(editor.view, 'right'),
    }
  },
  addProseMirrorPlugins() {
    return [new Plugin({ key: new PluginKey('wraps'), props: { transformCopied: plainCopy } })]
  },
})
