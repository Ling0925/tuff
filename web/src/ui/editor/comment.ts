import { Mark, mergeAttributes, type Editor as Tip } from '@tiptap/react'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import * as Y from 'yjs'
import { absolutePositionToRelativePosition, ySyncPluginKey } from 'y-prosemirror'
import { cleanLine, lineThreads } from '@tracker/shared-schema'

/**
 * The words a thread is on.
 *
 * A mark in the body holding every thread's id on those words, written by
 * the server when the comment is made. Here it is only drawn: a span that
 * names its threads, tinted by the screen for the threads that are open
 * (`FileDetail`), so a resolved thread's words go plain without the body
 * changing. Not inclusive: a word typed after a commented sentence is not
 * part of what was commented on.
 */
export const CommentMark = Mark.create({
  name: 'comment',
  inclusive: false,
  addAttributes: () => ({
    ids: { default: '', parseHTML: (el) => el.getAttribute('data-comment') ?? '', renderHTML: () => ({}) },
  }),
  parseHTML: () => [{ tag: 'span[data-comment]' }],
  renderHTML: ({ mark, HTMLAttributes }) => ['span', mergeAttributes(HTMLAttributes, { 'data-comment': mark.attrs.ids }), 0],
  addProseMirrorPlugins: () => [waiting],
})

/*
 * The words just chosen, tinted while the comment is on its way: the mark
 * is the server's to write, and the tint is there before it answers.
 * Mapped through every edit, so somebody typing before the words does not
 * leave the tint behind on the wrong ones.
 */
const waitingKey = new PluginKey<DecorationSet>('waiting-comment')
const waiting = new Plugin<DecorationSet>({
  key: waitingKey,
  state: {
    init: () => DecorationSet.empty,
    apply(tr, set) {
      const said = tr.getMeta(waitingKey) as { from: number; to: number } | null | undefined
      if (said === null) return DecorationSet.empty
      if (said) return DecorationSet.create(tr.doc, [Decoration.inline(said.from, said.to, { 'data-comment-waiting': '' })])
      return set.map(tr.mapping, tr.doc)
    },
  },
  props: { decorations: (state) => waitingKey.getState(state) },
})

/** Tint the selection as waiting, or take the tint away. */
export function wait(e: Tip, range: { from: number; to: number } | null): void {
  e.view.dispatch(e.state.tr.setMeta(waitingKey, range).setMeta('addToHistory', false))
}

/** Where the waiting tint stands now, after whatever was typed since. */
export function waitingRange(e: Tip): { from: number; to: number } | null {
  const set = waitingKey.getState(e.state)
  const d = set?.find()[0]
  return d ? { from: d.from, to: d.to } : null
}

const b64 = (u: Uint8Array) => {
  let s = ''
  for (const c of u) s += String.fromCharCode(c)
  return btoa(s)
}

/**
 * The selection as two Yjs relative positions, encoded — what the server
 * resolves against the shared state wherever the words have moved to by
 * the time the request lands. Null outside a document written together.
 */
export function anchorOf(e: Tip, range: { from: number; to: number }): { from: string; to: string } | null {
  const sync = ySyncPluginKey.getState(e.state) as { type?: Y.XmlFragment; binding?: { mapping: Map<unknown, unknown> } } | undefined
  if (!sync?.type || !sync.binding) return null
  const at = (pos: number) =>
    b64(Y.encodeRelativePosition(absolutePositionToRelativePosition(pos, sync.type as never, sync.binding!.mapping as never)))
  return { from: at(range.from), to: at(range.to) }
}

/** Every thread id the body's marks name — what is still on words. */
export function threadsIn(e: Tip): Set<string> {
  const out = new Set<string>()
  e.state.doc.descendants((n) => {
    for (const m of n.marks) if (m.type.name === 'comment') for (const id of String(m.attrs.ids).split(/\s+/)) if (id) out.add(id)
    /* A line made into a task keeps its thread's words in the chip — `text-to-task.md`. */
    if (n.type.name === 'taskref') for (const id of lineThreads(cleanLine(n.attrs.line))) out.add(id)
  })
  return out
}
