import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { randomBytes } from 'node:crypto'
import { v7 as uuidv7 } from 'uuid'
import { withActor, withoutActor } from '../db.js'
import { allowIn, feedbackContext, type AuthContext } from '../auth/context.js'
import { brandOf } from '../brand.js'
import { feedbackHeld } from '../ceilings.js'
import { edition } from '../edition.js'
import { hashToken } from '../auth/crypto.js'
import { issueAccessToken } from '../auth/tokens.js'
import { env } from '../env.js'
import { letter, send } from '../mail.js'
import { notify } from '../notify.js'
import { linkFor } from '../storage.js'
import { heard, say, type Language } from '../words.js'
import { record } from './activity.js'
import { fromOurPage, machineOf, networksOf } from './machine.js'
import { attempt, clientOf, fromInside, spendOn } from './limits.js'
import { forbidden, isInProject, missing } from './objects.js'
import { origin } from './access.js'
import { triageOn } from './tasks.js'

/**
 * A project's feedback page, phase 1: asking.
 *
 * Two sets of routes. `feedbackPublic`, under `/api/f`, is for anybody and
 * has no session: it reads one page at a time through definer functions,
 * holds what somebody asks until they confirm their address, and files it
 * as a task through the task route, as the page's own actor. `feedback`,
 * under `/api` behind the session, is the team's: the page's settings and
 * who follows it, decided by `can`.
 */
export const feedbackPublic = new Hono()
export const feedback = new Hono<{ Variables: { ctx: AuthContext } }>()

/* ------------------------------------------------------------- limits */

/** How long a mailed link works, and how much a page takes in a day. */
const HOLD_HOURS = 48
/* Two ceilings a day per page: requests filed, and requests still waiting
   for their link — so unconfirmed spam cannot close a page for the day. */
const MOST_A_DAY = 200
const MOST_WAITING = 500
/* Links mailed for one workspace's pages in a day. Past it nothing more is
   mailed, and the operators hear of it in the error log. */
const MAILS_A_WORKSPACE = 2000
/** A key the page hands a browser, and a link's token: 32 random bytes. */
const SECRET = /^[A-Za-z0-9_-]{43}$/
const SLUG = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/

/*
 * One line: a title is quoted in a mail we send to an address a stranger
 * typed, and a page's name goes in its subject and its From. A line break
 * in either wrote a second "Confirm request: <their link>" into the text
 * part above ours, or a header into the subject.
 */
const oneLine = (s: string) =>
  s
    .replace(/[\p{Cc}\u2028\u2029]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const Ask = z.object({
  title: z.string().transform(oneLine).pipe(z.string().min(1).max(120)),
  body: z.string().max(4000).default(''),
  email: z.email().max(254).optional(),
  turnstile: z.string().max(2048).optional(),
})

/* --------------------------------------------------------- what it says */

const ERR = {
  missing: { error: { code: 'not_found', message: 'This page doesn’t exist.' } },
  paused: { error: { code: 'paused', message: 'This page is paused. Try again later.' } },
  notHere: { error: { code: 'from_page', message: 'Send your request from the page.' } },
  busy: { error: { code: 'rate_limited', message: 'Too many requests. Try again later.' } },
  full: { error: { code: 'full', message: 'This page has had a lot of requests today. Try again tomorrow.' } },
  human: { error: { code: 'turnstile', message: 'Couldn’t check that you’re a person. Try again.' } },
  email: { error: { code: 'email', message: 'Enter your email address.' } },
  invalid: { error: { code: 'invalid', message: 'Add a title for your request.' } },
  unknown: { error: { code: 'unknown_key', message: 'Enter your email address to send this.' } },
  link: { error: { code: 'link', message: 'This link has expired or was already used.' } },
  failed: { error: { code: 'failed', message: 'Couldn’t send your request. Try again.' } },
  taken: { error: { code: 'taken', message: 'That address is taken.' } },
  slug: { error: { code: 'invalid', message: 'Use 3 to 40 lowercase letters, numbers and dashes.' } },
  linky: { error: { code: 'invalid', message: 'A page’s name and intro can’t contain web or email addresses.' } },
  holding: {
    error: {
      code: 'holding',
      message: 'This page’s previous address still points here for 30 days. You can change it again after that.',
    },
  },
}

/** The mail a request's link comes in, in the language of the page it was asked on. */
const MAIL = (language: Language) =>
  say(
    {
      /* Neutral, and from Tuff: a page's name in the From or the subject
         would let anybody with a page write "PayPal" where an inbox
         puts its trust. The name is in the body only. */
      subject: ['Confirm your request', 'Confirmez votre demande'],
      /* Never what they wrote: a mail from our address carries no text a
         stranger chose. The confirm page shows it, to whoever opens the link. */
      asked: [
        (page: string) => `Someone using this address sent a request on the ${page} feedback page.`,
        (page: string) => `Quelqu’un a envoyé une demande depuis cette adresse sur la page de retours de ${page}.`,
      ],
      why: [
        'Open the link to see it and confirm it, so the team gets it. The link works for two days.',
        'Ouvrez le lien pour la voir et la confirmer, afin que l’équipe la reçoive. Le lien est valable deux jours.',
      ],
      button: ['Confirm request', 'Confirmer la demande'],
      notYou: ['If you didn’t ask for this, ignore this email.', 'Si vous n’avez rien demandé, ignorez cet e-mail.'],
    },
    language,
  )

/** The note a follower gets — never what the stranger wrote, which a push
    would put on a lock screen. */
const ARRIVED = (language: Language) =>
  say({ line: ['New request from the feedback page', 'Nouvelle demande depuis la page de retours'] }, language).line

/* --------------------------------------------------------- the page row */

type PageRow = {
  page_id: string
  workspace_id: string
  project_id: string
  actor_id: string
  slug: string
  name: string
  intro: string | null
  mark_icon: string | null
  mark_tint: number | null
  icon_key: string | null
  available: boolean
  moved_to: string | null
}

async function pageBySlug(slug: string): Promise<PageRow | null> {
  if (!SLUG.test(slug)) return null
  const [row] = await withoutActor((tx) => tx<PageRow[]>`select * from feedback_page_by_slug(${slug})`)
  return row ?? null
}

/*
 * The mark the project wears, worked out here so the page never learns the
 * project's id: the same hash as `hashedMark` in `web/src/ui/icons.tsx`,
 * over the same eight glyphs, when nobody chose one.
 */
const MARKS = ['globe', 'rocket', 'briefcase', 'code', 'palette', 'chart', 'target', 'bolt']
function markFor(p: PageRow): { icon: string; tint: number; url: string | null } {
  let hash = 0
  for (const ch of p.project_id) hash = (hash * 31 + ch.charCodeAt(0)) % 100_000
  return {
    icon: p.mark_icon ?? MARKS[hash % MARKS.length]!,
    tint: p.mark_tint ?? hash % 10,
    url: p.icon_key ? linkFor(p.icon_key) : null,
  }
}

const paused = () => (process.env.FEEDBACK ?? '').trim().toLowerCase() === 'off'

/** The browser's key, from `Authorization: Feedback <key>` — never an address. */
function keyOf(c: Context): string | null | 'bad' {
  const said = c.req.header('authorization')
  if (!said) return null
  const m = /^Feedback ([A-Za-z0-9_-]+)$/.exec(said)
  return m && SECRET.test(m[1]!) ? m[1]! : 'bad'
}

const secret = () => randomBytes(32).toString('base64url')

/**
 * One machine's allowance, and the wider networks' around it, as a board's
 * starts are counted (`board.ts`): an IPv4 address or an IPv6 /64, then
 * the /56 and the /48 it sits in, each with a larger share. An IPv6 user
 * is handed a /64 at least and could otherwise spread over it, or over
 * the /56 behind it, for a new allowance each time.
 */
async function around(what: string, ip: string, most: [number, number, number], seconds: number): Promise<boolean> {
  if (!(await spendOn(`${what}:${machineOf(ip)}`, most[0], seconds))) return false
  const wider = networksOf(ip)
  if (!wider) return true
  return (await spendOn(`${what}:${wider.n56}`, most[1], seconds)) && (await spendOn(`${what}:${wider.n48}`, most[2], seconds))
}

/* ----------------------------------------------------------- Turnstile */

/**
 * Whether Cloudflare says a person pressed Send.
 * Only its answer is asked, with the secret from the environment. A
 * deployment with no secret asks nothing on a laptop and refuses everything
 * in production, where taking requests unchecked would be the mistake.
 */
export async function turnstileOk(token: string | undefined, ip: string): Promise<boolean> {
  const key = env.turnstileSecretKey
  if (!key) return process.env.NODE_ENV !== 'production'
  if (!token) return false
  try {
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: new URLSearchParams({ secret: key, response: token, remoteip: ip }),
      signal: AbortSignal.timeout(5000),
    })
    const said = (await r.json().catch(() => null)) as { success?: boolean; hostname?: string } | null
    if (said?.success !== true) return false
    /* Made for this site: a token solved on another page with our key is
       not a press here. */
    if (env.appUrl && said.hostname && said.hostname !== new URL(env.appUrl).hostname) return false
    /* And in production the answer has to say where it was solved: one
       that names no host is not one we can hold to this site. */
    if (process.env.NODE_ENV === 'production' && !said.hostname) return false
    return true
  } catch {
    return false
  }
}

/* ------------------------------------------------------------- filing */

/** Plain text as the editor's paragraphs — a stranger's words stay words. */
function asDoc(text: string): unknown {
  const paras = text
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
  if (paras.length === 0) return null
  return {
    type: 'doc',
    content: paras.map((p) => ({
      type: 'paragraph',
      content: p
        .split('\n')
        .flatMap((line, i) => [...(i > 0 ? [{ type: 'hardBreak' }] : []), ...(line ? [{ type: 'text', text: line }] : [])]),
    })),
  }
}

/**
 * A claimed request, filed: the task made through the task route as the
 * page's actor — so it lands in Triage with the route's own checks, feed,
 * webhooks and notes — then written down against the request, and the
 * page's followers told. A failure lets the claim go, so the link (or the
 * browser's next press) can try again.
 */
async function file(page: PageRow, pendingId: string, title: string, body: string): Promise<boolean> {
  /* The task first. Only while it does not exist may the claim be let go:
     a hold let go after its task was made is a link that files it twice. */
  let taskId: string
  try {
    const token = await issueAccessToken({ sub: page.actor_id, workspace_id: page.workspace_id, via: 'feedback' })
    const { app } = await import('./routes.js')
    const r = await app.request(`/api/projects/${page.project_id}/tasks`, {
      method: 'POST',
      headers: { ...fromInside(), authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ title, ...(asDoc(body) ? { body: asDoc(body) } : {}) }),
    })
    if (!r.ok) throw new Error(`the task route answered ${r.status}`)
    taskId = ((await r.json()) as { id: string }).id
  } catch (e) {
    console.error('[feedback] could not file a request', e)
    await withoutActor((tx) => tx`select feedback_unclaim(${pendingId})`).catch(() => {})
    return false
  }
  /* Made: written down against the request, or — if that fails — the hold
     dropped, so the task stands once and the requester line is missing. */
  try {
    await withoutActor((tx) => tx`select feedback_filed(${pendingId}, ${taskId})`)
  } catch (e) {
    console.error('[feedback] a request was filed and could not be written down', e)
    await withoutActor((tx) => tx`select feedback_drop(${pendingId})`).catch(() => {})
  }
  /* And the followers told; a note that fails takes nothing back. */
  try {
    const ctx = await feedbackContext(page.actor_id, page.workspace_id)
    if (ctx) {
      await withActor(page.actor_id, page.workspace_id, async (tx) => {
        const followers = await tx<{ actor_id: string }[]>`select * from feedback_followers(${page.page_id})`
        if (followers.length === 0) return
        await notify(tx, ctx, {
          objectType: 'task',
          objectId: taskId,
          watchers: false,
          kind: 'added',
          what: ARRIVED,
          also: { ids: followers.map((f) => f.actor_id), reason: 'subscribed' },
        })
      })
    }
  } catch (e) {
    console.error('[feedback] could not tell the followers of a request', e)
  }
  return true
}

/* ------------------------------------------------------- the public's */

feedbackPublic.use('*', async (c, next) => {
  /* Read by whoever has the address, and never kept by a shared cache:
     turned off, it stops at once. */
  c.header('cache-control', 'private, no-store')
  c.header('x-robots-tag', 'noindex')
  if (paused()) return c.json(ERR.paused, 503)
  await next()
})

feedbackPublic.get('/:slug', async (c) => {
  const page = await pageBySlug(c.req.param('slug'))
  if (!page) return c.json(ERR.missing, 404)
  /* The workspace's own name and mark at the foot, where its plan wears
     them; null, and the page says nothing
     of the workspace, anywhere else. */
  const brand = edition.brands ? await withoutActor((tx) => brandOf(tx, page.workspace_id)) : null
  return c.json({
    slug: page.slug,
    name: page.name,
    intro: page.intro,
    mark: markFor(page),
    available: page.available,
    turnstile_site_key: env.turnstileSiteKey || null,
    brand,
    ...(page.moved_to ? { moved_to: page.moved_to } : {}),
  })
})

/** Who this browser's key says it is, for "Sending as …". */
feedbackPublic.get('/:slug/me', async (c) => {
  const page = await pageBySlug(c.req.param('slug'))
  if (!page?.available) return c.json(ERR.missing, 404)
  const key = keyOf(c)
  if (!key || key === 'bad') return c.json(ERR.unknown, 401)
  const [me] = await withoutActor((tx) => tx<{ email: string }[]>`select * from feedback_known(${page.page_id}, ${hashToken(key)})`)
  if (!me) return c.json(ERR.unknown, 401)
  return c.json({ email: me.email })
})

/**
 * A request. With this page's key it is filed at once; without, it is held
 * and a link mailed, and it is nothing until that link's page is pressed.
 */
feedbackPublic.post('/:slug/requests', async (c) => {
  if (!(c.req.header('content-type') ?? '').startsWith('application/json') || !fromOurPage(c)) {
    return c.json(ERR.notHere, 403)
  }
  const page = await pageBySlug(c.req.param('slug'))
  if (!page?.available) return c.json(ERR.missing, 404)
  const asked = Ask.safeParse(await c.req.json().catch(() => ({})))
  if (!asked.success) return c.json(ERR.invalid, 400)
  const key = keyOf(c)
  if (key === 'bad') return c.json(ERR.unknown, 401)
  if (!key && !asked.data.email) return c.json(ERR.email, 400)

  const ip = clientOf(c)
  if (!(await around('fb-ask', ip, [10, 30, 100], 3600))) return c.json(ERR.busy, 429)
  if (!(await turnstileOk(asked.data.turnstile, ip))) return c.json(ERR.human, 400)

  const language = heard(c)
  const token = key ? null : secret()
  const [held] = await withoutActor(
    (tx) => tx<
      { pending_id: string | null; person_id: string; email: string; confirmed: boolean; blocked: boolean; full_today: boolean }[]
    >`
    select * from feedback_hold(${page.page_id}, ${asked.data.email ?? null}, ${key ? hashToken(key) : null},
                                ${language}, ${asked.data.title}, ${asked.data.body},
                                ${token ? hashToken(token) : null}, ${HOLD_HOURS}, ${MOST_A_DAY}, ${MOST_WAITING})`,
  )
  /* A key this page never handed out, or one whose address is gone. */
  if (!held) return c.json(ERR.unknown, 401)
  if (held.full_today) return c.json(ERR.full, 429)
  /* Blocked: thanked as anybody is, and dropped. */
  if (held.blocked || !held.pending_id) return c.json({ status: key ? 'sent' : 'check_email' })

  if (key) {
    const ok = await file(page, held.pending_id, asked.data.title, asked.data.body)
    return ok ? c.json({ status: 'sent' }) : c.json(ERR.failed, 500)
  }

  /* Links: a few to one address, and a few from one machine — so the box
     is not a way to fill somebody's inbox. Past either, held and not sent;
     the person is told as if it went. */
  const mayMail =
    (await around('fb-mail', ip, [10, 30, 100], 3600)) &&
    (await spendOn(`fb-to:${page.page_id}:${inboxOf(held.email)}`, 3, 86_400)) &&
    (await spendOn(`fb-inbox:${inboxOf(held.email)}`, INBOX_A_DAY, 86_400)) &&
    (await workspaceMayMail(page.workspace_id))
  if (mayMail) {
    const words = MAIL(language)
    const url = `${origin(c)}/f/${page.slug}/confirm/${token}`
    await send({
      to: held.email,
      subject: words.subject,
      ...letter([words.asked(oneLine(page.name)), words.why, words.notYou], { label: words.button, url }, language),
    })
  }
  return c.json({ status: 'check_email' })
})

/*
 * One inbox, however its address is spelled: `ana+1@`, `ana+2@` and, at
 * Gmail, `a.na@` all land in the same one, and each spelling had three
 * links a day of its own — on every page. Counted as the inbox, per page
 * and across all of them, so the box is not a way to fill one person's.
 */
const INBOX_A_DAY = 10
export function inboxOf(email: string): string {
  const at = email.lastIndexOf('@')
  if (at < 0) return email.toLowerCase()
  let local = email.slice(0, at).toLowerCase().split('+')[0]!
  let domain = email.slice(at + 1).toLowerCase()
  if (domain === 'googlemail.com') domain = 'gmail.com'
  if (domain === 'gmail.com') local = local.replace(/\./g, '')
  return `${local}@${domain}`
}

/** Whether one workspace's pages may mail another link today; past the
    ceiling the error log says so, once an hour. */
async function workspaceMayMail(workspaceId: string): Promise<boolean> {
  if (await spendOn(`fb-ws-mail:${workspaceId}`, MAILS_A_WORKSPACE, 86_400)) return true
  if (await spendOn(`fb-ws-mail-said:${workspaceId}`, 1, 3600)) {
    console.error(`feedback: workspace ${workspaceId} has mailed ${MAILS_A_WORKSPACE} confirmation links today; no more until tomorrow`)
  }
  return false
}

/** What a link would confirm, read and never acted on. */
feedbackPublic.get('/:slug/confirm/:token', async (c) => {
  c.header('referrer-policy', 'no-referrer')
  const page = await pageBySlug(c.req.param('slug'))
  const token = c.req.param('token')
  if (!page?.available) return c.json(ERR.missing, 404)
  const miss = await attempt(`fb-miss:${machineOf(clientOf(c))}`, 30, 60)
  if (!miss.ok) return c.json(ERR.busy, 429)
  if (!SECRET.test(token)) return c.json(ERR.link, 410)
  const [w] = await withoutActor(
    (tx) => tx<{ title: string; body: string; email: string; expired: boolean; done: boolean }[]>`
    select * from feedback_waiting(${page.page_id}, ${hashToken(token)})`,
  )
  if (!w || w.expired || w.done) return c.json(ERR.link, 410)
  await miss.right()
  return c.json({ title: w.title, body: w.body, email: w.email })
})

/**
 * The press. The address is confirmed, the request filed, and the browser
 * handed this page's key — so its next request needs no mail.
 */
feedbackPublic.post('/:slug/confirm/:token', async (c) => {
  c.header('referrer-policy', 'no-referrer')
  if (!fromOurPage(c)) return c.json(ERR.notHere, 403)
  const page = await pageBySlug(c.req.param('slug'))
  const token = c.req.param('token')
  if (!page?.available) return c.json(ERR.missing, 404)
  const miss = await attempt(`fb-miss:${machineOf(clientOf(c))}`, 30, 60)
  if (!miss.ok) return c.json(ERR.busy, 429)
  if (!SECRET.test(token)) return c.json(ERR.link, 410)
  const key = secret()
  const [claim] = await withoutActor(
    (tx) => tx<{ pending_id: string; title: string; body: string; full_today: boolean }[]>`
    select * from feedback_confirm(${page.page_id}, ${hashToken(token)}, ${hashToken(key)}, ${MOST_A_DAY})`,
  )
  /* The page took its day's share: the link stays good for tomorrow. */
  if (claim?.full_today) return c.json(ERR.full, 429)
  if (!claim) return c.json(ERR.link, 410)
  await miss.right()
  const ok = await file(page, claim.pending_id, claim.title, claim.body)
  return ok ? c.json({ key }) : c.json(ERR.failed, 500)
})

/* ------------------------------------------------------- the team's */

/*
 * Whether words look like an address — a scheme, `www.`, an `@`, or a dot
 * before a word that could be a domain's end. A page's name and intro are
 * shown on a page under our domain and named in a mail from us, and an
 * address there is how a page passes for somebody else's sign-in.
 */
export const linky = (s: string): boolean =>
  /[a-z][a-z0-9+.-]*:\/\//i.test(s) || /\bwww\./i.test(s) || s.includes('@') || /\.[a-z]{2,24}\b/i.test(s)

const Settings = z.object({
  live: z.boolean().optional(),
  slug: z.string().trim().toLowerCase().optional(),
  name: z.string().transform(oneLine).pipe(z.string().min(1).max(80)).optional(),
  intro: z.string().transform(oneLine).pipe(z.string().max(200)).nullable().optional(),
})

type Page = { id: string; slug: string; name: string; intro: string | null; live: boolean }

/** A free address to offer: the workspace's, then the workspace and project's. */
async function suggest(ctx: AuthContext, projectId: string): Promise<string> {
  return withActor(ctx.actorId, ctx.workspaceId, async (tx) => {
    const [names] = await tx<{ ws: string; project: string }[]>`
      select w.slug as ws, p.slug as project from project p join workspace w on w.id = p.workspace_id
      where p.id = ${projectId}`
    if (!names) return ''
    const tidy = (s: string) =>
      s
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 40)
        .replace(/-$/, '')
    const tries = [tidy(names.ws), tidy(`${names.ws}-${names.project}`)]
    for (let n = 2; n < 6; n++) tries.push(tidy(`${names.ws}-${names.project}`).slice(0, 37) + `-${n}`)
    for (const t of tries) {
      if (!SLUG.test(t)) continue
      const [r] = await tx<{ free: boolean }[]>`select feedback_slug_free(${t}, null) as free`
      if (r?.free) return t
    }
    return ''
  })
}

/** Whoever may not set up a page, and why — a person, where the edition lets the workspace have one. */
function refusal(ctx: AuthContext, projectId: string) {
  if (ctx.viaMcp || ctx.viaGithub || ctx.viaImport || ctx.feedbackPage) return forbidden
  if (feedbackHeld(ctx)) return edition.ceilings?.says.feedback ?? forbidden
  return allowIn(ctx, 'feedback.manage', projectId) ? null : forbidden
}

feedback.get('/projects/:projectId/feedback', async (c) => {
  const ctx = c.get('ctx')
  const projectId = c.req.param('projectId')
  const read = await withActor(ctx.actorId, ctx.workspaceId, async (tx) => {
    if (!(await isInProject(tx, projectId))) return null
    const [[page], [follows], [intake]] = await Promise.all([
      tx<Page[]>`select id, slug, name, intro, live from feedback_page where project_id = ${projectId}`,
      tx`select 1 from feedback_follower f join feedback_page p on p.id = f.page_id
         where p.project_id = ${projectId} and f.actor_id = ${ctx.actorId}`,
      tx`select 1 from task_list where project_id = ${projectId} and intake and deleted_at is null`,
    ])
    return { page: page ?? null, following: Boolean(follows), triage: Boolean(intake) }
  })
  if (!read) return c.json(missing, 404)
  return c.json({
    ...read,
    suggested_slug: read.page ? read.page.slug : await suggest(ctx, projectId),
    may: refusal(ctx, projectId) === null,
    paid: !feedbackHeld(ctx),
  })
})

/** Is this address free — asked as it is typed, so the field can say so. */
feedback.get('/projects/:projectId/feedback/slug/:slug', async (c) => {
  const ctx = c.get('ctx')
  const projectId = c.req.param('projectId')
  const slug = c.req.param('slug').toLowerCase()
  if (refusal(ctx, projectId)) return c.json(forbidden, 403)
  if (!SLUG.test(slug)) return c.json({ free: false, valid: false })
  const free = await withActor(ctx.actorId, ctx.workspaceId, async (tx) => {
    const [page] = await tx<{ id: string }[]>`select id from feedback_page where project_id = ${projectId}`
    const [r] = await tx<{ free: boolean }[]>`select feedback_slug_free(${slug}, ${page?.id ?? null}) as free`
    return r?.free === true
  })
  return c.json({ free, valid: true })
})

/**
 * The page on or off, its address and its words. The first save makes it,
 * with its actor, and makes whoever made it its first follower.
 */
feedback.put('/projects/:projectId/feedback', async (c) => {
  const ctx = c.get('ctx')
  const projectId = c.req.param('projectId')
  const no = refusal(ctx, projectId)
  if (no) return c.json(no, 403)
  const asked = Settings.safeParse(await c.req.json().catch(() => ({})))
  if (!asked.success) return c.json({ error: { code: 'invalid' } }, 400)
  const { live, slug, name, intro } = asked.data
  if ((name && linky(name)) || (intro && linky(intro))) return c.json(ERR.linky, 400)
  if (slug !== undefined && !SLUG.test(slug)) return c.json(ERR.slug, 400)
  const suggested = slug === undefined ? await suggest(ctx, projectId) : slug

  const done = await withActor(ctx.actorId, ctx.workspaceId, async (tx) => {
    if (!(await isInProject(tx, projectId))) return 'missing' as const
    let [page] = await tx<Page[]>`select id, slug, name, intro, live from feedback_page where project_id = ${projectId}`
    const want = slug ?? page?.slug ?? suggested
    if (!SLUG.test(want)) return 'slug' as const
    const [free] = await tx<{ free: boolean }[]>`select feedback_slug_free(${want}, ${page?.id ?? null}) as free`
    if (!free?.free) return 'taken' as const
    if (!page) {
      const [project] = await tx<{ name: string }[]>`select name from project where id = ${projectId}`
      const called = (name ?? project?.name ?? 'Feedback').slice(0, 80)
      const id = uuidv7()
      await tx`select feedback_page_make(${id}, ${projectId}, ${want}, ${called}, ${`${called} feedback`.slice(0, 60)})`
      await tx`
        insert into feedback_follower (workspace_id, project_id, page_id, actor_id)
        values (${ctx.workspaceId}, ${projectId}, ${id}, ${ctx.actorId}) on conflict do nothing`
      ;[page] = await tx<Page[]>`select id, slug, name, intro, live from feedback_page where id = ${id}`
    }
    /* Turned on, the page's requests need somewhere to wait: Triage, made
       here if the project has none, in the same transaction. Whoever holds
       `feedback.manage` holds `project.tools` — both are running the
       project. Turned off, Triage stays as it is. */
    if (live === true && !page!.live) {
      const [busy] = await tx<{ on: boolean }[]>`select project_importing(${projectId}) as on`
      if (busy?.on) return 'importing' as const
      await triageOn(tx, ctx, projectId)
    }
    const next = {
      slug: want,
      name: name ?? page!.name,
      intro: intro === undefined ? page!.intro : intro || null,
      live: live ?? page!.live,
    }
    await tx`
      update feedback_page set slug = ${next.slug}, name = ${next.name}, intro = ${next.intro},
                               live = ${next.live}, updated_at = now()
      where id = ${page!.id}`
    if (next.live !== page!.live) {
      await record(tx, ctx, next.live ? 'project.feedback.on' : 'project.feedback.off', {
        projectId,
        objectType: 'project',
        objectId: projectId,
        meta: { slug: next.slug },
      })
    }
    return { ...page!, ...next }
  }).catch((e: { code?: string }) => {
    /* Two people saving the same address at once: the index says which. */
    if (e.code === '23505') return 'taken' as const
    /* The page already holds an old address for its thirty days. */
    if ((e as { message?: string }).message === 'feedback_slug_holding') return 'holding' as const
    throw e
  })
  if (done === 'missing') return c.json(missing, 404)
  if (done === 'slug') return c.json(ERR.slug, 400)
  if (done === 'taken') return c.json(ERR.taken, 409)
  if (done === 'holding') return c.json(ERR.holding, 409)
  if (done === 'importing') {
    return c.json({ error: { code: 'conflict', message: 'This project is still being imported. Try again when it’s done.' } }, 409)
  }
  return c.json({ page: done })
})

/** Whether you hear of new requests — anybody on the project, for themselves. */
feedback.put('/projects/:projectId/feedback/follow', async (c) => {
  const ctx = c.get('ctx')
  const projectId = c.req.param('projectId')
  if (ctx.viaMcp || ctx.feedbackPage) return c.json(forbidden, 403)
  const asked = z.object({ follow: z.boolean() }).safeParse(await c.req.json().catch(() => ({})))
  if (!asked.success) return c.json({ error: { code: 'invalid' } }, 400)
  const done = await withActor(ctx.actorId, ctx.workspaceId, async (tx) => {
    if (!(await isInProject(tx, projectId))) return 'missing' as const
    const [page] = await tx<{ id: string }[]>`select id from feedback_page where project_id = ${projectId}`
    if (!page) return 'missing' as const
    if (asked.data.follow) {
      await tx`
        insert into feedback_follower (workspace_id, project_id, page_id, actor_id)
        values (${ctx.workspaceId}, ${projectId}, ${page.id}, ${ctx.actorId}) on conflict do nothing`
    } else {
      await tx`delete from feedback_follower where page_id = ${page.id} and actor_id = ${ctx.actorId}`
    }
    return 'ok' as const
  })
  if (done === 'missing') return c.json(missing, 404)
  return c.json({ following: asked.data.follow })
})
