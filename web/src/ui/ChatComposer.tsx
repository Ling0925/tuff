import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { EditorContent, Extension, useEditor, type Editor as Tip } from '@tiptap/react'
import { DocRef, Mention, TaskRef } from './refs.js'
import StarterKit from '@tiptap/starter-kit'
import { Selection } from '@tiptap/pm/state'
import type { PersonInWorkspace } from '@tracker/shared-schema'
import { Icon, type IconName } from './glyphs.jsx'
import { Avatar, Popover, agentLabel, linkField, findField } from './kit.jsx'
import { api } from '../data/api.js'
import { findGifs, gifKey, type Gif } from '../data/gifs.js'
import { BAR, MORE } from '../data/words.js'
import { COMPOSER as W } from '../words/chatComposer.js'
import { Autolink } from './autolink.js'
import { EmojiPicker, soonPicker } from './LazyEmojiPicker.jsx'
import { find, emojiNow, loadEmoji, skinTone, toned, type Emoji } from '../data/emoji.js'
import { used } from '../data/frequent.js'

/**
 * The line a message is written on, with what a chat needs — TRA-97,
 *
 * It was a single-line input: words and a picture. A team talking about work
 * writes code, lists and links into it and calls each other in, so it is a
 * small document now — formatting behind Aa (bold, italic, underline,
 * strike, a link, the two lists, a quote, code and a code block), emoji, and
 * @ to call somebody in, which the server reads as a mention and tells
 * them. Enter sends; Shift+Enter is a new line. No video, no voice, no
 * workflow shortcuts: those are a different product.
 */

/**
 * Nothing typed, and nothing begun: one empty line. `isEmpty` counts a
 * field with three blank lines in it as empty too, so the placeholder sat
 * over the first of them while the caret blinked on the third — Shift+Enter
 * is a line somebody started, and the hint has to go when it does.
 */
function bare(e: Pick<Tip, 'state'>): boolean {
  const doc = e.state.doc
  return doc.childCount === 1 && (doc.firstChild?.content.size ?? 0) === 0
}

/* Shift+Enter is a new line the way Slack's is — a new paragraph, or a new
   item in a list — not a break inside the same one, so a list started on
   the second line holds only that line. */
const Lines = Extension.create({
  name: 'chatLines',
  priority: 1000,
  addKeyboardShortcuts: () => ({
    'Shift-Enter': ({ editor }) =>
      editor.commands.first(({ commands }) => [
        () => commands.newlineInCode(),
        () => commands.splitListItem('listItem'),
        // An empty item: out of the list, as a second Enter does in one.
        () => commands.liftEmptyBlock(),
        () => commands.splitBlock(),
      ]),
  }),
})

type TaskHit = {
  /** A document rather than a task: # names both. */
  kind?: 'doc'
  id: string
  number: number | null
  title: string
  project_id: string
  project_key?: string | null
  completed_at?: string | null
}

export type ChatComposerHandle = {
  focus: (o?: FocusOptions) => void
  set: (doc: unknown) => void
  /** A message quoted into the line, after what is there, with the hand
      after it — `docs/specs/chat-composer.md`, "Quoting a message". */
  quote: (nodes: unknown[]) => void
}

type Props = {
  placeholder: string
  people: PersonInWorkspace[]
  /** The clip, from `useAttach`, drawn first on the bottom row. */
  clip?: React.ReactNode
  /** What the clip picked and is not sent yet, from `useAttach`: drawn in
      the box over the words, as a draft. */
  tray?: React.ReactNode
  /** Something is held to send with the words, so Send means something. */
  holding: boolean
  /** Files are being dragged over the line: it takes the accent's wash, so
      it is plain where they will land. */
  dropping?: boolean
  onSend: (doc: { type: 'doc'; content: unknown[] }, text: string) => void
  onPaste?: (data: DataTransfer | null) => boolean
  /** What is in the line to begin with — a message being edited. */
  initial?: unknown
  /** Editing a message in place: Cancel and Save rather than the arrow, and
      Escape leaves it as it was — `docs/specs/message-edit.md`. */
  onCancel?: () => void
  /** The room's project, whose tasks `#` offers first. */
  projectId?: string | null
  /** The room, which knows the tasks it can name — `chat-tasks.md`. */
  roomId?: string | null
  /** A GIF sent with a message — `docs/specs/gifs.md`. With the words
      searched for, which KLIPY is told; its presence is what puts the GIF
      button in the line at all. */
  onGif?: (gif: Gif, q: string) => void
  /** Words are being written — said on the room's socket, throttled by
      whoever listens: */
  onTyping?: () => void
  /** ↑ in a line with nothing in it: the last message you wrote here opens
      for editing — `docs/specs/keyboard.md`. True when one did. */
  onEditLast?: () => boolean
}

export const ChatComposer = forwardRef<ChatComposerHandle, Props>(function ChatComposer(
  {
    placeholder,
    people,
    clip,
    tray,
    holding,
    dropping = false,
    onSend,
    onPaste,
    initial,
    onCancel,
    projectId = null,
    roomId = null,
    onGif,
    onTyping,
    onEditLast,
  },
  ref,
) {
  /* Read from a ref: the editor keeps the callbacks it was made with. */
  const typingRef = useRef(onTyping)
  typingRef.current = onTyping
  /* A GIF button only where the deployment has KLIPY's key. */
  const [gifs, setGifs] = useState(false)
  useEffect(() => {
    if (!onGif) return
    let alive = true
    void gifKey().then((k) => alive && setGifs(Boolean(k)))
    return () => {
      alive = false
    }
  }, [onGif])
  /* The GIF picked and not sent yet: it waits in the line with its ✕, and
     goes with the words — `docs/specs/gifs.md`. */
  const [held, setHeld] = useState<{ gif: Gif; q: string } | null>(null)
  const heldRef = useRef(held)
  heldRef.current = held
  const [styled, setStyled] = useState(false)
  const [empty, setEmpty] = useState(true)
  const [, redraw] = useState(0)
  const [linking, setLinking] = useState(false)
  const linkOn = useRef<{ from: number; to: number } | null>(null)
  const [href, setHref] = useState('')
  /* @ being typed: where it started and what follows it. */
  const [calling, setCalling] = useState<{ from: number; q: string; kind: '@' | '#' | ':' } | null>(null)
  /* Which of the two the list is for: a task or a doc, when one of the
     buttons opened it; both, when # was typed. */
  const [only, setOnly] = useState<'task' | 'doc' | null>(null)
  useEffect(() => {
    if (calling?.kind !== '#') setOnly(null)
  }, [calling?.kind])
  /* The tasks `#` is offering, asked for as the words after it change. */
  const [tasks, setTasks] = useState<TaskHit[]>([])
  /* The question the list answers, so "no task" is never said about a
     question still being asked. */
  const [answered, setAnswered] = useState('')
  useEffect(() => {
    if (calling?.kind !== '#' || !roomId) return
    let alive = true
    const q = calling.q.trim()
    /*
     * The room's own list of what it can name: its project's tasks, or in
     * a direct conversation those of every project all of its people are
     * on — searched by a word of the title, a number or a handle (`MYP-61`).
     */
    const wait = setTimeout(
      () => {
        void api<{ tasks: TaskHit[] }>(`/conversations/${roomId}/tasks?q=${encodeURIComponent(q)}${only ? `&kind=${only}` : ''}`)
          .then((r) => {
            if (!alive) return
            setTasks(r.tasks)
            setAnswered(q.toLowerCase())
          })
          .catch(() => alive && (setTasks([]), setAnswered(q.toLowerCase())))
      },
      q ? 120 : 0,
    )
    return () => {
      alive = false
      clearTimeout(wait)
    }
  }, [calling?.kind, calling?.q, roomId, only])
  const [chose, setChose] = useState(0)
  const live = useRef({ calling, chose, found: [] as PersonInWorkspace[], tasks: [] as TaskHit[], faces: [] as Emoji[] })
  /* The whole room, by one name, last in the list — a mention for each of
     them, through Mentions only. Only in a room. `docs/specs/notifications.md`. */
  const everyone = { actor_id: 'everyone', name: W.everyone } as PersonInWorkspace
  const found =
    calling?.kind === '@'
      ? [
          ...people.filter((p) => p.name.toLowerCase().includes(calling.q.toLowerCase())).slice(0, 8),
          ...(roomId && ['everyone', W.everyone].some((w) => w.startsWith(calling.q.toLowerCase())) ? [everyone] : []),
        ]
      : []
  const offered = calling?.kind === '#' ? tasks : []
  /*
   * : and two letters of a name offers the emoji that match, as Slack's
   * line does — `docs/specs/emoji.md`. The list is asked for when the line
   * is drawn and the machine is idle; typed before it is here, the offer
   * waits for it.
   */
  const [, emojiCame] = useState(0)
  useEffect(() => soonPicker(), [])
  useEffect(() => {
    if (calling?.kind !== ':' || emojiNow()) return
    let alive = true
    void loadEmoji()
      .then(() => alive && emojiCame((n) => n + 1))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [calling?.kind])
  const faces = calling?.kind === ':' ? find(emojiNow() ?? [], calling.q, 8) : []
  live.current = { calling, chose, found, tasks: offered, faces }
  const sendRef = useRef<() => void>(() => {})

  const editing = Boolean(onCancel)
  const cancelRef = useRef(onCancel)
  cancelRef.current = onCancel
  const editLastRef = useRef(onEditLast)
  editLastRef.current = onEditLast
  const holdingRef = useRef(holding)
  holdingRef.current = holding
  /*
   * What was being written in this room, kept on this machine until it is
   * sent. Leaving a room for another, or the tab
   * for a task, threw a half-written message away.
   */
  const draftKey = !onCancel && roomId ? `tracker:draft:${roomId}` : null
  const kept = (() => {
    if (!draftKey || initial) return null
    try {
      const raw = localStorage.getItem(draftKey)
      return raw ? (JSON.parse(raw) as unknown) : null
    } catch {
      return null
    }
  })()
  const keep = (e: Tip) => {
    if (!draftKey) return
    try {
      if (bare(e)) localStorage.removeItem(draftKey)
      else localStorage.setItem(draftKey, JSON.stringify(e.getJSON()))
    } catch {
      /* Storage refused: the draft lives as long as the screen, as before. */
    }
  }
  const editor = useEditor({
    ...(initial ? { content: initial as never } : kept ? { content: kept as never } : {}),
    onCreate: ({ editor: e }) => {
      setEmpty(bare(e))
      /* An edit starts with the caret at the end of what was said. */
      if (initial) e.commands.focus('end')
      /* And so does a kept draft, without taking the focus: the room
         focuses the field when it opens, and the caret was then put at
         the start of the words, ahead of everything already written. */ else if (kept)
        e.commands.command(({ tr }) => {
          tr.setSelection(Selection.atEnd(tr.doc))
          return true
        })
    },
    extensions: [
      StarterKit.configure({
        link: { openOnClick: false, autolink: true, HTMLAttributes: { rel: 'noreferrer noopener' } },
        heading: false,
        horizontalRule: false,
      }),
      Mention,
      TaskRef,
      DocRef,
      Lines,
      /* A message being changed shows its addresses as links, as it did
         when it was read. */
      Autolink,
    ],
    editorProps: {
      attributes: {
        class: 'outline-none max-h-[240px] overflow-y-auto',
        'data-message-field': '',
        'aria-label': W.message,
      },
      handlePaste: (_v, e) => onPaste?.(e.clipboardData) ?? false,
      handleKeyDown: (view, e) => {
        const now = live.current
        const rows = now.calling?.kind === '#' ? now.tasks.length : now.calling?.kind === ':' ? now.faces.length : now.found.length
        if (now.calling && rows) {
          if (e.key === 'ArrowDown') {
            setChose((i) => (i + 1) % rows)
            return true
          }
          if (e.key === 'ArrowUp') {
            setChose((i) => (i - 1 + rows) % rows)
            return true
          }
          if (e.key === 'Enter' || e.key === 'Tab') {
            if (now.calling.kind === '#') {
              const t = now.tasks[now.chose] ?? now.tasks[0]
              if (t) name(t)
            } else if (now.calling.kind === ':') {
              const x = now.faces[now.chose] ?? now.faces[0]
              if (x) face(x)
            } else {
              const who = now.found[now.chose] ?? now.found[0]
              if (who) call(who)
            }
            return true
          }
          if (e.key === 'Escape') {
            setCalling(null)
            return true
          }
        }
        /* Enter sends, Shift+Enter is a new line — except in a code block or
           a list, where Enter is a new line of that and the Send button or
           ⌘Enter sends. */
        if (e.key === 'Enter' && !e.shiftKey) {
          const kind = view.state.selection.$from.parent.type.name
          const inList = view.state.selection.$from.node(-1)?.type.name === 'listItem'
          if ((kind === 'codeBlock' || inList) && !(e.metaKey || e.ctrlKey)) return false
          e.preventDefault()
          sendRef.current()
          return true
        }
        /* ↑ in a line with nothing in it — no words, no lines begun, no
           file or GIF waiting — is the last message you wrote, opened to
           be changed. Anywhere else it is the caret's. */
        if (
          e.key === 'ArrowUp' &&
          !e.shiftKey &&
          !e.metaKey &&
          !e.ctrlKey &&
          !e.altKey &&
          !e.isComposing &&
          editLastRef.current &&
          !heldRef.current &&
          !holdingRef.current &&
          bare(view) &&
          editLastRef.current()
        ) {
          e.preventDefault()
          return true
        }
        /* Backspace in an empty line takes the held GIF out, as it would a
           character before the caret. */
        if (e.key === 'Backspace' && heldRef.current && (view.dom.textContent ?? '').length === 0) {
          setHeld(null)
          return true
        }
        /* Escape in an empty field gives the bare keys back to the screen —
           1…6 for the tabs. `docs/specs/keyboard.md`. */
        if (e.key === 'Escape' && cancelRef.current) {
          cancelRef.current()
          return true
        }
        /* Read from the page, not the editor's state: a field emptied a
           moment ago can still be holding the old words in its state while
           the change is on its way in, and Escape then kept the hand. */
        if (e.key === 'Escape' && (view.dom.textContent ?? '').trim().length === 0) {
          ;(view.dom as HTMLElement).blur()
          return true
        }
        return false
      },
    },
    onUpdate: ({ editor: e }) => {
      setEmpty(bare(e))
      watch(e)
      keep(e)
      if (!bare(e)) typingRef.current?.()
    },
    onSelectionUpdate: ({ editor: e }) => {
      watch(e)
      redraw((n) => n + 1)
    },
    /* Bold pressed in an empty field changes nothing in the document and
       does not move the caret — it only sets the mark the next letter will
       carry — so neither of the two above fires and the button stayed dark
       until something was typed. */
    onTransaction: ({ transaction }) => {
      if (transaction.storedMarksSet) redraw((n) => n + 1)
    },
  })

  function watch(e: Tip) {
    const { $from, empty: collapsed } = e.state.selection
    if (!collapsed) return setCalling(null)
    const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '￼')
    /* @ for a person, # for a task — the words after it, up to the caret. A
       task's title has spaces in it, so # takes them too, up to forty. */
    const person = /(?:^|\s)@([\p{L}\p{N}._-]*)$/u.exec(before)
    const work = /(?:^|\s)#([^#\n]{0,40})$/u.exec(before)
    /* : for an emoji, from the second letter: "12:30" and "Note: " are not. */
    const smile = /(?:^|\s):([\p{L}\p{N}_+-]{2,30})$/u.exec(before)
    const said = person ?? work ?? smile
    if (!said) return setCalling(null)
    setCalling({ from: $from.pos - said[1]!.length - 1, q: said[1] ?? '', kind: person ? '@' : work ? '#' : ':' })
    setChose(0)
  }

  function face(x: Emoji) {
    if (!editor || !live.current.calling) return
    const e = toned(x, skinTone())
    used(e)
    const to = editor.state.selection.$from.pos
    editor.chain().focus().deleteRange({ from: live.current.calling.from, to }).insertContent(e).run()
    setCalling(null)
  }

  function call(who: PersonInWorkspace) {
    if (!editor || !live.current.calling) return
    const to = editor.state.selection.$from.pos
    editor
      .chain()
      .focus()
      .deleteRange({ from: live.current.calling.from, to })
      .insertContent([
        { type: 'mention', attrs: { id: who.actor_id, label: who.name } },
        { type: 'text', text: ' ' },
      ])
      .run()
    setCalling(null)
  }

  /*
   * The @ and # buttons open their lists where the caret is. Pressed again
   * while the list is open, or with the mark already before the caret, they
   * do nothing: each press used to type another "@", so three presses left
   * " @ @ @" in the line.
   */
  function begin(mark: '@' | '#', which: 'task' | 'doc' | null = null) {
    if (!editor) return
    if (mark === '#' && which !== only) {
      /* What the other list found is not this one's answer. */
      setOnly(which)
      setTasks([])
      setAnswered('\u0000')
    }
    if (live.current.calling?.kind === mark) {
      editor.view.focus()
      return
    }
    const { $from } = editor.state.selection
    const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '\ufffc')
    if (before.endsWith(mark)) {
      editor.view.focus()
      return
    }
    const gap = before.length === 0 || /\s$/.test(before) ? '' : ' '
    editor.view.focus()
    editor.chain().insertContent(`${gap}${mark}`).run()
  }

  function name(t: TaskHit) {
    if (!editor || !live.current.calling) return
    const to = editor.state.selection.$from.pos
    editor
      .chain()
      .focus()
      .deleteRange({ from: live.current.calling.from, to })
      .insertContent([
        /* The project from the row, or this room's: a project's own list
           does not say which project its rows are in. */
        t.kind === 'doc'
          ? { type: 'docref', attrs: { id: t.id, projectId: t.project_id ?? projectId, number: t.number, title: t.title } }
          : {
              type: 'taskref',
              attrs: { id: t.id, projectId: t.project_id ?? projectId, number: t.number, key: t.project_key ?? null, title: t.title },
            },
        { type: 'text', text: ' ' },
      ])
      .run()
    setCalling(null)
  }

  function send() {
    if (!editor) return
    const json = editor.getJSON() as { type: 'doc'; content: unknown[] }
    const text = editor.getText().trim()
    const gif = heldRef.current
    if (!text && !holding && !gif) return
    /* The words, then the GIF — one message. */
    const content = [
      ...(text ? json.content : []),
      ...(gif ? [{ type: 'gif', attrs: { url: gif.gif.url, width: gif.gif.width, height: gif.gif.height, title: gif.gif.title } }] : []),
    ]
    onSend({ type: 'doc', content }, text)
    if (gif) {
      onGif?.(gif.gif, gif.q)
      setHeld(null)
    }
    if (editing) return
    editor.commands.clearContent(true)
    setEmpty(true)
    keep(editor)
  }
  sendRef.current = send

  useImperativeHandle(ref, () => ({
    focus: (o) => {
      if (!editor) return
      ;(editor.view.dom as HTMLElement).focus(o)
    },
    set: (doc) => {
      editor?.commands.setContent(doc as never)
      setEmpty(editor ? bare(editor) : true)
    },
    quote: (nodes) => {
      if (!editor) return
      if (bare(editor)) editor.commands.setContent({ type: 'doc', content: nodes } as never)
      else editor.commands.insertContentAt(editor.state.doc.content.size, nodes as never)
      editor.commands.focus('end')
      setEmpty(bare(editor))
      keep(editor)
    },
  }))

  if (!editor) return null

  const mark = (icon: IconName | string, label: string, on: boolean, press: () => void) => (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={on}
      onMouseDown={(e) => e.preventDefault()}
      onClick={press}
      className="flex size-8 shrink-0 items-center justify-center rounded-[var(--r-row)] text-base font-medium transition-colors mouse:hover:bg-[var(--hover)]"
      style={{ color: on ? 'var(--ink)' : 'var(--ink-2)', background: on ? 'var(--track-on)' : undefined }}
    >
      {/^[a-z]+$/.test(icon) ? <Icon name={icon as IconName} size={16} /> : icon}
    </button>
  )
  const rule = <span className="mx-1 h-4 w-px shrink-0 bg-line-strong" />

  return (
    <div
      data-chat-composer
      /* A light stroke round it while it is being written in, so the line
         with the cursor in it reads as the one that is listening. It was
         the ground going a shade lighter, and the box turning grey under
         the hand read as something having happened. */
      data-files-over={dropping || undefined}
      /* Files carried over it wash it in the accent, with the accent's
         stroke in place of the grey one — colour only, so nothing in the
         room moves while the hand is deciding where to let go. */
      className={`relative mt-3 flex shrink-0 flex-col transition-[background-color,box-shadow] duration-150 ease-out motion-reduce:transition-none ${
        dropping
          ? 'bg-[var(--accent-soft)] shadow-[inset_0_0_0_1px_var(--accent)]'
          : 'bg-[var(--track)] focus-within:shadow-[inset_0_0_0_1px_var(--line-strong)]'
      }`}
      style={{ borderRadius: 'var(--r-card)' }}
    >
      {styled && (
        <div
          data-chat-marks
          className="flex shrink-0 items-center gap-1 overflow-x-auto border-b px-2 py-1 [scrollbar-width:none]"
          style={{ borderColor: 'var(--line)' }}
        >
          {linking ? (
            <form
              className="flex flex-1 items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                let to = href.trim()
                if (to && !/^[a-z][a-z\d+.-]*:/i.test(to)) to = `https://${to}`
                /* Back into the line now, not on the next frame as
                   `.focus()` does: an Enter pressed straight after this one
                   is a message being sent, and it landed nowhere. */
                editor.view.focus()
                if (linkOn.current) editor.commands.setTextSelection(linkOn.current)
                linkOn.current = null
                if (!to) editor.chain().extendMarkRange('link').unsetLink().run()
                else if (/^https?:\/\//i.test(to)) editor.chain().extendMarkRange('link').setLink({ href: to }).run()
                setLinking(false)
              }}
            >
              <Icon name="link" size={16} className="text-ink-3" />
              <input
                {...linkField}
                autoFocus
                value={href}
                onChange={(e) => setHref(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== 'Escape') return
                  editor.view.focus()
                  setLinking(false)
                }}
                placeholder={W.pasteLink}
                className="h-8 min-w-px flex-1 bg-transparent text-base outline-none text-ink"
              />
            </form>
          ) : (
            <>
              {mark('B', W.bold, editor.isActive('bold'), () => editor.chain().focus().toggleBold().run())}
              {mark('I', W.italic, editor.isActive('italic'), () => editor.chain().focus().toggleItalic().run())}
              {mark('U', W.underline, editor.isActive('underline'), () => editor.chain().focus().toggleUnderline().run())}
              {mark('S', W.strikethrough, editor.isActive('strike'), () => editor.chain().focus().toggleStrike().run())}
              {rule}
              {mark('link', W.link, editor.isActive('link'), () => {
                setHref(String(editor.getAttributes('link').href ?? ''))
                /* The words the link goes on, held — focus moves to the
                   address field and back, and the selection is put back
                   from here rather than trusted to survive the trip. */
                linkOn.current = { from: editor.state.selection.from, to: editor.state.selection.to }
                setLinking(true)
              })}
              {mark('1.', W.numbered, editor.isActive('orderedList'), () => editor.chain().focus().toggleOrderedList().run())}
              {mark('list', W.bulleted, editor.isActive('bulletList'), () => editor.chain().focus().toggleBulletList().run())}
              {rule}
              {mark('quote', W.quote, editor.isActive('blockquote'), () => editor.chain().focus().toggleBlockquote().run())}
              {mark('code', W.code, editor.isActive('code'), () => editor.chain().focus().toggleCode().run())}
              {mark('{ }', W.codeBlock, editor.isActive('codeBlock'), () => editor.chain().focus().toggleCodeBlock().run())}
            </>
          )}
        </div>
      )}

      {tray && (
        <div data-composer-tray className="flex shrink-0 px-4 pt-3">
          {tray}
        </div>
      )}

      {/* The GIF waiting to go, at its own shape and its height kept before
          it loads, with the way to take it back out. */}
      {held && (
        <div data-gif-held className="flex shrink-0 px-4 pt-3">
          <div className="relative">
            <img
              src={held.gif.url}
              alt={held.gif.title}
              className="block rounded-[var(--r-row)] object-cover bg-sunken"
              style={{
                height: 96,
                width: Math.round((96 * (held.gif.width || 4)) / (held.gif.height || 3)),
              }}
            />
            <button
              type="button"
              data-testid="gif-remove"
              aria-label={W.removeGif}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setHeld(null)
                editor.view.focus()
              }}
              className="absolute -top-2 -right-2 flex size-6 items-center justify-center rounded-full bg-surface text-ink-2"
              style={{ boxShadow: 'var(--card-shadow)' }}
            >
              <Icon name="close" size={10} />
            </button>
          </div>
        </div>
      )}

      <div className="relative">
        <EditorContent editor={editor} className="prose-body chat-field px-4 pt-3 pb-1 text-base" />
        {empty && (
          <span
            data-placeholder
            aria-hidden
            className="pointer-events-none absolute top-3 left-4 truncate text-base text-ink-3"
            style={{ lineHeight: 1.43, right: 16 }}
          >
            {placeholder}
          </span>
        )}
      </div>

      <div className="flex items-center gap-1 px-2 pb-2">
        {clip}
        {mark('type', styled ? W.hideFormatting : W.showFormatting, styled, () => setStyled(!styled))}
        <Popover
          shape="bare"
          width={344}
          sheet={false}
          testId="chat-emoji"
          said={W.emoji}
          label={
            <span
              data-control
              className="flex size-8 items-center justify-center rounded-[var(--r-row)] transition-colors mouse:hover:bg-[var(--hover)] text-ink-2"
            >
              <Icon name="smile" size={16} />
            </span>
          }
        >
          {(close) => (
            <EmojiPicker
              onPick={(e) => {
                close()
                used(e)
                // Now, not on the next frame as `.focus()` does: the
                // trigger holds the focus until then and would take the
                // next Enter and open the menu again.
                editor.view.focus()
                editor.chain().insertContent(e).run()
              }}
            />
          )}
        </Popover>
        {gifs && onGif && !editing && (
          <Popover
            shape="bare"
            width={336}
            sheet={false}
            testId="chat-gif"
            said={W.gif}
            label={
              <span
                data-control
                className="flex size-8 items-center justify-center rounded-[var(--r-row)] text-xs font-semibold tracking-[0.02em] transition-colors mouse:hover:bg-[var(--hover)] text-ink-2"
              >
                {W.gif}
              </span>
            }
          >
            {(close) => (
              <GifGrid
                onPick={(g, q) => {
                  close()
                  editor.view.focus()
                  setHeld({ gif: g, q })
                }}
              />
            )}
          </Popover>
        )}
        {mark('at', W.mentionSomeone, calling?.kind === '@', () => begin('@'))}
        {mark('tasks', W.mentionTask, calling?.kind === '#' && only !== 'doc', () => begin('#', 'task'))}
        {mark('doc', W.mentionDoc, calling?.kind === '#' && only === 'doc', () => begin('#', 'doc'))}
        {editing ? (
          <span className="ml-auto flex shrink-0 items-center gap-2">
            <button
              type="button"
              data-testid="cancel-edit-message"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onCancel?.()}
              className="flex h-8 items-center rounded-full px-3 text-base font-medium transition-colors mouse:hover:bg-[var(--hover)] text-ink-2"
            >
              {MORE.cancel}
            </button>
            <button
              type="button"
              data-testid="save-message"
              disabled={empty && !holding}
              onMouseDown={(e) => e.preventDefault()}
              onClick={send}
              className="flex h-8 items-center rounded-full px-4 text-base font-medium disabled:opacity-50 bg-accent text-on-accent"
            >
              {MORE.save}
            </button>
          </span>
        ) : (
          <button
            type="button"
            aria-label={BAR.send}
            data-testid="send-message"
            onMouseDown={(e) => e.preventDefault()}
            onClick={send}
            className="ml-auto flex shrink-0 items-center"
            style={{ color: !empty || holding || held ? 'var(--accent)' : 'var(--n-5)' }}
          >
            <Icon name="send" size={30} />
          </button>
        )}
      </div>

      {/* Which task, over the line, as somebody types after #. */}
      {calling?.kind === '#' && offered.length > 0 && (
        <div
          data-task-list
          data-menu
          className="absolute bottom-full left-2 z-40 mb-2 max-h-[360px] w-[400px] max-w-[calc(100%-16px)] overflow-y-auto py-1 bg-surface"
          style={{ borderRadius: 'var(--r-card)', boxShadow: 'var(--card-shadow)', border: '1px solid var(--line)' }}
        >
          {/* Said once, at the head: the words after # are the search. */}
          <div className="px-3 pt-1 pb-2 text-xs text-ink-3">
            {calling.q.trim()
              ? W.matching(only, calling.q.trim())
              : only === 'doc'
                ? W.typeTitleWord
                : /* The example is a handle from this list, so it reads as one
                   to type rather than as a code from somewhere else. */
                  W.typeTitleOrCode(offered[0] ? `${offered[0].project_key}-${offered[0].number}` : null)}
          </div>
          {offered.map((t, i) => (
            <button
              key={t.id}
              type="button"
              ref={(el) => {
                if (el && i === chose) el.scrollIntoView({ block: 'nearest' })
              }}
              data-task-row={t.id}
              onMouseDown={(e) => {
                e.preventDefault()
                name(t)
              }}
              onMouseEnter={() => setChose(i)}
              className="flex w-full items-center gap-3 px-3 text-left text-base text-ink"
              style={{ height: 'var(--row-h)', background: i === chose ? 'var(--hover)' : undefined }}
            >
              {t.kind === 'doc' ? (
                <span className="flex shrink-0 items-center text-ink-3">
                  <Icon name="doc" size={14} />
                </span>
              ) : (
                <span className="shrink-0 font-mono text-xs tabular-nums text-ink-3">
                  {t.project_key ? `${t.project_key}-${t.number}` : `#${t.number}`}
                </span>
              )}
              <span
                className="truncate"
                style={{ textDecoration: t.completed_at ? 'line-through' : undefined, color: t.completed_at ? 'var(--ink-3)' : undefined }}
              >
                {t.title}
              </span>
            </button>
          ))}
        </div>
      )}
      {/* Nothing to offer yet: say what to do rather than show nothing —
          a direct conversation has no project to list, so it waits for a
          word of the title. */}
      {calling?.kind === '#' && offered.length === 0 && answered === calling.q.trim().toLowerCase() && (
        <div
          data-task-list
          className="absolute bottom-full left-2 z-40 mb-2 w-[300px] px-3 py-2 text-sm bg-surface text-ink-3"
          style={{ borderRadius: 'var(--r-card)', boxShadow: 'var(--card-shadow)', border: '1px solid var(--line)' }}
        >
          {only === 'doc' ? W.noDocs : only === 'task' ? W.noTasks : W.noTasksOrDocs}
        </div>
      )}
      {/* Which emoji, over the line, as somebody types after :. */}
      {calling?.kind === ':' && faces.length > 0 && (
        <div
          data-emoji-list
          data-menu
          className="absolute bottom-full left-2 z-40 mb-2 w-[280px] overflow-hidden py-1 bg-surface"
          style={{ borderRadius: 'var(--r-card)', boxShadow: 'var(--card-shadow)', border: '1px solid var(--line)' }}
        >
          {faces.map((x, i) => (
            <button
              key={x.e}
              type="button"
              data-emoji-row={x.e}
              onMouseDown={(e) => {
                e.preventDefault()
                face(x)
              }}
              onMouseEnter={() => setChose(i)}
              className="flex w-full items-center gap-3 px-3 text-left text-base text-ink"
              style={{ height: 'var(--row-h)', background: i === chose ? 'var(--hover)' : undefined }}
            >
              <span className="w-5 shrink-0 text-center text-lg leading-none">{toned(x, skinTone())}</span>
              <span className="truncate">{x.name}</span>
            </button>
          ))}
        </div>
      )}
      {/* Who to call in, over the line, as somebody types after @. */}
      {calling?.kind === '@' && found.length > 0 && (
        <div
          data-mention-list
          className="absolute bottom-full left-2 z-40 mb-2 w-[260px] overflow-hidden py-1 bg-surface"
          style={{ borderRadius: 'var(--r-card)', boxShadow: 'var(--card-shadow)', border: '1px solid var(--line)' }}
        >
          {found.map((p, i) => (
            <button
              key={p.actor_id}
              type="button"
              data-mention-row={p.actor_id}
              onMouseDown={(e) => {
                e.preventDefault()
                call(p)
              }}
              onMouseEnter={() => setChose(i)}
              className={`flex w-full items-center gap-3 px-3 text-left text-base text-ink ${'agent' in p && p.agent ? 'py-1' : ''}`}
              style={{ minHeight: 'var(--row-h)', background: i === chose ? 'var(--hover)' : undefined }}
            >
              {p.actor_id === 'everyone' ? (
                <span className="flex size-5 shrink-0 items-center justify-center text-ink-2">
                  <Icon name="people" size={16} />
                </span>
              ) : (
                <Avatar id={p.actor_id} name={p.name} url={p.avatar_url} size={20} />
              )}
              {/* An agent, said under its name — and away, so nobody waits on
                  an answer that is not coming yet. */}
              <span className="flex min-w-px flex-1 flex-col">
                <span className="truncate">{p.name}</span>
                {'agent' in p && p.agent && (
                  <span data-mention-agent className="truncate text-xs text-ink-3">
                    {agentLabel(p as PersonInWorkspace)}
                  </span>
                )}
              </span>
              {p.actor_id === 'everyone' && <span className="ml-auto shrink-0 text-xs text-ink-3">{W.everyoneHere}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
})

/**
 * KLIPY's GIFs: trending until something is typed, then what matches, in
 * KLIPY's order, two columns that keep each picture's shape. The field says
 * "Search KLIPY" because KLIPY's terms ask it to. `docs/specs/gifs.md`.
 */
function GifGrid({ onPick }: { onPick: (gif: Gif, q: string) => void }) {
  const [q, setQ] = useState('')
  const [found, setFound] = useState<Gif[] | null>(null)
  const [page, setPage] = useState(1)
  const [more, setMore] = useState(false)
  const [failed, setFailed] = useState(false)
  const asking = useRef(false)
  useEffect(() => {
    let alive = true
    const wait = setTimeout(
      () => {
        asking.current = true
        void findGifs(q, 1)
          .then((r) => {
            if (!alive) return
            setFound(r.gifs)
            setMore(r.more)
            setPage(1)
            setFailed(false)
          })
          .catch(() => alive && (setFound([]), setMore(false), setFailed(true)))
          .finally(() => (asking.current = false))
      },
      q.trim() ? 250 : 0,
    )
    return () => {
      alive = false
      clearTimeout(wait)
    }
  }, [q])
  const next = () => {
    if (!more || asking.current) return
    asking.current = true
    void findGifs(q, page + 1)
      .then((r) => {
        setFound((had) => [...(had ?? []), ...r.gifs.filter((g) => !(had ?? []).some((h) => h.slug === g.slug))])
        setMore(r.more)
        setPage(page + 1)
      })
      .catch(() => setMore(false))
      .finally(() => (asking.current = false))
  }
  /* Two columns, each picture to the shorter one, in the order given. */
  const cols: [Gif[], Gif[]] = [[], []]
  const tall = [0, 0]
  for (const g of found ?? []) {
    const i = tall[0]! <= tall[1]! ? 0 : 1
    cols[i]!.push(g)
    tall[i]! += g.thumbHeight / Math.max(1, g.thumbWidth)
  }
  return (
    <div className="flex flex-col" data-gif-picker>
      <div className="p-2">
        <input
          {...findField}
          autoFocus
          data-testid="gif-search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={W.searchKlipy}
          aria-label={W.searchKlipy}
          className="h-8 w-full rounded-[var(--r-row)] px-3 text-base outline-none placeholder:text-[var(--ink-3)] bg-track"
          style={{ color: 'var(--ink)' }}
        />
      </div>
      <div
        className="flex max-h-[384px] min-h-[192px] items-start gap-2 overflow-y-auto px-2 pb-2"
        onScroll={(e) => {
          const box = e.currentTarget
          if (box.scrollHeight - box.scrollTop - box.clientHeight < 200) next()
        }}
      >
        {found && found.length === 0 && <p className="w-full px-1 py-2 text-sm text-ink-3">{failed ? W.gifsFailed : W.noGifs}</p>}
        {found &&
          found.length > 0 &&
          cols.map((col, c) => (
            <div key={c} className="flex min-w-px flex-1 flex-col gap-2">
              {col.map((g) => (
                <button
                  key={g.slug}
                  type="button"
                  data-gif={g.slug}
                  title={g.title}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => onPick(g, q)}
                  className="block w-full shrink-0 overflow-hidden rounded-[var(--r-row)] bg-track"
                  /* Its own shape, never squeezed: in a column held to the
                     picker's height, a flex child shrinks to fit, and every
                     GIF came out a strip. */
                  style={{ aspectRatio: `${g.thumbWidth} / ${g.thumbHeight}` }}
                >
                  <img src={g.thumb} alt={g.title} loading="lazy" className="size-full object-cover" />
                </button>
              ))}
            </div>
          ))}
      </div>
    </div>
  )
}
