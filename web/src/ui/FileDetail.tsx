import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { HEADS, MAKE, MORE } from '../data/words.js'
import { api, untilAnswered } from '../data/api.js'
import { recall, remember } from '../data/memory.js'
import { printAsPdf } from '../data/print.js'
import { DocMark, MarkRails, MentionedIn, Popover, Toolbar, readLinks, urlField } from './kit.jsx'
import { Round, RoundFace } from './TaskDetail.jsx'
import { Icon, type IconName } from './glyphs.jsx'
import { Discussion, type Comment } from './Comments.jsx'
import { Editor, type EditorHandle, type OnWords } from './Editor.jsx'
import type { Editor as Tip } from '@tiptap/react'
import { WordsCard, type CardAt, type WordsCardState } from './WordsCard.jsx'
import { anchorOf, threadsIn, wait, waitingRange } from './editor/comment.js'
import { Outline } from './editor/outline.jsx'
import { linesToMake } from './editor/taskLines.js'
import { Fragment } from '@tiptap/pm/model'
import { lineForTask } from '@tracker/shared-schema'
import { ThreadPress, wordsOfChip } from './editor/taskChip.jsx'
import { DropHere, useDropFiles } from './DropFiles.jsx'
import { EDITOR } from '../words/editor.js'
import { Lightbox } from './Doc.jsx'
import { fileLinks, knownLinks, type Links } from '../data/files.js'
import { FILE_DETAIL as W } from '../words/fileDetail.js'
import { DOCS } from '../words/docs.js'
import { DOC_TEMPLATE as TEMPLATE } from '../words/docTemplates.js'
import { readTemplates } from '../data/docTemplates.js'
import { useCoedit } from '../data/coedit.js'
import { collaboration } from './editor/collab.js'
import { SubscribePill } from './Leaving.jsx'
import { DocAccess, type Audience } from './DocAccess.jsx'
import { UploadInto } from '../data/upload.js'
import { VersionHistory, nearVersions, readyVersions } from './VersionHistory.jsx'
import { VERSION_HISTORY } from '../words/versionHistory.js'

type Full = {
  id: string
  name: string
  body: unknown
  url: string | null
  /** Whether it is an upload — there are bytes to open. */
  upload: boolean
  /** What the bytes are, as the server read them — a picture is shown. */
  content_type?: string | null
  version: number
  /** Who made it: your own is yours to delete. */
  author_id?: string
  /** Its number in the project — the address and the name a task gives it. */
  number?: number | null
  author_name: string
  /** Shared to the web: the link's token, or nothing. */
  public_token?: string | null
  /** Saved as a template. */
  template_at?: string | null
  /** Whether **you** follow it. */
  subscribed?: boolean
  /** Whether the reader may change it, as the server decides — a PATCH's own question. */
  may_edit?: boolean
  /** What it wears — `docs/specs/docs.md`, "A document's mark". */
  mark_icon?: string | null
  mark_tint?: number | null
  /** Who it is for, its chosen people, and whether you may change that. */
  audience?: Audience
  reader_ids?: string[]
  may_share?: boolean
  /** Pictures its body shows that it does not hold. */
  loose_files?: number | null
}

type Read = { file: Full; comments: Comment[] }

/*
 * Read ahead while the hand is on the row, as a task is — `near` in
 * `TaskDetail.tsx`. The document then opens on its words rather than on a
 * blank page that fills a request later. Once per document; the screen
 * still asks again when it opens.
 */
const asked = new Set<string>()
export function nearFile(fileId: string): void {
  if (asked.has(fileId) || recall<Read>(`file:${fileId}`)) return
  asked.add(fileId)
  void readLinks('file', fileId).catch(() => {})
  void api<Read>(`/files/${fileId}`)
    .then((r) => remember<Read>(`file:${fileId}`, r))
    .catch(() => asked.delete(fileId))
}

/*
 * Deleted elsewhere — another window, another person — while it is open
 * here: the project's socket says so, and the screen says it is gone in
 * place rather than letting somebody type into nothing.
 */
const goneListeners = new Map<string, Set<() => void>>()
export function fileGone(id: string): void {
  for (const say of goneListeners.get(id) ?? []) say()
}

/**
 * A document, written.
 *
 * It could be created and never written into: the endpoint that bumps the
 * version existed and nothing called it. An upload and a link open here too,
 * because the comments belong to the row rather than to the kind.
 */
export function FileDetail({
  fileId,
  projectId,
  projectKey = null,
  canMakeTasks = false,
  canWrite,
  canEditAny,
  meId,
  mayDelete,
  onDelete,
  onClose,
  onChanged,
}: {
  fileId: string
  /** Whether one by this author is the reader's to delete — your own, or `file.delete`. */
  mayDelete?: (authorId: string | undefined) => boolean
  /** Deleting it: the project takes it off the list and offers it back. */
  onDelete?: (f: { id: string; name: string }) => void
  /** The project's handle, for a task made from a line. */
  projectKey?: string | null
  /** `task.create` on this project. */
  canMakeTasks?: boolean
  /** Where a picture or a file put into the document becomes a row. */
  projectId: string
  canWrite: boolean
  /** `content.edit.said`: whether somebody else's words are yours to change. */
  canEditAny: boolean
  meId: string
  onClose: () => void
  onChanged: () => void
}) {
  /* What was read ahead, or last time — the screen opens on it. */
  const [had] = useState(() => recall<Read>(`file:${fileId}`))
  const [file, setFile] = useState<Full | null>(had?.file ?? null)
  const [comments, setComments] = useState<Comment[]>(had?.comments ?? [])
  const [text, setText] = useState<unknown>(had?.file.body ?? null)
  const [saved, setSaved] = useState<number | null>(had?.file.version ?? null)
  /* "Link copied", for a moment, beside the menu it came from. */
  const [copied, setCopied] = useState<string | null>(null)
  /* Shared to the web, or not. Turned on, the
     link is copied at once: that is what turning it on is for. */
  const [sharing, setSharing] = useState(false)
  const copyPublic = (token: string) =>
    navigator.clipboard
      .writeText(`${location.origin}/d/${token}`)
      .then(() => setCopied(W.publicLinkCopied))
      .catch(() => setCopied(W.couldNotCopy))
      .finally(() => setTimeout(() => setCopied(null), 1800))
  async function share(on: boolean) {
    if (!file) return
    setSharing(true)
    try {
      const r = await api<{ token: string | null }>(`/files/${file.id}/public`, { method: 'PUT', body: JSON.stringify({ public: on }) })
      setFile((f) => (f ? { ...f, public_token: r.token } : f))
      if (r.token) await copyPublic(r.token)
      else {
        setCopied(W.noLongerShared)
        setTimeout(() => setCopied(null), 1800)
      }
    } catch (e) {
      setCopied((e as Error).message || W.couldNotShare)
      setTimeout(() => setCopied(null), 2400)
    } finally {
      setSharing(false)
    }
  }
  /* Saved as a template, or taken back.
     Said beside the menu, as sharing is; the list "New document" offers
     is asked again so it holds the change. */
  async function template(on: boolean) {
    if (!file) return
    const was = file.template_at ?? null
    setFile((f) => (f ? { ...f, template_at: on ? new Date().toISOString() : null } : f))
    try {
      const r = await api<{ template_at: string | null }>(`/files/${file.id}/template`, {
        method: 'PUT',
        body: JSON.stringify({ template: on }),
      })
      setFile((f) => (f ? { ...f, template_at: r.template_at } : f))
      setCopied(on ? TEMPLATE.savedAsTemplate : TEMPLATE.noLongerTemplate)
      void readTemplates().catch(() => {})
      onChanged()
    } catch (e) {
      setFile((f) => (f ? { ...f, template_at: was } : f))
      setCopied((e as Error).message || TEMPLATE.couldNotSave)
    } finally {
      setTimeout(() => setCopied(null), 1800)
    }
  }
  /* The document's versions, in a window over it. */
  const [history, setHistory] = useState(false)
  /* Where the words are drawn, for the PDF to copy them from. */
  const written = useRef<HTMLDivElement | null>(null)
  /* A write that did not happen has to say so. See `save`. */
  const [unsaved, setUnsaved] = useState(false)

  /**
   * Whether what is in the field is the person's and not the server's.
   *
   * A read must never overwrite something somebody is in the middle of
   * writing. That sounds obvious and it was not the case: the body was set
   * from every load, so a second fetch landing a moment after the first
   * typed word replaced the paragraph with the empty one it was loaded with,
   * and there was nothing on screen to say anything had happened.
   *
   * The reproducible version of it is React's development double-mount,
   * which fetches twice — the second answer arrived after the typing about
   * one time in three. The version that matters is the other one: somebody
   * else changes the project, the screen refetches because that is how news
   * arrives here, and your paragraph is gone.
   */
  const touched = useRef(false)
  /**
   * Whether the name in the field is one the person typed since it last had
   * the caret — `touched`, for the title.
   *
   * Leaving the field wrote whatever it held, and what it held could be a
   * copy kept from before: named, left, opened again a moment later, the
   * kept read still said "Untitled", chose it to be typed over, and a click
   * into the body before the server's answer landed wrote "Untitled" back
   * over the name. Only a name somebody typed is written, and a
   * read that lands while they are typing keeps theirs.
   */
  const nameTyped = useRef(false)
  /* What this screen keeps of the document, told the name the person gave
     it, so the next opening draws that and not the one it was made with. */
  const keepName = useCallback(
    (name: string) => {
      const had = recall<Read>(`file:${fileId}`)
      if (had) remember<Read>(`file:${fileId}`, { ...had, file: { ...had.file, name } })
    },
    [fileId],
  )
  /** The body, for the title to hand the caret down to. */
  const into = useRef<EditorHandle | null>(null)
  const titleField = useRef<HTMLTextAreaElement | null>(null)
  useLayoutEffect(() => {
    const el = titleField.current
    if (!el) return
    const fit = () => {
      el.style.height = 'auto'
      el.style.height = `${el.scrollHeight}px`
    }
    fit()
    const watch = new ResizeObserver(fit)
    watch.observe(el.parentElement ?? el)
    return () => watch.disconnect()
  })

  /* A document just made opens with its name chosen, ready to be typed
     over — `docs/specs/docs.md`. Once, for the file that arrived new. */
  const named = useRef<string | null>(null)
  useEffect(() => {
    if (!file || named.current === fileId || !canWrite) return
    named.current = fileId
    if (file.name === 'Untitled' && !file.upload && !file.url) {
      titleField.current?.focus()
      titleField.current?.select()
    }
  }, [file, fileId, canWrite])

  // A different file is a different draft.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a different file is a different draft
  useEffect(() => {
    touched.current = false
    nameTyped.current = false
    setUnsaved(false)
  }, [fileId])

  /* Same as the task screen: a read that did not work says so rather than
     rendering nothing for ever. */
  const [gone, setGone] = useState(false)

  /*
   * An uploaded picture or video is shown, not linked to.
   *
   * Its screen was its name and "Open the file" — a picture somebody put in
   * Docs had to be opened in another tab to be seen at all. The links are
   * the ones every other place keeps (`data/files.ts`), so a picture the
   * list or a body already drew opens with its bytes in hand.
   */
  const media = file?.upload
    ? /^image\//.test(file.content_type ?? '')
      ? 'image'
      : /^video\//.test(file.content_type ?? '')
        ? 'video'
        : null
    : null
  const [links, setLinks] = useState<Links | null>(() => knownLinks(fileId))
  const [big, setBig] = useState(false)
  useEffect(() => {
    if (!media) return
    let live = true
    void fileLinks(fileId)
      .then((l) => live && setLinks(l))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [fileId, media])

  const load = useCallback(async () => {
    /* What points at it, beside it — the section is inside the document,
       and asked from there it grew in a round trip after it. */
    const [r] = await Promise.all([api<Read>(`/files/${fileId}`), readLinks('file', fileId).catch(() => [])])
    remember<Read>(`file:${fileId}`, r)
    setFile((f) => (nameTyped.current && f ? { ...r.file, name: f.name } : r.file))
    setComments(r.comments)
    if (touched.current) return
    setText(r.file.body ?? null)
    setSaved(r.file.version)
  }, [fileId])
  useEffect(() => {
    setGone(false)
    /* Gone only when the server says so: a refusal it could not help — a
       restart, a 500 — is asked again rather than called a deletion. */
    return untilAnswered(load, () => setGone(true))
  }, [load])
  useEffect(() => {
    const say = () => setGone(true)
    const all = goneListeners.get(fileId) ?? new Set()
    all.add(say)
    goneListeners.set(fileId, all)
    return () => {
      all.delete(say)
      if (all.size === 0) goneListeners.delete(fileId)
    }
  }, [fileId])

  /*
   * Written together. A written document opens
   * its room as soon as it is known to be one; the editor is bound to the
   * shared state once the server has answered, in one frame. Until then —
   * and if it never answers — the editor is the one it always was, saving
   * on leaving the body through `PATCH`, which the server merges; somebody
   * who typed into it keeps it until that save lands, and then the shared
   * editor takes over.
   */
  const isWritten = Boolean(file && !file.url && !file.upload)
  const { session, live } = useCoedit(isWritten ? fileId : null)
  const [alone, setAlone] = useState(false)
  const together = Boolean(live?.ready) && !alone
  const liveDoc = live?.doc
  const liveCarets = live?.carets
  const collab = useMemo(
    () => (together && session && liveDoc && liveCarets ? collaboration(liveDoc, liveCarets, session.mute, session.guard) : null),
    [together, session, liveDoc, liveCarets],
  )
  /* The caret goes with the swap: somebody who had clicked into the body
     the moment before it was bound is still in it after, rather than
     typing into nothing. */
  const focusedBefore = useRef(false)
  /* Asked in the render that swaps them, while the old editor is still on
     the page: a press into the body renders nothing here, so a value kept
     from the render before was from before the press, and the keys typed
     after the swap went to no field at all — or opened a new task, as
     shortcuts. */
  const boundBefore = useRef<unknown>(null)
  if (collab !== boundBefore.current) {
    if (collab && !boundBefore.current) focusedBefore.current = Boolean(written.current?.contains(document.activeElement))
    boundBefore.current = collab
  }
  useEffect(() => {
    if (collab && focusedBefore.current) into.current?.end?.()
    focusedBefore.current = false
  }, [collab])
  /* What the document opens on next time is what it last showed. */
  const latest = useRef<unknown>(null)
  const liveVersion = live?.version ?? null
  const changedRef = useRef(onChanged)
  changedRef.current = onChanged
  useEffect(() => {
    if (liveVersion === null) return
    setSaved(liveVersion)
    changedRef.current()
  }, [liveVersion])
  useEffect(
    () => () => {
      const had = recall<Read>(`file:${fileId}`)
      if (had && latest.current) remember<Read>(`file:${fileId}`, { ...had, file: { ...had.file, body: latest.current } })
    },
    [fileId],
  )

  /*
   * Threads on words. One card at a
   * time, in the document's column under the words it is about; which
   * threads are open decides which words are tinted, so resolving one takes
   * its tint away without touching the body.
   */
  const column = useRef<HTMLDivElement | null>(null)
  const [card, setCard] = useState<WordsCardState | null>(null)
  const closeCard = useCallback(() => {
    const ed = into.current?.editor?.()
    if (ed) wait(ed, null)
    setCard(null)
  }, [])
  const cardAt = (box: { bottom: number; left: number }): CardAt => {
    const c = column.current?.getBoundingClientRect()
    if (!c) return { top: 0, left: 0 }
    return {
      top: Math.round(box.bottom - c.top + 8),
      left: Math.max(0, Math.min(Math.round(box.left - c.left), Math.round(c.width) - 360)),
    }
  }
  const threads = comments.filter((c) => c.quote && !c.parent_id)
  const openIds = threads.filter((c) => !c.resolved_at).map((c) => c.id)
  const bound = into.current?.editor?.() ?? null
  const present = bound ? threadsIn(bound) : null
  const lost = new Set(threads.filter((c) => (present ? !present.has(c.id) : c.on_deleted_text)).map((c) => c.id))
  /** A thread's words, scrolled to, with its card open under them. */
  const showThread = (id: string) => {
    const spans = written.current?.querySelectorAll(`[data-comment~="${id}"]`)
    const last = spans?.[spans.length - 1] as HTMLElement | undefined
    if (!last) return
    last.scrollIntoView({ block: 'center' })
    setCard({ kind: 'thread', id, at: cardAt(last.getBoundingClientRect()) })
  }
  /* A tinted stretch pressed: the newest open thread on it. */
  const pressedWords = (target: EventTarget | null): boolean => {
    const el = (target as HTMLElement | null)?.closest?.('[data-comment]') as HTMLElement | null
    if (!el) return false
    const on = new Set((el.getAttribute('data-comment') ?? '').split(/\s+/))
    const newest = threads.filter((c) => on.has(c.id) && !c.resolved_at).sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0]
    if (newest) showThread(newest.id)
    return Boolean(newest)
  }
  /*
   * Lines into tasks. Each line the
   * selection touches is a task, its chosen words the title; the words
   * become a chip at once, the chip takes the task's id when the server
   * answers, and goes back to words if it refuses.
   */
  /* The chips this page is making now, by token. */
  const mine = useRef(new Set<string>())
  const makeTasks = (e: Tip) => {
    const { from, to } = e.state.selection
    /* One task a line, a hard break included, swallowed whole. A line that
       carries more than words — a thread's mark, a link, a mention,
       formatting — is kept in the chip's `line`, which draws it while the
       task is still called by it; only one too large for that keeps its
       words, the chip in front of them. */
    const lines = linesToMake(e.state.doc, from, to)
    if (lines.length === 0 || lines.length > 50 || !file) return
    /* What each line was, put back as it was if the server refuses. */
    const made = lines.map((l) => ({ ...l, making: crypto.randomUUID(), was: e.state.doc.slice(l.from, l.to).content.toJSON() as unknown }))
    /* This page's own, never taken for left behind while they are on their way. */
    for (const l of made) mine.current.add(l.making)
    const kind = e.schema.nodes.taskref
    if (!kind) return
    let tr = e.state.tr
    for (const l of [...made].reverse()) {
      const chip = kind.create({ title: l.title, projectId, key: projectKey, making: l.making, line: l.line })
      tr = l.keep ? tr.insert(l.from, [chip, e.schema.text(' ')]) : tr.replaceWith(l.from, l.to, chip)
    }
    e.view.dispatch(tr.scrollIntoView())
    /* The words are chips now: the bar over them goes with the selection. */
    e.commands.setTextSelection(e.state.selection.to)
    const from_ = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: `${EDITOR.fromDocument} ` },
            { type: 'docref', attrs: { id: file.id, projectId, number: file.number ?? null, title: file.name } },
          ],
        },
      ],
    }
    /** The chip still being made with this token, wherever it is now. */
    const settle = (making: string, to: (pos: number, attrs: Record<string, unknown>, ed: Tip) => void) => {
      const ed = into.current?.editor?.()
      if (!ed) return
      ed.state.doc.descendants((n, pos) => {
        if (n.type.name === 'taskref' && n.attrs.making === making) to(pos, n.attrs, ed)
        return true
      })
    }
    /* One after another: two made at once in one project raced for the
       same number and the second was refused. */
    void made.reduce(
      (before, l) =>
        before.then(() =>
          api<{ id: string; number: number }>(`/projects/${projectId}/tasks`, {
            method: 'POST',
            /* The line said in the description, above the way back, when the
               title does not say all of it: its links and mentions, which
               work from the task too, or its words past a title's limit. */
            body: JSON.stringify({
              title: l.title,
              body: l.line
                ? { ...from_, content: [{ type: 'paragraph', content: lineForTask(l.line) }, ...from_.content] }
                : l.said
                  ? { ...from_, content: [{ type: 'paragraph', content: [{ type: 'text', text: l.said }] }, ...from_.content] }
                  : from_,
            }),
          })
            .then((t) =>
              settle(l.making, (pos, attrs, ed) =>
                ed.view.dispatch(ed.state.tr.setNodeMarkup(pos, undefined, { ...attrs, id: t.id, number: t.number, making: null })),
              ),
            )
            .catch(() =>
              /* Found by its token, wherever it is now; the space put after
                 it goes only if it is still the one right after it. */
              settle(l.making, (pos, _attrs, ed) => {
                if (!l.keep) return ed.view.dispatch(ed.state.tr.replaceWith(pos, pos + 1, Fragment.fromJSON(ed.schema, l.was)))
                const after = ed.state.doc.textBetween(pos + 1, Math.min(pos + 2, ed.state.doc.content.size))
                ed.view.dispatch(ed.state.tr.delete(pos, after === ' ' ? pos + 2 : pos + 1))
              }),
            )
            .finally(() => mine.current.delete(l.making)),
        ),
      Promise.resolve(),
    )
  }
  /*
   * A chip begun on a page that closed before the server answered has no
   * task and never will: "Making…" for ever, in everybody's copy. Whoever
   * writes next turns one begun more than thirty seconds ago back into its
   * words. The stored body never holds one (`bodyOf`, `settled`).
   */
  const writing = Boolean(together && canWrite && live?.write)
  useEffect(() => {
    if (!writing) return
    /* Counted from when this page first saw each one — its own clock, not
       the clock of the browser that began it. */
    const seen = new Map<string, number>()
    const look = () => {
      const ed = into.current?.editor?.()
      if (!ed || !ed.isEditable) return
      const stale: { pos: number; title: string; line: unknown }[] = []
      ed.state.doc.descendants((n, pos) => {
        if (n.type.name !== 'taskref' || n.attrs.id || typeof n.attrs.making !== 'string') return true
        const token = String(n.attrs.making)
        if (mine.current.has(token)) return true
        const first = seen.get(token) ?? Date.now()
        seen.set(token, first)
        if (Date.now() - first > 30_000) stale.push({ pos, title: String(n.attrs.title ?? ''), line: n.attrs.line })
        return true
      })
      if (!stale.length) return
      let tr = ed.state.tr
      /* Back to the line it held — links, mentions, marks — or to its title. */
      for (const c of stale.reverse())
        tr = c.title || c.line ? tr.replaceWith(c.pos, c.pos + 1, wordsOfChip(ed, c.title, c.line)) : tr.delete(c.pos, c.pos + 1)
      ed.view.dispatch(tr.setMeta('addToHistory', false))
    }
    const timer = setInterval(look, 10_000)
    look()
    return () => clearInterval(timer)
  }, [writing])

  const onWords: OnWords | undefined =
    together && canWrite
      ? {
          ...(live?.write && canMakeTasks ? { task: makeTasks } : {}),
          comment: (e) => {
            const { from, to } = e.state.selection
            const anchor = anchorOf(e, { from, to })
            const quote = e.state.doc.textBetween(from, to, ' ').replace(/\s+/g, ' ').trim()
            if (!anchor || !quote) return
            const end = e.view.coordsAtPos(to)
            const startAt = e.view.coordsAtPos(from)
            /* Tinted at once; the bar goes with the selection. */
            wait(e, { from, to })
            e.commands.setTextSelection(to)
            setCard({
              kind: 'new',
              quote,
              at: cardAt({ bottom: end.bottom, left: startAt.left }),
              send: async (body) => {
                const made = await api<{ id: string }>(`/files/${fileId}/comments`, {
                  method: 'POST',
                  body: JSON.stringify({ body, anchor }),
                })
                await load()
                return made.id
              },
            })
          },
        }
      : undefined

  const drop = useDropFiles(Boolean(file && canWrite && !file.url && !file.upload), (files) => into.current?.files?.(files))

  if (gone) {
    return (
      <div className="flex h-full flex-col">
        <Toolbar>
          <Round icon="chevL" label={W.back} testId="close-file" on={false} onPress={onClose} />
        </Toolbar>
        <p className="mt-6 text-sm text-ink-2">{W.gone}</p>
      </div>
    )
  }
  if (!file) return null

  /**
   * Written on leaving the field, from the field rather than from state.
   *
   * `value` is passed in and not read from `text`, and that is the whole bug
   * this argument exists for: the handler closes over the `text` of the
   * render it was made in, React batches the update from typing, and leaving
   * the field in the same tick runs a `save` that still sees the old text.
   * It compares equal to what is stored, decides nothing changed, and
   * returns — no request, no error, no sign. Type a line and press Tab and
   * the line is gone, which is exactly what somebody does when they are
   * moving quickly.
   *
   * The failure was intermittent and looked like a slow test. It is neither:
   * it is a race that a person wins more often than a machine does.
   */
  async function save(value: unknown) {
    if (!file) return
    if (JSON.stringify(value) === JSON.stringify(file.body)) {
      /* Typed and taken back: nothing to keep, and nothing in the way of
         the shared editor. */
      if (touched.current) {
        touched.current = false
        setAlone(false)
      }
      return
    }
    try {
      const r = await api<{ version: number }>(`/files/${file.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ body: value }),
      })
      /*
       * What is stored is now what was sent. Without this, every later visit
       * to the field compares against the body it was loaded with, decides it
       * has changed again, and writes — so leaving the field twice without
       * touching a character costs a version, and the history fills with
       * revisions nobody made.
       */
      setFile({ ...file, body: value })
      /* And what this document opens on next time is what was just kept. */
      remember<Read>(`file:${file.id}`, { file: { ...file, body: value, version: r.version ?? file.version + 1 }, comments })
      // The version is the receipt. Without it "saved" is a word the
      // interface says to itself.
      setSaved(r.version ?? (saved ?? 0) + 1)
      setUnsaved(false)
      // Stored, so a later read is allowed to speak for this field again.
      touched.current = false
      // And the shared editor, if the room has answered, takes over.
      setAlone(false)
      onChanged()
    } catch {
      // Said out loud. A write that went nowhere and left the screen looking
      // finished is the worst of the three possible outcomes.
      setUnsaved(true)
    }
  }

  return (
    /* What is uploaded in here — into its body, into a comment under it —
       is a written document's own, from the first byte, and seen by whoever
       sees it. */
    <UploadInto.Provider value={!file.url && !file.upload ? `doc:${projectId}:${file.id}` : null}>
      <div className="flex h-full flex-col">
        {/*
        The head a task has, on the project's own bar: a round way back, what
        this is beside it, and a menu at the other end — `docs/specs/docs.md`.
        It was a "← back" in twelve-pixel grey and an "Export PDF" at the far
        edge of the window, a row of its own under an empty bar, so a
        document's title stood lower than a task's and its head looked like
        nothing else in the product.
      */}
        <Toolbar>
          <div className="flex w-full items-center gap-3">
            <Round icon="chevL" label={W.back} testId="close-file" on={false} onPress={onClose} />
            <span className="text-sm text-ink-3">{W.version(saved ?? file.version)}</span>
            {unsaved ? (
              <span data-unsaved className="min-w-px truncate text-sm text-danger">
                {W.unsaved}
              </span>
            ) : (
              together &&
              (live?.muted || live?.full || live?.unsent) && (
                <span data-unsaved className="min-w-px truncate text-sm text-ink-3">
                  {live.muted ? W.outOfDate : live.full ? W.full : W.offline}
                </span>
              )
            )}
            <span className="ml-auto flex items-center gap-2">
              {copied && (
                <span className="text-sm text-ink-3" role="status">
                  {copied}
                </span>
              )}
              {/* Who sees it: Publish on a draft, then who it is shared
                with. */}
              {!file.url && !file.upload && file.audience && (
                <DocAccess
                  fileId={file.id}
                  projectId={projectId}
                  authorId={file.author_id}
                  meId={meId}
                  audience={file.audience}
                  readerIds={file.reader_ids ?? []}
                  looseFiles={file.loose_files ?? 0}
                  mayShare={Boolean(file.may_share)}
                  onChange={(audience, reader_ids) => {
                    setFile((f) => (f ? { ...f, audience, reader_ids, ...(audience === 'project' ? {} : { public_token: null }) } : f))
                    onChanged()
                  }}
                  onSaid={(said) => {
                    setCopied(said)
                    setTimeout(() => setCopied(null), 1800)
                  }}
                />
              )}
              <SubscribePill
                testId="follow-file"
                on={Boolean(file.subscribed)}
                path={`/files/${file.id}`}
                words={W}
                onChange={(on) => setFile((f) => (f ? { ...f, subscribed: on } : f))}
              />
              <Popover
                shape="bare"
                width={232}
                align="right"
                testId="file-menu"
                said={W.more}
                sheet={false}
                /* What Version history opens on, read while the menu is open. */
                onOpenChange={(open) => {
                  if (open && !file.url && !file.upload) nearVersions(file.id)
                }}
                label={<RoundFace icon="ellipsis" on={false} />}
              >
                {(close) => (
                  <div data-menu className="py-1">
                    <button
                      data-row
                      data-testid="copy-file-link"
                      onClick={() => {
                        close()
                        void navigator.clipboard
                          .writeText(location.href)
                          .then(() => setCopied(W.linkCopied))
                          .catch(() => setCopied(W.couldNotCopy))
                          .finally(() => setTimeout(() => setCopied(null), 1800))
                      }}
                      className="flex w-full items-center gap-3 px-3 text-left text-base text-ink"
                      style={{ height: 'var(--row-h)' }}
                    >
                      <Icon name="link" size={16} className="text-ink-2" />
                      {W.copyLink}
                    </button>
                    {/* On the web, for anybody with the link — a written
                      document only, for whoever may edit it; the server
                      decides, and says so if not. */}
                    {!file.url && !file.upload && canWrite && (
                      <>
                        {/* Only once the project has it: a draft or a
                          document of chosen people is not for anybody
                          with a link. */}
                        {(file.audience ?? 'project') === 'project' && (
                          <button
                            data-row
                            role="switch"
                            aria-checked={Boolean(file.public_token)}
                            data-testid="share-to-web"
                            disabled={sharing}
                            onClick={() => void share(!file.public_token)}
                            className="flex w-full items-center gap-3 px-3 text-left text-base text-ink"
                            style={{ height: 'var(--row-h)' }}
                          >
                            <Icon name="globe" size={16} style={{ color: file.public_token ? 'var(--accent)' : 'var(--ink-2)' }} />
                            <span className="min-w-px flex-1">{W.shareToWeb}</span>
                            <Switch on={Boolean(file.public_token)} />
                          </button>
                        )}
                        {/* A shape to start other documents from, kept here
                          and offered across the workspace. */}
                        <button
                          data-row
                          role="switch"
                          aria-checked={Boolean(file.template_at)}
                          data-testid="save-as-template"
                          onClick={() => void template(!file.template_at)}
                          className="flex w-full items-center gap-3 px-3 text-left text-base text-ink"
                          style={{ height: 'var(--row-h)' }}
                        >
                          <Icon name="copy" size={16} style={{ color: file.template_at ? 'var(--accent)' : 'var(--ink-2)' }} />
                          <span className="min-w-px flex-1">{TEMPLATE.saveAsTemplate}</span>
                          <Switch on={Boolean(file.template_at)} />
                        </button>
                        {file.public_token && (
                          <button
                            data-row
                            data-testid="copy-public-link"
                            onClick={() => {
                              close()
                              void copyPublic(file.public_token!)
                            }}
                            className="flex w-full items-center gap-3 px-3 text-left text-base text-ink"
                            style={{ height: 'var(--row-h)' }}
                          >
                            <Icon name="link" size={16} className="text-ink-2" />
                            {W.copyPublicLink}
                          </button>
                        )}
                      </>
                    )}
                    {/* What it said before, and a way to put it back.
                      Any reader looks;
                      Restore inside is for whoever may edit. */}
                    {!file.url && !file.upload && (
                      <button
                        data-row
                        data-testid="version-history-open"
                        onClick={() => {
                          close()
                          void readyVersions(file.id).then(() => setHistory(true))
                        }}
                        className="flex w-full items-center gap-3 px-3 text-left text-base text-ink"
                        style={{ height: 'var(--row-h)' }}
                      >
                        <Icon name="clock" size={16} className="text-ink-2" />
                        {VERSION_HISTORY.title}
                      </button>
                    )}
                    {/* A written document as a PDF, through the browser's own
                      printing — `docs/specs/export.md`. An upload already is
                      a file, and a link lives somewhere else. */}
                    {!file.url && !file.upload && (
                      <button
                        data-row
                        data-testid="export-pdf"
                        onClick={() => {
                          close()
                          printAsPdf({
                            title: file.name,
                            facts: [file.author_name, W.versionFact(saved ?? file.version)],
                            body: written.current?.querySelector('.ProseMirror') ?? written.current,
                          })
                        }}
                        className="flex w-full items-center gap-3 px-3 text-left text-base text-ink"
                        style={{ height: 'var(--row-h)' }}
                      >
                        <Icon name="download" size={16} className="text-ink-2" />
                        {W.exportPdf}
                      </button>
                    )}
                    {/* Last, and red: gone at once, with Undo on the list it
                      goes back to. */}
                    {onDelete && mayDelete?.(file.author_id) && (
                      <button
                        data-row
                        data-testid="delete-file"
                        onClick={() => {
                          close()
                          onDelete({ id: file.id, name: file.name })
                        }}
                        className="flex w-full items-center gap-3 px-3 text-left text-base text-danger"
                        style={{ height: 'var(--row-h)' }}
                      >
                        <Icon name="trash" size={16} />
                        {file.url ? DOCS.deleteLink : file.upload ? DOCS.deleteFile : DOCS.deleteDocument}
                      </button>
                    )}
                  </div>
                )}
              </Popover>
            </span>
          </div>
        </Toolbar>

        {history && (
          <VersionHistory
            fileId={file.id}
            canWrite={canWrite}
            onClose={() => setHistory(false)}
            onRestored={(version) => {
              setSaved(version)
              setCopied(VERSION_HISTORY.restored)
              setTimeout(() => setCopied(null), 1800)
              /* Written together, the room has brought the words already;
               alone, they are read again — the restore is the newer edit. */
              if (!together) {
                touched.current = false
                setAlone(false)
              }
              void load().catch(() => {})
              onChanged()
            }}
          />
        )}

        {/* Files held anywhere over it go into the body — `docs/specs/drop-files.md`. */}
        <div className="relative flex min-h-0 flex-1 flex-col" {...drop.handlers}>
          {drop.held && <DropHere bleed said={EDITOR.dropIntoDocument} />}
          <div data-foot className="reads min-h-0 flex-1 overflow-y-auto pt-4">
            <div ref={column} data-document className="relative max-w-[640px]">
              {/* The open threads' words tinted, the one whose card is open
                more. Ids are uuids. */}
              {openIds.length > 0 && (
                <style>
                  {openIds
                    .map(
                      (id) =>
                        `[data-testid="file-body"] [data-comment~="${id}"]{background:var(--comment-tint);box-shadow:inset 0 -2px 0 var(--comment-line);cursor:pointer}`,
                    )
                    .join('')}
                  {card?.kind === 'thread'
                    ? `[data-testid="file-body"] [data-comment~="${card.id}"]{background:var(--comment-tint-on)}`
                    : ''}
                </style>
              )}
              {card && (
                <WordsCard
                  card={card}
                  comments={comments}
                  meId={meId}
                  canWrite={canWrite}
                  canEditAny={canEditAny}
                  projectId={projectId}
                  post={`/files/${file.id}/comments`}
                  words={{ show: showThread, gone: lost }}
                  onChanged={load}
                  onClose={closeCard}
                  onMade={(id) => {
                    const ed = into.current?.editor?.()
                    /* The mark has come through the shared state by now; the
                     card stands where the waiting tint stood. */
                    const r = ed ? waitingRange(ed) : null
                    if (ed) wait(ed, null)
                    setCard((c) => (c ? { kind: 'thread', id, at: r && ed ? cardAt(ed.view.coordsAtPos(r.to)) : c.at } : c))
                  }}
                />
              )}
              {/* Its headings beside it, out of the column's flow. */}
              {!file.url && !file.upload && <Outline body={text} />}
              {/* What it wears, over its name — `docs/specs/docs.md`, "A
                document's mark". The mark is the way to its rails, as a
                project's is on its settings: pressed, they unfold under it,
                and each press is the change. */}
              {!file.url && !file.upload && (
                <DocLook
                  icon={file.mark_icon ?? null}
                  tint={file.mark_tint ?? null}
                  mayChange={canWrite && file.may_edit !== false}
                  onChange={(change) => {
                    const was = { mark_icon: file.mark_icon ?? null, mark_tint: file.mark_tint ?? null }
                    setFile((f) => (f ? { ...f, ...change } : f))
                    void api(`/files/${file.id}`, { method: 'PATCH', body: JSON.stringify(change) })
                      .then(onChanged)
                      .catch(() => setFile((f) => (f ? { ...f, ...was } : f)))
                  }}
                />
              )}
              {/* As many lines as the name takes, as a task's title does. */}
              <textarea
                ref={titleField}
                rows={1}
                data-testid="file-name"
                /* Down from the title, or Enter at the end of it, is into the
               body — the way every editor with a title over its text has it.
               Not while a word is still being composed: Enter there accepts
               the composition. */
                onKeyDown={(e) => {
                  if (e.nativeEvent.isComposing) return
                  if (e.key === 'Enter' || e.key === 'ArrowDown') {
                    e.preventDefault()
                    // Leaving the title saves it, as any blur does.
                    into.current?.enter()
                  }
                }}
                className="block w-full resize-none overflow-hidden bg-transparent text-xl leading-[1.3] font-medium outline-none text-ink"
                value={file.name}
                disabled={!canWrite}
                onChange={(e) => {
                  nameTyped.current = true
                  setFile({ ...file, name: e.target.value.replace(/\s*\n\s*/g, ' ') })
                }}
                // From the field, not from state, for the reason `save` explains.
                onBlur={(e) => {
                  /* Nothing typed, nothing written: what the field holds may
                     be a kept copy the server has moved on from. */
                  if (!nameTyped.current) return
                  const name = e.target.value.trim()
                  if (!name) return
                  nameTyped.current = false
                  keepName(name)
                  void api(`/files/${file.id}`, {
                    method: 'PATCH',
                    body: JSON.stringify({ name }),
                  })
                    .then(onChanged)
                    .catch(() => setUnsaved(true))
                }}
              />

              {file.url && (
                <LinkAddress
                  url={file.url}
                  canWrite={canWrite}
                  onSave={async (url) => {
                    const was = file.url
                    setFile({ ...file, url })
                    try {
                      await api(`/files/${file.id}`, { method: 'PATCH', body: JSON.stringify({ url }) })
                      await onChanged()
                      return true
                    } catch {
                      setFile((f) => (f ? { ...f, url: was } : f))
                      return false
                    }
                  }}
                />
              )}

              {/* In a frame of a fixed height from the first frame, the picture
              fitted inside it: the file does not say its size, and a screen
              that grows when the bytes land is the screen moving under the
              reader. Pressed, it opens full size. */}
              {media && (
                <div
                  data-file-shown={media}
                  className="mt-4 flex w-full items-center justify-center overflow-hidden bg-sunken"
                  style={{ height: 'min(560px, 64vh)', borderRadius: 'var(--r-row)' }}
                >
                  {links && media === 'image' && (
                    <img
                      src={links.display ?? links.url}
                      alt={file.name}
                      onClick={() => setBig(true)}
                      className="h-full w-full cursor-zoom-in object-contain"
                    />
                  )}
                  {links && media === 'video' && <video src={links.url} controls playsInline className="h-full w-full object-contain" />}
                </div>
              )}
              {big && links && <Lightbox url={links.url} quick={links.display} name={file.name} onClose={() => setBig(false)} />}

              {file.upload && (
                <button
                  data-testid="download"
                  onClick={async () => {
                    const r = await api<{ url: string }>(`/files/${file.id}/url`)
                    // With its name, so what the browser cannot show saves as itself.
                    window.open(`${r.url}&name=${encodeURIComponent(file.name)}`, '_blank', 'noopener')
                  }}
                  className="mt-2 text-base leading-shell underline"
                >
                  {MORE.openTheFile}
                </button>
              )}

              {!file.url && !file.upload && (
                <div
                  className="mt-2"
                  ref={written}
                  data-together={together || undefined}
                  onClick={(e) => {
                    /* Not while choosing words: the bar over them is the answer then. */
                    if (window.getSelection()?.isCollapsed === false) return
                    pressedWords(e.target)
                  }}
                >
                  {/* A thread's words inside a chip open its card, not the task. */}
                  <ThreadPress.Provider value={pressedWords}>
                    {/* The same size and ink a task's description has: the words
                  a person reads on the object's own screen. */}
                    {collab && live ? (
                      <Editor
                        key={`together-${live.generation}`}
                        testId="file-body"
                        handle={into}
                        onUp={() => {
                          const f = titleField.current
                          if (!f) return
                          f.focus()
                          f.setSelectionRange(f.value.length, f.value.length)
                        }}
                        size={15}
                        tone="color-mix(in oklch, var(--ink) 72%, var(--ink-2))"
                        value={null}
                        collab={collab}
                        projectId={projectId}
                        editable={canWrite && live.write}
                        placeholder={MAKE.writeItHere}
                        onChange={(next) => {
                          latest.current = next
                          /* The outline reads the body as it is written, together or not. */
                          setText(next)
                        }}
                        // Every edit is already on its way; leaving says write it now.
                        onSettle={() => session?.settle()}
                        room
                        {...(onWords ? { onWords } : {})}
                      />
                    ) : (
                      <Editor
                        key="alone"
                        testId="file-body"
                        handle={into}
                        onUp={() => {
                          // Back to the title, the caret at the end of what it says.
                          const f = titleField.current
                          if (!f) return
                          f.focus()
                          f.setSelectionRange(f.value.length, f.value.length)
                        }}
                        size={15}
                        tone="color-mix(in oklch, var(--ink) 72%, var(--ink-2))"
                        value={text}
                        projectId={projectId}
                        editable={canWrite}
                        placeholder={MAKE.writeItHere}
                        onChange={(next) => {
                          touched.current = true
                          setAlone(true)
                          setText(next)
                        }}
                        // Saved on leaving the body rather than on every keystroke: a
                        // version per character is a history nobody can read.
                        onSettle={(next) => void save(next)}
                        room
                      />
                    )}
                  </ThreadPress.Provider>
                </div>
              )}

              {/* The task's rhythm under the words: twenty-four between blocks,
              each with the task's heading — `docs/specs/comments.md`. */}
              <div className="mt-6 flex flex-col gap-6">
                <MentionedIn type="file" id={file.id} />
                <Discussion
                  title={HEADS.comments}
                  comments={comments}
                  meId={meId}
                  canWrite={canWrite}
                  canEditAny={canEditAny}
                  projectId={projectId}
                  post={`/files/${file.id}/comments`}
                  onChanged={load}
                  words={{ show: showThread, gone: lost }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </UploadInto.Provider>
  )
}

/** The switch drawn at the end of a menu row that turns something on. */
function Switch({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className="relative h-6 w-10 shrink-0 rounded-full transition-colors"
      style={{ background: on ? 'var(--accent)' : 'color-mix(in oklch, var(--ink) 18%, transparent)' }}
    >
      <span
        className="absolute top-1 left-1 size-4 rounded-full transition-transform"
        style={{
          background: '#fff',
          boxShadow: '0 1px 2px rgb(0 0 0 / 0.2)',
          transform: on ? 'translateX(16px)' : 'none',
        }}
      />
    </span>
  )
}

/**
 * A link's address, and for whoever may edit it a way to change it —
 * `docs/specs/docs.md`, "A link's address". Pressed, the line becomes a
 * field in its place: Enter keeps it, Escape puts it back. http and https
 * only, as the server takes.
 */
function LinkAddress({ url, canWrite, onSave }: { url: string; canWrite: boolean; onSave: (url: string) => Promise<boolean> }) {
  const [typing, setTyping] = useState<string | null>(null)
  const [said, setSaid] = useState<string | null>(null)
  async function keep() {
    if (typing === null) return
    const next = typing.trim()
    if (next === url) return setTyping(null)
    if (!/^https?:\/\/\S+$/i.test(next)) return setSaid(W.linkNeedsHttp)
    setTyping(null)
    setSaid((await onSave(next)) ? null : W.couldntChangeLink)
  }
  return (
    <div className="mt-2 flex flex-col gap-1">
      {typing === null ? (
        <div className="flex items-baseline gap-3">
          <a
            data-testid="link-address"
            href={url}
            target="_blank"
            rel="noreferrer noopener"
            className="min-w-px break-all text-base leading-shell underline"
          >
            {url}
          </a>
          {canWrite && (
            <button
              type="button"
              data-testid="change-link"
              onClick={() => {
                setSaid(null)
                setTyping(url)
              }}
              className="shrink-0 text-sm text-ink-3 mouse:hover:text-[var(--ink)]"
            >
              {W.changeLink}
            </button>
          )}
        </div>
      ) : (
        <input
          {...urlField}
          data-testid="link-address-field"
          aria-label={W.linkAddress}
          type="url"
          autoFocus
          value={typing}
          onChange={(e) => {
            setSaid(null)
            setTyping(e.target.value)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void keep()
            if (e.key === 'Escape') {
              e.stopPropagation()
              setSaid(null)
              setTyping(null)
            }
          }}
          onBlur={() => void keep()}
          className="block w-full rounded-[var(--r-field)] bg-[var(--sunken)] px-2 text-base leading-shell text-ink outline-none"
        />
      )}
      {said && (
        <p role="alert" className="text-sm text-danger">
          {said}
        </p>
      )}
    </div>
  )
}

/**
 * A document's mark over its name, and the rails it is chosen on — the
 * project's own picker (`MarkRails`), not a second one. On the screen at
 * once; put back if the server says no.
 */
function DocLook({
  icon,
  tint,
  mayChange,
  onChange,
}: {
  icon: string | null
  tint: number | null
  mayChange: boolean
  onChange: (change: { mark_icon?: string | null; mark_tint?: number | null }) => void
}) {
  const [open, setOpen] = useState(false)
  if (!mayChange) {
    return (
      <div className="mb-3">
        <DocMark icon={icon} tint={tint} size={40} />
      </div>
    )
  }
  return (
    <div className="mb-3 flex flex-col items-start gap-3">
      <button
        type="button"
        data-testid="doc-mark-toggle"
        aria-expanded={open}
        aria-label={W.changeLook}
        title={W.changeLook}
        onClick={() => setOpen((v) => !v)}
        className="flex shrink-0 rounded-[var(--r-row)] transition-transform duration-150 ease-out active:scale-[0.96]"
        style={{ boxShadow: open ? '0 0 0 2px var(--accent)' : undefined }}
      >
        <DocMark icon={icon} tint={tint} size={40} />
      </button>
      {open && (
        <div data-testid="doc-mark-rails">
          <MarkRails
            icon={icon}
            tint={tint}
            ownIcon="doc"
            ownTintIcon={(icon ?? 'doc') as IconName}
            ownTint="var(--accent)"
            onIcon={(mark_icon) => onChange({ mark_icon })}
            onTint={(mark_tint) => onChange({ mark_tint })}
            iconSaid={W.itsIcon}
            tintSaid={W.itsColour}
            ownSaid={W.ownLook}
            iconAttrs={{ 'data-doc-icons': icon ?? 'own' }}
            tintAttrs={{ 'data-doc-tints': String(tint ?? 'own') }}
          />
        </div>
      )}
    </div>
  )
}
