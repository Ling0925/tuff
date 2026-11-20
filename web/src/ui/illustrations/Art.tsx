import { useLayoutEffect, useRef } from 'react'
import { drawing, type ArtName } from './art.js'
import { STROKES } from './strokes.js'

export type { ArtName }

/** World units to pixels: one scale for every drawing, so they stand together. */
const SCALE = 1.4

/**
 * The drawing over an empty screen.
 *
 * It stands in a slot of a fixed size, so the heading under it is where it
 * will be before a line is drawn and nothing moves when it is.
 *
 * Its plates are filled with whatever the screen behind it is painted, read
 * once before the first paint and again when the theme changes: an empty
 * state stands on a sheet in one place and on the chrome in another, and a
 * plate one shade off its ground reads as a sticker.
 */
export function Art({ name }: { name: ArtName }) {
  const { box, w, h, marks } = drawing(name)
  const ref = useRef<SVGSVGElement>(null)

  useLayoutEffect(() => {
    const svg = ref.current
    if (!svg) return
    const read = () => {
      for (let el = svg.parentElement; el; el = el.parentElement) {
        const bg = getComputedStyle(el).backgroundColor
        if (bg && bg !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(bg)) {
          svg.style.setProperty('--art-ground', bg)
          return
        }
      }
      svg.style.removeProperty('--art-ground')
    }
    read()
    const watch = new MutationObserver(read)
    watch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] })
    return () => watch.disconnect()
  }, [])

  return (
    <span data-art={name} aria-hidden="true" className="flex h-[120px] w-[160px] shrink-0 items-center justify-center">
      <svg ref={ref} viewBox={box} width={Math.round(w * SCALE)} height={Math.round(h * SCALE)} className="overflow-visible">
        {marks.map(([d, kind], i) => (
          <path key={i} d={d} style={STROKES[kind]} />
        ))}
      </svg>
    </span>
  )
}
