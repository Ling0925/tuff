import { useCallback, useEffect, useState } from 'react'
import { api, unlessOffline } from '../data/api.js'
import { recall, remember } from '../data/memory.js'
import { alsoSaid, clock, day, dayAndClock, verb, whereIn, type Event } from '../data/said.js'
import { LABEL, TOOL_ICON } from '../data/tools.js'
import { Icon } from './glyphs.jsx'
import { Avatar, EmptyState, Find, GroupLabel, Hairline, PageTitle, Panel, Segments, Toolbar } from './kit.jsx'
import { HEADS, MORE, SAYS } from '../data/words.js'
import { ACTIVITY as W } from '../words/activity.js'
import { Origin } from './Origin.jsx'

/**
 * Everything that happened in a project.
 *
 * It was a list at the foot of Announcements, where a handful of things
 * somebody chose to say sat above a list that grows by a line every time
 * anybody touches anything — so the announcement was pushed off the screen by
 * the thing nobody said at all.
 *
 * Not a tool: a project does not *contain* its history the way it contains
 * tasks, it leaves one. So it sits with Settings, after the tools.
 */
export function Activity({
  projectId,
  revision,
  onOpen,
}: {
  projectId: string
  revision: number
  /** Every line names what it happened to, and opens it. */
  onOpen: (tool: string, objectId: string) => void
}) {
  const [events, setEvents] = useState<Event[] | null>(() => recall(`activity:${projectId}`))
  const [cursor, setCursor] = useState<string | null>(null)
  const [more, setMore] = useState(false)
  /* The words the feed is narrowed to — `docs/specs/find.md`. Asked of the
     server, since the feed is paged and what matches may be months back. */
  const [words, setWords] = useState('')
  const asked = words.trim().length >= 2 ? words.trim() : ''
  /* Which tab's lines — the Docs list's tabs, for the same question asked
     of a feed: what happened in Docs? */
  const [only, setOnly] = useState<string>('all')
  const narrowed = `${asked ? `&q=${encodeURIComponent(asked)}` : ''}${only !== 'all' ? `&in=${only}` : ''}`

  const load = useCallback(async () => {
    const r = await api<{ events: Event[]; next_cursor: string | null }>(`/activity?project=${projectId}&limit=50${narrowed}`)
    /* Only the whole feed is kept for next time: a narrowed one is an
       answer to a question nobody will be asking when it opens again. */
    setEvents(narrowed ? (r.events ?? []) : remember(`activity:${projectId}`, r.events ?? []))
    setCursor(r.next_cursor)
  }, [projectId, narrowed])
  // biome-ignore lint/correctness/useExhaustiveDependencies: revision is the trigger: the feed is read again when the project says something changed
  useEffect(() => {
    const wait = setTimeout(() => void load().catch(unlessOffline(() => setEvents([]))), narrowed ? 150 : 0)
    return () => clearTimeout(wait)
  }, [load, revision, narrowed])

  /* On the tool's bar, where the tasks keep their name — TRA-98 — and
     there before the feed is, so the bar does not fill in a beat late. */
  const head = (
    <Toolbar>
      <span className="mr-auto flex min-w-px items-center gap-3">
        <PageTitle>{HEADS.activity}</PageTitle>
      </span>
      <Find value={words} onChange={setWords} label={W.findIn} testId="find-activity" />
    </Toolbar>
  )
  const tabs = (
    <div className="flex min-w-px shrink-0 overflow-x-auto [scrollbar-width:none]" data-testid="activity-filter">
      <Segments
        items={[
          { key: 'all', label: W.all, icon: 'history' as const, attrs: { 'data-activity-in': 'all' } },
          ...(['tasks', 'messages', 'files', 'posts', 'settings'] as const).map((k) => ({
            key: k,
            label: LABEL[k]!,
            icon: TOOL_ICON[k]!,
            attrs: { 'data-activity-in': k },
          })),
        ]}
        value={only}
        onPick={setOnly}
      />
    </div>
  )
  /* The bar and its tabs as one block, the tabs close under the name and
     the first day a step below them — the column's gap alone put the tabs
     as far from their heading as from the list. */
  const headed = (
    <div className="flex shrink-0 flex-col gap-3">
      {head}
      {tabs}
    </div>
  )

  /* Every state in the one frame the list is drawn in — the tabs and the
     head stood somewhere else whenever a tab had nothing in it, and the bar
     jumped across the screen at the press of a tab. */
  if (!events)
    return (
      <div {...{ className: 'reads flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto' }} data-reads-down data-foot>
        {headed}
      </div>
    )
  if (events.length === 0 && asked) {
    return (
      <div className="reads flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto" data-reads-down data-foot>
        {headed}
        <p data-testid="found-nothing" className="text-base text-ink-3">
          {W.noneMatch(asked)}
        </p>
      </div>
    )
  }
  if (events.length === 0 && only !== 'all') {
    return (
      <div className="reads flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto" data-reads-down data-foot>
        {headed}
        <p className="text-base text-ink-3">{W.noneIn(LABEL[only] ?? '')}</p>
      </div>
    )
  }
  if (events.length === 0) {
    return (
      <div className="reads flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto" data-reads-down data-foot>
        {head}
        <EmptyState art="abacus" title={SAYS.nothingHappenedHere}>
          {W.emptyBody}
        </EmptyState>
      </div>
    )
  }

  /* Grouped by day, because "what happened yesterday" is the question people
     actually ask of it. Within a day, the order it happened in. */
  const days: { on: string; of: Event[] }[] = []
  for (const e of events) {
    const on = day(e.at)
    if (days[days.length - 1]?.on !== on) days.push({ on, of: [] })
    days[days.length - 1]!.of.push(e)
  }

  return (
    <div className="reads flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto" data-reads-down data-foot>
      {/* The same heading every tool has: a screen without one is a screen
          that reads as part of the one before it. */}
      {headed}
      {days.map(({ on, of }) => (
        <section key={on} className="flex shrink-0 flex-col gap-3">
          <GroupLabel>{on}</GroupLabel>
          <Panel>
            {of.map((e, i) => (
              <EventRow key={e.id} e={e} first={i === 0} onOpen={onOpen} />
            ))}
          </Panel>
        </section>
      ))}

      {/* Cursor and not a page number, like every other list in the product. */}
      {cursor && (
        <button
          data-testid="more-activity"
          disabled={more}
          onClick={async () => {
            setMore(true)
            try {
              const r = await api<{ events: Event[]; next_cursor: string | null }>(
                `/activity?project=${projectId}&limit=50&cursor=${encodeURIComponent(cursor)}${narrowed}`,
              )
              setEvents((was) =>
                narrowed ? [...(was ?? []), ...r.events] : remember(`activity:${projectId}`, [...(was ?? []), ...r.events]),
              )
              setCursor(r.next_cursor)
            } finally {
              setMore(false)
            }
          }}
          className="mx-auto mb-2 flex h-8 shrink-0 items-center px-3 text-base font-medium text-accent"
          style={{ borderRadius: 'var(--r-pill)' }}
          data-control
        >
          {more ? MORE.loading : W.showMore}
        </button>
      )}
    </div>
  )
}

const TOOL: Record<string, string> = { task: 'tasks', post: 'posts', file: 'files' }

/**
 * One line of the feed — a project's Activity, and an agent's latest on its
 * page: who, what they did, to what, where and
 * when, opening what it happened to.
 */
export function EventRow({
  e,
  first,
  onOpen,
  dated = false,
}: {
  e: Event
  /** The first of its panel, with no line above it. */
  first: boolean
  onOpen: (tool: string, objectId: string) => void
  /** The day beside the hour, where no heading above says it. */
  dated?: boolean
}) {
  const tool = e.object_type ? TOOL[e.object_type] : undefined
  const named = Boolean(tool && e.object_id && e.object_title && !e.action.endsWith('.delete'))
  const place = whereIn(e)
  const room = e.object_type === 'conversation' && Boolean(e.object_id && e.object_title) && e.action !== 'conversation.delete'
  return (
    <div className="contents">
      {!first && <Hairline inset={14} />}
      <div
        data-event
        data-row={named || room ? '' : undefined}
        onClick={
          named || room
            ? (ev) => {
                if ((ev.target as Element).closest('button,a')) return
                if (room) onOpen('messages', e.object_id!)
                else onOpen(tool!, e.object_id!)
              }
            : undefined
        }
        className="flex items-start gap-2 px-4 py-3 text-base"
      >
        {/*
          The face is centred on the first line of the sentence,
          not on the block and not on its baseline.
          
          The row was `items-baseline` with the face pushed down
          four pixels to compensate, which is a number that was
          right for one font size and one avatar: the letter got
          smaller, and the face ended up five and a half pixels
          below the middle of the words beside it.
          
          `1lh` is one line box of this row's own line-height, so
          the face sits in the middle of the first line whatever
          the type does — and a sentence that wraps still hangs
          below it rather than dragging it to the middle of two
          lines, which is what centring the whole row would do.
        */}
        <span className="flex shrink-0 items-center" style={{ height: '1lh' }}>
          <Avatar name={e.actor_name} id={e.actor_id} url={e.actor_avatar_url} size={22} />
        </span>
        <span className="min-w-px flex-1">
          <span className="text-ink">{e.actor_name}</span> <span className="text-ink-2">{verb(e)}</span>{' '}
          {/* A room by its name — the feed sends it only to
              whoever may see the room — and a thing removed by
              the name it had, neither of which opens anything. */}
          {/* A room opens where it is, the project's Chat on it —
              unless it was the line about its removal. */}
          {!named && e.object_title && e.object_type === 'conversation' && e.object_id && e.action !== 'conversation.delete' && (
            <button data-open-event onClick={() => onOpen('messages', e.object_id!)} className="text-left text-ink">
              #{e.object_title}
            </button>
          )}
          {!named && e.object_title && (e.object_type !== 'conversation' || e.action === 'conversation.delete') && (
            <span data-named className="text-ink">
              {e.object_type === 'conversation' ? `#${e.object_title}` : e.object_title}
            </span>
          )}
          {named && (
            <button data-open-event onClick={() => onOpen(tool!, e.object_id!)} className="text-left text-ink">
              {e.object_title}
            </button>
          )}
          {alsoSaid(e) && (
            <span data-detail className="text-ink-2">
              {' '}
              {alsoSaid(e)}
            </span>
          )}
          {/* A person must be able to tell their own action from
              one their tool took for them. */}
          <Origin origin={e.origin} authorId={e.actor_id} lead />
        </span>
        {/* Where it happened, in a column of its own before the
            time: in grey, there for somebody scanning down for
            "what happened in Docs" and out of the sentence's way.
            The glyph alone on a phone. */}
        <span
          data-where={place ?? ''}
          title={place ? LABEL[place] : undefined}
          className="flex shrink-0 items-center gap-2 text-sm sm:w-[136px] text-ink-3"
          style={{ height: '1lh' }}
        >
          {place && (
            <>
              <Icon name={TOOL_ICON[place]!} size={14} />
              <span className="truncate max-sm:hidden">{LABEL[place]}</span>
            </>
          )}
        </span>
        <span className="shrink-0 tabular-nums text-ink-3">{dated ? dayAndClock(e.at) : clock(e.at)}</span>
      </div>
    </div>
  )
}
