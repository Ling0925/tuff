import { CLOCK, dayMonthLong } from '../../data/words.js'
import { CHAT as W } from '../../words/chat.js'
import { type MessageInRoom } from '@tracker/shared-schema'
import { plain } from '../../data/doc.js'
import { onCalendar } from '../../data/calendar.js'

/* From the contract — `shared-schema/src/responses.ts`. */
export type Message = MessageInRoom

/* The day on the reader's own calendar — `data/calendar.ts`. */
export const day = (iso?: string) => (iso ? onCalendar(new Date(iso)) : '')

/** Who said it, for telling one run of messages from the next — the name,
    for somebody brought across from Slack who has no id here. */
export const hand = (m: Message | undefined) => (m ? (m.author_id ?? `as:${m.said_as ?? m.author_name}`) : undefined)

/** The time somebody said it, at the precision a conversation needs —
    "2:14 PM", not "02:14 PM": a twelve-hour clock is not written with a
    nought in front, and a 24-hour one drops it too, as French writes 9:04. */
export const clock = (iso: string) => new Date(iso).toLocaleTimeString(CLOCK, { hour: 'numeric', minute: '2-digit' })

/**
 * The same time for the gutter, without the half of the day.
 *
 * The gutter is exactly as wide as the avatar it stands in for, because the
 * words of every message in a run have to begin in the same column. Thirty-two
 * pixels holds "04:57" and does not hold "04:57 PM", so on a machine set to a
 * twelve-hour clock the PM wrapped onto a line of its own and the message
 * stood two lines tall to say one thing.
 *
 * Dropped rather than squeezed, and only here: this is a message in a run
 * whose first line already carries the full time, minutes after it. The
 * header keeps AM and PM, where there is room for them.
 */
export const gutterClock = (iso: string) => {
  const parts = new Intl.DateTimeFormat(CLOCK, { hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(iso))
  return parts
    .filter((p) => p.type === 'hour' || p.type === 'minute' || /^[.:]$/.test(p.value))
    .map((p) => p.value)
    .join('')
}

/**
 * Today and yesterday by name, everything else by date.
 *
 * "22 September" is a fact; "Yesterday" is where you were, and in a feed you
 * are scrolling back through that is the thing being looked for.
 */
export function dayLabel(iso: string): string {
  const d = day(iso)
  const now = new Date()
  const today = onCalendar(now)
  now.setDate(now.getDate() - 1)
  if (d === today) return W.today
  if (d === onCalendar(now)) return W.yesterday
  return dayMonthLong(new Date(iso))
}

/**
 * What a found message says, with the words lit — started a little before
 * the first of them when the message is long, so the line shown is the one
 * that matched rather than its opening. `docs/specs/find.md`.
 */
export function litLine(body: unknown, words: string): React.ReactNode {
  const all = plain(body).replace(/\s+/g, ' ').trim()
  const w = words.toLowerCase()
  const first = all.toLowerCase().indexOf(w)
  const text = first > 60 ? `…${all.slice(first - 40)}` : all
  const low = text.toLowerCase()
  const out: React.ReactNode[] = []
  let at = 0
  for (let i = low.indexOf(w); w && i !== -1; i = low.indexOf(w, at)) {
    if (i > at) out.push(text.slice(at, i))
    out.push(
      <mark key={i} className="bg-accent-soft text-ink" style={{ borderRadius: 4 }}>
        {text.slice(i, i + w.length)}
      </mark>,
    )
    at = i + w.length
  }
  out.push(text.slice(at))
  return out
}
