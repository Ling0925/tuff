import { useCallback, useEffect, useState } from 'react'
import { HEADS, MORE, SAYS, TONGUES, chooseTongue, readTongue, type Chosen } from '../data/words.js'
import { ACCOUNT as W } from '../words/account.jsx'
import { api } from '../data/api.js'
import { ahead, known } from '../data/ahead.js'
import { chimeOn, setChime } from '../data/chime.js'
import { Hairline, Panel, SectionHead, Select, Switch } from './kit.jsx'
import { Line } from './account/line.jsx'
import { zones, OnThisDevice } from './account/sessions.jsx'
export { Face } from './account/face.jsx'
export { Tokens, SecondFactor } from './account/security.jsx'
export { deviceOf, Sessions, warmPush, pushKnown } from './account/sessions.jsx'
export { YourData } from './account/yourData.jsx'

export type Token = {
  id: string
  name: string
  project_ids: string[]
  created_at: string
  last_used_at: string | null
  expires_at: string | null
  revoked_at: string | null
}
/** `proof`: what turning it on or off asks — the password, or a code from the inbox. */
export type Factor = { enabled: boolean; recovery_left: number; proof?: 'password' | 'email' }

export const day = (s: string | null) => (s ? s.slice(0, 10) : '—')

export const field = 'h-8 rounded-[var(--r-tile)] px-3 text-base outline-none placeholder:text-[var(--ink-3)]'
export const fieldStyle = { background: 'var(--sunken)', color: 'var(--ink)' }

/** What the account page is told about the address. */
export type Address = {
  email: string
  /** A change waiting on its link: to where, and whether the old address has said yes yet. */
  pending: { email: string; approve: boolean } | null
  /** What a change asks: what signing in asks, or — with neither — the current address. */
  asks: { password: boolean; code: boolean; inbox: boolean }
}

export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Which language the interface speaks.
 *
 * Here rather than in the top bar beside the theme: the theme is changed
 * when a room gets dark and the language is chosen once. A control used
 * once a year on the bar is a control in the way of the ones used hourly.
 *
 * Choosing reloads, because the words are read once when the module loads.
 * Half a screen in one language and half in another is worse than a flash
 * of white — `data/words.ts`.
 */
export function Tongue() {
  const [said, setSaid] = useState<Chosen>(readTongue)
  return (
    <section className="mt-9 flex flex-col gap-3">
      <SectionHead>{MORE.language}</SectionHead>
      {/* A line of the lists like every other setting here: what it is and
          a sentence on the left, the control on the right. */}
      <Panel>
        <Line label={W.interfaceLanguage} hint={W.notTranslated}>
          <Select
            label={W.interfaceLanguage}
            testId="tongue"
            value={said}
            onPick={(to) => {
              setSaid(to)
              /* Told to the account first, so the mail and the pushes speak
                 it as well; then the page is built again in it. */
              void api('/me', { method: 'PATCH', body: JSON.stringify({ language: to === 'system' ? null : to }) })
                .catch(() => {})
                .finally(() => chooseTongue(to))
            }}
            options={TONGUES.map((t) => ({ id: t.id, label: t.said }))}
          />
        </Line>
      </Panel>
    </section>
  )
}

type Notify = {
  notify_chat: boolean
  /** The day's email of what was not read — `docs/specs/notifications.md`. */
  email_digest?: boolean
  quiet_from: string | null
  quiet_to: string | null
  timezone: string
}

/**
 * When to be left alone.
 *
 * Quiet hours and the chat switch were built, tested and documented, and
 * there was only a way to write them — no way to read them back, so a form
 * would have shown the defaults every time and quietly lost whatever was
 * chosen last.
 */
export function Notifications() {
  const [it, setIt] = useState<Notify | null>(() => known<Notify>('/inbox/settings'))
  const [sound, setSound] = useState(chimeOn)

  const load = useCallback(async () => {
    setIt(await ahead<Notify>('/inbox/settings'))
  }, [])
  useEffect(() => void load(), [load])

  async function patch(change: Partial<Notify>) {
    setIt((prev) => (prev ? { ...prev, ...change } : prev))
    await api('/inbox/settings', { method: 'PATCH', body: JSON.stringify(change) })
  }

  if (!it) return null

  return (
    <section className="mt-9 flex flex-col gap-3">
      <SectionHead>{HEADS.notifications}</SectionHead>
      <Panel>
        <Line label={W.chat} hint={SAYS.tellMeAboutChat}>
          <Switch on={it.notify_chat} testId="notify-chat" said={SAYS.tellMeAboutChat} onChange={(on) => void patch({ notify_chat: on })} />
        </Line>
        <Hairline inset={16} />
        {/* The one switch the email adds: a product that mails you has to
            let you stop it. `docs/specs/notifications.md`. */}
        <Line label={W.emailDigest} hint={W.digestHint}>
          <Switch
            on={it.email_digest ?? true}
            testId="email-digest"
            said={W.emailMeWhatIMissed}
            onChange={(on) => void patch({ email_digest: on })}
          />
        </Line>
        <Hairline inset={16} />
        {/* A sound for a new message — on this device, like the theme.
            `docs/specs/chime.md`. */}
        <Line label={W.sound} hint={W.soundHint}>
          <Switch
            on={sound}
            testId="chime"
            said={W.playSound}
            onChange={(on) => {
              setChime(on)
              setSound(on)
            }}
          />
        </Line>
        <Hairline inset={16} />
        <Line label={W.quietHours} hint={W.quietHint} wrap>
          <input
            type="time"
            data-testid="quiet-from"
            aria-label={HEADS.quietFrom}
            className={field}
            style={fieldStyle}
            value={it.quiet_from?.slice(0, 5) ?? ''}
            onChange={(e) => void patch({ quiet_from: e.target.value || null })}
          />
          <span className="text-sm text-ink-3">{W.to}</span>
          <input
            type="time"
            data-testid="quiet-to"
            aria-label={W.quietUntil}
            className={field}
            style={fieldStyle}
            value={it.quiet_to?.slice(0, 5) ?? ''}
            onChange={(e) => void patch({ quiet_to: e.target.value || null })}
          />
          {/* Chosen from the zones there are, not typed: "Europe/Paris" is
              not a thing anybody spells right first time, and a zone the
              server does not know was a quiet hour that never came. */}
          <select
            data-testid="timezone"
            aria-label={W.timeZone}
            className={`${field} w-full cursor-pointer sm:w-[200px]`}
            style={fieldStyle}
            value={it.timezone ?? 'UTC'}
            onChange={(e) => {
              setIt({ ...it, timezone: e.target.value })
              void patch({ timezone: e.target.value })
            }}
          >
            {zones(it.timezone).map((z) => (
              <option key={z.id} value={z.id}>
                {z.label}
              </option>
            ))}
          </select>
        </Line>
        <Hairline inset={16} />
        <OnThisDevice />
      </Panel>
    </section>
  )
}

export type Erasure = {
  ok: boolean
  why?: string
  alone?: { id: string; name: string }[]
  blocked?: { id: string; name: string; people: number }[]
  leaves?: { id: string; name: string }[]
  asks?: 'password' | 'password_and_code' | 'email'
}
