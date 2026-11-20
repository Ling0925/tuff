import { useCallback, useEffect, useState } from 'react'
import { api } from '../../data/api.js'
import { recall, remember } from '../../data/memory.js'
import { DOCS as W } from '../../words/docs.js'
import { ACTIVITY } from '../../words/activity.js'
import { Icon } from '../glyphs.jsx'
import { BrandIcon } from '../brandIcons.jsx'
import { Dialog, DocMark, Hairline, Panel } from '../kit.jsx'
import { type DocRow, KIND_ICON, KIND_TINT, isImage, isPdf, linkInfo, what } from '../Docs.jsx'

/**
 * A project's Recently Deleted.
 * What was deleted here in the last thirty days that this reader
 * may put back, newest deleted first, each saying who deleted it and how
 * long it has left. Restore puts it back at once; Delete forever asks
 * first, naming it, and is the one press here that cannot be taken back.
 */

export type BinRow = DocRow & {
  deleted_at: string
  deleted_by: string | null
  deleted_by_name: string | null
  purge_at: string
  /** The files it holds, which go with it for good. */
  held_files?: number
}
type BinPage = { files: BinRow[]; next_cursor: string | null; kept_days: number }

const key = (projectId: string) => `bin:${projectId}`

/** Read ahead, while the hand is on its door, so the list opens whole. */
export function readBin(projectId: string): Promise<BinPage> {
  return api<BinPage>(`/projects/${projectId}/files/deleted`).then((page) => remember(key(projectId), page))
}

/** Days until the clear-out takes it, counted up: on its last day, one. */
export function daysLeft(purgeAt: string, now = Date.now()): number {
  return Math.max(1, Math.ceil((Date.parse(purgeAt) - now) / 86_400_000))
}

export function RecentlyDeleted({
  projectId,
  meId,
  words,
  onChanged,
}: {
  projectId: string
  meId: string
  /** What the Find field narrows to — the name, as on the other places. */
  words: string
  /** The files list read again: a restored row is back in its kind. */
  onChanged: () => void
}) {
  /* Drawn from what was read last, or ahead, and replaced in place. */
  const [page, setPage] = useState<BinPage | null>(() => recall<BinPage>(key(projectId)))
  const [asking, setAsking] = useState<BinRow | null>(null)

  const reread = useCallback(() => {
    void readBin(projectId)
      .then(setPage)
      .catch(() => {})
  }, [projectId])
  useEffect(reread, [reread])

  const drop = (id: string) => setPage((had) => had && remember(key(projectId), { ...had, files: had.files.filter((f) => f.id !== id) }))

  const restore = (f: BinRow) => {
    drop(f.id)
    void api(`/files/${f.id}/restore`, { method: 'POST' })
      .catch(() => null)
      .finally(() => {
        reread()
        onChanged()
      })
  }

  const purge = (f: BinRow) => {
    drop(f.id)
    /* The request says which file it means, so nothing but this press can
       make it. */
    void api(`/files/${f.id}/forever`, { method: 'DELETE', body: JSON.stringify({ confirm: f.id }) })
      .catch(() => null)
      .finally(reread)
  }

  const more = async () => {
    if (!page?.next_cursor) return
    const next = await api<BinPage>(`/projects/${projectId}/files/deleted?cursor=${encodeURIComponent(page.next_cursor)}`).catch(() => null)
    if (next) setPage((had) => had && { ...next, files: [...had.files, ...next.files] })
  }

  if (!page) return null
  const w = words.trim().toLowerCase()
  const rows = w ? page.files.filter((f) => f.name.toLowerCase().includes(w)) : page.files
  return (
    <div data-bin className="flex shrink-0 flex-col gap-3">
      <p className="px-1 text-sm text-ink-3">{page.files.length > 0 ? W.binHint(page.kept_days) : W.binEmpty(page.kept_days)}</p>
      {rows.length > 0 && (
        <Panel className="shrink-0">
          {rows.map((f, i) => (
            <div key={f.id} className="contents">
              {i > 0 && <Hairline inset={68} />}
              <div data-bin-row data-file data-kind={f.kind} className="flex items-center gap-3 px-3 py-2">
                <Mark f={f} />
                <span className="flex min-w-0 flex-1 flex-col items-start gap-1">
                  <span className="w-full truncate text-base text-ink">{f.name}</span>
                  <span className="w-full truncate text-sm text-ink-2">
                    {what(f)}
                    {' · '}
                    {f.deleted_by === meId ? W.deletedByYou : f.deleted_by_name ? W.deletedBy(f.deleted_by_name) : null}
                    {f.deleted_by === meId || f.deleted_by_name ? ' · ' : null}
                    <span data-days-left className="tabular-nums">
                      {W.daysLeft(daysLeft(f.purge_at))}
                    </span>
                  </span>
                </span>
                <button
                  data-testid="bin-restore"
                  aria-label={W.restoreName(f.name)}
                  title={W.restore}
                  onClick={() => restore(f)}
                  className="flex h-8 shrink-0 items-center gap-2 rounded-full px-3 text-base font-medium text-accent mouse:hover:bg-[var(--hover)]"
                >
                  <Icon name="history" size={16} />
                  <span className="max-[639px]:hidden">{W.restore}</span>
                </button>
                <button
                  data-testid="bin-delete-forever"
                  aria-label={W.deleteForeverName(f.name)}
                  title={W.deleteForever}
                  onClick={() => setAsking(f)}
                  className="flex h-8 shrink-0 items-center gap-2 rounded-full px-3 text-base font-medium text-danger mouse:hover:bg-[var(--hover)]"
                >
                  <Icon name="trash" size={16} />
                  <span className="max-[639px]:hidden">{W.deleteForever}</span>
                </button>
              </div>
            </div>
          ))}
        </Panel>
      )}
      {page.next_cursor && !w && (
        <button onClick={() => void more()} className="self-start px-1 text-base font-medium text-accent">
          {ACTIVITY.showMore}
        </button>
      )}
      {asking && (
        <Dialog
          title={W.deleteForeverAsk(asking.name)}
          testId="purge-file"
          onClose={() => setAsking(null)}
          footer={
            <div className="flex flex-1 items-center justify-end gap-2">
              <button onClick={() => setAsking(null)} className="h-8 px-3 text-base font-medium text-ink-2">
                {W.cancel}
              </button>
              <button
                data-testid="purge-file-confirm"
                onClick={() => {
                  const f = asking
                  setAsking(null)
                  purge(f)
                }}
                className="flex h-8 items-center rounded-full bg-danger px-4 text-base font-medium text-white"
              >
                {W.deleteForever}
              </button>
            </div>
          }
        >
          <p className="px-4 pt-2 pb-4 text-base text-ink-2">
            {W.cannotBeUndone}
            {asking.held_files ? ` ${W.andItsPictures(asking.held_files)}` : ''}
          </p>
        </Dialog>
      )}
    </div>
  )
}

/** The row's mark, as its own list draws it, in a 48-pixel slot. */
function Mark({ f }: { f: BinRow }) {
  const where = f.kind === 'link' && f.url ? linkInfo(f.url) : null
  if (isImage(f) && f.thumb_url)
    return (
      <span className="relative size-12 shrink-0 overflow-hidden bg-sunken" style={{ borderRadius: 'var(--r-row)' }}>
        <img src={f.thumb_url} alt="" loading="lazy" decoding="async" className="size-full object-cover" />
      </span>
    )
  if (where?.brand)
    return (
      <span className="flex size-12 shrink-0 items-center justify-center">
        <BrandIcon brand={where.brand} size={32} />
      </span>
    )
  if (f.kind === 'document') return <DocMark icon={f.mark_icon ?? null} tint={f.mark_tint ?? null} size={48} />
  return (
    <span
      className="flex size-12 shrink-0 items-center justify-center text-base font-semibold"
      style={{
        background: where ? 'var(--n-6)' : isPdf(f) ? '#e5483f' : (KIND_TINT[f.kind] ?? 'var(--n-6)'),
        borderRadius: 'var(--r-row)',
        color: '#fff',
      }}
    >
      {where ? (
        <Icon name="link" size={20} />
      ) : isPdf(f) ? (
        'PDF'
      ) : (
        <Icon name={isImage(f) ? 'image' : (KIND_ICON[f.kind] ?? 'doc')} size={20} />
      )}
    </span>
  )
}
