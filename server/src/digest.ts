import { edition } from './edition.js'
import { keyFor, mac, rootSecret, same } from './auth/keys.js'
import { asWorker } from './db.js'
import { brandOf, type Brand } from './brand.js'
import { about, type Due } from './push.js'
import { send } from './mail.js'
import { LINES, remind, remindChosen, shortDay } from './notify.js'
import { env } from './env.js'
import { languageFor, one, say, type Language } from './words.js'

/**
 * What runs on a clock rather than on a request — `docs/specs/notifications.md`.
 *
 * A reminder of a date, and one email a day with what was not read. Both
 * claim what they do before they do it, so two workers do not send twice.
 */

/* ------------------------------------------------------------- reminders */

export async function remindDue(): Promise<number> {
  const due = await asWorker(
    (tx) =>
      tx<{ workspace_id: string; actor_id: string; task_id: string; kind: 'soon' | 'late'; due_on: string | Date }[]>`
      select * from claim_due_reminders()`,
  )
  for (const r of due) {
    /* Written in the language of the person reminded, which `remind` asks
       as them. */
    const line = (l: Language) => (r.kind === 'soon' ? LINES(l).dueTomorrow : LINES(l).overdue(shortDay(r.due_on, l)))
    await remind(r.workspace_id, r.actor_id, r.task_id, line, r.kind === 'soon' ? 'due' : 'overdue').catch((e) =>
      console.error('worker: a reminder failed', e),
    )
  }
  return due.length
}

/**
 * Reminders people set for themselves, whose moment has come.
 * Claimed by removing them, so two workers send
 * each once; then each is asked as its person whether it is still worth
 * sending. Answers how many were sent.
 */
export async function remindChosenDue(limit = 200): Promise<number> {
  const due = await asWorker(
    (tx) =>
      tx<{ workspace_id: string; actor_id: string; task_id: string }[]>`
      select workspace_id, actor_id, task_id from claim_task_reminders(${limit})`,
  )
  let sent = 0
  for (const r of due) {
    if (await remindChosen(r.workspace_id, r.actor_id, r.task_id)) sent += 1
  }
  return sent
}

/* ---------------------------------------------------------------- digest */

/** The link at the foot of a digest that turns it off, for this person only. */
export function digestOffLink(actorId: string): string {
  return `${env.appUrl}/digest/off?u=${actorId}&t=${mac(keyFor('digest-off'), `digest.off.${actorId}`, 'hex')}`
}

/*
 * Its own key — `auth/keys.ts`; and, with no end date, a link from a
 * digest mailed before the split. A stop link in a mail must keep working
 * as long as the mail is kept (RFC 8058's one-click, which Gmail and
 * Yahoo hold bulk senders to), and the old secret is safe to keep here
 * alone: the message is fixed as `digest.off.<uuid>`, which nothing else
 * the secret signed could be, and a file link's expiry must be a number,
 * so this signature is no file link either.
 */
export function digestOffValid(actorId: string, token: string): boolean {
  const message = `digest.off.${actorId}`
  if (same(mac(keyFor('digest-off'), message, 'hex'), token)) return true
  return /^[0-9a-f-]{36}$/i.test(actorId) && same(mac(rootSecret(), message, 'hex'), token)
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

type Item = { workspace: string; title: string; line: string; url: string }

/**
 * The letter. `brand` is a branded workspace's name, when every note in it
 * is that workspace's (`brandOfDigest`): it heads the letter and signs it,
 * the subject says no product, and "more" is in the workspace. Without it,
 * the letter is Tuff's, as it always was.
 */
export function digestLetter(
  name: string,
  items: Item[],
  more: number,
  off: string,
  language: Language = 'en',
  brand: string | null = null,
): { subject: string; text: string; html: string } {
  const w = say(
    {
      subject: [
        (n: number) => (n === 1 ? 'One thing is waiting for you on Tuff' : `${n} things are waiting for you on Tuff`),
        (n: number) => (one(n, 'fr') ? 'Un élément vous attend sur Tuff' : `${n} éléments vous attendent sur Tuff`),
        (n: number) => `Tuff 上有 ${n} 项待处理事项`,
      ],
      /* A workspace's name is never in a subject: it is what anybody who
         wanted to look like somebody else would choose. */
      subjectBranded: [
        (n: number) => (n === 1 ? 'One thing is waiting for you' : `${n} things are waiting for you`),
        (n: number) => (one(n, 'fr') ? 'Un élément vous attend' : `${n} éléments vous attendent`),
        (n: number) => `有 ${n} 项待处理事项`,
      ],
      hi: [
        (name: string) => `Hi ${name}, this is what you haven’t read yet.`,
        (name: string) => `Bonjour ${name}, voici ce que vous n’avez pas encore lu.`,
        (name: string) => `${name}，你好，这是你尚未阅读的内容。`,
      ],
      more: [
        (n: number, where: string) => `And ${n} more in ${where}.`,
        (n: number, where: string) => `Et ${n} de plus dans ${where}.`,
        (n: number, where: string) => `${where} 中还有 ${n} 项。`,
      ],
      stop: ['Stop these emails', 'Ne plus recevoir ces e-mails', '停止接收这些邮件'],
      colon: [':', ' :', '：'],
      daily: [
        'One email a day, for what you haven’t read.',
        'Un e-mail par jour, pour ce que vous n’avez pas lu.',
        '每天一封邮件，汇总你尚未阅读的内容。',
      ],
    },
    language,
  )
  const subject = (brand ? w.subjectBranded : w.subject)(items.length + more)
  const signed = brand ?? 'Tuff'
  const groups = new Map<string, Item[]>()
  for (const i of items) groups.set(i.workspace, [...(groups.get(i.workspace) ?? []), i])
  const text = [
    w.hi(name),
    '',
    ...[...groups].flatMap(([ws, xs]) => [ws, ...xs.map((x) => `- ${x.title} — ${x.line}: ${x.url}`), '']),
    ...(more ? [w.more(more, signed), ''] : []),
    `${w.stop}${w.colon} ${off}`,
    '',
    `— ${signed}`,
  ].join('\n')
  const html = `<!doctype html><html${language === 'en' ? '' : ` lang="${language}"`}><body style="margin:0;background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:40px 16px">
<table width="480" cellpadding="0" cellspacing="0" style="max-width:480px;background:#fff;border-radius:16px;padding:32px">
<tr><td style="font-size:17px;font-weight:600;color:#1d1d1f;padding-bottom:16px">${esc(signed)}</td></tr>
<tr><td style="font-size:15px;line-height:1.5;color:#3a3a3c;padding-bottom:8px">${esc(w.hi(name))}</td></tr>
${[...groups]
  .map(
    ([ws, xs]) =>
      `<tr><td style="font-size:12px;font-weight:600;color:#8e8e93;padding:16px 0 4px">${esc(ws)}</td></tr>` +
      xs
        .map(
          (x) =>
            `<tr><td style="padding:8px 0;border-bottom:1px solid #e5e5ea"><a href="${esc(x.url)}" style="font-size:15px;color:#1d1d1f;text-decoration:none;font-weight:500">${esc(x.title)}</a><div style="font-size:13px;color:#8e8e93;padding-top:2px">${esc(x.line)}</div></td></tr>`,
        )
        .join(''),
  )
  .join('')}
${more ? `<tr><td style="font-size:13px;color:#8e8e93;padding-top:12px">${esc(w.more(more, signed))}</td></tr>` : ''}
<tr><td style="font-size:12px;color:#8e8e93;padding-top:24px">${esc(w.daily)} <a href="${esc(off)}" style="color:#8e8e93">${esc(w.stop)}</a>.</td></tr>
</table></td></tr></table></body></html>`
  return { subject, text, html }
}

/**
 * A digest's brand: only when every note it claimed — those it lists and
 * those it counts as more — is one workspace's, and that workspace wears
 * its own name. A letter from "Acme" listing another company's work would
 * be Acme speaking for somebody else.
 */
export async function brandOfDigest(workspaceIds: string[]): Promise<Brand | null> {
  const places = new Set(workspaceIds)
  if (places.size !== 1) return null
  const [only] = places
  return asWorker((tx) => brandOf(tx, only!))
}

export async function sendDigests(): Promise<number> {
  if (!env.appUrl) return 0
  const owed = await asWorker((tx) => tx<{ actor_id: string; email: string; name: string }[]>`select * from digest_due()`)
  let sent = 0
  for (const person of owed) {
    try {
      const notes = await asWorker(
        (tx) => tx<(Due & { workspace_name: string; workspace_slug: string })[]>`select * from digest_claim(${person.actor_id})`,
      )
      /* Each read as the person, as a push is: what they may no longer see
         is not mailed to them. And in their language, as a push is. */
      const language = await languageFor(person.actor_id)
      const items: Item[] = []
      let more = 0
      for (const n of notes) {
        const told = await about({ ...n, actor_id: person.actor_id }, language)
        if (!told) continue
        if (items.length >= 10) {
          more += 1
          continue
        }
        items.push({ workspace: n.workspace_name, title: told.title, line: told.body ?? '', url: `${env.appUrl}${told.url}` })
      }
      if (!items.length) continue
      const off = digestOffLink(person.actor_id)
      const brand = await brandOfDigest(notes.map((n) => n.workspace_id))
      /* Only one workspace's notes, and it wears its own name: its links go
         to its own domain when it has one. */
      const own = brand && edition.hosts ? await asWorker((tx) => edition.hosts!.originOf(tx, notes[0]!.workspace_id)) : null
      if (own) for (const it of items) if (it.url.startsWith(`${env.appUrl}/`)) it.url = own + it.url.slice(env.appUrl.length)
      const mail = digestLetter(person.name, items, more, off, language, brand?.name ?? null)
      /* From "Acme" alone, where branded: a digest goes only to the
         workspace's own members, who chose to be mailed it. */
      /* The mail client's own "Unsubscribe" beside the sender, which it
         presses with a POST — RFC 8058 — rather than opening the link. */
      const headers = { 'List-Unsubscribe': `<${off}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' }
      if (await send({ to: person.email, ...mail, headers, ...(brand ? { via: brand.name, bare: true } : {}) })) sent += 1
    } catch (e) {
      console.error('worker: a digest failed', e)
    }
  }
  return sent
}
