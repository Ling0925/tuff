import { useState, useLayoutEffect, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { WRITING } from '../../data/words.js'
import { type Editor as Tip } from '@tiptap/react'
import { type IconName, Icon } from '../glyphs.jsx'
import { EDITOR as W } from '../../words/editor.js'
import { insertToggle } from './toggle.js'
import { linkField } from '../kit.jsx'

/**
 * What `/` and the `+` both offer.
 *
 * One list, because they are one question asked two ways — somebody who
 * knows types the slash, somebody who does not presses the button, and a
 * product where the two offer different things is a product that has to
 * explain which is which.
 *
 * There is no checklist here on purpose. Ticking things off is what a task's
 * parts are for took the checklist out of the
 * product for exactly this reason, and putting one back inside a body would
 * be the third way to tick something.
 */
export type Block = {
  id: string
  said: string
  /** A glyph from the set, or a couple of letters where letters say it
      better — H1 is clearer than any drawing of a heading. */
  icon: IconName | string
  keys?: string
  run: (e: Tip) => void
}

export const BLOCKS: Block[] = [
  { id: 'h1', said: W.heading, icon: 'H1', keys: '⌘⌥1', run: (e) => e.chain().focus().toggleHeading({ level: 1 }).run() },
  { id: 'h2', said: W.subheading, icon: 'H2', keys: '⌘⌥2', run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run() },
  { id: 'bullets', said: W.bulletedList, icon: 'list', keys: '⌘⇧8', run: (e) => e.chain().focus().toggleBulletList().run() },
  { id: 'numbers', said: W.numberedList, icon: '1.', keys: '⌘⇧9', run: (e) => e.chain().focus().toggleOrderedList().run() },
  { id: 'quote', said: W.quote, icon: 'quote', run: (e) => e.chain().focus().toggleBlockquote().run() },
  /* A block that stands out and one that folds. */
  { id: 'callout', said: W.callout, icon: 'spark', run: (e) => e.chain().focus().wrapIn('callout').run() },
  { id: 'toggle', said: W.toggle, icon: 'toggle', run: insertToggle },
  { id: 'code', said: W.codeBlock, icon: 'code', run: (e) => e.chain().focus().toggleCodeBlock().run() },
  { id: 'rule', said: W.divider, icon: 'rule', run: (e) => e.chain().focus().setHorizontalRule().run() },
  /* Three by three with a header, the caret in the first cell: the size a
     table starts at and then grows from. */
  { id: 'table', said: W.table, icon: 'table', run: (e) => e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
  // These two are handled by the component, which owns the file input and
  // the field a link is typed into.
  { id: 'link', said: W.link, icon: 'link', run: () => {} },
  { id: 'file', said: W.pictureOrFile, icon: 'clip', run: () => {} },
]

/**
 * The writing tools on a phone, docked on the keyboard as Notes has them.
 *
 * On a phone the bar over a selection fought the system's own menu for the
 * same place, and the `+` in the margin sat under the thumb at the edge of
 * the screen where every press missed it. One capsule instead, standing on
 * the keyboard while the body is being written in: with nothing chosen,
 * what can be put in — the styles behind Aa, lists, a table, a file; with
 * words chosen, what can be done to them. It follows the keyboard by the
 * visual viewport, which shrinks by the keyboard's height, and every press
 * keeps the caret where it was.
 */
export function PhoneDock({
  editor,
  onLink,
  onFile,
  words,
}: {
  editor: Tip
  onLink: () => void
  onFile: () => void
  words?: { comment?: (e: Tip) => void; task?: (e: Tip) => void } | undefined
}) {
  const [lift, setLift] = useState(0)
  const [styles, setStyles] = useState(false)
  const [, redraw] = useState(0)
  /* Said on the root while it is up, so the shell ends on it rather than
     under it — `--dock-h` in the theme. */
  useLayoutEffect(() => {
    const root = document.documentElement
    root.setAttribute('data-dock', '')
    return () => root.removeAttribute('data-dock')
  }, [])
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const place = () => setLift(Math.max(0, window.innerHeight - vv.height - vv.offsetTop))
    place()
    vv.addEventListener('resize', place)
    vv.addEventListener('scroll', place)
    return () => {
      vv.removeEventListener('resize', place)
      vv.removeEventListener('scroll', place)
    }
  }, [])
  useEffect(() => {
    const again = () => redraw((n) => n + 1)
    editor.on('selectionUpdate', again)
    editor.on('transaction', again)
    return () => {
      editor.off('selectionUpdate', again)
      editor.off('transaction', again)
    }
  }, [editor])
  const chosen = !editor.state.selection.empty
  useEffect(() => {
    if (chosen) setStyles(false)
  }, [chosen])
  const tool = (label: string, on: boolean, run: () => void, face: React.ReactNode) => (
    <button
      key={label}
      type="button"
      aria-label={label}
      aria-pressed={on}
      data-dock={label}
      /* The caret stays in the words: a press that took focus would put the
         keyboard down and the dock with it. */
      onPointerDown={(e) => e.preventDefault()}
      onMouseDown={(e) => e.preventDefault()}
      onClick={run}
      className="flex h-10 min-w-10 shrink-0 items-center justify-center rounded-full px-2 text-lg transition-colors"
      style={{ background: on ? 'var(--track-on)' : 'transparent', color: on ? 'var(--ink)' : 'var(--ink-2)' }}
    >
      {face}
    </button>
  )
  const c = () => editor.chain().focus()
  return createPortal(
    <div
      data-phone-dock
      className="fixed inset-x-2 z-[70] flex h-12 items-center gap-1 overflow-x-auto rounded-full px-1 [scrollbar-width:none]"
      style={{
        /* On the keys when the keyboard is up; above the tabs when it is not
           — a hardware keyboard, or a phone that has put its own away. */
        bottom: lift > 100 ? lift + 8 : 'calc(var(--foot) + 4px)',
        background: 'color-mix(in oklch, var(--surface) 82%, transparent)',
        backdropFilter: 'blur(20px) saturate(180%)',
        WebkitBackdropFilter: 'blur(20px) saturate(180%)',
        boxShadow: 'var(--card-shadow), inset 0 0 0 1px var(--line)',
        transition: 'bottom 120ms ease-out',
      }}
    >
      {chosen ? (
        <>
          {tool(WRITING.bold, editor.isActive('bold'), () => c().toggleBold().run(), <span className="font-semibold">B</span>)}
          {tool(WRITING.italic, editor.isActive('italic'), () => c().toggleItalic().run(), <span className="font-serif italic">I</span>)}
          {tool(WRITING.underline, editor.isActive('underline'), () => c().toggleUnderline().run(), <u>U</u>)}
          {tool(WRITING.strike, editor.isActive('strike'), () => c().toggleStrike().run(), <s>S</s>)}
          {tool(WRITING.code, editor.isActive('code'), () => c().toggleCode().run(), <Icon name="code" size={18} />)}
          {tool(W.link, editor.isActive('link'), onLink, <Icon name="link" size={18} />)}
          {tool(WRITING.bulleted, editor.isActive('bulletList'), () => c().toggleBulletList().run(), <Icon name="list" size={18} />)}
          {words?.comment && tool(W.comment, false, () => words.comment?.(editor), <Icon name="bubble" size={18} />)}
          {words?.task && tool(W.makeTask, false, () => words.task?.(editor), <Icon name="check" size={18} />)}
        </>
      ) : editor.isActive('table') && !styles ? (
        /* In a table, the table's own: what the bar over it does on a
           desk. */
        <>
          {tool(W.addRow, false, () => c().addRowAfter().run(), <span className="text-sm font-medium">{W.plusRowShort}</span>)}
          {tool(W.addColumn, false, () => c().addColumnAfter().run(), <span className="text-sm font-medium">{W.plusColShort}</span>)}
          {tool(W.removeRow, false, () => c().deleteRow().run(), <span className="text-sm font-medium">{W.minusRowShort}</span>)}
          {tool(W.removeColumn, false, () => c().deleteColumn().run(), <span className="text-sm font-medium">{W.minusColShort}</span>)}
          {tool(W.deleteTable, false, () => c().deleteTable().run(), <Icon name="trash" size={18} />)}
        </>
      ) : styles ? (
        <>
          {tool(W.back, false, () => setStyles(false), <Icon name="chevL" size={16} />)}
          {tool(W.text, editor.isActive('paragraph'), () => c().setParagraph().run(), <span className="text-md">Aa</span>)}
          {tool(
            WRITING.heading,
            editor.isActive('heading', { level: 1 }),
            () => c().toggleHeading({ level: 1 }).run(),
            <span className="text-md font-semibold">H1</span>,
          )}
          {tool(
            W.subheading,
            editor.isActive('heading', { level: 2 }),
            () => c().toggleHeading({ level: 2 }).run(),
            <span className="text-md font-semibold">H2</span>,
          )}
          {tool(WRITING.quote, editor.isActive('blockquote'), () => c().toggleBlockquote().run(), <Icon name="quote" size={18} />)}
          {tool(W.codeBlock, editor.isActive('codeBlock'), () => c().toggleCodeBlock().run(), <Icon name="code" size={18} />)}
          {tool(W.divider, false, () => c().setHorizontalRule().run(), <Icon name="rule" size={18} />)}
        </>
      ) : (
        <>
          {tool(W.styles, false, () => setStyles(true), <span className="text-lg font-medium">Aa</span>)}
          {tool(WRITING.bulleted, editor.isActive('bulletList'), () => c().toggleBulletList().run(), <Icon name="list" size={18} />)}
          {tool(
            WRITING.numbered,
            editor.isActive('orderedList'),
            () => c().toggleOrderedList().run(),
            <span className="text-md font-medium">1.</span>,
          )}
          {tool(
            W.table,
            editor.isActive('table'),
            () => c().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
            <Icon name="table" size={18} />,
          )}
          {tool(W.pictureOrFile, false, onFile, <Icon name="clip" size={18} />)}
          {tool(W.link, editor.isActive('link'), onLink, <Icon name="link" size={18} />)}
        </>
      )}
    </div>,
    document.body,
  )
}

export function Mark({ on, label, onPress, children }: { on: boolean; label: string; onPress: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={on}
      data-mark={label}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onPress}
      className={`flex h-7 min-w-7 items-center justify-center px-2 text-base font-medium transition-colors ${
        on ? '' : 'mouse:hover:bg-[var(--hover)] mouse:hover:text-[var(--ink)]'
      }`}
      style={{
        borderRadius: 'var(--r-row)',
        background: on ? 'var(--track-on)' : 'transparent',
        color: on ? 'var(--ink)' : 'var(--ink-2)',
      }}
    >
      {children}
    </button>
  )
}

/**
 * The marks, over what is selected, standing where it first came up.
 *
 * Drawn over the page at a place in the document rather than following the
 * selection — `Editor` explains why. Above the line the selection starts
 * on, and under the line it ends on when there is no room above.
 */
export function TextBar({
  editor,
  at,
  shelf,
  linking,
  onLink,
  onSaveLink,
  onCancelLink,
  readOnly = false,
  words,
}: {
  editor: Tip
  /** A reader's: only what may be done to words without changing them. */
  readOnly?: boolean
  /** Comment on the words, make a task of them — `OnWords` in `Editor`. */
  words?: { comment?: (e: Tip) => void; task?: (e: Tip) => void }
  at: number
  shelf: React.RefObject<HTMLDivElement | null>
  linking: { from: number; to: number; href: string } | null
  onLink: () => void
  onSaveLink: (href: string) => void
  /** `true` to go back to the words, `false` when the focus went elsewhere. */
  onCancelLink: (back: boolean) => void
}) {
  const [href, setHref] = useState(linking?.href ?? '')
  const size = editor.state.doc.content.size
  const start = editor.view.coordsAtPos(Math.min(at, size))
  const above = start.top - 8 - 36
  const top = above >= 8 ? above : editor.view.coordsAtPos(Math.min(editor.state.selection.to, size)).bottom + 8

  return (
    <div
      ref={shelf}
      data-text-bar
      className="fixed z-[60] flex items-center gap-1 p-1 bg-float"
      style={{
        left: Math.max(8, start.left - 4),
        top,
        boxShadow: 'var(--float-shadow)',
        borderRadius: 'var(--r-row)',
      }}
    >
      {readOnly ? (
        words?.comment && <WordsActions editor={editor} words={{ comment: words.comment }} />
      ) : linking ? (
        <>
          <span className="flex size-7 items-center justify-center text-ink-3">
            <Icon name="link" size={16} />
          </span>
          <input
            {...linkField}
            autoFocus
            data-testid="link-field"
            value={href}
            placeholder={W.pasteLink}
            onChange={(e) => setHref(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                onSaveLink(href)
              }
              if (e.key === 'Escape') {
                e.preventDefault()
                e.stopPropagation()
                onCancelLink(true)
              }
            }}
            onBlur={(e) => {
              if (!(e.relatedTarget as HTMLElement | null)?.closest('[data-text-bar]')) onCancelLink(false)
            }}
            className="h-7 w-[240px] bg-transparent px-1 text-base outline-none text-ink"
          />
          {linking.href && (
            <Mark label={W.removeLink} on={false} onPress={() => onSaveLink('')}>
              <Icon name="trash" size={16} />
            </Mark>
          )}
          <Mark label={W.applyLink} on={false} onPress={() => onSaveLink(href)}>
            <span className="text-sm">{W.apply}</span>
          </Mark>
        </>
      ) : (
        <>
          <Mark label={WRITING.bold} on={editor.isActive('bold')} onPress={() => editor.chain().focus().toggleBold().run()}>
            <span className="font-semibold">B</span>
          </Mark>
          <Mark label={WRITING.italic} on={editor.isActive('italic')} onPress={() => editor.chain().focus().toggleItalic().run()}>
            <span className="italic">I</span>
          </Mark>
          <Mark label={WRITING.strike} on={editor.isActive('strike')} onPress={() => editor.chain().focus().toggleStrike().run()}>
            <s>S</s>
          </Mark>
          <Mark label={WRITING.underline} on={editor.isActive('underline')} onPress={() => editor.chain().focus().toggleUnderline().run()}>
            <u>U</u>
          </Mark>
          <Mark label={WRITING.code} on={editor.isActive('code')} onPress={() => editor.chain().focus().toggleCode().run()}>
            <Icon name="code" size={16} />
          </Mark>
          <span className="mx-1 h-4 w-px shrink-0 bg-line-strong" />
          {/* Two sizes and not six. A description is prose: the third level
              of heading in a paragraph of four sentences is a distinction
              nobody reading it can use. */}
          <Mark
            label={WRITING.heading}
            on={editor.isActive('heading', { level: 1 })}
            onPress={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          >
            H<sub className="text-badge">1</sub>
          </Mark>
          <Mark
            label={WRITING.subheading}
            on={editor.isActive('heading', { level: 2 })}
            onPress={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          >
            H<sub className="text-badge">2</sub>
          </Mark>
          <Mark label={WRITING.bulleted} on={editor.isActive('bulletList')} onPress={() => editor.chain().focus().toggleBulletList().run()}>
            <Icon name="list" size={16} />
          </Mark>
          <Mark
            label={WRITING.numbered}
            on={editor.isActive('orderedList')}
            onPress={() => editor.chain().focus().toggleOrderedList().run()}
          >
            <span className="text-sm">1.</span>
          </Mark>
          <Mark label={WRITING.quote} on={editor.isActive('blockquote')} onPress={() => editor.chain().focus().toggleBlockquote().run()}>
            <Icon name="quote" size={16} />
          </Mark>
          <span className="mx-1 h-4 w-px shrink-0 bg-line-strong" />
          <Mark label={WRITING.link} on={editor.isActive('link')} onPress={onLink}>
            <Icon name="link" size={16} />
          </Mark>
          {(words?.comment || words?.task) && (
            <>
              <span className="mx-1 h-4 w-px shrink-0 bg-line-strong" />
              <WordsActions editor={editor} words={words} />
            </>
          )}
        </>
      )}
    </div>
  )
}

/**
 * What is done to chosen words beside marking them: say something about
 * them, or make work of them. Words on the buttons, not glyphs — neither
 * has a drawing everybody reads the same way.
 */
function WordsActions({ editor, words }: { editor: Tip; words: { comment?: (e: Tip) => void; task?: (e: Tip) => void } }) {
  return (
    <>
      {words.comment && (
        <Mark label={W.comment} on={false} onPress={() => words.comment?.(editor)}>
          <span data-testid="comment-on-words" className="flex items-center gap-1 text-sm">
            <Icon name="bubble" size={16} />
            {W.comment}
          </span>
        </Mark>
      )}
      {words.task && (
        <Mark label={W.makeTask} on={false} onPress={() => words.task?.(editor)}>
          <span data-testid="task-from-words" className="flex items-center gap-1 text-sm">
            <Icon name="check" size={16} />
            {W.makeTask}
          </span>
        </Mark>
      )}
    </>
  )
}
