import { Hono } from 'hono'
import { z } from 'zod'
import { allow, type AuthContext } from '../auth/context.js'
import { Later, Refused } from '../importing.js'
import { projectsOf as jiraProjects, siteOf, type JiraKey } from '../jira.js'
import { projectsOf as asanaProjects } from '../asana.js'
import { spendOn } from './limits.js'
import { begin } from './linearImport.js'

/**
 * A project brought across from Jira or Asana.
 *
 * What a person does: list what a key can see, then start. Everything
 * after is the worker's, through the doors every import writes by
 * (`linearImport.ts`), and the progress and Stop are Linear's own.
 */
type Vars = { ctx: AuthContext }
export const otherImport = new Hono<{ Variables: Vars }>()

const JiraBody = z.object({
  site: z.string().trim().min(1).max(200),
  email: z.email().max(254),
  token: z
    .string()
    .trim()
    .min(20)
    .max(400)
    .regex(/^[A-Za-z0-9_=+/.-]+$/),
})
/* Asana's tokens: `2/1203…/1209…:a1b2…`, and the older `1/…:…`. */
const AsanaToken = z
  .string()
  .trim()
  .min(20)
  .max(200)
  .regex(/^[0-9A-Za-z/:_-]+$/)

/* As Linear's (`linearImport.ts`): the owner, by hand. Written here again
   so each refusal is in the file that sends it, with its words. */
function mayStart(ctx: AuthContext): string | null {
  if (ctx.viaMcp || ctx.viaGithub || ctx.viaImport) return 'Connected tools can’t import.'
  if (!allow(ctx, 'audit.read')) return 'Only the workspace owner can import.'
  return null
}

const tooMany = { error: { code: 'rate_limited', message: 'Too many attempts. Try again in a few minutes.' } }

/* What went wrong asking the other product, as a status of ours. */
function statusOf(e: unknown): 400 | 429 | 502 {
  if (e instanceof Refused && (e.status === 401 || e.status === 400 || e.status === 404)) return 400
  return e instanceof Later ? 429 : 502
}
/* And in words, each written out whole so it has its French (`words.ts`). */
function jiraSays(e: unknown): string {
  if (e instanceof Refused && e.status === 401) return 'Jira didn’t accept that email and token.'
  if (e instanceof Refused && (e.status === 400 || e.status === 404)) return 'Jira couldn’t find that.'
  if (e instanceof Later) return 'Jira asked us to wait. Try again in a minute.'
  return 'Couldn’t reach Jira. Try again.'
}
function asanaSays(e: unknown): string {
  if (e instanceof Refused && e.status === 401) return 'Asana didn’t accept that token.'
  if (e instanceof Refused && (e.status === 400 || e.status === 404)) return 'Asana couldn’t find that.'
  if (e instanceof Later) return 'Asana asked us to wait. Try again in a minute.'
  return 'Couldn’t reach Asana. Try again.'
}

async function readJira(c: {
  req: { json: () => Promise<unknown> }
}): Promise<(JiraKey & { teams?: string[] | undefined }) | 'site' | null> {
  const raw = await c.req.json().catch(() => ({}))
  const body = JiraBody.extend({
    teams: z
      .array(z.string().regex(/^\d{1,20}$/))
      .min(1)
      .max(20)
      .optional(),
  }).safeParse(raw)
  if (!body.success) return null
  /* The site is Atlassian's or nothing: this field is where our server goes. */
  const site = siteOf(body.data.site)
  if (!site) return 'site'
  return { ...body.data, site }
}

otherImport.post('/import/jira/projects', async (c) => {
  const ctx = c.get('ctx')
  const no = mayStart(ctx)
  if (no) return c.json({ error: { code: 'forbidden', message: no } }, 403)
  if (!(await spendOn(`jira:list:${ctx.actorId}`, 20, 3600))) return c.json(tooMany, 429)
  const k = await readJira(c)
  if (k === 'site') return c.json({ error: { code: 'invalid', message: 'Enter your Jira site, like acme.atlassian.net.' } }, 400)
  if (!k) return c.json({ error: { code: 'invalid', message: 'Enter the email and API token you use for Jira.' } }, 400)
  try {
    return c.json({ teams: await jiraProjects(k) })
  } catch (e) {
    return c.json({ error: { code: statusOf(e) === 429 ? 'rate_limited' : 'invalid', message: jiraSays(e) } }, statusOf(e))
  }
})

otherImport.post('/import/jira', async (c) => {
  const ctx = c.get('ctx')
  const no = mayStart(ctx)
  if (no) return c.json({ error: { code: 'forbidden', message: no } }, 403)
  if (!(await spendOn(`jira:start:${ctx.actorId}`, 10, 3600))) return c.json(tooMany, 429)
  const k = await readJira(c)
  if (!k || k === 'site' || !k.teams) return c.json({ error: { code: 'invalid' } }, 400)
  /* Asked again with the key: what is brought is what the key can see. */
  let teams
  try {
    teams = (await jiraProjects(k)).filter((t) => k.teams!.includes(t.id))
  } catch (e) {
    return c.json({ error: { code: 'invalid', message: jiraSays(e) } }, statusOf(e))
  }
  if (!teams.length) return c.json({ error: { code: 'invalid', message: 'Choose at least one project.' } }, 400)
  const id = await begin(ctx, 'jira', JSON.stringify({ site: k.site, email: k.email, token: k.token }), teams)
  if (!id) return c.json({ error: { code: 'conflict', message: 'An import is already running.' } }, 409)
  return c.json({ id }, 202)
})

otherImport.post('/import/asana/projects', async (c) => {
  const ctx = c.get('ctx')
  const no = mayStart(ctx)
  if (no) return c.json({ error: { code: 'forbidden', message: no } }, 403)
  if (!(await spendOn(`asana:list:${ctx.actorId}`, 20, 3600))) return c.json(tooMany, 429)
  const body = z.object({ token: AsanaToken }).safeParse(await c.req.json().catch(() => ({})))
  if (!body.success) return c.json({ error: { code: 'invalid', message: 'That doesn’t look like an Asana token.' } }, 400)
  try {
    return c.json({ teams: await asanaProjects(body.data.token) })
  } catch (e) {
    return c.json({ error: { code: statusOf(e) === 429 ? 'rate_limited' : 'invalid', message: asanaSays(e) } }, statusOf(e))
  }
})

otherImport.post('/import/asana', async (c) => {
  const ctx = c.get('ctx')
  const no = mayStart(ctx)
  if (no) return c.json({ error: { code: 'forbidden', message: no } }, 403)
  if (!(await spendOn(`asana:start:${ctx.actorId}`, 10, 3600))) return c.json(tooMany, 429)
  const body = z
    .object({
      token: AsanaToken,
      teams: z
        .array(z.string().regex(/^\d{1,30}$/))
        .min(1)
        .max(20),
    })
    .safeParse(await c.req.json().catch(() => ({})))
  if (!body.success) return c.json({ error: { code: 'invalid' } }, 400)
  let teams
  try {
    teams = (await asanaProjects(body.data.token)).filter((t) => body.data.teams.includes(t.id))
  } catch (e) {
    return c.json({ error: { code: 'invalid', message: asanaSays(e) } }, statusOf(e))
  }
  if (!teams.length) return c.json({ error: { code: 'invalid', message: 'Choose at least one project.' } }, 400)
  const id = await begin(ctx, 'asana', body.data.token, teams)
  if (!id) return c.json({ error: { code: 'conflict', message: 'An import is already running.' } }, 409)
  return c.json({ id }, 202)
})
