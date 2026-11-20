/*
 * Mail set up from a screen — the setup screen's first step and Server
 * settings' Email panel. What the server says
 * (`MailSetup`, never a password or key), what the form holds, and what it
 * sends.
 */

export type MailSecurity = 'tls' | 'starttls' | 'none'

/** `MailSetup` in the schema: how the server sends, and whether a secret is set. */
export type MailSetup = {
  source: 'env' | 'saved' | null
  via: 'smtp' | 'resend' | null
  host: string | null
  port: number | null
  security: MailSecurity | null
  user: string | null
  secret_set: boolean
  sender: string | null
}

export type MailDraft = {
  via: 'smtp' | 'resend'
  host: string
  port: string
  security: MailSecurity
  user: string
  /** Empty: keep the one saved, when there is one. */
  password: string
  key: string
  sender: string
}

/** The port each security usually goes with — chosen with it until the port is typed. */
export const PORT_FOR: Record<MailSecurity, string> = { tls: '465', starttls: '587', none: '25' }

/** A form filled with what is saved, the secrets left empty. */
export function draftOf(m: MailSetup | null, sender = ''): MailDraft {
  const security = m?.security ?? 'tls'
  return {
    via: m?.via ?? 'smtp',
    host: m?.host ?? '',
    port: m?.port ? String(m.port) : PORT_FOR[security],
    security,
    user: m?.user ?? '',
    password: '',
    key: '',
    sender: m?.sender ?? sender,
  }
}

/** Whether a password or key is saved that an empty field keeps — for the same server and user only, as the server holds it. */
export function keepsSecret(m: MailSetup | null, d: MailDraft): boolean {
  if (!m || m.source !== 'saved' || !m.secret_set || m.via !== d.via) return false
  if (d.via === 'resend') return true
  return m.host === d.host.trim().toLowerCase() && (m.user ?? '') === d.user.trim()
}

/** Enough typed to send. */
export function draftReady(m: MailSetup | null, d: MailDraft): boolean {
  if (!d.sender.trim()) return false
  if (d.via === 'resend') return Boolean(d.key.trim()) || keepsSecret(m, d)
  if (!d.host.trim() || !/^\d{1,5}$/.test(d.port)) return false
  if (d.user.trim() && !d.password && !keepsSecret(m, d)) return false
  return true
}

/** What `PUT …/mail` takes. */
export function inputOf(d: MailDraft): Record<string, unknown> {
  if (d.via === 'resend') return { via: 'resend', key: d.key.trim() || null, sender: d.sender.trim() }
  const user = d.user.trim()
  return {
    via: 'smtp',
    host: d.host.trim(),
    port: Number(d.port),
    security: d.security,
    user: user || null,
    password: user && d.password ? d.password : null,
    sender: d.sender.trim(),
  }
}
