import { useState, useEffect } from 'react'
import { MORE } from '../../data/words.js'
import { TASK_DETAIL as W } from '../../words/taskDetail.js'
import { SAID } from '../../words/said.js'
import { Origin } from '../Origin.jsx'
import { Hairline, Avatar } from '../kit.jsx'
import { recall } from '../../data/memory.js'
import { readHistory } from './model.js'
import { type Event, verbAlone, alsoSaid, day, clock } from '../../data/said.js'
import { SHOWN } from './time.jsx'

/**
 * What was done to this one task, newest first, and whether you are told.
 *
 * The same rows as the project's feed, filtered to this object, and said in
 * the same words — `web/src/data/said.ts` builds the sentence for both,
 * because two screens reading one log must not grow two ways of describing
 * the same event. It does not name the object: every line is about the task
 * at the top of the screen.
 *
 * Read when the panel opens, and not before — a round trip per task opened
 * for a panel nobody is looking at is not worth the 200ms the screen has.
 *
 * Subscribing is here because it is the same question asked forward: this
 * is what happened, and that is whether you hear what happens next. It was
 * "Watch" in the facts column; the inbox tab and the table both call it a
 * subscription, so the button does too. Yours alone — the policy on
 * `subscription` is `actor_id = current_actor()`.
 */
export function HistoryPanel({
  taskId,
  revision,
  onAll,
  subscribed,
  onSubscribe,
  roomy = false,
}: {
  taskId: string
  revision: number
  onAll: () => void
  subscribed: boolean
  onSubscribe: () => void
  /** In a phone's sheet: Subscribe forty tall. */
  roomy?: boolean
}) {
  const [events, setEvents] = useState<Event[]>(() => recall<Event[]>(`history:${taskId}`) ?? [])
  /* Read already when the task's screen waited for it — `readHistory`. */
  const [read, setRead] = useState(() => recall<Event[]>(`history:${taskId}`) !== null)

  // biome-ignore lint/correctness/useExhaustiveDependencies: revision is the trigger: the history is read again when the task changes
  useEffect(() => {
    let alive = true
    const had = recall<Event[]>(`history:${taskId}`)
    setEvents(had ?? [])
    setRead(had !== null)
    void readHistory(taskId)
      .then((events) => {
        if (!alive) return
        setEvents(events)
        setRead(true)
      })
      /* Kept, not cleared: a read that failed is not the same as a task
         nothing has happened to, and blanking the panel says the second. */
      .catch(() => alive && setRead(true))
    return () => {
      alive = false
    }
  }, [taskId, revision])

  return (
    <section className="flex flex-col" data-testid="task-history">
      <div className="flex items-center gap-2 px-4 pt-3 pb-2">
        <span className="flex-1 text-base font-medium text-ink">{MORE.history}</span>
        <button
          data-testid="watch-task"
          aria-pressed={subscribed}
          onClick={onSubscribe}
          className={`inline-flex items-center rounded-full font-medium transition-colors ${
            roomy ? 'h-10 px-4 text-base' : 'h-7 px-3 text-sm'
          }`}
          style={{
            background: subscribed ? 'var(--track-on)' : 'var(--track)',
            boxShadow: subscribed ? 'var(--control-shadow)' : undefined,
            color: subscribed ? 'var(--ink)' : 'var(--accent)',
          }}
        >
          {subscribed ? MORE.subscribed : MORE.subscribe}
        </button>
      </div>
      {read && events.length === 0 && <p className="px-4 pb-3 text-sm text-ink-3">{W.noHistory}</p>}
      {events.slice(0, SHOWN).map((e, i) => (
        <div key={e.id} className="contents">
          {i > 0 && <Hairline inset={14} />}
          <div data-event className="flex gap-3 px-4 py-3 text-sm">
            {/* One line box of this row, so the face sits on the middle of
                the first line and a sentence that wraps hangs below it. */}
            <span className="flex shrink-0 items-center" style={{ height: '1lh' }}>
              <Avatar name={e.actor_name} id={e.actor_id} url={e.actor_avatar_url} size={18} />
            </span>
            <span className="flex min-w-px flex-1 flex-col gap-1">
              <span>
                <span className="text-ink">{e.actor_name}</span> <span className="text-ink-2">{verbAlone(e)}</span>
                {alsoSaid(e) && (
                  <span data-detail className="text-ink-2">
                    {' '}
                    {alsoSaid(e)}
                  </span>
                )}
                {/* A person must be able to tell their own action from one
                    their tool took for them. */}
                <Origin origin={e.origin} authorId={e.actor_id} lead />
              </span>
              {/* When, under what was done: both the day and the hour, since
                  a line from last week has to say when in it. */}
              <span className="text-xs tabular-nums text-ink-3">{SAID.stamp(day(e.at), clock(e.at))}</span>
            </span>
          </div>
        </div>
      ))}
      {/* The rest is the project's feed, where paging already works. */}
      {events.length > SHOWN && (
        <button data-testid="all-activity" onClick={onAll} className="self-start px-4 pt-1 pb-3 text-sm font-medium text-accent">
          {W.seeMoreInActivity}
        </button>
      )}
    </section>
  )
}
