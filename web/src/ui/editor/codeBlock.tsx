import { useEffect, useState } from 'react'
import {
  type AnyExtension,
  type Editor as Tip,
  getExtensionField,
  type Node as TipNode,
  NodeViewContent,
  type NodeViewProps,
  NodeViewWrapper,
  ReactNodeViewRenderer,
} from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import type { Node as Prose } from '@tiptap/pm/model'
import { gutterFor, languageName as nameOf, litNow, loadLit } from '../../data/code.js'
import { CODE as W } from '../../words/code.js'
import { Icon } from '../glyphs.jsx'
import { CodeBar, CodeOptions, CopyCode, LanguagePick } from '../code.jsx'

/**
 * A code block in the editor: its language, wrapped or numbered lines, and
 * a bar to set them.
 *
 * The node is StarterKit's own code block, taken out of the kit and given
 * two attributes and a view: `wrap` and `lineNumbers`, false unless said,
 * beside the `language` it always had. Taken out rather than replaced, so
 * its keys, its ``` rule and its paste stay what they were; `Editor.tsx`
 * turns the kit's copy off and puts this one in.
 *
 * The colours are TipTap's lowlight plugin, which arrives with the
 * highlighter (`data/lit.ts`) after the editor is made. A plugin of the
 * editor's own stands in its place from the start and runs it once it has
 * come, so the editor is never made again and nothing in it moves: the
 * words are in the body's ink until then, the same size.
 */

/* The code block the kit would have made. `addExtensions` is how the kit
   names what it holds; asked once, outside any editor. */
const kit = getExtensionField<(() => AnyExtension[]) | undefined>(StarterKit, 'addExtensions', {
  name: StarterKit.name,
  options: StarterKit.options,
  storage: {},
})
const Kept = kit?.().find((e) => e.name === 'codeBlock') as TipNode | undefined
if (!Kept) throw new Error('StarterKit has no code block')

export const CodeBlock = Kept.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      /* Long lines wrapped at the block's edge instead of scrolled. */
      wrap: {
        default: false,
        parseHTML: (el: HTMLElement) => el.hasAttribute('data-wrap'),
        renderHTML: (a: { wrap?: unknown }) => (a.wrap === true ? { 'data-wrap': '' } : {}),
      },
      /* A number beside each line. */
      lineNumbers: {
        default: false,
        parseHTML: (el: HTMLElement) => el.hasAttribute('data-line-numbers'),
        renderHTML: (a: { lineNumbers?: unknown }) => (a.lineNumbers === true ? { 'data-line-numbers': '' } : {}),
      },
    }
  },
  addNodeView() {
    return ReactNodeViewRenderer(CodeView, {
      /* A press on the bar is the bar's, not a place for the caret. */
      stopEvent: ({ event }) => !!(event.target as HTMLElement | null)?.closest?.('[data-node-control]'),
    })
  },
  addProseMirrorPlugins() {
    return [...(this.parent?.() ?? []), numbers(), colours(this.editor)]
  },
})

/* --------------------------------------------------------------- the view */

function CodeView({ node, editor, getPos }: NodeViewProps) {
  const text = node.textContent
  const count = text.split('\n').length
  const wrap = node.attrs.wrap === true
  const numbered = node.attrs.lineNumbers === true
  const writable = editor.isEditable
  const inside = useCaretInside(editor, getPos)
  /* While a list or the switches are open from the bar, the bar stays. */
  const [held, setHeld] = useState(0)
  const hold = (open: boolean) => setHeld((n) => Math.max(0, n + (open ? 1 : -1)))

  /** Written into the block now, as a picture's resize is: one step of undo, saved at once. */
  const set = (attrs: Record<string, unknown>) => {
    const at = getPos()
    if (typeof at !== 'number' || !editor.isEditable) return
    const tr = editor.state.tr.setNodeMarkup(at, undefined, { ...node.attrs, ...attrs }).setMeta('settle', true)
    editor.view.dispatch(tr)
  }

  return (
    <NodeViewWrapper
      className="code-block"
      data-code-block
      data-wrap={wrap || undefined}
      data-lines={numbered || undefined}
      data-active={inside || held > 0 || undefined}
      {...(writable ? {} : { 'data-read': '' })}
      style={numbered ? ({ '--gutter': `${gutterFor(count)}px` } as React.CSSProperties) : undefined}
    >
      <CodeBar>
        {writable ? (
          <>
            <LanguagePick value={node.attrs.language} onPick={(id) => set({ language: id })} onOpen={hold} />
            <CodeOptions
              wrap={wrap}
              lines={numbered}
              onWrap={(on) => set({ wrap: on })}
              onLines={(on) => set({ lineNumbers: on })}
              onOpen={hold}
            />
          </>
        ) : (
          <ReadName language={node.attrs.language} />
        )}
        <CopyCode text={() => node.textContent} />
        {writable && (
          <>
            <span aria-hidden className="code-bar-rule" />
            <button
              type="button"
              data-code-remove
              aria-label={W.remove}
              title={W.remove}
              className="code-tool"
              onClick={() => {
                const at = getPos()
                if (typeof at !== 'number' || !editor.isEditable) return
                editor.view.dispatch(editor.state.tr.delete(at, at + node.nodeSize).setMeta('settle', true))
                editor.view.focus()
              }}
            >
              <Icon name="trash" size={16} />
            </button>
          </>
        )}
      </CodeBar>
      <pre spellCheck={false}>
        <NodeViewContent<'code'> as="code" style={{ whiteSpace: wrap ? 'pre-wrap' : 'pre' }} />
      </pre>
    </NodeViewWrapper>
  )
}

/** The language on a block nobody here can change: its name, or nothing for none. */
function ReadName({ language }: { language: unknown }) {
  const name = nameOf(language)
  return name ? (
    <span className="code-name" data-code-name>
      {name}
    </span>
  ) : null
}

/** Whether the caret is in this block, in an editor that has it. */
function useCaretInside(editor: Tip, getPos: () => number | undefined): boolean {
  const [inside, setInside] = useState(false)
  useEffect(() => {
    const look = () => {
      const at = getPos()
      const node = typeof at === 'number' ? editor.state.doc.nodeAt(at) : null
      if (!node || !editor.isFocused) return setInside(false)
      const { from, to } = editor.state.selection
      setInside(from > at! && to < at! + node.nodeSize)
    }
    const away = () => setInside(false)
    look()
    editor.on('selectionUpdate', look)
    editor.on('focus', look)
    editor.on('update', look)
    editor.on('blur', away)
    return () => {
      editor.off('selectionUpdate', look)
      editor.off('focus', look)
      editor.off('update', look)
      editor.off('blur', away)
    }
  }, [editor, getPos])
  return inside
}

/* ------------------------------------------------------------ line numbers */

/**
 * A number at the start of each line of a numbered block: a widget, empty,
 * that says its number from CSS (`.code-ln`), so copying the code copies no
 * numbers, and drawn out of the flow beside the line it starts — wrapped,
 * a line's number stands by its first row.
 */
function numbered(doc: Prose): DecorationSet {
  const out: Decoration[] = []
  doc.descendants((node, pos) => {
    if (node.type.name !== 'codeBlock') return !node.isTextblock
    if (node.attrs.lineNumbers !== true) return false
    const text = node.textContent
    let n = 1
    out.push(lineStart(pos + 1, n))
    for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) out.push(lineStart(pos + 2 + i, ++n))
    return false
  })
  return DecorationSet.create(doc, out)
}

function lineStart(at: number, n: number): Decoration {
  return Decoration.widget(
    at,
    () => {
      const s = document.createElement('span')
      s.className = 'code-ln'
      s.dataset.n = String(n)
      s.contentEditable = 'false'
      s.setAttribute('aria-hidden', 'true')
      return s
    },
    { side: -1, key: `ln-${n}`, ignoreSelection: true, marks: [] },
  )
}

const lines = new PluginKey<DecorationSet>('codeLines')
function numbers(): Plugin {
  return new Plugin({
    key: lines,
    state: {
      init: (_, { doc }) => numbered(doc),
      apply: (tr, old) => (tr.docChanged ? numbered(tr.doc) : old),
    },
    props: { decorations: (state) => lines.getState(state) },
  })
}

/* ----------------------------------------------------------------- colours */

const lit = new PluginKey<DecorationSet | null>('codeColours')

/** Whether there is a code block anywhere in the body. */
function hasCode(doc: Prose): boolean {
  let found = false
  doc.descendants((n) => {
    if (found) return false
    if (n.type.name === 'codeBlock') found = true
    return !found && !n.isTextblock
  })
  return found
}

/**
 * TipTap's lowlight plugin, run inside this one once the highlighter is
 * here: its state is this plugin's state, and its decorations are drawn
 * from here. Until then there is no state, and nothing is coloured.
 *
 * The highlighter is asked for the first time this editor holds a code
 * block. When it arrives, a transaction that changes nothing but says so
 * starts the colours — not an edit, so nothing is saved or sent for it.
 */
function colours(editor: Tip): Plugin {
  let inner: Plugin | null = null
  const run = () => {
    if (inner) return inner
    const l = litNow()
    if (!l) return null
    inner = l.lowlightPlugin(editor)
    return inner
  }
  return new Plugin({
    key: lit,
    state: {
      init: (config, state) => run()?.spec.state?.init(config, state) ?? null,
      apply: (tr, old, before, after) => {
        const plugin = run()
        const spec = plugin?.spec.state
        if (!spec) return null
        if (old === null || tr.getMeta(lit)) return spec.init({ plugins: [] } as never, after) as DecorationSet
        return spec.apply(tr, old, before, after) as DecorationSet
      },
    },
    props: { decorations: (state) => lit.getState(state) ?? null },
    view: (view: EditorView) => {
      let gone = false
      let asked = false
      const want = (doc: Prose) => {
        if (asked || litNow() || !hasCode(doc)) return
        asked = true
        void loadLit().then(
          () => {
            if (!gone) view.dispatch(view.state.tr.setMeta(lit, true).setMeta('addToHistory', false))
          },
          () => {
            asked = false
          },
        )
      }
      want(view.state.doc)
      return {
        update: (v, before) => {
          if (v.state.doc !== before.doc) want(v.state.doc)
        },
        destroy: () => {
          gone = true
        },
      }
    },
  })
}
