import { useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { WRITING } from '../data/words.js'
/* `@tiptap/react` re-exports the core, and v3 moved the menus to their own
   entry. Both are reached through the package already in `package.json` —
   the chosen stack names no editor, so adding one would have been a
   question, and there is nothing to ask. */
import { EditorContent, useEditor, isNodeSelection, type Editor as Tip } from '@tiptap/react'
import { NodeSelection, Selection, TextSelection } from '@tiptap/pm/state'
import { GapCursor } from '@tiptap/pm/gapcursor'
import { Fragment, Slice } from '@tiptap/pm/model'
import { dropPoint } from '@tiptap/pm/transform'
import StarterKit from '@tiptap/starter-kit'
import { TableKit } from '@tiptap/extension-table'
import { upload, kindOf, measure, UploadInto } from '../data/upload.js'
import { Icon, type IconName } from './glyphs.jsx'
import { Avatar, usePhone } from './kit.jsx'
import { DocRef, Mention } from './refs.js'
import { TaskChip } from './editor/taskChip.jsx'
import { cleanLine } from '@tracker/shared-schema'
import { PersonDoorsContext } from './PersonCard.jsx'
import { Autolink } from './autolink.js'
import * as sending from '../data/sending.js'
import { EDITOR as W } from '../words/editor.js'
import { type Block, BLOCKS, PhoneDock, TextBar, Mark } from './editor/bars.jsx'
import { Attachment, CodeColours } from './editor/attachment.jsx'
import { Callout } from './editor/callout.jsx'
import { Toggle, ToggleKeys } from './editor/toggle.js'
import { Wraps } from './editor/wraps.js'
import type { Collab } from './editor/collab.js'
import { CommentMark } from './editor/comment.js'
import type { EditorView } from '@tiptap/pm/view'

/** What the screen around a body may ask of it. */
export type EditorHandle = {
  enter: () => void
  end?: () => void
  /** Where its caret is, for the editor that takes over from it. */
  caret?: () => Caret | null
  /** The caret given back, focused: the one the editor before had. */
  keep?: (at: Caret) => void
  files?: (list: File[]) => void
  /** The editor itself, for the screen around it to read the words and draw
      over them — a thread's card beside its words. */
  editor?: () => Tip | null
}

/**
 * What can be done to words chosen, beside the marks — on the bar over them.
 */
export type OnWords = {
  /** Comment on them; offered to a reader too, who may comment and not edit. */
  comment?: (e: Tip) => void
  /** Make a task of each line of them. */
  task?: (e: Tip) => void
}

export function Editor({
  value,
  projectId,
  editable = true,
  placeholder,
  onChange,
  onSettle,
  onSending,
  testId,
  size = 14,
  tone,
  handle,
  onUp,
  people,
  collab,
  onWords,
  room = false,
}: {
  value: unknown
  /** Where an inserted file becomes a row. */
  projectId: string
  editable?: boolean
  placeholder?: string
  onChange: (body: unknown) => void
  /**
   * Called when the writing settles — on leaving the body, not on every
   * keystroke. The same moment the textarea before it saved on, for the
   * reason the task and document editors already give: a save per character
   * is a request per character.
   */
  onSettle?: (body: unknown) => void
  /**
   * Whether a picture or a file is still on its way up. The words handed to
   * `onChange` leave a file out until it has landed, so a window that makes
   * something from them could not tell — and made the task without it.
   */
  onSending?: (sending: boolean) => void
  testId?: string
  /** The size of its words: 14 where a document is read among other
      things, larger where it is the thing on the screen — a task's. */
  size?: number
  /** The colour of its words, where the place it stands in wants them
      quieter than the ink around them. */
  tone?: string
  /** For the field above it to hand the caret down — a title's Enter and
      Down arrow go to the start of the body. */
  handle?: React.MutableRefObject<EditorHandle | null>
  /** Up from the body's first line, back to the field above it. */
  onUp?: () => void
  /**
   * Who `@` offers: the people who can read what this body is on — a
   * task's project, never the whole workspace, since a name the reader of
   * the mention cannot open is a notification about nothing. None, and `@`
   * is a letter. `docs/specs/task-mentions.md`.
   */
  people?: readonly Callable[]
  /**
   * Bound to a document written together. Its
   * words then come from the shared state and not from `value`, and undo is
   * the shared state's own. Fixed for the life of the editor: a new state
   * is a new editor.
   */
  collab?: Collab
  /** What the bar over chosen words offers beside the marks. */
  onWords?: OnWords
  /**
   * Room under the last block that a press writes in — a document's, as
   * Notion's page has: a line to write on after whatever ends it, a toggle,
   * a callout, a table or a picture.
   */
  room?: boolean
}) {
  const pick = useRef<HTMLInputElement | null>(null)
  /* The sends in flight, and who wants to know. A ref, because `insert` and
     `land` are made once and the callback may not be. */
  const inFlight = useRef(new Set<string>())
  /* Read through a ref: the press below is built once, with the editor. */
  const doorsNow = useContext(PersonDoorsContext)
  const doors = useRef(doorsNow)
  doors.current = doorsNow
  const toldSending = useRef(onSending)
  toldSending.current = onSending

  /*
   * The block menu: what `/` opens and what the `+` opens, one thing.
   *
   * `at` is where to draw it — the caret's place on the page, asked of the
   * view rather than kept in sync with it. `typed` is what has been written
   * after the slash, so the list narrows as somebody keeps going. `from` is
   * where the slash itself is, because applying an item has to take the
   * `/quote` out of the text first.
   */
  const [menu, setMenu] = useState<{ at: { x: number; y: number; top: number }; from: number } | null>(null)
  /* The keyboard handler is built with the editor and `apply` needs the
     editor, so the two are introduced through a box rather than in order. */
  const chosen = useRef<((b: Block) => void) | null>(null)
  const [typed, setTyped] = useState('')
  const [chose, setChose] = useState(0)
  /* Read inside `handleKeyDown`, which is made once and would otherwise
     close over the first render's values for ever. */
  const live = useRef({ open: false, typed: '', chose: 0, files: true })
  /* No project, no file: a file is a row in a project's Docs, and a body
     being written before its project is chosen has nowhere to put one.
     The block is not offered rather than refused. */
  live.current = { open: menu !== null, typed, chose, files: Boolean(projectId) }
  /* Read in the key handler, which is built once. */
  const toTitle = useRef(onUp)
  toTitle.current = onUp

  /*
   * `@` being typed: where it started, what follows it, and where on the
   * page to draw who it could be. The same list the chat's line has — the
   * words after `@` narrow the project's people by name.
   */
  const [calling, setCalling] = useState<{ at: { x: number; y: number; top: number }; from: number; q: string } | null>(null)
  const [called, setCalled] = useState(0)
  const callable = calling && people ? people.filter((p) => p.name.toLowerCase().includes(calling.q.toLowerCase())).slice(0, 8) : []
  const calls = useRef({ open: false, found: [] as Callable[], chose: 0, pick: (_p: Callable) => {} })
  calls.current.open = callable.length > 0
  calls.current.found = callable
  calls.current.chose = called
  const peopleRef = useRef(people)
  peopleRef.current = people

  /*
   * The `+` in the margin of an empty line, and where that line is.
   *
   * It was a row under the body — "Add, or press /" — standing under every
   * description whether or not anybody was about to put anything in, and a
   * long way from the line it would have put it on. The offer belongs where
   * the next block will go: beside the empty line the caret is on, and
   * nowhere while somebody is writing a sentence.
   */
  const [gutter, setGutter] = useState<{ x: number; y: number } | null>(null)
  /* The table the caret is in: where its bar stands, and whether its first
     row is a header. */
  const [table, setTable] = useState<{ right: number; y: number; header: boolean } | null>(null)

  /*
   * The bar of marks over a selection, and where it stands.
   *
   * It was TipTap's bubble menu, which follows the selection: every word a
   * drag took in moved it, so it slid along the line under the hand and
   * jumped between lines. It stands where it first appeared now — `at` is a
   * place in the document, fixed when the bar comes up and kept until the
   * selection goes — and it comes up when the hand lets go rather than at
   * the first letter a drag crosses.
   *
   * `linking` is the same place showing a field for an address instead of
   * the marks: a link is written over the words it goes on, not in the
   * browser's prompt box at the top of the window.
   */
  const [bar, setBar] = useState<{ at: number } | null>(null)
  /* A phone writes with the dock on the keyboard instead of the bars and
     the `+` — `PhoneDock`. It is up while the body has the caret. */
  const phone = usePhone()
  const [writing, setWriting] = useState(false)
  const [linking, setLinking] = useState<{ from: number; to: number; href: string } | null>(null)
  const pressing = useRef(false)
  /* Read in `hold`, which is made with the editor. */
  const words = useRef(onWords)
  words.current = onWords
  const shelf = useRef<HTMLDivElement | null>(null)
  const [, redraw] = useState(0)

  const editor = useEditor({
    editable,
    extensions: [
      StarterKit.configure({
        link: { openOnClick: false, autolink: true, HTMLAttributes: { rel: 'noreferrer noopener' } },
        /* The line a held file will go in at, in the colour the screen
           around it lights up in. */
        dropcursor: { color: 'var(--accent)', width: 2 },
        /* Written together, undo is the shared state's: ProseMirror's own
           would take back somebody else's words. */
        ...(collab ? { undoRedo: false as const } : {}),
      }),
      Attachment,
      /* What a body names inline, kept through an edit even where nobody
         can type a new one. */
      Mention,
      /* Alive in a body: where the task stands now. */
      TaskChip,
      DocRef,
      CodeColours,
      /* An address stored as words, drawn as the link it is. */
      Autolink,
      /* Not resizable: a column is as wide as the table divides it, and a
         table wider than the body scrolls inside its own frame — the
         wrapper — rather than pushing the page. */
      TableKit.configure({ table: { resizable: false, renderWrapper: true, cellMinWidth: 80 } }),
      /* A block that stands out and one that folds. */
      Callout,
      ...Toggle,
      /* Into, out of and past them, and copied out of them as words. */
      ToggleKeys,
      Wraps,
      /* The words a thread is on. */
      CommentMark,
      ...(collab ? [collab.extension] : []),
    ],
    content: ((collab ? collab.content : value) as never) ?? undefined,
    editorProps: {
      attributes: {
        class: 'outline-none',
        ...(testId ? { 'data-testid': testId } : {}),
        /* On the editable element, the way the test id goes, and not as a
           prop on `EditorContent` — which is a React component and drops
           what it does not know, so the attribute never reached the DOM and
           the placeholder has never once been drawn. It was invisible while
           the body sat on a panel: an empty panel still said "write here".
           Flat, there is nothing left to say it. */
        ...(placeholder ? { 'data-placeholder': placeholder } : {}),
      },
      /*
       * Pasted and dropped files go the same way as picked ones.
       *
       * Handled here rather than by an extension because both hand back a
       * `DataTransfer` and the difference between them is not something the
       * person doing it thinks about.
       */
      /*
       * A link is followed with ⌘ (Ctrl elsewhere) held, as in every editor
       * that is also a document: a plain press puts the caret in the words,
       * which is what somebody editing them wants. Read-only, a press is
       * enough. Opened in a new tab, so the task stays where it was.
       */
      /*
       * A document it names opens on a press, as a task's chip does: it is
       * drawn as one, in the accent with a hand over it, and a "From 📄 …"
       * that went nowhere was the way back from a task made out of a line.
       */
      handleClickOn: (_view, _pos, node) => {
        if (node.type.name !== 'docref') return false
        const { id, projectId: in_ } = node.attrs as { id: string | null; projectId: string | null }
        const open = doors.current?.openFile
        if (!id || !open) return false
        open(in_ ?? projectId, id)
        return true
      },
      handleClick: (view, _pos, event) => {
        const a = (event.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null
        if (!a) return false
        /* A link inside a task's chip is the chip's to follow, on a plain press — `text-to-task.md`. */
        if (a.closest('[data-task-chip]')) return false
        if (!(event.metaKey || event.ctrlKey) && view.editable) return false
        window.open(a.href, '_blank', 'noopener,noreferrer')
        return true
      },
      /* And as the press is let go, before ProseMirror puts its own back. */
      handleDOMEvents: {
        mouseup: (view) => {
          caughtUp(view)
          return false
        },
      },
      handlePaste: (_view, event) => take(event.clipboardData),
      /* Where it was let go, between two blocks: a picture dropped in
         the middle of a sentence would cut it in two. The same point the
         drop line was drawn at. `docs/specs/drop-files.md`. */
      handleDrop: (view, event) => {
        const e = event as DragEvent
        const at = view.posAtCoords({ left: e.clientX, top: e.clientY })?.pos
        const block = view.state.schema.nodes.attachment?.create()
        const point = at === undefined || !block ? null : dropPoint(view.state.doc, at, new Slice(Fragment.from(block), 0, 0))
        return take(e.dataTransfer, point ?? at)
      },
      /*
       * The menu's keys, taken before the document sees them.
       *
       * Read through a ref: this handler is built once, and closing over the
       * first render's state would make the arrows walk a list that never
       * changes and Enter pick whatever was first when the editor was made.
       */
      handleKeyDown: (view, event) => {
        /* Where the caret is, before any key acts on it. */
        if (!event.isComposing) caughtUp(view)
        const now = live.current
        /* Who `@` is offering, before anything else reads the arrows. */
        const call = calls.current
        if (call.open) {
          if (event.key === 'ArrowDown') {
            setCalled((i) => (i + 1) % call.found.length)
            return true
          }
          if (event.key === 'ArrowUp') {
            setCalled((i) => (i - 1 + call.found.length) % call.found.length)
            return true
          }
          if (event.key === 'Enter' || event.key === 'Tab') {
            const who = call.found[call.chose] ?? call.found[0]
            if (who) call.pick(who)
            return true
          }
          if (event.key === 'Escape') {
            setCalling(null)
            return true
          }
        }
        /*
         * Escape in a code block selects the block, as in Notion: a block of
         * code is one thing, and selected it is taken out with Backspace
         * like a picture. Escape anywhere else is left alone.
         */
        if (event.key === 'Escape' && !now.open) {
          const { $from } = view.state.selection
          if ($from.parent.type.name === 'codeBlock') {
            view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, $from.before())))
            return true
          }
        }
        /*
         * Up from a picture that opens the body makes a line above it.
         *
         * A picture, a file or a rule as the first block left nowhere to
         * write before it: the caret could stand on the picture and Up
         * took it to the title, so the only way to put words first was to
         * cut the picture out and paste it back. Now Up from there opens an
         * empty line over it and puts the caret in it — and Up from that
         * line goes to the title as it always did.
         */
        if (event.key === 'ArrowUp' && !now.open && !event.shiftKey && !event.altKey && !event.metaKey && view.editable) {
          const sel = view.state.selection
          /* A table that opens the body: from its first row's top line. */
          const $at = sel.$from
          let tableFirst = false
          for (let d = $at.depth; d > 0; d--) {
            if ($at.node(d).type.name !== 'table') continue
            tableFirst = sel.empty && $at.before(d) === 0 && $at.index(d) === 0 && view.endOfTextblock('up')
            break
          }
          const onTop =
            (sel instanceof NodeSelection && sel.from === 0 && sel.node.isAtom) ||
            (sel instanceof GapCursor && sel.from === 0) ||
            tableFirst
          if (onTop) {
            const tr = view.state.tr.insert(0, view.state.schema.nodes.paragraph!.create())
            view.dispatch(tr.setSelection(TextSelection.create(tr.doc, 1)).scrollIntoView())
            return true
          }
        }
        /*
         * Up off the top of the body is back to its title — the way Down
         * and Enter in the title came in. From the first line of the first
         * block, and not from anywhere a line above the caret still belongs
         * to the body.
         */
        if (event.key === 'ArrowUp' && !now.open && !event.shiftKey && !event.altKey && !event.metaKey && toTitle.current) {
          const sel = view.state.selection
          const first = sel.$from.depth === 0 ? sel.from === 0 : sel.$from.index(0) === 0
          const atTop = sel instanceof NodeSelection ? first : sel.empty && first && view.endOfTextblock('up')
          if (atTop) {
            toTitle.current()
            return true
          }
        }
        if (!now.open) return false
        const list = BLOCKS.filter((b) => now.files || b.id !== 'file').filter((b) =>
          now.typed === '' ? true : b.said.toLowerCase().includes(now.typed.toLowerCase()),
        )
        if (event.key === 'Escape') {
          setMenu(null)
          return true
        }
        if (list.length === 0) return false
        if (event.key === 'ArrowDown') {
          setChose((i) => (i + 1) % list.length)
          return true
        }
        if (event.key === 'ArrowUp') {
          setChose((i) => (i - 1 + list.length) % list.length)
          return true
        }
        if (event.key === 'Enter' || event.key === 'Tab') {
          const block = list[now.chose] ?? list[0]
          if (block) chosen.current?.(block)
          return true
        }
        return false
      },
    },
    onUpdate: ({ editor: e, transaction }) => {
      onChange(settled(e.getJSON()))
      /* A change made by a control rather than a key — a picture resized,
         taken out, or arrived — is saved as it is made. */
      if (transaction.getMeta('settle')) onSettle?.(settled(e.getJSON()))
      watch(e)
    },
    onSelectionUpdate: ({ editor: e }) => watch(e),
    onFocus: ({ editor: e }) => watch(e),
    onBlur: ({ editor: e }) => {
      setGutter(null)
      setCalling(null)
      /* Into the bar's own field is not away from the editor. */
      setTimeout(() => {
        if (!document.activeElement?.closest('[data-text-bar]')) setBar(null)
        if (!document.activeElement?.closest('[data-table-bar]')) setTable(null)
      })
      onSettle?.(settled(e.getJSON()))
    },
  })

  /* ⌘ or Ctrl held marks the page, so links in a body look followable for
     as long as it is — the press that follows one is `handleClick`. */
  useEffect(() => {
    const root = document.documentElement
    const look = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey) root.setAttribute('data-follow', '')
      else root.removeAttribute('data-follow')
    }
    const drop = () => root.removeAttribute('data-follow')
    window.addEventListener('keydown', look)
    window.addEventListener('keyup', look)
    window.addEventListener('blur', drop)
    return () => {
      window.removeEventListener('keydown', look)
      window.removeEventListener('keyup', look)
      window.removeEventListener('blur', drop)
    }
  }, [])

  /* The hand let go: the bar comes up now, over what it chose. */
  // biome-ignore lint/correctness/useExhaustiveDependencies: hold is new on every render and reads only the editor, which is listed
  useEffect(() => {
    const up = () => {
      if (!pressing.current) return
      pressing.current = false
      if (editor) hold(editor)
    }
    window.addEventListener('pointerup', up)
    return () => window.removeEventListener('pointerup', up)
  }, [editor])

  /* A scroll moves the words under a bar that is drawn over the page. */
  // biome-ignore lint/correctness/useExhaustiveDependencies: listening is started and stopped when a bar appears or goes, not on every move of one
  useEffect(() => {
    if (!bar && !linking) return
    const again = () => redraw((n) => n + 1)
    window.addEventListener('scroll', again, true)
    window.addEventListener('resize', again)
    return () => {
      window.removeEventListener('scroll', again, true)
      window.removeEventListener('resize', again)
    }
  }, [bar !== null, linking !== null])

  /* Kept inside the window: measured once it is drawn, since its width is
     whatever its buttons come to. */
  useLayoutEffect(() => {
    const el = shelf.current
    if (!el) return
    const box = el.getBoundingClientRect()
    if (box.right > window.innerWidth - 8) {
      el.style.left = `${Math.max(8, window.innerWidth - 8 - box.width)}px`
    }
  })

  /** Words selected, the hand not still choosing them: the bar, where it stood. */
  function hold(e: Tip) {
    const s = e.state.selection
    /* Not in code: bold, headings and lists mean nothing inside a code
       block, and a bar of them over a selected word of code is eight
       answers to a question nobody asked. */
    const inCode = s.$from.parent.type.name === 'codeBlock' || s.$to.parent.type.name === 'codeBlock'
    /* Read-only, the bar holds what a reader may do — comment — or is not drawn. */
    if (s.empty || isNodeSelection(s) || (!e.isEditable && !words.current?.comment) || inCode) {
      setBar(null)
      return
    }
    if (pressing.current) return
    setBar((b) => b ?? { at: s.from })
    redraw((n) => n + 1)
  }

  function openLink() {
    if (!editor) return
    const { from, to } = editor.state.selection
    setLinking({ from, to, href: String(editor.getAttributes('link').href ?? '') })
  }

  /**
   * The address, on the words it was opened over.
   *
   * `http` and `https` only, and the rule lives here because this is where
   * the value is taken — `javascript:` is something a colleague clicks. An
   * address typed without its scheme is given one: `example.com` is what
   * people type.
   */
  function saveLink(raw: string) {
    const r = linking
    setLinking(null)
    setBar(null)
    if (!editor || !r) return
    let href = raw.trim()
    if (href && !/^[a-z][a-z\d+.-]*:/i.test(href)) href = `https://${href}`
    const chain = editor.chain().focus().setTextSelection({ from: r.from, to: r.to })
    if (!href) {
      chain.extendMarkRange('link').unsetLink().setTextSelection(r.to).run()
      return
    }
    if (!/^https?:\/\//i.test(href)) {
      editor.commands.focus()
      return
    }
    if (r.from === r.to) {
      chain.insertContent({ type: 'text', text: href, marks: [{ type: 'link', attrs: { href } }] }).run()
      return
    }
    chain.extendMarkRange('link').setLink({ href }).setTextSelection(r.to).run()
  }

  /**
   * Whether a slash is being typed as a command, and what after it.
   *
   * Only at the start of an empty-so-far block. Anywhere else a slash is a
   * slash — a date, a path, "and/or" — and a menu that opens on those is a
   * menu that interrupts writing rather than helping it.
   */
  function watch(e: Tip) {
    const { $from, empty } = e.state.selection
    place(e)
    hold(e)
    frame(e)
    ask(e)
    if (!empty) return setMenu(null)
    /* Nothing from the list inside a table: a table in a cell, or a
       heading, is something nobody meant. */
    if (tableAt(e) !== null) return setMenu(null)
    /* Nor in a toggle's one line, which takes words and nothing else. */
    if ($from.parent.type.name === 'detailsSummary') return setMenu(null)
    const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '\ufffc')
    const said = /^\/([\p{L}\p{N} ]*)$/u.exec(before)
    if (!said) {
      setMenu(null)
      return
    }
    const box = e.view.coordsAtPos($from.pos - before.length)
    setMenu({ at: { x: box.left, y: box.bottom, top: box.top }, from: $from.pos - before.length })
    setTyped(said[1] ?? '')
    setChose(0)
  }

  /**
   * Whether the words before the caret are `@` and the start of a name.
   *
   * After a space or at the start of a line, so an address — `me@there` —
   * calls nobody in; and not in code, where `@` is a decorator.
   */
  function ask(e: Tip) {
    const { $from, empty } = e.state.selection
    if (!peopleRef.current?.length || !empty || !e.isEditable || $from.parent.type.name === 'codeBlock') {
      return setCalling(null)
    }
    const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '\ufffc')
    const said = /(?:^|\s)@([\p{L}\p{N}._-]{0,32})$/u.exec(before)
    if (!said) return setCalling(null)
    const from = $from.pos - said[1]!.length - 1
    const box = e.view.coordsAtPos(from)
    setCalling((was) => {
      if (was?.from !== from || was.q !== said[1]) setCalled(0)
      return { at: { x: box.left, y: box.bottom, top: box.top }, from, q: said[1] ?? '' }
    })
  }

  /** The name typed after `@` becomes the person, and a space after them. */
  function pickPerson(who: Callable) {
    if (!editor || !calling) return
    editor
      .chain()
      .focus()
      .deleteRange({ from: calling.from, to: editor.state.selection.$from.pos })
      .insertContent([
        { type: 'mention', attrs: { id: who.actor_id, label: who.name } },
        { type: 'text', text: ' ' },
      ])
      .run()
    setCalling(null)
  }

  /** Where the table the caret is in begins, or null when it is in none. */
  function tableAt(e: Tip): number | null {
    const { $from } = e.state.selection
    for (let d = $from.depth; d > 0; d--) {
      if ($from.node(d).type.name === 'table') return $from.before(d)
    }
    return null
  }

  /**
   * The table's bar, over the table while the caret is in it — and only
   * then, as the bar over words is only there while words are chosen.
   */
  function frame(e: Tip) {
    const at = e.isEditable && e.isFocused ? tableAt(e) : null
    const dom = at === null ? null : (e.view.nodeDOM(at) as HTMLElement | null)
    if (at === null || !dom) {
      setTable(null)
      return
    }
    const box = dom.getBoundingClientRect()
    const first = e.state.doc.nodeAt(at)?.firstChild?.firstChild
    setTable({ right: box.right, y: box.top, header: first?.type.name === 'tableHeader' })
  }

  /**
   * Beside the line the caret is on, when that line is empty.
   *
   * Not in a code block, where an empty line is part of the code, and not
   * while anything is selected. Measured off the caret rather than the
   * block, so it sits on the first line's middle whatever the block's own
   * margins are.
   */
  function place(e: Tip) {
    const { $from, empty } = e.state.selection
    if (
      !e.isEditable ||
      !e.isFocused ||
      !empty ||
      !$from.parent.isTextblock ||
      $from.parent.type.name === 'codeBlock' ||
      $from.parent.type.name === 'detailsSummary' ||
      $from.parent.content.size > 0 ||
      tableAt(e) !== null
    ) {
      setGutter(null)
      return
    }
    const at = e.view.coordsAtPos($from.pos)
    const y = (at.top + at.bottom) / 2
    const page = e.view.dom
    /* In the panel's own margin, halfway between its edge and the words.
       Drawn over the page rather than inside the body, because the body
       scrolls in a box that clips at the words' left edge — the first
       version stood in the margin and was cut off by it. */
    const text = page.getBoundingClientRect().left
    const edge = page.closest('[data-panel]')?.getBoundingClientRect().left ?? text - 24
    /* And not over whatever the line has scrolled under. */
    let box: HTMLElement | null = page.parentElement
    while (box && !/(auto|scroll)/.test(getComputedStyle(box).overflowY)) box = box.parentElement
    const seen = box?.getBoundingClientRect()
    if (seen && (y < seen.top || y > seen.bottom)) {
      setGutter(null)
      return
    }
    /* Beside the words, as close as Notion has it, and never out past the
       panel's own edge. Halfway between the two was right while the words
       sat at the panel's margin and far out in the grey once a task stood
       in the middle of a wide one. */
    setGutter({ x: Math.max(text - 20, edge + 12), y })
  }

  /* A scroll or a resize moves the line and not the selection, so nothing
     else would ask again. */
  /* And the table's bar with its table, which a scroll moves the same way. */
  // biome-ignore lint/correctness/useExhaustiveDependencies: listening is started and stopped when the table's bar appears or goes; frame reads only the editor
  useEffect(() => {
    if (!table || !editor) return
    const again = () => frame(editor)
    window.addEventListener('scroll', again, true)
    window.addEventListener('resize', again)
    return () => {
      window.removeEventListener('scroll', again, true)
      window.removeEventListener('resize', again)
    }
  }, [table !== null, editor])

  // biome-ignore lint/correctness/useExhaustiveDependencies: listening is started and stopped when the gutter appears or goes; place reads only the editor
  useEffect(() => {
    if (!gutter || !editor) return
    const again = () => place(editor)
    window.addEventListener('scroll', again, true)
    window.addEventListener('resize', again)
    return () => {
      window.removeEventListener('scroll', again, true)
      window.removeEventListener('resize', again)
    }
  }, [gutter !== null, editor])

  /** Take the `/quote` out, then do the thing it named. */
  // biome-ignore lint/correctness/useExhaustiveDependencies: openLink is new on every render and reads only the editor, which is listed
  const apply = useCallback(
    (block: Block) => {
      if (!editor) return
      /* Only the slash leaves text to take out. Opened from the button
         there is none, and `from` is below zero to say so — a delete of
         range −1 is the crash that reaches whoever presses the button. */
      const from = menu?.from ?? -1
      setMenu(null)
      if (from >= 0) {
        editor.chain().focus().deleteRange({ from, to: editor.state.selection.$from.pos }).run()
      }
      if (block.id === 'file') pick.current?.click()
      else if (block.id === 'link') openLink()
      else block.run(editor)
    },
    [editor, menu],
  )
  chosen.current = apply
  calls.current.pick = pickPerson

  const shown = BLOCKS.filter((b) => projectId || b.id !== 'file').filter((b) =>
    typed === '' ? true : b.said.toLowerCase().includes(typed.toLowerCase()),
  )

  /*
   * Under the caret when it fits, over it when it does not.
   *
   * It was always under, so on a line near the foot of a long body the
   * list ran off the bottom of the window with the rest of its rows out of
   * reach. Whichever side has more room, held to that room and scrolled
   * inside it, with the chosen row kept in view as the arrows walk.
   */
  const list = useRef<HTMLDivElement | null>(null)
  const tall = Math.min(shown.length * 32 + 8, 328)
  const below = menu ? window.innerHeight - menu.at.y - 14 : 0
  const over = menu ? menu.at.top - 14 : 0
  const up = menu !== null && below < tall && over > below
  // biome-ignore lint/correctness/useExhaustiveDependencies: the chosen row is scrolled into view when the choice moves or the menu opens
  useEffect(() => {
    list.current?.querySelector('[data-chosen]')?.scrollIntoView({ block: 'nearest' })
  }, [chose, menu !== null])

  /*
   * A file goes into the body the moment it is chosen, and is sent behind it.
   *
   * It used to be sent first and drawn when the server answered, with
   * "Sending…" under the body for as long as that took — seconds for a
   * screenshot, a minute for a video, with nothing where it would go. Now
   * the node is there at once, drawn from the file the browser already
   * holds, and the send runs underneath with its progress on the picture;
   * when it lands the node is given its file id, outside the undo history,
   * because nobody did that. A send that fails takes its node with it.
   */
  /* Inside an open document, into it. */
  const into = useContext(UploadInto)
  // biome-ignore lint/correctness/useExhaustiveDependencies: land is new on every render and reads the editor, which is listed, and refs
  const insert = useCallback(
    async (files: File[], at?: number) => {
      if (!editor || files.length === 0 || !projectId) return
      for (const [i, file] of files.entries()) {
        const kind = kindOf(file.type)
        const uploadId = `up-${crypto.randomUUID()}`
        inFlight.current.add(uploadId)
        toldSending.current?.(true)
        /* A picture's own size, read from the file in hand, so the room for
           it is kept before its bytes arrive anywhere else. */
        const size = kind === 'file' ? {} : await measure(file)
        sending.begin(uploadId, kind === 'file' ? null : URL.createObjectURL(file))
        /*
         * After what is selected, never instead of it.
         *
         * `insertContent` replaces the selection, which is right for typing
         * and wrong for this: picking a file is not a keystroke, and the
         * first version of this quietly deleted the words somebody had
         * selected — including the ones they had just marked bold.
         */
        editor
          .chain()
          .focus()
          /* The first where it was let go, when it was; each after the
             one before it. Read after the measuring, which waits. */
          .setTextSelection(i === 0 && at !== undefined ? Math.min(at, editor.state.doc.content.size) : editor.state.selection.to)
          .insertContent({
            type: 'attachment',
            attrs: { fileId: null, uploadId, name: file.name, kind, size: file.size, ...size },
          })
          .run()
        void upload(into ?? projectId, file, {
          onProgress: (f) => sending.progress(uploadId, f),
          onAbortable: (abort) => sending.abortable(uploadId, abort),
        }).then((made) => land(uploadId, made))
      }
      /*
       * And the caret after it, on a line of its own.
       *
       * Inserting leaves the new node selected, and the next key somebody
       * typed replaced it — a picture sent and then deleted by the first
       * letter of the sentence after it. Onto the line that follows when
       * there is one, a new one when the picture was the last thing.
       */
      const { selection, doc } = editor.state
      if (isNodeSelection(selection)) {
        if (doc.resolve(selection.to).nodeAfter?.isTextblock) {
          editor.commands.setTextSelection(selection.to + 1)
        } else {
          editor.commands.createParagraphNear()
        }
      }
    },
    [editor, projectId, into],
  )

  /** A send came back: the node becomes the file, or goes. */
  function land(uploadId: string, made: { id: string; name: string } | null) {
    inFlight.current.delete(uploadId)
    toldSending.current?.(inFlight.current.size > 0)
    if (!editor || editor.isDestroyed) return
    let at = -1
    editor.state.doc.descendants((n, pos) => {
      if (at < 0 && n.type.name === 'attachment' && n.attrs.uploadId === uploadId) at = pos
      return at < 0
    })
    sending.done(uploadId, made?.id ?? null)
    if (at < 0) return
    const node = editor.state.doc.nodeAt(at)
    if (!node) return
    const tr = made
      ? editor.state.tr.setNodeMarkup(at, undefined, {
          ...node.attrs,
          fileId: made.id,
          name: made.name,
          uploadId: null,
        })
      : editor.state.tr.delete(at, at + node.nodeSize)
    /* Saved as it lands, whether or not somebody is still in the body: what
       was saved before had no file in it yet. */
    editor.view.dispatch(tr.setMeta('addToHistory', false).setMeta('settle', true))
  }

  function take(data: DataTransfer | null, at?: number): boolean {
    const files = Array.from(data?.files ?? [])
    if (files.length === 0) return false
    void insert(files, at)
    // Handled: the default would drop the file's name in as text.
    return true
  }

  /* The body arrives after the first render — the screen draws, then the
     request lands. Written in only when it is different, or every keystroke
     would be answered by putting the server's copy back. */
  useEffect(() => {
    /* Written together, the words arrive through the shared state. */
    if (!editor || !value || collab) return
    /* Compared without what is still being sent, which the body handed up
       never had — or a send in flight would read as the server's copy
       being different, and be written over. */
    const here = JSON.stringify(settled(editor.getJSON()))
    if (here === JSON.stringify(value)) return
    editor.commands.setContent(value as never, { emitUpdate: false })
  }, [editor, value, collab])

  /*
   * Into the body at its first line of words.
   *
   * Not `focus('start')`, which on a body that opens with a picture selects
   * the picture: the caret goes to the first block that takes words, and a
   * body with none is given one at its top.
   */
  useEffect(() => {
    if (!handle) return
    handle.current = {
      /* To the end of what is written: a press on the empty room under a
         body somebody is writing in a window. */
      end: () => {
        if (!editor || editor.isDestroyed) return
        /* Focused now, as `enter` is below: this was once also the caret
           handed to the editor bound to the shared state when it takes
           over (`keep` is now), and the keys pressed in the frame TipTap's
           `focus` waits for went into neither editor — a new document typed
           into at once lost every word one time in three. */
        editor.view.focus()
        editor.view.dispatch(editor.state.tr.setSelection(Selection.atEnd(editor.state.doc)).scrollIntoView())
      },
      caret: () => (editor && !editor.isDestroyed ? caretOf(editor.view) : null),
      /* Focused now, as `end` is, and not scrolled: the caret is where the
         person put it, on the screen they are reading. The words are the
         same ones, so the numbers are; kept inside them if they are not. */
      keep: (at: Caret) => {
        if (!editor || editor.isDestroyed) return
        const { doc, tr } = editor.state
        const inside = (n: number) => doc.resolve(Math.min(Math.max(n, 0), doc.content.size))
        editor.view.focus()
        editor.view.dispatch(tr.setSelection(TextSelection.between(inside(at.anchor), inside(at.head))))
      },
      /* Files let go of anywhere around the body rather than on its words —
         a window's empty room under them — go in at its end, as a picked
         one would. */
      files: (list: File[]) => {
        if (!editor || editor.isDestroyed || list.length === 0) return
        editor.commands.focus('end')
        void insert(list)
      },
      editor: () => (editor && !editor.isDestroyed ? editor : null),
      enter: () => {
        if (!editor || editor.isDestroyed) return
        let at = -1
        editor.state.doc.descendants((n, pos) => {
          if (at >= 0) return false
          if (n.isTextblock && n.type.name !== 'codeBlock') {
            at = pos + 1
            return false
          }
          return true
        })
        /* Focused now, not in the next frame as TipTap's `focus()` does:
           the keys pressed right after Enter went into neither field while
           that frame was coming, and on a slow machine the first letters
           of the sentence were lost. */
        editor.view.focus()
        if (at >= 0) editor.commands.setTextSelection(at)
        else editor.chain().insertContentAt(0, { type: 'paragraph' }).setTextSelection(1).run()
      },
    }
    return () => {
      handle.current = null
    }
  }, [editor, handle, insert])

  /* Whether the body has the caret, for the dock on a phone. */
  useEffect(() => {
    if (!editor) return
    const on = () => setWriting(true)
    const off = () => setWriting(false)
    editor.on('focus', on)
    editor.on('blur', off)
    return () => {
      editor.off('focus', on)
      editor.off('blur', off)
    }
  }, [editor])

  if (!editor) return null

  /** A press under the last block: its empty line if it ends on one, a new one after it if not. */
  const writeAtEnd = () => {
    if (editor.isDestroyed) return
    const { doc, schema, tr } = editor.state
    const last = doc.lastChild
    const paragraph = schema.nodes.paragraph!
    editor.view.focus()
    if (last?.type === paragraph && last.content.size === 0) {
      editor.view.dispatch(tr.setSelection(TextSelection.create(doc, doc.content.size - 1)).scrollIntoView())
      return
    }
    tr.insert(doc.content.size, paragraph.create())
    editor.view.dispatch(tr.setSelection(TextSelection.create(tr.doc, tr.doc.content.size - 1)).scrollIntoView())
  }

  return (
    <div
      className="relative flex flex-col gap-2"
      /* A press in the body starts a new choice: the bar goes, and comes
         back where the hand lets go. Presses on the bar itself arrive here
         too — React carries a portal's events through its tree — and are
         not presses in the body. */
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest('[data-text-bar], [data-table-bar], [data-node-control]')) return
        pressing.current = true
        setBar(null)
      }}
    >
      {/*
        Nothing until there is a selection.

        A bar of sixteen buttons over every description is chrome on content,
        and most bodies here are two sentences. Marks go on with the keys
        people already press and with this, over what is selected.
      */}
      {editable && phone && writing && !linking && (
        <PhoneDock editor={editor} onLink={openLink} onFile={() => pick.current?.click()} words={onWords} />
      )}
      {/* On a phone the dock has the marks; the bar comes up only to take
          an address, over the words it goes on. */}
      {(editable || onWords?.comment) &&
        (phone ? linking || (bar && !editable) : bar || linking) &&
        createPortal(
          <TextBar
            editor={editor}
            readOnly={!editable}
            {...(onWords ? { words: onWords } : {})}
            at={linking?.from ?? bar?.at ?? 0}
            shelf={shelf}
            linking={linking}
            onLink={openLink}
            onSaveLink={saveLink}
            onCancelLink={(back) => {
              setLinking(null)
              if (back) editor.commands.focus()
              else setBar(null)
            }}
          />,
          document.body,
        )}

      {/* Over the table the caret is in, at its right-hand end — the line
          above a table is written from the left, and a bar over its start
          covered the very words that introduce the table. Not while the
          bar over chosen words is up: two bars over one place is one too
          many. */}
      {editable &&
        !phone &&
        table &&
        !bar &&
        !linking &&
        createPortal(
          <div
            data-table-bar
            className="fixed z-[60] flex items-center gap-1 p-1 bg-float"
            style={{
              right: Math.max(8, window.innerWidth - table.right),
              top: Math.max(8, table.y - 44),
              boxShadow: 'var(--float-shadow)',
              borderRadius: 'var(--r-row)',
            }}
          >
            <Mark label={W.addRow} on={false} onPress={() => editor.chain().focus().addRowAfter().run()}>
              <span className="text-sm">{W.plusRow}</span>
            </Mark>
            <Mark label={W.addColumn} on={false} onPress={() => editor.chain().focus().addColumnAfter().run()}>
              <span className="text-sm">{W.plusColumn}</span>
            </Mark>
            <Mark label={W.removeRow} on={false} onPress={() => editor.chain().focus().deleteRow().run()}>
              <span className="text-sm">{W.minusRow}</span>
            </Mark>
            <Mark label={W.removeColumn} on={false} onPress={() => editor.chain().focus().deleteColumn().run()}>
              <span className="text-sm">{W.minusColumn}</span>
            </Mark>
            <span className="mx-1 h-4 w-px shrink-0 bg-line-strong" />
            <Mark label={W.headerRow} on={table.header} onPress={() => editor.chain().focus().toggleHeaderRow().run()}>
              <span className="text-sm">{W.header}</span>
            </Mark>
            <Mark label={W.deleteTable} on={false} onPress={() => editor.chain().focus().deleteTable().run()}>
              <Icon name="trash" size={16} />
            </Mark>
          </div>,
          document.body,
        )}

      <EditorContent
        editor={editor}
        className="prose-body min-h-[24px]"
        style={{ fontSize: size, ...(tone ? { ['--prose-ink' as string]: tone } : {}) }}
      />
      {editable && room && (
        <div
          data-body-room
          aria-hidden
          /* Over the gap already under the body, adding none of its own:
             a spacer in the flow put a blank band between a document's last
             line and its comments. */
          className="absolute inset-x-0 top-full h-6 cursor-text"
          onMouseDown={(e) => {
            e.preventDefault()
            writeAtEnd()
          }}
        />
      )}

      {/*
        The same list the slash opens, on a button for the people who do not
        know about the slash. Pressed rather than clicked, and the press kept
        from the page: a click takes the caret out of the body first, and the
        line it was going to put something on is the line it just left.

        Colour and not a ground under the pointer. The body has no ground of
        its own any more, and a lit square in its margin would be the only
        one on the screen.
      */}
      {editable &&
        !phone &&
        gutter &&
        createPortal(
          <button
            type="button"
            data-testid="block-menu"
            aria-label={WRITING.addBlock}
            onMouseDown={(e) => {
              e.preventDefault()
              if (menu) return setMenu(null)
              const box = editor.view.coordsAtPos(editor.state.selection.$from.pos)
              setTyped('')
              setChose(0)
              setMenu({ at: { x: box.left, y: box.bottom, top: box.top }, from: -1 })
            }}
            className="fixed z-[60] flex size-6 -translate-1/2 items-center justify-center rounded-full transition-colors mouse:hover:bg-[var(--hover)] mouse:hover:text-[var(--ink-2)]"
            style={{ left: gutter.x, top: gutter.y, color: 'var(--ink-3)' }}
          >
            <Icon name="plusThin" size={16} />
          </button>,
          document.body,
        )}
      {editable && (
        <input
          ref={pick}
          type="file"
          multiple
          data-testid="attach-input"
          className="hidden"
          onChange={(e) => {
            void insert(Array.from(e.target.files ?? []))
            e.target.value = ''
          }}
        />
      )}

      {/*
        Drawn at the caret and not in the flow, because the thing it is about
        is where the cursor is. Fixed rather than absolute: the body scrolls
        inside a panel, and a menu positioned against the document would
        drift away from the line it belongs to.
      */}
      {menu && shown.length > 0 && (
        <div
          ref={list}
          data-testid="block-list"
          data-menu
          className="fixed z-40 w-[260px] overflow-y-auto py-1"
          style={{
            left: menu.at.x,
            ...(up
              ? { bottom: window.innerHeight - menu.at.top + 6, maxHeight: Math.min(328, over) }
              : { top: menu.at.y + 6, maxHeight: Math.min(328, below) }),
            background: 'var(--float)',
            borderRadius: 'var(--r-panel)',
            boxShadow: 'var(--float-shadow)',
            ['--r-item' as string]: 'calc(var(--r-panel) - 4px)',
          }}
        >
          {shown.map((b, i) => (
            <button
              key={b.id}
              type="button"
              data-block={b.id}
              data-chosen={i === chose || undefined}
              // Pressed rather than clicked: a click has already taken the
              // focus out of the editor by the time it lands.
              onMouseDown={(e) => {
                e.preventDefault()
                apply(b)
              }}
              onMouseEnter={() => setChose(i)}
              className="flex w-full items-center gap-3 px-3 text-left text-base text-ink"
              style={{
                height: 'var(--row-h)',
                background: i === chose ? 'var(--hover)' : undefined,
              }}
            >
              <span className="flex w-4 shrink-0 justify-center text-sm text-ink-3">
                {/^[a-z][a-zA-Z]+$/.test(b.icon) ? <Icon name={b.icon as IconName} size={16} /> : b.icon}
              </span>
              <span className="min-w-px flex-1 truncate">{b.said}</span>
              {b.keys && <span className="shrink-0 text-sm text-ink-3">{b.keys}</span>}
            </button>
          ))}
        </div>
      )}
      {/* Who to call in, under the `@` as the block list is under the `/`;
          over it when the foot of the window is too near. */}
      {calling &&
        callable.length > 0 &&
        (() => {
          const tallPeople = callable.length * 32 + 8
          const room = window.innerHeight - calling.at.y - 14
          const above = room < tallPeople && calling.at.top - 14 > room
          return (
            <div
              data-mention-list
              data-menu
              className="fixed z-40 w-[260px] overflow-y-auto py-1"
              style={{
                left: calling.at.x,
                ...(above ? { bottom: window.innerHeight - calling.at.top + 6 } : { top: calling.at.y + 6 }),
                background: 'var(--float)',
                borderRadius: 'var(--r-panel)',
                boxShadow: 'var(--float-shadow)',
                ['--r-item' as string]: 'calc(var(--r-panel) - 4px)',
              }}
            >
              {callable.map((p, i) => (
                <button
                  key={p.actor_id}
                  type="button"
                  data-mention-row={p.actor_id}
                  data-chosen={i === called || undefined}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    pickPerson(p)
                  }}
                  onMouseEnter={() => setCalled(i)}
                  className="flex w-full items-center gap-3 px-3 text-left text-base text-ink"
                  style={{ height: 'var(--row-h)', background: i === called ? 'var(--hover)' : undefined }}
                >
                  <Avatar id={p.actor_id} name={p.name} url={p.avatar_url ?? null} size={20} />
                  <span className="min-w-px flex-1 truncate">{p.name}</span>
                </button>
              ))}
            </div>
          )
        })()}
    </div>
  )
}

/** Somebody `@` can name: who they are and the face to show. */
export type Callable = { actor_id: string; name: string; avatar_url?: string | null | undefined }

/**
 * The caret where the browser has already put it.
 *
 * A press puts the caret in the page at once, and ProseMirror hears of it
 * from the `selectionchange` that follows, a task later. Until then it goes
 * by its own caret: a key pressed in between acted there, and twenty
 * milliseconds after the body takes the focus ProseMirror writes its own
 * back over the press if it has heard nothing. In a body just bound to the
 * shared state its own is the document's first letter — where words typed
 * straight after a click landed, one run in three on a busy machine. This
 * is what that event would do, done now: the observer's own check, which
 * reads the page only when it holds a caret ProseMirror has not seen.
 */
function caughtUp(view: EditorView): void {
  const observer = (view as unknown as { domObserver?: { onSelectionChange?: () => void } }).domObserver
  observer?.onSelectionChange?.()
}

/** Where the caret is, as numbers another editor of the same words can take. */
export type Caret = { anchor: number; head: number }

/**
 * Read from the page where the person put it rather than from the state,
 * which may not have heard of the press yet (`caughtUp`). A read only: this
 * is asked while the screen is being drawn.
 */
function caretOf(view: EditorView): Caret {
  const { anchor, head } = view.state.selection
  const dom = view.dom.ownerDocument.getSelection()
  if (!(view.state.selection instanceof TextSelection) || !dom?.anchorNode || !dom.focusNode) return { anchor, head }
  if (!view.dom.contains(dom.anchorNode) || !view.dom.contains(dom.focusNode)) return { anchor, head }
  try {
    return { anchor: view.posAtDOM(dom.anchorNode, dom.anchorOffset), head: view.posAtDOM(dom.focusNode, dom.focusOffset) }
  } catch {
    return { anchor, head }
  }
}

/**
 * The document as it may leave the editor: without the files still on
 * their way, and without the mark of a send on the ones that arrived.
 */
export function settled<T>(doc: T): T {
  const walk = (n: Record<string, unknown>): Record<string, unknown> | Record<string, unknown>[] | null => {
    if (n.type === 'attachment') {
      const attrs = { ...(n.attrs as Record<string, unknown>) }
      if (!attrs.fileId) return null
      delete attrs.uploadId
      return { ...n, attrs }
    }
    /* A task still being made is its words until it has an id — and the
       token it is found by is nobody else's business. */
    if (n.type === 'taskref') {
      const attrs = { ...(n.attrs as Record<string, unknown>) }
      if (!attrs.id) {
        /* Its line, links and all, when it held one — `text-to-task.md`. */
        const line = cleanLine(attrs.line)
        if (line) return line as unknown as Record<string, unknown>[]
        return attrs.title ? { type: 'text', text: String(attrs.title) } : null
      }
      delete attrs.making
      return { ...n, attrs }
    }
    const kids = n.content as Record<string, unknown>[] | undefined
    if (!kids) return n
    return { ...n, content: kids.flatMap(walk).filter((k): k is Record<string, unknown> => k !== null) }
  }
  return walk(doc as Record<string, unknown>) as T
}
