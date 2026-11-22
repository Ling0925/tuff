import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { asAuthEverywhere, withActor, withActorEverywhere, withoutActor } from '../db.js'
import type { AuthContext } from '../auth/context.js'
import { CHANGED_MEANWHILE, moreToStop } from '../ceilings.js'
import { asksOf, byInbox, codeFromInbox, emailOf, itIsThem } from '../auth/address.js'
import { edition } from '../edition.js'
import { reask, spendOn } from './limits.js'
import { letGo, personToken } from '../github.js'

type Vars = { ctx: AuthContext }
export const yourData = new Hono<{ Variables: Vars }>()

/*
 * What the GDPR gives a person over what Tuff keeps about them, in the
 * product. A copy (articles 15 and 20), and
 * erasure (17). Never through a token: an agent does not take a person's
 * data out, or delete the person.
 */

/* The words of a body, as text: what was written, without its shape. */
const words = (col: string) =>
  `(select string_agg(x #>> '{}', ' ') from jsonb_path_query(coalesce(${col}, '{}'::jsonb), 'strict $.**.text') x)`

yourData.get('/me/export', async (c) => {
  const ctx = c.get('ctx')
  if (ctx.viaMcp) return c.json({ error: { code: 'forbidden' } }, 403)
  const me = ctx.actorId
  /* Everything a person ever wrote, read whole: a few times an hour is what
     anybody needs, and asked in a loop it would hold the database. */
  if (!(await spendOn(`export:${me}`, 6, 3600))) {
    return c.json({ error: { code: 'rate_limited', message: 'You’ve just downloaded your data. Try again in an hour.' } }, 429)
  }

  const [account] = await withActor(
    me,
    ctx.workspaceId,
    (tx) =>
      tx<Record<string, unknown>[]>`
      select a.name, a.title, a.created_at,
             u.timezone, u.notify_chat, u.quiet_from, u.quiet_to, u.email_digest
      from actor a left join app_user u on u.actor_id = a.id
      where a.id = ${me}`,
  )
  const { email } = await emailOf(me)
  const asks = await asksOf(me)
  const devices = await withoutActor(
    (tx) =>
      tx<Record<string, unknown>[]>`
      select device, user_agent, ip, created_at, last_used_at from auth_sessions(${me})`,
  )

  const places = await withActorEverywhere(
    me,
    (tx) =>
      tx<{ id: string; name: string; slug: string; role: string; joined_at: string | null }[]>`
      select w.id, w.name, w.slug::text, m.role::text, m.joined_at
      from membership m join workspace w on w.id = m.workspace_id
      where m.actor_id = ${me} and m.deleted_at is null and m.joined_at is not null
      order by w.name`,
  )

  const workspaces = []
  for (const w of places) {
    const one = await withActor(me, w.id, async (tx) => ({
      name: w.name,
      address: w.slug,
      role: w.role,
      joined: w.joined_at,
      projects: await tx.unsafe(
        `select p.name, pm.created_at as added from project_member pm join project p on p.id = pm.project_id
         where pm.actor_id = $1 and pm.deleted_at is null and p.workspace_id = $2 order by p.name`,
        [me, w.id],
      ),
      tasks: await tx.unsafe(
        `select p.key || '-' || t.number as handle, t.title, ${words('t.body')} as description, t.created_at, t.completed_at
         from task t join project p on p.id = t.project_id
         where t.author_id = $1 and t.workspace_id = $2 and t.deleted_at is null order by t.created_at`,
        [me, w.id],
      ),
      /* Past the policies (`my_comments`, migration 238): what somebody
         wrote on a file in a room they left, or in a project they left, is
         still theirs, and read through the policies it was left out. */
      comments: await tx.unsafe(
        `select on_a::text as on_a, ${words('said')} as words, said_at as created_at
         from my_comments() order by said_at`,
      ),
      messages: await tx.unsafe(
        `select coalesce(c.name, 'direct') as room, ${words('m.body')} as words, m.created_at
         from message m join conversation c on c.id = m.conversation_id
         where m.author_id = $1 and m.workspace_id = $2 and m.deleted_at is null order by m.created_at`,
        [me, w.id],
      ),
      announcements: await tx.unsafe(
        `select title, ${words('body')} as words, published_at, created_at
         from post where author_id = $1 and workspace_id = $2 and deleted_at is null order by created_at`,
        [me, w.id],
      ),
      documents_and_files: await tx.unsafe(
        `select name, ${words('body')} as words, size_bytes, created_at
         from file where author_id = $1 and workspace_id = $2 and deleted_at is null order by created_at`,
        [me, w.id],
      ),
      time: await tx.unsafe(
        `select minutes, spent_on, note, created_at from time_entry
         where actor_id = $1 and workspace_id = $2 and deleted_at is null order by spent_on`,
        [me, w.id],
      ),
      /* What your AI tools said they spent. */
      ai_spend: await tx.unsafe(
        `select client, model, tokens::float8 as tokens, cost_usd::float8 as cost_usd, created_at, updated_at
         from task_spend where actor_id = $1 and workspace_id = $2 and deleted_at is null order by created_at`,
        [me, w.id],
      ),
      notifications: await tx.unsafe(
        `select reason::text, object_type::text, what, created_at, read_at
         from notification where actor_id = $1 and workspace_id = $2 and deleted_at is null order by created_at`,
        [me, w.id],
      ),
      activity: await tx.unsafe(
        `select action, object_type::text, at from activity_event
         where actor_id = $1 and workspace_id = $2 order by at`,
        [me, w.id],
      ),
    }))
    workspaces.push(one)
  }

  const day = new Date().toISOString().slice(0, 10)
  c.header('content-disposition', `attachment; filename="tuff-data-${day}.json"`)
  return c.json({
    exported_at: new Date().toISOString(),
    about: 'Everything Tuff keeps about you, from your account and every workspace you are in. Files are listed, not included.',
    account: { ...account, email, two_factor: asks.code, password: asks.password },
    devices,
    workspaces,
  })
})

/*
 * Erasure — a dry run says what would happen, and the real one is asked
 * for again with the password, the code where there is one, or a code
 * mailed to its address where there is neither.
 */
/* Named, so a session in no workspace can be answered by it too —
   `nowhere.ts`. It reads the person off `ctx` and nothing of a workspace. */
export async function deleteAccount(c: Context<{ Variables: Vars }>) {
  const ctx = c.get('ctx')
  if (ctx.viaMcp) return c.json({ error: { code: 'forbidden' } }, 403)
  const body = z
    .object({
      dry: z.boolean().optional(),
      password: z.string().max(500).optional(),
      code: z.string().max(20).optional(),
    })
    .safeParse(await c.req.json().catch(() => ({})))
  if (!body.success) return c.json({ error: { code: 'invalid' } }, 400)
  const me = ctx.actorId

  type Deletion = {
    ok: boolean
    why?: string
    alone?: { name: string }[]
    blocked?: { name: string; people: number }[]
    leaves?: { name: string }[]
  }
  /* Deleting, with what was stopped first: in the same transaction the
     list is read again, and a plan not among them refuses the deletion. */
  const ask = async (dry: boolean, stopped: readonly string[] = []) => {
    /* On the sign-in connection: deleting an account is `tracker_auth`'s (migration 308). */
    const [r] = await asAuthEverywhere(me, async (tx) => {
      if (!dry && moreToStop(await tx<{ id: string }[]>`select id from my_lone_subscriptions()`, stopped)) {
        return [{ d: { ok: false, why: 'changed' } as Deletion }]
      }
      return tx<{ d: Deletion }[]>`select delete_my_account(${dry}) as d`
    })
    return r?.d ?? null
  }

  if (body.data.dry) {
    const d = await ask(true)
    const asks = await asksOf(me)
    return c.json({ ...d, asks: byInbox(asks) ? 'email' : asks.code ? 'password_and_code' : 'password' })
  }

  const tries = await reask(me)
  if (!tries.ok) {
    return c.json({ error: { code: 'rate_limited', message: 'Too many attempts. Try again in a few minutes.' } }, 429)
  }
  const asks = await asksOf(me)
  const { email } = await emailOf(me)
  /* With nothing to type, the code its inbox was sent — `POST
     /me/inbox-code`. Its own address, typed, was something anybody at the
     open laptop could read off the screen above. */
  const yes = byInbox(asks)
    ? await codeFromInbox(me, body.data.code)
    : await itIsThem(me, email, asks, { password: body.data.password, code: body.data.code })
  if (!yes) {
    return c.json({ error: { code: 'not_them', message: 'That didn’t match. Try again.' } }, 403)
  }
  await tries.right()

  const d = await ask(true)
  if (!d) return c.json({ error: { code: 'not_found' } }, 404)
  /* Somebody the deployment names as running it — the edition's to say. */
  if (d.why === 'operator') return c.json(edition.operatorRefusal ?? { error: { code: 'forbidden' } }, 403)
  /* The last owner of a server of one's own: it would be left with nobody
     to open sign-up or name an owner. */
  if (d.why === 'last_instance_owner') {
    return c.json(
      { error: { code: 'last_instance_owner', message: 'You’re the last owner of this server. Add another owner first.' } },
      403,
    )
  }
  if (d.why === 'sole_owner') {
    return c.json({ error: { code: 'sole_owner', message: 'Hand over the workspaces you own first.', workspaces: d.blocked ?? [] } }, 409)
  }

  /* What the edition holds against a workspace going with the account is
     settled first (`edition.cancelSubscriptions`): a deleted account still
     held to something next month is the one thing this must not leave
     behind. If that cannot be done, nothing is deleted. */
  const subs = await withActorEverywhere(me, (tx) => tx<{ id: string }[]>`select id from my_lone_subscriptions()`)
  if (subs.length) {
    const stuck = await edition.cancelSubscriptions(
      subs.map((s) => s.id),
      me,
    )
    if (stuck) return c.json(stuck, 502)
  }

  /* Their GitHub goes with the account (migration 151), and is let go of
     at GitHub too: read first, while the row that keeps it is there. */
  const github = await personToken(me).catch(() => null)
  const done = await ask(
    false,
    subs.map((s) => s.id),
  )
  if (done?.why === 'changed') return c.json(CHANGED_MEANWHILE, 409)
  if (!done?.ok) return c.json({ error: { code: done?.why ?? 'invalid' } }, 409)
  void letGo(github)
  return c.json({ ok: true, deleted: done.alone ?? [], left: done.leaves ?? [] })
}
yourData.post('/me/delete', deleteAccount)
