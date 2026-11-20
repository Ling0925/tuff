import { createHmac, randomUUID } from 'node:crypto'
import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { Readable } from 'node:stream'
import { dirname, join, resolve } from 'node:path'
import { keyFor, legacyKey, mac, same } from './auth/keys.js'
import { configured, send } from './s3.js'

/**
 * Where bytes live.
 *
 * Behind an interface with one implementation, because the design asks for
 * object storage and a CDN and this has neither yet. What matters now is that
 * nothing above this file knows: handlers deal in keys and short-lived signed
 * URLs, which is the same contract S3 offers, so swapping the driver is a
 * driver and not a rewrite.
 *
 * The rule that must survive the swap is that there are no public URLs. A
 * bucket somebody can read by guessing a name is how a client's documents end
 * up indexed.
 */
export type StoredObject = {
  key: string
  size: number
  contentType: string
}

const root = resolve(process.env.STORAGE_DIR ?? '.storage')
/* Three keys, not `JWT_SECRET` itself: a link for anybody, a link for one
   reader, and the file cookie — `auth/keys.ts`. */
const FILES = keyFor('files')
const READER = keyFor('files-reader')
const COOKIE_KEY = keyFor('file-cookie')

/*
 * Which driver, decided once at startup.
 *
 * Read here rather than per call so that a deployment cannot be half in
 * one place and half in the other — a `put` to the bucket and a `get` from
 * the disk is a file that uploads successfully and then cannot be found.
 */
const bucket = configured()

/**
 * Which driver this process started with, for the one line that says so.
 *
 * The name of the bucket and never its credentials: a startup log is the
 * most-copied text in any deployment.
 */
export function whereBytesGo(): string | null {
  return bucket?.bucket ?? null
}

export async function put(workspaceId: string, body: Uint8Array, contentType: string): Promise<StoredObject> {
  // The key carries the workspace, so a path traversal in a later driver
  // cannot reach another tenant's prefix even if the id is attacker-chosen.
  const key = `${workspaceId}/${randomUUID()}`
  if (bucket) {
    /* With its type, so the edge in front of the bucket can say what the
       bytes are without reading them. */
    const r = await send(bucket, 'PUT', key, body, { 'content-type': contentType })
    /* Thrown rather than returned false: the caller is about to write a
       row saying this file exists, and a row pointing at bytes that were
       never stored is worse than a failed upload. */
    if (!r.ok) throw new Error(`storage: PUT ${r.status} ${await r.text().catch(() => '')}`)
    return { key, size: body.byteLength, contentType }
  }
  const path = join(root, key)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, body)
  return { key, size: body.byteLength, contentType }
}

export async function get(key: string): Promise<Uint8Array | null> {
  if (bucket) {
    const r = await send(bucket, 'GET', key)
    /* Null for anything that is not there, which is what the disk driver
       answers and what the handler above turns into a 404. */
    if (!r.ok) return null
    return new Uint8Array(await r.arrayBuffer())
  }
  try {
    return await readFile(join(root, key))
  } catch {
    return null
  }
}

/**
 * Part or all of an object, as a stream, with the size of the whole.
 *
 * `get` reads the object into memory before anything is sent, which is
 * fine for a face and wrong for a minute of video: the bucket had to hand
 * the server all fifty megabytes before the browser saw the first byte, and
 * a `<video>` asking for the opening second to draw its first frame got the
 * whole file. This passes the bytes through as they arrive and answers a
 * range with that range — which is also what lets a video be scrubbed, and
 * what Safari will not play a video without.
 */
export type Opened = {
  body: ReadableStream<Uint8Array>
  /** The whole object's size, whatever part of it is in `body`. */
  size: number
  start: number
  end: number
}

export async function open(key: string, range?: { start: number; end?: number }): Promise<Opened | null> {
  if (bucket) {
    const ask = range ? { range: `bytes=${range.start}-${range.end ?? ''}` } : {}
    const r = await send(bucket, 'GET', key, undefined, ask)
    if (!r.ok || !r.body) return null
    const total = /\/(\d+)$/.exec(r.headers.get('content-range') ?? '')
    const length = Number(r.headers.get('content-length') ?? 0)
    const size = total ? Number(total[1]) : length
    const start = r.status === 206 ? (range?.start ?? 0) : 0
    return { body: r.body, size, start, end: start + length - 1 }
  }
  const path = join(root, key)
  const info = await stat(path).catch(() => null)
  if (!info) return null
  if (info.size === 0) return { body: new Blob([]).stream(), size: 0, start: 0, end: -1 }
  const start = Math.min(range?.start ?? 0, Math.max(0, info.size - 1))
  const end = Math.min(range?.end ?? info.size - 1, info.size - 1)
  const body = Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream<Uint8Array>
  return { body, size: info.size, start, end }
}

export async function remove(key: string): Promise<void> {
  if (bucket) {
    /* Gone already is the state the caller asked for; anything else — the
       bucket down, a refused signature — throws, so the worker keeps the
       key and asks again next hour rather than forgetting bytes it never
       removed. */
    const r = await send(bucket, 'DELETE', key)
    if (!r.ok && r.status !== 404) throw new Error(`the bucket answered ${r.status} to removing ${key}`)
    return
  }
  await unlink(join(root, key)).catch((e: NodeJS.ErrnoException) => {
    if (e.code !== 'ENOENT') throw e
  })
}

/**
 * Short-lived, and signed over the key and the expiry together.
 *
 * The expiry is rounded up to the next whole window of the same length, so
 * the link is good for between one and two windows and — the reason — is
 * the *same* link for everybody who asks inside one. It was the second the
 * link was made plus the window, so every response carried new links for
 * the same bytes: the browser's cache, keyed by the whole URL, held every
 * picture for a year and was never once asked for one again, and each
 * reload of a list fetched every face on it a second time.
 */
export function signKey(key: string, seconds = 300): string {
  return signWith(FILES, key, seconds)
}

/** The same signature under a named secret — the edge's, for `linkFor`. */
export function signWith(with_: string | Buffer, key: string, seconds: number): string {
  const now = Math.floor(Date.now() / 1000)
  const expires = seconds > 0 ? Math.ceil((now + seconds) / seconds) * seconds : now + seconds
  const sig = createHmac('sha256', with_).update(`${key}.${expires}`).digest('hex')
  return `${expires}.${sig}`
}

/**
 * The link a reader is handed for a stored object.
 *
 * Through the edge when there is one: `FILES_URL` is a Cloudflare Worker in
 * front of the bucket, which checks the same signature
 * with `FILES_SECRET` and keeps the bytes in the cache of the city the
 * reader is in, so a picture is fetched across the Atlantic once and not on
 * every open. The signature is the authorisation there as it is here, so
 * the bucket stays private. Only with a bucket: the edge reads the bucket,
 * and bytes on this container's disk are somewhere it cannot reach.
 *
 * Without one, the server's own route, `/api/blob`.
 */
export function linkFor(key: string, seconds = 3600): string {
  const edge = process.env.FILES_URL?.replace(/\/+$/, '')
  const edgeSecret = process.env.FILES_SECRET
  if (bucket && edge && edgeSecret) {
    return `${edge}/${encodeURIComponent(key)}?token=${signWith(edgeSecret, key, seconds)}`
  }
  return `/api/blob/${encodeURIComponent(key)}?token=${signKey(key, seconds)}`
}

/**
 * A link to a file in a project, good only for the person it was made for.
 *
 * A signed link stood on its own: copied out of a task and pasted anywhere,
 * it opened the file for anybody for the rest of its hour, signed in or not
 * — the signature was the whole of the permission. This one is signed over
 * the reader too, and `/api/blob` checks it against who is asking: the
 * cookie the browser holds for this server (`fileCookie`), or a bearer
 * token for a client that sends one. Somebody else who may read the file
 * opens the task and is handed a link of their own.
 *
 * Through the server, not the edge: the edge is another origin, which the
 * cookie does not reach until the app and the edge share a domain.
 * A face and a project's mark keep `linkFor`.
 */
export function linkForReader(key: string, actorId: string, seconds = 3600): string {
  return `/api/blob/${encodeURIComponent(key)}?for=me&token=${signWith(READER, `${key}.${actorId}`, seconds)}`
}

export function verifyKeyFor(key: string, actorId: string, token: string): boolean {
  return signedFor(READER, `${key}.${actorId}`, token, STORED.test(key) && UUID.test(actorId))
}

/* What a stored key and an actor look like. The old key signed many kinds
   of message, so it is tried only on a message shaped as this purpose's
   own: an object's key, a reader's id — never `digest.off`, never
   `<key>.<reader>` read as a key. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const STORED =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Who this browser is, for the file route — a value only this server can
 * make, in a cookie the page's script cannot read and that is sent only to
 * `/api/blob`. Set on any signed-in answer when it is missing, belongs to
 * somebody else, or has less than a day to run; cleared on signing out.
 */
export const FILE_COOKIE = 'tracker_files'
const COOKIE_DAYS = 7

export function fileCookie(actorId: string): string {
  const expires = Math.floor(Date.now() / 1000) + COOKIE_DAYS * 86_400
  return `${actorId}.${expires}.${mac(COOKIE_KEY, `files.${actorId}.${expires}`, 'hex')}`
}

/** The actor a cookie names, and how long it has left — or null. */
export function readFileCookie(value: string | undefined): { actorId: string; left: number } | null {
  const [actorId, expires, sig, more] = (value ?? '').split('.')
  if (!actorId || !expires || !sig || more !== undefined || !/^\d{1,12}$/.test(expires)) return null
  const left = Number(expires) - Math.floor(Date.now() / 1000)
  if (!(left > 0)) return null
  const message = `files.${actorId}.${expires}`
  if (same(mac(COOKIE_KEY, message, 'hex'), sig)) return { actorId, left }
  /* One set before the split, for the week it can last; a page that has
     it is given a new one as soon as it asks anything — `auth/keys.ts`. */
  const old = UUID.test(actorId) ? legacyKey(Number(expires) * 1000) : null
  return old && same(mac(old, message, 'hex'), sig) ? { actorId, left: Math.min(left, 0.5 * 86_400) } : null
}

/*
 * Sent to `/api/blob`, and since the seventh audit to a link card's picture
 * as well (`http/preview.ts`): an `<img>` there carries no header either,
 * and a picture's signed address past its date is answered only to
 * somebody signed in. Two cookies of one value, one for each path, so
 * neither is sent anywhere else.
 */
const COOKIE_PATHS = ['/api/blob', '/api/preview/image'] as const

export function cookieHeader(value: string | null, path: (typeof COOKIE_PATHS)[number] = '/api/blob'): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  return value
    ? `${FILE_COOKIE}=${value}; Path=${path}; HttpOnly; SameSite=Lax; Max-Age=${COOKIE_DAYS * 86_400}${secure}`
    : `${FILE_COOKIE}=; Path=${path}; HttpOnly; SameSite=Lax; Max-Age=0${secure}`
}

/** Every `Set-Cookie` the pass takes — one a path. */
export const cookieHeaders = (value: string | null): string[] => COOKIE_PATHS.map((p) => cookieHeader(value, p))

/** Where readers get bytes from, for the line `/health` says. */
export function whereLinksGo(): 'edge' | 'server' {
  return bucket && process.env.FILES_URL && process.env.FILES_SECRET ? 'edge' : 'server'
}

export function verifyKey(key: string, token: string): boolean {
  return signedFor(FILES, key, token, STORED.test(key))
}

/*
 * `<expiry>.<signature>`, the expiry a whole number of seconds still to
 * come. An expiry that was not a number was never in the past — `NaN <
 * now` is false — so anything the secret had signed as `<x>.<word>` was a
 * link that never ran out: a digest's "stop" link was a file link for the
 * key `digest.off`.
 */
function signedFor(with_: Buffer, key: string, token: string, legacyShaped: boolean): boolean {
  const [expires, sig, more] = token.split('.')
  if (!expires || !sig || more !== undefined || !/^\d{1,12}$/.test(expires)) return false
  if (Number(expires) < Math.floor(Date.now() / 1000)) return false
  const message = `${key}.${expires}`
  if (same(createHmac('sha256', with_).update(message).digest('hex'), sig)) return true
  /* A link handed out before the split, for the hour or two it lasts. */
  const old = legacyShaped ? legacyKey(Number(expires) * 1000) : null
  return old !== null && same(createHmac('sha256', old).update(message).digest('hex'), sig)
}

/**
 * A premade face an agent wears. Held in
 * `avatar_key` as `preset:<id>`, never a storage key, so it has no bytes to
 * sign and none to free (`picture_bytes_go_with_it`, migration 189): its
 * picture is the product's own still at `/faces/<id>.png`, the same for
 * everybody, which any client that draws an `avatar_url` draws as it is.
 */
export const PRESET = 'preset:'

/** A face's key as the link a reader gets: a preset's still, or the bytes signed. */
export function faceLink(key: string): string {
  return key.startsWith(PRESET) ? `/faces/${encodeURIComponent(key.slice(PRESET.length))}.png` : linkFor(key)
}

/**
 * A row with a picture key, as the API hands it out.
 *
 * The key never leaves the server. Every read of a person turns it into a
 * link that already works, the way a project's `icon_url` is made — signing
 * per render would mean a round trip before a sidebar full of faces can draw,
 * and handing out the key would mean a bucket anybody can read by guessing.
 *
 * An hour, matching the project icon: long enough that a page open all
 * morning keeps its pictures, short enough that a link out of a screenshot
 * stops working. `docs/specs/avatar.md`.
 */
export function faced<T extends { avatar_key?: string | null }>(row: T): Omit<T, 'avatar_key'> & { avatar_url: string | null } {
  const { avatar_key, ...rest } = row
  return {
    ...rest,
    avatar_url: avatar_key ? faceLink(avatar_key) : null,
  }
}

/**
 * The same, for a row that carries somebody else's picture under a name of
 * its own: a message has an `author_avatar`, an activity line an
 * `actor_avatar`.
 *
 * One function rather than ten hand-written expressions, because the link is
 * a signature over a key and an expiry — written once, it cannot drift
 * between the ten places a person is drawn.
 */
export function facedAs<T extends Record<string, unknown>>(row: T, from: string, to: string): T {
  const key = row[from]
  const { [from]: _gone, ...rest } = row
  return {
    ...rest,
    [to]: typeof key === 'string' && key ? faceLink(key) : null,
  } as unknown as T
}
