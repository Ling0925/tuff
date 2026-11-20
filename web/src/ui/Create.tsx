import { useRef, useState } from 'react'
import { Icon, type IconName } from './glyphs.jsx'
import { notALogin } from './kit.jsx'

/** Which of the five ways in this is. See `CreateButton`. */
export type Variant = 'accent' | 'plain' | 'round' | 'row' | 'quiet' | 'bare'

/**
 * Making a thing, everywhere it is made.
 *
 * Every tool used to open with a bare text field whose only signal was grey
 * placeholder text on a grey fill. That reads as a search box: people looked
 * for a way to add something and did not find one. A create needs a control
 * that says so before it is used, not a hint that says so once it is.
 *
 * Open it and it becomes the field, in the same place and at the same height,
 * so nothing on the screen moves. Enter adds and **stays open** — tasks
 * arrive in handfuls, and closing after each one turns adding five things
 * into five round trips through the button.
 */
export function Create({
  label,
  placeholder,
  variant = 'accent',
  icon,
  onCreate,
}: {
  label: string
  placeholder?: string
  /** The mark a `round` one wears, where a plus would say the wrong thing —
      a folder, a link. */
  icon?: IconName
  /**
   * Which of the four ways in this is.
   *
   * `accent` is the action on the bar. `plain` is the same shape when it is
   * not the main thing on the screen. `row` is a full-width line at the foot
   * of a panel, and `quiet` is the smallest one, inside a board column.
   */
  variant?: Variant
  onCreate: (text: string) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const field = useRef<HTMLInputElement>(null)

  /*
   * Given the value, never reading it from state.
   *
   * This is the one control that makes everything in the product, and it
   * dropped what was typed. The handler closed over the `draft` of the render
   * it was made in; React batches the update from typing, so pressing Enter
   * in the same movement ran a submit that still saw an empty string, took
   * the `if (!text) return`, and created nothing. No request, no error, and
   * the field cleared itself as though it had worked.
   *
   * Only quick hands hit it, which is why it read as a flaky test rather than
   * as the bug it is: type a folder name, press Enter without pausing, and
   * there is no folder.
   */
  async function submit(value: string) {
    const text = value.trim()
    if (!text) return
    setDraft('')
    await onCreate(text)
    field.current?.focus()
  }

  const id = label.toLowerCase().replace(/\s+/g, '-')

  const input = (
    <input
      {...notALogin}
      ref={field}
      autoFocus
      data-testid={`draft-${id}`}
      className={`bg-transparent outline-none placeholder:text-[var(--ink-3)] ${
        variant === 'accent' || variant === 'plain' || variant === 'round' ? 'w-64 px-3 text-base max-lg:w-44' : 'w-full px-4 text-base'
      }`}
      style={{
        height: variant === 'quiet' || variant === 'row' ? '36px' : 'var(--control-h)',
        color: 'var(--ink)',
        letterSpacing: 'var(--track-body)',
      }}
      placeholder={placeholder ?? label}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') void submit(e.currentTarget.value)
        if (e.key === 'Escape') {
          setDraft('')
          setOpen(false)
        }
      }}
      // Leaving an empty field means the mind was changed; leaving a full one
      // means something else was clicked, and throwing the text away then
      // would be the interface losing work. Read from the field for the same
      // reason `submit` takes its value: state here can be a render behind,
      // and being a render behind means closing on top of what was typed.
      onBlur={(e) => {
        if (!e.target.value.trim()) setOpen(false)
      }}
    />
  )

  /*
   * The quiet way in lives inside a content surface — a board column, an
   * empty list — and content surfaces stay flat. Glass there would be the
   * rule broken in the one place it was written for.
   */
  if (variant === 'quiet' || variant === 'row' || variant === 'bare') {
    return open ? (
      <div className="bg-surface" style={{ borderRadius: 'var(--r-field)' }}>
        {input}
      </div>
    ) : (
      <CreateButton label={label} variant={variant} onClick={() => setOpen(true)} />
    )
  }

  /*
   * The prominent one is a control in the chrome, the same material as the
   * view switcher beside it. Accented while it is the action, plain while it
   * is a field: the surface relaxes when you are typing into it rather than
   * shouting under your own text.
   */
  return open ? (
    <div className="overflow-hidden bg-track" style={{ borderRadius: 'var(--r-pill)' }}>
      {input}
    </div>
  ) : (
    <CreateButton label={label} variant={variant} icon={icon} onClick={() => setOpen(true)} />
  )
}

/**
 * The way in, without what it opens.
 *
 * Four shapes for one action, and they are the same four wherever something
 * is made: `accent` is the action on a tool's bar, `plain` the same shape
 * when it is not the main thing there, `row` a line at the foot of a panel
 * and `quiet` the smallest, inside a board column. Separated from the field
 * because what opens is now either a field or a dialog, and the button
 * should not be written twice to say that.
 */
export function CreateButton({
  label,
  variant = 'accent',
  testId,
  icon,
  onClick,
}: {
  label: string
  variant?: Variant
  icon?: IconName | undefined
  /**
   * Its own name, where the label is not one.
   *
   * A `bare` button is drawn once per band, so the name taken from the label
   * would be the same name four times over — and two controls answering to
   * one name is a test reaching for whichever comes first.
   */
  testId?: string
  onClick: () => void
}) {
  const id = label.toLowerCase().replace(/\s+/g, '-')
  /*
   * The smallest one: the mark alone, on the strip a band is named on.
   *
   * The words are in the strip already — it says which list this is — and a
   * button repeating them there is the heading said twice. What it is stays
   * reachable by anyone who cannot see it, through the label.
   */
  if (variant === 'bare') {
    return (
      <button
        data-control
        data-testid={testId ?? `create-${id}`}
        onClick={onClick}
        aria-label={label}
        title={label}
        className="flex size-6 shrink-0 items-center justify-center text-ink-3"
        style={{ borderRadius: 'var(--r-field)' }}
      >
        {/* An even size in an even box. `plusThin` draws into a 16-unit
            viewBox, so at 15 the glyph is scaled by fifteen sixteenths and
            its strokes land on half pixels — centred by the flex box and
            still visibly left of the faces in the column below it. */}
        <Icon name="plusThin" size={16} />
      </button>
    )
  }
  if (variant === 'quiet' || variant === 'row') {
    return (
      <button
        data-control
        data-testid={testId ?? `create-${id}`}
        onClick={onClick}
        className={`flex w-full items-center gap-3 text-left text-base ${variant === 'row' ? '' : 'py-2 pr-3 pl-4'}`}
        style={{
          borderRadius: variant === 'row' ? undefined : 'var(--r-field)',
          color: variant === 'row' ? 'var(--accent)' : 'var(--ink-2)',
          letterSpacing: 'var(--track-body)',
        }}
      >
        <span className="flex size-5 items-center justify-center">
          <Icon name={variant === 'row' ? 'plusThin' : 'plus'} size={variant === 'row' ? 18 : 16} />
        </span>
        {label}
      </button>
    )
  }
  if (variant === 'round') {
    /*
     * The same action as a disc, for a bar that has no room for two words.
     *
     * Beside the name of the thing being made rather than at the far end of
     * the bar: a plus next to "Tasks" is read without crossing the screen,
     * and the label it loses is one the glyph and the place already say.
     */
    return (
      <button
        data-control
        data-testid={testId ?? `create-${id}`}
        aria-label={label}
        title={label}
        onClick={onClick}
        /* 36, the height of the switcher between them: three controls on
           one row that are 28, 32 and 36 read as three sizes rather than
           one row. */
        className="flex size-9 shrink-0 items-center justify-center bg-track text-ink-2"
        /* The ground the View button has, at the other end of the same row.
           In accent it was the one lit thing on a bar of quiet controls,
           which is a lot of weight for a button whose neighbours are a pair
           of chips and a menu. */
        style={{
          borderRadius: '50%',
        }}
      >
        {icon ? <Icon name={icon} size={16} /> : <Icon name="plusThin" size={15} />}
      </button>
    )
  }

  return (
    <button
      data-control
      data-testid={testId ?? `create-${id}`}
      onClick={onClick}
      className="flex shrink-0 items-center gap-2 pr-4 pl-3 text-base font-medium"
      style={{
        height: 'var(--control-h)',
        borderRadius: 'var(--r-pill)',
        background: variant === 'plain' ? 'var(--hover)' : 'var(--accent)',
        color: variant === 'plain' ? 'var(--ink)' : 'var(--on-accent)',
        letterSpacing: 'var(--track-body)',
      }}
    >
      {/*
        Smaller than the words it sits beside, and no heavier.
        
        A plus at the cap height of the label reads as a second word rather
        than as a mark before one. `plus` draws the same 1.44 stroke as
        `plusThin` into a viewBox nine tenths the size, so at one rendered
        size it comes out two fifths thicker — on an accent ground, where
        white on blue already gains weight, that is a plus shouting over the
        words. The thin one at thirteen is the mark, not a second word.
      */}
      <Icon name="plusThin" size={13} />
      {label}
    </button>
  )
}
