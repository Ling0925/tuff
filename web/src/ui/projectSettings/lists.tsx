import { useState, useEffect, Fragment, useRef } from 'react'
import { MORE, PROJECT } from '../../data/words.js'
import { PROJECT_SETTINGS as W } from '../../words/projectSettings.js'
import { api } from '../../data/api.js'
import { type Label, LIST_TINTS, tintOf, RowActions, TINT_SAID, Dot, LIST_MARKS, Dialog, Button, Choice, notALogin } from '../kit.jsx'
import { type List } from '../ProjectSettings.jsx'

/**
 * One list: its name, its mark, and the way to take it away.
 *
 * The six marks stand open on the row rather than behind a press. They were a
 * disclosure — a ring that opened a line of six underneath it — which is a
 * control that hides what it does from the one screen whose whole job is
 * showing what a list is. Six rings on a line is a line, not a menu, and it
 * fits beside the name at this width.
 */
/**
 * A label: its name, its colour, how many tasks carry it, and a way out.
 *
 * Drawn the way a list's row is, because they are the same kind of thing —
 * a word work is filed under — and a second way of drawing it is a second
 * thing to learn.
 */
export function LabelRow({ label, may, onChanged }: { label: Label & { used: number }; may: boolean; onChanged: () => Promise<void> }) {
  const [name, setName] = useState(label.name)
  /* Refused because another label has that name — said, not swallowed. */
  const [clash, setClash] = useState(false)
  /* Taking away a label that tasks carry is asked once, in place. */
  const [asking, setAsking] = useState(false)
  /* Its colours, open only once the dot is pressed — as a list's mark is:
     three labels drew three rails of eleven on every visit. */
  const [tinting, setTinting] = useState(false)
  useEffect(() => setName(label.name), [label.name])

  async function patch(body: Record<string, unknown>) {
    try {
      await api(`/labels/${label.id}`, { method: 'PATCH', body: JSON.stringify(body) })
      setClash(false)
    } catch (e) {
      if ((e as Error).message === '409') {
        setClash(true)
        setName(label.name)
        return
      }
      throw e
    }
    await onChanged()
  }

  async function remove() {
    await api(`/labels/${label.id}`, { method: 'DELETE' })
    setAsking(false)
    await onChanged()
  }

  return (
    <div data-label-row data-said={label.name} className="group flex flex-col gap-2 px-4 py-3">
      <div className="flex items-center gap-3">
        {/* Its colour as a dot before the name, the way a list's mark
            stands before its name — and pressed, it opens the colours, as
            the mark does. A chip here said the name twice. */}
        <button
          type="button"
          data-testid="label-tint-toggle"
          aria-expanded={tinting}
          aria-label={W.changeColourFor(label.name)}
          title={W.changeColour}
          disabled={!may}
          onClick={() => setTinting((v) => !v)}
          className="flex size-7 shrink-0 items-center justify-center rounded-[var(--r-row)] transition-colors mouse:hover:bg-[var(--hover)]"
          style={{ boxShadow: tinting ? '0 0 0 2px var(--accent)' : undefined }}
        >
          <span
            aria-hidden
            className="size-3 rounded-full"
            style={{
              background: label.color ? (LIST_TINTS.find(([id]) => id === label.color)?.[1] ?? tintOf(label.id)) : tintOf(label.id),
            }}
          />
        </button>
        <input
          {...notALogin}
          data-label-name
          aria-label={W.nameOf(label.name)}
          className="min-w-px flex-1 bg-transparent text-base outline-none text-ink"
          style={{ letterSpacing: 'var(--track-body)' }}
          value={name}
          maxLength={40}
          disabled={!may}
          onChange={(e) => {
            setName(e.target.value)
            setClash(false)
          }}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          onBlur={async (e) => {
            const next = e.target.value.trim()
            if (!next || next === label.name) return setName(label.name)
            await patch({ name: next })
          }}
        />
        <span className="shrink-0 text-sm tabular-nums text-ink-3">{W.tasks(label.used)}</span>
        {may && (
          <RowActions>
            {asking ? (
              <span className="flex items-center gap-3">
                <button data-testid="delete-label-yes" onClick={() => void remove()} className="text-sm text-danger">
                  {W.removeFrom(label.used)}
                </button>
                <button onClick={() => setAsking(false)} className="text-sm text-ink-3">
                  {MORE.cancel}
                </button>
              </span>
            ) : (
              <button
                data-testid="delete-label"
                /* Asked only when it is on something: a label on no task
                   goes at once, there being nothing to lose. */
                onClick={() => (label.used > 0 ? setAsking(true) : void remove())}
                className="text-sm text-ink-3"
              >
                {MORE.remove}
              </button>
            )}
          </RowActions>
        )}
      </div>
      {clash && <p className="text-sm text-danger">{W.labelExists}</p>}
      {/* The colour, on the same rail a list's mark has: the first answer
          is the one the id works out, so a colour picked by mistake is not
          a colour for ever. */}
      {tinting && (
        <div
          data-label-tint={label.color ?? 'none'}
          role="radiogroup"
          aria-label={W.colourOf(label.name)}
          className="flex w-fit shrink-0 flex-wrap items-center gap-1 p-1 bg-track"
          style={{ borderRadius: 'var(--r-pill)' }}
        >
          {[['none', tintOf(label.id)] as const, ...LIST_TINTS].map(([id, paint]) => {
            const on = (label.color ?? 'none') === id
            return (
              <Fragment key={id}>
                {id === 'red' && <span aria-hidden className="mx-1 my-2 w-px self-stretch bg-line" />}
                <button
                  type="button"
                  role="radio"
                  data-label-tint-pick={id}
                  aria-label={id === 'none' ? W.default : (TINT_SAID[id] ?? id)}
                  title={id === 'none' ? W.default : (TINT_SAID[id] ?? id)}
                  aria-checked={on}
                  {...(on ? {} : { 'data-control': '' })}
                  disabled={!may}
                  onClick={() => !on && void patch({ color: id === 'none' ? null : id })}
                  className="flex size-7 items-center justify-center"
                  style={{
                    borderRadius: 'var(--r-pill)',
                    background: on ? 'var(--track-on)' : 'transparent',
                    boxShadow: on ? 'var(--control-shadow)' : undefined,
                  }}
                >
                  <span
                    className="size-4 rounded-full"
                    style={{
                      background: paint,
                      opacity: on ? 1 : 0.7,
                      /* The worked-out one is a ring, not a fill: it is not a
                       colour somebody chose, it is the absence of a choice. */
                      ...(id === 'none' ? { background: 'transparent', boxShadow: `inset 0 0 0 2px ${paint}` } : {}),
                    }}
                  />
                </button>
              </Fragment>
            )
          })}
        </div>
      )}
    </div>
  )
}

/**
 * Rows put in another order by their handle.
 *
 * Held by the grip and carried: the row stays where it is and goes quiet,
 * and a line between two rows says where it will land, drawn over them and
 * taking no space, so nothing moves under the pointer while it is being
 * decided — the sidebar's rule. Let go, and it lands; the screen moves first
 * and the server follows. The grip is a button, so a keyboard moves a row
 * with the arrows. One move is one `after`.
 */
export function useReorder(ids: string[], onMove: (id: string, after: string | null) => void) {
  const box = useRef<HTMLDivElement>(null)
  const [held, setHeld] = useState<{ id: string; line: number } | null>(null)
  const land = (id: string, to: number) => {
    const from = ids.indexOf(id)
    if (from < 0 || to === from || to === from + 1) return
    const rest = ids.filter((x) => x !== id)
    const at = to > from ? to - 1 : to
    onMove(id, at === 0 ? null : rest[at - 1]!)
  }
  const grip = (id: string) => ({
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0 || !box.current) return
      e.preventDefault()
      const rows = [...box.current.querySelectorAll<HTMLElement>('[data-reorder]')]
      const rects = rows.map((r) => r.getBoundingClientRect())
      const top = box.current.getBoundingClientRect().top
      const to = (y: number) => {
        const i = rects.findIndex((r) => y < r.top + r.height / 2)
        return i < 0 ? rects.length : i
      }
      const place = (y: number) => {
        const i = to(y)
        setHeld({ id, line: (i < rects.length ? rects[i]!.top : rects[rects.length - 1]!.bottom) - top })
      }
      place(e.clientY)
      const move = (ev: PointerEvent) => place(ev.clientY)
      const up = (ev: PointerEvent) => {
        removeEventListener('pointermove', move)
        setHeld(null)
        land(id, to(ev.clientY))
      }
      addEventListener('pointermove', move)
      addEventListener('pointerup', up, { once: true })
    },
    onKeyDown: (e: React.KeyboardEvent) => {
      const from = ids.indexOf(id)
      if (e.key === 'ArrowUp' && from > 0) {
        e.preventDefault()
        land(id, from - 1)
      }
      if (e.key === 'ArrowDown' && from < ids.length - 1) {
        e.preventDefault()
        land(id, from + 2)
      }
    },
  })
  return { box, held, grip }
}

/* The handle, at the row's left edge, there under the pointer and to the
   keyboard; it takes the row's own padding, so nothing in the row moves. */
export function Grip({ said, held, ...on }: { said: string; held: boolean } & ReturnType<ReturnType<typeof useReorder>['grip']>) {
  return (
    <button
      type="button"
      data-grip
      aria-label={W.move(said)}
      title={W.dragToReorder}
      {...on}
      className="absolute top-3 left-0 flex h-7 w-4 cursor-grab touch-none items-center justify-center opacity-0 transition-opacity on-group-hover:opacity-100 focus-visible:opacity-100 active:cursor-grabbing"
      style={{ color: 'var(--ink-3)', ...(held ? { opacity: 1 } : {}) }}
    >
      <svg width="6" height="10" viewBox="0 0 6 10" aria-hidden>
        {[1, 5, 9].map((y) => (
          <Fragment key={y}>
            <circle cx="1" cy={y} r="1" fill="currentColor" />
            <circle cx="5" cy={y} r="1" fill="currentColor" />
          </Fragment>
        ))}
      </svg>
    </button>
  )
}

/* Where a carried row will land: a line over the rows, taking no space. */
export function DropLine({ at }: { at: number }) {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-x-4 z-10 h-0.5 -translate-y-px rounded-full bg-accent"
      style={{ top: at }}
    />
  )
}

export function ListRow({
  list,
  others,
  may,
  mayDrop,
  onChanged,
}: {
  list: List
  /** The other lists in this project: where its tasks could go instead. */
  others: List[]
  may: boolean
  /** `task.delete`: arranging the lists and removing one are two rights. */
  mayDrop: boolean
  onChanged: () => Promise<void>
}) {
  const [name, setName] = useState(list.name)
  /* Its mark and colour rails, open only once the mark is pressed: four
     lists drew four pairs of rails, forty-odd chips, on every visit. */
  const [marking, setMarking] = useState(false)
  const [asking, setAsking] = useState(false)
  const [into, setInto] = useState<string | null>(null)
  useEffect(() => setName(list.name), [list.name])

  const dest = into ?? others[0]?.id ?? 'nowhere'

  async function patch(body: Record<string, unknown>) {
    await api(`/lists/${list.id}`, { method: 'PATCH', body: JSON.stringify(body) })
    await onChanged()
  }

  async function remove(where: string | null) {
    await api(`/lists/${list.id}${where ? `?into=${where}` : ''}`, { method: 'DELETE' })
    setAsking(false)
    await onChanged()
  }

  return (
    /* The name is on the row as well as in the field. A field's value is not
       text on the page, so without it the only way to say which row this is
       would be to count them. The marks do the same with the one that is on. */
    <div
      data-list-row
      data-list={list.id}
      data-said={list.name}
      /*
       * A name with its two answers under it, rather than a row with the
       * controls crowded onto the end of it.
       *
       * Seventeen chips do not fit beside a field somebody has to be able to
       * type in, and putting the colours on their own line right-aligned
       * left the name alone across a hand's width of nothing with the rails
       * ragged under it. The name is the heading of the row; the marks and
       * the colours are what it is being asked about, and they line up with
       * each other and with the name's left edge.
       */
      className="group flex flex-col gap-2 px-4 py-3"
    >
      <div className="flex items-center gap-3">
        <button
          type="button"
          data-testid="list-mark-toggle"
          aria-expanded={marking}
          aria-label={W.changeIconFor(list.name)}
          title={W.changeIcon}
          disabled={!may}
          onClick={() => setMarking((v) => !v)}
          className="flex size-7 shrink-0 items-center justify-center rounded-[var(--r-row)] transition-colors mouse:hover:bg-[var(--hover)]"
          style={{ boxShadow: marking ? '0 0 0 2px var(--accent)' : undefined }}
        >
          <Dot icon={list.icon} color={list.color} />
        </button>
        <input
          {...notALogin}
          data-list-name
          className="min-w-px flex-1 bg-transparent text-base outline-none text-ink"
          style={{ letterSpacing: 'var(--track-body)' }}
          value={name}
          disabled={!may}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          /* Read from the field, and put the old name back when it is left
             empty: a list with no name is a band with no heading, and the
             server would refuse it anyway. */
          onBlur={async (e) => {
            const next = e.target.value.trim()
            if (!next || next === list.name) return setName(list.name)
            await patch({ name: next })
          }}
        />
        {mayDrop && (
          <RowActions>
            <button
              data-testid="delete-list"
              /* Nothing to ask about an empty one. The dialog exists to find
                 out where the work goes, and with no work there is no
                 question — asking anyway is the confirmation dialog this
                 product does not have. */
              onClick={() => (list.tasks > 0 ? setAsking(true) : void remove(null))}
              className="text-sm text-ink-3"
            >
              {MORE.remove}
            </button>
          </RowActions>
        )}
      </div>

      {marking && (
        <div className="flex flex-wrap items-center gap-2">
          {/* On a rail, the way every other one-of-these on these screens is
            drawn: the chosen one is the raised chip and the rest are the
            ground it sits on. Six chips each with their own background and
            the chosen one white reads back to front on a white panel — the
            one that is on is the one that looks like nothing. */}
          <div
            data-mark={list.icon}
            role="radiogroup"
            aria-label={PROJECT.itsMark}
            className="flex shrink-0 items-center gap-1 p-1 bg-track"
            style={{ borderRadius: 'var(--r-pill)' }}
          >
            {LIST_MARKS.map(([id, said]) => (
              <button
                key={id}
                type="button"
                role="radio"
                data-icon={id}
                aria-label={said}
                title={said}
                aria-checked={list.icon === id}
                {...(list.icon === id ? {} : { 'data-control': '' })}
                disabled={!may}
                onClick={async () => {
                  if (id === list.icon) return
                  /* The mark and the meaning are one answer, the same way they
                   are when the list is made: the Finished ring is what makes
                   a list finish its work. Two controls for it would be two
                   answers to one question, and a list marked Finished that
                   finishes nothing. */
                  await patch({ icon: id, finishes: id === 'done' })
                }}
                className="flex size-7 items-center justify-center transition-opacity"
                style={{
                  borderRadius: 'var(--r-pill)',
                  background: list.icon === id ? 'var(--track-on)' : 'transparent',
                  boxShadow: list.icon === id ? 'var(--control-shadow)' : undefined,
                  /* The five that are not the answer are still legible and no
                   longer shouting: four rows of six lit rings is a screen
                   with twenty-four things on it and one of them true. */
                  opacity: list.icon === id ? 1 : 0.5,
                }}
              >
                <Dot icon={id} color={list.color} />
              </button>
            ))}
          </div>

          {/*
          The colour of that mark, on a rail beside it.

          Eleven and not ten: the first is the answer the list has until
          somebody gives one, and it is a place to come back to. Without it a
          colour chosen by mistake is a colour for ever. A line parts it from
          the ten, because it answers a different question — not "which
          colour" but "shall I choose at all".
        */}
          <div
            data-tint={list.color ?? 'none'}
            role="radiogroup"
            aria-label={PROJECT.itsColour}
            className="flex max-w-full min-w-0 flex-wrap items-center gap-1 p-1 bg-track"
            style={{ borderRadius: 'var(--r-pill)' }}
          >
            {[['none', ''] as const, ...LIST_TINTS].map(([id, paint]) => {
              const on = (list.color ?? 'none') === id
              return (
                <Fragment key={id}>
                  {id === 'red' && <span aria-hidden className="mx-1 my-2 w-px self-stretch bg-line" />}
                  <button
                    type="button"
                    role="radio"
                    data-tint-pick={id}
                    aria-label={id === 'none' ? W.default : (TINT_SAID[id] ?? id)}
                    title={id === 'none' ? W.default : (TINT_SAID[id] ?? id)}
                    aria-checked={on}
                    {...(on ? {} : { 'data-control': '' })}
                    disabled={!may}
                    onClick={async () => {
                      if (on) return
                      await patch({ color: id === 'none' ? null : id })
                    }}
                    className="flex size-7 items-center justify-center"
                    style={{
                      borderRadius: 'var(--r-pill)',
                      background: on ? 'var(--track-on)' : 'transparent',
                      boxShadow: on ? 'var(--control-shadow)' : undefined,
                    }}
                  >
                    {/* The default is drawn as what it does rather than as a
                      colour: the list's own mark, in the colour it works
                      out. A swatch would be a lie — it is not grey, it is
                      "whatever the mark says". */}
                    {id === 'none' ? (
                      <Dot icon={list.icon} />
                    ) : (
                      <span className="size-4 rounded-full" style={{ background: paint, opacity: on ? 1 : 0.7 }} />
                    )}
                  </button>
                </Fragment>
              )
            })}
          </div>
        </div>
      )}
      {/*
        Not "are you sure": where the work goes.

        A list is recoverable until the clear-out, the same as a project, so
        there is nothing here to confirm. What cannot be worked out afterwards
        is which list seven tasks were in, which is why the server refuses to
        take a list that holds anything without being told.
      */}
      {asking && (
        <Dialog
          title={W.removeNamed(list.name)}
          testId="where-tasks-go"
          onClose={() => setAsking(false)}
          footer={
            <>
              <div className="flex-1" />
              <Button tone="danger" data-testid="really-delete-list" onClick={() => void remove(dest)}>
                {MORE.removeTheList}
              </Button>
            </>
          }
        >
          {/* Choice carries the 14px gutter the panels and popovers use and
              the dialog's is 16, so the half-step is made up here rather
              than by giving the control a padding to be configured with. */}
          <div className="flex flex-col gap-1 px-1 pt-1 pb-2">
            <p className="px-4 text-base text-ink-2" style={{ letterSpacing: 'var(--track-body)' }}>
              {W.whereTheyGo(list.tasks)}
            </p>
            <Choice
              said={W.moveTasksTo}
              testId="into"
              value={dest}
              onPick={setInto}
              options={[
                ...others.map((l) => ({ id: l.id, label: l.name })),
                /* The band the tasks screen already draws for work nobody has
                   sorted, so this is a place that exists rather than a way of
                   saying no. */
                { id: 'nowhere', label: W.noList, testId: 'into-nowhere' },
              ]}
            />
          </div>
        </Dialog>
      )}
    </div>
  )
}
export type ListRow = { id: string; name: string; intake?: boolean; finishes?: boolean; icon?: string }
