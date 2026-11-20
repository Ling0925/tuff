import { Hono, type Context } from 'hono'
import { keyFor, legacyKey, mac, same } from '../auth/keys.js'
import { z } from 'zod'
import { v7 as uuidv7 } from 'uuid'
import { withActor, withoutActor } from '../db.js'
import { env } from '../env.js'
import { UNPROVED, allow, allowIn, type AuthContext } from '../auth/context.js'
import {
  appSlug,
  GithubRefused,
  githubConfigured,
  installation,
  letGo,
  personOnRepo,
  personsRepos,
  personToken,
  repositories,
  sealSecret,
  signedByGithub,
  tradeCode,
  whoIs,
} from '../github.js'
import { record } from './activity.js'
import { origin } from './access.js'
import { forbidden, missing } from './objects.js'

/**
 * GitHub. Three doors:
 *
 * - `POST /hooks/github`, where GitHub says what happened: believed only
 *   with its signature, put in a queue and answered at once; the worker
 *   applies it (`githubWork.ts`).
 * - `GET /auth/github/installed`, where GitHub sends the owner back after
 *   installing the app: on to the workspace's settings, which finish it.
 * - `/api/github…`, the owner's installation and a project's repository.
 */

type Vars = { ctx: AuthContext }

/* ----------------------------------------------------------- the webhook */

export const githubHooks = new Hono()

githubHooks.post('/hooks/github', async (c) => {
  /* Unsigned is refused before the body is read: anybody may send this
     door twenty-five megabytes, and a body nobody signed is not worth
     holding. */
  if (!c.req.header('x-hub-signature-256')) return c.json({ error: { code: 'forbidden' } }, 403)
  const raw = await c.req.text()
  if (!signedByGithub(raw, c.req.header('x-hub-signature-256'))) return c.json({ error: { code: 'forbidden' } }, 403)
  const delivery = c.req.header('x-github-delivery')
  const event = c.req.header('x-github-event')
  if (!delivery || !event) return c.json({ error: { code: 'invalid' } }, 400)
  let payload: { installation?: { id?: number } }
  try {
    payload = JSON.parse(raw) as typeof payload
  } catch {
    return c.json({ error: { code: 'invalid' } }, 400)
  }
  /* Only what the worker acts on is kept; GitHub's ping and the rest are
     answered and dropped. */
  const kept = [
    'installation',
    'installation_repositories',
    'pull_request',
    'pull_request_review',
    'check_suite',
    'push',
    'issues',
    'issue_comment',
    'sub_issues',
  ]
  if (!kept.includes(event)) return c.json({ ok: true, ignored: true }, 202)
  await withoutActor(
    (tx) => tx`select github_event_put(${delivery}, ${event}, ${payload.installation?.id ?? null}, ${tx.json(payload as never)})`,
  )
  return c.json({ ok: true }, 202)
})

/* ------------------------------------------------- back from installing */

/*
 * What the owner is sent to GitHub carrying, and brings back: which
 * workspace asked, who, and until when — signed, so an installation id
 * typed into the address cannot be claimed by a workspace that did not
 * start the install.
 */
type State = { w: string; a: string; s: string; e: number; k?: 'me' }

function seal(state: State): string {
  const body = Buffer.from(JSON.stringify(state)).toString('base64url')
  return `${body}.${mac(keyFor('github-state'), `github:${body}`, 'base64url')}`
}

function unseal(sealed: string): State | null {
  const [body, sig, more] = sealed.split('.')
  if (!body || !sig || more !== undefined) return null
  let s: State
  try {
    s = JSON.parse(Buffer.from(body, 'base64url').toString()) as State
  } catch {
    return null
  }
  if (!(typeof s.e === 'number' && s.e > Date.now())) return null
  /* Its own key — `auth/keys.ts`; or one sealed before the split, for the
     minutes a state lasts. */
  if (same(mac(keyFor('github-state'), `github:${body}`, 'base64url'), sig)) return s
  const old = legacyKey(s.e)
  return old && same(mac(old, `github:${body}`, 'base64url'), sig) ? s : null
}

export const githubReturns = new Hono()

/* Where a person's own authorisation comes back. Not finished here: the
   code is carried into the app, which is signed in, and posted from there
   with the person's session — so a link somebody else started cannot tie
   their GitHub to whoever happens to open it. */
/* At this deployment's own address — `APP_URL`, which on the service is
   https://usetuff.com — as Google's and Slack's are, and registered with
   the app as it is. The same on the way out and on the trade, which GitHub
   holds to. */
const callback = (c: Context) => `${origin(c)}/auth/github/callback`
githubReturns.get('/auth/github/callback', (c) => {
  const state = unseal(c.req.query('state') ?? '')
  const code = c.req.query('code') ?? ''
  if (!state || state.k !== 'me' || !code) return c.redirect('/', 302)
  const q = new URLSearchParams({ github: 'linked', code, state: c.req.query('state') ?? '' })
  return c.redirect(`/${state.s}/account?${q}`, 302)
})

githubReturns.get('/auth/github/installed', (c) => {
  const state = unseal(c.req.query('state') ?? '')
  const id = c.req.query('installation_id') ?? ''
  /* Back into the app, which is signed in and can finish it; without a
     state of ours there is nowhere to send it but home. */
  if (!state || state.k || !/^\d+$/.test(id)) return c.redirect('/', 302)
  const q = new URLSearchParams({ github: 'installed', installation_id: id, state: c.req.query('state') ?? '' })
  return c.redirect(`/${state.s}/settings?${q}`, 302)
})

/* ------------------------------------------------------------- the api */

export const githubApi = new Hono<{ Vars: Vars; Variables: Vars }>()

/** The installation is the owner's, as the webhooks are, and never a token's. */
const owns = (ctx: AuthContext) => !ctx.viaMcp && !ctx.viaGithub && allow(ctx, 'audit.read')

type InstallRow = { id: string; installation_id: string; account_login: string; account_type: string }

async function installed(ctx: AuthContext): Promise<InstallRow | null> {
  const [row] = await withActor(
    ctx.actorId,
    ctx.workspaceId,
    (tx) =>
      tx<InstallRow[]>`
      select id, installation_id::text, account_login, account_type from github_install
      where workspace_id = ${ctx.workspaceId} and deleted_at is null`,
  )
  return row ?? null
}

githubApi.get('/github', async (c) => {
  const ctx = c.get('ctx')
  const row = await installed(ctx)
  return c.json({
    configured: githubConfigured(),
    install: row ? { account_login: row.account_login, account_type: row.account_type } : null,
    can_install: owns(ctx),
  })
})

/** Where the owner goes to install the app, carrying who asked. */
githubApi.post('/github/start', async (c) => {
  const ctx = c.get('ctx')
  if (!owns(ctx)) return c.json(forbidden, 403)
  if (!githubConfigured()) return c.json({ error: { code: 'unavailable', message: 'GitHub isn’t set up on this server.' } }, 503)
  const [w] = await withActor(
    ctx.actorId,
    ctx.workspaceId,
    (tx) => tx<{ slug: string }[]>`select slug from workspace where id = ${ctx.workspaceId}`,
  )
  /* The way back is `/${slug}/…`: with no slug it would be `//…`, another site. */
  if (!w) return c.json({ error: { code: 'not_found' } }, 404)
  const state = seal({ w: ctx.workspaceId, a: ctx.actorId, s: w.slug, e: Date.now() + 60 * 60_000 })
  return c.json({ url: `https://github.com/apps/${await appSlug()}/installations/new?state=${encodeURIComponent(state)}` })
})

/**
 * Finishing it: the installation GitHub named, for the workspace the state
 * says asked. Asked of GitHub too — an id is only a number, and one that
 * does not exist, or was made long before this install began, is not this
 * workspace's to claim.
 */
githubApi.post('/github/installs', async (c) => {
  const ctx = c.get('ctx')
  if (!owns(ctx)) return c.json(forbidden, 403)
  const body = z
    .object({ installation_id: z.coerce.number().int().positive(), state: z.string() })
    .safeParse(await c.req.json().catch(() => ({})))
  if (!body.success) return c.json({ error: { code: 'invalid' } }, 400)
  const state = unseal(body.data.state)
  if (!state || state.k || state.w !== ctx.workspaceId || state.a !== ctx.actorId) {
    return c.json({ error: { code: 'invalid', message: 'That link has run out. Connect GitHub again.' } }, 400)
  }
  const found = await installation(body.data.installation_id).catch(() => null)
  if (!found || !found.account) {
    return c.json({ error: { code: 'invalid', message: 'That installation isn’t one this workspace started.' } }, 400)
  }
  /*
   * Made more than two hours ago. An installation's id is a number that
   * counts up, and the state only proves who started an install — not
   * which one finished — so an old one is claimed only on the person's own
   * account (below). An app installed once, disconnected and connected
   * again comes back from GitHub with its old id, and was refused for its
   * age although it was plainly theirs. An organisation's stays two hours:
   * "GitHub said you installed it" is proof of the moment, not that they
   * still run that organisation (review of this change).
   */
  const old = Date.parse(found.created_at) < Date.now() - 2 * 60 * 60_000
  /*
   * Claimed only by who installed it. Whether somebody's GitHub *lists*
   * an installation says little: everybody with read access to one of its
   * repositories sees it there. GitHub names the installer in the event it
   * sends as the app is installed, and an app on a person's own account is
   * theirs; anything else is refused.
   */
  const [me] = await withActor(
    ctx.actorId,
    ctx.workspaceId,
    (tx) => tx<{ github_id: string }[]>`select github_id::text from github_person where actor_id = ${ctx.actorId}`,
  )
  if (!me) {
    return c.json(
      {
        error: {
          code: 'link_first',
          message: 'Connect your own GitHub in Account settings first, so Tuff can see this installation is yours.',
        },
      },
      400,
    )
  }
  const [by] = await withoutActor((tx) => tx<{ id: string | null }[]>`select github_installer(${body.data.installation_id})::text as id`)
  const installer = by?.id ?? null
  const ownAccount = found.account.type === 'User' && String(found.account.id) === me.github_id
  /* An old one only on the person's own account. A number guessed from
     somebody else's is not. */
  if (old && !ownAccount) {
    return c.json({ error: { code: 'invalid', message: 'That installation isn’t one this workspace started.' } }, 400)
  }
  if (!ownAccount && installer === null) {
    /* GitHub's word on who installed it has not come yet: asked again. */
    return c.json({ pending: true, message: 'Waiting for GitHub. Try again in a moment.' }, 202)
  }
  if (!ownAccount && installer !== me.github_id) {
    return c.json({ error: { code: 'invalid', message: 'Only whoever installed the app on GitHub can connect it.' } }, 400)
  }
  const made = await withActor(ctx.actorId, ctx.workspaceId, async (tx) => {
    const [taken] = await withoutActor(
      (t) =>
        t<
          { n: number }[]
        >`select count(*)::int as n from github_route(${body.data.installation_id}, 0) where workspace_id <> ${ctx.workspaceId}`,
    )
    if ((taken?.n ?? 0) > 0) return 'taken' as const
    await tx`update github_install set deleted_at = now() where workspace_id = ${ctx.workspaceId} and deleted_at is null`
    await tx`
      insert into github_install (id, workspace_id, installation_id, account_login, account_type, installed_by)
      values (${uuidv7()}, ${ctx.workspaceId}, ${body.data.installation_id}, ${found.account!.login}, ${found.account!.type}, ${ctx.actorId})`
    await record(tx, ctx, 'github.install', { meta: { account: found.account!.login } })
    return 'ok' as const
  })
  if (made === 'taken')
    return c.json({ error: { code: 'conflict', message: 'That GitHub account is connected to another workspace.' } }, 409)
  return c.json({ account_login: found.account.login }, 201)
})

/** Forgotten here; the app stays installed on GitHub until somebody removes it there. */
githubApi.delete('/github/install', async (c) => {
  const ctx = c.get('ctx')
  if (!owns(ctx)) return c.json(forbidden, 403)
  await withActor(ctx.actorId, ctx.workspaceId, async (tx) => {
    await tx`update github_link set deleted_at = now() where workspace_id = ${ctx.workspaceId} and deleted_at is null`
    const gone = await tx<{ account_login: string | null }[]>`
      update github_install set deleted_at = now() where workspace_id = ${ctx.workspaceId} and deleted_at is null
      returning account_login`
    /* In the audit log beside its connecting. */
    if (gone.length) await record(tx, ctx, 'github.remove', { meta: { account: gone[0]!.account_login } })
  })
  return c.body(null, 204)
})

/** The repositories the installation was given, and which project each is
    linked to — for the owner, and for whoever may change a project's
    settings: their names are not every member's to read. */
githubApi.get('/github/repos', async (c) => {
  const ctx = c.get('ctx')
  if (ctx.viaMcp || ctx.viaGithub) return c.json(forbidden, 403)
  if (!owns(ctx) && !Object.keys(ctx.rights).some((p) => allowIn(ctx, 'project.tools', p))) return c.json(forbidden, 403)
  const row = await installed(ctx)
  if (!row) return c.json({ repos: [] })
  /* The owner sees what they gave the app; anybody else, only what their
     own GitHub can reach of it — a private repository's name is not theirs
     to read here when it is not there. */
  const mine = owns(ctx) ? null : await personToken(ctx.actorId)
  if (!owns(ctx) && !mine) return c.json({ repos: [] })
  const [repos, links] = await Promise.all([
    mine ? personsRepos(mine, Number(row.installation_id)) : repositories(Number(row.installation_id)),
    withActor(
      ctx.actorId,
      ctx.workspaceId,
      (tx) =>
        tx<{ repo_id: string; project_id: string }[]>`
        select repo_id::text, project_id from github_link where workspace_id = ${ctx.workspaceId} and deleted_at is null`,
    ),
  ])
  return c.json({
    repos: repos.map((r) => ({
      id: r.id,
      name: r.full_name,
      private: r.private,
      project_id: links.find((l) => l.repo_id === String(r.id))?.project_id ?? null,
    })),
  })
})

type LinkRow = {
  id: string
  repo_id: string
  repo_name: string
  private: boolean
  issues: boolean
  linked_by: string
  linked_by_name: string
  stopped_at: string | null
}

githubApi.get('/projects/:id/github', async (c) => {
  const ctx = c.get('ctx')
  const [link] = await withActor(
    ctx.actorId,
    ctx.workspaceId,
    (tx) =>
      tx<LinkRow[]>`
      select l.id, l.repo_id::text, l.repo_name, l.private, l.issues, l.linked_by, a.name as linked_by_name, l.stopped_at
      from github_link l join actor a on a.id = l.linked_by
      where l.project_id = ${c.req.param('id')} and l.deleted_at is null`,
  )
  return c.json({ link: link ?? null })
})

/**
 * A repository for this project, by whoever may change the project's
 * settings — and they are who GitHub's changes are made as. A public one
 * with its issues is confirmed by typing its name: everything synced there
 * is public.
 */
githubApi.put('/projects/:id/github', async (c) => {
  const ctx = c.get('ctx')
  const projectId = c.req.param('id')
  if (ctx.viaMcp || ctx.viaGithub || !allowIn(ctx, 'project.tools', projectId)) return c.json(forbidden, 403)
  const body = z
    .object({ repo_id: z.number().int().positive(), issues: z.boolean().default(false), confirm: z.string().optional() })
    .safeParse(await c.req.json().catch(() => ({})))
  if (!body.success) return c.json({ error: { code: 'invalid' } }, 400)
  const row = await installed(ctx)
  if (!row) return c.json({ error: { code: 'invalid', message: 'Connect GitHub in the workspace’s settings first.' } }, 400)
  const repo = (await repositories(Number(row.installation_id))).find((r) => r.id === body.data.repo_id)
  if (!repo) return c.json({ error: { code: 'invalid', message: 'The Tuff app can’t see that repository.' } }, 400)
  /*
   * Somebody who is not the owner links only what they can see on GitHub
   * themselves. The installation is the workspace's, and its repositories
   * the owner's choice; a project's admin with no access to a private
   * repository would otherwise read its issues and pull requests here.
   */
  if (!owns(ctx)) {
    /* Read to see its pull requests; to its issues as well when they are
       kept in sync, since our changes are then written there as the app. */
    const mine = await personToken(ctx.actorId)
    const may = mine ? await personOnRepo(mine, repo.full_name) : 'none'
    if (may === 'none' || (body.data.issues && may !== 'write')) {
      return c.json({ error: { code: 'forbidden', message: 'Connect your own GitHub with access to that repository to link it.' } }, 403)
    }
  }
  if (body.data.issues && !repo.private && body.data.confirm !== repo.full_name) {
    return c.json(
      {
        error: {
          code: 'confirm',
          message: 'Type the repository’s full name to confirm: it’s public, and so will everything synced to it be.',
        },
      },
      400,
    )
  }
  const done = await withActor(ctx.actorId, ctx.workspaceId, async (tx) => {
    const [p] = await tx`select 1 from project where id = ${projectId} and deleted_at is null`
    if (!p) return 'missing' as const
    const [elsewhere] = await tx`
      select 1 from github_link
      where workspace_id = ${ctx.workspaceId} and repo_id = ${repo.id} and project_id <> ${projectId} and deleted_at is null`
    if (elsewhere) return 'taken' as const
    await tx`update github_link set deleted_at = now() where project_id = ${projectId} and deleted_at is null`
    await tx`
      insert into github_link (id, workspace_id, project_id, install_id, repo_id, repo_name, private, issues, linked_by)
      values (${uuidv7()}, ${ctx.workspaceId}, ${projectId}, ${row.id}, ${repo.id}, ${repo.full_name}, ${repo.private},
              ${body.data.issues}, ${ctx.actorId})`
    await record(tx, ctx, 'project.github', { projectId, objectType: 'project', objectId: projectId, meta: { repo: repo.full_name } })
    /* Its open issues brought across, by the worker. */
    if (body.data.issues) {
      await tx`
        insert into github_out (id, workspace_id, project_id, kind, object_id, actor_id)
        values (${uuidv7()}, ${ctx.workspaceId}, ${projectId}, 'import', ${projectId}, ${ctx.actorId})`
    }
    return 'ok' as const
  })
  if (done === 'missing') return c.json(missing, 404)
  if (done === 'taken') return c.json({ error: { code: 'conflict', message: 'That repository is linked to another project.' } }, 409)
  return c.json({ repo_name: repo.full_name }, 200)
})

githubApi.delete('/projects/:id/github', async (c) => {
  const ctx = c.get('ctx')
  const projectId = c.req.param('id')
  if (ctx.viaMcp || ctx.viaGithub || !allowIn(ctx, 'project.tools', projectId)) return c.json(forbidden, 403)
  await withActor(
    ctx.actorId,
    ctx.workspaceId,
    (tx) => tx`update github_link set deleted_at = now() where project_id = ${projectId} and deleted_at is null`,
  )
  return c.body(null, 204)
})

/* ------------------------------------------------- a person's own account */

type Mine = { github_id: string; login: string; avatar_url: string | null }

githubApi.get('/github/me', async (c) => {
  const ctx = c.get('ctx')
  const [row] = await withActor(
    ctx.actorId,
    ctx.workspaceId,
    (tx) => tx<Mine[]>`select github_id::text, login, avatar_url from github_person where actor_id = ${ctx.actorId}`,
  )
  return c.json({
    configured: githubConfigured() && Boolean(env.githubClientId),
    linked: row ? { login: row.login, avatar_url: row.avatar_url } : null,
  })
})

githubApi.post('/github/me/start', async (c) => {
  const ctx = c.get('ctx')
  if (ctx.viaMcp || ctx.viaGithub) return c.json(forbidden, 403)
  /* Not for an address nobody has proved: a GitHub linked then would speak
     as the address's owner once they proved it. */
  if (ctx.unproved) return c.json(UNPROVED, 403)
  if (!githubConfigured() || !env.githubClientId)
    return c.json({ error: { code: 'unavailable', message: 'GitHub isn’t set up on this server.' } }, 503)
  const [w] = await withActor(
    ctx.actorId,
    ctx.workspaceId,
    (tx) => tx<{ slug: string }[]>`select slug from workspace where id = ${ctx.workspaceId}`,
  )
  if (!w) return c.json({ error: { code: 'not_found' } }, 404)
  const state = seal({ w: ctx.workspaceId, a: ctx.actorId, s: w.slug, e: Date.now() + 15 * 60_000, k: 'me' })
  const q = new URLSearchParams({ client_id: env.githubClientId, redirect_uri: callback(c), state })
  return c.json({ url: `https://github.com/login/oauth/authorize?${q}` })
})

/** Finishing it, from the app, as the person the state was made for. */
githubApi.post('/github/me', async (c) => {
  const ctx = c.get('ctx')
  if (ctx.viaMcp || ctx.viaGithub) return c.json(forbidden, 403)
  /* Not for an address nobody has proved: a GitHub linked then would speak
     as the address's owner once they proved it. */
  if (ctx.unproved) return c.json(UNPROVED, 403)
  const body = z.object({ code: z.string().min(1), state: z.string() }).safeParse(await c.req.json().catch(() => ({})))
  if (!body.success) return c.json({ error: { code: 'invalid' } }, 400)
  const state = unseal(body.data.state)
  if (!state || state.k !== 'me' || state.a !== ctx.actorId) {
    return c.json({ error: { code: 'invalid', message: 'That link has run out. Connect GitHub again.' } }, 400)
  }
  let token, user
  try {
    token = await tradeCode(body.data.code, callback(c))
    user = await whoIs(token.token)
  } catch (e) {
    if (e instanceof GithubRefused) return c.json({ error: { code: 'invalid', message: 'GitHub didn’t confirm it. Try again.' } }, 400)
    throw e
  }
  const [taken] = await withoutActor((tx) => tx<{ yes: boolean }[]>`select github_account_taken(${user.id}, ${ctx.actorId}) as yes`)
  if (taken?.yes) return c.json({ error: { code: 'conflict', message: 'That GitHub account is linked to somebody else.' } }, 409)
  await withActor(
    ctx.actorId,
    ctx.workspaceId,
    (tx) => tx`
    insert into github_person (actor_id, github_id, login, avatar_url, token_enc, refresh_enc, token_until, refresh_until)
    values (${ctx.actorId}, ${user.id}, ${user.login}, ${user.avatar_url}, ${sealSecret(token.token)},
            ${token.refresh ? sealSecret(token.refresh) : null}, ${token.until}, ${token.refreshUntil})
    on conflict (actor_id) do update set
      github_id = excluded.github_id, login = excluded.login, avatar_url = excluded.avatar_url,
      token_enc = excluded.token_enc, refresh_enc = excluded.refresh_enc,
      token_until = excluded.token_until, refresh_until = excluded.refresh_until, updated_at = now()`,
  )
  return c.json({ login: user.login }, 201)
})

/** Unlinked here; the authorisation on GitHub is the person's to revoke there. */
githubApi.delete('/github/me', async (c) => {
  const ctx = c.get('ctx')
  if (ctx.viaMcp || ctx.viaGithub) return c.json(forbidden, 403)
  const token = await personToken(ctx.actorId)
  await withActor(ctx.actorId, ctx.workspaceId, (tx) => tx`delete from github_person where actor_id = ${ctx.actorId}`)
  void letGo(token)
  return c.body(null, 204)
})
