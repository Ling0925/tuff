import { useEffect, useState } from 'react'
import { api } from '../data/api.js'
import { Icon } from './glyphs.jsx'
import { Choice, Hairline, Popover } from './kit.jsx'
import { PeoplePicker, useCandidates, warmCandidates } from './Channels.jsx'
import { CHANNELS } from '../words/channels.js'
import { MORE } from '../data/words.js'
import { FILE_DETAIL as W } from '../words/fileDetail.js'

/** Who a written document is for. */
export type Audience = 'author' | 'chosen' | 'project'

const primary = {
  background: 'var(--accent)',
  borderRadius: 'var(--r-pill)',
  color: 'var(--on-accent)',
} as const

const quiet = {
  background: 'var(--track)',
  color: 'var(--ink-2)',
} as const

/**
 * Who sees a written document, in its head: **Publish** on its author's
 * draft, and once published what it is — everyone on the project, or the
 * people it was shared with — opening the same panel to whoever may change
 * it. The server decides (`file.share`) and says so in `may_share`.
 */
export function DocAccess({
  fileId,
  projectId,
  authorId,
  meId,
  audience,
  readerIds,
  looseFiles = 0,
  mayShare,
  onChange,
  onSaid,
}: {
  fileId: string
  projectId: string
  authorId: string | undefined
  meId: string
  audience: Audience
  readerIds: string[]
  /** Pictures and files its body shows that it does not hold. */
  looseFiles?: number
  mayShare: boolean
  /** Moved before the server answers; called again with what was there if it refuses. */
  onChange: (audience: Audience, readerIds: string[]) => void
  /** A word beside the menu: published, saved, or why not. */
  onSaid: (said: string) => void
}) {
  const draft = audience === 'author'
  /* The project's people read as the document opens, to whoever may
     change who sees it, so the panel is drawn whole the first time —
     on the way to the button is too late for a quick hand. */
  useEffect(() => {
    if (mayShare) void warmCandidates(projectId).catch(() => {})
  }, [mayShare, projectId])
  const face = draft
    ? W.publish
    : audience === 'project'
      ? W.everyoneOnProject
      : readerIds.length
        ? W.sharedWith(readerIds.length)
        : W.onlyYou
  const look = (
    <>
      {!draft && <Icon name={audience === 'project' ? 'people' : 'lock'} size={14} />}
      <span className="truncate">{face}</span>
    </>
  )
  if (!mayShare) {
    /* A draft is its author's alone, so whoever else sees this sees a
       published one: said, and nothing to open. */
    if (draft) return null
    return (
      <span data-doc-access={audience} className="inline-flex h-8 items-center gap-2 rounded-full px-3 text-sm font-medium" style={quiet}>
        {look}
      </span>
    )
  }
  return (
    /* The project's people read ahead on the way to the button, so the
       panel opens with its list rather than growing under the hand. */
    <span
      onPointerEnter={() => void warmCandidates(projectId).catch(() => {})}
      onFocus={() => void warmCandidates(projectId).catch(() => {})}
    >
      <Popover
        shape="bare"
        width={320}
        align="right"
        testId="doc-access"
        said={draft ? W.publish : W.whoCanSee}
        label={
          <span
            data-control
            data-doc-access={audience}
            className="inline-flex h-8 items-center gap-2 rounded-full px-3 text-sm font-medium"
            style={draft ? primary : quiet}
          >
            {look}
          </span>
        }
      >
        {(close) => (
          <AccessPanel
            fileId={fileId}
            projectId={projectId}
            authorId={authorId}
            meId={meId}
            audience={audience}
            readerIds={readerIds}
            looseFiles={looseFiles}
            close={close}
            onChange={onChange}
            onSaid={onSaid}
          />
        )}
      </Popover>
    </span>
  )
}

function AccessPanel({
  fileId,
  projectId,
  authorId,
  meId,
  audience,
  readerIds,
  looseFiles,
  close,
  onChange,
  onSaid,
}: {
  fileId: string
  projectId: string
  authorId: string | undefined
  meId: string
  audience: Audience
  readerIds: string[]
  looseFiles: number
  close: () => void
  onChange: (audience: Audience, readerIds: string[]) => void
  onSaid: (said: string) => void
}) {
  const draft = audience === 'author'
  const [mode, setMode] = useState<'project' | 'chosen'>(audience === 'chosen' ? 'chosen' : 'project')
  const [picked, setPicked] = useState<Set<string>>(() => new Set(readerIds))
  /* The project's people and its agents, but not the author: it is
     theirs, not shared with them. An agent says whose it is under its
     name — choosing one hands the document to whoever holds its token. */
  const people = useCandidates(projectId, true).filter((p) => p.actor_id !== authorId)
  const whose = (p: { agent?: boolean | undefined; connected_by_name?: string | null | undefined }) =>
    p.agent && p.connected_by_name ? W.agentOf(p.connected_by_name) : null
  /* Somebody else narrowing it stays on it, as whoever edits a room stays
     in it — the server keeps them whatever is sent. */
  const locked = meId !== authorId ? meId : undefined

  const save = () => {
    /* Only who the panel lists, so somebody gone from the project — an
       agent left behind when a workspace was put back — cannot make every
       save refused from a box nobody can untick. Until the list has come,
       what was there is sent as it was. */
    const listed = new Set(people.map((p) => p.actor_id))
    const kept = people.length ? [...picked].filter((id) => listed.has(id)) : [...picked]
    const ids = mode === 'chosen' ? [...new Set([...kept, ...(locked ? [locked] : [])])] : []
    const was = { audience, readerIds }
    close()
    onChange(mode, ids)
    void api<{ audience: Audience; reader_ids: string[] }>(`/files/${fileId}/audience`, {
      method: 'PUT',
      body: JSON.stringify(mode === 'chosen' ? { audience: 'chosen', reader_ids: ids } : { audience: 'project' }),
    })
      .then((r) => {
        onChange(r.audience, r.reader_ids)
        onSaid(draft ? W.published : W.accessSaved)
      })
      .catch(() => {
        onChange(was.audience, was.readerIds)
        onSaid(W.couldNotPublish)
      })
  }

  return (
    <div data-testid="doc-access-panel" className="flex flex-col">
      <Choice
        said={W.whoCanSee}
        value={mode}
        onPick={setMode}
        testId="doc-audience"
        options={[
          { id: 'project', label: W.wholeProject, testId: 'audience-project' },
          { id: 'chosen', label: W.chosenPeople, testId: 'audience-chosen' },
        ]}
      />
      {/* Always drawn, so choosing one or the other never changes the
          panel's height. For the whole project it says so: everybody on it
          ticked, the boxes not to be changed; chosen people brings back the
          ones that were picked. */}
      <div data-chosen-people aria-disabled={mode !== 'chosen'}>
        <PeoplePicker
          people={people}
          picked={mode === 'chosen' ? picked : new Set(people.map((p) => p.actor_id))}
          onPick={setPicked}
          everyone={mode === 'chosen' ? CHANNELS.pickedOf(people.length, people.length) : W.everyoneOnProject}
          noneIs={W.onlyYou}
          locked={locked}
          disabled={mode !== 'chosen'}
          second={whose}
        />
      </div>
      {/* What narrowing does not take with it: pictures put in before it was
          private stay the project's. Always in its place once there are
          any, so choosing never moves the panel; quiet unless chosen. */}
      {looseFiles > 0 && (
        <p
          data-loose-pictures
          className="m-0 px-4 pb-3 text-sm text-ink-3 transition-opacity"
          style={{ opacity: mode === 'chosen' ? 1 : 0.4 }}
        >
          {W.loosePictures}
        </p>
      )}
      <Hairline inset={16} />
      <div className="flex items-center gap-3 px-4 py-3">
        {draft && <span className="min-w-px flex-1 text-sm text-ink-3">{W.draftOnlyYou}</span>}
        <button
          type="button"
          data-testid="doc-access-save"
          onClick={save}
          className="ml-auto flex h-8 shrink-0 items-center px-4 text-base font-medium"
          style={primary}
        >
          {draft ? W.publish : MORE.save}
        </button>
      </div>
    </div>
  )
}
