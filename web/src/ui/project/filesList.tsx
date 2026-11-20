import { useEffect, useRef } from 'react'
import { MAKE, SAYS } from '../../data/words.js'
import { PROJECT_SAID as W } from '../../words/project.js'
import { api } from '../../data/api.js'
import { LinkDialog, GoingRows, DocsFilters, byRecent, fits, says, whoseFits, DocsRows } from '../Docs.jsx'
import { Toolbar, PageTitle, Popover, Find, EmptyState } from '../kit.jsx'
import { Icon } from '../glyphs.jsx'
import { LABEL } from '../../data/tools.js'
import { type ProjectProps } from '../Project.jsx'
import { type ProjectFrame } from './useProjectFrame.js'
import { type ProjectContent } from './useProjectContent.js'
import { TemplateRows } from './templateRows.jsx'
import { RecentlyDeleted, readBin } from './recentlyDeleted.jsx'

/**
 * Docs: documents, uploads and links.
 */
export function filesList({
  canWrite,
  objectId,
  onNavigate,
  files,
  setFiles,
  kinds,
  answered,
  found,
  findSettled,
  more,
  readMore,
  shown,
  load,
  newDocument,
  doors,
  docsFilter,
  setDocsFilter,
  docsWhose,
  setDocsWhose,
  inBin,
  openBin,
  projectId,
  mayBin,
  meId,
  docsWords,
  setDocsWords,
  linking,
  setLinking,
  picker,
  going,
  dropping,
  setDropping,
  sendUp,
  putUp,
  stopUp,
  addLink,
  mayDelete,
  onDelete,
}: {
  /** Whether a row by this author is the reader's to delete. */
  mayDelete: (authorId: string | undefined) => boolean
  onDelete: (f: { id: string; name: string }) => void
  /** Who is reading: whose rows are theirs. */
  meId: string
  projectId: string
  /** Whether Recently Deleted is offered: somebody who may delete anything here. */
  mayBin: boolean
} & Pick<ProjectProps, 'canWrite' | 'objectId'> &
  Pick<ProjectFrame, 'onNavigate' | 'shown'> &
  Pick<
    ProjectContent,
    | 'load'
    | 'files'
    | 'setFiles'
    | 'kinds'
    | 'answered'
    | 'found'
    | 'findSettled'
    | 'more'
    | 'readMore'
    | 'newDocument'
    | 'doors'
    | 'docsFilter'
    | 'setDocsFilter'
    | 'docsWhose'
    | 'setDocsWhose'
    | 'inBin'
    | 'openBin'
    | 'docsWords'
    | 'setDocsWords'
    | 'linking'
    | 'setLinking'
    | 'picker'
    | 'going'
    | 'dropping'
    | 'setDropping'
    | 'sendUp'
    | 'putUp'
    | 'stopUp'
    | 'addLink'
  >): React.ReactNode {
  if (shown !== 'files' || objectId) return false
  /* Every file, wherever a folder once put it — the folders are gone and
     what was in them is not. Pins first, then what moved last. The rows
     held for this kind and whose, and what the server found for the words
     beyond them; narrowed here too, so a row drawn before the server has
     it lands under its own kind. */
  const held = files ?? []
  const pool = found ? [...held, ...found.filter((f) => !held.some((h) => h.id === f.id))] : held
  const listed = pool.filter((f) => f.kind !== 'folder')
  const ofKind = listed.filter((f) => fits(f, docsFilter))
  const theirs = ofKind.filter((f) => whoseFits(f, docsWhose, meId))
  const rows = theirs.filter((f) => says(f, docsWords)).sort(byRecent)
  /* Whether the project, and this kind, hold anything at all, whoever's —
     the server's answer, or what is on the screen when that is more. */
  const anything = listed.length > 0 || (kinds?.length ?? 0) > 0
  const kindHas = ofKind.length > 0 || (kinds?.includes(docsFilter) ?? false)
  /* Every picture's copy for showing, for a pinned document's page: its
     own, which the page answers beside it, or a row's. */
  const thumbs = new Map(
    listed.flatMap((f) => [
      ...(f.thumb_url ? [[f.id, f.thumb_url] as const] : []),
      ...(f.preview?.picture && f.preview.picture_url ? [[f.preview.picture, f.preview.picture_url] as const] : []),
    ]),
  )
  return (
    shown === 'files' &&
    !objectId && (
      <div
        data-foot
        className="reads flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto"
        /* Files dropped anywhere on Docs go up, as chosen ones do; the
               page says it will take them while they are held over it. */
        data-dropping={dropping || undefined}
        onDragOver={(e) => {
          if (!canWrite || !e.dataTransfer.types.includes('Files')) return
          e.preventDefault()
          setDropping(true)
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropping(false)
        }}
        onDrop={(e) => {
          if (!canWrite || !e.dataTransfer.files.length) return
          e.preventDefault()
          setDropping(false)
          putUp(e.dataTransfer.files)
        }}
      >
        <Toolbar>
          <span className="mr-auto flex min-w-px items-center gap-3">
            <PageTitle>{LABEL.files}</PageTitle>
            {/* One way in for the three things Docs holds — a document,
                    a file, a link — beside its name, as the other tools
                    make theirs. The upload and link pills on the right were
                    two more ways to say "add", and the bar had room for
                    the search and nothing else. `docs/specs/docs.md`. */}
            {canWrite && (
              <Popover
                shape="bare"
                width={264}
                sheet={false}
                testId="docs-add"
                said={W.addToDocs}
                label={
                  <span data-control className="flex size-9 shrink-0 items-center justify-center rounded-full bg-track text-ink-2">
                    <Icon name="plusThin" size={15} />
                  </span>
                }
              >
                {(close) => (
                  <div role="menu" data-menu className="py-1">
                    {(
                      [
                        ['create-new-document', 'doc', MAKE.newDocument, () => void newDocument()],
                        ['upload-file', 'upload', W.uploadFile, () => picker.current?.click()],
                        ['create-add-link', 'link', MAKE.addLink, () => setLinking(true)],
                      ] as const
                    ).map(([testId, icon, said, act]) => (
                      <button
                        key={testId}
                        role="menuitem"
                        data-row
                        data-testid={testId}
                        onClick={() => {
                          close()
                          act()
                        }}
                        className="flex w-full items-center gap-3 px-3 text-left text-base text-ink"
                        style={{ height: 'var(--row-h)' }}
                      >
                        <Icon name={icon} size={16} className="text-ink-2" />
                        {said}
                      </button>
                    ))}
                    {/* Or from a shape. */}
                    <TemplateRows
                      onPick={(template) => {
                        close()
                        void newDocument(template)
                      }}
                    />
                  </div>
                )}
              </Popover>
            )}
          </span>
          <Find value={docsWords} onChange={setDocsWords} label={W.findInDocs} testId="find-docs" />
          {/* Outside the menu, so it is there to be pressed when the menu
                  has already gone. */}
          {canWrite && (
            <input
              ref={picker}
              type="file"
              multiple
              data-testid="upload"
              className="hidden"
              onChange={(e) => {
                putUp(e.target.files)
                e.target.value = ''
              }}
            />
          )}
          {linking && <LinkDialog onClose={() => setLinking(false)} onAdd={(url, name) => addLink(url, name)} />}
        </Toolbar>

        <GoingRows going={going} onCancel={stopUp} onRetry={(key) => void sendUp(key)} />
        {answered && !inBin && going.length === 0 && !anything && (
          <EmptyState art="holder" title={SAYS.nothingHereYet}>
            {canWrite ? W.docsHint : W.docsWait}
          </EmptyState>
        )}

        {/* Not over an empty list: tabs that narrow nothing sat at the
                foot of an empty screen as the only thing on it. */}
        {(anything || inBin) && (
          <DocsFilters
            value={docsFilter}
            onPick={setDocsFilter}
            whose={docsWhose}
            onWhose={setDocsWhose}
            inBin={inBin}
            onBin={mayBin ? openBin : undefined}
            nearBin={mayBin ? () => void readBin(projectId).catch(() => {}) : undefined}
          />
        )}
        {inBin && <RecentlyDeleted projectId={projectId} meId={meId} words={docsWords} onChanged={() => void load()} />}
        {!inBin && docsWords.trim() !== '' && theirs.length > 0 && rows.length === 0 && findSettled && (
          <p data-testid="found-nothing" className="text-base text-ink-3">
            {W.noResults(docsWords.trim())}
          </p>
        )}
        {/* Said once the list has answered: a kind not read yet is not
            a kind with nothing in it. */}
        {!inBin && answered && anything && !kindHas && (
          <p className="text-base text-ink-3">
            {docsFilter === 'docs' ? W.noDocuments : docsFilter === 'images' ? W.noImages : docsFilter === 'links' ? W.noLinks : W.noFiles}
          </p>
        )}
        {!inBin && answered && kindHas && docsWhose !== 'recent' && theirs.length === 0 && (
          <p data-testid="none-whose" className="text-base text-ink-3">
            {docsWhose === 'mine' ? W.noneMine : W.noneShared}
          </p>
        )}
        <DocsRows
          rows={inBin ? [] : rows}
          grid={docsFilter === 'images'}
          thumbs={thumbs}
          onOpen={(id) => onNavigate({ objectId: id })}
          onFolder={() => {}}
          mayDelete={(f) => !f.id.startsWith('pending:') && mayDelete(f.author_id)}
          onDelete={onDelete}
          onOrigin={(f) => {
            if (f.origin_type === 'message' && f.origin_room) return doors?.openRoom?.(f.origin_room)
            if (f.origin_type === 'task' && f.origin_id) return onNavigate({ tool: 'tasks', objectId: f.origin_id })
            if (f.origin_type === 'post' && f.origin_id) return onNavigate({ tool: 'posts', objectId: f.origin_id })
          }}
          onPin={
            canWrite
              ? (id, pinned) => {
                  /* At the head at once; the list is asked again after. */
                  setFiles(
                    (had) =>
                      had &&
                      [...had.map((f) => (f.id === id ? { ...f, pinned_at: pinned ? new Date().toISOString() : null } : f))].sort((a, b) =>
                        (b.pinned_at ?? '').localeCompare(a.pinned_at ?? ''),
                      ),
                  )
                  void api(`/files/${id}/pin`, { method: 'PUT', body: JSON.stringify({ pinned }) })
                    .catch(() => {})
                    .finally(() => void load())
                }
              : undefined
          }
        />
        {/* The rest of a long list, read as its foot comes near — a
            screen and a half ahead, so the rows land below where the
            reader is. No spinner. */}
        {!inBin && more && <ReadsFurther onNear={readMore} />}
      </div>
    )
  )
}

/** An empty line after the last row that asks for the next page as it nears the screen. */
function ReadsFurther({ onNear }: { onNear: () => void }) {
  const at = useRef<HTMLDivElement>(null)
  const near = useRef(onNear)
  near.current = onNear
  useEffect(() => {
    const el = at.current
    if (!el) return
    /* The column that scrolls, so "near" is measured in it. */
    const root = el.closest('[data-foot]')
    const seen = new IntersectionObserver((e) => e.some((x) => x.isIntersecting) && near.current(), {
      root,
      rootMargin: '0px 0px 150% 0px',
    })
    seen.observe(el)
    return () => seen.disconnect()
  }, [])
  /* Each page that lands moves the line down; asked again while it is
     still within reach, so a short page does not leave the list stopped. */
  useEffect(() => {
    const el = at.current
    const root = el?.closest('[data-foot]')
    if (!el || !root) return
    const box = el.getBoundingClientRect()
    const view = root.getBoundingClientRect()
    if (box.top < view.bottom + view.height * 1.5) near.current()
  })
  /* Pulled up by the column's gap, so it takes no room of its own. */
  return <div ref={at} data-reads-further aria-hidden className="-mt-5 h-0 shrink-0" />
}
