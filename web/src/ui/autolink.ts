import { Extension } from '@tiptap/react'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as Prose } from '@tiptap/pm/model'
import { addresses } from '@tracker/shared-schema'

/**
 * An address in a body open in the editor is drawn as a link —
 * `docs/specs/rich-text.md`, "Addresses".
 *
 * TipTap's own autolink marks an address as it is typed, and only then: a
 * description written through the API, an import or an agent's plain text
 * kept its addresses as words, and a task opened in the editor showed them
 * as words while the same text in a comment was a link. A decoration rather
 * than a mark, so opening a body to read it never writes it back changed;
 * the stored text stays what was written, and the reader (`Doc.tsx`) links
 * it by the same rule. ⌘-press follows it as it does any link here.
 *
 * Not in code, and not inside a link already.
 */
const key = new PluginKey<DecorationSet>('autolink')

function find(doc: Prose): DecorationSet {
  const found: Decoration[] = []
  doc.descendants((node, pos) => {
    if (node.type.spec.code) return false
    if (!node.isText) return true
    if (node.marks.some((m) => m.type.name === 'link' || m.type.spec.code)) return false
    for (const a of addresses(node.text ?? '')) {
      const from = pos + a.index
      found.push(
        Decoration.inline(from, from + a.text.length, {
          nodeName: 'a',
          href: a.href,
          target: '_blank',
          rel: 'noreferrer noopener',
          'data-autolink': '',
        }),
      )
    }
    return false
  })
  return DecorationSet.create(doc, found)
}

export const Autolink = Extension.create({
  name: 'addressLinks',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key,
        state: {
          init: (_, { doc }) => find(doc),
          apply: (tr, old) => (tr.docChanged ? find(tr.doc) : old),
        },
        props: { decorations: (state) => key.getState(state) },
      }),
    ]
  },
})
