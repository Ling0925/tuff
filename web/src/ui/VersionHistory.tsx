import { useEffect, useRef, useState } from 'react'
import type { DocVersion, DocVersionRead } from '@tracker/shared-schema'
import { api } from '../data/api.js'
import { recall, remember } from '../data/memory.js'
import { CLOCK, dayMonth } from '../data/words.js'
import { Avatar, Button, Dialog } from './kit.jsx'
import { Doc } from './Doc.jsx'
import { FILE_DETAIL } from '../words/fileDetail.js'
import { VERSION_HISTORY as W } from '../words/versionHistory.js'

/*
 * A document's versions. A window over
 * the document: the versions down the left, the chosen one read-only on
 * the right, and Restore in the foot for whoever may edit.
 */

type Page = { versions: DocVersion[]; next_cursor: string | null }
type Body = DocVersionRead['version']['body']

/* A version never changes once kept, so what it said is held for the session. */
const bodies = new Map<string, Body>()
const reading = new Map<string, Promise<Body>>()

function readBody(fileId: string, versionId: string): Promise<Body> {
  const had = bodies.get(versionId)
  if (had !== undefined) return Promise.resolve(had)
  const going = reading.get(versionId)
  if (going) return going
  const p = api<DocVersionRead>(`/files/${fileId}/versions/${versionId}`)
    .then((r) => {
      bodies.set(versionId, r.version.body)
      return r.version.body
    })
    .finally(() => reading.delete(versionId))
  reading.set(versionId, p)
  return p
}

const listing = new Map<string, Promise<Page>>()

/** The first page, and what the newest says — the window opens on both. */
function readVersions(fileId: string): Promise<Page> {
  const going = listing.get(fileId)
  if (going) return going
  const p = api<Page>(`/files/${fileId}/versions`)
    .then(async (page) => {
      remember<Page>(`versions:${fileId}`, page)
      const first = page.versions[0]
      if (first) await readBody(fileId, first.id).catch(() => {})
      return page
    })
    .finally(() => listing.delete(fileId))
  listing.set(fileId, p)
  return p
}

/** Read ahead, when the menu that offers it opens. */
export function nearVersions(fileId: string): void {
  void readVersions(fileId).catch(() => {})
}

/**
 * Before the window is drawn: what was read ahead, or up to 400 ms for
 * it — a window that opens whole rather than as a frame that fills.
 */
export function readyVersions(fileId: string): Promise<void> {
  if (recall<Page>(`versions:${fileId}`)) return Promise.resolve()
  return Promise.race([readVersions(fileId).then(() => {}), new Promise<void>((r) => setTimeout(r, 400))]).catch(() => {})
}

/** When it was kept, as a person says it: "19 Nov, 14:05". */
function when(iso: string): string {
  const d = new Date(iso)
  return `${dayMonth(d, d.getFullYear() !== new Date().getFullYear())}, ${d.toLocaleTimeString(CLOCK, { hour: 'numeric', minute: '2-digit' })}`
}

export function VersionHistory({
  fileId,
  canWrite,
  onClose,
  onRestored,
}: {
  fileId: string
  /** Whether the reader may edit the document, and so restore — the server decides. */
  canWrite: boolean
  onClose: () => void
  /** Put back: the document's version now. */
  onRestored: (version: number) => void
}) {
  const [page, setPage] = useState<Page | null>(() => recall<Page>(`versions:${fileId}`) ?? null)
  const [failed, setFailed] = useState(false)
  const [chosen, setChosen] = useState<string | null>(() => recall<Page>(`versions:${fileId}`)?.versions[0]?.id ?? null)
  /* What the right side shows: the chosen one's words once they are here,
     and until then the last ones shown, rather than a blank between. */
  const [shown, setShown] = useState<{ id: string; body: Body } | null>(() => {
    const id = recall<Page>(`versions:${fileId}`)?.versions[0]?.id
    const body = id ? bodies.get(id) : undefined
    return id && body !== undefined ? { id, body } : null
  })
  const [restoring, setRestoring] = useState(false)
  const [refused, setRefused] = useState(false)
  const more = useRef(false)

  /* Asked again on every opening, the answer replacing the list in place. */
  useEffect(() => {
    let live = true
    readVersions(fileId)
      .then((p) => {
        if (!live) return
        setPage(p)
        setFailed(false)
        setChosen((c) => (c && p.versions.some((v) => v.id === c) ? c : (p.versions[0]?.id ?? null)))
      })
      .catch(() => live && setFailed(true))
    return () => {
      live = false
    }
  }, [fileId])

  useEffect(() => {
    if (!chosen) return
    let live = true
    const had = bodies.get(chosen)
    if (had !== undefined) {
      setShown({ id: chosen, body: had })
      return
    }
    readBody(fileId, chosen)
      .then((body) => live && setShown({ id: chosen, body }))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [fileId, chosen])

  /* More as the list is scrolled to its foot. */
  function onScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget
    if (!page?.next_cursor || more.current || el.scrollTop + el.clientHeight < el.scrollHeight - 96) return
    more.current = true
    void api<Page>(`/files/${fileId}/versions?cursor=${page.next_cursor}`)
      .then((next) => {
        const all = { versions: [...page.versions, ...next.versions], next_cursor: next.next_cursor }
        remember<Page>(`versions:${fileId}`, all)
        setPage(all)
      })
      .catch(() => {})
      .finally(() => {
        more.current = false
      })
  }

  async function restore() {
    if (!chosen) return
    setRestoring(true)
    setRefused(false)
    try {
      const r = await api<{ ok: boolean; version: number }>(`/files/${fileId}/versions/${chosen}/restore`, { method: 'POST' })
      /* The list read again behind the window, so the next opening has the version this made. */
      nearVersions(fileId)
      onRestored(r.version)
      onClose()
    } catch {
      setRefused(true)
    } finally {
      setRestoring(false)
    }
  }

  const versions = page?.versions ?? []
  const newest = versions[0]?.id ?? null
  const picked = versions.find((v) => v.id === chosen) ?? null
  const body = shown && shown.id === chosen ? shown.body : (shown?.body ?? null)
  const empty = !body || !(body as { content?: unknown[] }).content?.length

  return (
    <Dialog
      title={W.title}
      testId="version-history"
      size="large"
      sheet
      onClose={onClose}
      footer={
        <>
          {refused && (
            <span role="alert" className="min-w-px truncate text-sm text-danger">
              {W.couldNotRestore}
            </span>
          )}
          {canWrite && picked && picked.id !== newest && (
            <span className="ml-auto">
              <Button tone="primary" data-testid="restore-version" disabled={restoring} onClick={() => void restore()}>
                {restoring ? W.restoring : W.restore}
              </Button>
            </span>
          )}
        </>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col sm:flex-row" style={{ borderTop: '1px solid var(--line)' }}>
        <div
          data-testid="version-list"
          role="listbox"
          aria-label={W.title}
          onScroll={onScroll}
          className="flex max-h-[40%] shrink-0 flex-col gap-1 overflow-y-auto border-b border-line p-2 sm:max-h-none sm:w-72 sm:border-r sm:border-b-0"
        >
          {failed && !page && <p className="px-2 py-2 text-sm text-ink-3">{W.couldNotLoad}</p>}
          {page && versions.length === 0 && <p className="px-2 py-2 text-sm text-ink-3">{W.empty}</p>}
          {versions.map((v) => {
            const on = v.id === chosen
            return (
              <button
                key={v.id}
                type="button"
                role="option"
                aria-selected={on}
                data-row
                data-version={v.version}
                data-selected={on || undefined}
                onClick={() => setChosen(v.id)}
                onPointerEnter={() => void readBody(fileId, v.id).catch(() => {})}
                className="flex w-full shrink-0 flex-col gap-1 rounded-[var(--r-row)] px-3 py-2 text-left"
                style={{ background: on ? 'var(--hover)' : undefined, letterSpacing: 'var(--track-body)' }}
              >
                <span className="flex w-full items-baseline gap-2">
                  <span className="min-w-px truncate text-base text-ink">{when(v.created_at)}</span>
                  {v.id === newest && <span className="ml-auto shrink-0 text-sm text-accent">{W.current}</span>}
                </span>
                {v.restored_version !== null && <span className="text-sm text-ink-3">{W.restoredFrom(v.restored_version)}</span>}
                <span className="flex w-full items-center gap-2 text-sm text-ink-2">
                  {v.contributors.length === 0 ? (
                    <span className="text-ink-3">{W.earliest}</span>
                  ) : (
                    <>
                      <span className="flex shrink-0 items-center">
                        {v.contributors.slice(0, 4).map((p, i) => (
                          <span key={p.actor_id} style={{ marginLeft: i ? -4 : 0 }}>
                            <Avatar name={p.name} id={p.actor_id} url={p.avatar_url} size={20} on={on ? 'var(--hover)' : 'var(--chrome)'} />
                          </span>
                        ))}
                      </span>
                      <span className="min-w-px truncate">{v.contributors.map((p) => p.name).join(', ')}</span>
                    </>
                  )}
                </span>
              </button>
            )
          })}
        </div>
        <div data-testid="version-preview" className="min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-6">
          {picked && (
            <p className="mb-4 text-sm text-ink-3">
              {FILE_DETAIL.version(picked.version)} · {when(picked.created_at)}
            </p>
          )}
          {body !== null && (empty ? <p className="text-base text-ink-3">{W.emptyBody}</p> : <Doc body={body} />)}
        </div>
      </div>
    </Dialog>
  )
}
