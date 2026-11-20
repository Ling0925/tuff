/**
 * What an activity event says, in words.
 *
 * Lifted out of the Activity screen whole when a task's own history started
 * drawing the same rows beside the task. Two
 * screens reading one log must not invent two ways of describing the same
 * event, and the way that happens is each of them growing its own copy of
 * this. Nothing here knows about a screen; it turns a row into a sentence.
 */
import { LABEL } from './tools.js'
import { asHours } from './hours.js'
import { dayMonth, CLOCK } from './words.js'
import { PRIORITY_SAID, type Priority } from '../ui/kit.jsx'
import { ALONE, DETAIL, DONE, SAID as WORDS, VERBS } from '../words/said.js'
import { recall } from './memory.js'
import type { Repeat } from '@tracker/shared-schema'
import { repeatSaid } from '../words/repeat.js'

/* The other end of a copy, by its handle — `ACM-41` — when the reader is
   on that project; "another project" when not, whose key is not theirs. */
function handleIn(project: unknown, number: unknown): string {
  const shelf = recall<{ projects?: { id: string; key?: string | null; name: string }[] }>('shell')
  const p = typeof project === 'string' ? shelf?.projects?.find((x) => x.id === project) : undefined
  if (!p) return DETAIL.anotherProject
  return typeof number === 'number' && p.key ? `${p.key}-${number}` : p.name
}

export type Event = {
  id: string
  action: string
  actor_id: string
  actor_name: string
  actor_avatar_url?: string | null
  origin: string
  at: string
  object_type: string | null
  object_id: string | null
  /** What it happened to, by name. */
  object_title: string | null
  object_number: number | null
  /** Where it happened, when the feed says. */
  project_id?: string | null
  /** What changed, as it was at the time. */
  meta: Record<string, unknown> | null
}

/**
 * What somebody did, in the words the product uses for it.
 *
 * Written out rather than derived from the action name, because
 * `task.update` read as "task update" is the database talking. Anything not
 * on this list falls back to its own name with the dots taken out, which is
 * ugly and legible — and a new action nobody has worded yet should look
 * unfinished rather than invisible.
 *
 * The words are in `words/said.ts`, each with its French beside it, keyed
 * by the action's own name. The French is written so that what it was done
 * to can follow the verb, which is where the feed puts it.
 */
const SAID = DONE

/**
 * The verb, which for one key can be several.
 *
 * `task.update` covers moving, giving, dating and renaming, and a log that
 * calls all four "changed" is a log that has to be read twice. What it was is
 * in the event's own detail, so the verb is chosen from there and the detail
 * finishes the sentence.
 */
export function verb(e: Event): string {
  const id = which(e)
  return VERBS[id as keyof typeof VERBS] ?? SAID[id] ?? e.action.replace(/\./g, ' ')
}

/**
 * Which verb it is, by a name that is the same in every language — the
 * action's own, or the variant's. The verb and the verb with nothing after
 * it are both read from this, so a language that words them differently
 * still words the same event.
 */
function which(e: Event): string {
  const m = e.meta ?? {}
  if (e.action === 'task.update') {
    if (m.moved_to) return 'moved'
    /* Put under another task, or out from under one. */
    if (m.nested_under !== undefined || m.nested_from !== undefined) return 'moved'
    if (m.given_to) return 'assigned'
    if (m.taken_off) return 'unassigned'
    if (m.due !== undefined) return m.due ? 'setDue' : 'clearedDue'
    if (m.priority !== undefined) return m.priority ? 'prioritised' : 'unprioritised'
    if (m.renamed) return 'renamed'
    if (m.finished) return 'finished'
    if (m.reopened) return 'reopened'
    if (m.starts !== undefined || m.ends !== undefined) return 'scheduled'
    if (m.wrote) return 'wroteBody'
    if (m.repeat !== undefined) return m.repeat ? 'setRepeat' : 'clearedRepeat'
    if (m.reordered) return 'reordered'
    /*
     * Last, because every other kind of change is more specific than this
     * one and a save can carry several. The server has recorded `labelled`
     * since labels existed and nothing here read it, so putting a label on
     * a task wrote a line that said "changed" and could not say what — the
     * one thing this file is for.
     */
    if (Array.isArray(m.labelled)) {
      return (m.labelled as string[]).length ? 'labelled' : 'unlabelled'
    }
  }
  /* An earlier version put back. */
  if (e.action === 'file.update' && typeof m.restored_version === 'number') return 'restoredVersion'
  /* Hours on a task name the task: "logged time on Fix the login 2h". */
  if (e.action === 'time.log' && e.object_id) return 'loggedTimeOn'
  if (e.action === 'time.remove' && e.object_id) return 'removedTimeFrom'
  if (e.action === 'time.edit' && e.object_id) return 'changedTimeOn'
  if (e.action === 'project.update') {
    if (m.renamed) return 'renamedProject'
    if (Array.isArray(m.tools)) return 'changedTools'
    if (m.described !== undefined) {
      return m.described ? 'wroteProjectBody' : 'clearedProjectBody'
    }
  }
  return e.action
}

/** A date as a person says it, for the ones a log mentions. */
function date(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return iso
  return dayMonth(new Date(y, m - 1, d), y !== new Date().getFullYear())
}

/**
 * The rest of the sentence: what was changed, and to what.
 *
 * "moved" answers nothing without "to Doing", and "changed the project"
 * repeated eight times is a log that records that something happened and
 * nothing else. The words are built from what the event kept at the time —
 * the names as they were then, because a list renamed or deleted since would
 * otherwise turn an entry into a blank, and what happened is that it was
 * moved to the list called Doing.
 *
 * Nothing is invented. An event with no detail says only what it did, which
 * is what the older rows in any log look like and is honest about them.
 */
export function alsoSaid(e: Event): string | null {
  const m = e.meta ?? {}
  const parts: string[] = []
  const said = (v: unknown) => (typeof v === 'string' && v ? v : null)

  if (e.action === 'task.copy') parts.push(DETAIL.copiedFrom(handleIn(m.from_project_id, m.from_number)))
  if (e.action === 'task.copied') parts.push(DETAIL.copiedTo(handleIn(m.to_project_id, m.to_number)))
  /* The next one of a series names the one it came after, and its date. */
  if (e.action === 'task.repeat') {
    if (typeof m.from_number === 'number') parts.push(DETAIL.repeatedFrom(handleIn(e.project_id, m.from_number)))
    if (said(m.due_on)) parts.push(DETAIL.dueFor(date(said(m.due_on)!)))
  }
  if (e.action === 'task.update' && m.repeat && typeof m.repeat === 'object') parts.push(repeatSaid(m.repeat as Repeat))
  if (said(m.moved_to)) {
    parts.push(said(m.moved_from) ? DETAIL.movedFromTo(said(m.moved_to)!, said(m.moved_from)!) : DETAIL.movedTo(said(m.moved_to)!))
  }
  if (typeof m.nested_under === 'number') parts.push(DETAIL.under(handleIn(e.project_id, m.nested_under)))
  else if (typeof m.nested_from === 'number') parts.push(DETAIL.outOf(handleIn(e.project_id, m.nested_from)))
  if (said(m.given_to)) parts.push(DETAIL.givenTo(said(m.given_to)!))
  if (said(m.taken_off)) parts.push(DETAIL.takenOff(said(m.taken_off)!))
  /* The verb already said what happened to the date; this is the date. */
  if (said(m.due)) parts.push(DETAIL.dueOn(date(said(m.due)!)))
  /* The word as the screen says it, not as the column stores it — the
     picker's own, so the line and the menu agree in every language. */
  if (said(m.priority)) {
    const p = said(m.priority)!
    parts.push(DETAIL.priorityAs(PRIORITY_SAID[p as Priority] ?? p.replace(/^./, (c) => c.toUpperCase())))
  }
  if (said(m.starts) || said(m.ends)) {
    const from = said(m.starts) ? date(said(m.starts)!.slice(0, 10)) : null
    const to = said(m.ends) ? date(said(m.ends)!.slice(0, 10)) : null
    parts.push(from && to ? DETAIL.between(from, to) : from ? DETAIL.startsOn(from) : DETAIL.until(to!))
  }
  /*
   * A project line names no object, so it says both names. A task line is
   * already headed by the task — under its *current* title, which is the new
   * one — so saying "to “X”" after it prints the same name twice and leaves
   * the only unrecoverable half, the old name, out.
   */
  if (said(m.renamed)) {
    const task = e.object_type === 'task'
    if (task) parts.push(said(m.was) ? DETAIL.taskWas(said(m.was)!) : DETAIL.taskRenamed)
    else parts.push(said(m.was) ? DETAIL.renamedTo(said(m.renamed)!, said(m.was)!) : DETAIL.renamedToOnly(said(m.renamed)!))
  }
  /* Only when the verb named something else, or it repeats itself. */
  if (m.described !== undefined && (said(m.renamed) || Array.isArray(m.tools))) {
    parts.push(m.described ? DETAIL.andDescription : DETAIL.andClearedDescription)
  }
  /* The labels the task has now, which is what the column holds after the
     change — not the ones added. Somebody reading a history wants the state
     each line left behind. */
  if (Array.isArray(m.labelled) && (m.labelled as string[]).length) {
    /* A phrase, like every other detail here: "to Doing", "for 20 Oct".
       The bare list ran straight on from the verb — "labelled it bug". */
    parts.push(DETAIL.labelledAs((m.labelled as string[]).join(', ')))
  }
  /* By the names on the tabs. "posts" and "messages" are words from the
     schema; nobody reading this has seen them — and the names live in one
     place, `web/src/data/tools.ts`, rather than in each screen that says
     them. */
  if (Array.isArray(m.tools)) {
    parts.push(
      DETAIL.toolsTo(
        (m.tools as string[])
          .map((t) => LABEL[t])
          .filter(Boolean)
          .join(', '),
      ),
    )
  }
  /* `asHours`, not a second formatter: this one said "2h 0m" for two hours,
     which the one the rest of the product uses has never said. */
  if (typeof m.minutes === 'number') parts.push(DETAIL.spent(asHours(m.minutes)))
  if (typeof m.was_minutes === 'number') parts.push(DETAIL.wasSpent(asHours(m.was_minutes)))
  if (said(m.role)) parts.push(DETAIL.roleTo(said(m.role)!))
  return parts.length ? parts.join(' · ') : null
}

/** The day a thing happened on, as a person says it. */
export function day(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString()
  if (same(d, now)) return WORDS.today
  const yesterday = new Date(now.getTime() - 86_400_000)
  if (same(d, yesterday)) return WORDS.yesterday
  return dayMonth(d, d.getFullYear() !== now.getFullYear())
}

/** The hour, because a page about what happened is read with a clock. */
export const clock = (iso: string) => new Date(iso).toLocaleTimeString(CLOCK, { hour: 'numeric', minute: '2-digit' })

/**
 * The verb for a line that does not name what it happened to.
 *
 * `verb` is written for the feed, where the object's name comes straight
 * after it: "Dev made TRA-50", "Dev said something on TRA-50". Beside the
 * object itself there is nothing to put there — the title is at the top of
 * the screen and repeating it on every line is twenty copies of it — and
 * those same verbs then dangle: "Dev made", "Dev said something on".
 *
 * So a transitive verb gets a word standing in for the thing. Not the title:
 * "it" is what somebody would say about the task they are looking at.
 *
 * Here rather than in the panel, because the panel is a second reader of one
 * log and the whole reason this file exists is that two readers must not
 * word the same event two ways.
 */
export function verbAlone(e: Event): string {
  const alone = ALONE[which(e)]
  /* French agrees with the thing: a task and an announcement are feminine,
     a document masculine. */
  return alone ? alone[e.object_type === 'task' || e.object_type === 'post' ? 1 : 0] : verb(e)
}

/**
 * Which of a project's tabs a line happened in.
 *
 * "Sam edited Launch plan" did not say whether Launch plan was a task, a
 * document or an announcement, and the three are opened from three tabs.
 * Read from the action, which already says what it acted on; a comment is
 * where the thing it is on is. Null for what has no tab — the project
 * being started, a person in the workspace.
 */
export function whereIn(e: Event): string | null {
  const [head] = e.action.split('.')
  if (head === 'task' || head === 'list' || head === 'cycle' || head === 'time') return 'tasks'
  if (head === 'post') return 'posts'
  if (head === 'file') return 'files'
  if (head === 'conversation' || head === 'message') return 'messages'
  if (head === 'project') {
    return e.action === 'project.create' || e.action === 'project.copy' || e.action === 'project.import' ? null : 'settings'
  }
  return null
}

/**
 * The day and the hour, for something said at a moment — "Today at 11:30",
 * "12 Oct at 14:05". An announcement is a dated statement, and "2026-10-12"
 * said when it was sent and not at what time.
 */
export const dayAndClock = (iso: string) => WORDS.dayAt(day(iso), clock(iso))
