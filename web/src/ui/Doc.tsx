import { Component, createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { isPersonId, PersonDoorsContext, personOf } from './PersonCard.jsx'
import { onReach, Unreachable, isGone } from '../data/api.js'
import { Icon } from './glyphs.jsx'
import { BAR, MORE } from '../data/words.js'
import { ReadCode } from './code.jsx'
import { fileLine } from '../data/bytes.js'
import { fileLinks, knownLinks, sizeOf, type Links } from '../data/files.js'
import { previewOf } from '../data/sending.js'
import { DocName, TaskName } from './TaskCard.jsx'
import { isKlipy } from '../data/gifs.js'
import { LinkCard } from './LinkCard.jsx'
import { DOC as W } from '../words/doc.js'
import { addresses } from '@tracker/shared-schema'
import { followHere } from '../data/route.js'
import { emojiOf, toneOf } from '../data/callout.js'

/**
 * A body, drawn and not edited.
 *
 * A plain walk over the document rather than a second editor in read-only
 * mode, because this one has to be cheap: a channel draws bodies by the
 * hundred and the design measures that screen against a million messages. An
 * editor instance per message is a ProseMirror view per message; this is a
 * function. `docs/specs/rich-text.md`.
 */

type Node = {
  type?: string
  text?: string
  attrs?: Record<string, unknown>
  marks?: { type: string; attrs?: Record<string, unknown> }[]
  content?: Node[]
}

/**
 * A body as it came from the server, made safe to draw.
 *
 * A body is whatever JSON was written through the API, and the renderer
 * took it on trust: a node typed `constructor` found a function in the tag
 * map, a `text` that was an object was handed to React, a `content` that was
 * a string had `.map` called on it — any of them unmounted the whole app for
 * everybody who opened the room. Every field is coerced to its shape here,
 * once, before anything reads it; a link keeps only a web or mail address,
 * and a picture's glance only an inline image.
 */
const LINKABLE = /^(https?:|mailto:)/i

/*
 * A picture's glance is an inline image and nothing after it — the whole
 * string, not its start. Checked by its start, `data:image/png;base64,x),
 * url(https://elsewhere/p` passed and went into a CSS `url()` as two
 * images, the second fetched by every reader from wherever a body said.
 */
const GLANCE = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/
export function glanceable(v: unknown): v is string {
  return typeof v === 'string' && v.length < 20_000 && GLANCE.test(v)
}
function clean(raw: unknown, depth = 0): Node {
  if (!raw || typeof raw !== 'object' || depth > 40) return { type: 'paragraph', content: [] }
  const n = raw as Record<string, unknown>
  const type = typeof n.type === 'string' ? n.type : 'paragraph'
  const attrs = n.attrs && typeof n.attrs === 'object' && !Array.isArray(n.attrs) ? { ...(n.attrs as Record<string, unknown>) } : undefined
  if (attrs && 'blur' in attrs && !glanceable(attrs.blur)) delete attrs.blur
  const marks = Array.isArray(n.marks)
    ? (n.marks as unknown[])
        .filter((m): m is { type: string; attrs?: Record<string, unknown> } => !!m && typeof (m as { type?: unknown }).type === 'string')
        .filter((m) => m.type !== 'link' || LINKABLE.test(String(m.attrs?.href ?? '')))
    : undefined
  return {
    type,
    ...(typeof n.text === 'string' ? { text: n.text } : type === 'text' ? { text: '' } : {}),
    ...(attrs ? { attrs } : {}),
    ...(marks ? { marks } : {}),
    content: Array.isArray(n.content) ? (n.content as unknown[]).map((c) => clean(c, depth + 1)) : [],
  }
}

/** Everything the editor can produce, and nothing it cannot. */
const BLOCK: Record<string, string> = {
  paragraph: 'p',
  bulletList: 'ul',
  orderedList: 'ol',
  listItem: 'li',
  blockquote: 'blockquote',
  codeBlock: 'pre',
}

/*
 * An address typed as words is a link, wherever it is read.
 *
 * A comment, a message and an announcement made from a line of text carried
 * a pasted address as plain words, and it could not be pressed. Found when
 * drawn rather than when written, so everything already written is mended
 * too; text already inside a link or code is left as it is. Where an
 * address starts and stops is the one rule the server and the editor read
 * too — `addresses` in the shared schema.
 */
function linked(text: string): React.ReactNode {
  const parts: React.ReactNode[] = []
  let at = 0
  for (const a of addresses(text)) {
    if (a.index > at) parts.push(text.slice(at, a.index))
    parts.push(
      <a
        key={a.index}
        href={a.href}
        target="_blank"
        rel="noreferrer noopener"
        data-autolink
        className="[overflow-wrap:anywhere] text-accent"
      >
        {a.text}
      </a>,
    )
    at = a.index + a.text.length
  }
  if (parts.length === 0) return text
  if (at < text.length) parts.push(text.slice(at))
  return parts
}

/*
 * Where each link really goes, drawn beside it — for a body whose words are
 * a stranger's: a room's incoming webhook.
 * Drawn here, not written into the words, so nothing a payload types can
 * pass for it: a tile no mark can make, with the host as the browser reads
 * it — an address in another script comes out as its `xn--` form.
 */
export const LinkHostsContext = createContext(false)
function LinkHost({ href }: { href: string }) {
  const on = useContext(LinkHostsContext)
  if (!on || !/^https?:/i.test(href)) return null
  let host = ''
  try {
    host = new URL(href).hostname
  } catch {
    return null
  }
  return (
    <span
      data-link-host
      contentEditable={false}
      className="ml-1 inline-flex h-4 items-center rounded px-1 align-middle text-badge font-medium select-none bg-track text-ink-3"
    >
      {host}
    </span>
  )
}

function marked(node: Node, key: string) {
  const plainly = !(node.marks ?? []).some((m) => m.type === 'link' || m.type === 'code')
  let out: React.ReactNode = plainly ? linked(node.text ?? '') : (node.text ?? '')
  for (const m of node.marks ?? []) {
    if (m.type === 'bold') out = <strong>{out}</strong>
    else if (m.type === 'italic') out = <em>{out}</em>
    else if (m.type === 'strike') out = <s>{out}</s>
    else if (m.type === 'underline') out = <u>{out}</u>
    else if (m.type === 'code') {
      out = <code className="rounded-[var(--r-tile)] px-1 py-1 text-sm bg-sunken">{out}</code>
    } else if (m.type === 'link') {
      const href = String(m.attrs?.href ?? '')
      out = (
        <a
          href={href}
          target="_blank"
          rel="noreferrer noopener"
          className="[overflow-wrap:anywhere] text-accent"
          /* A link to this product opens here — a quote's way back to what
             it quotes (`docs/specs/chat-composer.md`). A key held keeps the
             browser's own meaning. */
          onClick={(e) => {
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
            if (followHere(href)) e.preventDefault()
          }}
        >
          {out}
        </a>
      )
      out = (
        <>
          {out}
          <LinkHost href={href} />
        </>
      )
    }
  }
  return <span key={key}>{out}</span>
}

/**
 * A file, drawn from the id the body holds rather than from a URL.
 *
 * A blob link here is signed over the key and an expiry, so a URL written
 * into a task body would be a 403 within minutes and a broken picture for
 * ever after. The id does not expire; the link is asked for when the node is
 * drawn, and the browser keeps the bytes it loaded.
 */
/**
 * A picture, as large as the window allows, until it is let go of.
 *
 * Every picture in the product opens this — a message's, a comment's, a
 * task's body, a document — because "a picture can be opened" is not a rule
 * that should depend on which screen it is on.
 *
 * The gesture is what every tool a person already uses does: Escape or the
 * backdrop closes it, a button in the corner saves it. No arrows between
 * pictures, because stepping through needs a set and a picture here is
 * drawn by itself.
 */
/* The curve sheets use: fast out of the hand, settling softly — and the
   same both ways, so it goes back the way it came. */
const OPENING = 'cubic-bezier(0.32, 0.72, 0, 1)'
const OPEN_MS = 320
const SHUT_MS = 240

export function Lightbox({
  url,
  name,
  onClose,
  from,
  quick,
  kind = 'image',
  onPrev,
  onNext,
  counter,
}: {
  url: string
  name: string
  onClose: () => void
  /** The picture it was opened from: it grows out of there and goes back. */
  from?: HTMLImageElement | null
  /** What is already on the screen — the copy for showing — drawn at once
      while the original arrives over it. */
  quick?: string | null
  /** A video in a row of media plays here rather than showing a frame. */
  kind?: 'image' | 'video'
  /** Paging through the media of one message. */
  onPrev?: (() => void) | undefined
  onNext?: (() => void) | undefined
  /** "2 / 5", said in the corner while paging. */
  counter?: string | undefined
}) {
  const pic = useRef<HTMLImageElement>(null)
  const back = useRef<HTMLDivElement>(null)
  /* Opens on what was already drawn, and becomes the original when its
     bytes are in — no blank frame while a full-size file comes down. */
  const [src, setSrc] = useState(quick ?? url)
  useEffect(() => {
    setSrc(quick ?? url)
    if (!quick || quick === url) return
    const full = new Image()
    full.decoding = 'async'
    full.onload = () => setSrc(url)
    full.src = url
    return () => {
      full.onload = null
    }
  }, [quick, url])
  const shutting = useRef(false)
  /* Where it was on the page when pressed, and its own shape — read once,
     at the press, before anything moved. */
  const [start] = useState(() => (from ? from.getBoundingClientRect() : null))
  /* Its shape from the picture on the page it stands for — read again as
     the pages turn, so each one is sized before it has loaded. */
  const shape = from && from.naturalWidth && from.naturalHeight ? { w: from.naturalWidth, h: from.naturalHeight } : null
  /* Its size in the window: its own, or as large as fits inside the 32
     around it — worked out here so the box is the picture exactly, and
     where it will land can be measured before it has loaded. */
  const fit = shape
    ? (() => {
        const k = Math.min(1, (innerWidth - 64) / shape.w, (innerHeight - 64) / shape.h)
        return { w: Math.round(shape.w * k), h: Math.round(shape.h * k) }
      })()
    : null
  const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches

  /* From the picture's place on the page to its place in the window — the
     one it opened from, or on the way out the one now shown, when it has a
     place on the page at all (a picture behind "+3" has none). */
  /*
   * From the picture's place on the page to its place in the window, as one
   * scale and a crop — never two scales.
   *
   * It was `scale(sx, sy)`: the box on the page and the box in the window
   * are different shapes whenever the page crops (a tile in a row, a phone
   * column), so the picture was squeezed out of shape as it flew, worst on a
   * phone. Now it keeps its own shape, scaled by the one number that makes
   * it cover the place on the page, and a clip trims it to that place's
   * outline — the crop the page itself shows — opening out as it grows.
   */
  const travel = (at: DOMRect | null = start) => {
    const el = pic.current
    if (!el || !at) return null
    const end = el.getBoundingClientRect()
    if (!end.width || !end.height) return null
    const k = Math.max(at.width / end.width, at.height / end.height)
    const dx = at.left + at.width / 2 - (end.left + end.width / 2)
    const dy = at.top + at.height / 2 - (end.top + end.height / 2)
    // How much of the picture, in its own pixels, the place on the page shows.
    const ix = Math.max(0, (end.width - at.width / k) / 2)
    const iy = Math.max(0, (end.height - at.height / k) / 2)
    const r = 8 / k
    return {
      transform: `translate(${dx}px, ${dy}px) scale(${k})`,
      clipPath: `inset(${iy}px ${ix}px round ${r}px)`,
    }
  }
  // Its own corners in the window, var(--r-tile).
  const whole = { transform: 'none', clipPath: 'inset(0px 0px round 4px)' }

  // biome-ignore lint/correctness/useExhaustiveDependencies: once, as it opens
  useLayoutEffect(() => {
    if (still()) {
      back.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, easing: 'ease-out' })
      return
    }
    back.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: OPEN_MS * 0.7, easing: 'ease-out' })
    const t = travel()
    if (t) pic.current?.animate([t, whole], { duration: OPEN_MS, easing: OPENING })
    else
      pic.current?.animate(
        [
          { opacity: 0, transform: 'scale(0.96)' },
          { opacity: 1, transform: 'none' },
        ],
        { duration: 200, easing: OPENING },
      )
    // Once, as it opens.
  }, [])

  /* Back where it came from, then gone. Every way out comes through here. */
  const shut = () => {
    if (shutting.current) return
    shutting.current = true
    if (still()) return onClose()
    const place = from && from.isConnected ? from.getBoundingClientRect() : null
    /* Only to a place still on the screen: a picture scrolled out of view
       has nowhere visible to go back to, and fades where it is. */
    const seen = place && place.bottom > 0 && place.top < innerHeight && place.width > 0
    const t = seen ? travel(place) : null
    back.current?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: SHUT_MS, easing: 'ease-in', fill: 'forwards' })
    /* The buttons go at once with the dim: left standing while the picture
       flies home, they were controls for something no longer there. */
    for (const c of back.current?.parentElement?.querySelectorAll<HTMLElement>('[data-lightbox-chrome]') ?? []) {
      c.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, easing: 'ease-out', fill: 'forwards' })
    }
    const going = pic.current?.animate(
      t
        ? [whole, t]
        : [
            { opacity: 1, transform: 'none' },
            { opacity: 0, transform: 'scale(0.96)' },
          ],
      { duration: SHUT_MS, easing: OPENING, fill: 'forwards' },
    )
    if (going) going.onfinish = () => onClose()
    else onClose()
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: shut is new on every render and closes over onClose, which is listed
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        /* Stopped here rather than left to bubble: a task is open behind
           this one on most screens, and one Escape should close one thing. */
        e.stopPropagation()
        shut()
      }
      if (e.key === 'ArrowLeft' && onPrev) {
        e.stopPropagation()
        onPrev()
      }
      if (e.key === 'ArrowRight' && onNext) {
        e.stopPropagation()
        onNext()
      }
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [onClose, onPrev, onNext])

  return (
    <div
      data-lightbox
      role="dialog"
      aria-modal="true"
      aria-label={name}
      onClick={shut}
      className="fixed inset-0 z-50 flex items-center justify-center p-8"
    >
      {/* The dim behind, its own layer so it can fade while the picture
          travels. The grey the rest of the product dims with, not a
          blue-black of its own. */}
      <div
        ref={back}
        aria-hidden
        className="absolute inset-0 bg-scrim"
        style={{
          backdropFilter: 'blur(var(--scrim-blur))',
          WebkitBackdropFilter: 'blur(var(--scrim-blur))',
        }}
      />
      {/* The picture itself does not close it: a press that lands on what
          somebody came to look at should do nothing. Its size is set from
          its own shape when that is known, so where it will end up can be
          measured before it has finished loading, and it grows there. */}
      {kind === 'video' ? (
        <video
          ref={pic as unknown as React.Ref<HTMLVideoElement>}
          src={url}
          controls
          autoPlay
          playsInline
          onClick={(e) => e.stopPropagation()}
          className="relative max-h-full max-w-full"
          style={{ borderRadius: 'var(--r-tile)' }}
        />
      ) : (
        <img
          ref={pic}
          src={src}
          alt={name}
          onClick={(e) => e.stopPropagation()}
          className="relative max-h-full max-w-full object-contain"
          style={{
            borderRadius: 'var(--r-tile)',
            ...(fit ? { width: fit.w, height: fit.h } : {}),
            willChange: 'transform',
          }}
        />
      )}
      {/*
        The controls, in the corner of the screen rather than of the picture.
        
        Against the picture they would move with it — a tall photograph and a
        wide one would put them in different places, and on a small image
        they would sit in the middle of the screen pointing at nothing.
        Fixed to the window they are where they were last time.
      */}
      {/* Through the media of one message: arrows at the window's edges,
          where a thumb or a pointer finds them on any size of picture,
          and the arrow keys. */}
      {counter && (
        <span
          data-lightbox-counter
          data-lightbox-chrome
          className="fixed top-4 left-4 flex h-8 items-center px-3 text-sm tabular-nums bg-panel text-ink"
          style={{ borderRadius: 'var(--r-row)' }}
        >
          {counter}
        </span>
      )}
      {onPrev && (
        <button
          data-testid="lightbox-prev"
          data-lightbox-chrome
          aria-label={W.previous}
          onClick={(e) => {
            e.stopPropagation()
            onPrev()
          }}
          className="fixed top-1/2 left-4 flex size-10 -translate-y-1/2 items-center justify-center rounded-full bg-panel text-ink"
        >
          <Icon name="chevL" size={18} />
        </button>
      )}
      {onNext && (
        <button
          data-testid="lightbox-next"
          data-lightbox-chrome
          aria-label={W.next}
          onClick={(e) => {
            e.stopPropagation()
            onNext()
          }}
          className="fixed top-1/2 right-4 flex size-10 -translate-y-1/2 items-center justify-center rounded-full bg-panel text-ink"
        >
          <Icon name="chevR" size={18} />
        </button>
      )}
      <div data-lightbox-chrome className="fixed top-4 right-4 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
        {/* A link and not a button, so the browser does the saving: a fetch
            into a blob would hold the whole file in memory to end up in the
            same place. `&download=1` is the header, `&name=` is what lands
            on the disk rather than a uuid. */}
        <a
          data-testid="save-picture"
          href={`${url}&download=1&name=${encodeURIComponent(name)}`}
          download={name}
          className="flex h-8 items-center px-3 text-sm bg-panel text-ink"
          style={{
            borderRadius: 'var(--r-row)',
          }}
        >
          {MORE.save}
        </a>
        {/*
          And a way out that can be seen.
          
          Escape closes it and so does the backdrop, and both are things
          somebody has to already know. A cross is the one that can be found
          by looking — and on a picture that fills the window there is no
          backdrop left to press.
        */}
        <button
          data-testid="close-picture"
          aria-label={BAR.close}
          onClick={shut}
          className="flex size-8 items-center justify-center text-md bg-panel text-ink"
          style={{
            borderRadius: 'var(--r-row)',
          }}
        >
          ×
        </button>
      </div>
    </div>
  )
}

/**
 * The picture, blurred, in the room kept for it until it arrives.
 *
 * Its size was known before (`pixelWidth`), so nothing moves; this is what
 * the room shows meanwhile — the thing itself, soft, rather than a grey box
 * that turns into it. The picture is drawn over it when it is in, with no
 * fade: a picture easing into place is the "small animation" that was taken
 * out once already.
 */
/**
 * A hairline round a picture, over it — so a screenshot whose edge is the
 * colour of the room behind it still has an edge. Drawn on top rather than
 * as a border, which would take a pixel off every side of the picture.
 */
export function Edge() {
  return (
    <span
      aria-hidden
      data-edge
      className="pointer-events-none absolute inset-0 rounded-[var(--r-row)]"
      style={{ boxShadow: 'inset 0 0 0 1px color-mix(in oklch, var(--ink) 10%, transparent)' }}
    />
  )
}

export function Glance({ src }: { src: string }) {
  return (
    <span aria-hidden data-glance className="pointer-events-none absolute inset-0 overflow-hidden rounded-[var(--r-row)]">
      <span
        className="absolute inset-0"
        style={{
          /* Quoted, and only ever an inline image (`glanceable`). */
          backgroundImage: glanceable(src) ? `url("${src}")` : undefined,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          /* Softened, not smeared: enough to hide the pixels of a
             forty-eight-pixel copy and keep what the picture is. */
          filter: 'blur(6px)',
          transform: 'scale(1.04)',
        }}
      />
    </span>
  )
}

/** Where a picture is that the reader may not open: the room it takes, quietly said. */
export function PrivatePicture({ width, pixels }: { width: number | null; pixels: { w: number; h: number } | null }) {
  return (
    <span
      data-private-picture
      className="inline-flex max-w-full items-center justify-center gap-2 rounded-[var(--r-row)] bg-sunken text-sm text-ink-3"
      style={{
        width: width ?? 240,
        aspectRatio: pixels ? `${pixels.w} / ${pixels.h}` : '4 / 3',
        maxWidth: pixels ? `min(100%, ${(600 * pixels.w) / pixels.h}px)` : '100%',
      }}
    >
      <Icon name="lock" size={14} />
      {W.privatePicture}
    </span>
  )
}

function Attachment({
  id,
  name,
  kind,
  width,
  pixels,
  size,
  blur,
}: {
  id: string
  name: string
  kind: string
  /** A blurred glance at it, for its room while it loads. */
  blur?: string | null
  /** Bytes, when the editor recorded them. */
  size?: number | null
  /** As narrow as it was dragged to in the editor; none is its own size. */
  width?: number | null
  /** Its own size, when the editor recorded it, for the room kept for it. */
  pixels?: { w: number; h: number } | null
}) {
  const [loaded, setLoaded] = useState(false)
  /* A video's frame, learned from its first bytes when the editor did not
     record it. */
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)
  const [links, setLinks] = useState<Links | null>(() => knownLinks(id))
  /* The original, for opening full size and saving; and what a body draws —
     the copy for showing when the picture has one. */
  const url = links?.url ?? null
  const show = links?.display ?? url
  const [gone, setGone] = useState(false)
  /* Could not be asked, as against asked and told it is gone: a file is
     not deleted because the connection dropped. Asked again when it is back.
     `docs/specs/offline.md`. */
  const [away, setAway] = useState(false)
  const [open, setOpen] = useState(false)
  /* The picture on the page, for the lightbox to grow out of. */
  const pic = useRef<HTMLImageElement>(null)
  /* The sender's own copy, when this browser sent it. */
  const local = previewOf(id)
  const born = useRef(performance.now())
  const [fading, setFading] = useState(false)
  /* Kept under the picture while it comes up, then let go. */
  const [settled, setSettled] = useState(false)
  /* Already in the browser — warmed ahead, or seen before: drawn as it is
     from the first frame, with no glance under it even for one. */
  // biome-ignore lint/correctness/useExhaustiveDependencies: a picture already in the cache is looked for again when what is shown changes
  useLayoutEffect(() => {
    const img = pic.current
    if (img?.complete && img.naturalWidth > 0) {
      setLoaded(true)
      setSettled(true)
    }
  }, [show, local])
  useEffect(() => {
    let alive = true
    const ask = () =>
      void fileLinks(id)
        .then((l) => {
          if (!alive) return
          setAway(false)
          setLinks(l)
        })
        .catch((e: unknown) => {
          if (!alive) return
          /* Gone only when the server says so; a 5xx is asked again in a
             moment rather than drawn as a missing file. */
          if (e instanceof Unreachable) setAway(true)
          else if (isGone(e)) setGone(true)
          else setTimeout(() => alive && ask(), 1500)
        })
    ask()
    const stop = onReach((now) => now && ask())
    return () => {
      alive = false
      stop()
    }
  }, [id])

  /* A picture not the reader's to open is a quiet place of its own size,
     not a broken frame and not its name. */
  if (gone && kind === 'image') return <PrivatePicture width={width ?? pixels?.w ?? null} pixels={pixels ?? null} />
  if (gone || (away && !url)) {
    return <span className="text-base text-ink-3">{gone ? W.gone(name) : W.offline(name)}</span>
  }
  if (kind === 'video') {
    const frame = pixels ?? natural
    return (
      /*
       * A video plays where it was sent, rather than downloading.
       *
       * With controls and without autoplay: a feed of messages that all
       * start talking when it is scrolled past is the thing autoplay means
       * here. The first frame is what `<video>` draws by itself, which is
       * the whole of what a stored poster image would have been.
       */
      /* Reserved before it arrives, in its own shape when the editor
         recorded it and a wide frame when it did not, so what is under it
         does not jump when the bytes land — the rule the picture follows. */
      <span
        className="inline-block max-w-full align-top"
        style={{
          width: frame?.w ?? 640,
          maxWidth: frame ? `min(100%, ${(600 * frame.w) / frame.h}px)` : '100%',
        }}
      >
        <video
          data-attachment={id}
          src={url ?? undefined}
          /* The glance until its own first frame is in: the room is filled
             with the video, blurred, rather than with grey. */
          poster={blur ?? undefined}
          controls
          playsInline
          preload="metadata"
          onLoadedMetadata={(e) => {
            const v = e.currentTarget
            if (!pixels && v.videoWidth && v.videoHeight) setNatural({ w: v.videoWidth, h: v.videoHeight })
          }}
          className="block w-full max-w-full rounded-[var(--r-row)] bg-sunken"
          style={{
            aspectRatio: frame ? `${frame.w} / ${frame.h}` : '16 / 9',
          }}
        />
      </span>
    )
  }
  if (kind === 'image') {
    return (
      <>
        {/*
          The picture, with the one thing to do with it in its corner.
          
          On hover rather than always: a button standing on every picture in
          a conversation is chrome where the content is, and the pictures
          here are small and many. On a touch screen there is no hover, so
          it is simply there — a control somebody cannot reveal is a control
          they do not have.
        */}
        <span
          className="group relative inline-block max-w-full rounded-[var(--r-row)]"
          style={{
            width: width ?? pixels?.w ?? undefined,
            /* No taller than 600, as in the editor: no wider than that
               height allows when its shape is known. */
            maxWidth: pixels ? `min(100%, ${(600 * pixels.w) / pixels.h}px)` : '100%',
            background: loaded ? undefined : 'var(--sunken)',
          }}
        >
          {!settled && !local && blur && <Glance src={blur} />}
          <img
            data-attachment={id}
            src={local ?? show ?? undefined}
            alt={name}
            /* Opened by pressing it, which is what every tool a person already
             uses does. Only once it has arrived:
             a press on a grey box that is still loading opens an empty
             dialog. */
            ref={pic}
            onClick={() => url && setOpen(true)}
            onLoad={() => {
              /* Arrived at once — from the cache, or the sender's own copy —
               it is simply there. Arrived later, it comes up over its glance
               in a fifth of a second, the way a photo develops, rather than
               snapping from a blur to a picture. */
              if (performance.now() - born.current > 120) setFading(true)
              setLoaded(true)
              setTimeout(() => setSettled(true), 260)
            }}
            loading="lazy"
            decoding="async"
            className={`block max-w-full rounded-[var(--r-row)] ${pixels ? 'w-full' : 'w-auto'}`}
            style={{
              aspectRatio: pixels ? `${pixels.w} / ${pixels.h}` : undefined,
              maxHeight: pixels ? undefined : 600,
              minHeight: loaded || pixels ? undefined : 120,
              minWidth: loaded || pixels ? undefined : 160,
              opacity: loaded ? 1 : 0,
              transition: fading ? 'opacity 200ms ease-out' : undefined,
              position: 'relative',
              /* The pointer says it does something. Nothing else changes: a
               picture that moves under the cursor is a picture arguing with
               what is drawn on it. */
              cursor: url ? 'zoom-in' : undefined,
            }}
          />
          <Edge />
          {url && (
            <a
              data-testid="save-attachment"
              href={`${url}&download=1&name=${encodeURIComponent(name)}`}
              download={name}
              aria-label={MORE.save}
              title={MORE.save}
              /* The press belongs to the button and not to the picture under
               it, which would otherwise open the lightbox at the same time. */
              onClick={(e) => e.stopPropagation()}
              className="absolute top-2 right-2 flex size-7 items-center justify-center bg-[rgb(0_0_0/0.55)] opacity-0 transition-[opacity,background-color] on-group-hover:opacity-100 focus-visible:opacity-100 max-[1023px]:opacity-100 mouse:hover:bg-[rgb(0_0_0/0.8)]"
              style={{
                borderRadius: 'var(--r-row)',
                color: '#fff',
              }}
            >
              {/* An arrow onto a line, drawn here rather than added to the
                glyph set: those are drawn with one hand behind them and a
                shape typed in beside them is the one that does not match. */}
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
                <path
                  d="M8 2.5v7m0 0 3-3m-3 3-3-3M3.5 12.5h9"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </a>
          )}
        </span>
        {open && url && <Lightbox url={url} quick={local ?? show} name={name} from={pic.current} onClose={() => setOpen(false)} />}
      </>
    )
  }
  /* A card across the column with its size and a way to save it, as in
     the editor — `Editor.tsx`. The name opens it; the arrow saves it. */
  return (
    <div
      data-attachment={id}
      data-file-card
      className="flex w-full items-center gap-3 py-3 pr-2 pl-4 bg-sunken"
      style={{
        borderRadius: 'var(--r-card)',
        boxShadow: 'inset 0 0 0 1px var(--line)',
      }}
    >
      <Icon name="doc" size={20} className="text-ink-3" />
      <a
        /* With its name, so a file the browser cannot show is saved as
           itself rather than as the last part of the address. */
        href={url ? `${url}&name=${encodeURIComponent(name)}` : undefined}
        target="_blank"
        rel="noreferrer noopener"
        className="flex min-w-px flex-1 flex-col"
      >
        <span className="truncate text-md text-ink">{name}</span>
        <span className="text-sm tabular-nums text-ink-3">{fileLine(name, size ?? sizeOf(id))}</span>
      </a>
      {url && (
        <a
          data-testid="save-file"
          href={`${url}&download=1&name=${encodeURIComponent(name)}`}
          download={name}
          aria-label={W.downloadName(name)}
          title={W.download}
          className="flex size-8 shrink-0 items-center justify-center rounded-[var(--r-row)] transition-colors mouse:hover:bg-[var(--hover)] text-ink-2"
        >
          <Icon name="download" size={16} />
        </a>
      )}
    </div>
  )
}

/* Somebody called in, pressed to see who — the window every face opens.
   `docs/specs/person-card.md`. */
function Mentioned({ id, label }: { id: string; label: string }) {
  const doors = useContext(PersonDoorsContext)
  const show = doors?.show
  if (!show || !isPersonId(id)) {
    return (
      <span data-mention={id} className="chat-mention">
        @{label}
      </span>
    )
  }
  return (
    <span
      role="button"
      tabIndex={0}
      data-mention={id}
      className="chat-mention cursor-pointer"
      onPointerEnter={() => void personOf(id)}
      onClick={() => show(id)}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), show(id))}
    >
      @{label}
    </span>
  )
}

function render(node: Node, key: string): React.ReactNode {
  if (node.type === 'text') return marked(node, key)
  if (node.type === 'hardBreak') return <br key={key} />
  /* A task named in a message: its number and title, pressed to open it.
     The card under the message says where it stands — `chat-tasks.md`. */
  if (node.type === 'taskref')
    return (
      <TaskName
        key={key}
        id={String(node.attrs?.id ?? '')}
        projectId={typeof node.attrs?.projectId === 'string' && node.attrs.projectId ? node.attrs.projectId : null}
        number={node.attrs?.number}
        handle={typeof node.attrs?.key === 'string' ? node.attrs.key : null}
        title={String(node.attrs?.title ?? '')}
      />
    )
  /* A document named in a message — `docs/specs/docs.md`. */
  if (node.type === 'docref')
    return (
      <DocName
        key={key}
        id={String(node.attrs?.id ?? '')}
        projectId={typeof node.attrs?.projectId === 'string' ? node.attrs.projectId : null}
        title={String(node.attrs?.title ?? '')}
      />
    )
  /* Somebody called in from the chat's line — `ChatComposer.tsx`. */
  if (node.type === 'mention') return <Mentioned key={key} id={String(node.attrs?.id ?? '')} label={String(node.attrs?.label ?? '')} />
  /* A GIF, drawn from KLIPY's own address and from nowhere else —
     `docs/specs/gifs.md`. Its room is kept before it arrives. */
  if (node.type === 'gif') {
    const url = node.attrs?.url
    if (!isKlipy(url)) return null
    const w = typeof node.attrs?.width === 'number' ? node.attrs.width : 4
    const h = typeof node.attrs?.height === 'number' ? node.attrs.height : 3
    return (
      <div key={key} className="py-1" data-gif-shown>
        <img
          src={url}
          alt={String(node.attrs?.title ?? 'GIF')}
          loading="lazy"
          className="block max-w-[min(100%,320px)] rounded-[var(--r-row)] bg-track"
          style={{ aspectRatio: `${w} / ${h}`, width: Math.min(320, w) }}
        />
      </div>
    )
  }
  if (node.type === 'preview') {
    const a = node.attrs ?? {}
    const href = String(a.url ?? '')
    if (!LINKABLE.test(href)) return null
    /* The picture only through this server (`/api/preview/image`, signed):
       a card naming any other address would make each reader's browser ask
       it. Older cards lose their picture. */
    const image = typeof a.image === 'string' && a.image.startsWith('/api/preview/image?') ? a.image : null
    return (
      <LinkCard
        key={key}
        card={{
          url: href,
          title: String(a.title ?? href),
          description: a.description ? String(a.description) : null,
          image,
          site: a.site ? String(a.site) : null,
        }}
      />
    )
  }
  if (node.type === 'horizontalRule')
    return <hr key={key} className="my-3 border-0 border-t" style={{ borderColor: 'var(--line-strong)' }} />
  if (node.type === 'attachment') {
    return (
      <div key={key} className="py-1">
        <Attachment
          id={String(node.attrs?.fileId ?? '')}
          name={String(node.attrs?.name ?? W.file)}
          kind={String(node.attrs?.kind ?? 'file')}
          width={typeof node.attrs?.width === 'number' ? node.attrs.width : null}
          size={typeof node.attrs?.size === 'number' ? node.attrs.size : null}
          pixels={
            typeof node.attrs?.pixelWidth === 'number' && typeof node.attrs?.pixelHeight === 'number'
              ? { w: node.attrs.pixelWidth, h: node.attrs.pixelHeight }
              : null
          }
          blur={typeof node.attrs?.blur === 'string' ? node.attrs.blur : null}
        />
      </div>
    )
  }

  const kids = (node.content ?? []).map((c, i) => render(c, `${key}.${i}`))

  /* A table, in the frame and the lines the editor draws it in.
     A span is a small whole number or nothing. */
  if (node.type === 'table') {
    return (
      <div key={key} className="doc-table-frame">
        <table className="doc-table">
          <tbody>{kids}</tbody>
        </table>
      </div>
    )
  }
  if (node.type === 'tableRow') return <tr key={key}>{kids}</tr>
  if (node.type === 'tableCell' || node.type === 'tableHeader') {
    const span = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v > 1 && v <= 50 ? v : undefined)
    const Cell = node.type === 'tableHeader' ? 'th' : 'td'
    return (
      <Cell key={key} colSpan={span(node.attrs?.colspan)} rowSpan={span(node.attrs?.rowspan)}>
        {kids}
      </Cell>
    )
  }

  /* A callout and a toggle, as the editor draws them.
     The toggle is the browser's own, folded: opening one to read it is not
     an edit, so nothing says it was open. */
  if (node.type === 'callout') {
    return (
      <div key={key} className="callout" data-callout="" data-tone={toneOf(node.attrs?.tone)}>
        <span className="callout-emoji" aria-hidden>
          {emojiOf(node.attrs?.emoji)}
        </span>
        <div className="callout-body">{kids}</div>
      </div>
    )
  }
  if (node.type === 'details') {
    const summary = (node.content ?? []).find((c) => c.type === 'detailsSummary')
    const inside = (node.content ?? []).find((c) => c.type === 'detailsContent')
    return (
      <details key={key} className="toggle-read" data-toggle="">
        <summary>
          <span className="toggle-chevron" aria-hidden>
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
              <path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <span className="min-w-px flex-1">{(summary?.content ?? []).map((c, i) => render(c, `${key}.s${i}`))}</span>
        </summary>
        <div className="toggle-inside flex flex-col gap-2">{(inside?.content ?? []).map((c, i) => render(c, `${key}.c${i}`))}</div>
      </details>
    )
  }

  if (node.type === 'heading') {
    const level = Number(node.attrs?.level ?? 2)
    return (
      <p
        key={key}
        className="pt-2 font-medium text-ink"
        style={{
          fontSize: level <= 1 ? 20 : level === 2 ? 17 : 15,
          letterSpacing: 'var(--track-title)',
        }}
      >
        {kids}
      </p>
    )
  }
  if (node.type === 'codeBlock') {
    /* Coloured by the highlighter the editor uses, so a block reads the
       same once it is sent as it did while it was written, with its bar. */
    return (
      <ReadCode
        key={key}
        code={(node.content ?? []).map((c) => c.text ?? '').join('')}
        language={node.attrs?.language}
        wrap={node.attrs?.wrap === true}
        numbered={node.attrs?.lineNumbers === true}
      />
    )
  }
  if (node.type === 'blockquote') {
    return (
      <blockquote key={key} className="border-l-4 pl-3 border-line-strong text-ink-2">
        {kids}
      </blockquote>
    )
  }
  if (node.type === 'bulletList' || node.type === 'orderedList') {
    const Tag = BLOCK[node.type] as 'ul'
    return (
      <Tag key={key} className={node.type === 'bulletList' ? 'list-disc pl-5' : 'list-decimal pl-5'}>
        {kids}
      </Tag>
    )
  }
  const Tag = (Object.hasOwn(BLOCK, node.type ?? '') ? BLOCK[node.type!] : 'div') as 'p'
  return <Tag key={key}>{kids}</Tag>
}

export function Doc({ body, className = '' }: { body: unknown; className?: string }) {
  return (
    <Guard>
      <DocBody body={body} className={className} />
    </Guard>
  )
}

/*
 * And if something in a body still cannot be drawn, that body says so —
 * one message, not the whole app gone white for everybody who opens it.
 */
class Guard extends Component<{ children: React.ReactNode }, { failed: boolean }> {
  override state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  override render() {
    return this.state.failed ? <p className="text-base text-ink-3">{W.couldNotShow}</p> : this.props.children
  }
}

function DocBody({ body, className }: { body: unknown; className: string }) {
  const doc = body ? clean(body) : null
  if (!doc?.content?.length) return null
  return (
    <div className={`flex flex-col gap-2 text-base ${className}`} style={{ color: 'var(--ink)', letterSpacing: 'var(--track-body)' }}>
      {runs(doc.content).map((n, i) =>
        'media' in n ? (
          <Gallery key={String(i)} nodes={n.media} />
        ) : 'files' in n ? (
          /* Files one after another, close together: one thing sent with
             several parts, not several things — `attachments.md`. */
          <div key={String(i)} data-files className="flex flex-col gap-1 py-1">
            {n.files.map((f, k) => (
              <Attachment
                key={k}
                id={String(f.attrs?.fileId ?? '')}
                name={String(f.attrs?.name ?? W.file)}
                kind="file"
                size={typeof f.attrs?.size === 'number' ? f.attrs.size : null}
              />
            ))}
          </div>
        ) : (
          render(n.one, String(i))
        ),
      )}
    </div>
  )
}

const isMedia = (n: Node) =>
  n.type === 'attachment' && (n.attrs?.kind === 'image' || n.attrs?.kind === 'video') && typeof n.attrs?.fileId === 'string'

const isFile = (n: Node) => n.type === 'attachment' && n.attrs?.kind === 'file' && typeof n.attrs?.fileId === 'string'

/** Two or more pictures and videos one after another become one row; two or
    more files, one close list. */
function runs(content: Node[]): ({ one: Node } | { media: Node[] } | { files: Node[] })[] {
  const out: ({ one: Node } | { media: Node[] } | { files: Node[] })[] = []
  let run: Node[] = []
  let kind: 'media' | 'files' | null = null
  const flush = () => {
    if (run.length >= 2 && kind === 'media') out.push({ media: run })
    else if (run.length >= 2 && kind === 'files') out.push({ files: run })
    else out.push(...run.map((one) => ({ one })))
    run = []
    kind = null
  }
  for (const n of content) {
    const k = isMedia(n) ? 'media' : isFile(n) ? 'files' : null
    if (k && k === kind) run.push(n)
    else {
      flush()
      if (k) {
        kind = k
        run = [n]
      } else out.push({ one: n })
    }
  }
  flush()
  return out
}

/**
 * Several pictures in one message, in one row.
 *
 * They stood one under another at full size, so three screenshots were a
 * screen and a half of scrolling to get past one message. Now as many as fit
 * at a useful size stand side by side, cropped to one height; what does not
 * fit is "+3" on the last one, and the lightbox pages through all of them
 * with arrows. Above the row, how many there are and a way to save them all.
 */
const GAP = 8
function Gallery({ nodes }: { nodes: Node[] }) {
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const watch = new ResizeObserver(() => setWidth(el.clientWidth))
    watch.observe(el)
    setWidth(el.clientWidth)
    return () => watch.disconnect()
  }, [])
  const narrowest = width && width < 480 ? 112 : 160
  const fit = width ? Math.max(1, Math.min(nodes.length, Math.floor((width + GAP) / (narrowest + GAP)))) : Math.min(nodes.length, 3)
  const tileW = width ? (width - GAP * (fit - 1)) / fit : 200
  const tileH = Math.round(Math.min(320, Math.max(160, tileW * 0.9)))
  const more = nodes.length - fit
  const tiles = useRef<(HTMLImageElement | null)[]>([])
  const [open, setOpen] = useState<number | null>(null)
  const [links, setLinks] = useState<(Links | null)[]>(() => nodes.map((n) => knownLinks(String(n.attrs?.fileId))))
  useEffect(() => {
    let alive = true
    nodes.forEach(
      (n, i) =>
        void fileLinks(String(n.attrs?.fileId))
          .then((l) => alive && setLinks((had) => had.map((x, k) => (k === i ? l : x))))
          .catch(() => {}),
    )
    return () => {
      alive = false
    }
  }, [nodes])

  const saveAll = async () => {
    for (const [i, n] of nodes.entries()) {
      const l = links[i] ?? (await fileLinks(String(n.attrs?.fileId)).catch(() => null))
      if (!l) continue
      const a = document.createElement('a')
      const name = String(n.attrs?.name ?? 'file')
      a.href = `${l.url}&download=1&name=${encodeURIComponent(name)}`
      a.download = name
      a.click()
      /* One at a time: a burst of downloads is one the browser refuses. */
      await new Promise((ok) => setTimeout(ok, 400))
    }
  }

  const at = open === null ? null : nodes[open]
  return (
    <div data-gallery className="flex flex-col gap-2">
      <div className="flex items-center gap-3 text-sm text-ink-3">
        <span>{W.attachments(nodes.length)}</span>
        <span className="h-3 w-px bg-line-strong" />
        <button
          data-testid="save-all"
          onClick={() => void saveAll()}
          className="flex items-center gap-1 transition-colors mouse:hover:text-[var(--ink)]"
        >
          <Icon name="download" size={14} />
          {W.downloadAll}
        </button>
      </div>
      <div ref={box} className="flex w-full" style={{ gap: GAP }}>
        {nodes.slice(0, fit).map((n, i) => {
          const l = links[i]
          const show = previewOf(String(n.attrs?.fileId)) ?? l?.display ?? l?.url ?? null
          const blur = typeof n.attrs?.blur === 'string' ? n.attrs.blur : null
          const video = n.attrs?.kind === 'video'
          return (
            <button
              key={i}
              data-gallery-tile
              onClick={() => setOpen(i)}
              className="relative shrink-0 overflow-hidden rounded-[var(--r-row)] bg-sunken"
              style={{ width: tileW, height: tileH }}
              aria-label={String(n.attrs?.name ?? W.open)}
            >
              {blur && <Glance src={blur} />}
              {video ? (
                <video
                  src={l?.url ?? undefined}
                  poster={blur ?? undefined}
                  muted
                  playsInline
                  preload="metadata"
                  className="relative size-full object-cover"
                />
              ) : (
                show && (
                  <img
                    ref={(el) => {
                      tiles.current[i] = el
                    }}
                    data-attachment={String(n.attrs?.fileId)}
                    src={show}
                    alt={String(n.attrs?.name ?? '')}
                    decoding="async"
                    className="relative size-full object-cover"
                  />
                )
              )}
              <Edge />
              {video && (
                <span aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <span className="flex size-10 items-center justify-center rounded-full" style={{ background: 'rgb(0 0 0 / 0.5)' }}>
                    <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden>
                      <path d="M4 2.5 L9 6 L4 9.5 Z" fill="#fff" />
                    </svg>
                  </span>
                </span>
              )}
              {/* What does not fit, said on the last that does. */}
              {more > 0 && i === fit - 1 && (
                <span
                  data-gallery-more
                  className="absolute inset-0 flex items-center justify-center text-display font-medium"
                  style={{ background: 'rgb(0 0 0 / 0.45)', color: '#fff' }}
                >
                  +{more}
                </span>
              )}
            </button>
          )
        })}
      </div>
      {open !== null && at && links[open] && (
        <Lightbox
          url={links[open]!.url}
          quick={previewOf(String(at.attrs?.fileId)) ?? links[open]!.display}
          name={String(at.attrs?.name ?? '')}
          kind={at.attrs?.kind === 'video' ? 'video' : 'image'}
          from={open < fit ? (tiles.current[open] ?? null) : null}
          counter={`${open + 1} / ${nodes.length}`}
          onPrev={open > 0 ? () => setOpen(open - 1) : undefined}
          onNext={open < nodes.length - 1 ? () => setOpen(open + 1) : undefined}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  )
}
