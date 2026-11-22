import { z } from 'zod'
import { authUrlFrom } from './db/authUrl.js'
function required(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`${name} is not set — see .env.example`)
  return v
}

/* A key at rest, or empty for none. Refused at start when it is too short
   to be one: a key somebody typed by hand is a password, and a password
   guarded every credential this server keeps. */
function atRestKey(name: string): string {
  const v = (process.env[name] ?? '').trim()
  if (v && v.length < 32) throw new Error(`${name} is too short: use at least 32 random characters (openssl rand -hex 32).`)
  return v
}

/*
 * Mail through SMTP, for a server of one's own.
 * Read once, at start, and refused there rather than at the first
 * letter: a server that cannot send says so before anybody signs up.
 *
 * Every message here is careful never to repeat the URL, which holds the
 * password. The scheme is safe to echo; nothing after `//` is.
 */
export type MailSender = { name: string; address: string }
export type Smtp = { url: string; from: MailSender }

/** A plain address — nothing a header parser could take for two, or for a name. */
export const PLAIN_ADDRESS = /^[^\s\u0000-\u001f\u007f@<>"(),;:\\[\]]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/

/**
 * `MAIL_FROM` as a name and an address: `Tuff <hello@example.com>`,
 * `"Tuff" <hello@example.com>` or `hello@example.com`. Null for anything
 * else — a line break, a second address, quotes inside the name.
 */
export function readMailFrom(raw: string): MailSender | null {
  const v = raw.trim()
  const named = /^(?:"([^"]*)"|([^"<>]*?))\s*<([^<>]+)>$/.exec(v)
  const name = (named ? (named[1] ?? named[2] ?? '') : '').trim()
  const address = (named ? named[3]! : v).trim()
  if (/[\u0000-\u001f\u007f\u2028\u2029"\\<>]/.test(name)) return null
  if (!PLAIN_ADDRESS.test(address)) return null
  return { name, address }
}

/**
 * `SMTP_URL` and `MAIL_FROM` together, or null when there is no SMTP_URL.
 * Throws, at start, for a URL that is not `smtp:` or `smtps:`, one that
 * carries options (`?…`, which nodemailer would read — `?sendmail=true`
 * among them), and for a missing or unreadable `MAIL_FROM`: the service's
 * own address is not one somebody else's SMTP server may send as.
 */
export function readSmtp(rawUrl: string | undefined, rawFrom: string | undefined): Smtp | null {
  const url = (rawUrl ?? '').trim()
  if (!url) return null
  const shape =
    'Write it as smtps://user:password@smtp.example.com:465, or smtp://user:password@smtp.example.com:587 for STARTTLS — see .env.example'
  let u: URL
  try {
    u = new URL(url)
  } catch {
    throw new Error(`SMTP_URL is not a URL. ${shape}`)
  }
  if (u.protocol !== 'smtp:' && u.protocol !== 'smtps:') {
    const scheme = /^[a-z][a-z0-9+.-]{0,20}:$/i.test(u.protocol) ? ` (it starts with ${u.protocol})` : ''
    throw new Error(`SMTP_URL must start with smtp:// or smtps://${scheme}. ${shape}`)
  }
  if (!u.hostname) throw new Error(`SMTP_URL has no host. ${shape}`)
  if (u.search || u.hash || (u.pathname && u.pathname !== '/')) {
    throw new Error(`SMTP_URL takes no path or options after the host and port. ${shape}`)
  }
  try {
    decodeURIComponent(u.username)
    decodeURIComponent(u.password)
  } catch {
    throw new Error('SMTP_URL has a user or password that is not percent-encoded properly — encode @, : and / in them.')
  }
  if (!rawFrom?.trim()) {
    throw new Error(
      'MAIL_FROM is not set. With SMTP_URL it says who letters are from, an address your SMTP server may send as: MAIL_FROM="Tuff <tuff@example.com>"',
    )
  }
  const from = readMailFrom(rawFrom)
  if (!from) {
    throw new Error(
      'MAIL_FROM is not an address Tuff can send from. Write it as tuff@example.com or "Tuff <tuff@example.com>", one line, no quotes inside the name.',
    )
  }
  return { url, from }
}

/**
 * A whole number from the environment, at least `floor` — `fallback` when
 * it is unset, empty, zero or not a number. `Number('')` is 0, and Compose
 * passes a line `PURGE_AFTER_DAYS=` in `.env` as exactly that: the worker
 * read it as zero days and would have cleared every deleted thing at once,
 * and an empty `PORT` was a port the system picked. A review.
 */
export function wholeFromEnv(raw: string | undefined, fallback: number, floor = 1): number {
  const n = Math.floor(Number((raw ?? '').trim() || NaN))
  if (!Number.isFinite(n) || n === 0) return fallback
  return Math.max(floor, n)
}

/**
 * How many days a deleted row waits for the clear-out — `PURGE_AFTER_DAYS`,
 * thirty unless a server of one's own says otherwise. Read by the worker,
 * which clears what is older, and by Recently Deleted, which lists what is
 * younger and says how long each has left: one setting, so the two agree.
 */
export function purgeAfterDays(): number {
  return wholeFromEnv(process.env.PURGE_AFTER_DAYS, 30)
}

/**
 * `OWNER_EMAIL` — on your own server, the one address that may claim it
 * while nobody owns it: Null when unset or empty (Compose passes an unset variable as
 * empty), and then the first confirmed sign-up claims it, as before.
 * Checked as sign-up checks an address, trimmed and lowercased as sign-up
 * lowercases what it is given; the
 * database compares it without regard to case anyway. Throws, at start,
 * for anything that is not one plain address — a typo there would leave
 * the server waiting for an owner who can never sign up.
 */
export function readOwnerEmail(raw: string | undefined): string | null {
  const v = (raw ?? '').trim()
  if (!v) return null
  /* What sign-up takes (`Register` in `http/routes.ts`): an address it
     would refuse is an owner who can never sign up. */
  if (!z.email().safeParse(v).success) {
    throw new Error(
      'OWNER_EMAIL is not an email address. Write it as you@example.com, or leave it empty to let the first person who confirms an address own this server.',
    )
  }
  return v.toLowerCase()
}

/**
 * `SETUP_TOKEN` — on your own server, the one-time token the setup link
 * carries while nobody owns it: Empty when unset
 * (Compose passes an unset variable as empty), and then there is no setup
 * screen. Refused at start when it is too short to be one: `setup.sh`
 * writes 64 hexadecimal characters, and a token somebody typed by hand is
 * a password that would open a server to whoever guessed it.
 */
export function readSetupToken(raw: string | undefined): string {
  const v = (raw ?? '').trim()
  if (v && (v.length < 32 || v.length > 256 || !/^[A-Za-z0-9_-]+$/.test(v))) {
    throw new Error('SETUP_TOKEN is not a token: use at least 32 random letters and digits (openssl rand -hex 32), or leave it empty.')
  }
  return v
}

/**
 * `TRY_LOCALHOST`: Tuff tried on one computer over plain http, which
 * `scripts/try.sh` alone writes. On, the file pass
 * and the sign-up binding are set without `Secure`, so WebKit keeps them on
 * `http://localhost`. So it is on only where nothing crosses a network:
 * `APP_URL` must be `http://localhost[:port]` or `http://127.0.0.1[:port]`
 * and nothing else, or this throws and the app and the worker do not
 * start. A real server's `APP_URL` is its domain, so turned on there by
 * mistake it is a refusal in the log, not a quieter server. A value that is
 * not plainly on or off is refused too, rather than guessed at.
 */
export function readTryLocalhost(raw: string | undefined, appUrl: string | undefined): boolean {
  const v = (raw ?? '').trim().toLowerCase()
  if (['', '0', 'false', 'no', 'off'].includes(v)) return false
  if (!['1', 'true', 'yes', 'on'].includes(v)) throw new Error('TRY_LOCALHOST is 1 or nothing.')
  /* The value exactly as `env.appUrl` takes it, matched whole and not
     trimmed: what is checked is what is used. */
  const said = appUrl ?? ''
  const pinned = /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?\/?$/.test(said)
  if (!pinned) {
    throw new Error(
      `\n!!! TRY_LOCALHOST=1 is for trying Tuff on this computer, at http://localhost:<port>, and APP_URL is ${said.trim() ? JSON.stringify(said.slice(0, 200)) : 'empty'}.\n` +
        '!!! On a server, take TRY_LOCALHOST out of the environment: it sets cookies a network could read (docs/self-hosting.md, "Try it on your computer").\n' +
        '!!! Refusing to start.\n',
    )
  }
  return true
}

export const env = {
  /** The table owner. Migrations and seed only: it bypasses RLS. */
  databaseUrl: required('DATABASE_URL'),
  /** The application role. RLS applies to it — all runtime goes through here. */
  databaseUrlApp: process.env.DATABASE_URL_APP ?? required('DATABASE_URL'),
  /** The worker's role, which alone may call the worker's functions — migration 153. */
  databaseUrlWorker: process.env.DATABASE_URL_WORKER ?? '',
  /** The sign-in role, which alone may write a way in, make a session or a
      token, or delete an account — migration 308.
      `DATABASE_URL_AUTH`, or made from `DATABASE_URL_APP` (`db/authUrl.ts`). */
  databaseUrlAuth: authUrlFrom(process.env.DATABASE_URL_AUTH, process.env.DATABASE_URL_APP),
  jwtSecret: required('JWT_SECRET'),
  /**
   * The key for secrets kept to be read back — a second factor's seed, an
   * integration's token — apart from the one that signs sessions
   * (`auth/seal.ts`). Optional: unset, they are sealed as they always were,
   * under keys derived from `JWT_SECRET`, so nothing has to be set for a
   * deployment to keep working. `_PREVIOUS` is the one being rotated away
   * from, opened and never written.
   */
  encryptionKey: atRestKey('ENCRYPTION_KEY'),
  encryptionKeyPrevious: atRestKey('ENCRYPTION_KEY_PREVIOUS'),
  port: wholeFromEnv(process.env.PORT, 8787),
  /**
   * Pool size. At tens of thousands of users the connections are held not by
   * Postgres but by the pool in front of it: in production that is PgBouncer in
   * transaction mode, which is why the driver runs without prepared statements.
   */
  poolMax: wholeFromEnv(process.env.PG_POOL_MAX, 20),
  /*
   * Push, which the product runs without.
   *
   * Not `required`: a deployment with no keys is one where the switch in
   * Settings says so and nothing else changes. Making the server refuse to
   * start over a notification channel would be the tail wagging the dog.
   */
  vapidPublicKey: process.env.VAPID_PUBLIC_KEY ?? '',
  vapidPrivateKey: process.env.VAPID_PRIVATE_KEY ?? '',
  /* Unset: the service's own (`edition.vendor`), and on your own server
     push stays off until it is given one — `push.ts`. */
  vapidSubject: (process.env.VAPID_SUBJECT ?? '').trim(),
  /*
   * And the Apple apps' own, through Apple's service: one `.p8` key for
   * every app the team has, its id, the team, and the bundle id the
   * notifications are for. Not required either. `APNS_KEY` is the file's
   * text; written on one line, its line breaks may be `\n`.
   */
  apnsKey: (process.env.APNS_KEY ?? '').replace(/\\n/g, '\n'),
  apnsKeyId: process.env.APNS_KEY_ID ?? '',
  apnsTeamId: process.env.APNS_TEAM_ID ?? '',
  /* Unset: the service's apps' bundle (`edition.vendor`); nothing on your own server. */
  apnsTopic: (process.env.APNS_TOPIC ?? '').trim(),
  /*
   * Getting in. None required: a deployment with
   * no mail writes its messages to the log, and one with no provider keys
   * draws no provider buttons.
   */
  /** Where links in mail and the providers' redirects point. Empty: the request's own origin. */
  appUrl: (process.env.APP_URL ?? '').replace(/\/$/, ''),
  /** Tried on this computer over plain http — `readTryLocalhost`. Read once,
      at start, so a server it would not be safe on never listens. */
  tryLocalhost: readTryLocalhost(process.env.TRY_LOCALHOST, process.env.APP_URL),
  resendApiKey: process.env.RESEND_API_KEY ?? '',
  /** GIFs from KLIPY — `docs/specs/gifs.md`. Empty: no GIF button. */
  klipyApiKey: process.env.KLIPY_API_KEY ?? '',
  /* Empty when unset — Compose passes an unset variable as empty. The
     service's own address is the edition's, never a default here: `mailFrom`
     in `mail.ts`. */
  mailFrom: (process.env.MAIL_FROM ?? '').trim(),
  /** Mail through the team's own SMTP server — null without `SMTP_URL`. See `readSmtp`. */
  smtp: readSmtp(process.env.SMTP_URL, process.env.MAIL_FROM),
  /*
   * Cloudflare Turnstile, in front of a feedback page's Send.
   * Read at each request rather than once, so a
   * test can set them. Without them a laptop asks nothing; production
   * without them refuses every request, rather than taking them unchecked.
   */
  get turnstileSiteKey(): string {
    return (process.env.TURNSTILE_SITE_KEY ?? '').trim()
  },
  get turnstileSecretKey(): string {
    return (process.env.TURNSTILE_SECRET_KEY ?? '').trim()
  },
  /** The address that may claim your own server — `readOwnerEmail`. Read
      at each start rather than once, so a test can set it. */
  get ownerEmail(): string | null {
    return readOwnerEmail(process.env.OWNER_EMAIL)
  },
  /**
   * Whether a mail server saved in Server settings may be at a private
   * address — a relay of one's own, like a `postfix` container on the
   * compose network. Off unless `SMTP_ALLOW_PRIVATE=1` (`true`, `yes`, `on`
   * mean the same): otherwise a stolen owner's session could point mail
   * at the server's own network. Never link-local or a cloud's metadata
   * address, whatever it says. Read at each
   * ask, so a test can set it.
   */
  get smtpAllowPrivate(): boolean {
    return ['1', 'true', 'yes', 'on'].includes((process.env.SMTP_ALLOW_PRIVATE ?? '').trim().toLowerCase())
  },
  /** The setup link's token — `readSetupToken`. Read at each ask, so a
      test can set it. */
  get setupToken(): string {
    return readSetupToken(process.env.SETUP_TOKEN)
  },
  /**
   * Whether the community edition's worker asks GitHub once a day for the
   * latest release — `docs/self-hosting.md`, "Hearing of a new version".
   * `UPDATE_CHECK=off` stops it before anything is sent; so do `false`,
   * `no` and `0`, which somebody will write meaning the same. Anything
   * else, empty among it, leaves it on. Read at each ask, so a test can
   * set it. Never read on the service, which does not ask.
   */
  get updateCheck(): boolean {
    return !['off', 'false', 'no', '0'].includes((process.env.UPDATE_CHECK ?? '').trim().toLowerCase())
  },
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
  appleClientId: process.env.APPLE_CLIENT_ID ?? '',
  appleTeamId: process.env.APPLE_TEAM_ID ?? '',
  appleKeyId: process.env.APPLE_KEY_ID ?? '',
  /** The .p8 key's contents; `\n` may stand for its newlines. */
  applePrivateKey: (process.env.APPLE_PRIVATE_KEY ?? '').replace(/\\n/g, '\n'),
  /*
   * The Tuff app on GitHub. Not required: without
   * them Settings says GitHub is not set up here and nothing else changes.
   * The private key is the .pem's text, a PKCS#1 RSA key as GitHub gives it.
   */
  githubAppId: (process.env.GITHUB_APP_ID ?? '').trim(),
  githubAppSlug: (process.env.GITHUB_APP_SLUG ?? 'tuff').trim(),
  githubClientId: (process.env.GITHUB_CLIENT_ID ?? '').trim(),
  githubClientSecret: (process.env.GITHUB_CLIENT_SECRET ?? '').trim(),
  githubWebhookSecret: (process.env.GITHUB_WEBHOOK_SECRET ?? '').trim(),
  /* Signing in with GitHub, a separate OAuth App that reads who somebody
     is and nothing else. */
  githubSigninClientId: (process.env.GITHUB_SIGNIN_CLIENT_ID ?? '').trim(),
  githubSigninClientSecret: (process.env.GITHUB_SIGNIN_CLIENT_SECRET ?? '').trim(),
  githubPrivateKey: (process.env.GITHUB_PRIVATE_KEY ?? '').replace(/\\n/g, '\n').trim(),
  /* The Tuff app on Slack. Without them Settings
     says Slack is not set up here. */
  slackClientId: (process.env.SLACK_CLIENT_ID ?? '').trim(),
  slackClientSecret: (process.env.SLACK_CLIENT_SECRET ?? '').trim(),
  /* What Slack signs its events with.
     Without it no event is believed and previews are not asked for. */
  slackSigningSecret: (process.env.SLACK_SIGNING_SECRET ?? '').trim(),
}
