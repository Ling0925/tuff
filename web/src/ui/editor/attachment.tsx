import { useState, useEffect, useRef, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import { Node, mergeAttributes, ReactNodeViewRenderer, type NodeViewProps, NodeViewWrapper } from '@tiptap/react'
import { Icon } from '../glyphs.jsx'
import { glanceable, Glance, Lightbox, PrivatePicture } from '../Doc.jsx'
import { isGone } from '../../data/api.js'
import { knownLinks, type Links, fileLinks, sizeOf } from '../../data/files.js'
import * as sending from '../../data/sending.js'
import { fileLine } from '../../data/bytes.js'
import { EDITOR as W } from '../../words/editor.js'

/**
 * A body somebody can write in.
 *
 * The four entities have kept their prose as a document since the first
 * migration, and nothing used it: every screen wrote one paragraph of plain
 * text and read it back with `plain()` — a textarea pretending to be a
 * document. This is the editor that makes the shape true.
 *
 * TipTap has been in `web/package.json` from the start, unused, which is why
 * the stored shape is ProseMirror's. No new dependency —
 * `docs/specs/rich-text.md`.
 */

/**
 * A picture or a file, held by id rather than by URL.
 *
 * `@tiptap/extension-image` stores a `src`, and ours cannot: a blob link is
 * signed over the key and an expiry, so a URL written into a body would be a
 * 403 within minutes and a broken picture for ever after. The id does not
 * expire. `Doc` resolves it when it draws.
 */
export const Attachment = Node.create({
  name: 'attachment',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes: () => ({
    fileId: { default: null },
    name: { default: 'File' },
    kind: { default: 'file' },
    /* The width somebody dragged a picture to, in pixels; none is as wide
       as it is, up to the column. */
    width: { default: null },
    /* The picture's own pixels, for the room it is given before it loads. */
    pixelWidth: { default: null },
    pixelHeight: { default: null },
    /* Its size in bytes, said under a file's name. */
    size: { default: null },
    /* A blurred twenty-four-pixel glance at it, shown in its room until it
       arrives — `measure` in `data/upload.ts`. */
    blur: { default: null },
    /* Which send this is while it has no file yet — `data/sending.ts`.
       Never saved: `settled` takes nodes still on their way out of what
       leaves the editor. */
    uploadId: { default: null, rendered: false },
    /* Where on GitHub a picture came from, when it came in with an issue:
       kept through an edit, so it goes back as that address rather than as
       a file GitHub cannot open. Not drawn. */
    source: { default: null, rendered: false },
  }),
  parseHTML: () => [{ tag: 'div[data-attachment]' }],
  renderHTML: ({ HTMLAttributes }: { HTMLAttributes: Record<string, unknown> }) => [
    'div',
    mergeAttributes(HTMLAttributes, { 'data-attachment': '' }),
  ],
  addNodeView() {
    return ReactNodeViewRenderer(AttachmentView, {
      /* The controls on a selected attachment are the node view's own: a
         press on them is not a press ProseMirror should turn into a drag or
         a selection. */
      stopEvent: ({ event }) => !!(event.target as HTMLElement | null)?.closest?.('[data-node-control]'),
    })
  },
})

/**
 * A picture, a video or a file inside a body, and what can be done to it.
 *
 * It could not be got hold of. A press on a picture selected it — ProseMirror
 * does that for any atom — and nothing said so, so the only way to remove
 * one was to put the caret after it and press Backspace twice without
 * seeing what the first press had done. Selected, it carries the ring a
 * taken card carries on the board and its controls in the corner; Backspace
 * and Delete take it out as they take out a selected word.
 *
 * A picture can be made smaller by its handle, opened large, and saved —
 * the three things somebody does with a screenshot in a description.
 *
 * A video is a video here too, not a chip with its name: it is what the
 * body shows when read, and an editor that draws it as something else is
 * an editor where you cannot tell which of two clips you are deleting.
 */
/** The tallest a picture or a video stands in a body: a screenshot of a
    long page is a picture of a scroll, and drawn whole it pushed the
    sentence after it off the screen. Opened, it is its whole size. */
const TALLEST = 600

/** The narrowest a picture is dragged to: its three controls and their
    insets, so they stay on it rather than moving off beside it. */
const SMALLEST = 136

/** The frame a video stands in before its own shape is known. */
const GUESS_WIDE = 640

/** A video's frame, read from the file in hand before it is sent. */

function AttachmentView({ node, selected: picked, getPos, editor }: NodeViewProps) {
  /*
   * Selected while somebody is in the body, and not otherwise.
   *
   * A document's selection starts at its beginning, and when the first
   * thing in it is a picture that beginning is the picture — so opening a
   * task with a screenshot at the top showed it ringed, with its controls
   * out, before anybody had touched anything. The selection is ProseMirror's
   * business; whether it is drawn is whether the body has the caret.
   */
  const [inside, setInside] = useState(() => editor.isFocused)
  useEffect(() => {
    const on = () => setInside(true)
    const off = () => setInside(false)
    editor.on('focus', on)
    editor.on('blur', off)
    return () => {
      editor.off('focus', on)
      editor.off('blur', off)
    }
  }, [editor])
  const selected = picked && inside
  const fileId = typeof node.attrs.fileId === 'string' ? node.attrs.fileId : null
  const id = fileId ?? ''
  const uploadId = typeof node.attrs.uploadId === 'string' ? node.attrs.uploadId : null
  const sent = sending.useSending(uploadId)
  /* The picture the browser already holds, while it is sent and after. */
  const preview = sent?.preview ?? sending.previewOf(fileId)
  const born = useRef(performance.now())
  const [fading, setFading] = useState(false)
  const [settled, setSettled] = useState(false)
  const name = String(node.attrs.name)
  const kind = String(node.attrs.kind)
  const kept = typeof node.attrs.width === 'number' ? node.attrs.width : null
  const [links, setLinks] = useState<Links | null>(() => (fileId ? knownLinks(fileId) : null))
  const [unseen, setUnseen] = useState(false)
  /* The original, opened full size and saved; the copy for showing, drawn
     here when the picture has one. */
  const url = links?.url ?? null
  const shown = preview ?? links?.display ?? url
  /* Already in the browser — read ahead from the list, or seen before: drawn
     as it is from the first frame, with no glance under it even for one. */
  // biome-ignore lint/correctness/useExhaustiveDependencies: a picture already in the cache is looked for again when it is shown
  useLayoutEffect(() => {
    const img = box.current?.querySelector('img')
    if (img?.complete && img.naturalWidth > 0) {
      setLoaded(true)
      setSettled(true)
    }
  }, [shown])
  const [open, setOpen] = useState(false)
  /* The width while the handle is held — drawn from here, and written into
     the document once, when it is let go, so a drag is one step of undo. */
  const [held, setHeld] = useState<number | null>(null)
  const box = useRef<HTMLSpanElement | null>(null)
  const width = held ?? kept
  const writable = editor.isEditable
  /* A picture put in before its size was recorded learns it when it loads,
     here and not in the document — reading a task is not an edit — so it
     is held to its shape like any other, and the handle stops where the
     picture does. It goes into the document with the first real change. */
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)
  const pw = typeof node.attrs.pixelWidth === 'number' ? node.attrs.pixelWidth : (natural?.w ?? null)
  const ph = typeof node.attrs.pixelHeight === 'number' ? node.attrs.pixelHeight : (natural?.h ?? null)
  const ratio = pw && ph ? `${pw} / ${ph}` : undefined
  /* No wider than would make it taller than `TALLEST`, when its shape is
     known; held by height instead when it is not. */
  const widest = pw && ph ? (TALLEST * pw) / ph : null
  /* Drawn when it has arrived, all at once, over the ground kept for it —
     not painted in strips as it decodes, and not faded in either: a fade
     on every picture of every open is motion somebody sees a hundred times
     a day, and it read as the picture being late. */
  const [loaded, setLoaded] = useState(false)
  /* Three controls are 92 pixels; on a picture narrower than that they
     would hang off its left edge into the margin the body clips, so they
     stand beside it instead, the way a file's do. */
  const [narrow, setNarrow] = useState(false)
  useLayoutEffect(() => {
    setNarrow(kind === 'file' || (box.current?.offsetWidth ?? 0) < SMALLEST)
  })

  useEffect(() => {
    if (!fileId) return
    let alive = true
    void fileLinks(fileId)
      .then((l) => alive && setLinks(l))
      /* Not the reader's to open — put into a document they cannot see:
         said so, in its own room. */
      .catch((e: unknown) => alive && isGone(e) && setUnseen(true))
    return () => {
      alive = false
    }
  }, [fileId])

  /*
   * A change to this node, written now rather than when the body is left.
   *
   * The body saves on blur, and a picture made narrower or taken out keeps
   * the caret in the editor — so the change sat unsaved, and a reload threw
   * it away. These are deliberate, single acts, not keystrokes, so each one
   * saves as it is made. `null` takes the node out.
   */
  const change = (attrs: Record<string, unknown> | null) => {
    const at = typeof getPos === 'function' ? getPos() : undefined
    if (at === undefined) return
    const tr = attrs
      ? editor.state.tr.setNodeMarkup(at, undefined, { ...node.attrs, ...attrs })
      : editor.state.tr.delete(at, at + node.nodeSize)
    editor.view.dispatch(tr.setMeta('settle', true))
  }

  const resize = (e: React.PointerEvent<HTMLSpanElement>) => {
    e.preventDefault()
    e.stopPropagation()
    const el = box.current
    if (!el) return
    const start = el.getBoundingClientRect().width
    const column = el.parentElement?.getBoundingClientRect().width ?? start
    const room = widest ? Math.min(column, widest) : column
    const x0 = e.clientX
    const grip = e.currentTarget
    grip.setPointerCapture(e.pointerId)
    let now = start
    const move = (m: PointerEvent) => {
      /* No narrower than its three controls need to stand on it — 136,
         the width below which they would have to move off to its side —
         unless the picture itself may not be that wide. */
      now = Math.max(Math.min(SMALLEST, room), Math.min(room, start + (m.clientX - x0)))
      setHeld(now)
    }
    const up = () => {
      grip.removeEventListener('pointermove', move)
      grip.removeEventListener('pointerup', up)
      grip.removeEventListener('pointercancel', up)
      setHeld(null)
      const w = Math.round(now / 4) * 4
      // Dragged out to as wide as it may be is the picture's own size again.
      change({ width: w >= room - 4 ? null : w, pixelWidth: pw, pixelHeight: ph })
    }
    grip.addEventListener('pointermove', move)
    grip.addEventListener('pointerup', up)
    grip.addEventListener('pointercancel', up)
  }

  /* A control on the picture: pressed without taking the selection off the
     thing it is about. */
  const control = `flex size-7 items-center justify-center transition-colors ${
    narrow ? 'mouse:hover:bg-[var(--hover)]' : 'bg-[rgb(0_0_0/0.55)] mouse:hover:bg-[rgb(0_0_0/0.8)]'
  }`
  /* The ground is a class, not inline, so the pointer can deepen it. */
  const onPicture = { color: '#fff', borderRadius: 'var(--r-row)' }
  const beside = { color: 'var(--ink-2)', borderRadius: 'var(--r-row)' }
  const keep = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }
  const save = url && fileId ? `${url}&download=1&name=${encodeURIComponent(name)}` : undefined
  const media = kind === 'image' || kind === 'video'

  if (unseen && kind === 'image' && !preview)
    return (
      <NodeViewWrapper className="py-1" data-attachment={id}>
        <PrivatePicture width={width ?? pw ?? null} pixels={pw && ph ? { w: pw, h: ph } : null} />
      </NodeViewWrapper>
    )

  return (
    /* On the left edge, where the words start. They stood in the middle
       for a day, as a figure does in print, and in a column of text that is
       otherwise flush left the eye had to find them. */
    <NodeViewWrapper className="py-1" data-attachment={id} data-sending={uploadId ? '' : undefined}>
      <span
        ref={box}
        data-attachment-box
        data-selected={selected || undefined}
        className={`group/pic relative max-w-full align-top ${kind === 'file' ? 'flex w-full' : 'inline-block'}`}
        style={{
          borderRadius: kind === 'file' ? 'var(--r-card)' : 'var(--r-row)',
          /* Inside the edge, as on the board: the body scrolls in a box that
             clips at the words, and a picture as wide as the column would
             lose the ring down both sides. */
          /* As wide as it was dragged to, or as wide as it is — known before
             it loads — and never wider than the column. */
          width: kind === 'image' ? (width ?? pw ?? undefined) : kind === 'video' ? (pw ?? GUESS_WIDE) : undefined,
          maxWidth: widest && kind !== 'file' ? `min(100%, ${widest}px)` : '100%',
          background: kind === 'image' && !loaded ? 'var(--sunken)' : undefined,
        }}
      >
        {kind === 'image' && !settled && !preview && glanceable(node.attrs.blur) && <Glance src={node.attrs.blur} />}
        {kind === 'image' ? (
          <img
            alt={name}
            src={shown ?? undefined}
            /* The browser's own drag would carry the picture's address out
               as a link; the node is what moves. */
            draggable={false}
            /* Read, a press opens it; written in, a press selects it and a
               second one opens it. */
            onClick={() => url && !writable && setOpen(true)}
            onDoubleClick={() => url && setOpen(true)}
            decoding="async"
            /* Its place is held by its size, so a picture far down a long
               document is fetched as it comes near, not with the rest. */
            loading="lazy"
            onLoad={(e) => {
              /* Up over its glance when it took a moment, at once when it
                 did not — the rule the message's picture follows. */
              if (performance.now() - born.current > 120) setFading(true)
              setTimeout(() => setSettled(true), 260)
              setLoaded(true)
              const img = e.currentTarget
              if (img.naturalWidth && img.naturalHeight) setNatural({ w: img.naturalWidth, h: img.naturalHeight })
            }}
            className={`block max-w-full rounded-[var(--r-row)] ${ratio ? 'w-full' : 'w-auto'}`}
            style={{
              aspectRatio: ratio,
              maxHeight: ratio ? undefined : TALLEST,
              minHeight: loaded || ratio ? undefined : 120,
              minWidth: loaded || ratio ? undefined : 160,
              opacity: loaded ? 1 : 0,
              transition: fading ? 'opacity 200ms ease-out' : undefined,
              position: 'relative',
              cursor: url && !writable ? 'zoom-in' : undefined,
            }}
          />
        ) : kind === 'video' ? (
          /* Its shape kept from the start, as a picture's is: recorded when
             it was put in, learned from its first bytes when it was put in
             before that, and a wide frame until then — it used to open as
             a small grey box and grow when the metadata arrived. */
          <video
            src={shown ?? undefined}
            poster={glanceable(node.attrs.blur) ? node.attrs.blur : undefined}
            controls={!uploadId}
            playsInline
            preload="metadata"
            onLoadedMetadata={(e) => {
              const v = e.currentTarget
              if (v.videoWidth && v.videoHeight) setNatural({ w: v.videoWidth, h: v.videoHeight })
            }}
            className="block w-full max-w-full rounded-[var(--r-row)] bg-sunken"
            style={{ aspectRatio: ratio ?? '16 / 9' }}
          />
        ) : (
          /*
           * A file is a card across the column: what it is, how big, and the
           * way to save it, always there.
           *
           * It was a grey chip the width of its name, which read as a word
           * in the sentence rather than a thing attached to the task, and
           * its save was hidden until the chip was selected. A file is the
           * thing somebody came to the task to fetch; the save is the point.
           */
          <span
            data-file-card
            className="flex w-full items-center gap-3 py-3 pr-2 pl-4 bg-sunken"
            style={{
              borderRadius: 'var(--r-card)',
              boxShadow: 'inset 0 0 0 1px var(--line)',
            }}
          >
            <Icon name="doc" size={20} className="text-ink-3" />
            <span className="flex min-w-px flex-1 flex-col">
              <span className="truncate text-md text-ink">{name}</span>
              <span className="text-sm tabular-nums text-ink-3">
                {sent ? W.uploading(Math.round(sent.progress * 100)) : fileLine(name, node.attrs.size ?? sizeOf(fileId))}
              </span>
            </span>
            {save && (
              <a
                data-node-control
                data-testid="save-attachment"
                href={save}
                download={name}
                aria-label={W.downloadName(name)}
                title={W.download}
                onMouseDown={keep}
                className="flex size-8 shrink-0 items-center justify-center rounded-[var(--r-row)] transition-colors mouse:hover:bg-[var(--hover)] text-ink-2"
              >
                <Icon name="download" size={16} />
              </a>
            )}
            {selected && writable && (
              <button
                type="button"
                data-node-control
                data-testid="remove-attachment"
                aria-label={W.removeName(name)}
                title={W.remove}
                onMouseDown={(e) => {
                  keep(e)
                  if (uploadId) sending.cancel(uploadId)
                  change(null)
                  editor.commands.focus()
                }}
                className="flex size-8 shrink-0 items-center justify-center rounded-[var(--r-row)] transition-colors mouse:hover:bg-[var(--hover)] text-ink-2"
              >
                <Icon name="trash" size={16} />
              </button>
            )}
          </span>
        )}

        {/* The ring, over what is held. It was the box's outline, inside its
            edge so the body's clip would not cut it, and a picture or a
            video — drawn above their box — covered it but for the corners:
            a file said it was held and a picture did not. */}
        {selected && (
          <span
            aria-hidden
            data-ring
            className="pointer-events-none absolute inset-0"
            style={{ borderRadius: 'inherit', boxShadow: 'inset 0 0 0 2px var(--accent)' }}
          />
        )}

        {/* On its way: the picture is already there, quieted, with how far
            the send has got along its foot. A bar rather than a ring in the
            middle — the ring sits on the one thing somebody is looking at. */}
        {sent && media && (
          <span className="pointer-events-none absolute inset-0 rounded-[var(--r-row)]" style={{ background: 'rgb(0 0 0 / 0.24)' }}>
            <span
              className="absolute inset-x-4 bottom-4 h-1 overflow-hidden rounded-full"
              style={{ background: 'rgb(255 255 255 / 0.32)' }}
            >
              <span
                className="block h-full rounded-full transition-[width] duration-200 ease-out"
                style={{ width: `${Math.max(4, Math.round(sent.progress * 100))}%`, background: '#fff' }}
              />
            </span>
          </span>
        )}

        {/* Under the pointer as well as when selected: a picture's controls
            were found only by pressing it first, which nobody guesses. */}
        {writable && kind !== 'file' && (
          <span
            className={`absolute flex items-center gap-1 transition-opacity duration-100 ${
              selected
                ? 'opacity-100'
                : 'pointer-events-none opacity-0 mouse:on-pic-hover:pointer-events-auto mouse:on-pic-hover:opacity-100'
            } ${kind === 'file' ? 'top-1/2 left-full ml-1 -translate-y-1/2' : narrow ? 'top-0 left-full ml-2' : 'top-2 right-2'}`}
          >
            {kind === 'image' && shown && (
              <button
                type="button"
                data-node-control
                data-testid="open-attachment"
                aria-label={W.openName(name)}
                title={W.open}
                onMouseDown={keep}
                onClick={() => setOpen(true)}
                className={control}
                style={narrow ? beside : onPicture}
              >
                <Icon name="grow" size={16} />
              </button>
            )}
            {save && (
              <a
                data-node-control
                data-testid="save-attachment"
                href={save}
                download={name}
                aria-label={W.downloadName(name)}
                title={W.download}
                onMouseDown={keep}
                className={control}
                style={narrow ? beside : onPicture}
              >
                <Icon name="download" size={16} />
              </a>
            )}
            <button
              type="button"
              data-node-control
              data-testid="remove-attachment"
              aria-label={W.removeName(name)}
              title={W.remove}
              onMouseDown={(e) => {
                keep(e)
                if (uploadId) sending.cancel(uploadId)
                change(null)
                editor.commands.focus()
              }}
              className={control}
              style={narrow ? beside : onPicture}
            >
              <Icon name="trash" size={16} />
            </button>
          </span>
        )}

        {/* The handle: on the right edge, halfway down, where a person
            reaches to make a picture narrower. Only on a selected picture —
            a grip on every image in a body is chrome on content. */}
        {selected && writable && kind === 'image' && !uploadId && (
          <span
            data-node-control
            data-testid="resize-attachment"
            onPointerDown={resize}
            className="absolute top-1/2 right-0 flex h-12 w-4 -translate-y-1/2 cursor-ew-resize items-center justify-center"
          >
            <span
              className="h-8 w-1 rounded-full"
              style={{ background: '#fff', boxShadow: '0 0 0 1px rgb(0 0 0 / 0.3), 0 1px 4px rgb(0 0 0 / 0.3)' }}
            />
          </span>
        )}
      </span>
      {open &&
        shown &&
        createPortal(
          <Lightbox
            url={url ?? shown}
            quick={shown}
            name={name}
            from={box.current?.querySelector('img') ?? null}
            pixels={pw && ph ? { w: pw, h: ph } : null}
            onClose={() => setOpen(false)}
          />,
          document.body,
        )}
    </NodeViewWrapper>
  )
}
