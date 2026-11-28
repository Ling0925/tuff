import { createHash } from 'node:crypto'
import { appendFile } from 'node:fs/promises'
import { isIP } from 'node:net'
import { open } from './auth/seal.js'
import { sql } from './db.js'
import { env, PLAIN_ADDRESS, readMailFrom, type MailSender } from './env.js'
import { edition } from './edition.js'
import { mailServerAddress } from './outbound.js'
import type { Language } from './words.js'

/**
 * Mail, through Resend's HTTP API on the service and through the team's own
 * SMTP server on a server of their own.
 *
 * Resend is one POST and needs no package. SMTP is spoken by `nodemailer`,
 * loaded only when `SMTP_URL` is set, so the service never runs it. With
 * neither the message goes to the log, so a deployment without mail still
 * works and a developer can follow the link; tests read `outbox`.
 */
export type Mail = {
  to: string
  subject: string
  text: string
  html: string
  /** Said to the mail client, not the reader — `List-Unsubscribe` on a digest. */
  headers?: Record<string, string>
  /** Where an answer goes, when it is not us — a self-hosting request's sender, an inviter. */
  replyTo?: string
  /**
   * A person the mail is from, when it is one: "Ana via Tuff", at our own
   * address. An invitation is a note from somebody, and is read as one
   * only when it says so where the inbox looks.
   */
  fromName?: string
  /**
   * Whose name the From says the letter comes through: Tuff, unless it is a
   * workspace that wears its own — "Ana via Acme", or "Acme" alone when no
   * person sends it. The address stays ours.
   */
  via?: string
  /**
   * The brand alone in the From, with no person before it — only a letter
   * to the workspace's own members, the digest. Said, never inferred: a
   * person's name that cleans to nothing is "Someone via Acme", or a
   * workspace on a trial named "PayPal Security" would mail strangers as
   * that and nothing else, from our address.
   */
  bare?: boolean
  /** The word for a person whose name cleans to nothing, in the letter's language. */
  someone?: string
}

/**
 * One line: every control character and line separator becomes a space, and
 * runs of space become one. What a header is given of anybody's text — a
 * name, a subject — goes through this, so it cannot start a header of its own.
 */
export function oneLine(s: string): string {
  return s
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * A person's name as the From line may say it: one line, nothing that could
 * close the quotes or pass for an address, no `=?` that a mail client would
 * decode as an encoded word into another name, and short. Empty when
 * nothing is left of it.
 */
export function personName(name: string): string {
  return oneLine(
    name
      .replace(INVISIBLE, '')
      .replace(/["\\<>@]+/g, ' ')
      .replace(/=\?/g, ' '),
  )
    .slice(0, 48)
    .trim()
}

/* What a From line must not carry and a reader cannot see: zero-width
   spaces and joiners, the marks that turn text right to left and back, the
   byte-order mark and the soft hyphen — each a way to make "Acme" in an
   inbox read as something else, or one name look like another. */
const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF\u00AD]/g

/**
 * The From line for a person's name at our address. The name is whatever
 * they typed, so it keeps to one line, has nothing that could close the
 * quotes or pass for an address, and is short; "via Tuff" says whose
 * address it is. Nothing left of it, and the mail is from the product.
 *
 * `via` is a branded workspace's name in Tuff's place, kept the same way:
 * "Ana via Acme", and with no person, "Acme"
 * alone at our address.
 */
export function fromPerson(name: string, from: string = mailFrom(), via?: string, how: { bare?: boolean; someone?: string } = {}): string {
  const address = /<([^>]+)>/.exec(from)?.[1] ?? from
  const shown = fromShown(name, via, how)
  return shown ? `"${shown}" <${address}>` : from
}

/**
 * The name a From line shows, made safe, or null for the sender's own.
 * A person comes through Tuff, or through a branded workspace; with a
 * brand, a person whose name cleans to nothing is "Someone via Acme", and
 * the brand stands alone only when the letter says `bare`. A brand that
 * cleans to nothing is no brand.
 */
export function fromShown(name: string, via?: string, how: { bare?: boolean; someone?: string } = {}): string | null {
  const person = personName(name)
  const brand = via ? personName(via) : ''
  if (!brand) return person ? `${person} via Tuff` : null
  if (how.bare) return brand
  return `${person || personName(how.someone ?? '') || 'Someone'} via ${brand}`
}

/**
 * Which way mail leaves, by `edition.mail`. The service (`resend`) sends
 * through Resend or not at all: an `SMTP_URL` there is never read, and
 * nodemailer never loaded. A server of one's own (`smtp`) sends through its
 * SMTP server, through Resend when it has only a key, and with neither,
 * nowhere.
 */
export function senderFor(resend: boolean, smtp: boolean, edition: 'resend' | 'smtp'): 'resend' | 'smtp' | null {
  if (edition === 'resend') return resend ? 'resend' : null
  return smtp ? 'smtp' : resend ? 'resend' : null
}

/** Which way the environment sends — `SMTP_URL` or `RESEND_API_KEY` — which wins over anything saved. */
export function envMailSender(): 'resend' | 'smtp' | null {
  return senderFor(Boolean(env.resendApiKey), Boolean(env.smtp), edition.mail)
}

/*
 * Mail saved in Server settings, or by the setup screen.
 *
 * Only where `edition.mail` is `smtp`, your own server's: the service never
 * asks the database. Read through `instance_mail_sealed()` and opened here,
 * kept for thirty seconds and forgotten at once when this process saves or
 * clears it, so the worker — another process, sending through the same
 * `send()` — is at most that late. The environment wins whenever it sends.
 */
export type SmtpSecurity = 'tls' | 'starttls' | 'none'
export type SavedMail =
  | { via: 'smtp'; host: string; port: number; security: SmtpSecurity; user: string | null; password: string | null; from: MailSender }
  | { via: 'resend'; key: string; from: MailSender }

/** How long a read of the saved mail is believed. */
export const SAVED_FOR_MS = 30_000
let saved: SavedMail | null = null
let savedAt = 0
let reading: Promise<SavedMail | null> | null = null
let saidUnreadable = false

const readsSaved = () => edition.mail === 'smtp'

async function readSaved(): Promise<SavedMail | null> {
  const [r] = await sql<
    {
      via: string
      smtp_host: string | null
      smtp_port: number | null
      smtp_security: string | null
      smtp_user: string | null
      smtp_password_enc: string | null
      resend_key_enc: string | null
      sender: string
    }[]
  >`select * from instance_mail_sealed()`
  if (!r) return null
  const from = readMailFrom(r.sender)
  /* A secret that will not open under any key this server has — rotated
     without `reseal` — is no mail, said once rather than every letter. */
  const unreadable = () => {
    if (!saidUnreadable)
      console.error('[mail] the saved mail settings will not open with this server’s keys: set them again in Server settings')
    saidUnreadable = true
    return null
  }
  if (!from) return null
  if (r.via === 'resend') {
    const key = open('mail', r.resend_key_enc)
    return key ? { via: 'resend', key, from } : unreadable()
  }
  if (r.via !== 'smtp' || !r.smtp_host || !r.smtp_port || !r.smtp_security) return null
  const password = r.smtp_password_enc ? open('mail', r.smtp_password_enc) : null
  if (r.smtp_password_enc && password === null) return unreadable()
  return {
    via: 'smtp',
    host: r.smtp_host,
    port: r.smtp_port,
    security: r.smtp_security as SmtpSecurity,
    user: r.smtp_user,
    password,
    from,
  }
}

/** The saved mail, fresh within `SAVED_FOR_MS`; null on the service and wherever nothing is saved. */
export async function savedMail(): Promise<SavedMail | null> {
  if (!readsSaved()) return null
  if (savedAt && Date.now() - savedAt < SAVED_FOR_MS) return saved
  reading ??= readSaved()
    .then((v) => {
      saved = v
      savedAt = Date.now()
      return v
    })
    /* The database away: what was read last, asked again next time. */
    .catch(() => saved)
    .finally(() => {
      reading = null
    })
  return reading
}

/** Saved or cleared by this process: the next read asks the database. */
export function forgetSavedMail(): void {
  savedAt = 0
}

export function mailSender(): 'resend' | 'smtp' | null {
  const fromEnv = envMailSender()
  if (fromEnv || !readsSaved()) return fromEnv
  /* Asked without waiting: what was read last, and a read on its way when that is old. */
  if (!savedAt || Date.now() - savedAt >= SAVED_FOR_MS) void savedMail()
  return saved?.via ?? null
}

/** Whether letters leave this server, as last read — `mailOn` waits for a fresh answer. */
export function mailConfigured(): boolean {
  return mailSender() !== null
}

/** Whether letters leave this server, asked of the saved settings when they are old. */
export async function mailOn(): Promise<boolean> {
  if (envMailSender()) return true
  return (await savedMail()) !== null
}

/** `MAIL_FROM`'s shape, written back. */
export function senderLine(from: MailSender): string {
  return from.name ? `${from.name} <${from.address}>` : from.address
}

/**
 * What Server settings and the setup screen are told of the mail — never a
 * password or a key, only whether one is set. `source` is where it comes
 * from: the environment, which wins and cannot be changed from the screen,
 * the saved settings, or nowhere.
 */
export type MailSetup = {
  source: 'env' | 'saved' | null
  via: 'smtp' | 'resend' | null
  host: string | null
  port: number | null
  security: SmtpSecurity | null
  user: string | null
  secret_set: boolean
  sender: string | null
}

export async function mailSetup(): Promise<MailSetup> {
  const none: MailSetup = { source: null, via: null, host: null, port: null, security: null, user: null, secret_set: false, sender: null }
  const fromEnv = envMailSender()
  if (fromEnv === 'smtp' && env.smtp) {
    const o = smtpOptions(env.smtp.url)
    return {
      source: 'env',
      via: 'smtp',
      host: o.host,
      port: o.port,
      security: o.secure ? 'tls' : o.requireTLS ? 'starttls' : 'none',
      user: o.auth?.user || null,
      secret_set: Boolean(o.auth?.pass),
      sender: senderLine(env.smtp.from),
    }
  }
  if (fromEnv === 'resend') {
    /* Asked at start, and refused there when missing: never thrown from a screen. */
    let sender: string | null = null
    try {
      sender = mailFrom() || null
    } catch {}
    return { ...none, source: 'env', via: 'resend', secret_set: true, sender }
  }
  const s = await savedMail()
  if (!s) return none
  if (s.via === 'resend') return { ...none, source: 'saved', via: 'resend', secret_set: true, sender: senderLine(s.from) }
  return {
    source: 'saved',
    via: 'smtp',
    host: s.host,
    port: s.port,
    security: s.security,
    user: s.user,
    secret_set: Boolean(s.password),
    sender: senderLine(s.from),
  }
}

/**
 * Who letters are from: `MAIL_FROM`, else the service's own address. Your
 * own server has none of the service's (`edition.vendor` is null), so one
 * that sends mail and was not told who from is refused at start — a letter
 * from hello@usetuff.com about somebody else's server is the service
 * speaking for it. Without mail it is empty and nothing is sent. With
 * `SMTP_URL`, `readSmtp` has refused a missing one already.
 */
export function senderAddress(raw: string, vendor: string | null, sends: boolean): string {
  if (raw) return raw
  if (vendor) return vendor
  if (!sends) return ''
  throw new Error(
    'MAIL_FROM is not set. With RESEND_API_KEY it says who letters are from, an address your Resend domain may send as: MAIL_FROM="Tuff <tuff@example.com>" — see .env.example',
  )
}

let resolved: string | null = null
/** `senderAddress` for this server — asked once at start by `main.ts` and the worker, so a missing one stops it there.
    Of the environment's mail only: saved mail carries its own sender. */
export function mailFrom(): string {
  resolved ??= senderAddress(env.mailFrom, edition.vendor?.mailFrom ?? null, envMailSender() !== null)
  return resolved
}

/** What was sent, most recent last — read by tests, kept short. */
export const outbox: Mail[] = []

const live = process.env.NODE_ENV === 'production'

/* The browser tests' copy of every letter (below) — never in production,
   where it would be every reset link in a file. Said loudly and ignored. */
const outboxFile = process.env.MAIL_OUTBOX_FILE && !live ? process.env.MAIL_OUTBOX_FILE : null
if (process.env.MAIL_OUTBOX_FILE && live) {
  console.error('[mail] MAIL_OUTBOX_FILE IS SET IN PRODUCTION AND IS IGNORED: letters are never written to a file here.')
}

export async function send(mail: Mail): Promise<boolean> {
  /* Kept for the tests to read — never in production, where it would be
     the last fifty reset and invitation links sitting in memory. */
  if (!live) {
    outbox.push(mail)
    if (outbox.length > 50) outbox.shift()
    /* And a line in a file, for the browser tests, which run in another
       process and follow a letter's link as a person would. Only where
       `pnpm check` or CI names the file (`MAIL_OUTBOX_FILE`), and never in
       production, for the reason above. */
    if (outboxFile) {
      await appendFile(outboxFile, `${JSON.stringify({ to: mail.to, subject: mail.subject, text: mail.text })}\n`, { mode: 0o600 }).catch(
        () => {},
      )
    }
  }
  const way = await mailWay()
  if (way === 'refused') return false
  if (way?.via === 'smtp') return sendSmtp(mail, way)
  if (!way) {
    /* Without a key, a developer follows the link from the log. In
       production the log is not a place for a reset link — anybody who can
       read it could use it — so it says only that nothing was sent. */
    if (live) {
      const [who, at] = mail.to.split('@')
      console.error(
        `[mail] no mail is set up (Server settings, or SMTP_URL or RESEND_API_KEY): "${mail.subject}" to ${who?.[0] ?? ''}…@${at ?? ''} was not sent`,
      )
      return false
    }
    console.log(`[mail] to ${mail.to}: ${mail.subject}\n${mail.text}`)
    return true
  }
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${way.key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: fromPerson(mail.fromName ?? '', way.from, mail.via, { bare: mail.bare === true, someone: mail.someone ?? '' }),
        to: [mail.to],
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
        ...(mail.headers ? { headers: mail.headers } : {}),
        ...(mail.replyTo ? { reply_to: mail.replyTo } : {}),
      }),
    })
    if (!r.ok) console.error(`[mail] Resend refused: ${r.status} ${await r.text().catch(() => '')}`)
    return r.ok
  } catch (e) {
    console.error('[mail] could not reach Resend', e)
    return false
  }
}

/*
 * SMTP.
 *
 * nodemailer's advisories have been in parsing addresses and in regexes a
 * hostile string can make slow, so it is never handed anybody's text where
 * it would parse it: the recipients are addresses Tuff validated, checked
 * again here as plain ones and passed as an array; the sender is an object,
 * its name already one line; the subject and every header value go through
 * `oneLine`. The transport is built from the URL by us, field by field, and
 * never from the URL itself — nodemailer reads options out of a URL's query,
 * `?sendmail=true` among them, which would make it run a shell command.
 */

/** How long a hung SMTP server may hold a letter, and the worker sending it. */
export const SMTP_TIMEOUTS = { connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 30_000, dnsTimeout: 10_000 }

/**
 * A host on this machine or its own network: loopback, an RFC 1918 address,
 * or a name with no dot — a Docker service such as `postfix`. The only
 * places a relay may be spoken to without TLS.
 */
export function nearbyHost(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase()
  if (h === 'localhost' || h === '::1') return true
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h)
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])]
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
  }
  return !h.includes('.') && !h.includes(':') && /^[a-z0-9-]{1,63}$/.test(h)
}

/**
 * The SMTP transport's options, from `SMTP_URL`. `smtps:` is TLS from the
 * first byte (465); `smtp:` (587) demands STARTTLS — so nobody on the path
 * can strip it and read the sign-in, reset and invitation links — except
 * to a relay on this machine or its own network (`nearbyHost`) that is
 * given no password. A password never crosses in the clear, anywhere.
 */
export function smtpOptions(url: string) {
  const u = new URL(url)
  const secure = u.protocol === 'smtps:'
  const user = decodeURIComponent(u.username)
  const pass = decodeURIComponent(u.password)
  return {
    host: u.hostname.replace(/^\[|\]$/g, ''),
    port: u.port ? Number(u.port) : secure ? 465 : 587,
    secure,
    requireTLS: !secure && (Boolean(user || pass) || !nearbyHost(u.hostname)),
    ...(user || pass ? { auth: { user, pass } } : {}),
    ...SMTP_TIMEOUTS,
    logger: false,
    debug: false,
  }
}

/**
 * The same, from what Server settings saved — field by field, never a URL.
 * `tls` is TLS from the first byte, `starttls` demands STARTTLS, and `none`
 * is plain only to a relay nearby given no password: the screen refuses
 * anything else, and this refuses it again.
 *
 * `at` is the address `mailServerAddress` checked: the socket goes to it by
 * number, and the name is only what TLS presents and verifies
 * (`servername`), so nothing looks the name up again between the check and
 * the connection.
 */
export function savedSmtpOptions(s: Extract<SavedMail, { via: 'smtp' }>, at?: string): SmtpOptions {
  const credentials = Boolean(s.user || s.password)
  const named = !isIP(s.host.replace(/^\[|\]$/g, ''))
  return {
    host: at ?? s.host,
    ...(at && named ? { servername: s.host } : {}),
    port: s.port,
    secure: s.security === 'tls',
    requireTLS: s.security !== 'tls' && (s.security === 'starttls' || credentials || !nearbyHost(s.host)),
    ...(s.user ? { auth: { user: s.user, pass: s.password ?? '' } } : {}),
    ...SMTP_TIMEOUTS,
    logger: false,
    debug: false,
  }
}

type SmtpOptions = ReturnType<typeof smtpOptions> & { servername?: string }
type SmtpWay = { via: 'smtp'; options: SmtpOptions; key: string; from: MailSender }
type MailWay = SmtpWay | { via: 'resend'; key: string; from: string }

/**
 * How this letter leaves: the environment's way when it has one, else what
 * is saved, else none — and `refused` when the saved mail server is now at
 * an address Tuff does not send to, or cannot be found. The environment's
 * `SMTP_URL` is the machine's own word and is not checked.
 */
async function mailWay(): Promise<MailWay | 'refused' | null> {
  const fromEnv = envMailSender()
  if (fromEnv === 'smtp' && env.smtp) return { via: 'smtp', options: smtpOptions(env.smtp.url), key: env.smtp.url, from: env.smtp.from }
  if (fromEnv === 'resend') return { via: 'resend', key: env.resendApiKey, from: mailFrom() }
  const s = await savedMail()
  if (!s) return null
  if (s.via === 'resend') return { via: 'resend', key: s.key, from: senderLine(s.from) }
  /* Checked again at every letter, on the address the socket will use. */
  const at = await mailServerAddress(s.host, env.smtpAllowPrivate)
  if (typeof at === 'string') {
    console.error(
      at === 'private'
        ? '[mail] not sent: the saved mail server is at a private address (set SMTP_ALLOW_PRIVATE=1 for a relay of your own)'
        : '[mail] not sent: the saved mail server’s name did not resolve',
    )
    return 'refused'
  }
  const options = savedSmtpOptions(s, at.address)
  /* The transport is kept by what it was made from, password and all —
     hashed, so the key in memory is not the password. */
  return { via: 'smtp', options, key: createHash('sha256').update(JSON.stringify(options)).digest('hex'), from: s.from }
}

type Transport = { sendMail(m: Record<string, unknown>): Promise<{ accepted?: unknown[]; rejected?: unknown[] }> }
let transport: { key: string; made: Promise<Transport> } | null = null

function smtpTransport(key: string, options: SmtpOptions): Promise<Transport> {
  if (transport?.key !== key) {
    const made = import('nodemailer').then(
      (m) =>
        m.createTransport(options, {
          /* Nothing Tuff sends attaches a file, and a letter must never
             read one from disk or fetch one by URL if it ever did. */
          disableFileAccess: true,
          disableUrlAccess: true,
        }) as unknown as Transport,
    )
    made.catch(() => {
      if (transport?.made === made) transport = null
    })
    transport = { key, made }
  }
  return transport.made
}

/* The headers a caller may add: a digest's way out. Nothing that names
   who a letter is to or from — those are this file's alone. */
const MAY_SAY = new Set(['list-unsubscribe', 'list-unsubscribe-post'])

async function sendSmtp(mail: Mail, smtp: SmtpWay): Promise<boolean> {
  /* Checked again where nodemailer would parse them: a plain address, or
     nothing is sent. Every caller hands one Tuff validated already. */
  if (!PLAIN_ADDRESS.test(mail.to) || (mail.replyTo && !PLAIN_ADDRESS.test(mail.replyTo))) {
    console.error('[mail] not sent: an address is not a plain one')
    return false
  }
  const shown = fromShown(mail.fromName ?? '', mail.via, { bare: mail.bare === true, someone: mail.someone ?? '' })
  const headers = mail.headers
    ? Object.fromEntries(
        Object.entries(mail.headers)
          .filter(([k]) => MAY_SAY.has(k.toLowerCase()))
          .map(([k, v]) => [k, oneLine(v)]),
      )
    : undefined
  try {
    const t = await smtpTransport(smtp.key, smtp.options)
    const info = await t.sendMail({
      from: { name: shown ?? smtp.from.name, address: smtp.from.address },
      to: [mail.to],
      ...(mail.replyTo ? { replyTo: [mail.replyTo] } : {}),
      subject: oneLine(mail.subject),
      text: mail.text,
      html: mail.html,
      ...(headers ? { headers } : {}),
    })
    const ok = (info.accepted?.length ?? 0) > 0 && (info.rejected?.length ?? 0) === 0
    if (!ok) console.error('[mail] the SMTP server did not take the letter')
    return ok
  } catch (e) {
    /* By its code alone: nodemailer's words carry the server's answer, which
       names the recipient, and could carry what was sent to log in. */
    const err = e as { code?: unknown; responseCode?: unknown }
    const said = [err.code, err.responseCode]
      .filter((x) => (typeof x === 'string' && /^[A-Z_]{1,32}$/.test(x)) || typeof x === 'number')
      .join(' ')
    console.error(`[mail] SMTP did not send: ${said || 'no code'}`)
    return false
  }
}

/**
 * A message with one button, plain enough to read as text too.
 *
 * The lines and the label come written in the reader's language; what the
 * letter adds of its own — the colon before the link, the line under the
 * button — follows it. The sign-off is the product's name and needs none.
 */
export function letter(lines: string[], button: { label: string; url: string }, language: Language = 'en'): { text: string; html: string } {
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
  const fr = language === 'fr'
  const zh = language === 'zh'
  const linkLine = zh ? `${button.label}：${button.url}` : `${button.label}${fr ? ' :' : ':'} ${button.url}`
  const text = [...lines, '', linkLine, '', '— Tuff'].join('\n')
  const fallback = zh
    ? '如果按钮无法使用，请打开此链接：'
    : fr
      ? 'Si le bouton ne fonctionne pas, ouvrez ce lien :'
      : 'If the button doesn’t work, open this link:'
  const html = `<!doctype html><html${language === 'en' ? '' : ` lang="${language}"`}><body style="margin:0;background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:40px 16px">
<table width="480" cellpadding="0" cellspacing="0" style="max-width:480px;background:#fff;border-radius:16px;padding:32px">
<tr><td style="font-size:17px;font-weight:600;color:#1d1d1f;padding-bottom:16px">Tuff</td></tr>
${lines.map((l) => `<tr><td style="font-size:15px;line-height:1.5;color:#3a3a3c;padding-bottom:12px">${esc(l)}</td></tr>`).join('')}
<tr><td style="padding:12px 0 8px"><a href="${esc(button.url)}" style="display:inline-block;background:#007aff;color:#fff;text-decoration:none;font-size:15px;font-weight:500;padding:12px 24px;border-radius:999px">${esc(button.label)}</a></td></tr>
<tr><td style="font-size:12px;color:#8e8e93;padding-top:16px">${fallback} ${esc(button.url)}</td></tr>
</table></td></tr></table></body></html>`
  return { text, html }
}

/**
 * A note from a person, written as one: paragraphs and one link, no card,
 * no button, no colours, no header. Gmail files a letter laid out like a
 * newsletter under Promotions, and an invitation sent that way was not
 * seen. The text part says the same, with the
 * link written out.
 */
export function note(
  before: string[],
  link: { label: string; url: string },
  after: string[] = [],
  language: Language = 'en',
): { text: string; html: string } {
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
  const fr = language === 'fr'
  const zh = language === 'zh'
  const linkLine = zh ? `${link.label}：${link.url}` : `${link.label}${fr ? ' :' : ':'} ${link.url}`
  const text = [...before, linkLine, ...after].join('\n\n')
  const p = (inner: string) => `<p style="margin:0 0 16px">${inner}</p>`
  const html = `<!doctype html><html${language === 'en' ? '' : ` lang="${language}"`}><body>
<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#222">
${[...before.map((l) => p(esc(l))), p(`<a href="${esc(link.url)}">${esc(link.label)}</a>`), ...after.map((l) => p(esc(l)))].join('\n')}
</div></body></html>`
  return { text, html }
}
