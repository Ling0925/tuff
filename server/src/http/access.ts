import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { v7 as uuidv7 } from 'uuid'
import { SignJWT, decodeJwt, jwtVerify, createRemoteJWKSet, importPKCS8, type JWTPayload } from 'jose'
import { keyFor, legacyKey } from '../auth/keys.js'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { env } from '../env.js'
import { secureAttr } from '../tryLocalhost.js'
import { edition } from '../edition.js'
import { origin } from '../publicUrl.js'
import { fullRefusal } from '../ceilings.js'
import { withoutActor } from '../db.js'
import { generateToken, hashPassword, hashToken } from '../auth/crypto.js'
import {
  confirmed,
  firstWorkspace,
  ownWorkspaceName,
  planNewWorkspace,
  secondFactor,
  startNowhereSession,
  startSession,
  takeInvite,
} from '../auth/flows.js'
import { NO_WORKSPACE_YET } from './nowhere.js'
import { follow, tellWayIn } from '../auth/address.js'
import { tellInviter } from '../notify.js'
import { letter, mailOn, send } from '../mail.js'
import { heard, languageFor, say } from '../words.js'
import { clientOf, guess, metaOf, onThisMachine, spendOn } from './limits.js'
import { isClosed, orClosed, serverClaimed, SignUpClosed, signUpOpen } from '../instance.js'

/**
 * Getting in by Google or Apple, and back in when a password is forgotten.
 *
 * Everything here runs before there is anybody to run as, so it goes through
 * the definer functions migration 087 made rather than reading tables.
 */
export const access = new Hono()

type Provider = 'google' | 'apple' | 'github'
const ALL = ['google', 'apple', 'github'] as const

const PROVIDERS = {
  google: {
    on: () => Boolean(env.googleClientId && env.googleClientSecret),
    authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
    issuers: ['https://accounts.google.com', 'accounts.google.com'],
    keys: createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs')),
    clientId: () => env.googleClientId,
  },
  apple: {
    on: () => Boolean(env.appleClientId && env.appleTeamId && env.appleKeyId && env.applePrivateKey),
    authorize: 'https://appleid.apple.com/auth/authorize',
    token: 'https://appleid.apple.com/auth/token',
    issuers: ['https://appleid.apple.com'],
    keys: createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys')),
    clientId: () => env.appleClientId,
  },
} as const

/*
 * GitHub, which is not OpenID Connect: a code traded for a token, and two
 * questions asked with it.
 */
const GITHUB = {
  on: () => Boolean(env.githubSigninClientId && env.githubSigninClientSecret),
  authorize: 'https://github.com/login/oauth/authorize',
  token: 'https://github.com/login/oauth/access_token',
  api: 'https://api.github.com',
}

const isOn = (p: string): p is Provider => (p === 'github' ? GITHUB.on() : p === 'google' || p === 'apple' ? PROVIDERS[p].on() : false)

/* Its own key, not `JWT_SECRET` itself — `auth/keys.ts`. */
const secret = keyFor('oauth-state')
/* A state sealed before the split, for the ten minutes it can last. */
async function unsealState(sealed: string): Promise<JWTPayload> {
  try {
    return (await jwtVerify(sealed, secret)).payload
  } catch (e) {
    let exp: number | undefined
    try {
      exp = decodeJwt(sealed).exp
    } catch {
      throw e
    }
    const old = typeof exp === 'number' ? legacyKey(exp * 1000) : null
    if (!old) throw e
    return (await jwtVerify(sealed, old)).payload
  }
}
/* `__Host-`, so no other host under the domain can plant a state of its
   own: a planted one finished somebody else's flow in the victim's browser. */
const COOKIE = '__Host-tuff_oauth'
/* The browser a ticket belongs to. `__Host-`,
   so no other host under the domain can plant one of its own. */
const HANDOFF = '__Host-tuff_handoff'
/* The ticket that adds a way to sign in, carried from Account settings to
   the start. */
export const LINK = '__Host-tuff_link'

/*
 * The same ticket made for an app, which no cookie reaches.
 * Found by the challenge the app sent, and
 * bound to it: whoever reads the challenge in the start's address holds a
 * hash, and the link is made only by the app with the secret, over the
 * session that asked.
 */
export const appLinkKey = (challenge: string) => hashToken(`app-link:${challenge}`)
export const CHALLENGE = /^[\w-]{43}$/
/**
 * The network an address belongs to, for a ceiling: an IPv4 address as it
 * is, an IPv6 one by its first four groups — one subscriber's /64, which
 * hands them every address in it.
 */
export function networkOf(address: string): string {
  const ip = address.replace(/^::ffff:(?=\d+\.)/i, '')
  if (!ip.includes(':')) return ip
  const [head = '', tail = ''] = ip.toLowerCase().split('::')
  const front = head ? head.split(':') : []
  const back = ip.includes('::') ? (tail ? tail.split(':') : []) : []
  const groups = ip.includes('::') ? [...front, ...Array(Math.max(0, 8 - front.length - back.length)).fill('0'), ...back] : front
  return `${groups
    .slice(0, 4)
    .map((g) => g.replace(/^0+(?=.)/, ''))
    .join(':')}::/64`
}

/** A browser's request — every browser sends one of these, an app's own client neither. */
export const fromBrowser = (c: Context) => Boolean(c.req.header('origin') || c.req.header('sec-fetch-site'))

/*
 * What a link ticket is bound to: the provider and the session that asked,
 * and for an app the challenge. Read strictly — a ticket made for the one
 * is never taken by the other's path.
 */
function linkBinding(binding: string | null | undefined): { p: string; sid: string; challenge: string | null } | null {
  const m = /^(google|apple|github):([0-9a-f-]{36})(?::app:([\w-]{43}))?$/.exec(binding ?? '')
  return m ? { p: m[1]!, sid: m[2]!, challenge: m[3] ?? null } : null
}

/* Where this deployment is, for links and redirects: one function, which in
   production reads `APP_URL` and never the request — `publicUrl.ts`. */
export { origin }

const callbackOf = (c: Context, p: Provider) => `${origin(c)}/auth/oauth/${p}/callback`
const b64url = (b: Buffer) => b.toString('base64url')

function readCookie(c: Context, name: string): string | null {
  const raw = c.req.header('cookie') ?? ''
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) return v.join('=')
  }
  return null
}

/** Which providers this deployment can offer — the screens draw only these. */
/**
 * The same, written into every page the server sends — `providersMeta` —
 * so the sign-in screen draws its buttons with the page rather than a
 * request later, under the fields it had already drawn.
 */
export function offeredProviders(): string[] {
  return ALL.filter(isOn)
}

/**
 * The providers to draw now: none on your own server until somebody owns
 * it (`serverClaimed`), and an error asking is taken as not yet. On the
 * service, every one with keys.
 */
export async function providersNow(): Promise<Provider[]> {
  return (await serverClaimed().catch(() => false)) ? ALL.filter(isOn) : []
}

/* And whether somebody without an invitation may sign up — false only on
   your own server with sign-up closed. */
access.get('/providers', async (c) => {
  const on = await providersNow()
  return c.json({
    google: on.includes('google'),
    apple: on.includes('apple'),
    github: on.includes('github'),
    mail: await mailOn(),
    /* Your own server with no mail: the screens say so instead of promising
       a letter. False on the service. */
    no_mail: edition.instance && !(await mailOn()),
    sign_up: await signUpOpen(),
  })
})

/*
 * Off to the provider, with a state and a nonce bound to a short cookie —
 * so a callback this browser did not start is refused — and, for Google,
 * PKCE. The cookie is `SameSite=None` because Apple answers with a POST
 * from its own site, which a Lax cookie would not ride on.
 */
access.get('/oauth/:provider/start', async (c) => {
  const p = c.req.param('provider')
  if (!isOn(p)) return c.redirect('/signin?oauth=off')
  const state = b64url(randomBytes(16))
  const nonce = b64url(randomBytes(16))
  const verifier = b64url(randomBytes(32))
  /* Following an invitation: carried there and back in the same sealed
     cookie, and taken on the way back — so somebody new joins the
     workspace they were asked into rather than one made for them, and
     somebody known joins it without a password. */
  const asked = c.req.query('invite') ?? ''
  const invite = asked.length <= 200 && /^[\w.~-]+$/.test(asked) ? asked : undefined
  /* Where the ticket will be good: an app that
     sent its secret's SHA-256, or else this browser. An app's sheet
     arrives with `Sec-Fetch-Site: none`, which no page can write; a
     challenge from anywhere else is a page's link, and the ticket stays
     this browser's. A sheet with no challenge is this browser's too: the
     apps have sent one since 8 November, and a ticket bound to nothing was
     one an App Link could hand an app — somebody's own, signing the
     victim's phone in as them. */
  const challenge = c.req.query('app_challenge')
  if (challenge !== undefined && !/^[\w-]{43}$/.test(challenge)) return c.redirect('/signin?oauth=failed')
  const sheet = c.req.header('sec-fetch-site') === 'none'
  const bind = sheet && challenge ? `app:${challenge}` : 'web'
  /* Adding a way to sign in rather than signing in: the ticket only from
     the cookie Account settings left, sealed into the state this browser
     carries. */
  let link: string | undefined
  let linkApp = false
  let startMark: string | undefined
  if (c.req.query('link') === 'app') {
    /* From an app's sheet only, with the challenge its ticket was made
       for. From a page's link it is
       nothing: a page walking somebody's browser through a start made
       with the sender's challenge would leave the victim's provider
       account waiting for the sender to finish. */
    if (!sheet || !challenge) return c.redirect('/signin?ways=failed')
    const key = appLinkKey(challenge)
    const [t] = await withoutActor((tx) => tx<{ binding: string | null }[]>`select auth_ticket_binding(${key}, 'link') as binding`)
    const b = linkBinding(t?.binding)
    if (!b || b.p !== p || b.challenge !== challenge) return c.redirect('/signin?ways=failed')
    /* Once: the challenge is in this address, and an address is kept in
       logs and histories. The app's own sheet opens it the moment the
       ticket is made, so somebody racing it makes the real one fail where
       the person sees it, never succeed behind their back. */
    const mark = b64url(randomBytes(16))
    const [won] = await withoutActor((tx) => tx<{ ok: boolean }[]>`select auth_ticket_start(${key}, 'link', ${mark}) as ok`)
    startMark = mark
    if (!won?.ok) return c.redirect('/signin?ways=failed')
    link = key
    linkApp = true
  } else if (c.req.query('link')) {
    const ticket = readCookie(c, LINK)
    const [t] = ticket
      ? await withoutActor((tx) => tx<{ binding: string | null }[]>`select auth_ticket_binding(${hashToken(ticket)}, 'link') as binding`)
      : []
    /* Made for this provider, and for the web: only the hash goes on, as
       the state is signed, not sealed, and the ticket itself would be a
       way to start again in another browser. An app's ticket is never
       taken from a cookie, whatever the cookie says. */
    const b = linkBinding(t?.binding)
    if (!ticket || !b || b.p !== p || b.challenge) return c.redirect('/')
    link = hashToken(ticket)
    c.header('set-cookie', `${LINK}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`, { append: true })
  } else if (sheet && challenge) {
    /* An app's sign-in starts once per challenge.
       Replayed by whoever read the address, it would end in a ticket for
       their provider account that the app's secret trades, and an app that
       took it from a link rather than its sheet would sign its person in
       as somebody else. The apps make a fresh secret every time.
       Each writes a row, so one address gets a ceiling of its own, counted
       only here — what is refused before writes nothing — and an IPv6
       address by its /64, which is what one network is given. */
    const from = clientOf(c)
    if (!onThisMachine(from) && !(await spendOn(`appstart:${networkOf(from)}`, 120, 600))) {
      return c.redirect('/signin?oauth=failed')
    }
    const [once] = await withoutActor((tx) => tx<{ ok: boolean }[]>`select auth_app_start_once(${challenge}) as ok`)
    if (!once?.ok) return c.redirect('/signin?oauth=failed')
  }
  const sealed = await new SignJWT({
    state,
    nonce,
    verifier,
    p,
    bind,
    ...(invite ? { invite } : {}),
    ...(link ? { link } : {}),
    ...(linkApp ? { linkApp, startMark } : {}),
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('10m')
    .sign(secret)
  c.header('set-cookie', `${COOKIE}=${sealed}; Path=/; Max-Age=600; HttpOnly; Secure; SameSite=None`, { append: true })
  /* Only who somebody is and their addresses; the account picker, so a
     browser signed in to the wrong GitHub can choose. */
  if (p === 'github') {
    const q = new URLSearchParams({
      client_id: env.githubSigninClientId,
      redirect_uri: callbackOf(c, p),
      scope: 'user:email',
      state,
      code_challenge: b64url(createHash('sha256').update(verifier).digest()),
      code_challenge_method: 'S256',
      prompt: 'select_account',
    })
    return c.redirect(`${GITHUB.authorize}?${q}`)
  }
  const conf = PROVIDERS[p]
  const q = new URLSearchParams({
    client_id: conf.clientId(),
    redirect_uri: callbackOf(c, p),
    response_type: 'code',
    state,
    nonce,
  })
  if (p === 'google') {
    q.set('scope', 'openid email profile')
    q.set('code_challenge', b64url(createHash('sha256').update(verifier).digest()))
    q.set('code_challenge_method', 'S256')
    q.set('prompt', 'select_account')
  } else {
    q.set('scope', 'name email')
    q.set('response_mode', 'form_post')
  }
  return c.redirect(`${conf.authorize}?${q}`)
})

/** Apple's client secret is a short JWT signed with the team's key. */
async function appleSecret(): Promise<string> {
  const key = await importPKCS8(env.applePrivateKey, 'ES256')
  return new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: env.appleKeyId })
    .setIssuer(env.appleTeamId)
    .setSubject(env.appleClientId)
    .setAudience('https://appleid.apple.com')
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(key)
}

/** Who the provider says this is, once its answer has been checked. */
type Said = { subject: string; email: string; verified: boolean; name: string; owns: boolean }

async function callback(c: Context, p: Provider, params: { code?: string; state?: string; user?: string }) {
  const fail = (why: string) => {
    c.header('set-cookie', `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=None`)
    return c.redirect(`/signin?oauth=${why}`)
  }
  if (!isOn(p) || !params.code || !params.state) return fail('failed')

  let bound: {
    state: string
    nonce: string
    verifier: string
    p: string
    bind?: string
    invite?: string
    link?: string
    linkApp?: boolean
    startMark?: string
  }
  try {
    const sealed = readCookie(c, COOKIE) ?? ''
    bound = (await unsealState(sealed)) as unknown as typeof bound
  } catch {
    return fail('expired')
  }
  if (bound.state !== params.state || bound.p !== p) return fail('failed')
  if (bound.link) return linked(c, p, params, bound, bound.link, bound.linkApp === true)
  /* From here on, a sign-in that went wrong on the way to an invitation
     goes back to the invitation, which says what happened there. */
  const invite = bound.invite
  const back = (why: string | null) => {
    if (!invite) return fail(why ?? 'failed')
    c.header('set-cookie', `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=None`)
    return c.redirect(`/invite/${encodeURIComponent(invite)}${why ? `?oauth=${why}` : ''}`)
  }

  const said = p === 'github' ? await fromGithub(c, params.code, bound.verifier) : await fromOidc(c, p, params, bound)
  if (!said) return back('failed')
  const { subject, email, verified, name, owns } = said

  let who: Awaited<ReturnType<typeof joinByProvider>> | Awaited<ReturnType<typeof whoIs>>
  try {
    who = invite
      ? await joinByProvider(p, invite, subject, email, verified, name, owns)
      : await whoIs(p, subject, email, verified, name, owns)
  } catch (e) {
    /* A new account on your own server with sign-up closed. */
    if (isClosed(e)) return back('closed')
    throw e
  }
  /* GitHub never links by address, so an address with an account here is
     told the way to link it, not that the provider did not confirm it. */
  if (who === 'conflict') return back(p === 'github' ? 'github' : 'conflict')
  if (who === 'gone') return back(null)
  if (who === 'full') return back('full')
  if (who === 'elsewhere') return back('elsewhere')
  if (!who) return back(p === 'github' && !verified ? 'noemail' : 'failed')

  const ticket = generateToken('hof')
  let binding: string
  if (bound.bind?.startsWith('app:')) binding = bound.bind
  else {
    const browser = generateToken('hob')
    binding = `web:${hashToken(browser)}`
    c.header('set-cookie', `${HANDOFF}=${browser}; Path=/; Max-Age=120; HttpOnly; Secure; SameSite=Lax`, { append: true })
  }
  await withoutActor(
    (tx) =>
      tx`select auth_ticket_make_bound(${hashToken(ticket)}, 'handoff', ${who.actorId}, ${who.workspaceId}, interval '2 minutes', ${binding})`,
  )
  c.header('set-cookie', `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=None`, { append: true })
  /* An invitation waiting for the second factor goes back with the ticket,
     as it came: the link the person followed. */
  const waiting = invite && !who.workspaceId ? `&invite=${encodeURIComponent(invite)}` : ''
  return c.redirect(`/signin?handoff=${encodeURIComponent(ticket)}${waiting}`)
}

/**
 * A provider's account added to the account that asked in Account settings
 * — rather than anybody signed in. Whatever its
 * address: the person proved who they are before going. Never one that
 * signs somebody else in, nor a GitHub connected to somebody else.
 *
 * Asked from an app, nothing is linked here: this runs in the app's sheet,
 * or in whatever browser the start's address was opened in, so what the
 * provider said is left waiting for the app to finish with its secret,
 * over the session that asked.
 */
async function linked(
  c: Context,
  p: Provider,
  params: { code?: string; state?: string; user?: string },
  bound: { nonce: string; verifier: string; startMark?: string },
  hash: string,
  app: boolean,
) {
  c.header('set-cookie', `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=None`)
  const [t] = await withoutActor(
    (tx) => tx<{ actor_id: string; workspace_id: string | null; binding: string | null }[]>`
      select k.*, auth_ticket_binding(${hash}, 'link') as binding from auth_ticket_peek(${hash}, 'link') k`,
  )
  if (!t) return c.redirect(app ? '/signin?ways=failed' : '/')
  const [w] =
    !app && t.workspace_id
      ? await withoutActor((tx) => tx<{ slug: string | null }[]>`select auth_workspace_slug(${t.workspace_id}) as slug`)
      : []
  const back = (why: 'added' | 'taken' | 'failed') =>
    c.redirect(app ? '/signin?ways=failed' : w?.slug ? `/${w.slug}/account?ways=${why}` : '/')

  /* Still the session that asked: a password reset or signing out
     everywhere since then ends it, and the way in it was adding with it.
     And made for the path it came by — a web ticket never finishes as an
     app's, nor the other way round. */
  const b = linkBinding(t.binding)
  if (!b || b.p !== p || Boolean(b.challenge) !== app) return back('failed')
  const [alive] = await withoutActor((tx) => tx<{ ok: boolean }[]>`select auth_session_alive(${b.sid}) as ok`)
  if (!alive?.ok) return back('failed')

  const said = p === 'github' ? await fromGithub(c, params.code ?? '', bound.verifier) : await fromOidc(c, p, params, bound)
  if (!said) return back('failed')

  if (app) {
    /* From the one start this ticket allowed, and no other. */
    const [s] = await withoutActor((tx) => tx<{ started: string | null }[]>`select auth_ticket_started(${hash}, 'link') as started`)
    if (!bound.startMark || s?.started !== bound.startMark) return back('failed')
    /* Who the provider named, for this link ticket and this start, once
       and briefly. The link ticket is spent when the app finishes. */
    const waiting = generateToken('lkd')
    const what = JSON.stringify({ link: hash, start: bound.startMark, p, subject: said.subject, email: said.email || null })
    await withoutActor(
      (tx) =>
        tx`select auth_ticket_make_bound(${hashToken(waiting)}, 'linked', ${t.actor_id}, ${t.workspace_id}, interval '2 minutes', ${what})`,
    )
    return c.redirect(`/signin?linked=${encodeURIComponent(waiting)}`)
  }

  const [spent] = await withoutActor((tx) => tx<{ ok: boolean }[]>`select auth_ticket_spend(${hash}, 'link') as ok`)
  if (!spent?.ok) return back('failed')
  return back(await attachWay(c, t.actor_id, p, said))
}

/**
 * The link itself, once everything before it has been checked: never a
 * provider account that signs somebody else in, nor a GitHub connected to
 * somebody else; the address told when it is new.
 */
async function attachWay(
  c: Context,
  actorId: string,
  p: Provider,
  said: { subject: string; email: string | null },
): Promise<'added' | 'taken' | 'failed'> {
  /* Never for an address nobody has proved — refused where it starts too. */
  if (!(await confirmed(actorId))) return 'failed'
  const [known] = await withoutActor((tx) => tx<{ actor: string | null }[]>`select auth_identity_actor(${p}, ${said.subject}) as actor`)
  if (known?.actor && known.actor !== actorId) return 'taken'
  if (p === 'github') {
    const [taken] = await withoutActor(
      (tx) => tx<{ taken: boolean }[]>`select github_account_taken(${said.subject}::bigint, ${actorId}) as taken`,
    )
    if (taken?.taken) return 'taken'
  }
  if (!known?.actor) {
    await withoutActor((tx) => tx`select auth_identity_link(${actorId}, ${p}, ${said.subject}, ${said.email || null})`)
    /* Whose it is now: two accounts linking the same one at once, the
       second did nothing and must not be told it did. */
    const [now] = await withoutActor((tx) => tx<{ actor: string | null }[]>`select auth_identity_actor(${p}, ${said.subject}) as actor`)
    if (now?.actor !== actorId) return 'taken'
    await tellWayIn(origin(c), actorId, 'added', p, said.email || null)
  }
  return 'added'
}

const Waiting = z.object({
  link: z.string(),
  start: z.string().min(1),
  p: z.string(),
  subject: z.string().min(1),
  email: z.string().nullable(),
})

/**
 * An app finishing what its sheet started:
 * the `linked` ticket the callback left, the link ticket it came from,
 * both for this provider, this account and the session making this very
 * request, and the secret whose SHA-256 that ticket was made with. A
 * refusal spends nothing, so whoever holds the address cannot cancel the
 * real one; the link ticket is spent once, for the first to bring it all.
 */
export async function finishAppLink(
  c: Context,
  actorId: string,
  sessionId: string,
  p: string,
  waiting: string,
  verifier: string,
): Promise<{ outcome: 'added' | 'taken' | 'failed'; email: string | null } | 'refused'> {
  if (!isOn(p)) return 'refused'
  const key = hashToken(waiting)
  const [r] = await withoutActor(
    (tx) => tx<{ actor_id: string; binding: string | null }[]>`
      select k.actor_id, auth_ticket_binding(${key}, 'linked') as binding from auth_ticket_peek(${key}, 'linked') k`,
  )
  if (!r?.binding || r.actor_id !== actorId) return 'refused'
  let parsed: unknown
  try {
    parsed = JSON.parse(r.binding)
  } catch {
    return 'refused'
  }
  const what = Waiting.safeParse(parsed)
  if (!what.success || what.data.p !== p) return 'refused'
  const link = what.data.link
  const [t] = await withoutActor(
    (tx) => tx<{ actor_id: string; binding: string | null; started: string | null }[]>`
      select k.actor_id, auth_ticket_binding(${link}, 'link') as binding, auth_ticket_started(${link}, 'link') as started
      from auth_ticket_peek(${link}, 'link') k`,
  )
  const b = linkBinding(t?.binding)
  if (!t || t.actor_id !== actorId || !b || b.p !== p || !b.challenge || b.sid !== sessionId) return 'refused'
  /* From the one start the ticket allowed. */
  if (t.started !== what.data.start) return 'refused'
  const brought = Buffer.from(b64url(createHash('sha256').update(verifier).digest()))
  const made = Buffer.from(b.challenge)
  if (brought.length !== made.length || !timingSafeEqual(brought, made)) return 'refused'
  const [alive] = await withoutActor((tx) => tx<{ ok: boolean }[]>`select auth_session_alive(${b.sid}) as ok`)
  if (!alive?.ok) return 'refused'
  const [spent] = await withoutActor((tx) => tx<{ ok: boolean }[]>`select auth_ticket_spend(${link}, 'link') as ok`)
  if (!spent?.ok) return 'refused'
  await withoutActor((tx) => tx`select auth_ticket_spend(${key}, 'linked')`)
  const outcome = await attachWay(c, actorId, p, { subject: what.data.subject, email: what.data.email })
  return { outcome, email: what.data.email }
}

/** Google's and Apple's answer: an ID token, checked against their keys. */
async function fromOidc(
  c: Context,
  p: 'google' | 'apple',
  params: { code?: string; user?: string },
  bound: { nonce: string; verifier: string },
): Promise<Said | null> {
  const conf = PROVIDERS[p]
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: params.code ?? '',
    redirect_uri: callbackOf(c, p),
    client_id: conf.clientId(),
    client_secret: p === 'google' ? env.googleClientSecret : await appleSecret(),
  })
  if (p === 'google') body.set('code_verifier', bound.verifier)
  const r = await fetch(conf.token, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  }).catch(() => null)
  if (!r?.ok) return null
  const tokens = (await r.json()) as { id_token?: string }
  if (!tokens.id_token) return null

  let claims: JWTPayload & { email?: string; email_verified?: boolean | string; nonce?: string; name?: string; hd?: string }
  try {
    claims = (await jwtVerify(tokens.id_token, conf.keys, { issuer: [...conf.issuers], audience: conf.clientId() })).payload
  } catch {
    return null
  }
  if (claims.nonce !== bound.nonce || !claims.sub) return null

  /* Apple sends a name once, on the first sign-in, beside the token rather
     than in it. */
  let name = typeof claims.name === 'string' ? claims.name : ''
  if (p === 'apple' && params.user) {
    try {
      const u = JSON.parse(params.user) as { name?: { firstName?: string; lastName?: string } }
      name = [u.name?.firstName, u.name?.lastName].filter(Boolean).join(' ')
    } catch {
      // A name is a courtesy; an account is made without one.
    }
  }
  const email = typeof claims.email === 'string' ? claims.email.toLowerCase() : ''
  const verified = claims.email_verified === true || claims.email_verified === 'true'
  /* Whether the provider is the authority for the address, which is what
     handing it an existing account by address needs. Google's own advice:
     `email_verified` on a Google account under somebody else's domain only
     says the address was checked when the Google account was made — it is
     authoritative for gmail.com and for a Workspace account (`hd`). */
  const owns = verified && (p !== 'google' || typeof claims.hd === 'string' || /@(gmail|googlemail)\.com$/.test(email))
  return { subject: claims.sub, email, verified, name, owns }
}

/*
 * GitHub's answer: the code traded with its verifier, then who the token
 * is and which address GitHub has verified as their primary — and the
 * token revoked, since it was wanted for those two questions and nothing
 * after. GitHub is the authority for no address (`owns` is never true):
 * a verified one there says a mailbox was reached once, and a company's
 * mailbox goes to whoever comes next with its GitHub still holding it.
 */
async function fromGithub(c: Context, code: string, verifier: string): Promise<Said | null> {
  /* Only GitHub's two hosts, no redirect followed, ten seconds a question. */
  const ask = (url: string, init: RequestInit) =>
    fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(10_000) }).catch(() => null)
  const r = await ask(GITHUB.token, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.githubSigninClientId,
      client_secret: env.githubSigninClientSecret,
      code,
      redirect_uri: callbackOf(c, 'github'),
      code_verifier: verifier,
    }),
  })
  /* A refused code is a 200 with `error` in it, not a status. */
  const t = r?.ok ? ((await r.json().catch(() => null)) as { access_token?: unknown } | null) : null
  const token = typeof t?.access_token === 'string' ? t.access_token : ''
  if (!token) return null
  const read = async <T>(path: string): Promise<T | null> => {
    const res = await ask(`${GITHUB.api}${path}`, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'user-agent': 'Tuff',
      },
    })
    return res?.ok ? ((await res.json().catch(() => null)) as T | null) : null
  }
  const user = await read<{ id?: unknown; login?: unknown; name?: unknown }>('/user')
  const emails = await read<{ email?: unknown; primary?: unknown; verified?: unknown }[]>('/user/emails')
  void ask(`${GITHUB.api}/applications/${encodeURIComponent(env.githubSigninClientId)}/token`, {
    method: 'DELETE',
    headers: {
      authorization: `Basic ${Buffer.from(`${env.githubSigninClientId}:${env.githubSigninClientSecret}`).toString('base64')}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'Tuff',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ access_token: token }),
  })
  if (!user || typeof user.id !== 'number' || !Number.isSafeInteger(user.id) || user.id <= 0) return null
  /* The primary, verified, and a mailbox somebody reads: GitHub's noreply
     addresses are verified and go nowhere. */
  const primary = Array.isArray(emails)
    ? emails.find(
        (e) =>
          e.primary === true &&
          e.verified === true &&
          typeof e.email === 'string' &&
          e.email.length <= 254 &&
          /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e.email) &&
          !/@users\.noreply\.github\.com$/i.test(e.email),
      )
    : undefined
  const name = (typeof user.name === 'string' && user.name.trim()) || (typeof user.login === 'string' ? user.login : '')
  return {
    subject: String(user.id),
    email: typeof primary?.email === 'string' ? primary.email.toLowerCase() : '',
    verified: Boolean(primary),
    name: name.slice(0, 100),
    owns: false,
  }
}

/**
 * Who a provider's account is here.
 *
 * Somebody seen this way before; else the account with that email, but only
 * when the provider vouches for the email — otherwise a provider account
 * claiming somebody's address would be handed their account; else a new
 * account with a workspace of its own — or, on your own server with
 * sign-up closed, `SignUpClosed` thrown and no account.
 */
export async function whoIs(
  p: Provider,
  subject: string,
  email: string,
  verified: boolean,
  name: string,
  /** The provider is the authority for the address, not only saw it checked once. */
  owns = verified,
): Promise<{ actorId: string; workspaceId: string | null } | 'conflict' | null> {
  const found = await knownActor(p, subject, email, owns)
  if (found === 'conflict') return 'conflict'
  let actorId = found
  if (!actorId) {
    /* A new account is made only on an address the provider vouches for:
       it is made confirmed, so it has to be. */
    if (!email || !verified) return null
    /* Asked first as well, so a server whose database was never told it is
       one of its own refuses rather than lets in. */
    if (!(await signUpOpen())) throw new SignUpClosed()
    const id = uuidv7()
    const workspaceId = uuidv7()
    const who = name.trim() || email.split('@')[0]!
    const wsName = ownWorkspaceName(who)
    /* On your own server with sign-up closed, `register_owner` refuses
       and makes nothing; the callback says so. Somebody new comes in by an
       invitation (`joinByProvider`). On a server nobody has claimed yet a
       provider makes nothing either (migration 207): only a mailed link or
       the machine's `instance:owner` claims one. */
    await orClosed(
      withoutActor(async (tx) => {
        const [s] = await tx<{ slug: string }[]>`select free_workspace_slug(${wsName}) as slug`
        await tx`select register_owner(${id}, ${who}, ${email}, ${null}, ${workspaceId}, ${wsName}, ${s!.slug}, true, true)`
      }),
    )
    await planNewWorkspace(id, workspaceId)
    actorId = id
  }
  await withoutActor((tx) => tx`select auth_identity_link(${actorId}, ${p}, ${subject}, ${email || null})`)
  /* In no workspace: signed in all the same, to the screen for that —
     the exchange decides whether this client can be given it. */
  return { actorId, workspaceId: await firstWorkspace(actorId) }
}

/**
 * The account a provider's answer is, if there is one: somebody seen this
 * way before, else the account with that email — but only when the provider
 * is the authority for the email, or a provider account claiming somebody's
 * address would be handed their account.
 */
async function knownActor(p: Provider, subject: string, email: string, verified: boolean): Promise<string | 'conflict' | null> {
  const known = await withoutActor(async (tx) => {
    const [r] = await tx<{ actor: string | null }[]>`select auth_identity_actor(${p}, ${subject}) as actor`
    return r?.actor ?? null
  })
  if (known) {
    /* A provider sign-in on an account nobody proved — linked before
       the password came after the proof by whoever held a session for that address (migration 212
       took those it found). Not a way in by itself: only when this
       provider vouches for the account's own address, which is a proof and
       goes through `auth_claim_email` like any other. */
    if (await confirmed(known)) return known
    const [acc] = await withoutActor((tx) => tx<{ email: string | null }[]>`select auth_email_of(${known}) as email`)
    if (!verified || !email || acc?.email?.toLowerCase() !== email.toLowerCase()) return 'conflict'
    await orClosed(withoutActor((tx) => tx`select auth_claim_email(${known})`))
    return known
  }
  if (!email) return null
  const existing = await withoutActor(async (tx) => {
    const [r] = await tx<{ actor_id: string }[]>`select actor_id from auth_lookup_user(${email})`
    return r?.actor_id ?? null
  })
  if (!existing) return null
  if (!verified) return 'conflict'
  /* The provider is the first to prove the address is theirs: an account
     nobody confirmed becomes theirs, without the password whoever made it
     chose — `auth_claim_email`. */
  /* On your own server, confirming an address that asked to sign up
     claims the server or is refused (`instance_confirming`). */
  await orClosed(withoutActor((tx) => tx`select auth_claim_email(${existing})`))
  return existing
}

/**
 * Who a provider's account is, on the way back to an invitation.
 *
 * Somebody known joins the invited workspace as themselves. Somebody new is
 * made by the invitation itself, confirmed, as a member of that workspace
 * and nothing else: the workspace of their own that signing up through a
 * provider makes would be an empty second place they never asked for.
 */
export async function joinByProvider(
  p: Provider,
  invite: string,
  subject: string,
  email: string,
  verified: boolean,
  name: string,
  owns = verified,
): Promise<{ actorId: string; workspaceId: string | null } | 'conflict' | 'gone' | 'full' | 'elsewhere' | null> {
  const tokenHash = hashToken(invite)
  const found = await knownActor(p, subject, email, owns)
  if (found === 'conflict') return 'conflict'
  let joined: { actorId: string; workspaceId: string | null }
  if (found && (await hasSecondFactor(found))) {
    /* Not yet: whoever holds the provider's account without the second
       factor would otherwise put the account in the workspace and spend
       the invitation. The ticket carries no workspace, and the exchange
       takes the invitation once the code has been given. */
    joined = { actorId: found, workspaceId: null }
  } else if (found) {
    const took = await takeInvite(tokenHash, found)
    if (took === 'gone' || took === 'full' || took === 'elsewhere') return took
    /* Not reached: a provider that vouched has just confirmed the address
       (`knownActor`). Said as a spent link if it ever is. */
    if (took === 'unconfirmed') return 'gone'
    joined = { actorId: found, workspaceId: took.workspaceId }
  } else {
    if (!email || !verified) return null
    try {
      const [row] = await withoutActor(
        (tx) => tx<{ workspace_id: string; actor_id: string }[]>`
          select * from accept_invite(${tokenHash}::text, ${uuidv7()}::uuid,
                                      ${name.trim() || email.split('@')[0]!}::text, ${email}::citext, null::text,
                                      true)`,
      )
      if (!row) return 'gone'
      joined = { actorId: row.actor_id, workspaceId: row.workspace_id }
      await tellInviter(row.workspace_id, row.actor_id)
    } catch (e) {
      if ((e as { message?: string }).message?.includes('workspace_full')) return 'full'
      /* No account when `knownActor` looked, one now — a sign-up racing this
         callback. Not joined to it here: the provider's word about that
         account goes through `auth_claim_email`, which the next try's
         `knownActor` does. */
      if ((e as { code?: string }).code === '23505' || (e as { message?: string }).message?.includes('account_exists')) return 'conflict'
      /* A link handed over by hand, and the provider's address is not the
         one it names (migration 210). */
      if ((e as { message?: string }).message?.includes('invite_for_another_address')) return 'elsewhere'
      throw e
    }
  }
  await withoutActor((tx) => tx`select auth_identity_link(${joined.actorId}, ${p}, ${subject}, ${email || null})`)
  return joined
}

async function hasSecondFactor(actorId: string): Promise<boolean> {
  const [u] = await withoutActor(
    (tx) => tx<{ on: boolean }[]>`select l.totp_enabled as on from auth_lookup_user(auth_email_of(${actorId})) l`,
  )
  return Boolean(u?.on)
}

access.get('/oauth/google/callback', (c) => callback(c, 'google', { code: c.req.query('code') ?? '', state: c.req.query('state') ?? '' }))
access.get('/oauth/github/callback', (c) => callback(c, 'github', { code: c.req.query('code') ?? '', state: c.req.query('state') ?? '' }))
access.post('/oauth/apple/callback', async (c) => {
  const form = await c.req.parseBody().catch(() => ({}) as Record<string, string>)
  return callback(c, 'apple', {
    code: String(form.code ?? ''),
    state: String(form.state ?? ''),
    user: typeof form.user === 'string' ? form.user : '',
  })
})

/**
 * The page trades the ticket the callback left in its address for a
 * session. An account with a second factor is asked for it first, and the
 * ticket stays good until it is spent or runs out.
 */
access.post('/oauth/exchange', async (c) => {
  const body = z
    .object({
      handoff: z.string().min(10),
      totp: z.string().optional(),
      invite: z.string().min(10).optional(),
      verifier: z.string().min(43).max(128).optional(),
      /* The client can show the screen of a session in no workspace. */
      nowhere: z.boolean().optional(),
    })
    .safeParse(await c.req.json().catch(() => ({})))
  if (!body.success) return c.json({ error: { code: 'invalid' } }, 400)
  const hash = hashToken(body.data.handoff)
  /* Only where the sign-in began — before the second factor, so a ticket
     that is not yours does not learn whether there is one. */
  const proof = await broughtBy(c, hash, body.data.verifier)
  if (proof === 'burn') await withoutActor((tx) => tx`select auth_ticket_spend(${hash}, 'handoff')`)
  if (proof !== 'ok') return c.json({ error: { code: 'unauthorized' } }, 401)
  const [t] = await withoutActor(
    (tx) => tx<{ actor_id: string; workspace_id: string | null }[]>`select * from auth_ticket_peek(${hash}, 'handoff')`,
  )
  if (!t) return c.json({ error: { code: 'unauthorized' } }, 401)

  const [u] = await withoutActor(
    (tx) => tx<{ totp_enabled: boolean; email: string }[]>`
      select l.totp_enabled, auth_email_of(${t.actor_id}) as email
      from auth_lookup_user(auth_email_of(${t.actor_id})) l`,
  )
  if (u?.totp_enabled) {
    if (!body.data.totp) return c.json({ error: { code: 'totp_required' } }, 401)
    /* Wrong codes counted as signing in counts them, on the same keys: the
       ticket lives two minutes, but a code is six digits. */
    const tried = await guess(u.email, c)
    if (!tried.ok) {
      return c.json({ error: { code: 'rate_limited', message: 'Too many attempts. Try again in a few minutes.' } }, 429)
    }
    if (!(await secondFactor(t.actor_id, u.email, body.data.totp))) {
      return c.json({ error: { code: 'totp_required', message: 'That code didn’t match. Try again.' } }, 401)
    }
    await tried.right()
  }
  const [spent] = await withoutActor((tx) => tx<{ ok: boolean }[]>`select auth_ticket_spend(${hash}, 'handoff') as ok`)
  if (!spent?.ok) return c.json({ error: { code: 'unauthorized' } }, 401)
  /* The invitation that waited for the code, taken now. */
  let workspaceId = t.workspace_id
  if (!workspaceId && body.data.invite) {
    const took = await takeInvite(hashToken(body.data.invite), t.actor_id)
    if (took === 'full') return c.json(fullRefusal('invited'), 413)
    if (took === 'elsewhere')
      return c.json({ error: { code: 'wrong_email', message: 'This invitation is for a different email address.' } }, 403)
    if (took === 'gone' || took === 'unconfirmed') {
      return c.json({ error: { code: 'not_found', message: 'This invitation is no longer valid.' } }, 404)
    }
    workspaceId = took.workspaceId
  }
  if (!workspaceId) {
    /* Signed in, past the second factor, and in no workspace. */
    c.header('set-cookie', `${HANDOFF}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`, { append: true })
    if (body.data.nowhere) return c.json(await startNowhereSession(t.actor_id, metaOf(c)))
    return c.json(NO_WORKSPACE_YET, 403)
  }
  c.header('set-cookie', `${HANDOFF}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`, { append: true })
  return c.json(await startSession(t.actor_id, workspaceId, metaOf(c), 'provider'))
})

/**
 * Whether this request is where the ticket's sign-in began: the browser
 * with its cookie, or the app with the secret it sent the SHA-256 of.
 *
 * A browser never trades an app's ticket: only an app's own client, which
 * sends neither `Origin` nor `Sec-Fetch-Site`, may. A browser that
 * brings one is a page that was handed it — somebody's own, sent to sign
 * a victim into it, or the victim's, from a start somebody else built —
 * and the ticket is spent so it is good to nobody.
 */
async function broughtBy(c: Context, hash: string, verifier: string | undefined): Promise<'ok' | 'refuse' | 'burn'> {
  const [row] = await withoutActor((tx) => tx<{ binding: string | null }[]>`select auth_ticket_binding(${hash}, 'handoff') as binding`)
  const binding = row?.binding
  const browser = Boolean(c.req.header('origin') || c.req.header('sec-fetch-site'))
  /* None is made bound to nothing any more; one from before is no
     request's to trade, and a page that brings one is spent. */
  if (binding == null) return browser ? 'burn' : 'refuse'
  let brought: string | null = null
  if (binding.startsWith('app:')) {
    if (browser) return 'burn'
    if (verifier) brought = `app:${b64url(createHash('sha256').update(verifier).digest())}`
  }
  if (binding.startsWith('web:')) {
    const cookie = readCookie(c, HANDOFF)
    if (cookie) brought = `web:${hashToken(cookie)}`
  }
  if (!brought || brought.length !== binding.length) return 'refuse'
  return timingSafeEqual(Buffer.from(brought), Buffer.from(binding)) ? 'ok' : 'refuse'
}

/*
 * The browser that signed up, named by a cookie.
 * The confirmation link signs in only that browser: followed anywhere else
 * it confirms the address and asks for the password, so a link of one's
 * own sent to somebody else does not swap their session for one's account.
 */
const BIND = 'tuff_bind'

export async function bindBrowser(c: Context, actorId: string): Promise<void> {
  const token = generateToken('bnd')
  await withoutActor((tx) => tx`select auth_ticket_make(${hashToken(token)}, 'bind', ${actorId}, ${null}, interval '1 day')`)
  /* Without `Secure` only on a computer trying Tuff over plain http — `tryLocalhost.ts`. */
  c.header('set-cookie', `${BIND}=${token}; Path=/auth; Max-Age=86400; HttpOnly${secureAttr()}; SameSite=Lax`, { append: true })
}

async function boundTo(c: Context): Promise<string | null> {
  const token = readCookie(c, BIND)
  if (!token) return null
  const [b] = await withoutActor((tx) => tx<{ actor_id: string }[]>`select actor_id from auth_ticket_peek(${hashToken(token)}, 'bind')`)
  return b?.actor_id ?? null
}

/**
 * Somebody signed up with an address that already has an account. The
 * screen said what it says to everybody; the address's own inbox is told
 * the truth.
 *
 * A confirmed account is told how to get in. One nobody has confirmed gets
 * a link that confirms it and sets its password in one step: whoever chose
 * the password it has may not be whoever reads this inbox, and a plain
 * confirmation would let the one who typed the address in.
 */
export async function sendAlreadyHere(c: Context, actorId: string, email: string): Promise<void> {
  /* Three an hour to one address: signing up again and again with
     somebody's address was a way to fill their inbox from ours. */
  if (!(await spendOn(`mail:already:${actorId}`, 3, 3600))) return
  const language = await languageFor(actorId, heard(c))
  if (await confirmed(actorId)) {
    const w = say(
      {
        subject: ['You already have a Tuff account', 'Vous avez déjà un compte Tuff'],
        what: [
          'Someone tried to sign up for Tuff with this email address, but it already has an account.',
          'Quelqu’un a essayé de s’inscrire à Tuff avec cette adresse e-mail, mais un compte existe déjà.',
        ],
        how: [
          `Sign in with this address. If you’ve forgotten your password, set a new one at ${origin(c)}/forgot.`,
          `Connectez-vous avec cette adresse. Si vous avez oublié votre mot de passe, choisissez-en un nouveau sur ${origin(c)}/forgot.`,
        ],
        then: [
          'If this wasn’t you, nothing has changed and you don’t need to do anything.',
          'Si ce n’était pas vous, rien n’a changé et vous n’avez rien à faire.',
        ],
        signIn: ['Sign in', 'Se connecter'],
      },
      language,
    )
    await send({
      to: email,
      subject: w.subject,
      ...letter([w.what, w.how, w.then], { label: w.signIn, url: `${origin(c)}/signin` }, language),
    })
    return
  }
  await sendChoosePassword(c, actorId, email, language)
}

/**
 * The letter that confirms an address and sets its password in one step —
 * the only letter an address nobody has proved is sent: a sign-up, a
 * second sign-up with the same address (`sendAlreadyHere`), signing in
 * with a password from before the password came after the proof, and an account a link with no
 * address made.
 *
 * A reset ticket, good for a day as the confirmation link was, so the
 * apps' own "Set a new password" screen takes it as it is. Its token
 * starts `chs_`, which tells the web's screen to say "Choose a password";
 * the server treats it as any reset. At most five reset links an hour.
 */
export async function sendChoosePassword(
  c: Context,
  actorId: string,
  email: string,
  language?: Awaited<ReturnType<typeof languageFor>>,
): Promise<void> {
  language ??= await languageFor(actorId, heard(c))
  const [n] = await withoutActor((tx) => tx<{ n: number }[]>`select auth_ticket_recent(${actorId}, 'reset') as n`)
  if ((n?.n ?? 0) >= 5) return
  const token = await chooseTicket(actorId)
  const w = say(
    {
      subject: ['Confirm your email for Tuff', 'Confirmez votre adresse e-mail pour Tuff'],
      what: [
        'Welcome to Tuff. Confirm your email and choose a password to finish signing up.',
        'Bienvenue sur Tuff. Confirmez votre adresse e-mail et choisissez un mot de passe pour terminer votre inscription.',
      ],
      then: [
        'The link expires in 24 hours. If you didn’t sign up for Tuff, ignore this email. Nothing happens until the link is used.',
        'Le lien expire dans 24 heures. Si vous ne vous êtes pas inscrit à Tuff, ignorez cet e-mail. Rien ne se passe tant que le lien n’est pas utilisé.',
      ],
      confirm: ['Choose a password', 'Choisir un mot de passe'],
    },
    language,
  )
  await send({
    to: email,
    subject: w.subject,
    ...letter([w.what, w.then], { label: w.confirm, url: `${origin(c)}/reset/${encodeURIComponent(token)}` }, language),
  })
}

/** A reset ticket of a day for choosing a first password — `chs_`, see above. */
async function chooseTicket(actorId: string): Promise<string> {
  const token = generateToken('chs')
  await withoutActor((tx) => tx`select auth_ticket_make(${hashToken(token)}, 'reset', ${actorId}, ${null}, interval '1 day')`)
  return token
}

/**
 * A confirmation link from before the password came after the proof, followed — a letter still in
 * somebody's inbox. It confirms the address, and the password the account
 * held goes with it, in the database (`app_user_proved`, migration 212):
 * whoever chose it may not be whoever reads this inbox. The link proved
 * the inbox, so whoever followed it chooses the password now, with a ticket
 * the answer carries, and gets no session until they have.
 */
access.post('/verify', async (c) => {
  const body = z.object({ token: z.string().min(10) }).safeParse(await c.req.json().catch(() => ({})))
  if (!body.success) return c.json({ error: { code: 'invalid' } }, 400)
  /* A link from a change of address comes back here too: following one
     confirms something by its address, and the ticket says which. No
     session either way. */
  /* Whether the account was unproved before: a change of address proves
     the new one, and that confirmation takes a password set before it
     (migration 212) — so the new address is sent the letter that chooses
     one, or the person is left with no way in. */
  const [before] = await withoutActor(
    (tx) => tx<{ actor_id: string; proved: boolean | null }[]>`
      select actor_id, auth_email_confirmed(actor_id) as proved from auth_email_ticket_peek(${hashToken(body.data.token)})`,
  )
  const moved = await follow(origin(c), body.data.token, heard(c))
  if (moved?.kind === 'taken') {
    return c.json({ error: { code: 'conflict', message: 'That email address already has an account.' } }, 409)
  }
  if (moved?.kind === 'changed' && before && before.proved === false) {
    await sendChoosePassword(c, before.actor_id, moved.email)
  }
  if (moved) {
    return c.json(moved.kind === 'approved' ? { approved: true, email: moved.email } : { changed: true, email: moved.email })
  }
  const hash = hashToken(body.data.token)
  const [t] = await withoutActor((tx) => tx<{ actor_id: string }[]>`select * from auth_ticket_peek(${hash}, 'verify')`)
  if (!t) return c.json({ error: { code: 'gone', message: 'This link has already been used or has expired.' } }, 410)
  const [spent] = await withoutActor((tx) => tx<{ ok: boolean }[]>`select auth_ticket_spend(${hash}, 'verify') as ok`)
  if (!spent?.ok) return c.json({ error: { code: 'gone' } }, 410)
  /* On your own server, confirming an applicant claims it or is refused
     (`instance_confirming`): `sign_up_closed`, said by the error handler. */
  await withoutActor((tx) => tx`select auth_confirm_email(${t.actor_id})`)
  const [pw] = await withoutActor((tx) => tx<{ none: boolean }[]>`select auth_password_hash(${t.actor_id}) is null as none`)
  if (pw?.none) return c.json({ confirmed: true, choose_password: await chooseTicket(t.actor_id) })
  /* Confirmed before, by another way, with a password chosen since. */
  return c.json({ confirmed: true })
})

/*
 * A forgotten password. The answer is the same whether or not there is an
 * account, and the link is good for an hour, once.
 */
access.post('/password/forgot', async (c) => {
  const body = z.object({ email: z.email() }).safeParse(await c.req.json().catch(() => ({})))
  if (!body.success) return c.json({ error: { code: 'invalid' } }, 400)
  const email = body.data.email.toLowerCase()
  const [u] = await withoutActor((tx) => tx<{ actor_id: string }[]>`select actor_id from auth_lookup_user(${email})`)
  if (u) {
    const [n] = await withoutActor((tx) => tx<{ n: number }[]>`select auth_ticket_recent(${u.actor_id}, 'reset') as n`)
    if ((n?.n ?? 0) < 5) {
      const token = generateToken('rst')
      await withoutActor((tx) => tx`select auth_ticket_make(${hashToken(token)}, 'reset', ${u.actor_id}, ${null}, interval '1 hour')`)
      const url = `${origin(c)}/reset/${encodeURIComponent(token)}`
      /* Sent, not waited for: waiting on the mail service only when there
         is an account made the answer slower for addresses that have one,
         which is the very thing the same answer for every address hides.
         The language is asked first all the same — one more query of our
         own, not a wait on somebody else's service. */
      const language = await languageFor(u.actor_id, heard(c))
      const w = say(
        {
          subject: ['Set a new password for Tuff', 'Choisissez un nouveau mot de passe pour Tuff'],
          what: [
            'Someone asked to set a new password for your Tuff account.',
            'Quelqu’un a demandé à changer le mot de passe de votre compte Tuff.',
          ],
          then: [
            'The link expires in 1 hour and can only be used once. If this wasn’t you, ignore this email and nothing will change.',
            'Le lien expire dans 1 heure et ne peut servir qu’une fois. Si ce n’était pas vous, ignorez cet e-mail et rien ne changera.',
          ],
          set: ['Set a new password', 'Choisir un nouveau mot de passe'],
        },
        language,
      )
      void send({ to: email, subject: w.subject, ...letter([w.what, w.then], { label: w.set, url }, language) })
    }
  }
  return c.json({ ok: true })
})

/**
 * The link's token and the new password; every session is signed out.
 *
 * For an address nobody had proved — the sign-up letter, or any reset that
 * an unconfirmed account follows — setting it is the proof, and in the
 * browser that signed up it signs in, into the account's first workspace,
 * as following the confirmation link used to.
 * Anywhere else the answer is `{ ok: true }` and the screen says to sign
 * in: a link that signed in whoever opened it would let somebody hand
 * their own account to a person already signed in.
 */
access.post('/password/reset', async (c) => {
  const body = z.object({ token: z.string().min(10), password: z.string().min(12) }).safeParse(await c.req.json().catch(() => ({})))
  if (!body.success) return c.json({ error: { code: 'invalid' } }, 400)
  const hash = hashToken(body.data.token)
  const [t] = await withoutActor((tx) => tx<{ actor_id: string }[]>`select * from auth_ticket_peek(${hash}, 'reset')`)
  if (!t) return c.json({ error: { code: 'gone', message: 'This link has already been used or has expired.' } }, 410)
  const [spent] = await withoutActor((tx) => tx<{ ok: boolean }[]>`select auth_ticket_spend(${hash}, 'reset') as ok`)
  if (!spent?.ok) return c.json({ error: { code: 'gone' } }, 410)
  const passwordHash = await hashPassword(body.data.password)
  const [was] = await withoutActor(
    (tx) => tx<{ email: string; had: boolean; proved: boolean }[]>`
      select auth_email_of(${t.actor_id}) as email, auth_password_hash(${t.actor_id}) is not null as had,
             coalesce(auth_email_confirmed(${t.actor_id}), false) as proved`,
  )
  /* Asked before the password is set: setting it for an address nobody
     proved spends every open ticket, the browser's among them. */
  const here = !was?.proved && (await boundTo(c)) === t.actor_id
  await withoutActor((tx) => tx`select auth_set_password(${t.actor_id}, ${passwordHash})`)
  /* And every Google or Apple sign-in: a reset shuts the doors somebody
     thinks are open, and those were open beside the password. A provider
     that vouches for the address links again on the next sign-in. */
  await withoutActor((tx) => tx`select auth_identity_forget(${t.actor_id}, ${null})`)
  /* The first password, chosen from the letter: the proof and the sign-in. */
  if (was && !was.proved) {
    const workspaceId = here ? await firstWorkspace(t.actor_id) : null
    if (workspaceId) return c.json({ ok: true, ...(await startSession(t.actor_id, workspaceId, metaOf(c), 'email_link')) })
    return c.json({ ok: true })
  }
  /* Said to the address, as a change from Account is: a reset is the way
     somebody who has the inbox, or an old link, would take an account, and
     the owner should hear of it somewhere other than the screen they were
     just shut out of. Not waited for. Not for the first password of an
     address just proved: whoever reads the inbox is who chose it. */
  if (was?.email) {
    const language = await languageFor(t.actor_id, heard(c))
    const support = edition.vendor?.support ?? null
    const w = say(
      {
        subject: ['Your Tuff password was reset', 'Le mot de passe de votre compte Tuff a été réinitialisé'],
        reset: [
          'The password for your Tuff account was just reset. Every device was signed out, and tokens for connected tools were revoked.',
          'Le mot de passe de votre compte Tuff vient d’être réinitialisé. Tous les appareils ont été déconnectés, et les jetons des outils connectés ont été révoqués.',
        ],
        set: [
          'A password was just set for your Tuff account. Every device was signed out.',
          'Un mot de passe vient d’être défini pour votre compte Tuff. Tous les appareils ont été déconnectés.',
        ],
        /* The service's own address, or on your own server its owner — `edition.vendor`. */
        then: support
          ? [
              `If this wasn’t you, reset your password again and email ${support}.`,
              `Si ce n’était pas vous, réinitialisez de nouveau votre mot de passe et écrivez à ${support}.`,
            ]
          : [
              'If this wasn’t you, reset your password again and tell the owner of this server.',
              'Si ce n’était pas vous, réinitialisez de nouveau votre mot de passe et prévenez le propriétaire de ce serveur.',
            ],
        again: ['Reset password', 'Réinitialiser le mot de passe'],
      },
      language,
    )
    void send({
      to: was.email,
      subject: w.subject,
      ...letter([was.had ? w.reset : w.set, w.then], { label: w.again, url: `${origin(c)}/forgot` }, language),
    })
  }
  return c.json({ ok: true })
})
