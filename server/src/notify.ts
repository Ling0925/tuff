import { v7 as uuidv7 } from 'uuid'
import { publish, publishTo } from './realtime.js'
import { withActor, type Tx } from './db.js'
import type { AuthContext } from './auth/context.js'
import { asLanguage, languageOf, say, type Language } from './words.js'

/**
 * One inbox.
 *
 * No grid of checkboxes: the design allows exactly one preference, whether
 * chat counts, because a busy channel drowning the assignments is what makes
 * people stop reading an inbox at all. A matrix of switches is usually
 * invented to fix that and fixes it for nobody. Why a note arrived is one of
 * these — `docs/specs/notifications.md`.
 */
export type Reason =
  | 'mentioned'
  | 'assigned'
  | 'subscribed'
  | 'messaged'
  | 'joined'
  | 'posted'
  | 'replied'
  | 'due'
  | 'added'
  /* Chosen for a document. */
  | 'shared'
  | 'reminder'
  | 'unblocked'
  /* A question with choices, addressed to you. */
  | 'asked'

/* A reason addressed to the person outranks one about something they watch,
   when one thing earns somebody two. */
const RANK: Record<Reason, number> = {
  asked: 7,
  mentioned: 6,
  assigned: 5,
  replied: 4,
  posted: 3,
  added: 3,
  shared: 3,
  due: 3,
  reminder: 3,
  unblocked: 3,
  messaged: 2,
  joined: 2,
  subscribed: 1,
}

/**
 * The name of whoever is doing the thing, for the line a note carries —
 * and for somebody with none, "somebody" in the words of whoever reads it.
 */
export async function doer(tx: Tx, actorId: string): Promise<(language: Language) => string> {
  const [a] = await tx<{ name: string }[]>`select name from actor where id = ${actorId}`
  return (language) => a?.name ?? (language === 'fr' ? 'Quelqu’un' : 'Somebody')
}

/**
 * What a note says happened, written for each person it reaches in their
 * own language. The line is stored with the note
 * and read back by the inbox, the push and the digest as it was written,
 * so it is written once per reader rather than translated on the way out.
 * A plain string is for a line that is the same in every language.
 */
export type Line = string | null | ((language: Language) => string | null)

/** The lines themselves, a task being feminine: *terminée*, *attribuée*. */
export const LINES = (language: Language) =>
  say(
    {
      commented: [(who: string) => `${who} commented`, (who: string) => `${who} a commenté`],
      addedYou: [(who: string) => `${who} added you`, (who: string) => `${who} vous a ajouté`],
      /* Chosen for a document. */
      sharedYou: [(who: string) => `${who} shared a document with you`, (who: string) => `${who} a partagé un document avec vous`],
      posted: [(who: string) => `${who} posted`, (who: string) => `${who} a publié une annonce`],
      replied: [(who: string) => `${who} replied in a thread`, (who: string) => `${who} a répondu dans un fil de discussion`],
      gaveYou: [(who: string) => `${who} gave it to you`, (who: string) => `${who} vous l’a attribuée`],
      finished: [(who: string) => `${who} finished it`, (who: string) => `${who} l’a terminée`],
      reopened: [(who: string) => `${who} reopened it`, (who: string) => `${who} l’a rouverte`],
      moved: [
        (who: string, list: string) => `${who} moved it to ${list}`,
        (who: string, list: string) => `${who} l’a déplacée dans ${list}`,
      ],
      gave: [(who: string, to: string) => `${who} gave it to ${to}`, (who: string, to: string) => `${who} l’a attribuée à ${to}`],
      tookOff: [
        (who: string, off: string | null) => `${who} took ${off ?? 'the assignee'} off it`,
        (who: string, off: string | null) => (off ? `${who} a retiré ${off} de la tâche` : `${who} a retiré le responsable`),
      ],
      dated: [
        (who: string, day: string) => `${who} set the due date to ${day}`,
        (who: string, day: string) => `${who} a fixé l’échéance au ${day}`,
      ],
      undated: [(who: string) => `${who} took the due date off`, (who: string) => `${who} a retiré l’échéance`],
      wrote: [(who: string) => `${who} wrote in the description`, (who: string) => `${who} a écrit dans la description`],
      dueTomorrow: ['Due tomorrow', 'Échéance demain'],
      overdue: [(day: string) => `Overdue since ${day}`, (day: string) => `En retard depuis le ${day}`],
      reminder: ['Reminder', 'Rappel'],
      /* The handles, never a title, so a lock
         screen says no more than the inbox's subject does. */
      unblocked: [
        (done: string, task: string) => `${done} is done — you can start ${task}`,
        (done: string, task: string) => `${done} est terminée — vous pouvez commencer ${task}`,
      ],
      /* Never the question itself: a push
         puts the line on a lock screen. */
      asked: [(who: string) => `${who} asked a question`, (who: string) => `${who} a posé une question`],
      askedYou: [(who: string) => `${who} asked you a question`, (who: string) => `${who} vous pose une question`],
      answered: [(who: string) => `${who} answered your question`, (who: string) => `${who} a répondu à votre question`],
      handedOff: [
        'Agents handed this back and forth 3 times. Take a look.',
        'Des agents se sont passé ceci 3 fois de suite. Jetez-y un œil.',
      ],
      handoffCap: [
        'Agents handed work to each other 60 times in the last hour, so they were paused. Take a look.',
        'Des agents se sont passé du travail 60 fois en une heure, ils ont donc été mis en pause. Jetez-y un œil.',
      ],
    },
    language,
  )

/** A date as a line says it — `3 Nov`, `3 nov.` — read as a day, not a moment. */
export const shortDay = (on: string | Date, language: Language) =>
  new Date(typeof on === 'string' ? `${on.slice(0, 10)}T00:00:00Z` : on).toLocaleDateString(language === 'fr' ? 'fr-FR' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })

/** What was done, as the inbox draws it — the names of the lines above. */
export type Kind =
  | 'commented'
  | 'added'
  | 'posted'
  | 'replied'
  | 'finished'
  | 'reopened'
  | 'moved'
  | 'gave'
  | 'took_off'
  | 'dated'
  | 'undated'
  | 'wrote'
  | 'due'
  | 'overdue'
  | 'reminder'
  | 'unblocked'
  | 'asked'
  | 'answered'
  | 'handoff'
  | 'handoff_cap'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Mentions are `@` followed by a uuid in the stored body, or a `mention` node
 * — `{ type: 'mention', attrs: { id, label } }` — which is what the chat's
 * line writes when somebody picks a name after @.
 */
export function mentionedIds(body: unknown): string[] {
  const text = JSON.stringify(body ?? {})
  const found = text.match(/@([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi)
  const ids = new Set((found ?? []).map((m) => m.slice(1).toLowerCase()))
  const walk = (n: unknown) => {
    if (!n || typeof n !== 'object') return
    const node = n as { type?: unknown; attrs?: { id?: unknown }; content?: unknown }
    if (node.type === 'mention' && typeof node.attrs?.id === 'string' && UUID.test(node.attrs.id)) ids.add(node.attrs.id.toLowerCase())
    /* The whole room, called by name — `docs/specs/notifications.md`. */
    if (node.type === 'mention' && node.attrs?.id === 'everyone') ids.add('everyone')
    if (Array.isArray(node.content)) node.content.forEach(walk)
  }
  walk(body)
  return [...ids]
}

/**
 * When this may leave.
 *
 * Quiet hours hold it rather than dropping it: somebody who is not at work
 * should not be woken and should still find everything in the morning. The
 * comparison happens in the person's own zone, because "ten at night" means
 * nothing without one.
 */
type Prefs = {
  notify_chat: boolean
  quiet_from: string | null
  quiet_to: string | null
  timezone: string
}

/**
 * Somebody else's preferences, through a security definer function.
 *
 * app_user is readable only by the actor it belongs to, so asking for another
 * person's row as the person doing the thing returns nothing — and a "no row"
 * that means "send it immediately" is a check that reads as working and does
 * not. Quiet hours and the chat switch were both dead this way, silently.
 */
async function prefsFor(tx: Tx, actorId: string): Promise<Prefs> {
  const [row] = await tx<Prefs[]>`select * from notify_prefs(${actorId})`
  // No row means an actor with no account of their own. Defaulting to "tell
  // them, and do not hold it" is the safe direction: losing a notification is
  // worse than sending one, and a missing row silently meaning "skip" is the
  // same shape of bug this function was written to fix.
  return row ?? { notify_chat: true, quiet_from: null, quiet_to: null, timezone: 'UTC' }
}

async function deliverAfter(tx: Tx, u: Prefs): Promise<'now' | string> {
  if (!u.quiet_from || !u.quiet_to) return 'now'
  /* A zone kept before zones were checked, and not one the database knows,
     is read as UTC rather than failing the write of whoever is telling
     them something. */
  const [zone] = await tx<{ ok: boolean }[]>`select exists (select 1 from pg_timezone_names where name = ${u.timezone}) as ok`
  if (!zone?.ok) u = { ...u, timezone: 'UTC' }

  const [row] = await tx<{ next: string | null }[]>`
    select case
      when (now() at time zone ${u.timezone})::time
           between ${u.quiet_from}::time and ${u.quiet_to}::time
      then ((now() at time zone ${u.timezone})::date + ${u.quiet_to}::time)
             at time zone ${u.timezone}
      when ${u.quiet_from}::time > ${u.quiet_to}::time
           and ((now() at time zone ${u.timezone})::time >= ${u.quiet_from}::time
                or (now() at time zone ${u.timezone})::time < ${u.quiet_to}::time)
      then (((now() at time zone ${u.timezone})::date
             + case when (now() at time zone ${u.timezone})::time >= ${u.quiet_from}::time
                    then 1 else 0 end)
            + ${u.quiet_to}::time) at time zone ${u.timezone}
      else null
    end as next`
  return row?.next ?? 'now'
}

/**
 * Of the people a body names, the ones to tell.
 *
 * Only those who may read the thing it is on. A task, an announcement or a
 * file lives in a project — a file sent in a room, in that room too — and a
 * name typed into it can be anybody's in the workspace: the web offers only
 * the project's people, but a body arrives from MCP, from GitHub and from an
 * import as well. Somebody who could not read it was written a note: the
 * inbox hid it and the push and the email were stopped on the way out
 * (`stillSees` in `push.ts`), but the row was theirs and the live ping
 * reached them. Asked of the database as each of them, through the read
 * policies' own functions — `may_read`, migration 188 — so there is one
 * rule for who reads a project, not a copy of it here.
 *
 * And not those already told: a mention of this thing they have not read
 * yet is the same mention, whatever was taken out and put back since.
 *
 * Anything else — a thing not found — tells nobody. `docs/specs/task-mentions.md`.
 */
async function readers(tx: Tx, type: string, objectId: string, ids: string[]): Promise<string[]> {
  const people = ids.filter((id) => id !== 'everyone')
  const rest = ids.filter((id) => id === 'everyone')
  if (people.length === 0) return rest
  if (!['task', 'post', 'file'].includes(type)) return ids
  const rows = await tx<{ id: string }[]>`
    select x as id from unnest(${people}::uuid[]) x
    where may_read(x, ${type}::object_kind, ${objectId})
      and x not in (select already_named(${people}::uuid[], ${type}::object_kind, ${objectId}))`
  const may = new Set(rows.map((r) => r.id))
  return [...rest, ...people.filter((id) => may.has(id))]
}

/**
 * Tell the people who should hear about it — `docs/specs/notifications.md`.
 *
 * Never the person who did it: an inbox that reports your own actions back to
 * you is one people learn to ignore.
 */
export async function notify(
  tx: Tx,
  ctx: AuthContext,
  about: {
    objectType: 'post' | 'task' | 'file' | 'message' | 'conversation' | 'project'
    objectId: string
    body?: unknown
    /** Somebody just put on the task; they hear about it whatever else is true. */
    assignees?: string[]
    /** Chat is the one thing a person can switch off separately. */
    isChat?: boolean
    /**
     * What happened, in the product's words — never what anybody wrote,
     * because a push puts it on a lock screen.
     */
    what?: Line
    /**
     * What kind of thing was done — `commented`, `finished`, `moved` — so
     * the inbox can draw its glyph without reading the line, which is in
     * the reader's language. `docs/specs/inbox.md`.
     */
    kind?: Kind
    /** Whether the people watching hear about it; a save of nothing tells nobody. */
    watchers?: boolean
    /** The line for one reason in place of `what` — "gave it to you" for the
        person given it, where the watchers read who it went to. */
    whatFor?: Partial<Record<Reason, Line>>
    /** Others it is addressed to, for a reason of their own: an announcement's
        project, a thread's people. */
    also?: { ids: string[]; reason: Reason }
  },
): Promise<void> {
  const targets = new Map<string, Reason>()
  const put = (id: string, reason: Reason) => {
    const had = targets.get(id)
    if (!had || RANK[reason] > RANK[had]) targets.set(id, reason)
  }

  for (const id of about.assignees ?? []) {
    put(id, 'assigned')
    /* The person on a task follows it, as its maker and anybody who wrote
       on it do — or they hear about the giving and nothing after. Written
       through a definer function: a subscription is its owner's row. */
    if (about.objectType === 'task' && id !== ctx.actorId) {
      await tx`select follow_for(${ctx.workspaceId}, 'task'::object_kind, ${about.objectId}, ${id})`
    }
  }
  const named = await readers(tx, about.objectType, about.objectId, mentionedIds(about.body))
  for (const id of named) if (id !== 'everyone') put(id, 'mentioned')
  if (named.includes('everyone') && about.objectType === 'conversation') {
    const room = await tx<{ actor_id: string }[]>`select * from room_people(${about.objectId})`
    for (const r of room) put(r.actor_id, 'mentioned')
  }
  for (const id of about.also?.ids ?? []) put(id, about.also!.reason)

  if (about.watchers !== false) {
    // Through the security definer function: a subscription is visible only to
    // the person who made it, so reading the table here would see only the
    // caller's own and decide nobody was watching.
    const subscribed = await tx<{ actor_id: string }[]>`
      select * from subscribers(${ctx.workspaceId}, ${about.objectType}::object_kind,
                                ${about.objectId})`
    for (const s of subscribed) put(s.actor_id, 'subscribed')
  }

  /*
   * A direct conversation tells everybody in it.
   * Not a channel: a room for a project or a team is followed at the level
   * each person set for it, and every message of a busy channel on every
   * phone is how people learn to switch the product off.
   */
  /*
   * And a message to an agent, in a conversation of the two of them, is
   * addressed to it as a mention is.
   * As `messaged` it was a note for a phone the agent does not
   * have: the inbox leaves those out, `my_mentions` read only mentions and
   * no webhook fired, so "Hi" in a DM with an agent reached nothing.
   * As a mention it is a hand-off like any, counted by the
   * chain below. In a conversation of three or more, an agent hears only
   * its name, as in a channel: every line of a group's chat waking it is
   * not what anybody asked it for.
   */
  if (about.objectType === 'conversation') {
    const others = await tx<{ actor_id: string; agent: boolean; two: boolean }[]>`
      select cm.actor_id,
             exists (select 1 from agent g where g.actor_id = cm.actor_id and g.deleted_at is null) as agent,
             (select count(*) from conversation_member x
              where x.conversation_id = c.id and x.deleted_at is null and x.joined_at is not null) = 2 as two
      from conversation_member cm
      join conversation c on c.id = cm.conversation_id
      where cm.conversation_id = ${about.objectId} and not c.channel and c.project_id is null
        and cm.deleted_at is null and cm.joined_at is not null`
    for (const o of others) put(o.actor_id, o.agent && o.two ? 'mentioned' : 'messaged')
  }

  targets.delete(ctx.actorId)

  /*
   * A document is told only to who may read it now.
   * Following it is kept when somebody is taken off its chosen people, and
   * whoever follows it must not go on hearing about it, nor learn it is
   * still there. Asked as each of them, as a mention is (`may_read`).
   */
  if (about.objectType === 'file' && targets.size) {
    const ids = [...targets.keys()]
    const may = await tx<{ id: string }[]>`
      select x as id from unnest(${ids}::uuid[]) x where may_read(x, 'file'::object_kind, ${about.objectId})`
    const keep = new Set(may.map((r) => r.id))
    for (const id of ids) if (!keep.has(id)) targets.delete(id)
  }

  /*
   * A hand-off to an agent, counted.
   * The count follows the agent, not
   * the thing: an agent's hand-off is one more than the latest that reached
   * it, on anything, in the last day; a person's own is 0 and starts it
   * again; what GitHub, an import, a board or a feedback page did is
   * nobody's (`none`) and neither counts nor starts it again. The third in
   * a row is not sent, and the thing is put in front of the people; past
   * sixty agent-to-agent hand-offs an hour in the workspace, none is. The
   * count is written on each note by a trigger, from what is set here
   * (migrations 255, 256).
   */
  const handed = [...targets].filter(([, r]) => r === 'assigned' || r === 'mentioned' || r === 'replied').map(([id]) => id)
  const agents = handed.length
    ? await tx<{ actor_id: string; created_by: string }[]>`
        select actor_id, created_by from agent where actor_id = any(${handed}::uuid[]) and deleted_at is null`
    : []
  /* Those it would wake: a reply in a thread wakes nothing, so it is
     counted but never stops anything nor raises the alarm. Second review
     of. */
  const waking = agents.filter((a) => {
    const r = targets.get(a.actor_id)
    return r === 'assigned' || r === 'mentioned'
  })
  const handedOff = new Set(agents.map((a) => a.actor_id))
  const lately = async () => {
    const [n] = await tx<{ n: number }[]>`select agent_handoffs_lately(${ctx.workspaceId}) as n`
    return n?.n ?? 0
  }
  if (agents.length) {
    const nobodys = ctx.viaGithub || ctx.viaImport || ctx.board || ctx.feedbackPage
    if (nobodys) {
      /* Nobody's hand-off wakes nobody: what GitHub, an import, a board's
         guest or a feedback page names reaches no agent, neither its
         webhook nor its inbox — a stranger on a feedback page who knew an
         agent's id could name it as often as they liked (migration 259). */
      for (const a of agents) targets.delete(a.actor_id)
      await tx`select set_config('app.agent_chain', 'none', true)`
    } else if (!ctx.agent) {
      /* A person's own token handing work to agents is 0, but counted by
         the backstop: a loop of tools driven by somebody's token is a loop. */
      if (ctx.viaMcp && waking.length && (await lately()) >= HANDOFFS_PER_HOUR) {
        for (const a of waking) targets.delete(a.actor_id)
        await chainStopped(tx, ctx, about.objectType, about.objectId, waking, 'cap')
      } else {
        await tx`select set_config('app.agent_chain', ${ctx.viaMcp ? '0t' : '0'}, true)`
      }
    } else {
      const [c] = await tx<{ n: number }[]>`select agent_chain(${about.objectType}::object_kind, ${about.objectId}) as n`
      const depth = c?.n ?? 1
      if (depth >= CHAIN_MOST) {
        for (const a of agents) targets.delete(a.actor_id)
        if (waking.length) await chainStopped(tx, ctx, about.objectType, about.objectId, waking, 'chain')
      } else if (waking.length && (await lately()) >= HANDOFFS_PER_HOUR) {
        for (const a of agents) targets.delete(a.actor_id)
        await chainStopped(tx, ctx, about.objectType, about.objectId, waking, 'cap')
      } else {
        await tx`select set_config('app.agent_chain', ${String(depth)}, true)`
      }
    }
  }
  if (targets.size === 0) return

  /*
   * How loud the room is for each of them.
   * Nothing is nothing, named or not; mentions only lets a name through, and
   * a reply in a thread they are in, which is addressed to them.
   */
  if (about.objectType === 'conversation') {
    const levels = await tx<{ actor_id: string; notify: string }[]>`
      select actor_id, notify from conversation_member
      where conversation_id = ${about.objectId} and deleted_at is null
        and actor_id = any(${[...targets.keys()]}::uuid[])`
    for (const l of levels) {
      const why = targets.get(l.actor_id)
      if (l.notify === 'none') targets.delete(l.actor_id)
      else if (l.notify === 'mentions' && why !== 'mentioned' && why !== 'replied' && why !== 'asked') targets.delete(l.actor_id)
    }
    if (targets.size === 0) return
  }

  /*
   * Everybody at once.
   *
   * It was three or four queries a person — their switch, their quiet
   * hours, the insert, the notice — inside the request of whoever did the
   * thing, which nobody noticed while a task had a handful of watchers and
   * an announcement told nobody. An announcement to a project of a thousand
   * would have held the press of Publish for seconds. Now it is one query
   * for everybody's hours, one insert for every note that is not merged,
   * one per note that is, and one notice per reason.
   * `docs/specs/notifications.md`.
   */
  /* Only people still in the workspace: `notify_many` wrote no note for
     somebody removed, but the notice below still reached their socket —
     `docs/specs/removing-someone.md`. And joined: a workspace waiting for
     its person's Join sends them nothing (`password-after-proof.md`). */
  const here = await tx<{ actor_id: string }[]>`
    select actor_id from membership
    where workspace_id = ${ctx.workspaceId} and actor_id = any(${[...targets.keys()]}::uuid[]) and deleted_at is null
      and joined_at is not null
      /* Nor an agent, for what came from GitHub: anybody who can comment on
         a public issue could otherwise set it going — giving an agent work
         is a person's decision here. */
      and not (${ctx.viaGithub === true} and exists (select 1 from agent g where g.actor_id = membership.actor_id))`
  const ids = here.map((r) => r.actor_id)
  if (ids.length === 0) return
  const hours = await tx<{ actor_id: string; notify_chat: boolean; at: Date }[]>`
    select * from notify_when(${ids}::uuid[])`
  /* Each reader's language, asked once for all of them and only when a
     line is written per language. */
  const said = [about.what, ...Object.values(about.whatFor ?? {})]
  const reads = new Map<string, Language>()
  if (said.some((l) => typeof l === 'function')) {
    const rows = await tx<{ actor_id: string; language: string }[]>`
      select x as actor_id, language_of(x) as language from unnest(${ids}::uuid[]) x`
    for (const r of rows) reads.set(r.actor_id, asLanguage(r.language))
  }
  const written = (l: Line | undefined, actor: string): string | null =>
    typeof l === 'function' ? l(reads.get(actor) ?? 'en') : (l ?? null)
  const told = new Map<Reason, string[]>()
  const plain: { id: string; actor: string; reason: Reason; what: string | null; at: Date }[] = []
  const kind = about.kind ?? null
  for (const h of hours) {
    const reason = targets.get(h.actor_id)!
    if (about.isChat && !h.notify_chat) continue
    /*
     * Some notes wait before they may leave.
     *
     * A message waits ten seconds, so somebody with the conversation open has
     * read it by then and is not told about what they are looking at —
     * `due_notifications` skips what is read. A reply in a thread the same.
     * Something you are watching waits thirty, and whatever else happens to
     * it in that time replaces the line rather than adding a note: a card
     * moved and then given a date is one note saying the last of them.
     */
    const wait = reason === 'messaged' || reason === 'replied' ? 10 : reason === 'subscribed' ? 30 : 0
    /* From the database's clock, which `h.at` is — its `now()`, or the end
       of quiet hours — and never this process's. The two are different
       machines, and a note due "now" by a clock a little ahead of the
       database's was in the future to every query that asked for what is
       due: a mention missing from the inbox, now and then, for a moment. */
    const at = new Date(new Date(h.at).getTime() + wait * 1000)
    const what = written(about.whatFor?.[reason] !== undefined ? about.whatFor[reason] : about.what, h.actor_id)
    if (reason === 'subscribed' || reason === 'replied') {
      /* Never merged into an agent's note: a merge moves its time and
         keeps its count, and a person's 0 kept fresh that way reset the
         agent's chain on every hop (migration 258). */
      await tx`
        select notify_once(${uuidv7()}, ${ctx.workspaceId}, ${h.actor_id}, ${reason}::notify_reason,
                           ${about.objectType}::object_kind, ${about.objectId}, ${what}, ${at},
                           ${!handedOff.has(h.actor_id)}, ${kind}, true)`
    } else {
      plain.push({ id: uuidv7(), actor: h.actor_id, reason, what, at })
    }
    told.set(reason, [...(told.get(reason) ?? []), h.actor_id])
  }
  if (plain.length) {
    await tx`
      select notify_many(${ctx.workspaceId}, ${plain.map((p) => p.id)}::uuid[], ${plain.map((p) => p.actor)}::uuid[],
                         ${plain.map((p) => p.reason)}::notify_reason[], ${about.objectType}::object_kind,
                         ${about.objectId}, ${plain.map((p) => p.what)}::text[], ${plain.map((p) => p.at.toISOString())}::timestamptz[],
                         ${plain.map(() => kind)}::text[])`
  }
  /* And the people hear about it rather than finding it on a reload.
     Addressed to each of them, not broadcast to a project: this is the one
     topic whose shape is "something that is yours to know about". */
  /* With what it is about, so a socket held by a token made for some
     projects can leave out the words about others. */
  for (const [reason, who] of told) {
    await publishTo(
      tx,
      who.map((id) => `actor:${id}`),
      'notification',
      { reason, object_type: about.objectType, object_id: about.objectId, workspace_id: ctx.workspaceId },
    )
  }
}

/** How many agents in a row may hand work on before it goes to the people. */
export const CHAIN_MOST = 3
/** Agent-to-agent hand-offs a workspace sends in an hour, at most — the backstop under the chain. */
export const HANDOFFS_PER_HOUR = 60
/** Hand-off alarms one person is sent in an hour, at most, whatever they are about. */
export const HANDOFF_ALARMS_PER_HOUR = 5

/**
 * A hand-off between agents stopped: what they were handing round goes to
 * the people instead. The chain stopped on a task is a question in its
 * Needs you (`askAboutChain`); anywhere else, or the hour's backstop held,
 * a note of the same kind to whoever connected the agents — the backstop's
 * once an hour a person.
 */
async function chainStopped(
  tx: Tx,
  ctx: AuthContext,
  objectType: 'post' | 'task' | 'file' | 'message' | 'conversation' | 'project',
  objectId: string,
  agents: { actor_id: string; created_by: string }[],
  why: 'chain' | 'cap',
): Promise<void> {
  const [mine] = await tx<{ created_by: string }[]>`select created_by from agent where actor_id = ${ctx.actorId}`
  const connectors = [...new Set([...(mine ? [mine.created_by] : []), ...agents.map((a) => a.created_by)])]
  if (why === 'chain' && objectType === 'task') {
    const { askAboutChain } = await import('./questions.js')
    await askAboutChain(tx, ctx, objectId, connectors)
    return
  }
  const here = await tx<{ actor_id: string }[]>`
    select actor_id from membership
    where workspace_id = ${ctx.workspaceId} and actor_id = any(${connectors}::uuid[]) and deleted_at is null
      and not exists (select 1 from agent g where g.actor_id = membership.actor_id)
      ${
        why === 'cap'
          ? tx`and not told_of_handoff_cap(${ctx.workspaceId}, membership.actor_id)`
          : tx`and not told_of_handoff(${ctx.workspaceId}, membership.actor_id, ${objectId})`
      }
      /* And five alarms an hour a person, whatever they are about. */
      and handoff_alarms_lately(${ctx.workspaceId}, membership.actor_id) < ${HANDOFF_ALARMS_PER_HOUR}`
  if (!here.length) return
  /* Written straight rather than through `notify`, which never tells the
     one acting: a person whose own token drove the loop is the first who
     should hear that it was stopped. Held by quiet hours like any note
     (`notify_when`). */
  const kind = why === 'cap' ? 'handoff_cap' : 'handoff'
  const hours = await tx<{ actor_id: string; at: Date }[]>`select actor_id, at from notify_when(${here.map((h) => h.actor_id)}::uuid[])`
  const ids = hours.map((h) => h.actor_id)
  if (!ids.length) return
  const whats = await Promise.all(
    ids.map(async (id) => {
      const W = LINES(await languageOf(tx, id))
      return why === 'cap' ? W.handoffCap : W.handedOff
    }),
  )
  await tx`
    select notify_many(${ctx.workspaceId}, ${ids.map(() => uuidv7())}::uuid[], ${ids}::uuid[],
                       ${ids.map(() => 'asked')}::notify_reason[], ${objectType}::object_kind, ${objectId},
                       ${whats}::text[], ${hours.map((h) => new Date(h.at).toISOString())}::timestamptz[], ${ids.map(() => kind)}::text[])`
  await publishTo(
    tx,
    ids.map((id) => `actor:${id}`),
    'notification',
    { reason: 'asked', object_type: objectType, object_id: objectId, workspace_id: ctx.workspaceId },
  )
}

/**
 * A note from no request — a reminder of a date, which the worker writes
 * as the person it is for (`docs/specs/notifications.md`). Quiet hours hold
 * it like any other.
 */
export async function remind(
  workspaceId: string,
  actorId: string,
  taskId: string,
  line: string | ((language: Language) => string),
  kind: 'due' | 'overdue' = 'due',
): Promise<void> {
  await withActor(actorId, workspaceId, async (tx) => {
    const when = await deliverAfter(tx, await prefsFor(tx, actorId))
    const what = typeof line === 'function' ? line(await languageOf(tx, actorId)) : line
    await tx`
      select notify_once(${uuidv7()}, ${workspaceId}, ${actorId}, 'due'::notify_reason,
                         'task'::object_kind, ${taskId}, ${what},
                         ${when === 'now' ? tx`now()` : when}::timestamptz, false,
                         ${kind}, false)`
    await publish(
      `actor:${actorId}`,
      'notification',
      { reason: 'due', object_type: 'task', object_id: taskId, workspace_id: workspaceId },
      tx,
    )
  })
}

/**
 * A reminder somebody set for themselves, come due.
 *
 * Asked as them, through the policies a read goes through: a task gone, a
 * project gone, a task finished, or one they may no longer see is told of
 * nothing, and `false` says so. The row was taken when it was claimed, so
 * either way it is cleared.
 *
 * Not held by quiet hours: this is the one note whose moment the person
 * chose. Never merged either — it is addressed to them, like `due`.
 */
export async function remindChosen(workspaceId: string, actorId: string, taskId: string): Promise<boolean> {
  return withActor(actorId, workspaceId, async (tx) => {
    const [open] = await tx<{ id: string }[]>`
      select t.id from task t join project p on p.id = t.project_id and p.deleted_at is null
      where t.id = ${taskId} and t.deleted_at is null and t.completed_at is null`
    if (!open) return false
    const what = LINES(await languageOf(tx, actorId)).reminder
    await tx`
      select notify_once(${uuidv7()}, ${workspaceId}, ${actorId}, 'reminder'::notify_reason,
                         'task'::object_kind, ${taskId}, ${what}, now(), false, 'reminder', false)`
    await publish(
      `actor:${actorId}`,
      'notification',
      { reason: 'reminder', object_type: 'task', object_id: taskId, workspace_id: workspaceId },
      tx,
    )
    return true
  }).catch((e) => {
    console.error('worker: a chosen reminder failed', e)
    return false
  })
}

/**
 * Somebody followed an invitation, and whoever sent it hears so —
 * `docs/specs/inbox.md`.
 *
 * Asked as the person who has just joined, since they are a member now and
 * the note is written into the workspace they joined; who sent the
 * invitation is read as nobody, because invitations are the managers' to
 * read. Quiet hours hold it like any other note. Never a reason for the
 * joining to fail: they are in, and a note that could not be written is
 * not something to refuse them over.
 */
export async function tellInviter(workspaceId: string, actorId: string): Promise<void> {
  await withActor(actorId, workspaceId, async (tx) => {
    const [row] = await tx<{ id: string | null }[]>`select inviter_of(${workspaceId}, ${actorId}) as id`
    if (!row?.id) return
    const when = await deliverAfter(tx, await prefsFor(tx, row.id))
    await tx`
      insert into notification
        (id, workspace_id, actor_id, reason, object_type, object_id, deliver_after, by_id)
      values (${uuidv7()}, ${workspaceId}, ${row.id}, 'joined'::notify_reason,
              'actor'::object_kind, ${actorId}, ${when === 'now' ? tx`now()` : when}, ${actorId})`
    await publish(
      `actor:${row.id}`,
      'notification',
      { reason: 'joined', object_type: 'actor', object_id: actorId, workspace_id: workspaceId },
      tx,
    )
  }).catch(() => {})
}

/**
 * Autolinks.
 *
 * A reference to another object in a body creates a link, and the link points
 * both ways — following it back is what stops a decision living only in the
 * place it was written.
 */
/**
 * Where a file was first put — `docs/specs/docs.md`. Every file a body
 * carries that has no place yet is given this one; a file already used
 * somewhere keeps the first place it was used.
 */
export async function claimFiles(tx: Tx, from: { type: 'post' | 'task' | 'file' | 'message'; id: string }, body: unknown): Promise<void> {
  const ids = new Set<string>()
  const walk = (n: unknown) => {
    if (!n || typeof n !== 'object') return
    const node = n as { attrs?: { fileId?: unknown }; content?: unknown }
    if (typeof node.attrs?.fileId === 'string' && UUID.test(node.attrs.fileId)) ids.add(node.attrs.fileId)
    if (Array.isArray(node.content)) node.content.forEach(walk)
  }
  walk(body)
  if (ids.size === 0) return
  /*
   * A task, an announcement or a message is where a file with no place
   * first was. A document is never made a file's place here — only an
   * upload sent `into` it is — and no body ever changes the place of a
   * file that has one: a picture put into a document follows that
   * document, wherever else it is named.
   */
  if (from.type === 'file') return
  /*
   * A message is the place only of what its writer sent into its room.
   * Any file with no
   * place yet was taken by any message naming its id, and the feed's
   * `file.upload` line says the id before its uploader presses send: a
   * member named a colleague's picture in a message of their own, deleted
   * that message, and the picture went with it.
   */
  if (from.type === 'message') {
    await tx`
      update file set origin_type = 'message', origin_id = ${from.id}
      where id = any(${[...ids]}::uuid[]) and origin_type is null
        and author_id = current_actor()
        and conversation_id = (select m.conversation_id from message m where m.id = ${from.id})`
    return
  }
  await tx`
    update file set origin_type = ${from.type}, origin_id = ${from.id}
    where id = any(${[...ids]}::uuid[]) and origin_type is null and id <> ${from.id}`
}

/**
 * A body with the documents it names that the project does not have said
 * without their names. A task made from a
 * draft's line, or a message or comment naming a draft, would otherwise
 * carry its title to everybody who reads it. The chip keeps the id and
 * loses `title` and `number` — the keys themselves, so a reader that falls
 * back on a missing one (the iPhone app says "Document") does. Which
 * documents are kept is asked of the database whoever writes
 * (`kept_documents`): a writer who cannot see a draft cannot name it.
 */
export async function veilDocrefs<T>(tx: Tx, body: T): Promise<T> {
  if (!body || typeof body !== 'object') return body
  const ids = new Set<string>()
  const walk = (n: unknown) => {
    if (!n || typeof n !== 'object') return
    const node = n as { type?: unknown; attrs?: { id?: unknown }; content?: unknown }
    if (node.type === 'docref' && typeof node.attrs?.id === 'string' && UUID.test(node.attrs.id)) ids.add(node.attrs.id)
    if (Array.isArray(node.content)) node.content.forEach(walk)
  }
  walk(body)
  if (ids.size === 0) return body
  const kept = new Set((await tx<{ id: string }[]>`select id::text from kept_documents(${[...ids]}::uuid[]) as k(id)`).map((r) => r.id))
  if (kept.size === 0) return body
  const veil = (n: unknown): unknown => {
    if (!n || typeof n !== 'object') return n
    const node = n as { type?: unknown; attrs?: Record<string, unknown>; content?: unknown }
    const content = Array.isArray(node.content) ? node.content.map(veil) : node.content
    if (node.type === 'docref' && typeof node.attrs?.id === 'string' && kept.has(node.attrs.id.toLowerCase())) {
      const { title: _title, number: _number, ...attrs } = node.attrs
      return { ...node, attrs, ...(content === undefined ? {} : { content }) }
    }
    return content === undefined ? node : { ...node, content }
  }
  return veil(body) as T
}

const UUID_ONLY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function linkMentionedObjects(
  tx: Tx,
  ctx: AuthContext,
  from: { type: 'post' | 'task' | 'file' | 'message'; id: string },
  body: unknown,
): Promise<number> {
  await claimFiles(tx, from, body)
  const text = JSON.stringify(body ?? {})
  const refs: string[] = [
    ...(text.match(/\/(posts|tasks|files|messages)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi) ?? []),
  ]
  /* And the things a body names as nodes — a task or a document picked
     with `#`, a task made from a document's line, which points back at the
     document it came from. Read as the same
     address the pattern above finds. */
  const walk = (n: unknown) => {
    if (!n || typeof n !== 'object') return
    const node = n as { type?: unknown; attrs?: { id?: unknown }; content?: unknown[] }
    const id = typeof node.attrs?.id === 'string' && UUID_ONLY.test(node.attrs.id) ? node.attrs.id : null
    if (id && node.type === 'taskref') refs.push(`/tasks/${id}`)
    if (id && node.type === 'docref') refs.push(`/files/${id}`)
    if (Array.isArray(node.content)) node.content.forEach(walk)
  }
  walk(body)
  if (!refs.length) return 0

  const seen = new Set<string>()
  let made = 0
  for (const ref of refs) {
    const [, plural, id] = ref.match(/\/(\w+)\/(.+)/) ?? []
    if (!plural || !id) continue
    const type = plural.slice(0, -1) as 'post' | 'task' | 'file' | 'message'
    const key = `${type}:${id}`
    if (seen.has(key) || id === from.id) continue
    seen.add(key)

    // Both directions in one go. A backlink created later by a separate pass
    // is a backlink that is missing exactly when somebody looks.
    for (const [a, b] of [
      [from, { type, id }],
      [{ type, id }, from],
    ] as const) {
      await tx`
        insert into object_link
          (id, workspace_id, from_type, from_id, to_type, to_id, created_by)
        values (${uuidv7()}, ${ctx.workspaceId}, ${a.type}::object_kind, ${a.id},
                ${b.type}::object_kind, ${b.id}, ${ctx.actorId})
        on conflict do nothing`
    }
    made++
  }
  return made
}
