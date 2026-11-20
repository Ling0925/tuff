/*
 * The geometry under the empty-state drawings.
 *
 * Every drawing is a few rounded solids seen from one isometric camera
 * (45° round, the 2:1 view) and drawn in one thin stroke: the hairline
 * manner (hairline.lucasmarkes.com). The style is borrowed as rules, not as
 * code: this file is ours, and small, because a drawing needs four things —
 * a projection, a rounded ring, the hull of two rings, and the half of a
 * ring that faces the reader.
 *
 * World space: x and y on the ground, z up. +x runs down to the right on
 * screen and +y down to the left, so the corner with the largest x + y is
 * nearest; marks are painted far to near and a nearer plate covers a
 * farther one, because every plate is filled with the ground it sits on.
 */

export type Pt = [number, number]
/** A point of a ring on the ground plane, with its outward normal. */
export type Sample = { u: number; v: number; nu: number; nv: number }

const C45 = Math.SQRT1_2
const LIFT = Math.sqrt(0.75)

/** The one camera. */
export const P = (x: number, y: number, z: number): Pt => [(x - y) * C45, (x + y) * C45 * 0.5 - z * LIFT]

/** Whether a ring sample faces the reader. */
export const front = (q: Sample) => q.nu + q.nv >= -1e-6

const r2 = (n: number) => Math.round(n * 100) / 100
export const poly = (pts: Pt[]) => 'M' + pts.map((p) => `${r2(p[0])} ${r2(p[1])}`).join('L') + 'Z'
export const open = (pts: Pt[]) => (pts.length < 2 ? '' : 'M' + pts.map((p) => `${r2(p[0])} ${r2(p[1])}`).join('L'))
export const seg = (a: Pt, b: Pt) => `M${r2(a[0])} ${r2(a[1])}L${r2(b[0])} ${r2(b[1])}`

/** A rounded rectangle as a ring; `r` is cut to half the shorter side. */
export function rrect(u0: number, v0: number, u1: number, v1: number, r: number, n = 5): Sample[] {
  r = Math.max(0, Math.min(r, (u1 - u0) / 2, (v1 - v0) / 2))
  const out: Sample[] = []
  const corners: [number, number, number][] = [
    [u1 - r, v1 - r, 0],
    [u0 + r, v1 - r, 90],
    [u0 + r, v0 + r, 180],
    [u1 - r, v0 + r, 270],
  ]
  for (const [cu, cv, a0] of corners)
    for (let k = 0; k <= n; k++) {
      const a = ((a0 + (90 * k) / n) * Math.PI) / 180
      out.push({ u: cu + r * Math.cos(a), v: cv + r * Math.sin(a), nu: Math.cos(a), nv: Math.sin(a) })
    }
  return out
}

/** A circle round (cu, cv) as a ring. */
export function circ(cu: number, cv: number, R: number, n = 48): Sample[] {
  const out: Sample[] = []
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2
    out.push({ u: cu + R * Math.cos(a), v: cv + R * Math.sin(a), nu: Math.cos(a), nv: Math.sin(a) })
  }
  return out
}

/** The convex hull of screen points (monotone chain). */
export function hull(input: Pt[]): Pt[] {
  const pts = input.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const x = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lo: Pt[] = []
  const up: Pt[] = []
  for (const p of pts) {
    while (lo.length > 1 && x(lo[lo.length - 2]!, lo[lo.length - 1]!, p) <= 0) lo.pop()
    lo.push(p)
  }
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]!
    while (up.length > 1 && x(up[up.length - 2]!, up[up.length - 1]!, p) <= 0) up.pop()
    up.push(p)
  }
  lo.pop()
  up.pop()
  return lo.concat(up)
}

/** A ring standing at height z, projected. */
export const at = (ring: Sample[], z: number) => ring.map((q) => P(q.u, q.v, z))

/** The one unbroken run of a ring whose samples pass `keep`, in ring order. */
export function run(ring: Sample[], keep: (q: Sample) => boolean): Sample[] {
  const n = ring.length
  let s = -1
  for (let i = 0; i < n; i++)
    if (keep(ring[i]!) && !keep(ring[(i + n - 1) % n]!)) {
      s = i
      break
    }
  if (s < 0) return keep(ring[0]!) ? ring.slice() : []
  const out: Sample[] = []
  for (let k = 0; k < n && keep(ring[(s + k) % n]!); k++) out.push(ring[(s + k) % n]!)
  return out
}

/** A ring turned by `deg` round (cx, cv), normals and all. */
export function turn(ring: Sample[], deg: number, cu: number, cv: number): Sample[] {
  const a = (deg * Math.PI) / 180
  const c = Math.cos(a)
  const s = Math.sin(a)
  return ring.map((q) => ({
    u: cu + (q.u - cu) * c - (q.v - cv) * s,
    v: cv + (q.u - cu) * s + (q.v - cv) * c,
    nu: q.nu * c - q.nv * s,
    nv: q.nu * s + q.nv * c,
  }))
}

/** A ring and the same ring inset by `b`: a solid's outline and its crease. */
export const rings = (x0: number, y0: number, x1: number, y1: number, r: number, b: number): [Sample[], Sample[]] => [
  rrect(x0, y0, x1, y1, r),
  rrect(x0 + b, y0 + b, x1 - b, y1 - b, Math.max(0.3, r - b)),
]

/** A run of screen points, from its left end. */
const leftToRight = (pts: Pt[]) => (pts[0]![0] <= pts[pts.length - 1]![0] ? pts : pts.slice().reverse())

/** Every mark a drawing is made of, by what it does. */
export type Kind =
  /** a plate's outline: filled with the ground, the edge's stroke */
  | 'sil'
  /** the one bright stroke, filled with the ground */
  | 'hi'
  /** the bright stroke with nothing filled — a rim, a pin */
  | 'hi-line'
  /** a medium line, nothing filled */
  | 'line'
  /** the dim inner line, nothing filled: a crease, a seam */
  | 'lo'
  /** a dashed guide, nothing filled */
  | 'dash'
  /** the bright stroke, dashed: where something would stand */
  | 'hi-dash'
  /** the bright dot */
  | 'dot'
  /** a dim dot */
  | 'dot-lo'
  /** a plate with a hole in it, ground-filled, even-odd */
  | 'ring'
  /** the same, in the bright stroke */
  | 'ring-hi'
  /** a thin plate's back face: filled with the ground, the dim stroke */
  | 'back'

export type Mark = [string, Kind]

/** A drawing under construction: its marks in paint order, and every point drawn, for the frame. */
export class Sheet {
  marks: Mark[] = []
  pts: Pt[] = []

  add(d: string, kind: Kind, pts: Pt[] = []) {
    this.marks.push([d, kind])
    for (const p of pts) this.pts.push(p)
    return this
  }

  /** A rounded solid from z0 to z1: its silhouette and one crease inside the top. */
  solid(ring: Sample[], inner: Sample[] | null, z0: number, z1: number, kind: 'sil' | 'hi' = 'sil') {
    const outline = hull(at(ring, z1).concat(at(ring, z0)))
    this.add(poly(outline), kind, outline)
    if (inner) this.add(open(at(run(inner, front), z1)), 'lo')
    return this
  }

  /**
   * An open tray from z0 to z1 with walls `t` thick: the body, the rim's
   * inner edge, and the seam where the far walls meet the floor. Its front
   * wall is a separate call (`trayFront`), so what sits inside is painted
   * between the two.
   */
  tray(outer: Sample[], inner: Sample[], z0: number, z1: number, floor: number, rim: 'line' | 'hi-line' = 'line') {
    const body = hull(at(outer, z1).concat(at(outer, z0)))
    this.add(poly(body), 'sil', body)
    this.add(poly(at(inner, z1)), 'sil')
    this.add(
      open(
        at(
          run(inner, (q) => !front(q)),
          floor,
        ),
      ),
      'lo',
    )
    this.inner = inner
    this.outer = outer
    this.top = z1
    this.base = z0
    this.rim = rim
    return this
  }

  private inner: Sample[] = []
  private outer: Sample[] = []
  private top = 0
  private base = 0
  private rim: 'line' | 'hi-line' = 'line'

  /** The tray's near wall, painted over whatever stands in it. */
  trayFront() {
    const top = this.top
    return this.nearWall(at(run(this.inner, front), top), at(run(this.outer, front), top), at(run(this.outer, front), this.base), this.rim)
  }

  /**
   * A near wall from three runs — the rim's inner edge, its outer edge and
   * the foot — as one opaque piece, so it hides the floor behind it.
   */
  nearWall(inner: Pt[], outer: Pt[], foot: Pt[], rim: Kind) {
    const iF = leftToRight(inner)
    const oT = leftToRight(outer)
    const oB = leftToRight(foot)
    this.add(poly([...iF, oT[oT.length - 1]!, ...oB.slice().reverse(), oT[0]!]), 'sil')
    this.add(open(oT), 'lo')
    this.add(open(iF), rim)
    return this
  }

  /** A flat outline on a vertical plane y = const, from (u, w) points: u along x, w up. */
  onY(y: number, pts: Sample[]) {
    return pts.map((q) => P(q.u, y, q.v))
  }

  /** A flat outline on a vertical plane x = const: u along y, w up. */
  onX(x: number, pts: Sample[]) {
    return pts.map((q) => P(x, q.u, q.v))
  }

  /** A ball: a circle, which is what a sphere is from anywhere. */
  ball(x: number, y: number, z: number, r: number, kind: 'sil' | 'hi' = 'sil') {
    const c = P(x, y, z)
    const k = 0.5523 * r
    const d =
      `M${r2(c[0] - r)} ${r2(c[1])}` +
      `C${r2(c[0] - r)} ${r2(c[1] - k)} ${r2(c[0] - k)} ${r2(c[1] - r)} ${r2(c[0])} ${r2(c[1] - r)}` +
      `C${r2(c[0] + k)} ${r2(c[1] - r)} ${r2(c[0] + r)} ${r2(c[1] - k)} ${r2(c[0] + r)} ${r2(c[1])}` +
      `C${r2(c[0] + r)} ${r2(c[1] + k)} ${r2(c[0] + k)} ${r2(c[1] + r)} ${r2(c[0])} ${r2(c[1] + r)}` +
      `C${r2(c[0] - k)} ${r2(c[1] + r)} ${r2(c[0] - r)} ${r2(c[1] + k)} ${r2(c[0] - r)} ${r2(c[1])}Z`
    return this.add(d, kind, [
      [c[0] - r, c[1] - r],
      [c[0] + r, c[1] + r],
    ])
  }

  /** A dot lying on a plane, as a small screen circle. */
  dot(p: Pt, r: number, kind: 'dot' | 'dot-lo' = 'dot') {
    const d = `M${r2(p[0] - r)} ${r2(p[1])}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`
    return this.add(d, kind)
  }

  /** The finished drawing: its marks and a viewBox round them with `pad` to spare. */
  done(pad = 4) {
    let a = Infinity
    let b = -Infinity
    let c = Infinity
    let d = -Infinity
    for (const p of this.pts) {
      a = Math.min(a, p[0])
      b = Math.max(b, p[0])
      c = Math.min(c, p[1])
      d = Math.max(d, p[1])
    }
    const w = r2(b - a + 2 * pad)
    const h = r2(d - c + 2 * pad)
    return { box: `${r2(a - pad)} ${r2(c - pad)} ${w} ${h}`, w, h, marks: this.marks }
  }
}
