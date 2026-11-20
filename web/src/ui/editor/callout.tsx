import { useEffect, useLayoutEffect, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Node, mergeAttributes } from '@tiptap/react'
import { EMOJI, TONES, emojiOf, toneOf, type Tone } from '../../data/callout.js'
import { EDITOR as W } from '../../words/editor.js'

/**
 * A callout: a tinted block with an emoji at its head.
 *
 * Written here rather than taken from a package: TipTap has no official
 * one, and the node is a wrapper with two attributes. It holds blocks, as
 * a quote does, so a list or a picture goes inside one as it goes anywhere,
 * and Enter on its empty last line steps out of it, as out of a quote.
 *
 * Its view is plain DOM, as TipTap's own toggle's is, not a React node view:
 * the React one wraps the words in two more elements of its own, and a
 * keystroke the browser put in between them was read back by ProseMirror as
 * a change to the document's shape — the first letter typed into a new
 * callout unwrapped it into two paragraphs.
 */
export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,
  addAttributes: () => ({
    emoji: { default: '💡' },
    tone: { default: 'grey' },
  }),
  parseHTML: () => [
    {
      tag: 'div[data-callout]',
      contentElement: '.callout-body',
      getAttrs: (el: HTMLElement) => ({ emoji: emojiOf(el.getAttribute('data-emoji')), tone: toneOf(el.getAttribute('data-tone')) }),
    },
  ],
  renderHTML: ({ node, HTMLAttributes }) => [
    'div',
    mergeAttributes(HTMLAttributes, {
      class: 'callout',
      'data-callout': '',
      'data-tone': toneOf(node.attrs.tone),
      'data-emoji': emojiOf(node.attrs.emoji),
    }),
    ['span', { class: 'callout-emoji', contenteditable: 'false' }, emojiOf(node.attrs.emoji)],
    ['div', { class: 'callout-body' }, 0],
  ],
  addNodeView() {
    return ({ node: first, editor, getPos }) => {
      let node = first
      const dom = document.createElement('div')
      dom.className = 'callout'
      dom.setAttribute('data-callout', '')
      const face = document.createElement(editor.isEditable ? 'button' : 'span')
      face.className = 'callout-emoji'
      face.setAttribute('contenteditable', 'false')
      face.setAttribute('data-callout-emoji', '')
      const body = document.createElement('div')
      body.className = 'callout-body'
      dom.append(face, body)

      /* The panel, mounted on the page while it is open. */
      let look: { root: Root; holder: HTMLElement } | null = null
      const close = (back: boolean) => {
        if (!look) return
        const was = look
        look = null
        face.setAttribute('aria-expanded', 'false')
        queueMicrotask(() => {
          was.root.unmount()
          was.holder.remove()
        })
        if (back) editor.commands.focus()
      }
      const pick = (attrs: { emoji?: string; tone?: Tone }) => {
        const at = typeof getPos === 'function' ? getPos() : undefined
        if (typeof at !== 'number') return
        editor.view.dispatch(editor.state.tr.setNodeMarkup(at, undefined, { ...node.attrs, ...attrs }))
      }
      const draw = () => {
        if (!look) return
        const box = face.getBoundingClientRect()
        look.root.render(
          <Look
            at={{ x: box.left, y: box.bottom + 4 }}
            emoji={emojiOf(node.attrs.emoji)}
            tone={toneOf(node.attrs.tone)}
            onPick={pick}
            onClose={close}
          />,
        )
      }
      const show = () => {
        dom.setAttribute('data-tone', toneOf(node.attrs.tone))
        dom.setAttribute('data-emoji', emojiOf(node.attrs.emoji))
        face.textContent = emojiOf(node.attrs.emoji)
        draw()
      }
      if (face instanceof HTMLButtonElement) {
        face.type = 'button'
        face.setAttribute('aria-label', W.calloutLook)
        face.setAttribute('aria-expanded', 'false')
        face.addEventListener('mousedown', (e) => e.preventDefault())
        face.addEventListener('click', () => {
          if (look) return close(false)
          const holder = document.createElement('div')
          document.body.append(holder)
          look = { root: createRoot(holder), holder }
          face.setAttribute('aria-expanded', 'true')
          draw()
        })
      }
      show()

      return {
        dom,
        contentDOM: body,
        update: (next) => {
          if (next.type !== node.type) return false
          node = next
          show()
          return true
        },
        /* The emoji is the view's own: not a press to turn into a selection. */
        stopEvent: (e) => face.contains(e.target as globalThis.Node),
        ignoreMutation: (m) => {
          if (m.type === 'selection') return false
          return face.contains(m.target) || (m.target === dom && m.type === 'attributes')
        },
        destroy: () => close(false),
      }
    }
  },
})

const TONE_SAID: Record<Tone, string> = {
  grey: W.toneGrey,
  blue: W.toneBlue,
  green: W.toneGreen,
  yellow: W.toneYellow,
  red: W.toneRed,
}

/**
 * The emoji and the tones, under the emoji that opened them.
 *
 * Drawn whole on its first frame — eight faces and five swatches, nothing
 * to wait for — and kept inside the window. Escape or a press anywhere else
 * puts it away; a pick keeps it up, so the emoji and the tone can both be
 * chosen in one visit.
 */
function Look({
  at,
  emoji,
  tone,
  onPick,
  onClose,
}: {
  at: { x: number; y: number }
  emoji: string
  tone: Tone
  onPick: (attrs: { emoji?: string; tone?: Tone }) => void
  onClose: (back: boolean) => void
}) {
  const panel = useRef<HTMLDivElement | null>(null)
  useLayoutEffect(() => {
    const el = panel.current
    if (!el) return
    const box = el.getBoundingClientRect()
    if (box.right > window.innerWidth - 8) el.style.left = `${Math.max(8, window.innerWidth - 8 - box.width)}px`
    if (box.bottom > window.innerHeight - 8) el.style.top = `${Math.max(8, at.y - box.height - 40)}px`
  }, [at])
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose(true)
      }
    }
    const press = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null
      if (panel.current?.contains(t) || t?.closest?.('[data-callout-emoji]')) return
      onClose(false)
    }
    window.addEventListener('keydown', key, true)
    window.addEventListener('pointerdown', press, true)
    return () => {
      window.removeEventListener('keydown', key, true)
      window.removeEventListener('pointerdown', press, true)
    }
  }, [onClose])
  return (
    <div
      ref={panel}
      role="dialog"
      aria-label={W.calloutLook}
      data-node-control
      data-callout-look
      className="fixed z-[70] flex w-[272px] flex-col gap-2 p-1"
      style={{ left: at.x, top: at.y, background: 'var(--float)', borderRadius: 'var(--r-panel)', boxShadow: 'var(--float-shadow)' }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="grid grid-cols-8">
        {EMOJI.map((e) => (
          <button
            key={e}
            type="button"
            data-callout-pick={e}
            aria-pressed={e === emoji}
            onClick={() => onPick({ emoji: e })}
            className="flex size-8 items-center justify-center rounded-[var(--r-row)] text-lg mouse:hover:bg-[var(--hover)]"
            style={{ background: e === emoji ? 'var(--track-on)' : undefined }}
          >
            {e}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2 px-2 pb-2" role="radiogroup" aria-label={W.tones}>
        {TONES.map((t) => (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={t === tone}
            aria-label={TONE_SAID[t]}
            title={TONE_SAID[t]}
            data-callout-tone={t}
            onClick={() => onPick({ tone: t })}
            className="callout-swatch size-6 rounded-full"
            data-tone={t}
            style={{ outline: t === tone ? '2px solid var(--accent)' : undefined, outlineOffset: 2 }}
          />
        ))}
      </div>
    </div>
  )
}
