import { Hono } from 'hono'
import { z } from 'zod'
import { withActor, withoutActor } from '../db.js'
import { allow, type AuthContext } from '../auth/context.js'
import { CHANGED_MEANWHILE, moreToStop } from '../ceilings.js'
import { asksOf, byInbox, codeFromInbox, emailOf, itIsThem } from '../auth/address.js'
import { letter, send } from '../mail.js'
import { edition } from '../edition.js'
import { oneLine } from '../text.js'
import { origin } from './access.js'
import { record } from './activity.js'
import { reask } from './limits.js'
import { heard, languageFor, say, type Language } from '../words.js'

type Vars = { ctx: AuthContext }

/**
 * Handing the workspace to somebody in it.
 *
 * A workspace has one owner, and this is the one way that changes. It asks
 * what changing the account's address asks — the password, the code when
 * there is a second factor — because it gives away the plan, the people and
 * every project, and a session left open on somebody's desk should not be
 * enough. An account with neither is sent six digits to its inbox
 * (`POST /me/inbox-code`) and asked for those: it was asked nothing, on the
 * grounds that it had signed in through its provider a moment ago, which
 * nothing checked and a month-old session was not. Both people are told
 * by mail.
 */
export const ownership = new Hono<{ Variables: Vars }>()

const Hand = z.object({
  to: z.uuid(),
  password: z.string().max(1024).optional(),
  code: z.string().max(64).optional(),
})

ownership.post('/workspace/transfer', async (c) => {
  const ctx = c.get('ctx')
  if (ctx.viaMcp || !allow(ctx, 'workspace.transfer')) {
    return c.json({ error: { code: 'forbidden', message: 'Only the owner can hand the workspace over.' } }, 403)
  }
  const body = Hand.safeParse(await c.req.json().catch(() => ({})))
  if (!body.success) return c.json({ error: { code: 'invalid', message: 'Choose who to hand it to.' } }, 400)
  if (body.data.to === ctx.actorId) {
    return c.json({ error: { code: 'invalid', message: 'You’re the owner already.' } }, 400)
  }
  /* Not to an address nobody has proved, as a server is not handed to one
     (`/api/instance/owners`): an owner's role held by an unproved account
     counts for nothing, and its owner may not be whoever holds its session. */
  /* Nor to one proved only by a link handed over: proved enough to work,
     not to be handed a workspace — a review, M2. `transfer_workspace`
     refuses both whatever called it. */
  const [them] = await withoutActor(
    (tx) => tx<{ unproved: boolean }[]>`
      select auth_email_confirmed(${body.data.to}) is false
             or coalesce(auth_email_by_hand(${body.data.to}), false) as unproved`,
  )
  if (them?.unproved) {
    return c.json({ error: { code: 'unconfirmed', message: 'They haven’t confirmed their email yet.' } }, 409)
  }

  const asks = await asksOf(ctx.actorId)
  const { email } = await emailOf(ctx.actorId)
  const tries = await reask(ctx.actorId)
  if (!tries.ok) {
    return c.json({ error: { code: 'rate_limited', message: 'Too many attempts. Try again in a few minutes.' } }, 429)
  }
  const yes = byInbox(asks) ? await codeFromInbox(ctx.actorId, body.data.code) : await itIsThem(ctx.actorId, email, asks, body.data)
  if (!yes) {
    /* 403, not 401: a 401 tells the page its session is over. */
    const which = asks.code && !body.data.code ? 'totp_required' : 'wrong_password'
    return c.json({ error: { code: which, message: 'That didn’t match. Try again.' } }, 403)
  }
  await tries.right()

  const done = await withActor(ctx.actorId, ctx.workspaceId, async (tx) => {
    const [r] = await tx<{ ok: boolean }[]>`select transfer_workspace(${ctx.workspaceId}, ${body.data.to}) as ok`
    if (!r?.ok) return null
    await record(tx, ctx, 'workspace.transfer', { meta: { to: body.data.to } })
    const [names] = await tx<{ workspace: string; to_name: string }[]>`
      select w.name as workspace, a.name as to_name
      from workspace w, actor a where w.id = ${ctx.workspaceId} and a.id = ${body.data.to}`
    return names ?? { workspace: null, to_name: null }
  }).catch((e: unknown) => {
    /* They left while this was asked — `transfer_workspace` found nobody
       to promote and took the step-down back. */
    if (String((e as Error).message).includes('nobody to hand it to')) return null
    throw e
  })
  if (!done) {
    return c.json({ error: { code: 'not_found', message: 'They aren’t in this workspace any more.' } }, 404)
  }

  const { email: theirs } = await emailOf(body.data.to)
  /* Each in their own language: the one handing over is at the screen
     that asked, the one handed to is not. */
  const words = (language: Language) =>
    say(
      {
        open: ['Open Tuff', 'Ouvrir Tuff', '打开 Tuff'],
        yours: ['your workspace', 'votre espace de travail', '你的工作区'],
        them: ['them', 'cette personne', '对方'],
        gaveSubject: [
          'You handed over a workspace on Tuff',
          'Vous avez transféré un espace de travail sur Tuff',
          '你已转让 Tuff 上的一个工作区',
        ],
        gave: [
          (who: string, where: string) => `You made ${who} the owner of “${where}”. You’re a member now, on every project you could open.`,
          (who: string, where: string) =>
            `Vous avez fait de ${who} le propriétaire de « ${where} ». Vous êtes désormais membre, sur tous les projets que vous pouviez ouvrir.`,
          (who: string, where: string) => `你已让 ${who} 成为「${where}」的所有者。你现在是成员，仍可访问原先可打开的所有项目。`,
        ],
        gaveThen: [
          'If this wasn’t you, ask them to hand it back and change your password.',
          'Si ce n’était pas vous, demandez-lui de vous le rendre et changez votre mot de passe.',
          '如果这不是你本人操作，请要求对方转回并修改你的密码。',
        ],
        tookSubject: [
          'You’re the owner of a workspace on Tuff',
          'Vous êtes propriétaire d’un espace de travail sur Tuff',
          '你已成为 Tuff 上一个工作区的所有者',
        ],
        /* With its plan, where the edition has plans. */
        took: edition.planMail?.took ?? [
          (where: string) => `You’re now the owner of “${where}”: its people and every project in it.`,
          (where: string) => `Vous êtes désormais propriétaire de « ${where} » : ses membres et tous ses projets.`,
          (where: string) => `你现在是「${where}」的所有者，负责其中的人员和所有项目。`,
        ],
      },
      language,
    )
  const [askerReads, ownerReads] = await Promise.all([languageFor(ctx.actorId, heard(c)), languageFor(body.data.to)])
  const [toAsker, toOwner] = [words(askerReads), words(ownerReads)]
  const where = (w: typeof toAsker) => (done.workspace ? oneLine(done.workspace) : w.yours)
  await Promise.all([
    send({
      to: email,
      subject: toAsker.gaveSubject,
      ...letter(
        [toAsker.gave(done.to_name ? oneLine(done.to_name) : toAsker.them, where(toAsker)), toAsker.gaveThen],
        { label: toAsker.open, url: origin(c) },
        askerReads,
      ),
    }),
    theirs
      ? send({
          to: theirs,
          subject: toOwner.tookSubject,
          ...letter([toOwner.took(where(toOwner))], { label: toOwner.open, url: origin(c) }, ownerReads),
        })
      : Promise.resolve(false),
  ])
  return c.json({ ok: true })
})

/**
 * Deleting the workspace.
 *
 * The owner's, never through a token. A dry run says what goes and how the
 * proof will be asked; the real one wants the workspace's name typed and
 * the same proof handing over asks, in the one request. Whatever the
 * edition holds against it is settled first (`edition.cancelSubscriptions`),
 * and if that cannot be done nothing is deleted. Then everybody who was in
 * it is told.
 */
const Delete = z.object({
  dry: z.boolean().optional(),
  name: z.string().max(200).optional(),
  password: z.string().max(1024).optional(),
  code: z.string().max(64).optional(),
})

type Deletion = {
  ok: boolean
  why?: string
  name?: string
  projects?: number
  people?: number | string[]
  agents?: number
  subscriptions?: string[]
}

ownership.post('/workspace/delete', async (c) => {
  const ctx = c.get('ctx')
  /* Only a person at the screen: no MCP token, nothing GitHub or an import writes as. */
  if (ctx.viaMcp || ctx.viaGithub || ctx.viaImport || !allow(ctx, 'workspace.delete')) {
    return c.json({ error: { code: 'forbidden', message: 'Only the owner can delete the workspace.' } }, 403)
  }
  const body = Delete.safeParse(await c.req.json().catch(() => ({})))
  if (!body.success) return c.json({ error: { code: 'invalid' } }, 400)
  /* Deleting, with what was stopped first: in the same transaction the
     list is read again, and a plan not among them refuses the deletion. */
  const ask = async (dry: boolean, stopped: readonly string[] = []) =>
    withActor(ctx.actorId, ctx.workspaceId, async (tx) => {
      if (!dry) {
        const [again] = await tx<{ d: Deletion }[]>`select delete_workspace(true) as d`
        if (
          moreToStop(
            (again?.d.subscriptions ?? []).map((id) => ({ id })),
            stopped,
          )
        )
          return { ok: false, why: 'changed' } as Deletion
      }
      const [r] = await tx<{ d: Deletion }[]>`select delete_workspace(${dry}) as d`
      return r?.d ?? null
    })
  /* The server's last owner who can sign in, left with nowhere to sign in
     to — your own server only. */
  const lastOwner = () =>
    c.json(
      {
        error: {
          code: 'last_instance_owner',
          message:
            'Deleting this workspace would leave this server with no owner who can sign in. Add another owner in Server settings first.',
        },
      },
      409,
    )

  const asks = await asksOf(ctx.actorId)
  if (body.data.dry) {
    const d = await ask(true)
    if (d?.why === 'last_instance_owner') return lastOwner()
    if (!d?.ok) return c.json({ error: { code: 'not_found' } }, 404)
    return c.json({
      name: d.name,
      projects: d.projects ?? 0,
      people: d.people ?? 0,
      agents: d.agents ?? 0,
      paid: (d.subscriptions ?? []).length > 0,
      asks: byInbox(asks) ? 'email' : !asks.password ? 'code' : asks.code ? 'password_and_code' : 'password',
    })
  }

  /* The name first, as it is written: a typo should not spend the code
     the inbox was sent. What somebody reading the window agrees to is this
     workspace, not whichever one the session is in. */
  const facts = await ask(true)
  if (facts?.why === 'last_instance_owner') return lastOwner()
  if (!facts?.ok || !facts.name) return c.json({ error: { code: 'not_found' } }, 404)
  if ((body.data.name ?? '').trim() !== facts.name.trim()) {
    return c.json({ error: { code: 'name', message: 'Type the workspace’s name as it’s written.' } }, 400)
  }

  const tries = await reask(ctx.actorId)
  if (!tries.ok) {
    return c.json({ error: { code: 'rate_limited', message: 'Too many attempts. Try again in a few minutes.' } }, 429)
  }
  const { email } = await emailOf(ctx.actorId)
  const yes = byInbox(asks) ? await codeFromInbox(ctx.actorId, body.data.code) : await itIsThem(ctx.actorId, email, asks, body.data)
  if (!yes) {
    /* 403, not 401: a 401 tells the page its session is over. */
    const which = asks.code && !body.data.code ? 'totp_required' : 'wrong_password'
    return c.json({ error: { code: which, message: 'That didn’t match. Try again.' } }, 403)
  }
  await tries.right()

  /* Not charged after it is gone: stopped first, or nothing happens. */
  if ((facts.subscriptions ?? []).length) {
    const stuck = await edition.cancelSubscriptions(facts.subscriptions ?? [], ctx.actorId)
    if (stuck) return c.json(stuck, 502)
  }

  /* Who deleted it, read while they are still in it to be read. */
  const [byName] = await withActor(
    ctx.actorId,
    ctx.workspaceId,
    (tx) => tx<{ name: string }[]>`select name from actor where id = ${ctx.actorId}`,
  ).catch(() => [])
  const who = byName?.name ? oneLine(byName.name) : null
  const done = await ask(false, facts.subscriptions ?? []).catch((e: unknown) => {
    console.error('workspace delete failed after its plan was revoked', ctx.workspaceId, e)
    return null
  })
  if (done?.why === 'last_instance_owner') return lastOwner()
  if (done?.why === 'changed') return c.json(CHANGED_MEANWHILE, 409)
  if (!done?.ok) {
    /* Its plan already stopped: said, so it is tried again rather than
       left paid for nothing and still there. */
    return c.json(
      { error: { code: 'invalid', message: 'The workspace wasn’t deleted. Try again.' } },
      (facts.subscriptions ?? []).length ? 500 : 404,
    )
  }
  const where = oneLine(done.name ?? facts.name)
  const people = Array.isArray(done.people) ? done.people : []

  const support = edition.vendor?.support ?? null
  const words = (language: Language) =>
    say(
      {
        open: ['Open Tuff', 'Ouvrir Tuff', '打开 Tuff'],
        subject: ['A workspace was deleted on Tuff', 'Un espace de travail a été supprimé sur Tuff', 'Tuff 上的一个工作区已被删除'],
        mineSubject: [
          'You deleted a workspace on Tuff',
          'Vous avez supprimé un espace de travail sur Tuff',
          '你删除了 Tuff 上的一个工作区',
        ],
        gone: [
          (place: string, by: string | null) =>
            by
              ? `${by} deleted the workspace “${place}”. Its projects, tasks, chats and files are gone with it.`
              : `The workspace “${place}” was deleted. Its projects, tasks, chats and files are gone with it.`,
          (place: string, by: string | null) =>
            by
              ? `${by} a supprimé l’espace de travail « ${place} ». Ses projets, tâches, discussions et fichiers ont disparu avec lui.`
              : `L’espace de travail « ${place} » a été supprimé. Ses projets, tâches, discussions et fichiers ont disparu avec lui.`,
          (place: string, by: string | null) =>
            by
              ? `${by} 删除了工作区「${place}」。其中的项目、任务、聊天和文件也已一并删除。`
              : `工作区「${place}」已被删除。其中的项目、任务、聊天和文件也已一并删除。`,
        ],
        yoursStay: [
          'Your account, and any other workspace you’re in, are untouched.',
          'Votre compte et vos autres espaces de travail ne sont pas touchés.',
          '你的账户以及你所在的其他工作区不受影响。',
        ],
        /* A plan only where there are plans — `edition.planMail`. */
        mine: edition.planMail?.deletedMine ?? [
          (place: string) => `You deleted the workspace “${place}”. Everybody in it has been told.`,
          (place: string) => `Vous avez supprimé l’espace de travail « ${place} ». Tous ses membres ont été prévenus.`,
          (place: string) => `你删除了工作区「${place}」。其中所有成员都已收到通知。`,
        ],
        /* The service's own address, or on your own server its owner, who
           can bring it back before the clear-out — whose days are theirs
           to set (`PURGE_AFTER_DAYS`), so no number is promised there. */
        back: support
          ? [
              `We keep it for 30 days. To bring it back, write to ${support}. If this wasn’t you, write to us now and change your password.`,
              `Nous le gardons 30 jours. Pour le récupérer, écrivez à ${support}. Si ce n’était pas vous, écrivez-nous tout de suite et changez votre mot de passe.`,
              `我们会保留 30 天。如需恢复，请写信至 ${support}。如果这不是你本人操作，请立即联系我们并修改密码。`,
            ]
          : [
              'It isn’t gone for good straight away. To bring it back, ask the owner of this server. If this wasn’t you, tell them now and change your password.',
              'Il n’est pas supprimé définitivement tout de suite. Pour le récupérer, demandez au propriétaire de ce serveur. Si ce n’était pas vous, prévenez-le tout de suite et changez votre mot de passe.',
              '它不会立即永久删除。如需恢复，请联系此服务器的所有者。如果这不是你本人操作，请立即告知对方并修改密码。',
            ],
      },
      language,
    )
  const ownerReads = await languageFor(ctx.actorId, heard(c))
  const tell = async (id: string) => {
    const { email: theirs } = await emailOf(id).catch(() => ({ email: null }))
    if (!theirs) return false
    const mineToo = id === ctx.actorId
    const reads = mineToo ? ownerReads : await languageFor(id)
    const w = words(reads)
    return send({
      to: theirs,
      subject: mineToo ? w.mineSubject : w.subject,
      ...letter(mineToo ? [w.mine(where), w.back] : [w.gone(where, who), w.yoursStay], { label: w.open, url: origin(c) }, reads),
    }).catch(() => false)
  }
  /* After the answer, ten at a time: a workspace of a thousand is not a
     thousand sends inside one request that has already done its work. */
  void (async () => {
    for (let i = 0; i < people.length; i += 10) await Promise.all(people.slice(i, i + 10).map(tell))
  })().catch((e: unknown) => console.error('workspace delete: telling its people failed', e))
  return c.json({ ok: true })
})
