import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon, type IconName } from './glyphs.jsx'
import { type Brand, BrandIcon } from './brandIcons.jsx'
import { DocMark, Dialog, Hairline, Panel, Popover, Segments, notALogin, linkField } from './kit.jsx'
import { ago } from './chat/messageRow.jsx'
import { Lightbox } from './Doc.jsx'
import { fileLinks } from '../data/files.js'
import { nearFile } from './FileDetail.jsx'
import { BAR, LOCALE } from '../data/words.js'
import { DOCS as W } from '../words/docs.js'
import { BYTES } from '../words/bytes.js'
import { DOC_TEMPLATE } from '../words/docTemplates.js'
import { FILE_DETAIL } from '../words/fileDetail.js'

/**
 * A project's Docs, as a list somebody works from — `docs/specs/docs.md`.
 *
 * Pictures show in the list rather than behind a click, a PDF opens over
 * the page with a way to save it, anything uploaded can be saved from its
 * row, a link says where it goes by its mark and its name, and the list
 * narrows by kind.
 */

export type DocRow = {
  id: string
  name: string
  kind: 'document' | 'upload' | 'link' | 'folder'
  url: string | null
  folder_id: string | null
  is_document: boolean
  /** Shared to the web. */
  is_public?: boolean
  author_id?: string
  author_name: string
  content_type?: string | null
  size_bytes?: string | number | null
  updated_at?: string
  thumb_url?: string | null
  /** Kept at the head of the list, for everybody on the project. */
  pinned_at?: string | null
  /** Saved as a template. */
  template_at?: string | null
  /** Who it is for. */
  audience?: 'author' | 'chosen' | 'project'
  created_at?: string
  /** What a written document wears — `docs/specs/docs.md`, "A document's mark". */
  mark_icon?: string | null
  mark_tint?: number | null
  /** A pinned document's first lines, for its card's page, and its first
      picture's copy for showing, signed for this reader. */
  preview?: { lines: { h: number; t: string }[]; picture: string | null; picture_url?: string | null }
  /* Where it was first put — `docs/specs/docs.md`. */
  origin_type?: 'message' | 'task' | 'post' | 'file' | null
  origin_id?: string | null
  origin_room?: string | null
  origin_room_name?: string | null
  origin_room_channel?: boolean | null
  origin_room_project_slug?: string | null
  origin_task_number?: number | null
  origin_task_title?: string | null
  origin_task_key?: string | null
  origin_post_title?: string | null
}

/** Where a file was sent or put, in words — or nothing if it was uploaded here. */
export function originOf(f: DocRow): string | null {
  if (f.origin_type === 'message' && f.origin_room_name) {
    if (f.origin_room_channel === false) return f.origin_room_name
    const own = f.origin_room_name.toLowerCase().replace(/\s+/g, '-')
    return `#${f.origin_room_project_slug ? `${f.origin_room_project_slug}-${own}` : own}`
  }
  if (f.origin_type === 'task' && f.origin_task_title)
    return `${f.origin_task_key ? `${f.origin_task_key}-${f.origin_task_number}` : W.task} ${f.origin_task_title}`
  if (f.origin_type === 'post' && f.origin_post_title) return f.origin_post_title
  return null
}

/**
 * The four kinds Files narrows to, Docs first — `docs/specs/docs.md`,
 * "Four kinds and whose". There is no All: the list always shows one kind.
 * A folder, where one is left from before, would be a Docs row; none is
 * drawn.
 */
export type DocsFilter = 'docs' | 'images' | 'uploads' | 'links'
/** Whose rows: everybody's, the reader's own, or everybody else's. */
export type DocsWhose = 'recent' | 'mine' | 'shared'

export const isImage = (f: DocRow) => f.kind === 'upload' && (f.content_type ?? '').startsWith('image/')
export const isPdf = (f: DocRow) => f.kind === 'upload' && f.content_type === 'application/pdf'

export function fits(f: DocRow, filter: DocsFilter): boolean {
  if (filter === 'docs') return f.kind === 'document' || f.kind === 'folder'
  if (filter === 'images') return isImage(f)
  if (filter === 'uploads') return f.kind === 'upload' && !isImage(f)
  return f.kind === 'link'
}

/**
 * Files' place from the address — a kind, or `deleted` for Recently
 * Deleted — or null for anything else, which a bare `/files` settles.
 */
export function placeOf(kind: string | null | undefined): DocsFilter | 'deleted' | null {
  return kind === 'docs' || kind === 'images' || kind === 'uploads' || kind === 'links' || kind === 'deleted' ? kind : null
}

/** Whether a row is one this reader's choice of whose keeps. */
export function whoseFits(f: DocRow, whose: DocsWhose, meId: string): boolean {
  if (whose === 'recent') return true
  if (f.id.startsWith('pending:')) return whose === 'mine'
  return whose === 'mine' ? f.author_id === meId : f.author_id !== meId
}

/** The kind a file just given belongs under, so it is seen where it lands. */
export function kindOf(f: { kind: DocRow['kind']; content_type?: string | null | undefined }): DocsFilter {
  if (f.kind === 'link') return 'links'
  if (f.kind === 'upload') return (f.content_type ?? '').startsWith('image/') ? 'images' : 'uploads'
  return 'docs'
}

/**
 * Pins first, the latest pin at the top; then the most recently changed —
 * Recent is "what moved last", which is what somebody comes back for.
 */
export function byRecent(a: DocRow, b: DocRow): number {
  const pin = (b.pinned_at ?? '').localeCompare(a.pinned_at ?? '')
  if (pin) return pin
  /* A row still on its way has no date yet and is the newest there is:
     sorted last, it stood at the foot and jumped to the head under the
     pointer when the server answered. */
  /* Rows of one millisecond tie here and keep the order the server paged
     them in, the sort being stable — the server's is to the microsecond,
     and then the id. */
  return (b.updated_at ?? b.created_at ?? '\uffff').localeCompare(a.updated_at ?? a.created_at ?? '\uffff')
}

/*
 * The kind and whose, kept on this machine as the last ones chosen — a view
 * of the list, like a board's narrowed columns (`tasks/view.tsx`), not a
 * thing a team has one answer to. Under the reader's id, so two people on
 * one browser keep their own. A value from before — `all`, `files` — reads
 * as what it became.
 */
const KIND_KEY = (me: string) => `docs-kind:${me}`
const WHOSE_KEY = (me: string) => `docs-whose:${me}`
export function readDocsView(me: string): { kind: DocsFilter; whose: DocsWhose } {
  let kind: DocsFilter = 'docs'
  let whose: DocsWhose = 'recent'
  try {
    const k = localStorage.getItem(KIND_KEY(me))
    if (k === 'images' || k === 'links' || k === 'uploads') kind = k
    else if (k === 'files') kind = 'uploads'
    const w = localStorage.getItem(WHOSE_KEY(me))
    if (w === 'mine' || w === 'shared') whose = w
  } catch {
    // Private window, blocked storage: Docs and everybody's.
  }
  return { kind, whose }
}
export function keepDocsView(me: string, view: { kind?: DocsFilter; whose?: DocsWhose }): void {
  try {
    if (view.kind) localStorage.setItem(KIND_KEY(me), view.kind)
    if (view.whose) localStorage.setItem(WHOSE_KEY(me), view.whose)
  } catch {
    // Kept for this visit only.
  }
}

/**
 * Whether a row says these words: its name, a link's address, who put it
 * there, and where it was sent from. Every row is already on the screen, so
 * this narrows it there — `docs/specs/find.md`.
 */
export function says(f: DocRow, words: string): boolean {
  const w = words.trim().toLowerCase()
  if (!w) return true
  return [f.name, f.url, f.author_name, originOf(f)].some((s) => (s ?? '').toLowerCase().includes(w))
}

/** The kinds a list can be narrowed to, and whose rows it shows. */
export function DocsFilters({
  value,
  onPick,
  whose,
  onWhose,
  inBin = false,
  onBin,
  nearBin,
}: {
  value: DocsFilter
  onPick: (f: DocsFilter) => void
  whose: DocsWhose
  onWhose: (w: DocsWhose) => void
  /** Recently Deleted is open: no kind is chosen and the menu says so. */
  inBin?: boolean
  /** Opening Recently Deleted; absent for somebody who can delete nothing. */
  onBin?: (() => void) | undefined
  /** The hand is on its door: read it ahead, so it opens whole. */
  nearBin?: (() => void) | undefined
}) {
  /* All four, always: a filter that appears only once there is something
     to filter was a control nobody found. An empty kind says so when
     picked. */
  const kinds: { key: DocsFilter; label: string; icon: IconName }[] = [
    { key: 'docs', label: W.docs, icon: 'doc' },
    { key: 'images', label: W.images, icon: 'image' },
    { key: 'uploads', label: W.uploads, icon: 'clip' },
    { key: 'links', label: W.links, icon: 'link' },
  ]
  const owners: { key: DocsWhose; label: string; icon: IconName }[] = [
    { key: 'recent', label: W.recent, icon: 'clock' },
    { key: 'mine', label: W.mine, icon: 'person' },
    { key: 'shared', label: W.sharedWithMe, icon: 'people' },
  ]
  const bin = { key: 'deleted' as const, label: W.recentlyDeleted, icon: 'trash' as IconName }
  const now = inBin ? bin : (owners.find((o) => o.key === whose) ?? owners[0]!)
  const labels = onBin ? [...owners, bin] : owners
  return (
    /*
     * One row: the kinds at the start, whose at the end, as a menu — a
     * second segmented control beside the first was two questions shouting
     * at the same volume, and whose is changed far less often than the
     * kind. Below 640 the kinds keep the open one's word and drop the
     * others' (`glyphsWhenNarrow`), which leaves
     * room for the menu on the same line. `docs/specs/docs.md`.
     *
     * `shrink-0`: in a column that scrolls, a row that may shrink gives
     * its height up to the list under it — the filters were there, and
     * zero pixels tall, which is why nobody found them.
     */
    <div data-testid="docs-filter" className="flex shrink-0 items-center gap-2">
      <div role="group" aria-label={W.kinds} className="flex min-w-px overflow-x-auto [scrollbar-width:none]">
        <Segments
          items={kinds.map((k) => ({ key: k.key, label: k.label, icon: k.icon, attrs: { 'data-docs-kind': k.key } }))}
          /* In the bin no kind is chosen — it holds every kind — and a
             press on one leaves it for that kind. */
          value={inBin ? ('' as DocsFilter) : value}
          onPick={onPick}
          glyphsWhenNarrow
        />
      </div>
      <span className="ml-auto flex shrink-0" onPointerEnter={nearBin}>
        <Popover
          shape="bare"
          width={232}
          align="right"
          sheet={false}
          testId="docs-whose"
          said={W.whose}
          label={
            /* Filled, as the other menus' buttons are — the view's
               "Assigned to" — not bare words standing on the page. */
            <span
              data-control
              data-whose={inBin ? 'deleted' : whose}
              className="flex h-8 items-center gap-2 rounded-full px-3 text-base bg-track text-ink"
            >
              <Icon name={now.icon} size={16} />
              {/* Every label in one cell and only the chosen one seen, so
                  the button is as wide as the widest whatever is chosen,
                  and the row does not move when it changes. */}
              {/* Below 640 the glyph alone, which leaves the kinds the
                  row; the menu says the words. */}
              <span className="grid text-left max-[639px]:hidden">
                {labels.map((o) => (
                  <span key={o.key} aria-hidden={o.key !== now.key} className={`[grid-area:1/1] ${o.key === now.key ? '' : 'invisible'}`}>
                    {o.label}
                  </span>
                ))}
              </span>
              <Icon name="chevron" size={10} className="text-ink-3" />
            </span>
          }
        >
          {(close) => (
            <div role="menu" data-menu className="py-1">
              {owners.map((o) => (
                <button
                  key={o.key}
                  role="menuitemradio"
                  aria-checked={!inBin && o.key === whose}
                  data-row
                  data-docs-whose={o.key}
                  onClick={() => {
                    close()
                    onWhose(o.key)
                  }}
                  className="flex w-full items-center gap-3 px-3 text-left text-base text-ink"
                  style={{ height: 'var(--row-h)' }}
                >
                  <Icon name={o.icon} size={16} className="text-ink-2" />
                  <span className="min-w-px flex-1 truncate">{o.label}</span>
                  <span className="flex w-4 shrink-0 justify-center text-accent">
                    {!inBin && o.key === whose && <Icon name="check" size={14} />}
                  </span>
                </button>
              ))}
              {/* A place, not a way of looking at the list: under a line,
                  where the question changes. */}
              {onBin && (
                <>
                  <span aria-hidden className="my-1 block h-px bg-line" />
                  <button
                    role="menuitemradio"
                    aria-checked={inBin}
                    data-row
                    data-docs-whose="deleted"
                    onPointerEnter={nearBin}
                    onFocus={nearBin}
                    onClick={() => {
                      close()
                      onBin()
                    }}
                    className="flex w-full items-center gap-3 px-3 text-left text-base text-ink"
                    style={{ height: 'var(--row-h)' }}
                  >
                    <Icon name="trash" size={16} className="text-ink-2" />
                    <span className="min-w-px flex-1 truncate">{W.recentlyDeleted}</span>
                    <span className="flex w-4 shrink-0 justify-center text-accent">{inBin && <Icon name="check" size={14} />}</span>
                  </button>
                </>
              )}
            </div>
          )}
        </Popover>
      </span>
    </div>
  )
}

/* ------------------------------------------------------------------ links */

/** `brand` is the place's own icon (`brandIcons.tsx`), drawn in its own
    colours where a file has its type's; without one the row has the link's
    glyph. */
type Where = { label: string; name: string; brand?: Brand }

/**
 * Where a link goes, read from its address — the mark a person knows the
 * place by, and a name better than the host. Google's three editors, Figma,
 * GitHub, Notion and the rest; anything else is its host.
 */
export function linkInfo(raw: string): Where {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return { label: W.link, name: raw }
  }
  const host = u.hostname.replace(/^www\./, '')
  const parts = u.pathname.split('/').filter(Boolean)
  /* A malformed escape in somebody's link is that link's problem, not the
     Docs tab's: read as written rather than thrown. */
  const decoded = (s: string) => {
    try {
      return decodeURIComponent(s)
    } catch {
      return s
    }
  }
  const words = (s: string | undefined) =>
    s
      ? decoded(s)
          .replace(/[-_+]+/g, ' ')
          .trim()
      : ''
  if (host === 'docs.google.com') {
    if (parts[0] === 'spreadsheets') return { label: 'Google Sheets', name: 'Google Sheet', brand: 'googleSheets' }
    if (parts[0] === 'presentation') return { label: 'Google Slides', name: 'Google Slides', brand: 'googleSlides' }
    if (parts[0] === 'forms') return { label: 'Google Forms', name: 'Google Form', brand: 'googleForms' }
    return { label: 'Google Docs', name: 'Google Doc', brand: 'googleDocs' }
  }
  if (host === 'drive.google.com') return { label: 'Google Drive', name: 'Google Drive', brand: 'googleDrive' }
  if (host.endsWith('figma.com')) {
    const name = words(parts[2]) || W.figmaFile
    return { label: 'Figma', name, brand: 'figma' }
  }
  if (host === 'github.com') {
    const [owner, repo, what, n] = parts
    const name = repo ? `${owner}/${repo}${(what === 'pull' || what === 'issues') && n ? ` #${n}` : ''}` : owner || 'GitHub'
    return { label: 'GitHub', name, brand: 'github' }
  }
  if (host.endsWith('notion.so') || host.endsWith('notion.site')) {
    const last = words(parts.at(-1))?.replace(/\s[0-9a-f]{32}$/i, '')
    return { label: 'Notion', name: last || W.notionPage, brand: 'notion' }
  }
  if (host.endsWith('linear.app')) return { label: 'Linear', name: words(parts.at(-1)) || 'Linear', brand: 'linear' }
  if (host.endsWith('loom.com')) return { label: 'Loom', name: W.loomVideo, brand: 'loom' }
  if (host === 'youtube.com' || host === 'youtu.be') return { label: 'YouTube', name: W.youtubeVideo, brand: 'youtube' }
  if (host.endsWith('miro.com')) return { label: 'Miro', name: W.miroBoard, brand: 'miro' }
  if (host.endsWith('trello.com')) return { label: 'Trello', name: words(parts.at(-1)) || 'Trello', brand: 'trello' }
  if (host.endsWith('dropbox.com')) return { label: 'Dropbox', name: 'Dropbox', brand: 'dropbox' }
  if (host.endsWith('airtable.com')) return { label: 'Airtable', name: 'Airtable', brand: 'airtable' }
  /* Not the host's first letter: "P" for plausible.example.com is a letter
     nobody knows that place by, and in a grey tile it read as a broken
     picture. A link's glyph says what the row is; the host is under it. */
  return { label: W.link, name: host }
}

/* ------------------------------------------------------------------ rows */

export const KIND_TINT: Record<string, string> = {
  document: 'var(--accent)',
  upload: 'var(--n-6)',
  folder: '#ff9f0a',
}
export const KIND_ICON: Record<string, IconName> = { document: 'doc', upload: 'clip', folder: 'folder' }

function sized(b: string | number | null | undefined): string {
  const n = Number(b ?? 0)
  if (!n) return ''
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} ${BYTES.units[1]}`
  return `${(n / 1024 / 1024).toLocaleString(LOCALE, { minimumFractionDigits: 1, maximumFractionDigits: 1, useGrouping: false })} ${BYTES.units[2]}`
}

export function what(f: DocRow): string {
  if (f.kind === 'folder') return W.folder
  if (f.kind === 'document') return W.document
  if (f.kind === 'link') return f.url ? linkInfo(f.url).label : W.link
  if (isPdf(f)) return ['PDF', sized(f.size_bytes)].filter(Boolean).join(' · ')
  if (isImage(f)) return [W.image, sized(f.size_bytes)].filter(Boolean).join(' · ')
  return [W.file, sized(f.size_bytes)].filter(Boolean).join(' · ')
}

/** Saving a file from its row: the same signed link, asked to be a download. */
async function save(f: DocRow) {
  const { url } = await fileLinks(f.id)
  const a = document.createElement('a')
  a.href = `${url}&download=1&name=${encodeURIComponent(f.name)}`
  a.download = f.name
  document.body.appendChild(a)
  a.click()
  a.remove()
}

export function DocsRows({
  rows,
  grid = false,
  thumbs,
  onOpen,
  onFolder,
  onPin: pinIt,
  onOrigin,
  mayDelete,
  onDelete,
}: {
  rows: DocRow[]
  /** Pictures drawn large, three to a row — the Images kind. */
  grid?: boolean
  /** Every listed picture's signed copy for showing, by id: what a pinned
      document's page draws its first picture from. */
  thumbs?: Map<string, string> | undefined
  /** A document or a file with no viewer of its own: its page. */
  onOpen: (id: string) => void
  onFolder: (id: string) => void
  /** Pin it to the head of the list, or let it go; absent for a reader. */
  onPin?: ((id: string, pinned: boolean) => void) | undefined
  /** Where a file was sent, opened. */
  onOrigin?: ((f: DocRow) => void) | undefined
  /** Whether this row is the reader's to delete, and deleting it.
      A row with neither has no menu. */
  mayDelete?: ((f: DocRow) => boolean) | undefined
  onDelete?: ((f: DocRow) => void) | undefined
}) {
  const pictures = useMemo(() => rows.filter(isImage), [rows])
  const [looking, setLooking] = useState<{ at: number; url: string; quick: string | null } | null>(null)
  const [pdf, setPdf] = useState<{ row: DocRow; url: string } | null>(null)

  async function show(at: number) {
    const f = pictures[at]
    if (!f) return
    /* Paging an open lightbox turns the page at once, on the tile's copy
       already on the screen, and the original comes in over it: waiting
       for its signed link first left the last picture standing after the
       press. */
    if (looking && f.thumb_url) setLooking({ at, url: f.thumb_url, quick: f.thumb_url })
    const links = await fileLinks(f.id).catch(() => null)
    if (links) setLooking((now) => (now && now.at !== at ? now : { at, url: links.url, quick: links.display ?? f.thumb_url ?? null }))
  }

  async function press(f: DocRow) {
    if (f.kind === 'folder') return onFolder(f.id)
    if (f.kind === 'link' && f.url) return void window.open(f.url, '_blank', 'noopener')
    if (isImage(f)) return void show(pictures.indexOf(f))
    if (isPdf(f)) {
      const links = await fileLinks(f.id).catch(() => null)
      if (links) setPdf({ row: f, url: links.url })
      return
    }
    onOpen(f.id)
  }

  /* Only a written document is drawn as a page at the head: it has a page
     to show. A pinned link, upload or picture stays a row, first in the
     list — a page with a link's name and nothing under it was a blank
     sheet standing for an address. */
  const pinned = rows.filter((f) => f.pinned_at && f.kind === 'document')
  const rest = [...rows.filter((f) => f.pinned_at && f.kind !== 'document'), ...rows.filter((f) => !f.pinned_at)]
  const panel = (items: DocRow[]) => (
    <Panel className="shrink-0">
      {items.map((f, i) => {
        const where = f.kind === 'link' && f.url ? linkInfo(f.url) : null
        return (
          <div key={f.id} className="contents">
            {i > 0 && <Hairline inset={68} />}
            {/* The whole row opens it, as a task's row does: it lights end
                  to end under the pointer, and a lit row that answered only
                  a press on its name was a row that "often did not open".
                  Read ahead while the hand is on it, so a document opens on
                  its words. */}
            <div
              data-file
              data-file-id={f.id}
              data-kind={f.kind}
              data-row
              onPointerEnter={() => f.kind === 'document' && nearFile(f.id)}
              onPointerDown={() => f.kind === 'document' && nearFile(f.id)}
              onClick={(e) => {
                if ((e.target as Element).closest('button,a,input,select')) return
                void press(f)
              }}
              className="group flex cursor-pointer items-center gap-3 px-3 py-2"
            >
              {/* The picture itself where there is one; the place's mark
                    for a link; the kind's mark for the rest. */}
              {isImage(f) && f.thumb_url ? (
                <button
                  onClick={() => void press(f)}
                  aria-label={W.open(f.name)}
                  className="relative size-12 shrink-0 overflow-hidden bg-sunken"
                  style={{ borderRadius: 'var(--r-row)' }}
                >
                  <span className="absolute inset-0 flex items-center justify-center text-ink-3">
                    <Icon name="upload" size={18} />
                  </span>
                  <img
                    data-file-thumb
                    src={f.thumb_url}
                    alt=""
                    /* Only the rows on the screen: a long list of pictures
                       decoded at once is what a phone runs out of memory on. */
                    loading="lazy"
                    decoding="async"
                    className="relative size-full object-cover"
                    /* Bytes that are not there — a disk a rebuilt
                         environment wiped — draw the picture's mark rather
                         than the browser's broken frame. */
                    onError={(e) => {
                      e.currentTarget.style.display = 'none'
                    }}
                  />
                </button>
              ) : where?.brand ? (
                /* The place's own icon, in its colours, on nothing — as a
                   file type's icon stands — in the slot a tile has. */
                <span className="flex size-12 shrink-0 items-center justify-center">
                  <BrandIcon brand={where.brand} size={32} />
                </span>
              ) : f.kind === 'document' ? (
                <DocMark icon={f.mark_icon ?? null} tint={f.mark_tint ?? null} size={48} />
              ) : (
                <span
                  className="flex size-12 shrink-0 items-center justify-center text-base font-semibold"
                  style={{
                    background: where ? 'var(--n-6)' : isPdf(f) ? '#e5483f' : (KIND_TINT[f.kind] ?? 'var(--n-6)'),
                    borderRadius: 'var(--r-row)',
                    color: '#fff',
                  }}
                >
                  {where ? <Icon name="link" size={20} /> : isPdf(f) ? 'PDF' : <Icon name={KIND_ICON[f.kind] ?? 'doc'} size={20} />}
                </span>
              )}
              <span className="flex min-w-0 flex-1 flex-col items-start gap-1 text-left">
                <button data-open-file onClick={() => void press(f)} className="w-full truncate text-left text-base text-ink">
                  {f.kind === 'folder' ? `${f.name}/` : f.name}
                  {/* Shared to the web, said where it is listed, so nobody
                        shares one and forgets. */}
                  {f.is_public && (
                    <span data-file-public title={W.shared} className="ml-2 inline-flex translate-y-[2px] text-accent">
                      <Icon name="globe" size={14} />
                    </span>
                  )}
                  {/* Kept from the project — chosen people, or nobody yet:
                        said where it is listed, so its author can tell at a
                        glance what nobody else sees. */}
                  {f.audience === 'chosen' && (
                    <span data-file-chosen title={FILE_DETAIL.chosenPeople} className="ml-2 inline-flex translate-y-[2px] text-ink-3">
                      <Icon name="lock" size={14} />
                    </span>
                  )}
                  {f.audience === 'author' && (
                    <span data-file-draft className="ml-2 text-sm text-ink-3">
                      {FILE_DETAIL.draft}
                    </span>
                  )}
                </button>
                <span className="flex w-full min-w-0 items-center gap-1 text-sm text-ink-2">
                  <span className="shrink-0">
                    {what(f)}
                    {f.author_name && f.kind !== 'folder' ? ` · ${f.author_name}` : ''}
                    {f.template_at ? <span data-file-template>{` · ${DOC_TEMPLATE.template}`}</span> : null}
                  </span>
                  {/* Where it was sent or put, and the way back there — a
                        screenshot is about the conversation it was in. */}
                  {originOf(f) && (
                    <>
                      <span className="shrink-0">{W.in}</span>
                      <button
                        data-file-origin={f.origin_type ?? ''}
                        onClick={() => onOrigin?.(f)}
                        className="min-w-0 truncate text-left underline-offset-2 hover:underline"
                      >
                        {originOf(f)}
                      </button>
                    </>
                  )}
                </span>
              </span>
              {onPin && (
                <button
                  data-testid="file-pin"
                  aria-pressed={Boolean(f.pinned_at)}
                  aria-label={f.pinned_at ? W.unpinName(f.name) : W.pinName(f.name)}
                  title={f.pinned_at ? W.unpin : W.pinToTop}
                  onClick={() => onPin(f.id, !f.pinned_at)}
                  className={`flex size-8 shrink-0 items-center justify-center rounded-full mouse:hover:bg-[var(--hover)] ${
                    f.pinned_at ? '' : 'opacity-0 on-group-hover:opacity-100 focus-visible:opacity-100 max-[1023px]:opacity-100'
                  }`}
                  style={{ color: 'var(--ink-3)' }}
                >
                  <Icon name="pin" size={16} />
                </button>
              )}
              {f.kind === 'upload' && (
                <button
                  data-testid="file-save"
                  aria-label={W.downloadName(f.name)}
                  title={W.download}
                  onClick={() => void save(f)}
                  className="flex size-8 shrink-0 items-center justify-center rounded-full mouse:hover:bg-[var(--hover)] text-ink-2"
                >
                  <Icon name="download" size={16} />
                </button>
              )}
              {/* What else can be done to it, in a menu at the end: one
                  thing now, deleting, and its place kept for the row's
                  next. A row that is not the reader's to delete has none
                  — the slot is still held so the rows line up. */}
              {onDelete && (
                /* The menu and the layer that shuts it are drawn elsewhere
                   in the page and still bubble here in React's tree: a
                   press on either is not a press on the row. */
                <span className="flex size-8 shrink-0 items-center justify-center" onClick={(e) => e.stopPropagation()}>
                  {/* Not on a row still on its way: it is drawn again under
                      its real id when the server answers, and a menu opened
                      on it in between shut under the pointer. */}
                  {!f.id.startsWith('pending:') && (mayDelete?.(f) || f.kind === 'link') && (
                    <Popover
                      shape="bare"
                      width={232}
                      align="right"
                      sheet={false}
                      testId="file-row-menu"
                      said={W.moreFor(f.name)}
                      label={
                        <span className="flex size-8 items-center justify-center rounded-full text-ink-3 opacity-0 mouse:hover:bg-[var(--hover)] on-group-hover:opacity-100 group-focus-within:opacity-100 in-[[aria-expanded=true]]:opacity-100 max-[1023px]:opacity-100">
                          <Icon name="ellipsis" size={16} />
                        </span>
                      }
                    >
                      {(close) => (
                        <div role="menu" data-menu className="py-1">
                          {/* A link's row opens where it lives, so its own
                              screen — its name, its address to change,
                              its comments — is reached from here.
                              `docs/specs/docs.md`, "A link's address". */}
                          {f.kind === 'link' && (
                            <button
                              role="menuitem"
                              data-row
                              data-testid="edit-link-row"
                              onClick={() => {
                                close()
                                onOpen(f.id)
                              }}
                              className="flex w-full items-center gap-3 px-3 text-left text-base text-ink"
                              style={{ height: 'var(--row-h)' }}
                            >
                              <Icon name="link" size={16} />
                              {W.editLink}
                            </button>
                          )}
                          {mayDelete?.(f) && (
                            <button
                              role="menuitem"
                              data-row
                              data-testid="delete-file-row"
                              onClick={() => {
                                close()
                                onDelete(f)
                              }}
                              className="flex w-full items-center gap-3 px-3 text-left text-base text-danger"
                              style={{ height: 'var(--row-h)' }}
                            >
                              <Icon name="trash" size={16} />
                              {f.kind === 'link' ? W.deleteLink : f.kind === 'upload' ? W.deleteFile : W.deleteDocument}
                            </button>
                          )}
                        </div>
                      )}
                    </Popover>
                  )}
                </span>
              )}
              {/* No arrow at the end: the whole row is the door, and a
                    chevron on every one of forty rows is forty marks saying
                    the same nothing. A link keeps its mark — it leaves. */}
              {f.kind === 'link' && <Icon name="link" size={14} className="text-ink-3" />}
            </div>
          </div>
        )
      })}
    </Panel>
  )

  const moving = useRef<HTMLDivElement>(null)
  /* When a pin was last pressed here: only a change of pins that follows
     a press moves anything. A kept copy that was a pin behind the
     server's answer redrew the head with a slide on opening the screen. */
  const pressed = useRef(Number.NEGATIVE_INFINITY)
  const onPin = pinIt
    ? (id: string, to: boolean) => {
        pressed.current = performance.now()
        pinIt(id, to)
      }
    : undefined
  usePinMotion(moving, rows, pressed)

  return (
    <div ref={moving} className="contents">
      {grid ? (
        rows.length > 0 && <PictureGrid rows={rows} onShow={(f) => void show(pictures.indexOf(f))} onPin={onPin} />
      ) : (
        <>
          {pinned.length > 0 && (
            <div className="flex shrink-0 flex-col" data-pinned>
              {/* No "Pinned" over them: a page standing at the head of the
                  list says it was put there, and the word was one more line
                  between the kinds and the work. */}
              <PinnedCards rows={pinned} thumbs={thumbs} onPress={(f) => void press(f)} onPin={onPin} />
            </div>
          )}
          {rest.length > 0 && panel(rest)}
        </>
      )}
      {looking && pictures[looking.at] && (
        /* One lightbox paged through, not one per picture: keyed by the
           picture, each turn of the page opened it again — the dim fading
           in and the picture growing — which is the jerk of paging. */
        <Lightbox
          url={looking.url}
          quick={looking.quick}
          name={pictures[looking.at]!.name}
          counter={pictures.length > 1 ? `${looking.at + 1} / ${pictures.length}` : undefined}
          onPrev={looking.at > 0 ? () => void show(looking.at - 1) : undefined}
          onNext={looking.at < pictures.length - 1 ? () => void show(looking.at + 1) : undefined}
          onClose={() => setLooking(null)}
        />
      )}
      {pdf && <PdfView name={pdf.row.name} url={pdf.url} onClose={() => setPdf(null)} />}
    </div>
  )
}

/* --------------------------------------------------------------- pictures */

/**
 * The Images kind, as pictures rather than rows — `docs/specs/docs.md`,
 * "Pictures, large". Three to a row on a desk, two from 1024 down and on
 * a phone, where three would be tiles a thumb cannot tell apart. Every
 * slot is four by three whatever the picture, filled by it (`cover`): the
 * rows line up, and the room is there before the bytes are, so nothing
 * moves as they land. The name and size come up over the foot of the
 * tile under the pointer, and stay there on a screen with no pointer.
 */
function PictureGrid({
  rows,
  onShow,
  onPin,
}: {
  rows: DocRow[]
  onShow: (f: DocRow) => void
  onPin?: ((id: string, pinned: boolean) => void) | undefined
}) {
  return (
    <div data-picture-grid className="grid shrink-0 grid-cols-3 gap-3 max-[1023px]:grid-cols-2 max-[639px]:gap-2">
      {rows.map((f) => (
        <div
          key={f.id}
          data-file
          data-file-id={f.id}
          data-kind={f.kind}
          className="group relative overflow-hidden bg-sunken"
          style={{ borderRadius: 'var(--r-row)' }}
        >
          <button
            data-open-file
            aria-label={W.open(f.name)}
            onClick={() => onShow(f)}
            className="relative block aspect-[4/3] w-full transition-transform duration-150 ease-out active:scale-[0.98]"
          >
            <span className="absolute inset-0 flex items-center justify-center text-ink-3">
              <Icon name="image" size={24} />
            </span>
            {f.thumb_url && (
              <img
                data-file-thumb
                src={f.thumb_url}
                alt=""
                loading="lazy"
                decoding="async"
                className="absolute inset-0 size-full object-cover"
                onError={(e) => {
                  e.currentTarget.style.display = 'none'
                }}
              />
            )}
            {/* Its name over a shade at the foot, so it reads on any picture. */}
            <span
              className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-start gap-0 px-3 pt-8 pb-2 text-left opacity-0 transition-opacity duration-200 ease-out on-group-hover:opacity-100 group-focus-within:opacity-100 max-[1023px]:opacity-100"
              style={{ background: 'linear-gradient(to top, rgb(0 0 0 / 0.6), transparent)', color: '#fff' }}
            >
              <span className="w-full truncate text-sm font-medium">{f.name}</span>
              <span className="text-xs" style={{ color: 'rgb(255 255 255 / 0.8)' }}>
                {what(f)}
              </span>
            </span>
          </button>
          {/* A hairline drawn over the picture, inside its corners: a dark
              screenshot on the dark page had no edge and ran into the next. */}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{ borderRadius: 'inherit', boxShadow: 'inset 0 0 0 1px rgb(128 128 128 / 0.24)' }}
          />
          <span className="absolute top-2 right-2 flex items-center gap-1">
            {onPin && (
              <button
                data-testid="file-pin"
                aria-pressed={Boolean(f.pinned_at)}
                aria-label={f.pinned_at ? W.unpinName(f.name) : W.pinName(f.name)}
                title={f.pinned_at ? W.unpin : W.pinToTop}
                onClick={() => onPin(f.id, !f.pinned_at)}
                className={`flex size-8 items-center justify-center rounded-full transition-opacity duration-150 ease-out ${
                  f.pinned_at ? '' : 'opacity-0 on-group-hover:opacity-100 focus-visible:opacity-100 max-[1023px]:opacity-100'
                }`}
                style={{ background: 'rgb(0 0 0 / 0.48)', color: f.pinned_at ? 'var(--accent)' : '#fff' }}
              >
                <Icon name="pin" size={16} />
              </button>
            )}
            <button
              data-testid="file-save"
              aria-label={W.downloadName(f.name)}
              title={W.download}
              onClick={() => void save(f)}
              className="flex size-8 items-center justify-center rounded-full opacity-0 transition-opacity duration-150 ease-out on-group-hover:opacity-100 focus-visible:opacity-100 max-[1023px]:opacity-100"
              style={{ background: 'rgb(0 0 0 / 0.48)', color: '#fff' }}
            >
              <Icon name="download" size={16} />
            </button>
          </span>
        </div>
      ))}
    </div>
  )
}

/**
 * A pin moves the thing, rather than making it vanish from one place and
 * appear in another — `docs/specs/docs.md`, "Pinning moves".
 *
 * Every row, page and tile is measured after each drawing. When what is
 * pinned changes, each one that was there before slides from where it was
 * to where it is (the first-last-invert-play of layout motion), and one
 * that is new — a document's page coming to the head — rises in from a
 * little smaller. Unpinning is the same walk back. Only when the pins
 * change: switching a kind or a choice of whose is a press that redraws,
 * and nothing a press like that does is animated.
 */
function usePinMotion(box: React.RefObject<HTMLDivElement | null>, rows: DocRow[], pressed: React.RefObject<number>) {
  const last = useRef<Map<string, { x: number; y: number }>>(new Map())
  const lastPins = useRef<string | null>(null)
  const lastIds = useRef<string>('')
  const pins = rows
    .filter((f) => f.pinned_at)
    .map((f) => f.id)
    .join(',')
  const ids = rows
    .map((f) => f.id)
    .sort()
    .join(',')
  // biome-ignore lint/correctness/useExhaustiveDependencies: measured again only when what is listed or pinned changes; the box is a ref
  useLayoutEffect(() => {
    const root = box.current?.parentElement
    if (!root || !box.current) return
    const origin = root.getBoundingClientRect()
    const now = new Map<string, { el: HTMLElement; x: number; y: number }>()
    for (const el of box.current.querySelectorAll<HTMLElement>('[data-file-id]')) {
      const r = el.getBoundingClientRect()
      now.set(`${el.dataset.fileId}:${el.hasAttribute('data-pinned-card') ? 'page' : 'row'}`, {
        el,
        x: r.left - origin.left,
        y: r.top - origin.top,
      })
    }
    /* Pins changed over the same rows: the press on a pin, or its answer. */
    const moved =
      lastPins.current !== null && lastPins.current !== pins && lastIds.current === ids && performance.now() - pressed.current < 1000
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (moved && !still) {
      const going: Animation[] = []
      for (const [key, { el, x, y }] of now) {
        /* A document pinned leaves its row and comes up as a page: the page
           starts from where the row was. */
        const was = last.current.get(key) ?? last.current.get(key.replace(/:page$/, ':row'))
        const fresh = !last.current.has(key)
        const ease = 'cubic-bezier(0.23, 1, 0.32, 1)'
        if (was) {
          const dx = was.x - x
          const dy = was.y - y
          if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue
          going.push(
            el.animate(
              fresh
                ? [
                    { opacity: 0, transform: `translate(${dx}px, ${dy}px) scale(0.96)` },
                    { opacity: 1, transform: 'none' },
                  ]
                : [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }],
              { duration: 240, easing: ease },
            ),
          )
        } else {
          el.animate(
            [
              { opacity: 0, transform: 'scale(0.96)' },
              { opacity: 1, transform: 'none' },
            ],
            { duration: 220, easing: ease },
          )
        }
      }
    }
    last.current = new Map([...now].map(([k, v]) => [k, { x: v.x, y: v.y }]))
    lastPins.current = pins
    lastIds.current = ids
  }, [pins, ids])
}

/* ----------------------------------------------------------------- pinned */

/**
 * Pinned rows at the head of the list, each drawn as a page —
 * `docs/specs/docs.md`, "A pinned document is a page". No card around it:
 * the page is the thing, a US Letter sheet (17 by 22) as wide as its column,
 * with its mark at the top, its name, and its first lines set small, as a
 * page held at arm's length reads. Two more sheets stand behind it; under
 * the pointer it lifts a little. Under it, only when it last changed.
 * Drawn from the list's own answer — nothing is asked for after the page
 * is on the screen.
 */
function PinnedCards({
  rows,
  thumbs,
  onPress,
  onPin,
}: {
  rows: DocRow[]
  thumbs?: Map<string, string> | undefined
  onPress: (f: DocRow) => void
  onPin?: ((id: string, pinned: boolean) => void) | undefined
}) {
  return (
    /* Columns that share the list's width, so the row of pages starts and
       ends where the list under it does: three across a desktop list, two
       on a phone. A column is never narrower than the 204 a page was drawn
       at; an empty column keeps its place, so one page is not stretched
       across the list. */
    <div className="grid grid-cols-[repeat(auto-fill,minmax(204px,1fr))] gap-6 pt-1 max-[639px]:grid-cols-2">
      {rows.map((f) => (
        <PinnedCard key={f.id} f={f} thumbs={thumbs} onPress={onPress} onPin={onPin} />
      ))}
    </div>
  )
}

function PinnedCard({
  f,
  thumbs,
  onPress,
  onPin,
}: {
  f: DocRow
  thumbs?: Map<string, string> | undefined
  onPress: (f: DocRow) => void
  onPin?: ((id: string, pinned: boolean) => void) | undefined
}) {
  const where = f.kind === 'link' && f.url ? linkInfo(f.url) : null
  const lines = f.preview?.lines ?? []
  const picture = f.preview?.picture ? (thumbs?.get(f.preview.picture) ?? null) : isImage(f) ? (f.thumb_url ?? null) : null
  return (
    <div data-file data-file-id={f.id} data-kind={f.kind} data-pinned-card className="group flex min-w-0 flex-col gap-3">
      {/* The page's room, a US Letter sheet (8½ by 11) as wide as its
          column, so it is its size before anything on it has loaded. */}
      <div
        className="relative w-full shrink-0 cursor-pointer"
        style={{ aspectRatio: '17 / 22' }}
        onPointerEnter={() => f.kind === 'document' && nearFile(f.id)}
        onClick={(e) => {
          if ((e.target as Element).closest('button,a,input,select')) return
          onPress(f)
        }}
      >
        {/* Two sheets under it, standing still. */}
        <span aria-hidden className="paper-under paper-under-1 absolute inset-0" />
        <span aria-hidden className="paper-under paper-under-2 absolute inset-0" />
        <div data-paper className="paper-sheet absolute inset-0 flex flex-col gap-2 overflow-hidden px-4 pt-4 pb-4">
          <span className="flex items-start gap-2">
            {f.kind === 'document' ? (
              <DocMark icon={f.mark_icon ?? null} tint={f.mark_tint ?? null} size={24} />
            ) : where?.brand ? (
              <BrandIcon brand={where.brand} size={24} />
            ) : (
              <span
                className="flex size-6 shrink-0 items-center justify-center text-[8px] font-semibold"
                style={{ background: isPdf(f) ? '#e5483f' : 'var(--n-6)', borderRadius: 8, color: '#fff' }}
              >
                {isPdf(f) ? 'PDF' : <Icon name={where ? 'link' : isImage(f) ? 'image' : 'clip'} size={12} />}
              </span>
            )}
            {onPin && (
              <button
                data-testid="file-pin"
                aria-pressed
                aria-label={W.unpinName(f.name)}
                title={W.unpin}
                onClick={() => onPin(f.id, false)}
                className="-mt-1 -mr-1 ml-auto flex size-8 shrink-0 items-center justify-center rounded-full mouse:hover:bg-[var(--hover)]"
                /* Grey, as the page's other quiet marks: in the accent it
                   was the loudest thing on a page that is mostly words. */
                style={{ color: 'var(--ink-3)' }}
              >
                <Icon name="pin" size={14} />
              </button>
            )}
          </span>
          <button
            data-open-file
            onClick={() => onPress(f)}
            className="line-clamp-3 text-left text-base leading-snug font-semibold text-ink"
            style={{ letterSpacing: 'var(--track-title)' }}
          >
            {f.name}
          </button>
          {picture ? (
            <img
              src={picture}
              alt=""
              decoding="async"
              className="min-h-px w-full flex-1 bg-sunken object-cover"
              style={{ borderRadius: 4 }}
            />
          ) : lines.length > 0 ? (
            /* Whole lines, cut only at the page's foot and faded there, as a
               page runs on past its edge. Every block was a flex item free
               to shrink, so on a narrow screen each was squeezed to a box
               shorter than its lines and cut through the middle of one —
               "Security" with its lower half missing. */
            <span
              className="flex min-h-px flex-1 flex-col gap-1 overflow-hidden text-xs leading-4 text-ink-2"
              style={{
                maskImage: 'linear-gradient(to bottom, #000 72%, transparent)',
                WebkitMaskImage: 'linear-gradient(to bottom, #000 72%, transparent)',
              }}
            >
              {lines.map((l, i) => (
                <span key={i} className={l.h ? 'line-clamp-2 shrink-0 font-semibold text-ink' : 'line-clamp-4 shrink-0'}>
                  {l.t}
                </span>
              ))}
            </span>
          ) : (
            <span className="text-xs text-ink-3">{what(f)}</span>
          )}
        </div>
      </div>
      <span className="truncate px-1 text-sm text-ink-3">{f.updated_at ? W.updated(ago(f.updated_at)) : what(f)}</span>
    </div>
  )
}

/** A PDF over the page, read in the browser's own viewer, with a way to save it. */
function PdfView({ name, url, onClose }: { name: string; url: string; onClose: () => void }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [onClose])
  return createPortal(
    <div
      data-pdf-view
      role="dialog"
      aria-label={name}
      className="fixed inset-0 z-50 flex flex-col bg-dialog-scrim"
      /* Dimmed and a little out of focus, as every window over the work is
         — nothing glass stands on this one. */
      style={{
        backdropFilter: 'blur(var(--scrim-blur))',
        WebkitBackdropFilter: 'blur(var(--scrim-blur))',
      }}
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="flex h-14 shrink-0 items-center gap-3 px-4" style={{ color: '#fff' }}>
        <span className="min-w-px flex-1 truncate text-md font-medium">{name}</span>
        <a
          data-testid="pdf-save"
          href={`${url}&download=1&name=${encodeURIComponent(name)}`}
          download={name}
          className="flex h-8 items-center gap-2 rounded-full px-4 text-base font-medium"
          style={{ background: 'rgb(255 255 255 / 0.14)', color: '#fff' }}
        >
          <Icon name="download" size={16} />
          {W.download}
        </a>
        <button
          aria-label={BAR.close}
          onClick={onClose}
          className="flex size-8 items-center justify-center rounded-full"
          style={{ background: 'rgb(255 255 255 / 0.14)', color: '#fff' }}
        >
          <Icon name="close" size={16} />
        </button>
      </div>
      <iframe
        title={name}
        src={url}
        className="mx-auto mb-4 w-[min(1000px,calc(100vw-32px))] flex-1 rounded-[12px]"
        style={{ background: '#fff' }}
      />
    </div>,
    document.body,
  )
}

/**
 * A link added in a window: the address, and the name it goes by — filled
 * from the address as it is pasted (`linkInfo`), and the person's to change.
 * It was one field for the address alone, named after its host until
 * somebody opened it and renamed it. `docs/specs/docs.md`.
 */
export function LinkDialog({ onClose, onAdd }: { onClose: () => void; onAdd: (url: string, name: string) => Promise<void> | void }) {
  const [url, setUrl] = useState('')
  const [name, setName] = useState('')
  const [named, setNamed] = useState(false)
  const good = /^https?:\/\/\S+\.\S+/i.test(url.trim())
  const go = () => {
    if (!good) return
    const u = url.trim()
    void onAdd(u, name.trim() || linkInfo(u).name)
    onClose()
  }
  const where = good ? linkInfo(url.trim()) : null
  return (
    <Dialog
      title={W.addALink}
      testId="add-link"
      onClose={onClose}
      footer={
        <div className="flex flex-1 items-center justify-end gap-2">
          <button onClick={onClose} className="h-8 px-3 text-base font-medium text-ink-2">
            {W.cancel}
          </button>
          <button
            data-testid="make-link"
            disabled={!good}
            onClick={go}
            className="flex h-8 items-center rounded-full px-4 text-base font-medium disabled:opacity-40 bg-accent text-on-accent"
          >
            {W.add}
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-3 px-4 pt-2 pb-4">
        <label className="flex flex-col gap-1">
          <span className="text-sm text-ink-3">{W.link}</span>
          <input
            {...linkField}
            autoFocus
            data-testid="draft-add-link"
            value={url}
            placeholder="https://…"
            onChange={(e) => {
              const v = e.target.value
              setUrl(v)
              /* The name follows the address until somebody types one. */
              if (!named && /^https?:\/\/\S+\.\S+/i.test(v.trim())) setName(linkInfo(v.trim()).name)
            }}
            onKeyDown={(e) => e.key === 'Enter' && go()}
            className="h-10 rounded-[var(--r-row)] px-3 text-base outline-none bg-sunken text-ink"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-ink-3">{W.name}</span>
          <span className="flex items-center gap-2">
            {where &&
              (where.brand ? (
                <span className="flex size-10 shrink-0 items-center justify-center">
                  <BrandIcon brand={where.brand} size={28} />
                </span>
              ) : (
                <span
                  className="flex size-10 shrink-0 items-center justify-center"
                  style={{ background: 'var(--n-6)', borderRadius: 'var(--r-row)', color: '#fff' }}
                >
                  <Icon name="link" size={18} />
                </span>
              ))}
            <input
              {...notALogin}
              data-testid="draft-link-name"
              value={name}
              placeholder={where ? where.name : W.optional}
              onChange={(e) => {
                setName(e.target.value)
                setNamed(true)
              }}
              onKeyDown={(e) => e.key === 'Enter' && go()}
              className="h-10 min-w-px flex-1 rounded-[var(--r-row)] px-3 text-base outline-none bg-sunken text-ink"
            />
          </span>
        </label>
      </div>
    </Dialog>
  )
}

/** A file on its way into Docs — `docs/specs/docs.md`. */
export type Going = {
  key: string
  name: string
  size: number
  /** How much of it has gone, nought to one. */
  fraction: number
  /** Why it stopped, if it did. */
  failed: string | null
}

/**
 * What is going up, at the head of the list, each with how far it has got.
 *
 * The button used to send the file and say nothing until the list came back
 * with it — a four-megabyte PDF on a slow line was ten seconds of a page that
 * looked as if the press had not been heard. Each file is a row the moment it
 * is chosen, in the place it will stand, with a line that fills as it goes;
 * one that fails says so and can be sent again.
 */
export function GoingRows({
  going,
  onCancel,
  onRetry,
}: {
  going: Going[]
  onCancel: (key: string) => void
  onRetry: (key: string) => void
}) {
  if (going.length === 0) return null
  return (
    <Panel className="shrink-0">
      {going.map((g, i) => (
        <div key={g.key} className="contents">
          {i > 0 && <Hairline inset={68} />}
          <div data-going={g.failed ? 'failed' : 'sending'} className="flex items-center gap-3 px-3 py-2">
            <span
              className="flex size-12 shrink-0 items-center justify-center bg-sunken text-ink-3"
              style={{ borderRadius: 'var(--r-row)' }}
            >
              <Icon name="upload" size={18} />
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-2">
              <span className="truncate text-base text-ink">{g.name}</span>
              {g.failed ? (
                <span className="flex items-center gap-2 text-sm text-danger">
                  {g.failed}
                  <button data-testid="going-retry" onClick={() => onRetry(g.key)} className="font-medium text-accent">
                    {W.tryAgain}
                  </button>
                </span>
              ) : (
                <span className="flex items-center gap-3">
                  {/* A line that fills, and the number beside it: the line
                      for the glance, the number for somebody waiting. */}
                  <span className="h-1 min-w-px flex-1 overflow-hidden rounded-full bg-track">
                    <span
                      data-going-bar
                      className="block h-full rounded-full transition-[width] duration-200 ease-out bg-accent"
                      style={{ width: `${Math.round(g.fraction * 100)}%` }}
                    />
                  </span>
                  <span className="shrink-0 text-sm tabular-nums text-ink-2">
                    {g.fraction >= 1 ? W.finishing : W.sentOf(Math.round(g.fraction * 100), sized(g.size) || `0 ${BYTES.units[1]}`)}
                  </span>
                </span>
              )}
            </span>
            <button
              data-testid="going-cancel"
              aria-label={g.failed ? W.dismiss : W.stopUploading}
              title={g.failed ? W.dismiss : W.stopUploading}
              onClick={() => onCancel(g.key)}
              className="flex size-8 shrink-0 items-center justify-center rounded-full mouse:hover:bg-[var(--hover)] text-ink-3"
            >
              <Icon name="close" size={12} />
            </button>
          </div>
        </div>
      ))}
    </Panel>
  )
}
