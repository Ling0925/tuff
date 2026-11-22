import { Hono } from 'hono'
import { z } from 'zod'
import { can, Role } from '@tracker/shared-schema'
import { withActor, withActorEverywhere } from '../db.js'
import { statusByAgent } from '../doing.js'
import { todayFor, zoneOf } from '../day.js'
import { faced } from '../storage.js'
import { allow, planSaid, type AuthContext } from '../auth/context.js'
import { record } from './activity.js'
import { startNowhereSession, startSession } from '../auth/flows.js'
import { metaOf } from './limits.js'

type Vars = { ctx: AuthContext }
export const people = new Hono<{ Variables: Vars }>()

/**
 * Who is in the workspace.
 *
 * One list, and nobody is annotated on it. The roster used to carry an
 * `outside` column, computed from a flag on project membership, so an
 * agency's client did not read as a colleague. There is no such person now
 * — and the column went with them, which also took
 * the 351 ms this screen spent on it against the design's thousand members.
 */
people.get('/people', async (c) => {
  const ctx = c.get('ctx')
  if (!allow(ctx, 'people.read')) return c.json({ error: { code: 'forbidden' } }, 403)

  /* With what each agent says it is doing now, sent beside the roster on
     the same connection rather than after it. */
  const [rows, doing] = await withActor(ctx.actorId, ctx.workspaceId, (tx) =>
    Promise.all([
      /* A member waiting for their own Join since their address was proved
         (no `joined_at`) is shown by name and face, which every line the
         account wrote here already shows, and nothing they keep for the
         workspaces they are in: no title, and no presence, which would say
         when they are online elsewhere — `password-after-proof.md`. */
      tx`select m.actor_id, a.name, a.avatar_key, case when m.joined_at is not null then a.title end as title,
              m.role, m.joined_at,
              m.may_create_projects, m.may_create_channels,
              m.may_see_members, m.may_invite_people, m.may_connect_agents,
              -- An agent is in the workspace as a person is, and drawn
              -- apart from the people.
              exists (select 1 from agent g where g.actor_id = m.actor_id and g.deleted_at is null) as agent,
              -- Here, away or busy -- docs/specs/presence.md. One function
              -- answers it so no screen invents its own threshold.
              case when m.joined_at is not null then presence_of(a.seen_at, a.presence) end as presence,
              -- An agent's last visit, which a task it is working on shows.
              h.active_at
       from membership m
       join actor a on a.id = m.actor_id
       left join agents_last_here() h on h.actor_id = m.actor_id
       where m.workspace_id = ${ctx.workspaceId} and m.deleted_at is null
         /* Not a feedback page's actor, which files requests and is nobody
            to pick, invite or count. */
         and not page_actor(m.actor_id)
       /* People first, the agents under them. */
       order by exists (select 1 from agent g where g.actor_id = m.actor_id and g.deleted_at is null), a.name`,
      statusByAgent(tx),
    ]),
  )
  /* What each of them may start, said once here rather than worked out by
     every client from a switch and a flag — `docs/specs/member-rights.md`. */
  return c.json({
    people: rows.map(({ active_at, ...r }) => ({
      ...faced(r),
      ...(r.agent
        ? { active_at: active_at ? (active_at as Date).toISOString() : null, status: doing.get(String(r.actor_id)) ?? null }
        : {}),
      creates_projects: can('project.create', {
        role: r.role,
        settings: ctx.settings,
        mayCreateProjects: r.may_create_projects,
      }),
      sees_members: can('members.read', {
        role: r.role,
        settings: ctx.settings,
        maySeeMembers: r.may_see_members,
      }),
      invites_people: can('people.invite', {
        role: r.role,
        settings: ctx.settings,
        mayInvitePeople: r.may_invite_people,
      }),
      connects_agents: can('agent.connect', {
        role: r.role,
        settings: ctx.settings,
        ...planSaid(ctx),
        mayConnectAgents: r.may_connect_agents === true,
      }),
    })),
  })
})

/**
 * One person: who they are, where they are working, and what is on them.
 *
 * `/members/:actorId` has been an address since routing arrived, and what it
 * drew was a name, a role and three ways to administer somebody. Nothing said
 * what they were doing, which is the question anybody opening a colleague's
 * name is asking.
 *
 * Bounded by what the **asker** can see, and not by a filter here: the query
 * runs as them under row-level security, so a project they are not on is not
 * a row to leave out. The screen is a slice and says so rather than implying
 * it is everything.
 */
people.get('/people/:actorId', async (c) => {
  const ctx = c.get('ctx')
  /* Not to an agent: a colleague's address and time zone are a person's to
     read, and an agent's token may sit with a service outside. */
  if (!allow(ctx, 'people.read') || ctx.agent) return c.json({ error: { code: 'forbidden' } }, 403)
  const who = c.req.param('actorId')
  /*
   * The page or the card. Their weeks, their days, their hours and every
   * project they are on are the Members screen's, and only somebody that
   * screen is open to is told them — one's own always, which My tasks reads
   * its numbers from. The card's three are anybody's who may see the person.
   */
  const page = who === ctx.actorId || allow(ctx, 'members.read')

  const found = await withActor(ctx.actorId, ctx.workspaceId, async (tx) => {
    const [person] = await tx`
      select m.actor_id, a.name, a.avatar_key, case when m.joined_at is not null then a.title end as title,
             m.role, m.joined_at,
             -- None for a member waiting for their own Join, as in the list.
             case when m.joined_at is not null then presence_of(a.seen_at, a.presence) end as presence,
             -- The email and the zone, through the one function that may
             -- read another person's account row: docs/specs/person-card.md.
             -- Between joined members only (migration 315).
             card.email, card.timezone
      from membership m join actor a on a.id = m.actor_id
      left join lateral colleague_card(a.id) card on true
      where m.workspace_id = ${ctx.workspaceId} and m.actor_id = ${who}
        and m.deleted_at is null`
    if (!person) return null

    /*
     * Their work where the asker is too — the card's question, "what are
     * they doing that I am part of". Per project the two share: open, late,
     * and finished in the last thirty days. Asked of project membership,
     * not of what the asker could open: an owner can see every project and
     * is still not part of every one.
     */
    const shared = await tx`
      select p.id, p.name, p.slug, p.key,
             count(*) filter (where t.completed_at is null) as open,
             count(*) filter (where t.completed_at is null and t.due_on < ${todayFor(tx, ctx.actorId)}) as overdue,
             count(*) filter (where t.completed_at >= now() - interval '30 days') as done
      from project p
      join project_member mine on mine.project_id = p.id
        and mine.actor_id = ${ctx.actorId} and mine.deleted_at is null
      join task t on t.project_id = p.id and t.assignee_ids @> array[${who}]::uuid[] and t.deleted_at is null
      where p.deleted_at is null and p.archived_at is null
      group by p.id
      order by count(*) filter (where t.completed_at is null) desc, p.name`

    /*
     * Open, dated work first and undated after it — the same order My tasks
     * uses, because it is the same question asked about somebody else and a
     * second ordering would be a second answer.
     *
     * `overdue` is decided here rather than left to three clients to work
     * out from a date: late and still open is the product's definition of
     * late, and it is written once.
     */
    const open = await tx`
      select t.id, t.number, t.title, t.due_on, t.project_id,
             p.name as project_name, p.key as project_key, p.slug as project_slug,
             (t.due_on is not null and t.due_on < ${todayFor(tx, ctx.actorId)}) as overdue,
             l.icon, l.color
      from task t
      /* Not a project that was put away, or one in the bin: its work is on
         nobody until it is brought back — the rule My tasks keeps, so the
         two screens count the same "open". */
      join project p on p.id = t.project_id and p.archived_at is null and p.deleted_at is null
      left join task_list l on l.id = t.list_id
      where t.assignee_ids @> array[${who}]::uuid[] and t.deleted_at is null and t.completed_at is null
      order by t.due_on nulls last, t.created_at
      limit 200`

    const card = {
      person: faced(person as { avatar_key?: string | null }),
      open,
      shared: shared.map((r) => ({ ...r, open: Number(r.open), overdue: Number(r.overdue), done: Number(r.done) })),
    }
    if (!page) return { ...card, projects: [], weeks: [], hours: [], days: [] }

    const projects = await tx`
      select p.id, p.name, p.slug, p.key
      from project_member pm join project p on p.id = pm.project_id
      where pm.actor_id = ${who} and pm.deleted_at is null
        and p.deleted_at is null and p.archived_at is null
      order by p.name`

    /*
     * Twelve weeks of what they finished and what they said, for the two
     * charts on their page — counted under the reader's own sight, like
     * everything here: a task in a project the reader is not on is not
     * counted, and nor is a message in a room they are not in.
     *
     * Weeks and days on the reader's calendar (`day.ts`): the window is
     * taken a little wide and the weeks in it decide what is drawn.
     */
    const weeks = await tx<{ week: string; done: number; said: number }[]>`
      with z as (select ${zoneOf(tx, ctx.actorId)} as zone),
      w as (
        select generate_series(date_trunc('week', now() at time zone zone) - interval '11 weeks',
                               date_trunc('week', now() at time zone zone), interval '1 week') as week
        from z
      ),
      d as (
        select date_trunc('week', t.completed_at at time zone (select zone from z)) as week,
               count(*)::int as n from task t
        where t.assignee_ids @> array[${who}]::uuid[] and t.deleted_at is null
          and t.completed_at >= now() - interval '13 weeks'
        group by 1
      ),
      m as (
        select date_trunc('week', x.created_at at time zone (select zone from z)) as week,
               count(*)::int as n from message x
        where x.author_id = ${who} and x.deleted_at is null and x.said_as is null
          and x.created_at >= now() - interval '13 weeks'
        group by 1
      )
      select to_char(w.week, 'YYYY-MM-DD') as week, coalesce(d.n, 0) as done, coalesce(m.n, 0) as said
      from w left join d on d.week = w.week left join m on m.week = w.week
      order by w.week`

    /*
     * What they did, day by day, for a year — the grid on their page
     * (`person.md`): the lines the feed keeps about them and the messages
     * they wrote, both under the reader's sight.
     */
    const days = await tx<{ day: string; n: number }[]>`
      with z as (select ${zoneOf(tx, ctx.actorId)} as zone),
      d as (
        select generate_series(today - 364, today, interval '1 day')::date as day
        from (select (now() at time zone zone)::date as today from z) t
      ),
      e as (
        select (x.at at time zone (select zone from z))::date as day, count(*)::int as n from activity_event x
        where x.workspace_id = ${ctx.workspaceId} and x.actor_id = ${who} and x.at >= now() - interval '366 days'
        group by 1
      ),
      m as (
        select (x.created_at at time zone (select zone from z))::date as day, count(*)::int as n from message x
        where x.author_id = ${who} and x.deleted_at is null and x.said_as is null
          and x.created_at >= now() - interval '366 days'
        group by 1
      )
      select to_char(d.day, 'YYYY-MM-DD') as day, coalesce(e.n, 0) + coalesce(m.n, 0) as n
      from d left join e on e.day = d.day left join m on m.day = d.day
      order by d.day`

    /*
     * Where their hours went, these thirty days: by project, and by task
     * inside them — under the reader's sight, like the rest. `person.md`.
     */
    const hours = await tx<
      { project_id: string; project_name: string; task_id: string | null; title: string | null; number: number | null; minutes: number }[]
    >`
      select e.project_id, p.name as project_name,
             case when e.object_type = 'task' then e.object_id end as task_id,
             t.title, t.number, sum(e.minutes)::int as minutes
      from time_entry e
      join project p on p.id = e.project_id
      left join task t on e.object_type = 'task' and t.id = e.object_id and t.deleted_at is null
      where e.actor_id = ${who} and e.deleted_at is null
        and e.spent_on >= ${todayFor(tx, ctx.actorId)} - 30
      group by e.project_id, p.name, 3, t.title, t.number
      order by sum(e.minutes) desc`

    return { ...card, projects, weeks, hours, days }
  })
  if (!found) {
    /*
     * Somebody who was here and was removed: their face is still on what
     * they said, and pressing it said "Couldn't load this profile" with a
     * link to a page that was not there. Their name and face, which every
     * line they wrote already shows, and that they are gone — nothing else
     * of theirs. `docs/specs/person-card.md`.
     */
    const [was] = await withActor(
      ctx.actorId,
      ctx.workspaceId,
      (tx) => tx<{ actor_id: string; name: string; avatar_key: string | null }[]>`
      select a.id as actor_id, a.name, a.avatar_key
      from membership m join actor a on a.id = m.actor_id
      where m.workspace_id = ${ctx.workspaceId} and m.actor_id = ${who} and m.deleted_at is not null
      limit 1`,
    )
    if (was) return c.json({ error: { code: 'removed' }, person: faced(was) }, 410)
    return c.json({ error: { code: 'not_found' } }, 404)
  }
  return c.json(found)
})

people.patch('/people/:actorId', async (c) => {
  const ctx = c.get('ctx')
  if (!allow(ctx, 'people.role')) return c.json({ error: { code: 'forbidden' } }, 403)

  const body = z
    .object({
      role: Role.optional(),
      may_create_projects: z.boolean().nullable().optional(),
      may_create_channels: z.boolean().optional(),
      may_see_members: z.boolean().nullable().optional(),
      may_invite_people: z.boolean().nullable().optional(),
      /* Whether they may connect agents. */
      may_connect_agents: z.boolean().optional(),
    })
    .refine((b) => Object.keys(b).length > 0)
    .safeParse(await c.req.json().catch(() => ({})))
  if (!body.success) return c.json({ error: { code: 'invalid' } }, 400)

  /* Nobody is made an owner here, and nobody stops being one: a workspace
     has one owner, who hands it over from its settings.
     Everybody else is a member already. */
  if (body.data.role !== undefined) {
    return c.json({ error: { code: 'invalid', message: 'A workspace has one owner. Hand it over in the workspace’s settings.' } }, 400)
  }
  const target = c.req.param('actorId')
  if (target === ctx.actorId) {
    return c.json({ error: { code: 'forbidden', message: 'You can’t change your own role or permissions.' } }, 403)
  }

  const done = await withActor(ctx.actorId, ctx.workspaceId, async (tx) => {
    const b = body.data
    const rows = await tx<{ actor_id: string }[]>`
      update membership set
        may_create_projects = ${'may_create_projects' in b ? (b.may_create_projects ?? null) : tx`may_create_projects`},
        may_create_channels = coalesce(${b.may_create_channels ?? null}::boolean, may_create_channels),
        may_see_members = ${'may_see_members' in b ? (b.may_see_members ?? null) : tx`may_see_members`},
        may_invite_people = ${'may_invite_people' in b ? (b.may_invite_people ?? null) : tx`may_invite_people`},
        may_connect_agents = coalesce(${b.may_connect_agents ?? null}::boolean, may_connect_agents)
      where workspace_id = ${ctx.workspaceId} and actor_id = ${target} and deleted_at is null
        /* Not an agent: what it may do is its connector's, not the owner's word. */
        and not exists (select 1 from agent g where g.actor_id = membership.actor_id)
      returning actor_id`
    if (rows.length) {
      await record(tx, ctx, 'people.rights', { meta: { actor_id: target, ...b } })
    }
    return rows.length > 0
  })
  return done ? c.json({ ok: true }) : c.json({ error: { code: 'not_found' } }, 404)
})

people.delete('/people/:actorId', async (c) => {
  const ctx = c.get('ctx')
  /* The owner's, as the membership's own policy has always said: asked as
     `people.invite`, a member could take somebody off every project they
     run — the owner included — and the feed recorded a removal that the
     database had refused. */
  /* And never by a token the server made for a change GitHub caused or an
     import writes with: those speak as the owner, and a removal — or the
     links revoked with it — is the owner's press alone. */
  /* `people.role` is the owner's alone, as this is — asked of `can()` so an
     owner's role held by an unproved address counts for nothing here
     either. */
  if (!allow(ctx, 'people.role') || ctx.viaMcp || ctx.viaGithub || ctx.viaImport) {
    return c.json({ error: { code: 'forbidden' } }, 403)
  }
  const target = c.req.param('actorId')
  if (!/^[0-9a-f-]{36}$/i.test(target)) return c.json({ error: { code: 'not_found' } }, 404)
  if (target === ctx.actorId) {
    return c.json({ error: { code: 'forbidden', message: 'You can’t remove yourself.' } }, 403)
  }

  /* Everything they had here, ended in one transaction — their projects,
     the invitations they handed out, their tokens and pushes, its channels,
     their open tasks, a Slack channel they linked. `remove_from_workspace`,
     `docs/specs/removing-someone.md`. */
  /* And, when the owner ticked it in the same dialog, every open link
     anybody may join by — the ones somebody else made, which removal
     leaves standing because they are not the person's. Only from the body
     of this request, which only that press sends: never by default, never
     from anything in the address. `docs/specs/removing-someone.md`. */
  const asked = (await c.req.json().catch(() => null)) as { withdraw_links?: unknown } | null
  const withdrawLinks = asked?.withdraw_links === true

  const done = await withActor(ctx.actorId, ctx.workspaceId, async (tx) => {
    const [r] = await tx<{ ok: boolean }[]>`select remove_from_workspace(${target}) as ok`
    if (!r?.ok) return null
    const links = withdrawLinks
      ? (
          await tx<{ id: string }[]>`
            update invite set deleted_at = now()
            where workspace_id = ${ctx.workspaceId} and email is null
              and used_at is null and deleted_at is null and expires_at > now()
            returning id`
        ).length
      : 0
    await record(tx, ctx, 'people.remove', { meta: { actor_id: target, ...(withdrawLinks ? { links_withdrawn: links } : {}) } })
    return { links }
  })
  return done ? c.json({ ok: true, links_withdrawn: done.links }) : c.json({ error: { code: 'not_found' } }, 404)
})

/*
 * Leaving the workspace yourself.
 *
 * What removal does, done to yourself: `leave_workspace` ends exactly what
 * `remove_from_workspace` ends (one body, `workspace_member_end`) — the
 * memberships, the places on projects, the sessions for this workspace on
 * every device, the tokens, the agents they connected and the connections
 * they linked to one, the rooms, the open work. What they wrote stays,
 * under their name, and an invitation brings them back as removal's does.
 *
 * A session's press alone: never a token, an agent, GitHub or an import
 * speaking as somebody — `can()` says so for `workspace.leave`, and the
 * session is asked for here as well, because the answer is a session. Not
 * the owner: a workspace has one, and they hand it over before they go.
 *
 * The answer is where to go next — a session for another workspace they
 * are in, the first by name; when there is none, a session in no workspace,
 * for the screen that offers to make one or join one (`nowhere.ts`).
 */
people.post('/me/leave', async (c) => {
  const ctx = c.get('ctx')
  if (!ctx.sessionId || ctx.viaMcp || ctx.viaGithub || ctx.viaImport || ctx.agent) {
    return c.json({ error: { code: 'forbidden' } }, 403)
  }
  /* Said, rather than a bare refusal: the owner may leave once somebody
     else owns it, and the screen says how. */
  if (ctx.role === 'owner') {
    return c.json({ error: { code: 'owner', message: 'You own this workspace. Hand it over to someone else before you leave.' } }, 409)
  }
  if (!allow(ctx, 'workspace.leave')) return c.json({ error: { code: 'forbidden' } }, 403)

  /* The line first, while they are still in it to write it. */
  const left = await withActor(ctx.actorId, ctx.workspaceId, async (tx) => {
    await record(tx, ctx, 'people.leave', { meta: { actor_id: ctx.actorId } })
    const [r] = await tx<{ ok: boolean }[]>`select leave_workspace() as ok`
    if (!r?.ok) throw new NotLeft()
    return true
  }).catch((e) => {
    if (e instanceof NotLeft) return false
    throw e
  })
  /* The role changed meanwhile — a hand-over to them — or they were gone already. */
  if (!left) return c.json({ error: { code: 'forbidden' } }, 403)

  /* Where they go next: another workspace they are in, the first by name,
     as the switcher lists them; else nowhere. */
  const [elsewhere] = await withActorEverywhere(
    ctx.actorId,
    (tx) => tx<{ id: string; slug: string; name: string }[]>`
      select w.id, w.slug, w.name from membership m join workspace w on w.id = m.workspace_id
      where m.actor_id = ${ctx.actorId} and m.workspace_id <> ${ctx.workspaceId}
        and m.deleted_at is null and m.joined_at is not null and w.deleted_at is null
      order by w.name limit 1`,
  )
  if (!elsewhere) return c.json({ ok: true, session: await startNowhereSession(ctx.actorId, metaOf(c)), workspace: null })
  const session = await startSession(ctx.actorId, elsewhere.id, metaOf(c), 'switch')
  return c.json({ ok: true, session, workspace: elsewhere })
})

class NotLeft extends Error {}
