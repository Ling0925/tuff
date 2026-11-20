import { useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Icon } from './glyphs.jsx'
import { emojiNow, find, loadEmoji, setSkinTone, skinTone, toned, TONES, type EmojiGroup } from '../data/emoji.js'
import { recent } from '../data/frequent.js'
import { EMOJI as W } from '../words/emoji.js'
import { findField } from './kit.jsx'

/**
 * Every emoji — the composer's and a reaction's. `docs/specs/emoji.md`.
 *
 * It was forty-eight in rows of eight, the ones a team sends about work.
 * Somebody always wanted the forty-ninth, so it is all of Unicode now:
 * found by a word as it is typed, in Unicode's sections behind tabs, the
 * last ones used first, in the skin tone this person chose.
 *
 * Opens whole: a fixed size, the last ones used drawn at once from this
 * machine, and the rest of the list in place when it has been read — which
 * is usually before, because a line to write on asks for it when the page
 * is idle. Only the rows in view are drawn: two thousand buttons made on
 * every open is the jank this is meant not to have.
 */

const COLS = 8
const CELL = 40
const HEAD = 32
/** Seven rows of the grid; less where the screen has less. */
const GRID = 280

const SECTIONS: { id: string; face: string }[] = [
  { id: 'people', face: '😀' },
  { id: 'nature', face: '🐻' },
  { id: 'food', face: '🍔' },
  { id: 'activities', face: '⚽' },
  { id: 'travel', face: '🚗' },
  { id: 'objects', face: '💡' },
  { id: 'symbols', face: '🔣' },
  { id: 'flags', face: '🏳️' },
]
const HANDS = TONES.map((t) => `✋${t}`)

type Item = { e: string; name: string }
type Row = { head: string; section: string } | { items: Item[]; first: number; section: string }

export function EmojiPicker({ onPick, autoFocus = true }: { onPick: (emoji: string) => void; autoFocus?: boolean }) {
  const [groups, setGroups] = useState<EmojiGroup[] | null>(emojiNow)
  useEffect(() => {
    if (groups) return
    let alive = true
    void loadEmoji()
      .then((g) => alive && setGroups(g))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [groups])
  const [q, setQ] = useState('')
  const [tone, setTone] = useState(skinTone)
  const [choosingTone, setChoosingTone] = useState(false)
  /* The one under the pointer or the arrows: named at the foot, and what
     Enter takes. */
  const [active, setActive] = useState(-1)
  const [lastUsed] = useState(() => recent(16))

  /* Every name by the emoji as it is sent, toned or not, for the recent
     row, which keeps only the emoji. */
  const names = useMemo(() => {
    const m = new Map<string, string>()
    for (const g of groups ?? [])
      for (const x of g.e) {
        m.set(x.e, x.name)
        if (x.tone) for (let t = 1; t < TONES.length; t++) m.set(toned(x, t), x.name)
      }
    return m
  }, [groups])

  const asked = q.trim()
  const { rows, flat } = useMemo(() => {
    const rows: Row[] = []
    const flat: Item[] = []
    const put = (section: string, items: Item[]) => {
      for (let i = 0; i < items.length; i += COLS) {
        rows.push({ items: items.slice(i, i + COLS), first: flat.length, section })
        flat.push(...items.slice(i, i + COLS))
      }
    }
    if (asked) {
      put(
        'found',
        find(groups ?? [], asked).map((x) => ({ e: toned(x, tone), name: x.name })),
      )
    } else {
      rows.push({ head: W.recent, section: 'recent' })
      put(
        'recent',
        lastUsed.map((e) => ({ e, name: names.get(e) ?? '' })),
      )
      for (const g of groups ?? []) {
        rows.push({ head: W[g.id as keyof typeof W] as string, section: g.id })
        put(
          g.id,
          g.e.map((x) => ({ e: toned(x, tone), name: x.name })),
        )
      }
    }
    return { rows, flat }
  }, [asked, groups, tone, lastUsed, names])

  const scroller = useRef<HTMLDivElement>(null)
  const list = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: (i) => ('head' in rows[i]! ? HEAD : CELL),
    /* Keyed by what the rows are, so a search's rows are not measured as
       the sections' were at the same place. */
    getItemKey: (i) => `${asked}\u0000${groups ? 1 : 0}\u0000${i}`,
    overscan: 4,
    initialRect: { width: COLS * CELL, height: GRID },
  })
  /* A new question starts at the top, with its best answer ready for Enter. */
  useEffect(() => {
    setActive(asked ? 0 : -1)
    scroller.current?.scrollTo({ top: 0 })
  }, [asked])

  /* Which section is in view, for the tab that is lit. */
  const shown = list.getVirtualItems()
  const top = list.scrollOffset ?? 0
  const first = shown.find((v) => v.end > top + 1)
  const here = asked ? null : first ? rows[first.index]?.section : 'recent'

  /* A tab pressed while searching goes to its section once the sections
     are back. */
  const going = useRef<string | null>(null)
  useEffect(() => {
    const section = going.current
    if (!section || asked) return
    going.current = null
    const at = rows.findIndex((r) => 'head' in r && r.section === section)
    if (at >= 0) list.scrollToIndex(at, { align: 'start' })
  }, [rows, asked, list])

  function go(section: string) {
    if (asked) {
      going.current = section
      setQ('')
      return
    }
    const at = rows.findIndex((r) => 'head' in r && r.section === section)
    if (at >= 0) list.scrollToIndex(at, { align: 'start' })
  }

  function move(by: number) {
    if (flat.length === 0) return
    const next = active < 0 ? 0 : Math.max(0, Math.min(flat.length - 1, active + by))
    setActive(next)
    const row = rows.findIndex((r) => 'items' in r && next >= r.first && next < r.first + r.items.length)
    if (row >= 0) list.scrollToIndex(row, { align: 'auto' })
  }

  const lit = active >= 0 ? flat[active] : undefined

  return (
    <div
      data-emoji-picker
      className="flex w-full flex-col"
      /* The popover's own ceiling, so a short window shrinks the grid
         rather than cutting off the foot. */
      style={{ maxHeight: 'inherit' }}
      onMouseDown={(e) => {
        /* The hand stays in the search, or in the line being written. */
        if (!(e.target instanceof HTMLInputElement)) e.preventDefault()
      }}
    >
      <div className="flex shrink-0 items-center gap-2 px-3 pt-3 pb-2">
        {choosingTone ? (
          <div role="group" aria-label={W.skinTone} className="flex h-8 flex-1 items-center justify-between">
            {HANDS.map((h, i) => (
              <button
                key={h}
                type="button"
                data-tone={i}
                aria-label={W.tones[i]}
                title={W.tones[i]}
                aria-pressed={i === tone}
                onClick={() => {
                  setTone(i)
                  setSkinTone(i)
                  setChoosingTone(false)
                }}
                className="flex size-8 items-center justify-center rounded-[var(--r-row)] text-xl transition-colors mouse:hover:bg-[var(--hover)]"
                style={{ background: i === tone ? 'var(--track-on)' : undefined }}
              >
                {h}
              </button>
            ))}
          </div>
        ) : (
          <>
            <span className="relative flex min-w-px flex-1 items-center">
              <span className="pointer-events-none absolute left-2 flex text-ink-3">
                <Icon name="search" size={16} />
              </span>
              <input
                {...findField}
                autoFocus={autoFocus}
                data-testid="emoji-search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={W.search}
                aria-label={W.search}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') move(active < 0 ? 0 : COLS)
                  else if (e.key === 'ArrowUp') move(-COLS)
                  else if (e.key === 'ArrowRight' && active >= 0) move(1)
                  else if (e.key === 'ArrowLeft' && active >= 0) move(-1)
                  else if (e.key === 'Enter') {
                    if (lit) onPick(lit.e)
                  } else if (e.key === 'Escape' && q) {
                    /* The question first, the picker on the next press. */
                    e.stopPropagation()
                    e.nativeEvent.stopImmediatePropagation()
                    setQ('')
                  } else return
                  e.preventDefault()
                }}
                className="h-8 w-full rounded-[var(--r-row)] pr-2 pl-8 text-base outline-none placeholder:text-[var(--ink-3)] bg-track"
                style={{ color: 'var(--ink)' }}
              />
            </span>
            <button
              type="button"
              data-testid="emoji-tone"
              aria-label={W.skinTone}
              title={W.skinTone}
              onClick={() => setChoosingTone(true)}
              className="flex size-8 shrink-0 items-center justify-center rounded-[var(--r-row)] text-xl transition-colors mouse:hover:bg-[var(--hover)]"
            >
              {HANDS[tone]}
            </button>
          </>
        )}
      </div>

      {/* The sections, a press away. */}
      <div className="flex shrink-0 items-center justify-between border-b px-3 pb-1" style={{ borderColor: 'var(--line)' }}>
        <Tab label={W.recent} on={here === 'recent'} onPress={() => go('recent')}>
          <Icon name="clock" size={16} />
        </Tab>
        {SECTIONS.map((s) => (
          <Tab
            key={s.id}
            label={W[s.id as keyof typeof W] as string}
            on={here === s.id}
            disabled={!groups}
            onPress={() => go(s.id)}
            section={s.id}
          >
            <span className="text-lg">{s.face}</span>
          </Tab>
        ))}
      </div>

      <div
        ref={scroller}
        data-emoji-grid
        className="relative min-h-0 w-full overflow-y-auto overscroll-contain"
        style={{ height: GRID, flexShrink: 1 }}
      >
        {asked && groups && flat.length === 0 && (
          <p className="absolute inset-x-0 top-0 px-4 py-3 text-sm text-ink-3">{W.noneFound(asked)}</p>
        )}
        <div className="relative mx-auto" style={{ height: list.getTotalSize(), width: COLS * CELL }}>
          {shown.map((v) => {
            const row = rows[v.index]!
            return (
              <div key={v.key} className="absolute left-0 flex w-full" style={{ top: v.start, height: v.size }}>
                {'head' in row ? (
                  <span data-emoji-section={row.section} className="flex items-end pb-1 text-xs font-medium text-ink-3">
                    {row.head}
                  </span>
                ) : (
                  row.items.map((x, i) => (
                    <button
                      key={x.e}
                      type="button"
                      data-emoji={x.e}
                      aria-label={x.name || x.e}
                      title={x.name || undefined}
                      onMouseEnter={() => setActive(row.first + i)}
                      onClick={() => onPick(x.e)}
                      className="flex shrink-0 items-center justify-center rounded-[var(--r-row)] text-title leading-none"
                      style={{ width: CELL, height: CELL, background: active === row.first + i ? 'var(--hover)' : undefined }}
                    >
                      {x.e}
                    </button>
                  ))
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* What is under the hand, by name. Always the same height, so
          nothing moves as the pointer crosses the grid. */}
      <div data-emoji-name className="flex h-12 shrink-0 items-center gap-2 border-t px-4" style={{ borderColor: 'var(--line)' }}>
        {lit ? (
          <>
            <span className="text-title leading-none">{lit.e}</span>
            <span className="truncate text-sm text-ink-2">{lit.name}</span>
          </>
        ) : (
          <span className="text-sm text-ink-3">{W.pickOne}</span>
        )}
      </div>
    </div>
  )
}

function Tab({
  label,
  on,
  disabled,
  section,
  onPress,
  children,
}: {
  label: string
  on: boolean
  disabled?: boolean
  section?: string
  onPress: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-current={on || undefined}
      data-emoji-tab={section ?? 'recent'}
      disabled={disabled}
      onClick={onPress}
      className="flex size-8 items-center justify-center rounded-[var(--r-row)] transition-[background-color,filter,opacity] mouse:hover:bg-[var(--hover)]"
      style={{
        color: on ? 'var(--ink)' : 'var(--ink-3)',
        background: on ? 'var(--track-on)' : undefined,
        /* The faces in grey until their section is the one in view. */
        filter: on ? undefined : 'grayscale(1)',
        opacity: disabled ? 0.4 : on ? 1 : 0.72,
      }}
    >
      {children}
    </button>
  )
}
