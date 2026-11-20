/**
 * Sending a notification to a device.
 *
 * The queue has been here since `004_notifications.sql`, whose own comment
 * says "delivery is about push and email" — and nothing ever set
 * `delivered_at`. This is the end that was missing.
 *
 * No new dependency: VAPID is an ES256 JWT and `jose` is already here; the
 * payload encryption is ECDH on P-256, HKDF and AES-128-GCM, which is
 * `node:crypto`. The stack is fixed in the design and this does not move it.
 */
import { createECDH, createHmac, createCipheriv, randomBytes, createPrivateKey } from 'node:crypto'
import { SignJWT } from 'jose'
import { asWorker, withActor, withoutActor, type Tx } from './db.js'
import { chatWaiting } from './waiting.js'
import { pushService } from './outbound.js'
import { env } from './env.js'
import { edition } from './edition.js'
import { apnsConfigured, countToPhone, phones, sendToPhone, type Post } from './apns.js'
import { fcmConfigured, sendToAndroid, type Send } from './fcm.js'
import { languageFor, say, type Language } from './words.js'

/** How a push service reaches whoever runs this: `VAPID_SUBJECT`, else the service's own. None on your own server until it is given one. */
export const vapidSubject = (): string => env.vapidSubject || edition.vendor?.vapidSubject || ''

/** A browser can be written to: the deployment has its VAPID pair, and says who it is. */
export const webPushConfigured = (): boolean => Boolean(env.vapidPublicKey && env.vapidPrivateKey && vapidSubject())

/** Anything can be: a browser, one of the Apple apps — `apns.ts` — or the Android app — `fcm.ts`. */
export const pushConfigured = (): boolean => webPushConfigured() || apnsConfigured() || fcmConfigured()

/** A device's kind, as `push_subscription.kind` says it. */
export type DeviceKind = 'web' | 'apns' | 'fcm'

/** Whether this deployment has the keys to reach a device of [kind]. */
export const reachable = (kind: DeviceKind): boolean =>
  kind === 'apns' ? apnsConfigured() : kind === 'fcm' ? fcmConfigured() : webPushConfigured()

/* -------------------------------------------------------------- the crypto */

const b64 = (b: Buffer) => b.toString('base64url')

/** HKDF, the two-step form RFC 8291 spells out. */
function hkdf(salt: Buffer, ikm: Buffer, info: Buffer, length: number): Buffer {
  const prk = createHmac('sha256', salt).update(ikm).digest()
  return createHmac('sha256', prk)
    .update(Buffer.concat([info, Buffer.from([1])]))
    .digest()
    .subarray(0, length)
}

/**
 * The body, encrypted so that only the browser that subscribed can read it.
 *
 * `aes128gcm` — RFC 8188 for the framing, RFC 8291 for the key derivation.
 * The push service carries it and cannot open it, which is why a payload may
 * say what happened at all.
 */
function encrypt(payload: string, p256dh: string, auth: string): Buffer {
  const theirs = Buffer.from(p256dh, 'base64url')
  const authSecret = Buffer.from(auth, 'base64url')

  // Our half of the exchange, new for every message.
  const ours = createECDH('prime256v1')
  ours.generateKeys()
  const shared = ours.computeSecret(theirs)
  const ourPub = ours.getPublicKey()

  const salt = randomBytes(16)
  /* The key-derivation info carries both public keys, so a message encrypted
     for one subscription cannot be replayed at another. */
  const prkInfo = Buffer.concat([Buffer.from('WebPush: info\0'), theirs, ourPub])
  const ikm = hkdf(authSecret, shared, prkInfo, 32)
  const key = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16)
  const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12)

  const cipher = createCipheriv('aes-128-gcm', key, nonce)
  // The record ends with a 0x02 delimiter, which is what says "this is the
  // last one" in a format built for many.
  const body = Buffer.concat([Buffer.from(payload, 'utf8'), Buffer.from([0x02])])
  const sealed = Buffer.concat([cipher.update(body), cipher.final(), cipher.getAuthTag()])

  const header = Buffer.alloc(21)
  salt.copy(header, 0)
  header.writeUInt32BE(4096, 16)
  header.writeUInt8(ourPub.length, 20)
  return Buffer.concat([header, ourPub, sealed])
}

/**
 * The signature that says the message is from us.
 *
 * The audience is the origin of the push service, not ours: it is the party
 * checking it. Twelve hours because the services refuse anything longer, and
 * `sub` has to be a `mailto:` — Apple in particular refuses without one.
 */
async function vapid(endpoint: string): Promise<string> {
  const aud = new URL(endpoint).origin
  const key = createPrivateKey({
    key: {
      kty: 'EC',
      crv: 'P-256',
      d: env.vapidPrivateKey,
      x: b64(Buffer.from(env.vapidPublicKey, 'base64url').subarray(1, 33)),
      y: b64(Buffer.from(env.vapidPublicKey, 'base64url').subarray(33, 65)),
    },
    format: 'jwk',
  })
  return new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', typ: 'JWT' })
    .setAudience(aud)
    .setSubject(vapidSubject())
    .setExpirationTime('12h')
    .sign(key)
}

/* ------------------------------------------------------------- the sending */

export type Told = {
  title: string
  body?: string
  url: string
  tag?: string
  /**
   * Why it arrived, so a replacement can keep the stronger of two.
   *
   * Three things about one task collapse into one notification, which is
   * right — but the last one was winning, so "given to you" was being
   * replaced by "somebody mentioned you", and the one you had to act on was
   * the one that disappeared.
   */
  reason?: Due['reason']
  /**
   * What is unread, for the number on the icon.
   *
   * Sent with the message because the app is usually not running when one
   * lands — which is the whole reason the icon carries it. Counted at the
   * moment of sending rather than held anywhere: it is the same query the
   * inbox answers with.
   */
  unread?: number
}

/**
 * One message to one device.
 *
 * Answers what the push service said, because the caller has to tell a `410`
 * apart from a bad hour: one means the subscription is gone and the row with
 * it, the other means try again later.
 */
export async function sendTo(
  to: { endpoint: string; p256dh: string; auth: string },
  told: Told,
  fetchImpl: (url: string, init: RequestInit) => Promise<Response> = fetch,
): Promise<number> {
  const sealed = encrypt(JSON.stringify(told), to.p256dh, to.auth)
  const res = await fetchImpl(to.endpoint, {
    method: 'POST',
    headers: {
      authorization: `vapid t=${await vapid(to.endpoint)}, k=${env.vapidPublicKey}`,
      'content-encoding': 'aes128gcm',
      'content-type': 'application/octet-stream',
      // Long enough that a phone asleep for a weekend still hears about
      // Friday, short enough that nobody is told about a task that has since
      // been finished twice over.
      ttl: '86400',
      urgency: 'normal',
    },
    body: sealed,
  })
  return res.status
}

/* ------------------------------------------------------- what it is about */

export type Due = {
  id: string
  workspace_id: string
  actor_id: string
  reason:
    | 'mentioned'
    | 'assigned'
    | 'subscribed'
    | 'messaged'
    | 'joined'
    | 'posted'
    | 'replied'
    | 'due'
    | 'added'
    | 'shared'
    | 'reminder'
    | 'unblocked'
    | 'asked'
  object_type: 'post' | 'task' | 'file' | 'message' | 'conversation' | 'actor' | 'project'
  object_id: string
  /** What happened, in the product's words — `docs/specs/notifications.md`. */
  what?: string | null
}

/* Why, in the words of whoever it is for. A task
   is feminine, which is what is given to somebody. */
const WHY_SAID = {
  mentioned: ['Mentioned you', 'Vous a mentionné'],
  assigned: ['Assigned to you', 'Vous a été attribuée'],
  subscribed: ['New activity', 'Nouvelle activité'],
  messaged: ['Sent you a message', 'Vous a envoyé un message'],
  joined: ['Accepted your invitation', 'A accepté votre invitation'],
  posted: ['New announcement', 'Nouvelle annonce'],
  replied: ['Replied in a thread', 'A répondu dans un fil de discussion'],
  due: ['Due soon', 'Échéance proche'],
  added: ['Added you to a project', 'Vous a ajouté à un projet'],
  shared: ['Shared a document with you', 'A partagé un document avec vous'],
  reminder: ['Reminder', 'Rappel'],
  unblocked: ['Ready to start', 'Prête à commencer'],
  asked: ['Asked you a question', 'Vous pose une question'],
  /* What stands in for a title there is none of. */
  aMessage: ['A message', 'Un message'],
  something: ['Something', 'Sans titre'],
} as const satisfies Record<Due['reason'] | 'aMessage' | 'something', readonly [string, string]>
const why = (language: Language) => say<Record<keyof typeof WHY_SAID, string>>(WHY_SAID, language)

/**
 * The title of the thing and where it is — and not what anybody said.
 *
 * The payload is encrypted end to end, so the push service cannot read it;
 * a lock screen can, and what somebody wrote in a private channel is not ours
 * to put there. The title says what happened and where, and opening it is how
 * you read the rest.
 */
/**
 * Whether the person a push is for can still read what it is about, asked
 * as them. `push_about` reads as nobody, so somebody taken off a project —
 * or out of the workspace — went on being told the titles of its tasks on
 * their lock screen for as long as anybody touched them.
 */
async function stillSees(d: Due): Promise<boolean> {
  return withActor(d.actor_id, d.workspace_id, async (tx) => {
    if (d.object_type === 'message' || d.object_type === 'conversation') {
      const [r] = await tx<{ ok: boolean }[]>`select can_see_conversation(${d.object_id}) as ok`
      return r?.ok === true
    }
    const table = d.object_type === 'task' ? tx`task` : d.object_type === 'post' ? tx`post` : d.object_type === 'file' ? tx`file` : null
    if (!table) return false
    const [r] = await tx`select 1 from ${table} where id = ${d.object_id} and deleted_at is null`
    return Boolean(r)
  }).catch(() => false)
}

/**
 * `language` is the reader's, which is who `d.actor_id` is; asked for when
 * not given. The digest, writing ten of these to one person, says it once.
 */
export async function about(d: Due, language?: Language): Promise<Told | null> {
  const WHY = why(language ?? (await languageFor(d.actor_id)))
  /* Somebody who followed your invitation: their name, and their page —
     read as the person told, so somebody gone from the workspace since
     is told nothing. */
  if (d.object_type === 'actor') {
    const [row] = await withActor(
      d.actor_id,
      d.workspace_id,
      (tx) =>
        tx<{ name: string; slug: string }[]>`
        select a.name, w.slug from actor a, workspace w
        where a.id = ${d.object_id} and w.id = ${d.workspace_id} and a.deleted_at is null`,
    ).catch(() => [])
    if (!row) return null
    return {
      title: row.name,
      body: WHY.joined,
      reason: d.reason,
      url: `/${row.slug}/members/${d.object_id}`,
      tag: d.object_id,
    }
  }
  /* Put on a project: its name, and the project — read as the person told,
     so somebody taken off it since is told nothing. */
  if (d.object_type === 'project') {
    const [row] = await withActor(
      d.actor_id,
      d.workspace_id,
      (tx) =>
        tx<{ name: string; slug: string; ws: string }[]>`
        select p.name, p.slug::text, w.slug::text as ws from project p join workspace w on w.id = p.workspace_id
        where p.id = ${d.object_id} and p.deleted_at is null`,
    ).catch(() => [])
    if (!row) return null
    return { title: row.name, body: d.what ?? WHY.added, reason: d.reason, url: `/${row.ws}/${row.slug}`, tag: d.object_id }
  }
  if (!(await stillSees(d))) return null
  /*
   * Through a definer function, because the sender has no actor.
   *
   * Asked plainly, row-level security hides the task, the room and even the
   * workspace's own name from nobody — and the first version of this composed
   * a notification about nothing, every time, without a word. That is what
   * `subscribers` and `notify_prefs` were written for, and this is the third
   * time it has been the answer.
   */
  const [row] = await asWorker(
    (tx) =>
      tx<
        {
          workspace_slug: string
          title: string | null
          number: number | null
          project_slug: string | null
          project_key: string | null
          conversation: string | null
        }[]
      >`select * from push_about(${d.workspace_id}, ${d.object_type}::object_kind, ${d.object_id})`,
  )
  if (!row) return null

  if (d.object_type === 'message' || d.object_type === 'conversation') {
    if (!row.conversation) return null
    /* A direct message says who, read as its reader — who wrote last and
       is not them. Not what: a lock screen is not ours to write on. */
    if (d.reason === 'messaged') {
      const [who] = await withActor(
        d.actor_id,
        d.workspace_id,
        (tx) =>
          tx<{ name: string }[]>`
          select a.name from message m join actor a on a.id = m.author_id
          where m.conversation_id = ${d.object_id} and m.deleted_at is null and m.author_id <> ${d.actor_id}
          order by m.created_at desc limit 1`,
      ).catch(() => [])
      return {
        title: who?.name ?? WHY.aMessage,
        body: WHY.messaged,
        reason: d.reason,
        url: `/${row.workspace_slug}/chat/${row.conversation}`,
        tag: row.conversation,
      }
    }
    return {
      /* `push_about` answers a room with no name in English, as the
         stand-in it is; it is said here in the reader's. */
      title: row.title && row.title !== 'A message' ? `#${row.title}` : WHY.aMessage,
      body: d.what ?? WHY[d.reason],
      reason: d.reason,
      url: `/${row.workspace_slug}/chat/${row.conversation}`,
      tag: row.conversation,
    }
  }

  if (!row.project_slug || row.number === null) return null
  const tool = { post: 'posts', task: 'tasks', file: 'files' }[d.object_type as 'post' | 'task' | 'file']
  return {
    title: row.title ?? WHY.something,
    body: `${d.what ?? WHY[d.reason]} · ${row.project_key}-${row.number}`,
    reason: d.reason,
    url: `/${row.workspace_slug}/${row.project_slug}/${tool}/${row.number}`,
    tag: d.object_id,
  }
}

/**
 * Everything due, to every device its person has.
 *
 * `delivered_at` is stamped whatever the push service answered: it means the
 * sending was attempted and is done with, not that a screen lit up somewhere.
 * A service accepting a message is the last thing anybody can observe, and
 * building on a stronger claim is building on a fiction — which is also why
 * a failure does not queue a retry. The row is in the inbox either way.
 */
/* A push service is asked with ten seconds to answer, so one that hangs does
   not hold up everybody behind it — `outbound.ts`. */
const timed = (url: string, init: RequestInit) => fetch(url, { ...init, signal: AbortSignal.timeout(10_000) })

export async function pushDue(limit = 50, fetchImpl: typeof timed = timed, phoneImpl?: Post, androidImpl?: Send): Promise<number> {
  if (!pushConfigured()) return 0
  /* Connected on the first phone written to, closed when the pass is done. */
  const apple = phones()
  try {
    return await drain(limit, fetchImpl, phoneImpl ?? apple.post, androidImpl)
  } finally {
    apple.close()
  }
}

async function drain(limit: number, fetchImpl: typeof timed, toPhone: Post, toAndroid?: Send): Promise<number> {
  const due = await asWorker((tx) => tx<Due[]>`select * from due_notifications(${limit}, ${null})`)

  let sent = 0
  for (const d of due) {
    const told = await about(d)
    if (told) {
      told.unread = await unreadFor(d.workspace_id, d.actor_id)
      const targets = await asWorker(
        (tx) =>
          tx<{ id: string; kind: DeviceKind; endpoint: string; p256dh: string | null; auth: string | null }[]>`
          select * from push_targets(${d.workspace_id}, ${d.actor_id})`,
      )
      for (const to of targets) {
        /* An iPhone by Apple's service, an Android phone by Google's, a
           browser by its own; each only when this deployment has the keys
           for it. */
        const phone = to.kind === 'apns'
        if (!reachable(to.kind)) continue
        /* Only a push service is posted to — rows saved before that was
           asked are passed over rather than followed. `outbound.ts`. */
        if (to.kind === 'web' && !pushService(to.endpoint)) continue
        let status = 0
        try {
          status = phone
            ? await sendToPhone(to.endpoint, told, toPhone)
            : to.kind === 'fcm'
              ? await sendToAndroid(to.endpoint, told, toAndroid)
              : await sendTo({ endpoint: to.endpoint, p256dh: to.p256dh ?? '', auth: to.auth ?? '' }, told, fetchImpl)
        } catch {
          // A push service that cannot be reached is not a subscription that
          // is gone. Nothing is dropped and nothing is retried: the inbox
          // already has it.
          status = 0
        }
        if (status === 404 || status === 410) {
          await asWorker((tx) => tx`select push_subscription_gone(${to.id})`)
        } else if (status >= 200 && status < 300) {
          /*
           * When it was last written to, so the list of devices can say which
           * of them is still anybody's — a row unused for a year is a laptop
           * somebody left at an old job.
           *
           * Through a definer function, because this runs as nobody and the
           * update policy is `actor_id = current_actor()`. Written as a plain
           * statement first, it matched nothing and said nothing, and every
           * device looked as though it had never been used — including the
           * ones being written to every two seconds.
           */
          await asWorker((tx) => (phone ? tx`select push_told(${to.id}, ${told.unread ?? null})` : tx`select push_used(${to.id})`))
          sent += 1
        }
      }
    }
    await asWorker((tx) => tx`select notification_sent(${d.id})`)
  }
  return sent
}

/**
 * The number on the icon: the inbox, and the rooms' messages as the sidebar
 * counts them. A push about a mention used to set the icon to the inbox
 * alone, and every unread direct message went off it.
 */
async function unreadFor(workspace: string, actor: string): Promise<number> {
  const [count] = await withoutActor((tx) => tx<{ n: number }[]>`select unread_for(${workspace}, ${actor}) as n`)
  const rooms = await withActor(actor, workspace, chatWaiting).catch(() => 0)
  return Number(count?.n ?? 0) + rooms
}

/* ------------------------------------------------- the number after a read */

/**
 * Something was read: this person's phones here owe their icon a number.
 * In the read's
 * own transaction and as its reader, so it is their phones and nobody's
 * else that are marked.
 */
export async function owesCount(tx: Tx, actor: string, workspace: string): Promise<void> {
  await tx`
    update push_subscription set recount_at = now()
    where actor_id = ${actor} and workspace_id = ${workspace}
      and kind = 'apns' and deleted_at is null`
}

/**
 * Each phone owed a number, told it — once for however many reads there
 * were since the last pass, and not at all when it would say what the icon
 * was last told. The laptop read a room and the phone in a pocket went on
 * saying three until somebody opened it.
 */
export async function recountDue(limit = 50, phoneImpl?: Post): Promise<number> {
  if (!apnsConfigured()) return 0
  const owed = await asWorker(
    (tx) =>
      tx<{ id: string; workspace_id: string; actor_id: string; endpoint: string; told_unread: number | null }[]>`
      select * from push_recounts(${limit})`,
  )
  if (owed.length === 0) return 0
  const apple = phoneImpl ? null : phones()
  const post = phoneImpl ?? apple!.post
  let sent = 0
  try {
    for (const phone of owed) {
      const unread = await unreadFor(phone.workspace_id, phone.actor_id)
      if (unread === phone.told_unread) continue
      let status = 0
      try {
        status = await countToPhone(phone.endpoint, unread, post)
      } catch {
        // Not reached is not gone; the next notification carries the number.
        status = 0
      }
      if (status === 404 || status === 410) {
        await asWorker((tx) => tx`select push_subscription_gone(${phone.id})`)
      } else if (status >= 200 && status < 300) {
        await asWorker((tx) => tx`select push_told(${phone.id}, ${unread})`)
        sent += 1
      }
    }
  } finally {
    apple?.close()
  }
  return sent
}
