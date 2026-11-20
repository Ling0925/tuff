import { agentAway, awaySince } from '../../data/agentWorking.js'
import { useState, useEffect } from 'react'
import { KIT as W } from '../../words/kit.js'
import { type PersonInWorkspace } from '@tracker/shared-schema'
import { agentFaceOf } from '../../data/agentFaces.js'
import { useFace } from '../../data/faces.js'
import { AgentFaceMark } from './marks.jsx'

/** Somebody, at the size a name needs when there is no picture of them. */
/** Here, away or busy — `docs/specs/presence.md`. */
export type Presence = 'here' | 'away' | 'busy'

/*
 * A face's picture, kept on screen while its link is renewed.
 *
 * A face is read through a link signed for the hour (`faced` on the
 * server), so the same picture comes back under a new address every hour,
 * and every start draws the last answer kept on this machine before the
 * server's arrives with the new one. Swapping the address straight away
 * fetches the bytes again and leaves an empty disc while they come: we saw their own face reload on every open. So a new link to the
 * same picture (the address without its signature) is loaded beside the
 * one on screen and takes its place only once it can be drawn. A
 * different picture is a different address and is shown at once.
 */
const FACES_KEPT = 'faces-on-screen'
/* Kept across starts too: the first answer of a new hour carries links the
   browser has never fetched, while last hour's are still in its cache (the
   bytes are served immutable for a year). A link whose signature ran out
   and is not in the cache fails, and the letter stands in until the new
   one is ready, which is no worse than before. */
const pictureOnScreen = new Map<string, string>(
  (() => {
    try {
      return Object.entries(JSON.parse(localStorage.getItem(FACES_KEPT) ?? '{}') as Record<string, string>)
    } catch {
      return []
    }
  })(),
)
function keepPicture(picture: string, url: string) {
  pictureOnScreen.set(picture, url)
  try {
    localStorage.setItem(FACES_KEPT, JSON.stringify(Object.fromEntries([...pictureOnScreen].slice(-200))))
  } catch {
    // A browser that keeps nothing reloads the picture, as it always did.
  }
}
const pictureOf = (url: string) => url.split('?')[0]!

function useSteadyPicture(url: string | null | undefined): string | null {
  const picture = url ? pictureOf(url) : null
  const [, redraw] = useState(0)
  const showing = picture ? pictureOnScreen.get(picture) : undefined
  if (url && picture && !showing) keepPicture(picture, url)
  useEffect(() => {
    if (!url || !picture) return
    const now = pictureOnScreen.get(picture)
    if (!now || now === url) return
    let gone = false
    const next = new Image()
    next.src = url
    next
      .decode()
      .then(() => {
        if (gone) return
        keepPicture(picture, url)
        redraw((n) => n + 1)
      })
      .catch(() => {
        /* The old link still draws; the next answer brings another new one. */
      })
    return () => {
      gone = true
    }
  }, [url, picture])
  if (!url || !picture) return null
  return pictureOnScreen.get(picture) ?? url
}

export function Avatar({
  name,
  id,
  url,
  size = 20,
  presence,
  on = 'var(--chrome)',
  live = false,
}: {
  name: string
  /** What the tint is taken from, when the thing has an id of its own. */
  id?: string
  /** A picture somebody uploaded, or null for the letter. */
  url?: string | null | undefined
  size?: number
  /** Drawn on the corner where a person is a person, and nowhere else. */
  presence?: Presence | null | undefined
  /**
   * What is behind the mark, for the ring that separates the dot from it.
   *
   * The ring is the ground, not a colour of its own — a grey halo on a
   * white panel is a halo. The sidebar is where most of these are drawn, so
   * it is the default, and the two places on a panel say so.
   */
  on?: string
  /** A premade face moves, slowly, while this is on. */
  live?: boolean
}) {
  /*
   * Two letters: the first and last names' initials, or the first two of a
   * single name — Bruno Costa is BC, Dev is DE.
   *
   * It was one, on the argument that two in a 20px circle is a smudge and
   * the tint tells people apart. With fifteen people the tints repeat and a
   * column of B, B and C names nobody; we asked for two, as Slack
   * and Linear draw them. The letters are set smaller to fit, with the
   * tracking taken in so the pair reads as one mark.
   */
  const words = name.trim().split(/\s+/).filter(Boolean)
  const letter = (
    words.length > 1 ? (words[0]![0] ?? '') + (words[words.length - 1]![0] ?? '') : (words[0] ?? '?').slice(0, 2)
  ).toUpperCase()
  /* Dealt across the workspace so two people rarely share one —
     `data/faces.ts`. */
  const dealt = useFace(id ?? name)
  /*
   * A photograph, where there is one.
   *
   * `cover` rather than `contain`: the mark is a circle and a picture that
   * does not fill it leaves bars of ground inside the disc, which reads as a
   * broken image rather than a considered one. A picture that is wrong in a
   * circle is a picture to replace — there is no crop dialog and
   * `docs/specs/avatar.md` says why there is not.
   *
   * The letter stays the default rather than a fallback for a failed load.
   * It is what a person who has uploaded nothing has, and it is complete.
   */
  /*
   * And back to the letter if the picture does not arrive.
   *
   * The spec says the letter is the default rather than a fallback, and that
   * is right about somebody who never uploaded anything. It assumed the
   * bytes are always there, and they are not: the key lives in Postgres and
   * the file lives on a disk that a rebuilt environment wipes, so a row can
   * point at nothing. What that drew was the browser's broken-image glyph,
   * for ever, with no way back but uploading again.
   *
   * A letter is a complete answer and a broken frame is not, so a load that
   * fails falls back to the one that cannot.
   */
  const src = useSteadyPicture(url)
  const [lost, setLost] = useState(false)
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new picture is a new chance to load, so what was lost is forgotten
  useEffect(() => setLost(false), [src])
  /* A premade face is drawn, not loaded: the same art the still at its
     address was made from, with the parts that move. */
  const preset = agentFaceOf(url)
  const shown = preset ? (
    <AgentFaceMark id={preset} size={size} live={live} title={name} />
  ) : url && src && !lost ? (
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      draggable={false}
      onError={() => setLost(true)}
      className="inline-block shrink-0 object-cover"
      style={{ width: size, height: size, borderRadius: '50%' }}
    />
  ) : null
  const face = shown ?? (
    <span
      className="inline-flex shrink-0 items-center justify-center font-semibold"
      style={{
        width: size,
        height: size,
        /*
         * A disc, where a project's mark is a rounded square.
         *
         * They were the same shape on the argument that a person and a
         * project are the same object at a glance — a small coloured mark
         * with something in it. They are not: one is a who and the other a
         * what, and in a column that holds both, the shape is the fastest
         * thing to read. The sidebar lists projects and rooms together and
         * the chat rows carry a person beside a project; a circle says
         * which is which before the name is read.
         *
         * The two vocabularies are the point, not an accident — it is the
         * same distinction every other product makes with the same two
         * shapes, which is a reason to keep it rather than to avoid it.
         */
        borderRadius: '50%',
        /*
         * Smaller than the square it sits in, and heavier to pay for it.
         *
         * It was seven tenths, which is a letter wearing the mark rather
         * than sitting in one: at 24px the D touched both edges and the
         * tint — the thing that actually tells two people apart — was
         * reduced to a rim. Then just under a half, which was measured
         * against a circle, where the widest line through the mark is also
         * its edge.
         *
         * This is a rounded square now. Its corners hold the letter's own
         * corners, so the same proportion reads as a letter adrift in a
         * tile with room on every side — and at 16px, which is most of the
         * ones on a screen, the glyph lands at 7px and stops being a
         * letter at all. Fourteen twenty-fifths puts the cap height back
         * against the sides without touching them.
         *
         * Rounded, because a stem drawn across two pixels reads as grey
         * rather than as white.
         */
        fontSize: Math.round(size * (letter.length > 1 ? 0.42 : 0.56)),
        letterSpacing: letter.length > 1 ? '-0.02em' : undefined,
        lineHeight: `${size}px`,
        /* The face's own ground, not the tint: a letter has to read on it,
           and white does not read on most of the tints — 1.4:1 on the
           yellow. Each one is taken down only as far as white needs, so the
           hue is the tint's and the letter is legible on all ten. The tints
           themselves are untouched, because a label dot and a project's
           mark carry no text and nothing was wrong with them. `theme.css`. */
        background: `var(--face-${dealt})`,
        color: '#ffffff',
      }}
      title={name}
    >
      {letter}
    </span>
  )
  if (!presence) return face
  /*
   * The dot sits on the corner of the mark, in a ring of whatever is behind
   * it — a green dot on a green tile is nothing, and a dot with no ring on a
   * list that scrolls over a panel edge is a smudge.
   *
   * Away is a ring and not a disc, because absence is not a thing: the eye
   * reads filled as present and hollow as not, before it has read any
   * colour, which is also how it reads for somebody who cannot tell the
   * green from the grey.
   */
  /* Smaller on a disc than it was on a square. The square's corner is far
     from the letter and a third of the width sat in empty tint; a circle
     curves that corner back in, so the same dot crossed the glyph. */
  const dot = Math.max(6, Math.round(size * 0.3))
  /*
   * Away is a ring on the ground, not a hole in it.
   *
   * Left transparent, the middle of the ring showed whatever was behind —
   * the avatar's own tint at the corner — so it read as a bite taken out of
   * the mark rather than as a mark of its own. Filled with the ground, it is
   * a ring sitting on the surface, which is what hollow is supposed to say:
   * a place where somebody is not.
   */
  const paint = presence === 'here' ? 'var(--tint-3)' : presence === 'busy' ? 'var(--tint-0)' : on
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      {face}
      <span
        data-presence={presence}
        aria-label={presence === 'here' ? W.active : presence === 'busy' ? W.doNotDisturb : W.away}
        title={presence === 'here' ? W.active : presence === 'busy' ? W.doNotDisturb : W.away}
        className="absolute flex items-center justify-center"
        style={{
          /*
           * On the disc's edge, at the point where the edge actually is.
           *
           * At -1 the dot sat where a rounded square's corner used to be,
           * which on a circle is outside the shape — it floated off the
           * mark with a gap behind it. The circle's lower-right lies on the
           * 45° diagonal, inset from each side by half the radius times
           * (1 - 1/√2), so the dot's own centre lands on the curve.
           */
          /* And pushed out past the edge by most of itself, so it sits on
             the rim rather than on the letters: centred on the curve, the
             dot's inner half lay over the second initial. */
          right: Math.round(size * 0.5 * (1 - Math.SQRT1_2)) - Math.round(dot * 0.75),
          bottom: Math.round(size * 0.5 * (1 - Math.SQRT1_2)) - Math.round(dot * 0.75),
          width: dot,
          height: dot,
          borderRadius: dot,
          background: paint,
          border: presence === 'away' ? '2px solid var(--ink-2)' : 'none',
          boxShadow: `0 0 0 2px ${on}`,
        }}
      >
        {/* The bar across the red one, so Do not disturb is not the same
            picture as Here in a different colour. */}
        {presence === 'busy' && <span style={{ width: Math.round(dot * 0.52), height: 1.5, borderRadius: 1, background: '#fff' }} />}
      </span>
    </span>
  )
}

/**
 * An agent, said as one — and away, when it is: an agent on somebody's
 * machine answers when the machine is on.
 */
export function agentLabel(p: PersonInWorkspace): string {
  const away = agentAway(p)
  return away === null ? W.agent : away === 0 ? W.agentNotYet : W.agentAwaySince(awaySince(away))
}
