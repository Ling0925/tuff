/**
 * The VAPID pair and subject your own server makes for itself when its
 * environment has none.
 *
 * Community edition only (`edition.instance`): on the service every
 * function here returns at once, asks the database nothing, and the keys
 * and subject are the environment's and the vendor's, as they always were.
 *
 * The rules that matter for a secret at rest:
 *
 * - the pair is made **once** and never again — the database keeps the
 *   first one written (`instance_push_key_keep`: insert if absent, then
 *   read back), so the app and the worker starting together end with one;
 * - the private half is sealed before it reaches the database
 *   (`seal('vapid', …)`) and opened only here, into module state;
 * - a row that will not open turns browser push off, is said once in the
 *   log — which key sealed it, never what it holds — and is never
 *   replaced; it is asked again every minute, so a `reseal` run while this
 *   process is up brings push back without a restart;
 * - the private key is never logged, returned or thrown.
 */
import { createECDH, createHash, generateKeyPairSync } from 'node:crypto'
import { keyIdOf, open, seal, sealedWith } from './auth/seal.js'
import { sql as appSql, type Sql } from './db.js'
import { edition } from './edition.js'
import { env, readMailFrom } from './env.js'
import { envMailSender, savedMail } from './mail.js'

/** A pair as the Push API and the signature take it: the public point and the private scalar, both base64url. */
export type VapidPair = { publicKey: string; privateKey: string }

/** A freshly made P-256 pair, in the same encoding a script of the hosted service prints. */
export function makePair(): VapidPair {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const pub = publicKey.export({ format: 'jwk' }) as { x: string; y: string }
  const raw = Buffer.concat([Buffer.from([0x04]), Buffer.from(pub.x, 'base64url'), Buffer.from(pub.y, 'base64url')])
  return { publicKey: raw.toString('base64url'), privateKey: (privateKey.export({ format: 'jwk' }) as { d: string }).d }
}

/** Whether the private scalar is the one behind this public point — a row that does not match signs nothing. */
export function pairMatches(p: VapidPair): boolean {
  try {
    const ecdh = createECDH('prime256v1')
    ecdh.setPrivateKey(Buffer.from(p.privateKey, 'base64url'))
    return ecdh.getPublicKey().toString('base64url') === p.publicKey
  } catch {
    return false
  }
}

/* ------------------------------------------------------------ module state */

let kept: VapidPair | null = null
/** The kept row would not open, or did not match: said once, asked again on the slow clock below. */
let unreadable = false
let subject = ''
let subjectAt = 0
let pairAt = 0
let reading: Promise<void> | null = null

/** How long a subject read is believed; while there is none, a shorter while. */
export const SUBJECT_FOR_MS = 30_000
export const NO_SUBJECT_FOR_MS = 5_000
/** How often a row that would not open is asked again, and the worker compares keys with the app; a setting, so a test can shorten it. */
export const pushKeyClock = { unreadableRetryMs: 60_000, compareEveryMs: 60_000 }

/** Any VAPID key in the environment: then it alone decides, and nothing is made or read here. */
export const envHasKeys = (): boolean => Boolean(env.vapidPublicKey || env.vapidPrivateKey)

/** Whether this process uses a pair kept in the database: your own server, with no key in the environment. */
export const keepsPair = (): boolean => edition.instance && !envHasKeys()

/** The pair this process signs with: the environment's when it has any, else the kept one, else none. */
export function vapidPair(): VapidPair | null {
  if (envHasKeys()) {
    return env.vapidPublicKey && env.vapidPrivateKey ? { publicKey: env.vapidPublicKey, privateKey: env.vapidPrivateKey } : null
  }
  return edition.instance ? kept : null
}

/**
 * This server's own address as a subject — RFC 8292 takes an `https:` URI —
 * when `APP_URL` is one: the origin, nothing after it. Empty for `http:`
 * (try mode on localhost) or none.
 */
export function siteSubject(appUrl: string = env.appUrl): string {
  try {
    const u = new URL(appUrl)
    return u.protocol === 'https:' ? u.origin : ''
  } catch {
    return ''
  }
}

/**
 * The subject for your own server when `VAPID_SUBJECT` is unset: its own
 * `https:` address; only without one, `mailto:` the address mail is sent
 * from. Never a person's own address. Empty: push stays off.
 */
export const keptSubject = (): string => (edition.instance ? siteSubject() || subject : '')

/* ------------------------------------------------------------- the reading */

type Row = { public_key: string; private_key_enc: string }

/** Opened and checked, or why not: a row that cannot sign is no pair. */
function opened(r: Row): VapidPair | 'sealed' | 'mismatched' {
  const privateKey = open('vapid', r.private_key_enc)
  if (!privateKey) return 'sealed'
  const p = { publicKey: r.public_key, privateKey }
  return pairMatches(p) ? p : 'mismatched'
}

const DELETE_IT =
  'as the database owner, `delete from instance_push_key` and restart both the app and the worker for a new pair — everyone then turns notifications on again.'

/**
 * Why the kept row will not open, and the way out that fits: which key
 * sealed it — `JWT_SECRET`, or an `ENCRYPTION_KEY` by its id — against the
 * ids this process has. Never the sealing's content.
 */
export function unreadableLine(sealed: string, why: 'sealed' | 'mismatched'): string {
  const head = '[push] THE PUSH KEY KEPT IN THE DATABASE (instance_push_key) WILL NOT OPEN, so browser push is off. '
  const tail = ' It is never replaced on its own.'
  const by = sealedWith(sealed)
  if (why === 'mismatched' || !by) return `${head}It opens to a pair whose halves do not match. Fix: ${DELETE_IT}${tail}`
  if (by.version === 0) {
    return (
      `${head}It was sealed under JWT_SECRET (before ENCRYPTION_KEY was set), and JWT_SECRET has changed since. ` +
      `Fix: put back the JWT_SECRET it was made with on both the app and the worker, then set ENCRYPTION_KEY and run reseal; or, ${DELETE_IT}${tail}`
    )
  }
  const mine = [
    `ENCRYPTION_KEY ${keyIdOf(env.encryptionKey) || 'unset'}`,
    `ENCRYPTION_KEY_PREVIOUS ${keyIdOf(env.encryptionKeyPrevious) || 'unset'}`,
  ]
  return (
    `${head}It was sealed under an ENCRYPTION_KEY with id ${by.keyId}; this process has ${mine.join(', ')}. ` +
    `Fix: set ENCRYPTION_KEY_PREVIOUS to the key with id ${by.keyId} on both the app and the worker and run reseal; or, ${DELETE_IT}${tail}`
  )
}

/**
 * The kept pair: read, and made and kept first when there is none.
 *
 * Read before making, so a restart does not generate a pair only to throw
 * it away; made, sealed and handed to `instance_push_key_keep`, which
 * keeps it only if no other start got there first and answers whichever
 * is kept. Answers nothing when the database is not yet told it is a
 * server of one's own — a worker starting before the app — and the next
 * `freshPushKey` asks again.
 */
async function loadPair(db: Sql): Promise<void> {
  let [row] = await db<Row[]>`select public_key, private_key_enc from instance_push_key_kept()`
  if (!row) {
    const made = makePair()
    ;[row] = await db<Row[]>`
      select public_key, private_key_enc from instance_push_key_keep(${made.publicKey}, ${seal('vapid', made.privateKey)})`
    if (row?.public_key === made.publicKey) console.log('[push] This server made its browser push key and keeps it in the database.')
  }
  if (!row) return
  const p = opened(row)
  if (typeof p === 'string') {
    /* Said once, not every minute it is asked again. */
    if (!unreadable) console.error(unreadableLine(row.private_key_enc, p))
    unreadable = true
    return
  }
  if (unreadable) console.log(`[push] The push key kept in the database opens now (${fingerprint(p.publicKey)}): browser push is on again.`)
  unreadable = false
  kept = p
}

/**
 * `mailto:` the address mail is sent from — `MAIL_FROM` when the
 * environment sends mail, else the sender saved in Server settings — or
 * nothing. Never an owner's own address: that would be a person's email
 * handed to the push services without their saying so. Asked only where
 * `APP_URL` is not `https:`.
 */
async function loadSubject(): Promise<void> {
  const sending = envMailSender() ? env.mailFrom : ((await savedMail())?.from.address ?? '')
  const address = sending ? readMailFrom(sending)?.address : undefined
  subject = address ? `mailto:${address}` : ''
  subjectAt = Date.now()
}

/**
 * The kept pair and subject, read when they are missing or old — awaited
 * at start, at the head of every delivery pass and by the push endpoints,
 * so the synchronous checks (`webPushConfigured`, `reachable`) have what
 * they need. Nothing at all on the service. The database away: what was
 * read last, and asked again next time.
 */
export async function freshPushKey(db: Sql = appSql): Promise<void> {
  if (!edition.instance) return
  const now = Date.now()
  const pairDue = keepsPair() && !kept && now - pairAt >= (unreadable ? pushKeyClock.unreadableRetryMs : NO_SUBJECT_FOR_MS)
  const subjectDue =
    !env.vapidSubject && !siteSubject() && (!subjectAt || now - subjectAt >= (subject ? SUBJECT_FOR_MS : NO_SUBJECT_FOR_MS))
  if (!pairDue && !subjectDue) return
  reading ??= (async () => {
    if (pairDue) {
      pairAt = Date.now()
      await loadPair(db)
    }
    if (subjectDue) await loadSubject()
  })()
    .catch((e: unknown) => console.error('[push] reading the kept push key failed:', e instanceof Error ? e.message : 'unknown'))
    .finally(() => {
      reading = null
    })
  await reading
}

/** Mail was set up by this process: the next `freshPushKey` asks for the subject again. */
export function forgetPushSubject(): void {
  subjectAt = 0
}

/* ------------------------------------------------ the app and the worker */

/** A short name for a public key, for the log: the same name in the app's and the worker's lines is the same pair. */
export const fingerprint = (publicKey: string): string => createHash('sha256').update(publicKey).digest('hex').slice(0, 8)

/** The start's line about the pair this process signs with, or null for none. */
export function pushKeyLine(who: 'app' | 'worker'): string | null {
  const p = vapidPair()
  if (!p) return null
  return `[push] The ${who} signs browser push with key ${fingerprint(p.publicKey)}, ${envHasKeys() ? 'from VAPID_PUBLIC_KEY' : 'kept in the database'}.`
}

/**
 * The serving start says which public key it signs with — as the table
 * owner, `instance_push_app_key_said` — so the worker can compare. Your own
 * server only.
 */
export async function sayAppKey(owner: Sql): Promise<void> {
  if (!edition.instance) return
  await owner`select instance_push_app_key_said(${vapidPair()?.publicKey ?? null})`
}

let comparedAt = 0
let saidApart = ''

/**
 * The worker, against the key the app said it signs with: different keys
 * mean every browser subscription the app takes is refused when the worker
 * signs for it, and nothing else says so. One loud line per difference,
 * and one when they agree again. Asked at most once a minute; nothing on
 * the service or before the app has said.
 */
export async function compareWithApp(db: Sql = appSql): Promise<void> {
  if (!edition.instance) return
  const now = Date.now()
  if (comparedAt && now - comparedAt < pushKeyClock.compareEveryMs) return
  comparedAt = now
  try {
    const [r] = await db<{ k: string | null }[]>`select instance_push_app_key() as k`
    const theirs = r?.k ?? null
    if (!theirs) return
    const mine = vapidPair()?.publicKey ?? null
    if (mine === theirs) {
      if (saidApart) console.log(`[push] The worker and the app sign browser push with the same key now (${fingerprint(mine)}).`)
      saidApart = ''
      return
    }
    const apart = `${theirs}/${mine ?? ''}`
    if (apart === saidApart) return
    saidApart = apart
    console.error(
      `[push] THE WORKER SIGNS BROWSER PUSH WITH ${mine ? `KEY ${fingerprint(mine)}` : 'NO KEY'}, BUT THE APP SERVES KEY ${fingerprint(theirs)}: ` +
        'every browser notification will be refused. Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY on both the app and the worker or on neither, ' +
        'give both the same ENCRYPTION_KEY and JWT_SECRET, and restart both.',
    )
  } catch (e) {
    console.error('[push] comparing the worker’s push key with the app’s failed:', e instanceof Error ? e.message : 'unknown')
  }
}

/** For the tests: this process as though it had just started. */
export function forgetPushKey(): void {
  kept = null
  unreadable = false
  subject = ''
  subjectAt = 0
  pairAt = 0
  comparedAt = 0
  saidApart = ''
}
