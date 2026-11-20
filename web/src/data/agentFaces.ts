import type { AgentFace } from '@tracker/shared-schema'

/**
 * The premade faces an agent can wear.
 *
 * Eighteen, in three sets: ten robots, four soft blobs and four one-eyed
 * shapes. Each is a
 * 48-unit square drawn on its own disc, so it reads on any ground, light or
 * dark, with no theme of its own; the parts that move carry a class
 * (`af-eyes`, `af-glow`, `af-look`, `af-orbit`, `af-sway`) and `theme.css`
 * says when they move. The same strings are written out as the static
 * `/faces/<id>.svg` and `.png` that the API hands back as `avatar_url`
 * (`web/scripts/agent-faces.ts`), so the Apple and Android apps draw the
 * face as a picture without knowing it is one.
 *
 * Flat fills and no ids: twenty of these inline on one screen would share a
 * gradient's id and the last one drawn would paint them all.
 */

const INK = '#1d1d1f'

/** A blink-able pair of eyes: dark ovals with a catch of light. */
function ovalEyes(y: number, gap: number, fill = INK, light = '#ffffff'): string {
  const l = 24 - gap / 2
  const r = 24 + gap / 2
  return `<g class="af-eyes">
<ellipse cx="${l}" cy="${y}" rx="2.2" ry="3" fill="${fill}"/>
<ellipse cx="${r}" cy="${y}" rx="2.2" ry="3" fill="${fill}"/>
<circle cx="${l + 0.8}" cy="${y - 1}" r="0.8" fill="${light}"/>
<circle cx="${r + 0.8}" cy="${y - 1}" r="0.8" fill="${light}"/>
</g>`
}

/** One big eye, the way the shapes have it: a pupil that looks about. */
function oneEye(cx: number, cy: number, r: number, white = '#ffffff'): string {
  return `<g class="af-eyes">
<circle cx="${cx}" cy="${cy}" r="${r}" fill="${white}"/>
<g class="af-look">
<circle cx="${cx}" cy="${cy}" r="${r * 0.56}" fill="${INK}"/>
<circle cx="${cx + r * 0.22}" cy="${cy - r * 0.24}" r="${r * 0.18}" fill="#ffffff"/>
</g>
</g>`
}

type Art = { set: 'bot' | 'blob' | 'geo'; ground: string; body: string }

export const AGENT_FACES: Record<AgentFace, Art> = {
  /* ---------------------------------------------------------- robots */
  'bot-1': {
    set: 'bot',
    ground: '#0a7fff',
    body: `<line x1="24" y1="15" x2="24" y2="10" stroke="#ffffff" stroke-width="2.4" stroke-linecap="round"/>
<circle class="af-glow" cx="24" cy="8.5" r="3" fill="#ffcc00"/>
<rect x="8.5" y="22" width="4" height="9" rx="2" fill="#cfe4ff"/>
<rect x="35.5" y="22" width="4" height="9" rx="2" fill="#cfe4ff"/>
<rect x="11" y="15" width="26" height="23" rx="8" fill="#ffffff"/>
<rect x="14" y="20" width="20" height="12" rx="6" fill="${INK}"/>
<g class="af-eyes"><rect x="17.5" y="23" width="4" height="6" rx="2" fill="#64e3ff"/><rect x="26.5" y="23" width="4" height="6" rx="2" fill="#64e3ff"/></g>`,
  },
  'bot-2': {
    set: 'bot',
    ground: '#ff9500',
    body: `<path d="M19 15 L15.5 9.5 M29 15 L32.5 9.5" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round"/>
<circle class="af-glow" cx="15" cy="8.5" r="2.2" fill="#ff3b30"/>
<circle class="af-glow" cx="33" cy="8.5" r="2.2" fill="#ff3b30"/>
<rect x="10" y="14" width="28" height="23" rx="6" fill="#ffffff"/>
<rect x="13" y="17" width="22" height="15" rx="4" fill="${INK}"/>
<g class="af-eyes"><circle cx="19.5" cy="23" r="2.6" fill="#ffcc00"/><circle cx="28.5" cy="23" r="2.6" fill="#ffcc00"/></g>
<path d="M21 27.5 q3 2.6 6 0" stroke="#ffcc00" stroke-width="1.6" fill="none" stroke-linecap="round"/>
<rect x="18" y="36" width="12" height="3" rx="1.5" fill="#ffe2b8"/>`,
  },
  'bot-3': {
    set: 'bot',
    ground: '#30b0c7',
    body: `<circle class="af-glow" cx="24" cy="10.5" r="2.4" fill="#ff3b30"/>
<path d="M11 35 V25 a13 13 0 0 1 26 0 V35 a3 3 0 0 1 -3 3 H14 a3 3 0 0 1 -3 -3 z" fill="#ffffff"/>
<rect x="13" y="22" width="22" height="9" rx="4.5" fill="${INK}"/>
<g class="af-eyes"><g class="af-look"><rect x="19.5" y="24.5" width="9" height="4" rx="2" fill="#ff453a"/></g></g>
<rect x="16" y="33" width="2" height="2" rx="1" fill="#b8e6ee"/><rect x="20" y="33" width="2" height="2" rx="1" fill="#b8e6ee"/><rect x="24" y="33" width="2" height="2" rx="1" fill="#b8e6ee"/><rect x="28" y="33" width="2" height="2" rx="1" fill="#b8e6ee"/>`,
  },
  'bot-4': {
    set: 'bot',
    ground: '#5856d6',
    body: `<line x1="24" y1="14" x2="24" y2="9.5" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round"/>
<circle class="af-glow" cx="24" cy="8" r="2.6" fill="#ff2d55"/>
<rect x="12" y="13" width="24" height="25" rx="10" fill="#ffffff"/>
<g class="af-eyes"><path d="M17 25.5 q2.6 -3.6 5.2 0 M25.8 25.5 q2.6 -3.6 5.2 0" stroke="${INK}" stroke-width="2.4" fill="none" stroke-linecap="round"/></g>
<circle cx="16.5" cy="30" r="2" fill="#ff2d55" opacity="0.35"/><circle cx="31.5" cy="30" r="2" fill="#ff2d55" opacity="0.35"/>
<path d="M22 30.5 h4" stroke="${INK}" stroke-width="1.8" stroke-linecap="round"/>`,
  },

  'bot-5': {
    set: 'bot',
    ground: '#34c759',
    body: `<path d="M15.5 16 L13 11 M32.5 16 L35 11" stroke="#ffffff" stroke-width="2.4" stroke-linecap="round"/>
<circle cx="24" cy="26" r="13" fill="#ffffff"/>
<circle cx="10.5" cy="26" r="2.5" fill="#d3f5dc"/><circle cx="37.5" cy="26" r="2.5" fill="#d3f5dc"/>
<g class="af-eyes"><circle cx="19" cy="25" r="4.6" fill="${INK}"/><circle cx="29" cy="25" r="4.6" fill="${INK}"/><circle class="af-glow" cx="20.2" cy="23.8" r="1.6" fill="#ffffff"/><circle class="af-glow" cx="30.2" cy="23.8" r="1.6" fill="#ffffff"/></g>
<path d="M21 32 h6" stroke="${INK}" stroke-width="1.8" stroke-linecap="round"/>`,
  },
  'bot-6': {
    set: 'bot',
    ground: '#ff3b30',
    body: `<rect class="af-glow" x="19" y="11" width="10" height="6" rx="3" fill="#ffcc00"/>
<rect x="8" y="16" width="32" height="20" rx="7" fill="#ffffff"/>
<rect x="11" y="21" width="26" height="9" rx="4.5" fill="${INK}"/>
<g class="af-eyes"><path d="M15.5 25.5 h5 M27.5 25.5 h5" stroke="#ffffff" stroke-width="2.6" stroke-linecap="round"/></g>
<rect x="20" y="36" width="8" height="3" rx="1.5" fill="#ffd1ce"/>`,
  },
  'bot-7': {
    set: 'bot',
    ground: '#ff2d55',
    body: `<path d="M34 18 L38 14" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round"/>
<circle class="af-glow" cx="38.5" cy="13.5" r="2.2" fill="#ffcc00"/>
<rect x="14" y="11" width="20" height="28" rx="10" fill="#ffffff"/>
<g class="af-eyes"><circle cx="24" cy="23" r="6.5" fill="${INK}"/><g class="af-look"><circle cx="24" cy="23" r="3" fill="#ff6482"/><circle cx="25" cy="22" r="1" fill="#ffffff"/></g></g>
<rect x="19" y="32" width="10" height="2.4" rx="1.2" fill="#ffd0da"/>`,
  },
  'bot-8': {
    set: 'bot',
    ground: '#ffcc00',
    body: `<line x1="24" y1="13" x2="24" y2="9" stroke="${INK}" stroke-width="2.2" stroke-linecap="round"/>
<circle class="af-glow" cx="24" cy="8" r="2.6" fill="#ffffff"/>
<path d="M17 13 H31 L37 20 V31 L31 38 H17 L11 31 V20 Z" fill="${INK}" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/>
<g class="af-eyes"><rect x="16.5" y="21.5" width="5.5" height="5.5" rx="1.5" fill="#ffffff"/><rect x="26" y="21.5" width="5.5" height="5.5" rx="1.5" fill="#ffffff"/></g>
<path d="M20 31.5 q4 2.6 8 0" stroke="#ffcc00" stroke-width="1.8" fill="none" stroke-linecap="round"/>`,
  },
  'bot-9': {
    set: 'bot',
    ground: '#8e8e93',
    body: `<path d="M24 14 V10 l-2.5 -2.5 M24 10 l2.5 -2.5" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
<rect x="10" y="14" width="28" height="24" rx="4" fill="#ffffff"/>
<circle cx="13.5" cy="17.5" r="1" fill="#c7c7cc"/><circle cx="34.5" cy="17.5" r="1" fill="#c7c7cc"/>
<g class="af-eyes"><rect x="15" y="20" width="7" height="7" rx="1.5" fill="${INK}"/><rect x="26" y="20" width="7" height="7" rx="1.5" fill="${INK}"/><rect class="af-glow" x="17" y="22" width="3" height="3" rx="0.5" fill="#64e3ff"/><rect class="af-glow" x="28" y="22" width="3" height="3" rx="0.5" fill="#64e3ff"/></g>
<rect x="16" y="30" width="16" height="5" rx="1.5" fill="${INK}"/>
<path d="M20 30 v5 M24 30 v5 M28 30 v5" stroke="#ffffff" stroke-width="1.2"/>`,
  },
  'bot-10': {
    set: 'bot',
    ground: '#b35be0',
    body: `<path d="M13 25 a11 11 0 0 1 22 0 Z" fill="#ead2f7"/>
<circle class="af-glow" cx="21" cy="19" r="2" fill="#ff2d55"/><circle class="af-glow" cx="27" cy="20.5" r="1.4" fill="#ffcc00"/>
<rect x="11" y="24" width="26" height="14" rx="5" fill="#ffffff"/>
<rect x="9" y="22.5" width="30" height="3.5" rx="1.75" fill="#ffffff"/>
<g class="af-eyes"><g fill="${INK}"><circle cx="18" cy="29.5" r="1.2"/><circle cx="21" cy="29.5" r="1.2"/><circle cx="18" cy="32.5" r="1.2"/><circle cx="21" cy="32.5" r="1.2"/><circle cx="27" cy="29.5" r="1.2"/><circle cx="30" cy="29.5" r="1.2"/><circle cx="27" cy="32.5" r="1.2"/><circle cx="30" cy="32.5" r="1.2"/></g></g>`,
  },

  /* ------------------------------------------------------- soft blobs */
  'blob-1': {
    set: 'blob',
    ground: '#ffe9a8',
    body: `<path d="M24 12 c8.5 0 14 6 14 13.5 S32 38 24 38 S10 33 10 25.5 S15.5 12 24 12 z" fill="#ffb300"/>
${ovalEyes(24.5, 8)}
<path d="M22 30 q2 1.8 4 0" stroke="${INK}" stroke-width="1.5" fill="none" stroke-linecap="round"/>`,
  },
  'blob-2': {
    set: 'blob',
    ground: '#cdf2d6',
    body: `<path d="M24 9 C29 16 37 21 37 28.5 a13 10.5 0 0 1 -26 0 C11 21 19 16 24 9 z" fill="#2fbf55"/>
${ovalEyes(28, 8)}
<circle cx="16.5" cy="32" r="1.8" fill="#ffffff" opacity="0.35"/>`,
  },
  'blob-3': {
    set: 'blob',
    ground: '#ffdbe3',
    body: `<g fill="#ff5c7a"><circle cx="17.5" cy="27" r="8"/><circle cx="30.5" cy="27" r="8"/><circle cx="24" cy="20.5" r="9.5"/><rect x="9.5" y="27" width="29" height="9" rx="4.5"/></g>
${ovalEyes(25, 8)}
<circle cx="15.5" cy="30" r="2" fill="#ffffff" opacity="0.35"/><circle cx="32.5" cy="30" r="2" fill="#ffffff" opacity="0.35"/>`,
  },
  'blob-4': {
    set: 'blob',
    ground: '#d4e8ff',
    body: `<path d="M24 17 V12" stroke="#2fbf55" stroke-width="2" stroke-linecap="round"/>
<g class="af-sway"><ellipse cx="27.5" cy="10.5" rx="4" ry="2.2" transform="rotate(-24 27.5 10.5)" fill="#2fbf55"/></g>
<rect x="11" y="16" width="26" height="23" rx="11.5" fill="#0a7fff"/>
${ovalEyes(26.5, 8, '#ffffff', INK)}
<path d="M22 32 q2 1.6 4 0" stroke="#ffffff" stroke-width="1.5" fill="none" stroke-linecap="round"/>`,
  },

  /* ------------------------------------------------ one-eyed shapes */
  'geo-1': {
    set: 'geo',
    ground: '#5856d6',
    body: `<path d="M24 11.5 L36.5 33.5 H11.5 Z" fill="#ffffff" stroke="#ffffff" stroke-width="4" stroke-linejoin="round"/>
${oneEye(24, 26.5, 5, '#e3e2ff')}
<path class="af-glow" d="M37 10 l1 2.4 2.4 1 -2.4 1 -1 2.4 -1 -2.4 -2.4 -1 2.4 -1 z" fill="#ffcc00"/>`,
  },
  'geo-2': {
    set: 'geo',
    ground: '#ff3b30',
    body: `<path d="M24 10 L36 17 V31 L24 38 L12 31 V17 Z" fill="#ffffff" stroke="#ffffff" stroke-width="3" stroke-linejoin="round"/>
${oneEye(24, 24, 6.5, '#ffe1df')}
<path class="af-glow" d="M11 9 l0.8 2 2 0.8 -2 0.8 -0.8 2 -0.8 -2 -2 -0.8 2 -0.8 z" fill="#ffffff"/>`,
  },
  'geo-3': {
    set: 'geo',
    ground: '#30b0c7',
    body: `<rect x="14" y="14" width="20" height="20" rx="5" transform="rotate(45 24 24)" fill="#ffffff"/>
${oneEye(24, 24, 5.5, '#d6f3f8')}
<path class="af-glow" d="M37 33 l0.8 2 2 0.8 -2 0.8 -0.8 2 -0.8 -2 -2 -0.8 2 -0.8 z" fill="#ffcc00"/>`,
  },
  'geo-4': {
    set: 'geo',
    ground: '#ff9500',
    body: `<g class="af-orbit"><circle cx="24" cy="8.5" r="2.4" fill="#ffffff"/></g>
<circle cx="24" cy="24" r="12" fill="#ffffff"/>
${oneEye(24, 24, 7.5, '#ffe8c7')}`,
  },
}

export const AGENT_FACE_IDS = Object.keys(AGENT_FACES) as AgentFace[]

/** The whole picture, as a standalone SVG — the static file, and inline. */
export function agentFaceSvg(id: AgentFace, attrs = ''): string {
  const art = AGENT_FACES[id]
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" ${attrs}><circle cx="24" cy="24" r="24" fill="${art.ground}"/><g class="af-body">${art.body}</g></svg>`
}

/**
 * Which preset a picture's address is, or null for an uploaded one. The
 * server answers `/faces/<id>.png` (`storage.ts`, `faceLink`); a client
 * that knows the art draws it live instead of the still.
 */
export function agentFaceOf(url: string | null | undefined): AgentFace | null {
  const m = url ? /^\/faces\/([a-z]+-\d+)\.(?:png|svg)(?:$|\?)/.exec(url) : null
  const id = m?.[1]
  return id && id in AGENT_FACES ? (id as AgentFace) : null
}
