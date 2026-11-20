import { z } from 'zod'
import { seal } from '../auth/seal.js'
import type { Tx } from '../db.js'
import { env, readMailFrom } from '../env.js'
import { envMailSender, forgetSavedMail, nearbyHost, savedMail } from '../mail.js'
import { mailServerAddress } from '../outbound.js'

/*
 * Mail set up from the screen — the setup screen's first step and Server
 * settings' Email panel. One shape, one check,
 * one write, for both: the only difference is who may, which the database
 * decides (`instance_mail_write`: an owner of the server, or the setup
 * token while nobody owns it).
 *
 * The secrets are sealed here, before they reach the database, and never
 * come back out of it to anybody but `mail.ts`.
 */

/** The ports SMTP is spoken on. A form that makes the server connect to
    any port would let a stolen session map the server's network. */
export const SMTP_PORTS = [465, 587, 25, 2525] as const

const noControl = (s: string) => !/[\u0000-\u001f\u007f]/.test(s)

export const MailInput = z.discriminatedUnion('via', [
  z
    .object({
      via: z.literal('smtp'),
      host: z.string().trim().min(1).max(253),
      port: z.number().int(),
      security: z.enum(['tls', 'starttls', 'none']),
      /* Empty: no sign-in, a relay that takes mail from this server. */
      user: z.string().trim().max(254).refine(noControl).nullish(),
      /* Empty: keep the one saved — for the same host and user only. */
      password: z.string().max(1024).refine(noControl).nullish(),
      sender: z.string().max(320),
    })
    .strict(),
  z
    .object({
      via: z.literal('resend'),
      /* Empty: keep the one saved. */
      key: z.string().trim().max(256).nullish(),
      sender: z.string().max(320),
    })
    .strict(),
])
export type MailInput = z.infer<typeof MailInput>

export type MailRefusal = { status: 400 | 403 | 409; code: string; message: string }

const HOSTNAME = /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/
const IPV6 = /^\[[0-9A-Fa-f:.]{2,45}\]$/

/**
 * A mail server's name: a host name, an IPv4 address or a bracketed IPv6
 * one — never a URL, a path or a port. Not a link-local address or the
 * cloud's metadata host, which are no mail server and the first thing a
 * request forged through a form goes looking for.
 */
export function mailHost(raw: string): string | null {
  const h = raw.trim().toLowerCase().replace(/\.$/, '')
  if (!HOSTNAME.test(h) && !IPV6.test(h)) return null
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h)
  if (v4 && v4.slice(1).some((n) => Number(n) > 255)) return null
  if (v4 && (v4[1] === '0' || (v4[1] === '169' && v4[2] === '254'))) return null
  if (IPV6.test(h) && (/^\[(fe8|fe9|fea|feb)/.test(h) || h === '[::]')) return null
  if (h === 'metadata.google.internal' || h === 'metadata') return null
  return h
}

const refuse = (code: string, message: string, status: MailRefusal['status'] = 400): MailRefusal => ({ status, code, message })

/** The answer's body for a refusal. Its words are in `ERRORS_FR` (`words.ts`), which says them in French. */
export function refusalBody(r: MailRefusal) {
  const { code, message } = r
  return { error: { code, message } }
}

/** What is wrong with it, in a sentence a person reads, or null. */
export function mailRefusal(input: MailInput): MailRefusal | null {
  if (!readMailFrom(input.sender)) {
    return refuse('bad_sender', 'Write the sender as tuff@example.com or Tuff <tuff@example.com>.')
  }
  if (input.via === 'resend') {
    if (input.key && !/^[A-Za-z0-9_.-]{8,256}$/.test(input.key)) return refuse('bad_key', 'That isn’t a Resend API key.')
    return null
  }
  const host = mailHost(input.host)
  if (!host) return refuse('bad_host', 'Write the server as smtp.example.com, without smtp:// or a port.')
  if (!(SMTP_PORTS as readonly number[]).includes(input.port)) return refuse('bad_port', 'Use port 465, 587, 25 or 2525.')
  if (input.security === 'none' && (input.user || input.password || !nearbyHost(host))) {
    return refuse(
      'plain_not_allowed',
      'Without TLS, Tuff only sends through a server on this machine or its own network, with no user or password.',
    )
  }
  return null
}

/**
 * Saved, through `instance_mail_write` in the transaction given — as the
 * owner (`withActor`) or with the setup token's hash. 'saved', or what to
 * say instead.
 */
export async function saveMail(tx: Tx, input: MailInput, setupHash: string | null): Promise<'saved' | MailRefusal> {
  if (envMailSender()) {
    return refuse('mail_from_env', 'Mail is set by the server’s environment. Change SMTP_URL or RESEND_API_KEY there.', 409)
  }
  const wrong = mailRefusal(input)
  if (wrong) return wrong
  /* Where the name points now: a public address, or a private one only
     where the machine allows a relay of its own. Asked again at every
     letter, on the address the socket uses (`mail.ts`). */
  if (input.via === 'smtp') {
    const at = await mailServerAddress(mailHost(input.host)!, env.smtpAllowPrivate)
    if (at === 'unknown') return refuse('unknown_host', 'Couldn’t find that server. Check its name.')
    if (at === 'private') {
      return refuse(
        'private_host',
        'That server is on a private network. Tuff sends only to public mail servers unless SMTP_ALLOW_PRIVATE=1 is set on the server.',
      )
    }
  }
  const sender = input.sender.trim()
  const said =
    input.via === 'smtp'
      ? await tx<{ said: string }[]>`
          select instance_mail_write(${setupHash}, 'smtp', ${mailHost(input.host)}, ${input.port}, ${input.security},
                                     ${input.user || null}, ${input.password ? seal('mail', input.password) : null},
                                     ${null}, ${true}, ${sender}) as said`
      : await tx<{ said: string }[]>`
          select instance_mail_write(${setupHash}, 'resend', ${null}, ${null}, ${null}, ${null}, ${null},
                                     ${input.key ? seal('mail', input.key) : null}, ${true}, ${sender}) as said`
  const r = said[0]?.said
  if (r === 'secret_needed') {
    return input.via === 'smtp'
      ? refuse('secret_needed', 'Enter the password. It’s asked again when the server or the user changes.')
      : refuse('secret_needed', 'Enter the API key.')
  }
  if (r !== 'saved') return refuse('forbidden', 'Not allowed.', 403)
  return 'saved'
}

/** Disconnected. False when the database says this caller may not. */
export async function clearMail(tx: Tx, setupHash: string | null): Promise<boolean | MailRefusal> {
  if (envMailSender()) {
    return refuse('mail_from_env', 'Mail is set by the server’s environment. Change SMTP_URL or RESEND_API_KEY there.', 409)
  }
  const [r] = await tx<{ ok: boolean }[]>`select instance_mail_clear(${setupHash}) as ok`
  return r?.ok === true
}

/** After a write has committed: this process reads it now, not in thirty seconds. */
export async function mailChanged(): Promise<void> {
  forgetSavedMail()
  await savedMail()
}
