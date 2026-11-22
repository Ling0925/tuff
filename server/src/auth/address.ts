import { asAuth } from '../db.js'
import { letter, send } from '../mail.js'
import { edition } from '../edition.js'
import { spendOn } from '../http/limits.js'
import { randomInt } from 'node:crypto'
import { generateToken, hashToken, verifyPassword } from './crypto.js'
import { secondFactor } from './flows.js'
import { languageFor, say, type Language } from '../words.js'

/**
 * A person's address, changed by them.
 *
 * Three things have to be true before an account answers to another
 * address: it is the person asking, not whoever has their unlocked laptop;
 * the new address is theirs; and the old one is told when it is done. The
 * routes that ask are `http/address.ts`. The links open `/verify/<token>`,
 * which reads what a link is about and changes nothing; a press changes it
 * — the old address's yes through `/auth/verify`, the new address's
 * confirmation through `/api/me/email/confirm`, from the account's own
 * session.
 *
 * Nothing here says whether an address already has an account. The window
 * says the same thing for every address, and an address that is taken is
 * told so in its own inbox — the rule sign-up keeps.
 *
 * Each mail is in its reader's language. `screen`
 * is the language of the screen that asked, for an account that never said
 * one: the person reading is the person who pressed the button, except for
 * the note to an address that belongs to somebody else, which is theirs.
 */

/** What a change asks of this account: what signing in asks. */
export type Asks = { password: boolean; code: boolean }

export async function asksOf(actorId: string): Promise<Asks> {
  const [r] = await asAuth(
    (tx) => tx<{ password: boolean; code: boolean }[]>`
      select password_hash is not null as password, totp_enabled as code
      from auth_lookup_user(auth_email_of(${actorId}))`,
  )
  return { password: Boolean(r?.password), code: Boolean(r?.code) }
}

/**
 * An account with neither — made through Google or Apple, never given a
 * password — has nothing to ask on the screen, so its current address is
 * asked instead: a link goes there, and following it is the yes.
 */
export const byInbox = (a: Asks) => !a.password && !a.code

/** Where its mail goes now, and the change waiting on a link, if any. */
export async function emailOf(actorId: string): Promise<{ email: string; pending: { kind: 'approve' | 'email'; email: string } | null }> {
  const [r] = await asAuth(
    (tx) => tx<{ email: string; kind: 'approve' | 'email' | null; pending: string | null }[]>`
      select auth_email_of(${actorId}) as email, p.kind, p.email as pending
      from (select 1) one left join auth_email_pending(${actorId}) p on true`,
  )
  return {
    email: r?.email ?? '',
    pending: r?.kind && r.pending ? { kind: r.kind, email: r.pending } : null,
  }
}

/** Whether what was typed answers what the account asks. */
export async function itIsThem(
  actorId: string,
  email: string,
  asks: Asks,
  given: { password?: string | undefined; code?: string | undefined },
): Promise<boolean> {
  if (asks.password) {
    const [r] = await asAuth((tx) => tx<{ hash: string | null }[]>`select auth_password_hash(${actorId}) as hash`)
    if (!r?.hash || !given.password || !(await verifyPassword(given.password, r.hash))) return false
  }
  if (asks.code) {
    if (!given.code || !(await secondFactor(actorId, email, given.code))) return false
  }
  return true
}

/** What six digits from the inbox were sent for — each is no other's yes. */
export type Purpose = 'leave' | 'ways' | 'twofa' | 'twofa-off' | 'mail'

/**
 * Six digits to the inbox of an account with nothing to type, for the two
 * things that cannot be taken back — deleting it and handing a workspace
 * over. A session alone is a laptop left open; the inbox is the person.
 * Ten minutes, once; five an hour. Scoped to the account, so a code is
 * nobody else's yes.
 */
export async function mailCode(
  base: string,
  actorId: string,
  email: string,
  screen: Language = 'en',
  /** What it is for, said in the mail: `ways` is adding or removing a way to
      sign in, `twofa` turning on two-factor authentication. */
  purpose: Purpose = 'leave',
): Promise<boolean> {
  const [n] = await asAuth((tx) => tx<{ n: number }[]>`select auth_ticket_recent(${actorId}, 'reauth') as n`)
  if ((n?.n ?? 0) >= 5) return false
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
  await asAuth(
    (tx) =>
      tx`select auth_ticket_make(${hashToken(`${actorId}:${purpose}:${code}`)}, 'reauth', ${actorId}, ${null}, interval '10 minutes')`,
  )
  const language = await languageFor(actorId, screen)
  const w = say(
    {
      subject: [`${code} is your Tuff code`, `${code} est votre code Tuff`],
      code: [`Your code is ${code}. It works for ten minutes.`, `Votre code est ${code}. Il est valable dix minutes.`],
      who:
        purpose === 'twofa-off'
          ? [
              'Someone signed in to your Tuff account asked to turn off two-factor authentication. If this wasn’t you, don’t share the code, and sign out your other devices from your account.',
              'Une personne connectée à votre compte Tuff a demandé à désactiver l’authentification à deux facteurs. Si ce n’était pas vous, ne communiquez pas ce code et déconnectez vos autres appareils depuis votre compte.',
            ]
          : purpose === 'twofa'
            ? [
                'Someone signed in to your Tuff account asked to turn on two-factor authentication. If this wasn’t you, don’t share the code, and sign out your other devices from your account.',
                'Une personne connectée à votre compte Tuff a demandé à activer l’authentification à deux facteurs. Si ce n’était pas vous, ne communiquez pas ce code et déconnectez vos autres appareils depuis votre compte.',
              ]
            : purpose === 'ways'
              ? [
                  'Someone signed in to your Tuff account asked to add or remove a way to sign in. If this wasn’t you, don’t share the code, and sign out your other devices from your account.',
                  'Une personne connectée à votre compte Tuff a demandé à ajouter ou à retirer un moyen de connexion. Si ce n’était pas vous, ne communiquez pas ce code et déconnectez vos autres appareils depuis votre compte.',
                ]
              : purpose === 'mail'
                ? [
                    'Someone signed in to your Tuff account asked to change how this server sends email. If this wasn’t you, don’t share the code, and sign out your other devices from your account.',
                    'Une personne connectée à votre compte Tuff a demandé à modifier la façon dont ce serveur envoie les e-mails. Si ce n’était pas vous, ne communiquez pas ce code et déconnectez vos autres appareils depuis votre compte.',
                  ]
                : [
                    'Someone signed in to your Tuff account asked to delete it or to hand a workspace over. If this wasn’t you, don’t share the code, and sign out your other devices from your account.',
                    'Une personne connectée à votre compte Tuff a demandé à le supprimer ou à transférer un espace de travail. Si ce n’était pas vous, ne communiquez pas ce code et déconnectez vos autres appareils depuis votre compte.',
                  ],
      open: ['Open Tuff', 'Ouvrir Tuff'],
    },
    language,
  )
  await send({
    to: email,
    subject: w.subject,
    ...letter([w.code, w.who], { label: w.open, url: base }, language),
  })
  return true
}

/**
 * Told to the address when the second factor is turned on, with the way
 * back if it was not them: a reset by mail in the next seven days takes it
 * off again (`auth_set_password`, migration 242).
 */
export async function tellFactorOn(base: string, actorId: string, screen: Language = 'en'): Promise<void> {
  const email = (await emailOf(actorId)).email
  if (!email) return
  const language = await languageFor(actorId, screen)
  const w = say(
    {
      subject: [
        'Two-factor authentication is on for your Tuff account',
        'L’authentification à deux facteurs est activée sur votre compte Tuff',
      ],
      what: [
        'Signing in to your Tuff account now asks for a code from an authenticator app.',
        'La connexion à votre compte Tuff demande maintenant un code d’une application d’authentification.',
      ],
      then: [
        'If this wasn’t you, reset your password from the sign-in page within seven days. That turns two-factor authentication off and signs everyone out.',
        'Si ce n’était pas vous, réinitialisez votre mot de passe depuis la page de connexion dans les sept jours. Cela désactive l’authentification à deux facteurs et déconnecte tout le monde.',
      ],
      open: ['Open Tuff', 'Ouvrir Tuff'],
    },
    language,
  )
  await send({ to: email, subject: w.subject, ...letter([w.what, w.then], { label: w.open, url: base }, language) })
}

const PROVIDER_NAMES = { google: 'Google', apple: 'Apple', github: 'GitHub' } as const

/**
 * Told to the address whenever a way to sign in is added or removed:
 * which provider, and which account there. Not
 * waited for.
 */
export async function tellWayIn(
  base: string,
  actorId: string,
  what: 'added' | 'removed',
  provider: string,
  there: string | null,
): Promise<void> {
  const email = (await emailOf(actorId)).email
  if (!email) return
  const name = PROVIDER_NAMES[provider as keyof typeof PROVIDER_NAMES] ?? provider
  const as = there ? ` (${there})` : ''
  const language = await languageFor(actorId)
  const w = say(
    {
      subject:
        what === 'added'
          ? [`${name} can now sign in to your Tuff account`, `${name} peut maintenant vous connecter à votre compte Tuff`]
          : [`${name} was removed from your Tuff account`, `${name} a été retiré de votre compte Tuff`],
      what:
        what === 'added'
          ? [
              `${name}${as} was added as a way to sign in to your Tuff account.`,
              `${name}${as} a été ajouté comme moyen de connexion à votre compte Tuff.`,
            ]
          : [`${name}${as} can no longer sign in to your Tuff account.`, `${name}${as} ne peut plus vous connecter à votre compte Tuff.`],
      then: [
        'If this wasn’t you, change your password and sign out your other devices from your account settings.',
        'Si ce n’était pas vous, changez votre mot de passe et déconnectez vos autres appareils depuis les paramètres de votre compte.',
      ],
      open: ['Open Tuff', 'Ouvrir Tuff'],
    },
    language,
  )
  void send({ to: email, subject: w.subject, ...letter([w.what, w.then], { label: w.open, url: base }, language) }).catch(() => {})
}

/**
 * Whether a code from the inbox is this account's and was sent for this,
 * spending it. A code the mail said was for a way to sign in does not
 * delete the account: what the mail says is the owner's only warning.
 */
export async function codeFromInbox(actorId: string, code: string | undefined, purpose: Purpose = 'leave'): Promise<boolean> {
  const digits = (code ?? '').replace(/\s/g, '')
  if (!/^\d{6}$/.test(digits)) return false
  const [r] = await asAuth(
    (tx) => tx<{ ok: boolean }[]>`select auth_ticket_spend(${hashToken(`${actorId}:${purpose}:${digits}`)}, 'reauth') as ok`,
  )
  return Boolean(r?.ok)
}

/** `a…@example.com`: enough for its owner to know it, not enough to write to. */
export function masked(email: string): string {
  const [who = '', at = ''] = email.split('@')
  return `${who.slice(0, 1)}…@${at}`
}

const link = (base: string, token: string) => `${base}/verify/${encodeURIComponent(token)}`

/**
 * The link to the new address, which is what makes the change. A day, once.
 *
 * An address with an account of its own is sent a note instead, and the
 * ticket is made all the same and never sent: the screen goes on saying a
 * link is waiting there, as it would for any address.
 */
export async function sendToNew(base: string, actorId: string, to: string, screen: Language = 'en'): Promise<void> {
  const token = generateToken('eml')
  await asAuth((tx) => tx`select auth_email_ticket(${hashToken(token)}, 'email', ${actorId}, ${to}, interval '1 day')`)
  const [taken] = await asAuth((tx) => tx<{ actor_id: string }[]>`select actor_id from auth_lookup_user(${to})`)
  if (taken) {
    // Three an hour to one address, so this is not a way to fill an inbox.
    if (!(await spendOn(`mail:taken:${to}`, 3, 3600))) return
    /* Read by whoever has that account, in their language and not in the
       asker's screen's. */
    const language = await languageFor(taken.actor_id)
    const w = say(
      {
        subject: [
          'Someone tried to use this email for another Tuff account',
          'Quelqu’un a essayé d’utiliser cette adresse pour un autre compte Tuff',
        ],
        what: [
          'Someone asked to change the email of a Tuff account to this address. This address already has an account, so nothing changed.',
          'Quelqu’un a demandé à remplacer l’adresse e-mail d’un compte Tuff par celle-ci. Un compte existe déjà avec cette adresse, donc rien n’a changé.',
        ],
        then: [
          'If you meant to use this address, sign in with it instead. If this wasn’t you, you don’t need to do anything.',
          'Si vous vouliez utiliser cette adresse, connectez-vous plutôt avec elle. Si ce n’était pas vous, vous n’avez rien à faire.',
        ],
        signIn: ['Sign in', 'Se connecter'],
      },
      language,
    )
    await send({
      to,
      subject: w.subject,
      ...letter([w.what, w.then], { label: w.signIn, url: `${base}/signin` }, language),
    })
    return
  }
  const language = await languageFor(actorId, screen)
  const w = say(
    {
      subject: ['Confirm your new email for Tuff', 'Confirmez votre nouvelle adresse e-mail pour Tuff'],
      what: [
        'Someone asked to change the email of a Tuff account to this address.',
        'Quelqu’un a demandé à remplacer l’adresse e-mail d’un compte Tuff par celle-ci.',
      ],
      then: [
        'Confirm the change to sign in with this address from now on. The link expires in 24 hours. If this wasn’t you, ignore this email and nothing will change.',
        'Confirmez le changement pour vous connecter désormais avec cette adresse. Le lien expire dans 24 heures. Si ce n’était pas vous, ignorez cet e-mail et rien ne changera.',
      ],
      confirm: ['Confirm the new email', 'Confirmer la nouvelle adresse'],
    },
    language,
  )
  await send({
    to,
    subject: w.subject,
    ...letter([w.what, w.then], { label: w.confirm, url: link(base, token) }, language),
  })
}

/** For an account with nothing to type: its current address says yes first. */
export async function sendForApproval(base: string, actorId: string, current: string, to: string, screen: Language = 'en'): Promise<void> {
  const token = generateToken('apv')
  await asAuth((tx) => tx`select auth_email_ticket(${hashToken(token)}, 'approve', ${actorId}, ${to}, interval '1 day')`)
  const language = await languageFor(actorId, screen)
  const w = say(
    {
      subject: ['Approve a new email for your Tuff account', 'Approuvez une nouvelle adresse e-mail pour votre compte Tuff'],
      what: [
        `Someone signed in to your Tuff account asked to change its email to ${to}.`,
        `Une personne connectée à votre compte Tuff a demandé à remplacer son adresse e-mail par ${to}.`,
      ],
      then: [
        'If this was you, approve the change and we’ll send a link to the new address to finish. If it wasn’t you, ignore this email and nothing will change. Then go to Account and sign out any devices that aren’t yours.',
        'Si c’était vous, approuvez le changement et nous enverrons un lien à la nouvelle adresse pour terminer. Si ce n’était pas vous, ignorez cet e-mail et rien ne changera. Allez ensuite dans Compte et déconnectez les appareils qui ne sont pas les vôtres.',
      ],
      approve: ['Approve the change', 'Approuver le changement'],
    },
    language,
  )
  await send({
    to: current,
    subject: w.subject,
    ...letter([w.what, w.then], { label: w.approve, url: link(base, token) }, language),
  })
}

/**
 * What a link from either mail is about, read and nothing more: which
 * kind, the address it moves to, and the account it moves — its name and
 * its address now — so the page can say what a press would do before
 * anybody presses.
 * Opening the link changes nothing. Null when the token is not one of
 * these, or is spent or out of time.
 */
export async function peekLink(
  token: string,
): Promise<{ kind: 'approve' | 'email'; actorId: string; email: string; name: string; current: string } | null> {
  const [t] = await asAuth(
    (tx) => tx<{ kind: 'approve' | 'email'; actor_id: string; email: string }[]>`
      select * from auth_email_ticket_peek(${hashToken(token)})`,
  )
  if (!t) return null
  const [who] = await asAuth((tx) => tx<{ name: string; email: string }[]>`select name, email from auth_nowhere(${t.actor_id})`)
  if (!who) return null
  return { kind: t.kind, actorId: t.actor_id, email: t.email, name: who.name, current: who.email }
}

/**
 * The old address's yes, pressed: the link goes to the new one. The inbox
 * it was mailed to is the account — it is how an account with nothing to
 * type proves it is the person — so no session is asked; and it changes
 * nothing yet, since the new address is still confirmed from the account.
 * Null when the token is not an approval still good.
 */
export async function approveLink(base: string, token: string, screen: Language = 'en'): Promise<{ email: string } | null> {
  const hash = hashToken(token)
  const [t] = await asAuth(
    (tx) => tx<{ kind: 'approve' | 'email'; actor_id: string; email: string }[]>`
      select * from auth_email_ticket_peek(${hash})`,
  )
  if (t?.kind !== 'approve') return null
  const [spent] = await asAuth((tx) => tx<{ ok: boolean }[]>`select auth_ticket_spend(${hash}, 'approve') as ok`)
  if (!spent?.ok) return null
  await sendToNew(base, t.actor_id, t.email, screen)
  return { email: t.email }
}

/**
 * The new address confirmed, pressed in a browser signed in to the account
 * the change belongs to. `session` is the id of the session that
 * pressed; the database makes the change only when it is that account's
 * and has not ended (`auth_email_confirm`, migration 316), and otherwise
 * answers `not_this_account` and leaves the link unspent, so the person
 * can sign in to the right account and press again.
 *
 * Opening the link proved the inbox and nothing about who asked: Mallory
 * asked to move her own account to Bob's address, Bob's page confirmed it
 * as it loaded, and his Google sign-in later landed in the account she
 * still held.
 *
 * A confirmation makes the change and tells the old address.
 */
export async function confirmLink(
  base: string,
  token: string,
  session: string,
  screen: Language = 'en',
): Promise<{ kind: 'changed' | 'taken' | 'gone' | 'not_this_account'; email: string }> {
  const [r] = await asAuth(
    (tx) => tx<{ said: string; actor_id: string | null; email: string | null; old: string | null }[]>`
      select * from auth_email_confirm(${hashToken(token)}, ${session}::uuid)`,
  )
  if (r?.said === 'not_this_account') return { kind: 'not_this_account', email: '' }
  if (r?.said === 'taken') return { kind: 'taken', email: r.email ?? '' }
  if (r?.said !== 'changed' || !r.actor_id || !r.email) return { kind: 'gone', email: '' }
  const t = { actor_id: r.actor_id, email: r.email }
  const old = r.old ?? ''
  /* A Google sign-in made under the old address goes with it: the company
     that owns that inbox owns that Google account too, and hands both to
     whoever comes next — migration 151. */
  if (old) await asAuth((tx) => tx`select auth_identity_forget(${t.actor_id}, ${old})`)
  if (old && old.toLowerCase() !== t.email.toLowerCase()) {
    /* Told after, not asked before: the new address proved itself, and the
       old one is where somebody would first notice a change they did not
       make. There is no button that puts it back — people change address
       because they left the old one, and a company's inbox stays the
       company's. */
    const language = await languageFor(t.actor_id, screen)
    const support = edition.vendor?.support ?? null
    const w = say(
      {
        subject: ['Your Tuff email was changed', 'L’adresse e-mail de votre compte Tuff a été modifiée'],
        what: [
          `The email for your Tuff account was changed to ${masked(t.email)}.`,
          `L’adresse e-mail de votre compte Tuff a été remplacée par ${masked(t.email)}.`,
        ],
        /* The service's own address, or on your own server its owner — `edition.vendor`. */
        then: support
          ? [
              `If this was you, you don’t need to do anything. If it wasn’t, email ${support} from this address and we’ll change it back.`,
              `Si c’était vous, vous n’avez rien à faire. Sinon, écrivez à ${support} depuis cette adresse et nous rétablirons l’ancienne.`,
            ]
          : [
              'If this was you, you don’t need to do anything. If it wasn’t, tell the owner of this server.',
              'Si c’était vous, vous n’avez rien à faire. Sinon, prévenez le propriétaire de ce serveur.',
            ],
        signIn: ['Sign in', 'Se connecter'],
      },
      language,
    )
    await send({
      to: old,
      subject: w.subject,
      ...letter([w.what, w.then], { label: w.signIn, url: `${base}/signin` }, language),
    })
  }
  return { kind: 'changed', email: t.email }
}
