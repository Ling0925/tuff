import { Details, DetailsContent, DetailsSummary } from '@tiptap/extension-details'
import { Extension, type Editor as Tip } from '@tiptap/react'
import { Fragment, type Node as PMNode } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { EDITOR as W } from '../../words/editor.js'

/**
 * A toggle: a line that folds what is under it.
 *
 * TipTap's own, approved by name. Whether it is open is not stored
 * (`persist: false`, the extension's default): opening a toggle to read it
 * is not an edit, and a body that changed every time somebody looked
 * inside it would cost a version per look.
 *
 * Its keys are Notion's, here rather than the extension's (`ToggleKeys`):
 * the extension's Enter on a closed toggle's line made a sibling instead
 * of going in, its Enter out of the body did not fire, and there was no
 * way past a toggle that ended the document.
 */
const CHEVRON =
  '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>'

export const Toggle = [
  Details.configure({
    persist: false,
    HTMLAttributes: { class: 'toggle' },
    renderToggleButton: ({ element, isOpen }) => {
      element.setAttribute('aria-label', isOpen ? W.foldToggle : W.openToggle)
      element.setAttribute('aria-expanded', String(isOpen))
      element.setAttribute('data-toggle-button', '')
      element.setAttribute('contenteditable', 'false')
      element.className = 'toggle-button'
      if (!element.firstChild) element.innerHTML = CHEVRON
    },
  }),
  /* The empty first line says what it is for, as an empty body does. */
  DetailsSummary.configure({ HTMLAttributes: { 'data-placeholder': W.toggleTitle } }),
  /* And an empty body, said where its first line is — the words carried
     in a property, since a line cannot read its parent's attribute. */
  DetailsContent.configure({ HTMLAttributes: { style: `--toggle-empty: ${JSON.stringify(W.toggleEmpty)}` } }),
]

/** The toggle starting at `pos`, opened if it is folded. Opening is the page's, not the document's. */
export function openToggle(view: EditorView, pos: number): void {
  const dom = view.nodeDOM(pos) as HTMLElement | null
  if (!dom || dom.classList.contains('is-open')) return
  ;(dom.querySelector(':scope > button') as HTMLButtonElement | null)?.click()
}

/** Whether the toggle starting at `pos` is open on this page. */
export function isOpen(view: EditorView, pos: number): boolean {
  return Boolean((view.nodeDOM(pos) as HTMLElement | null)?.classList.contains('is-open'))
}

/** The toggle the caret's line is the first line of: its position and node. */
function summaryAt(view: EditorView): { pos: number; node: PMNode } | null {
  const { $from } = view.state.selection
  if ($from.parent.type.name !== 'detailsSummary') return null
  return { pos: $from.before($from.depth - 1), node: $from.node($from.depth - 1) }
}

/**
 * A toggle around the line the caret is on, or around the blocks chosen,
 * and nothing else — opened, the caret on its first line.
 *
 * The extension's own put the caret's block in the toggle's body; a line
 * of words becomes its first line here, as Notion's "Turn into toggle"
 * does, and the blocks after it are its body. A line in a list leaves the
 * list first: a list item has to start with a line of words.
 */
export function insertToggle(e: Tip): void {
  const { schema } = e.state
  const details = schema.nodes.details
  const summary = schema.nodes.detailsSummary
  const content = schema.nodes.detailsContent
  const paragraph = schema.nodes.paragraph
  if (!details || !summary || !content || !paragraph) return
  for (let tries = 0; tries < 4; tries++) {
    const { $from, $to } = e.state.selection
    const range = $from.blockRange($to)
    if (!range) return
    const blocks = e.state.doc.slice(range.start, range.end).content
    const first = blocks.firstChild
    /* The first block's words are the toggle's line when it is a line of plain words. */
    let lineOfWords = Boolean(first && (first.type.name === 'paragraph' || first.type.name === 'heading'))
    first?.forEach((n) => {
      if (!n.isText) lineOfWords = false
    })
    const line = lineOfWords && first ? first.content : Fragment.empty
    const rest: PMNode[] = []
    blocks.forEach((b, _o, i) => {
      if (!(i === 0 && lineOfWords)) rest.push(b)
    })
    const node = details.create(null, [summary.create(null, line), content.create(null, rest.length ? rest : [paragraph.create()])])
    if (!range.parent.canReplace(range.startIndex, range.endIndex, Fragment.from(node))) {
      /* In a list: out of it, and try again. */
      if (range.parent.type.name !== 'listItem' || !e.commands.liftListItem('listItem')) return
      continue
    }
    const tr = e.state.tr.replaceWith(range.start, range.end, node)
    tr.setSelection(TextSelection.create(tr.doc, range.start + 2 + line.size)).scrollIntoView()
    e.view.dispatch(tr)
    e.view.focus()
    openToggle(e.view, range.start)
    return
  }
}

/**
 * A toggle's keys, as in Notion.
 *
 * - **Enter on its line** goes into its body, opening it: the words after
 *   the caret go with it, onto the body's first line.
 * - **Enter on an empty last line of its body** leaves it, on a line after it.
 * - **Backspace at the start of its line** turns it back into words: its
 *   line a paragraph, its body the blocks after that.
 */
export const ToggleKeys = Extension.create({
  name: 'toggleKeys',
  priority: 200,
  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const view = editor.view
        if (!view.state.selection.empty) return false
        const paragraph = view.state.schema.nodes.paragraph!
        const at = summaryAt(view)
        if (at) {
          /* Opened first, so the body the caret goes into is on the page. */
          openToggle(view, at.pos)
          const { state } = view
          const { $from } = state.selection
          /* Into the body, with what followed the caret. */
          const after = $from.parent.content.cut($from.parentOffset)
          const body = at.node.child(1)
          const firstEmpty = body.firstChild?.type === paragraph && body.firstChild.content.size === 0
          let tr = state.tr.delete($from.pos, $from.end())
          const into = tr.mapping.map(at.pos + 1 + at.node.child(0).nodeSize + 1)
          if (!firstEmpty || after.size > 0) tr = tr.insert(into, paragraph.create(null, after))
          view.dispatch(tr.setSelection(TextSelection.create(tr.doc, into + 1)).scrollIntoView())
          return true
        }
        /* Out of the body, from its empty last line. */
        const { state } = view
        const { $from } = state.selection
        const depth = $from.depth
        if (depth < 3) return false
        const box = $from.node(depth - 1)
        if (box.type.name !== 'detailsContent') return false
        if ($from.parent.type !== paragraph || $from.parent.content.size !== 0) return false
        if ($from.index(depth - 1) !== box.childCount - 1) return false
        const outer = $from.node(depth - 3)
        const index = $from.index(depth - 3) + 1
        if (!outer.canReplaceWith(index, index, paragraph)) return false
        const tr = state.tr
        /* The empty line goes, unless it is all the body has — a body holds at least one. */
        if (box.childCount > 1) tr.delete($from.before(), $from.after())
        const end = tr.mapping.map($from.after(depth - 2))
        tr.insert(end, paragraph.create())
        view.dispatch(tr.setSelection(TextSelection.create(tr.doc, end + 1)).scrollIntoView())
        return true
      },
      Backspace: ({ editor }) => {
        const view = editor.view
        const { state } = view
        const sel = state.selection
        const at = summaryAt(view)
        if (!at || !sel.empty || sel.$from.parentOffset !== 0) return false
        const paragraph = state.schema.nodes.paragraph!
        const body = at.node.child(1)
        const blocks: PMNode[] = [paragraph.create(null, at.node.child(0).content)]
        /* A body of one empty line was never written in: it goes with the toggle. */
        const unwritten = body.childCount === 1 && body.firstChild!.type === paragraph && body.firstChild!.content.size === 0
        if (!unwritten) body.forEach((b) => blocks.push(b))
        const tr = state.tr.replaceWith(at.pos, at.pos + at.node.nodeSize, blocks)
        tr.setSelection(TextSelection.create(tr.doc, at.pos + 1))
        view.dispatch(tr.scrollIntoView())
        return true
      },
    }
  },
})
