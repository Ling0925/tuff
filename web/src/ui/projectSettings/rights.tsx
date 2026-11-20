import { useState, useRef, useEffect } from 'react'
import { PROJECT_SETTINGS as W } from '../../words/projectSettings.js'
import { api } from '../../data/api.js'
import { known, ahead } from '../../data/ahead.js'
import { rightsFor, RIGHT_HINT } from '../../data/rights.js'
import { Icon } from '../icons.jsx'
import { SectionHead, Panel, Switch as OnOff } from '../kit.jsx'
import { type Member } from '../ProjectSettings.jsx'

/**
 * The line under a section head that says what the section is for.
 *
 * Its own component because there are six of them and they were six
 * different sizes and colours — 12px here, 13px there, one of them body
 * text. A screen where the explanatory line changes size between sections
 * reads as a screen assembled from other screens.
 */
export function Said({ children }: { children: React.ReactNode }) {
  return (
    <p className="max-w-[560px] px-1 text-base text-ink-3" style={{ letterSpacing: 'var(--track-body)' }}>
      {children}
    </p>
  )
}

/**
 * On or off, as a pill rather than a checkbox.
 *
 * `role="checkbox"` rather than a button with `aria-pressed`: these are
 * independent facts about one thing, not a toolbar of modes, and it is what
 * lets a test ask whether the thing is checked without knowing how it is
 * drawn.
 */
export function Switch({
  on,
  label,
  onChange,
  disabled = false,
  attr,
  testId,
  actor,
  right,
}: {
  on: boolean
  label: string
  onChange: () => void
  disabled?: boolean
  attr?: string
  testId?: string
  actor?: string
  right?: string
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      data-testid={testId}
      data-right={right}
      data-actor={actor}
      {...(attr ? { [attr]: '' } : {})}
      onClick={onChange}
      className="flex h-7 shrink-0 items-center gap-1 pr-3 pl-2 text-base font-medium disabled:opacity-40"
      style={{
        background: on ? 'var(--track-on)' : 'var(--track)',
        boxShadow: on ? 'var(--control-shadow)' : undefined,
        borderRadius: 'var(--r-pill)',
        color: on ? 'var(--ink)' : 'var(--ink-3)',
        letterSpacing: 'var(--track-body)',
      }}
    >
      {/* A tick when it is on, a plus when it is not. The fill alone did
          not say it: on a white page four pills that were all on read as
          four outlines, and which one was off was a guess. The two marks
          are one size, so pressing it never moves the word. */}
      <Icon name={on ? 'check' : 'plus'} size={14} />
      {label}
    </button>
  )
}

/**
 * The permissions one person holds on this project.
 *
 * Not a sort of person — client, then guest, then admin were each a
 * category and each was taken back. What anybody wants to say is "this
 * person may delete tasks here", so that is what is ticked.
 *
 * Not offered against yourself or the owner, and the endpoint refuses both:
 * giving up `manage` takes away the permission needed to take it back.
 */
export function Rights({ who, projectId, onDone }: { who: Member; projectId: string; onDone: () => Promise<void> }) {
  /*
   * One list the switches share, and the presses sent in the order made.
   *
   * Each switch used to work its new list out from the rows the screen had
   * loaded. A second press before the first one's reload came back sent a
   * list without the first change in it, and quietly took that change
   * away again — `manage` ticked, `delete` ticked a moment later, and only
   * `delete` stayed. A loaded machine in the browser tests is what caught
   * it; a person clicking down a row would have met it on a slow day.
   */
  const [rights, setRights] = useState(who.rights)
  const latest = useRef(who.rights)
  const sending = useRef<Promise<unknown>>(Promise.resolve())
  const pending = useRef(0)
  /* The server's list wins whenever nothing of ours is still on its way. */
  useEffect(() => {
    if (pending.current > 0) return
    latest.current = who.rights
    setRights(who.rights)
  }, [who.rights])
  const flip = (right: string) => {
    const was = latest.current
    const next = was.includes(right) ? was.filter((r) => r !== right) : [...was, right]
    /* The switch moves when it is pressed, not when the server and the list
       behind it have both answered. */
    latest.current = next
    setRights(next)
    pending.current += 1
    sending.current = sending.current
      .then(() =>
        api(`/projects/${projectId}/members/${who.actor_id}`, {
          method: 'PATCH',
          body: JSON.stringify({ rights: next }),
        }),
      )
      // Refused: the reload below puts back what the server holds.
      .catch(() => {})
      .finally(() => {
        pending.current -= 1
        if (pending.current === 0) void onDone()
      })
  }
  return (
    <>
      {/* An agent's row offers only what an agent can hold — the rest
          would tick and spring back. `data/rights.ts`. */}
      {rightsFor(who.agent).map(([right, said]) => {
        const on = rights.includes(right)
        return (
          <button
            key={right}
            type="button"
            role="checkbox"
            aria-checked={on}
            aria-label={said}
            data-right={right}
            data-actor={who.actor_id}
            title={RIGHT_HINT[right]}
            onClick={() => flip(right)}
            className="flex h-8 shrink-0 items-center gap-2 rounded-full px-3 text-sm font-medium transition-colors"
            style={{ background: on ? 'var(--accent-soft)' : 'var(--sunken)', color: on ? 'var(--accent)' : 'var(--ink-2)' }}
          >
            {on && <Icon name="check" size={12} />}
            {said}
          </button>
        )
      })}
    </>
  )
}

/**
 * Triage on or off for a project. On, a list at the
 * head of the board where what did not come from the team waits; off, what
 * waits there goes to the first list.
 */
export function TriageSwitch({ projectId, may, onChanged }: { projectId: string; may: boolean; onChanged: () => Promise<void> | void }) {
  const path = `/projects/${projectId}/lists`
  const has = (r: { lists: { intake?: boolean }[] } | null) => (r ? r.lists.some((l) => l.intake) : null)
  const [on, setOn] = useState<boolean | null>(() => has(known(path)))
  /* One at a time: on, off, on pressed quickly were three requests that
     could land in any order. */
  const [busy, setBusy] = useState(false)
  /* A press outranks the read that was already on its way: the switch
     turned off, then the list read before the press landed and put it back
     on — the Triage browser test caught it once read-ahead made that read
     slower to arrive. */
  const pressed = useRef(false)
  // biome-ignore lint/correctness/useExhaustiveDependencies: has is new on every render and reads only the answer
  useEffect(() => {
    void ahead<{ lists: { intake?: boolean }[] }>(path)
      .then((r) => {
        if (!pressed.current) setOn(has(r))
      })
      .catch(() => {})
  }, [path])
  if (on === null) return null
  return (
    <section className="flex flex-col gap-3">
      <SectionHead>{W.triageHead}</SectionHead>
      <Panel>
        <div className="flex min-h-[56px] items-center gap-4 px-4 py-3">
          <span className="flex min-w-px flex-1 flex-col gap-1">
            <span className="text-base text-ink">{W.triageOn}</span>
            <span className="text-sm text-ink-3">{W.triageHint}</span>
          </span>
          <OnOff
            testId="triage-switch"
            said={W.triageOn}
            on={on}
            disabled={!may || busy}
            onChange={async (next) => {
              pressed.current = true
              setOn(next)
              setBusy(true)
              try {
                await api(`/projects/${projectId}/triage`, { method: 'PUT', body: JSON.stringify({ on: next }) }).catch(() => setOn(!next))
                /* The lists read again, so the next visit opens on what
                   the press made rather than on what was there before. */
                await ahead(path, true).catch(() => {})
                await onChanged()
              } finally {
                setBusy(false)
              }
            }}
          />
        </div>
      </Panel>
    </section>
  )
}
