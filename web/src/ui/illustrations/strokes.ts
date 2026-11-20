import type { Kind } from './iso.js'

/*
 * The whole palette: one stroke in three greys and the accent. A drawing
 * sets no colour of its own; it names what a mark is and this says how it
 * looks, in both themes, from the tokens in `theme.css`.
 *
 * Plates are filled with `--art-ground` — the surface the drawing sits on —
 * so a nearer plate hides what is behind it and the construction stays
 * honest without a single clip path or id.
 */
const LINE = { strokeWidth: 1, vectorEffect: 'non-scaling-stroke', strokeLinejoin: 'round', strokeLinecap: 'round' } as const

export const STROKES: Record<Kind, React.CSSProperties> = {
  sil: { ...LINE, fill: 'var(--art-ground)', stroke: 'var(--art-edge)' },
  hi: { ...LINE, fill: 'var(--art-ground)', stroke: 'var(--accent)' },
  'hi-line': { ...LINE, fill: 'none', stroke: 'var(--accent)' },
  'hi-dash': { ...LINE, fill: 'none', stroke: 'var(--accent)', strokeDasharray: '1.6 2.4' },
  line: { ...LINE, fill: 'none', stroke: 'var(--art-mid)' },
  lo: { ...LINE, fill: 'none', stroke: 'var(--art-lo)' },
  dash: { ...LINE, fill: 'none', stroke: 'var(--art-mid)', strokeDasharray: '1.6 2.4' },
  dot: { fill: 'var(--accent)', stroke: 'none' },
  'dot-lo': { fill: 'var(--art-mid)', stroke: 'none' },
  ring: { ...LINE, fill: 'var(--art-ground)', fillRule: 'evenodd', stroke: 'var(--art-edge)' },
  back: { ...LINE, fill: 'var(--art-ground)', stroke: 'var(--art-lo)' },
  'ring-hi': { ...LINE, fill: 'var(--art-ground)', fillRule: 'evenodd', stroke: 'var(--accent)' },
}
