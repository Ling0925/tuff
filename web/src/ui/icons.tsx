import { useEffect, useState } from 'react'
import { Icon, type IconName } from './glyphs.jsx'

export { Icon, type IconName }

/**
 * Which of the ten tints a thing gets, from its id.
 *
 * From the id and not the name, so two projects whose names start the same
 * are still told apart, and so renaming one does not change its colour. The
 * tints themselves are in the theme and turn over with it.
 */
export function tint(id: string): string {
  let hash = 0
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) % 100_000
  return `var(--tint-${hash % 10})`
}

/** The same tint, walked until it reads on a wash of itself — `theme.css`. */
export function inkOf(id: string): string {
  let hash = 0
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) % 100_000
  return `var(--tint-${hash % 10}-ink)`
}

/** The eight glyphs the id can land on. What a person may choose from is
    wider and lives in `shared-schema`. */
const MARKS: IconName[] = ['globe', 'rocket', 'briefcase', 'code', 'palette', 'chart', 'target', 'bolt']

/**
 * What the id alone says a project looks like.
 *
 * The answer each rail comes back to: the first cell on both is "what the id
 * gives", drawn as the thing it does rather than as a swatch, which is how
 * the lists' colour rail already says it.
 */
export function hashedMark(id: string): { icon: IconName; tint: number } {
  let hash = 0
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) % 100_000
  return { icon: MARKS[hash % MARKS.length]!, tint: hash % 10 }
}

/**
 * The corner every mark in the product has, by its size.
 *
 * A project's tile and a person's face are the same object at a glance — a
 * small coloured square with something in it — and two different corners on
 * them is two vocabularies in one column. Eleven at 32 and above, six below:
 * a radius that is a fixed fraction of the size looks slacker as the square
 * grows, and a fixed radius looks tighter.
 */
export function markRadius(size: number): number {
  return size >= 32 ? 11 : size >= 24 ? 8 : 6
}

/** What a mark needs to know about the project it stands for. */
export type Marked = {
  id: string
  name: string
  icon_url?: string | null | undefined
  mark_icon?: string | null | undefined
  mark_tint?: number | null | undefined
}

/**
 * The four props, from a project row.
 *
 * Written once because the order — picture, then chosen, then hashed — is
 * the thing that has to be the same in the sidebar, the project list, the
 * head of a project and its settings. Four call sites spelling it out is
 * four chances for one of them to forget the middle one.
 */
export function markOf(p: Marked) {
  return { id: p.id, name: p.name, url: p.icon_url, icon: p.mark_icon, tint: p.mark_tint }
}

/**
 * A project's mark: a glyph in its own colour on a wash of it, or its own
 * picture.
 *
 * Derived from the id rather than from initials, which is the point: two
 * projects called "Website" and "Website redesign" get the same two letters
 * and different tiles. It is the default and not a placeholder — most
 * projects will keep it.
 */
export function ProjectMark({
  id,
  name,
  url,
  icon,
  tint: chosen,
  size = 20,
}: {
  id: string
  name: string
  url?: string | null | undefined
  /** The glyph somebody chose, or null for the one the id gives. */
  icon?: string | null | undefined
  /** The tint somebody chose, 0–9, or null for the one the id gives. */
  tint?: number | null | undefined
  size?: number
}) {
  const radius = markRadius(size)
  /* And back to the generated mark if the picture does not arrive. The key
     is in Postgres and the file is on a disk a rebuilt environment wipes, so
     a row can point at nothing — and what that drew was the browser's broken
     frame for ever. The mark is a complete answer; a broken frame is not.
     Same reasoning as `Avatar` in the kit. */
  const [lost, setLost] = useState(false)
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new picture is a new chance to load, so what was lost is forgotten
  useEffect(() => setLost(false), [url])
  if (url && !lost) {
    return (
      <img
        src={url}
        alt=""
        title={name}
        draggable={false}
        width={size}
        height={size}
        onError={() => setLost(true)}
        className="shrink-0 object-cover"
        style={{ borderRadius: radius }}
      />
    )
  }
  let hash = 0
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) % 100_000
  /* Picture, then what was chosen, then what the id says.
     The two halves are chosen separately, so a
     project can keep the shape the hash gave it and take a different
     colour. */
  const colour = chosen == null ? tint(id) : `var(--tint-${chosen})`
  /* The glyph is the same colour walked far enough to read on the wash
     behind it: a yellow glyph on a sixteen percent yellow wash is 1.4:1.
     The wash stays the tint itself, so the mark still looks like its
     colour — `theme.css`. */
  const glyph = chosen == null ? inkOf(id) : `var(--tint-${chosen}-ink)`
  const shape = (icon ?? MARKS[hash % MARKS.length]!) as IconName
  /*
   * The colour is in the glyph, and the tile is a wash of it.
   *
   * Filled, each mark was the loudest thing on its row: a saturated square
   * with a white glyph in it, and nine of them down a sidebar that also has
   * a conversation per project — the same four colours, twice. A column
   * where everything shouts has nothing left to say the one unread thing
   * with.
   *
   * The colour still does its job, which is telling projects apart at a
   * glance; it does it at the volume the rest of the product uses one at —
   * a label is a seven-pixel dot of its own colour beside grey text.
   */
  return (
    <span
      title={name}
      /* The glyph it is wearing, so one attribute both finds this mark and
         says what it is showing — the way a status ring and a priority mark
         already do. */
      data-mark={shape}
      className="inline-flex shrink-0 items-center justify-center"
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        /* The space and the amount are the theme's — the two grounds need
           different mixes of the same tint, and `theme.css` says why. The
           mix itself is built here, because a declaration at `:root` would
           be resolved before any tint exists to put in it. */
        background: `color-mix(in var(--mark-space), ${colour} var(--mark-wash-pct), transparent)`,
        color: glyph,
      }}
    >
      <Icon name={shape} size={size * 0.65} />
    </span>
  )
}
