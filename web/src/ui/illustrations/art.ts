/*
 * The drawings over the empty screens.
 *
 * Each is one object that holds something, shown holding none of it: a
 * letter tray with nothing in it, a board with no cards, a crate with no
 * folders. Absence is the subject, so the object is all there and composed,
 * and one bright mark says where the first thing would go. No faces, no
 * words, no arrows: what the screen is for is said by the heading under it.
 */
import { P, Sheet, at, circ, front, hull, open, poly, rings, rrect, run, seg, type Sample } from './iso.js'

/** My tasks: a two-tier letter tray, both tiers bare; the top one's rim is lit. */
function inbox() {
  const s = new Sheet()
  const tier = (z: number, hi: boolean) => {
    const [o, i] = [rrect(0, 0, 64, 46, 5), rrect(2.4, 2.4, 61.6, 43.6, 3)]
    s.tray(o, i, z, z + 10, z + 2.4, hi ? 'hi-line' : 'line')
    /* a finger pull set into the front, which is what makes it a tray */
    s.trayFront()
    s.add(poly(s.onY(46, rrect(24, z + 4, 40, z + 7.6, 1.8))), 'lo')
  }
  const post = (x: number, y: number) => {
    const [o] = rings(x - 1.4, y - 1.4, x + 1.4, y + 1.4, 1.4, 0.4)
    s.solid(o, null, 10, 28)
  }
  tier(0, false)
  post(6, 6)
  post(58, 6)
  post(6, 40)
  post(58, 40)
  tier(28, true)
  return s.done()
}

/** A project's tasks: three lanes and no cards; where the first goes is marked in the first. */
function board() {
  const s = new Sheet()
  const [base, crease] = rings(-4, -4, 84, 60, 6, 1.6)
  s.solid(base, crease, 0, 3)
  const lanes = [0, 28, 56]
  /* far lane first: a lane further along x is nearer the reader */
  lanes.forEach((x, n) => {
    const o = rrect(x, 0, x + 24, 56, 4)
    const i = rrect(x + 1.8, 1.8, x + 22.2, 54.2, 2.6)
    s.tray(o, i, 3, 9, 4.6, 'line')
    if (n === 0) {
      /* where the first card would lie */
      s.add(poly(at(rrect(x + 4, 6, x + 20, 20, 2), 4.6)), 'hi-dash')
    }
    s.trayFront()
  })
  return s.done()
}

/** Projects: a file box with its dividers and no folders behind them. */
function crate() {
  const s = new Sheet()
  const o = rrect(0, 0, 56, 44, 4)
  const i = rrect(2.4, 2.4, 53.6, 41.6, 2.4)
  s.tray(o, i, 0, 26, 2.4, 'line')
  /* three dividers, far to near, each with a tab standing above the rim */
  ;[11, 22, 33].forEach((y, n) => {
    const plate = rrect(3, y, 53, y + 1.2, 0.5)
    s.solid(plate, null, 2.4, 30, 'sil')
    const tx = 8 + n * 14
    const tab = rrect(tx, y, tx + 12, y + 1.2, 0.5)
    s.solid(tab, null, 30, 35, n === 0 ? 'hi' : 'sil')
  })
  s.trayFront()
  /* a label holder on the front, empty */
  s.add(poly(s.onY(44, rrect(18, 9, 38, 17, 1.6))), 'line')
  return s.done()
}

/**
 * A speech bubble standing upright on the plane y = `y`: a rounded body and
 * a tail at its foot, on the left or the right.
 */
function bubble(u0: number, w0: number, u1: number, w1: number, tail: 'left' | 'right') {
  const n = 5
  const body = rrect(u0, w0, u1, w1, 6, n)
  /* the foot runs from the bottom-left corner's last sample to the bottom-right's first */
  const cut = 3 * (n + 1)
  const foot =
    tail === 'left'
      ? [
          { u: u0 + 6, v: w0, nu: 0, nv: -1 },
          { u: u0 + 2, v: w0 - 7, nu: 0, nv: -1 },
          { u: u0 + 14, v: w0, nu: 0, nv: -1 },
        ]
      : [
          { u: u1 - 14, v: w0, nu: 0, nv: -1 },
          { u: u1 - 2, v: w0 - 7, nu: 0, nv: -1 },
          { u: u1 - 6, v: w0, nu: 0, nv: -1 },
        ]
  return [...body.slice(0, cut), ...foot, ...body.slice(cut)]
}

/**
 * A room: a bubble said, and facing it the dashed one where the first
 * answer goes — two faces of one corner, as two people stand to talk.
 */
function talk() {
  const s = new Sheet()
  /* the answer, not said yet: on the plane facing right, an outline in the accent */
  const next = bubble(-2, 0, 36, 24, 'left')
  const ghost = s.onX(50, next)
  s.add(poly(ghost), 'hi-dash', ghost)
  /* the one said: on the plane facing left, a plate with its thickness behind it */
  const said = bubble(0, 14, 40, 44, 'right')
  s.add(poly(s.onY(-3, said)), 'back')
  const face = s.onY(0, said)
  s.add(poly(face), 'sil', face)
  return s.done()
}

/** Docs: a magazine file, its slanted mouth empty. */
function holder() {
  const s = new Sheet()
  const W = 22
  const D = 50
  const height = (v: number) => 46 - (v / D) * 28
  const o = rrect(0, 0, W, D, 3)
  const i = rrect(2, 2, W - 2, D - 2, 1.6)
  const top = (ring: Sample[]) => ring.map((q) => P(q.u, q.v, height(q.v)))
  const body = hull(top(o).concat(at(o, 0)))
  s.add(poly(body), 'sil', body)
  /* the mouth, and the floor seam along the far walls */
  s.add(poly(top(i)), 'hi')
  s.add(
    open(
      at(
        run(i, (q) => !front(q)),
        2,
      ),
    ),
    'lo',
  )
  /* the far inside corner, which is what says the mouth is a hole */
  s.add(seg(P(2, 2, height(2)), P(2, 2, 2)), 'lo')
  /* the near walls, from the mouth's edge down: the face that hides the floor */
  s.nearWall(top(run(i, front)), top(run(o, front)), at(run(o, front), 0), 'hi-line')
  /* a finger hole cut in the near side */
  s.add(poly(s.onX(W, rrect(30, 8, 42, 14, 3))), 'line')
  return s.done()
}

/** Announcements: a pinboard on its feet, one pin and nothing under it. */
function pinboard() {
  const s = new Sheet()
  const foot = (x: number) => {
    const [o, c] = rings(x - 3, -8, x + 3, 12, 2.4, 0.8)
    s.solid(o, c, 0, 3)
  }
  foot(10)
  foot(58)
  const [o, c] = rings(0, 0, 68, 4, 1.8, 0.6)
  s.solid(o, c, 6, 54)
  /* the cork inside the frame */
  s.add(poly(s.onY(4, rrect(4, 10, 64, 50, 1.6))), 'lo')
  /* where notes were, and one pin left */
  for (const [u, w] of [
    [16, 42],
    [34, 44],
    [50, 38],
    [24, 24],
  ] as const)
    s.dot(P(u, 4, w), 0.9, 'dot-lo')
  s.ball(44, 6, 24, 2.4, 'hi')
  s.add(seg(P(44, 4, 24), P(44, 5, 24)), 'line')
  return s.done()
}

/** Activity: an abacus standing on its plank, every bead still at the start. */
function abacus() {
  const s = new Sheet()
  const [base, crease] = rings(-8, 2, 84, 22, 3, 1)
  s.solid(base, crease, 0, 4)
  const [lp, lc] = rings(-4, 8, 0, 16, 1.6, 0.6)
  s.solid(lp, lc, 4, 36)
  ;[30, 21, 12].forEach((z, n) => {
    s.add(seg(P(0, 12, z), P(76, 12, z)), 'line')
    for (let k = 0; k < 5; k++) s.ball(4 + k * 6.2, 12, z, 3, n === 2 && k === 4 ? 'hi' : 'sil')
  })
  const [rp, rc] = rings(76, 8, 80, 16, 1.6, 0.6)
  s.solid(rp, rc, 4, 36)
  return s.done()
}

/** Notifications: pigeonholes, every slot empty; yours is lit. */
function cubbies() {
  const s = new Sheet()
  const W = 58
  const D = 18
  const H = 42
  const [o, c] = rings(0, 0, W, D, 2.4, 0.8)
  s.solid(o, c, 0, H)
  const d = 10
  for (let row = 0; row < 2; row++)
    for (let col = 0; col < 3; col++) {
      const u0 = 4 + col * 17.6
      const u1 = u0 + 14.4
      const w0 = 4 + (1 - row) * 19
      const w1 = w0 + 15
      const lit = row === 0 && col === 0
      /* the far wall's corner, seen through the mouth: the floor seam and the left seam */
      s.add(open([P(u0, D, w0), P(u0, D - d, w0), P(u1 - d, D - d, w0)]), 'lo')
      s.add(seg(P(u0, D - d, w0), P(u0, D - d, w1 - 0.82 * d)), 'lo')
      s.add(poly(s.onY(D, rrect(u0, w0, u1, w1, 1.6))), lit ? 'hi-line' : 'line')
    }
  return s.done()
}

/** Not found: a plinth with the outline of what stood on it. */
function plinth() {
  const s = new Sheet()
  const [b, bc] = rings(0, 0, 52, 52, 4, 1.2)
  s.solid(b, bc, 0, 6)
  const [t, tc] = rings(7, 7, 45, 45, 3, 1.2)
  s.solid(t, tc, 6, 26)
  s.add(poly(at(rrect(15, 15, 37, 37, 3), 26)), 'hi-dash')
  return s.done()
}

/** Search: a loupe lying square on a blank sheet, its handle along the sheet's edge. */
function loupe() {
  const s = new Sheet()
  const [sheet, fold] = rings(0, 0, 64, 46, 1.6, 1)
  s.solid(sheet, fold, 0, 1.2)
  const cx = 22
  const cy = 22
  const R = 14
  const r = 11.4
  const z0 = 1.2
  const z1 = 4.4
  /* the handle first, along +x: the ring lies over its root */
  const [handle, ridge] = rings(cx + R - 3, cy - 2.8, cx + R + 26, cy + 2.8, 2.8, 1)
  s.solid(handle, ridge, z0, z1 - 0.8)
  const outer = circ(cx, cy, R, 64)
  const inner = circ(cx, cy, r, 64)
  const body = hull(at(outer, z1).concat(at(outer, z0)))
  /* the rim, with its hole: the glass shows the sheet through it */
  s.add(poly(body) + poly(at(inner, z1)), 'ring-hi', body)
  s.add(
    open(
      at(
        run(inner, (q) => !front(q)),
        z0,
      ),
    ),
    'lo',
  )
  return s.done()
}

/**
 * Agents: a terminal waiting, its cable lying out to a plug nothing is in.
 *
 * Painted far to near, and nothing drawn where a solid would hide it: the
 * prongs first, out of the plug's far face, so the plug covers their roots;
 * then the plug; then the cable, which stops on the plug's outline — the
 * rounded corner facing the terminal — rather than crossing into it; and
 * the terminal last, over the cable's root.
 */
function agent() {
  const s = new Sheet()
  const X0 = 56
  const X1 = 70
  const Y0 = -27
  const Y1 = -13
  const R = 3
  /* two prongs, out of the face away from the reader, going up to the right */
  s.add(seg(P(61, -20, 4), P(61, Y0 - 7, 4)) + seg(P(65, -20, 4), P(65, Y0 - 7, 4)), 'hi-line', [P(65, Y0 - 7, 4)])
  const [plug, plugTop] = rings(X0, Y0, X1, Y1, R, 1)
  s.solid(plug, plugTop, 0, 8, 'hi')
  /* the cable: from the terminal's right face, sagging towards the reader, to the plug's left edge */
  const k = R * (1 - Math.SQRT1_2)
  const from = [32, 10, 1.6] as const
  const to = [X0 + k, Y1 - k, 3] as const
  const cable: [number, number][] = []
  for (let n = 0; n <= 32; n++) {
    const t = n / 32
    const x = from[0] + (to[0] - from[0]) * t
    const y = from[1] + (to[1] - from[1]) * t + Math.sin(t * Math.PI) * 12
    const z = from[2] + (to[2] - from[2]) * t
    cable.push(P(x, y, z))
  }
  s.add(open(cable), 'line', cable)
  /* the terminal: a rounded block with its screen on the face towards the reader */
  const [box, top] = rings(0, 0, 32, 26, 4, 1.2)
  s.solid(box, top, 0, 30)
  s.add(poly(s.onY(26, rrect(4, 8, 28, 26, 2.4))), 'line')
  /* a prompt, waiting: a short bar, no letters */
  s.add(seg(P(8, 26, 20), P(14, 26, 20)), 'line')
  return s.done()
}

export const DRAWINGS = {
  inbox,
  board,
  crate,
  talk,
  agent,
  holder,
  pinboard,
  abacus,
  cubbies,
  plinth,
  loupe,
}

export type ArtName = keyof typeof DRAWINGS

const made = new Map<ArtName, ReturnType<typeof inbox>>()

/** A drawing, made once: the marks never change, so neither does the work. */
export function drawing(name: ArtName) {
  let d = made.get(name)
  if (!d) {
    d = DRAWINGS[name]()
    made.set(name, d)
  }
  return d
}
