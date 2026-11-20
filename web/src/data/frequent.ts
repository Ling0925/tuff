/**
 * The emoji this person reacts with most, on this device — `docs/specs/chat-threads.md`.
 *
 * Three of them stand on the card over a message, one press each, the way
 * Slack keeps them. Counted in this browser's storage: a convenience of the
 * hand, not something anybody else needs to see or that has to follow the
 * person to another machine — a new one starts from the three most teams
 * use and learns.
 */
const KEY = 'reactions-used'
const START = ['👍', '👀', '✅']

function counts(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, number>
  } catch {
    return {}
  }
}

export function frequent(n = 3): string[] {
  const c = counts()
  const ranked = Object.entries(c)
    .sort((a, b) => b[1] - a[1])
    .map(([e]) => e)
  const out = [...ranked]
  for (const e of START) if (!out.includes(e)) out.push(e)
  return out.slice(0, n)
}

export function used(emoji: string): void {
  try {
    const c = counts()
    c[emoji] = (c[emoji] ?? 0) + 1
    localStorage.setItem(KEY, JSON.stringify(c))
    localStorage.setItem(RECENT, JSON.stringify([emoji, ...recentOnly().filter((e) => e !== emoji)].slice(0, 40)))
  } catch {
    // Private window, blocked storage: the starting three stay.
  }
}

/*
 * What the picker opens on: the last ones used — reacted with or written —
 * newest first, topped up from a short set a team sends about work so a
 * new machine does not open on an empty row. `docs/specs/emoji.md`.
 */
const RECENT = 'emoji-recent'
const STARTERS = ['👍', '👀', '✅', '🙏', '🎉', '🔥', '❤️', '😂', '🙌', '👏', '💯', '🚀', '😅', '🤔', '👎', '❌']

function recentOnly(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT) ?? '[]') as unknown
    return Array.isArray(v) ? v.filter((e): e is string => typeof e === 'string') : []
  } catch {
    return []
  }
}

export function recent(n = 16): string[] {
  const out = recentOnly()
  for (const e of STARTERS) if (out.length < n && !out.includes(e)) out.push(e)
  return out.slice(0, n)
}
