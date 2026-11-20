import { useCallback, useEffect, useState } from 'react'
import { recall, remember } from '../data/memory.js'
import { HEADS, LOCALE, MAKE, SAYS } from '../data/words.js'
import { PROJECTS_SAID as W } from '../words/projects.js'
import type { ProjectInList } from '@tracker/shared-schema'
import { api, everyPage } from '../data/api.js'
import { NewButton } from './New.jsx'
import { EmptyState, GroupLabel, Hairline, PageTitle, Panel, Popover, useWide } from './kit.jsx'
import { Icon, ProjectMark, markOf } from './icons.jsx'
import { LeaveDialog } from './LeaveProject.jsx'
import { PROJECT_SAID } from '../words/project.js'

/* From the contract — `shared-schema/src/responses.ts`. Three screens each
   kept their own Project, differing only in what they left out. */
type Project = ProjectInList
type Deleted = { id: string; name: string; deleted_at: string }

/** "19 Oct". */
const day = (s: string | null | undefined) => (s ? new Date(s).toLocaleDateString(LOCALE, { day: 'numeric', month: 'short' }) : '')

/* A row's actions, in place of its facts while the pointer is on it: kept
   in the layout but invisible, they pushed the facts away from the edge
   they belong at. */
function Acts({ children }: { children: React.ReactNode }) {
  return <span className="ml-auto hidden shrink-0 items-center gap-1 on-group-hover:flex group-focus-within:flex">{children}</span>
}

/*
 * What is put away — the archive and the bin — read beside each other and
 * kept. They were read one after the other when the screen opened, so the
 * fold under the list grew in two round trips after the list: a few
 * milliseconds on a laptop, a row popping in on the deployment. Read on the
 * door while the pointer is on it now, and the screen waits for it (up to
 * 400 ms) on a first visit.
 */
type PutAway = { archived: Project[]; deleted: Deleted[] }
const PUT_AWAY = 'projects:put-away'
let readingPutAway: Promise<PutAway> | null = null
export function readPutAway(canManage: boolean): Promise<PutAway> {
  readingPutAway ??= Promise.all([
    everyPage<Project>('/projects?archived=true', 'projects') as Promise<{ projects: Project[] }>,
    canManage ? api<{ projects: Deleted[] }>('/projects/deleted') : Promise.resolve({ projects: [] as Deleted[] }),
  ])
    .then(([a, d]) => remember<PutAway>(PUT_AWAY, { archived: a.projects, deleted: d.projects }))
    .finally(() => {
      readingPutAway = null
    })
  return readingPutAway
}

/** How long a project in the bin has before it is cleared out for good. */
function left(deletedAt: string): string {
  const days = 30 - Math.floor((Date.now() - Date.parse(deletedAt)) / 86_400_000)
  if (days <= 0) return W.lessThanADay
  return W.daysLeft(days)
}

/**
 * Every project, including the ones that are out of the way —
 * `docs/specs/projects-index.md`.
 *
 * The sidebar was the only list there was, and a sidebar is a place for the
 * handful you are working in this week — not an index. Archived and deleted
 * projects had nowhere at all: deleting said it was reversible and nothing
 * could reverse it, which is a promise the product was not keeping.
 */
export function Projects({
  projects,
  loaded,
  canManage,
  onOpen,
  onCreate,
  onChanged,
  meId,
  owner,
}: {
  /** Who is looking, for taking themselves off a project. */
  meId: string
  /** The workspace's owner, who still sees a project after leaving it. */
  owner: boolean
  projects: Project[]
  /** Whether the list has arrived. Empty and not-yet-known are different. */
  loaded: boolean
  canManage: boolean
  onOpen: (id: string) => void
  /** Called after one was made, to bring the new list in. */
  onCreate: () => Promise<void>
  onChanged: () => Promise<void>
}) {
  const [archived, setArchived] = useState<Project[]>(() => recall<PutAway>(PUT_AWAY)?.archived ?? [])
  const [deleted, setDeleted] = useState<Deleted[]>(() => recall<PutAway>(PUT_AWAY)?.deleted ?? [])
  /* Whether the fold under the list may be drawn: known, read, or 400 ms. */
  const [whole, setWhole] = useState(() => recall<PutAway>(PUT_AWAY) !== null)
  useEffect(() => {
    if (whole) return
    const t = setTimeout(() => setWhole(true), 400)
    return () => clearTimeout(t)
  }, [whole])
  /* What is put away, folded under one row until it is asked for: the
     archive and the bin are for tidying up, and open they stood longer than
     the list of projects this screen is for. `projects-index.md`. */
  const [shown, setShown] = useState(false)
  const wide = useWide()
  /* The one row whose Delete for good has been pressed once: the second
     press does it, anything else lets it go. `projects-index.md`. */
  const [arming, setArming] = useState<string | null>(null)
  /* The project being left, while its window asks. */
  const [leaving, setLeaving] = useState<Project | null>(null)
  useEffect(() => {
    if (!arming) return
    const t = setTimeout(() => setArming(null), 4000)
    return () => clearTimeout(t)
  }, [arming])

  const load = useCallback(async () => {
    const r = await readPutAway(canManage).finally(() => setWhole(true))
    setArchived(r.archived)
    setDeleted(r.deleted)
  }, [canManage])
  useEffect(() => void load().catch(() => {}), [load])

  /* One act on a row, then both lists asked again — the app's and this
     screen's own. */
  const act =
    (path: string, method: 'POST' | 'DELETE' = 'POST') =>
    async () => {
      await api(path, { method })
      await onChanged()
      await load()
    }

  /* An action on a row, in the lists' own shape — grey, sentence case,
     with the pointer on it. */
  const action = (testId: string, said: React.ReactNode, run: () => Promise<void>, tone?: 'danger') => (
    <button
      data-testid={testId}
      onClick={(e) => {
        e.stopPropagation()
        void run()
      }}
      className="h-7 rounded-full px-2 text-sm transition-colors mouse:hover:bg-[var(--hover)]"
      style={{ color: tone === 'danger' ? 'var(--danger)' : 'var(--ink-3)' }}
    >
      {said}
    </button>
  )

  return (
    <div className="flex h-full flex-col">
      <div data-foot className="min-h-0 flex-1 overflow-y-auto px-[var(--gutter)] pt-5 pb-6">
        <div className="mx-auto flex w-full max-w-[800px] flex-col gap-8">
          {/* The heading over the column it heads, its edges on the list's
              edges — at the sheet's corners the title and the button stood
              a screen apart from the list between them. */}
          <div data-projects-head className="flex items-center gap-3">
            <PageTitle>{HEADS.projects}</PageTitle>
            {/* On a phone there is no title here — it is in the bar — and the
                button stands where the list starts, under the thumb's line
                of reading, not alone at the far edge. */}
            {wide && <span className="flex-1" />}
            {canManage && <NewButton label={MAKE.newProject} what={{ kind: 'project' }} onMade={onCreate} />}
          </div>
          {loaded && projects.length === 0 && (
            <EmptyState
              art="crate"
              title={W.noProjectsYet}
              action={
                canManage ? (
                  <NewButton label={MAKE.newProject} testId="empty-new-project" what={{ kind: 'project' }} onMade={onCreate} />
                ) : undefined
              }
            >
              {W.whatAProjectIs}
            </EmptyState>
          )}

          {whole && projects.length > 0 && (
            <Panel>
              {projects.map((p, i) => (
                <div key={p.id} className="contents">
                  {i > 0 && <Hairline inset={56} />}
                  <div
                    data-row
                    data-project-row
                    role="button"
                    tabIndex={0}
                    onClick={() => onOpen(p.id)}
                    onKeyDown={(e) => e.key === 'Enter' && onOpen(p.id)}
                    className="group flex cursor-pointer items-center gap-3 px-4 text-left"
                    style={{ minHeight: 56 }}
                  >
                    <ProjectMark {...markOf(p)} size={24} />
                    <span className="min-w-px flex-1 truncate text-base font-medium text-ink">{p.name}</span>
                    {/* Only where there is room for them beside the name. On a
                        phone a pointer's actions are never reached by a thumb,
                        and drawn across a 390 row they stood in its middle,
                        under the press that opens it. */}
                    {canManage && wide && (
                      <Acts>
                        {action('archive-row', W.archive, act(`/projects/${p.id}/archive`))}
                        {action('bin-row', W.moveToBin, act(`/projects/${p.id}`, 'DELETE'), 'danger')}
                      </Acts>
                    )}
                    {/*
                      Leaving lives here and nowhere else — behind the row's
                      own ⋯, then the window that says what it does. It was
                      behind the project's name in its column too, a press
                      away from the work and too easy to make by accident.
                      Not among the actions the pointer reveals: those
                      appear under a pointer already on its way to open the
                      row, and on a phone the third of them landed where the
                      thumb opens it.
                    */}
                    {p.can?.includes('project.leave') && (
                      /* The row opens on a press; this press is the menu's. */
                      <span className="flex shrink-0" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                        <Popover
                          shape="bare"
                          width={200}
                          align="right"
                          testId="project-row-menu"
                          said={W.more}
                          label={
                            <span data-control className="flex size-8 items-center justify-center rounded-full text-ink-3">
                              <Icon name="ellipsis" size={16} />
                            </span>
                          }
                        >
                          {(close) => (
                            <div data-menu className="py-1">
                              <button
                                data-row
                                data-testid="leave-project"
                                onClick={() => {
                                  close()
                                  setLeaving(p)
                                }}
                                className="flex w-full items-center gap-3 px-3 text-left text-base text-danger"
                                style={{ height: 'var(--row-h)' }}
                              >
                                <Icon name="close" size={16} />
                                {PROJECT_SAID.leaveProject}
                              </button>
                            </div>
                          )}
                        </Popover>
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </Panel>
          )}

          {whole && (archived.length > 0 || deleted.length > 0) && (
            <button
              type="button"
              data-row
              data-testid="put-away"
              aria-expanded={shown}
              onClick={() => setShown((v) => !v)}
              className="flex h-12 items-center gap-2 px-4 text-left text-base text-ink-2"
              style={{ background: 'var(--panel)', borderRadius: 'var(--r-card)' }}
            >
              <span className="flex min-w-px flex-1 gap-4 truncate">
                {archived.length > 0 && (
                  <span>
                    {HEADS.archived} · {archived.length}
                  </span>
                )}
                {deleted.length > 0 && (
                  <span>
                    {HEADS.bin} · {deleted.length}
                  </span>
                )}
              </span>
              <Icon name="chevR" size={14} className="text-ink-3" style={{ transform: shown ? 'rotate(90deg)' : 'none' }} />
            </button>
          )}

          {shown && archived.length > 0 && (
            <section className="flex flex-col gap-2">
              <GroupLabel>
                {HEADS.archived} · {archived.length}
              </GroupLabel>
              <Panel>
                {archived.map((p, i) => (
                  <div key={p.id} className="contents">
                    {i > 0 && <Hairline inset={56} />}
                    {/* Pressed, it opens as it was — `projects-index.md`. */}
                    <div
                      data-row
                      data-archived-row
                      role="button"
                      tabIndex={0}
                      onClick={() => onOpen(p.id)}
                      onKeyDown={(e) => e.key === 'Enter' && onOpen(p.id)}
                      className="group flex cursor-pointer items-center gap-3 px-4"
                      style={{ minHeight: 48 }}
                    >
                      <span className="flex opacity-60">
                        <ProjectMark {...markOf(p)} size={24} />
                      </span>
                      <span className="min-w-px flex-1 truncate text-base text-ink-2">{p.name}</span>
                      <span className="ml-auto shrink-0 text-sm group-focus-within:hidden on-group-hover:hidden text-ink-3">
                        {p.archived_at ? W.archivedOn(day(p.archived_at)) : ''}
                      </span>
                      {canManage && (
                        <Acts>
                          {action('put-back', W.unarchive, act(`/projects/${p.id}/unarchive`))}
                          {action('bin-archived', W.moveToBin, act(`/projects/${p.id}`, 'DELETE'), 'danger')}
                        </Acts>
                      )}
                    </div>
                  </div>
                ))}
              </Panel>
            </section>
          )}

          {shown && deleted.length > 0 && (
            <section className="flex flex-col gap-2">
              <GroupLabel>
                {HEADS.bin} · {deleted.length}
              </GroupLabel>
              <p className="px-1 text-sm text-ink-3">{SAYS.clearedOutAfterThirty}</p>
              <Panel>
                {deleted.map((p, i) => (
                  <div key={p.id} className="contents">
                    {i > 0 && <Hairline inset={16} />}
                    <div
                      data-deleted-row
                      onMouseLeave={() => arming === p.id && setArming(null)}
                      className="group flex items-center gap-3 px-4"
                      style={{ minHeight: 44 }}
                    >
                      <span className="min-w-px flex-1 truncate text-base text-ink-3">{p.name}</span>
                      <span className="ml-auto shrink-0 text-sm tabular-nums group-focus-within:hidden on-group-hover:hidden text-ink-3">
                        {W.deletedOn(day(p.deleted_at), left(p.deleted_at))}
                      </span>
                      <Acts>
                        {action('restore', W.restore, act(`/projects/${p.id}/restore`))}
                        {/* Twice, because it is the one act here that cannot
                            be taken back. Both words are laid in one cell, so
                            the first press does not move the button under the
                            pointer that has to press it again. */}
                        {action(
                          'delete-forever',
                          <span className="grid">
                            <span style={{ gridArea: '1 / 1', visibility: arming === p.id ? 'hidden' : 'visible' }}>
                              {W.deletePermanently}
                            </span>
                            <span style={{ gridArea: '1 / 1', visibility: arming === p.id ? 'visible' : 'hidden' }}>{W.pressAgain}</span>
                          </span>,
                          async () => {
                            if (arming !== p.id) return setArming(p.id)
                            setArming(null)
                            await act(`/projects/${p.id}/forever`, 'DELETE')()
                          },
                          'danger',
                        )}
                      </Acts>
                    </div>
                  </div>
                ))}
              </Panel>
            </section>
          )}
        </div>
      </div>
      {leaving && (
        <LeaveDialog
          project={leaving}
          meId={meId}
          owner={owner}
          onClose={() => setLeaving(null)}
          onLeft={() => {
            setLeaving(null)
            void onChanged()
          }}
        />
      )}
    </div>
  )
}
