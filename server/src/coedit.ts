import * as Y from 'yjs'
import { randomUUID } from 'node:crypto'
import { v7 as uuidv7 } from 'uuid'
import type { WSContext } from 'hono/ws'
import { bounded, withActor, type Tx } from './db.js'
import { again, contextOf, type AuthContext } from './auth/context.js'
import { mayEdit } from './http/objects.js'
import { record } from './http/activity.js'
import { publish, subscribe, type Event } from './realtime.js'
import { edition } from './edition.js'
import { keepVersion } from './versions.js'
import { bodyOf, carryRich, isEmpty, key, markThread, mergeInto, stateFrom, stretchAt, stretchOf, wordsOf } from './yjson.js'

/*
 * Writing a document together.
 *
 * A room per open document per server process: the Yjs document the
 * people in it share, the sockets on it, and when its body is next written
 * to `file.body`. Every update a page sends is checked against `mayEdit`,
 * written to `file_yjs` as that person under row-level security, and only
 * then applied and passed on. Other processes hear it on `doc:<id>`.
 */

/** The body is written this long after the last edit… */
export const SETTLE_AFTER = 1500
/** …and at least this often while somebody types without a pause. */
export const SETTLE_AT_MOST = 10_000
/** A page leaving the body has it written this soon, and no sooner than this after the last write. */
const SETTLE_SOON = 250
const SETTLE_GAP = 1000
/** The version moves at most this often while a document is edited. */
export const VERSION_EVERY = 5 * 60_000
/** Rights older than this are read again before an edit is taken. */
export const RIGHTS_FRESH = 5000
/** An update larger than this, base64, closes the socket. */
export const MAX_UPDATE = 1_400_000
/** The largest frame the socket server reads at all — an update and its envelope. */
export const MAX_FRAME = MAX_UPDATE + 4096
/** A document's whole state, encoded, at most. Past it only deletions are taken. */
export const STATE_MOST = 5 * 1024 * 1024
/** Updates a socket may send in ten seconds; a page batches into thirty-millisecond windows. */
const UPDATES_EACH = 600
/** And their bytes, base64, in the same ten seconds. */
export const BYTES_EACH = 2 * 1024 * 1024
/** Carets passed on per socket per second; a page says at most eight. */
const CARETS_EACH = 10
/** Frames of any kind per socket per second before it is closed as a flood. */
export const FRAMES_EACH = 150
/** What fits in a NOTIFY beside its envelope; a larger update travels as the fact alone. */
const INLINE = 6000

/** This process, so what it said on the database is not taken twice. */
const INSTANCE = randomUUID()
const REMOTE = Symbol('remote')
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const topicOf = (fileId: string) => `doc:${fileId}`
const b64 = (u: Uint8Array) => Buffer.from(u).toString('base64')
const fromB64 = (s: string) => new Uint8Array(Buffer.from(s, 'base64'))

/** A body from outside that cannot be taken: read too long ago, or too large. Stale says what is there now. */
export class Refused extends Error {
  constructor(
    readonly code: 'stale' | 'too_large',
    readonly now?: { rev: number; body: unknown },
  ) {
    super(code)
  }
}

/**
 * Said inside a transaction by a path that has asked `mayEdit` for this
 * file: the fold and a kept revision are taken only under it (migration
 * 234). A reader's socket never says it, so a reader's transaction cannot
 * fold a document's state away however it is asked.
 */
const proved = (tx: Tx, fileId: string) => tx`select set_config('app.may_edit_file', ${fileId}, true)`

/** As the person, held to their token's projects when it has some. */
const as = <T>(ctx: AuthContext, fn: (tx: Tx) => Promise<T>): Promise<T> => bounded(ctx, () => withActor(ctx.actorId, ctx.workspaceId, fn))

/** One writer of a document's state at a time: making it, folding it, merging into it. */
const lock = (tx: Tx, fileId: string) => tx`select pg_advisory_xact_lock(hashtextextended(${`doc:${fileId}`}, 0))`

async function rowsOf(tx: Tx, fileId: string): Promise<{ id: string; bytes: Uint8Array }[]> {
  return tx<{ id: string; bytes: Uint8Array }[]>`select id, bytes from file_yjs where file_id = ${fileId}`
}

/**
 * The rows as one document. Applied rather than merged: `Y.mergeUpdates`
 * keeps every deleted character's content, and a document applied with
 * garbage collection on keeps only that it was deleted — the review found
 * twelve megabytes deleted and folded still taking twelve megabytes.
 */
function docOf(rows: { bytes: Uint8Array }[]): Y.Doc {
  const doc = new Y.Doc({ gc: true })
  doc.transact(() => {
    for (const r of rows) Y.applyUpdate(doc, new Uint8Array(r.bytes))
  })
  /* And what waits on something that never came — a deletion of items the
     document does not have, a struct whose neighbour is missing — is not
     part of it. Encoded, it would be carried in every fold for ever: the
     second review grew a document past its cap with deletions of nothing. */
  doc.store.pendingDs = null
  doc.store.pendingStructs = null
  return doc
}

/**
 * Whether an update names anything the document does not have: an item it
 * hangs off, a range it deletes, a gap before its own first struct. A page
 * only ever builds on what the server sent it, so such an update is not a
 * page's; applied, it would wait in the document as pending, uncounted.
 */
export function strays(doc: Y.Doc, u: Uint8Array): boolean {
  const { structs, ds } = Y.decodeUpdate(u)
  const own = new Map<number, { from: number; to: number }>()
  for (const s of structs) {
    if (s instanceof Y.Skip) return true
    const r = own.get(s.id.client)
    const to = s.id.clock + s.length
    own.set(s.id.client, r ? { from: Math.min(r.from, s.id.clock), to: Math.max(r.to, to) } : { from: s.id.clock, to })
  }
  const have = (client: number) => Y.getState(doc.store, client)
  for (const [client, r] of own) if (r.from > have(client)) return true
  const known = (id: { client: number; clock: number } | null | undefined) => {
    if (!id) return true
    if (id.clock < have(id.client)) return true
    const r = own.get(id.client)
    return Boolean(r && id.clock < r.to)
  }
  for (const s of structs) {
    if (!(s instanceof Y.Item)) continue
    if (!known(s.origin) || !known(s.rightOrigin)) return true
    if (s.parent instanceof Y.ID && !known(s.parent)) return true
  }
  for (const [client, ranges] of ds.clients) {
    const end = Math.max(have(client), own.get(client)?.to ?? 0)
    for (const d of ranges) if (d.clock + d.len > end) return true
  }
  return false
}

/** What travels on `doc:<id>` for an update: inline when it fits. */
function word(u: Uint8Array, from: string) {
  const s = b64(u)
  return { from, u: s.length <= INLINE ? s : null }
}

const blocks = (body: unknown) => {
  const c = (body as { content?: unknown } | null)?.content
  return Array.isArray(c) ? c.map(key) : []
}
/** Whether two bodies say the same, however each was written. */
const sameBody = (a: unknown, b: unknown) => JSON.stringify(blocks(a)) === JSON.stringify(blocks(b))

type Written = { author_id: string; project_id: string | null; me: string | null }

/** The document as this person may read it: a written one, not in the bin. Null is a refusal. */
export async function readable(ctx: AuthContext, fileId: string): Promise<Written | null> {
  if (!UUID.test(fileId)) return null
  return as(ctx, async (tx) => {
    const [f] = await tx<Written[]>`
      select f.author_id, f.project_id, (select a.name from actor a where a.id = ${ctx.actorId}) as me
      from file f
      where f.id = ${fileId} and f.deleted_at is null
        and f.body is not null and f.storage_key is null and f.url is null`
    return f ?? null
  })
}

/**
 * The state, made from the stored body the first time anybody opens the
 * document. Under the lock and asked again inside it: two people opening it
 * at once must not both make one, or the words would merge in twice. With
 * it, the stored body, for the room to see whether it was left behind.
 */
export async function ensureState(ctx: AuthContext, fileId: string): Promise<{ state: Uint8Array; body: unknown } | null> {
  return as(ctx, async (tx) => {
    const read = async () => {
      const rows = await rowsOf(tx, fileId)
      if (!rows.length) return null
      const [f] = await tx<{ body: unknown }[]>`select body from file where id = ${fileId}`
      const doc = docOf(rows)
      const state = Y.encodeStateAsUpdate(doc)
      doc.destroy()
      return { state, body: f?.body ?? null }
    }
    const had = await read()
    if (had) return had
    await lock(tx, fileId)
    const now = await read()
    if (now) return now
    const [f] = await tx<{ body: unknown; workspace_id: string }[]>`
      select body, workspace_id from file
      where id = ${fileId} and deleted_at is null and body is not null and storage_key is null and url is null`
    if (!f) return null
    const state = stateFrom(f.body)
    await tx`insert into file_yjs (id, workspace_id, file_id, bytes, actor_id)
             values (${uuidv7()}, ${f.workspace_id}, ${fileId}, ${Buffer.from(state)}, null)`
    return { state, body: f.body }
  })
}

/** An accepted update, kept and said — in one transaction, so it is heard when it can be read. */
async function keep(ctx: AuthContext, fileId: string, u: Uint8Array): Promise<void> {
  await as(ctx, async (tx) => {
    /* Not into a deleted document: a socket opened before the delete would
       otherwise go on writing to it until it next asked who may.
       Refused, the room is told not found. */
    const kept = await tx`insert into file_yjs (id, workspace_id, file_id, bytes, actor_id)
             select ${uuidv7()}, ${ctx.workspaceId}, ${fileId}, ${Buffer.from(u)}, ${ctx.actorId}
             where exists (select 1 from file where id = ${fileId} and deleted_at is null)`
    if (kept.count === 0) throw new Error('deleted')
    await publish(topicOf(fileId), 'yjs', word(u, INSTANCE), tx)
  })
}

/**
 * A new body for the file. `rev` moves with the version and with every
 * write from the API, and not with the debounced writes between — so a
 * revision an agent read stands for minutes, not for a second and a half.
 * When it moves, the body it now stands for is kept under it (`file_rev`),
 * for a caller who read it to be merged against. Answers the version and
 * revision now, or null when nothing changed and nothing moved.
 */
async function storeBody(
  tx: Tx,
  fileId: string,
  body: unknown,
  how: { bump: boolean; api: boolean },
): Promise<{
  version: number
  rev: number
  project_id: string | null
  workspace_id: string
  before: { version: number; body: unknown }
} | null> {
  const json = tx.json(body as never)
  const [was] = await tx<{ workspace_id: string; changed: boolean; rev: number; version: number; body: unknown }[]>`
    select workspace_id, rev, version, body, (body is distinct from ${json}::jsonb) as changed
    from file where id = ${fileId} and deleted_at is null`
  if (!was || (!was.changed && !how.bump && !how.api)) return null
  const moves = how.bump || how.api
  /* The body the current revision began with, if nothing kept it yet: the
     first write since it began is the last moment that body is still the
     stored one. Kept once; a later write finds it there. */
  if (was.body !== null) {
    await tx`insert into file_rev (workspace_id, file_id, rev, body)
             values (${was.workspace_id}, ${fileId}, ${was.rev}, ${tx.json(was.body as never)})
             on conflict do nothing`
  }
  const [saved] = await tx<{ version: number; rev: number; project_id: string | null }[]>`
    update file set body = ${json}, version = version + ${how.bump ? 1 : 0}, rev = rev + ${moves ? 1 : 0}
    where id = ${fileId}
    returning version, rev, project_id`
  if (saved && moves) {
    await tx`insert into file_rev (workspace_id, file_id, rev, body)
             values (${was.workspace_id}, ${fileId}, ${saved.rev}, ${json})
             on conflict do nothing`
  }
  return saved ? { ...saved, workspace_id: was.workspace_id, before: { version: was.version, body: was.body } } : null
}

/**
 * The stored body written from the state, and the rows folded into one.
 * `bump` moves the version. Null when there is no state or no document.
 */
export async function writeBody(
  ctx: AuthContext,
  fileId: string,
  bump: boolean,
  contributors: readonly string[] = [],
): Promise<{ version: number; projectId: string | null } | null> {
  return as(ctx, async (tx) => {
    await lock(tx, fileId)
    await proved(tx, fileId)
    const rows = await rowsOf(tx, fileId)
    if (!rows.length) return null
    const doc = docOf(rows)
    const body = bodyOf(doc)
    const state = Y.encodeStateAsUpdate(doc)
    doc.destroy()
    /* Not written when it says the same, so a pause in typing that changed
       nothing does not touch the row. */
    const saved = await storeBody(tx, fileId, body, { bump, api: false })
    if (rows.length > 1) {
      await tx`select file_yjs_fold(${fileId}, ${rows.map((r) => r.id)}::uuid[], ${Buffer.from(state)})`
    }
    if (!saved) {
      const [f] = await tx<{ version: number; project_id: string | null }[]>`
        select version, project_id from file where id = ${fileId} and deleted_at is null`
      return f ? { version: f.version, projectId: f.project_id } : null
    }
    /* A version moved is a version kept, with who wrote in it since the
       last. */
    if (bump) {
      await keepVersion(tx, {
        fileId,
        workspaceId: saved.workspace_id,
        version: saved.version,
        body,
        contributors: contributors.length ? contributors : [ctx.actorId],
        before: saved.before,
      })
    }
    await publish(topicOf(fileId), 'saved', { version: saved.version }, tx)
    return { version: saved.version, projectId: saved.project_id }
  })
}

/**
 * An earlier version's body put back.
 *
 * Inside the caller's transaction, after it has asked `mayEdit`. Merged
 * into the shared state against what it says now, as one update in the
 * restorer's name, and said to the rooms, so everybody with the document
 * open sees it change in place; then stored as an API write that moves the
 * version. Answers the body now stored, the version and what it said
 * before, or null when the document is gone. Throws `Refused` when the
 * result would be too large.
 */
export async function restoreBody(
  tx: Tx,
  ctx: AuthContext,
  fileId: string,
  body: unknown,
): Promise<{ body: unknown; version: number; changed: boolean; before: { version: number; body: unknown } } | null> {
  await lock(tx, fileId)
  await proved(tx, fileId)
  const [f] = await tx<{ body: unknown; version: number }[]>`
    select body, version from file
    where id = ${fileId} and deleted_at is null and body is not null and storage_key is null and url is null`
  if (!f) return null
  const rows = await rowsOf(tx, fileId)
  let next: unknown = body
  let changed = !sameBody(body, f.body)
  if (rows.length) {
    const doc = docOf(rows)
    try {
      const before = Y.encodeStateVector(doc)
      const merged = mergeInto(doc, bodyOf(doc), body)
      next = bodyOf(doc)
      /* What the people have now, not what was last stored: the room may
         not have written their last words yet. */
      changed = merged.changed || !sameBody(next, f.body)
      if (merged.changed) {
        if (Y.encodeStateAsUpdate(doc).length > STATE_MOST) throw new Refused('too_large')
        const u = Y.encodeStateAsUpdate(doc, before)
        await tx`insert into file_yjs (id, workspace_id, file_id, bytes, actor_id)
                 values (${uuidv7()}, ${ctx.workspaceId}, ${fileId}, ${Buffer.from(u)}, ${ctx.actorId})`
        await publish(topicOf(fileId), 'yjs', word(u, 'api'), tx)
      }
    } finally {
      doc.destroy()
    }
  }
  if (!changed) return { body: f.body, version: f.version, changed: false, before: { version: f.version, body: f.body } }
  const saved = await storeBody(tx, fileId, next, { bump: true, api: true })
  if (!saved) return null
  await publish(topicOf(fileId), 'saved', { version: saved.version }, tx)
  return { body: next, version: saved.version, changed: true, before: saved.before }
}

/**
 * The body a caller read, to merge against. Without `baseRev`, the stored
 * body — the old contract, right for an edit made straight after a read.
 * With it, the body kept when that revision began; the stored one if none
 * was kept and it is still the revision. Anything else is stale, and the
 * caller is told what is there now.
 */
async function baseOf(tx: Tx, fileId: string, baseRev: number | undefined, stateful: boolean): Promise<unknown> {
  const [f] = await tx<{ body: unknown; rev: number }[]>`select body, rev from file where id = ${fileId}`
  if (!f) throw new Refused('stale')
  const now = { rev: f.rev, body: f.body }
  if (baseRev === undefined) return f.body
  /* A document nobody has written together has one body per revision:
     anything but the current one would be overwritten unseen. */
  if (!stateful) {
    if (baseRev === f.rev) return f.body
    throw new Refused('stale', now)
  }
  if (baseRev > f.rev) throw new Refused('stale', now)
  const [kept] = await tx<{ body: unknown }[]>`select body from file_rev where file_id = ${fileId} and rev = ${baseRev}`
  if (kept) return kept.body
  if (baseRev === f.rev) return f.body
  throw new Refused('stale', now)
}

/**
 * A body sent through `PATCH /api/files/:id`, merged into the state —
 * inside the caller's transaction, after it has asked `mayEdit`. Answers
 * the body to store and how many stretches were left as the people had
 * them, or null when the document has no state and the caller writes the
 * body as it always did. Throws `Refused` when the revision it read is no
 * longer kept, or the result would be too large.
 */
export async function mergeBody(
  tx: Tx,
  ctx: AuthContext,
  fileId: string,
  theirs: unknown,
  opts: { baseRev?: number | undefined; markdown?: boolean } = {},
): Promise<{ body: unknown; conflicts: number } | null> {
  await lock(tx, fileId)
  await proved(tx, fileId)
  const rows = await rowsOf(tx, fileId)
  const base = await baseOf(tx, fileId, opts.baseRev, rows.length > 0)
  if (!rows.length) return null
  const doc = docOf(rows)
  const before = Y.encodeStateVector(doc)
  /* What Markdown cannot say — a thread's mark, a task named in a line —
     carried onto the caller's blocks where their words still hold it
     (`carryRich`), before the merge decides whose block wins. */
  const merged = mergeInto(doc, base, carryRich(base, theirs), opts.markdown === true)
  if (merged.changed) {
    if (Y.encodeStateAsUpdate(doc).length > STATE_MOST) {
      doc.destroy()
      throw new Refused('too_large')
    }
    const u = Y.encodeStateAsUpdate(doc, before)
    await tx`insert into file_yjs (id, workspace_id, file_id, bytes, actor_id)
             values (${uuidv7()}, ${ctx.workspaceId}, ${fileId}, ${Buffer.from(u)}, ${ctx.actorId})`
    await publish(topicOf(fileId), 'yjs', word(u, 'api'), tx)
  }
  const body = bodyOf(doc)
  doc.destroy()
  return { body, conflicts: merged.conflicts }
}

/**
 * A thread's words marked in the document.
 *
 * Inside the caller's transaction, after it has asked `can()` for the
 * comment: the anchor is found in the state, the mark written over it as
 * one update in the person's name and said to the rooms, and the stored
 * body written from the result without moving the version. Answers the words it is on, `null` when the anchor
 * is not there, `''` when it covers no words. Asked once: whatever waiting
 * there is happens before, outside the lock (`anchorReady`).
 */
export type Anchor = { from: Uint8Array; to: Uint8Array } | { text: string }

type Rel = Y.RelativePosition
/** The two positions, decoded; null when either is not one. */
function decoded(anchor: { from: Uint8Array; to: Uint8Array }): [Rel, Rel] | null {
  /* One that does not encode back to the same bytes is not one a page
     made: decoding reads what it can of anything and ignores the rest. */
  const one = (u: Uint8Array): Rel | null => {
    try {
      const r = Y.decodeRelativePosition(u)
      return Buffer.compare(Buffer.from(Y.encodeRelativePosition(r)), Buffer.from(u)) === 0 ? r : null
    } catch {
      return null
    }
  }
  const a = one(anchor.from)
  const b = one(anchor.to)
  return a && b ? [a, b] : null
}

/** Whether a position names an item this state has not heard of yet — one still on its way. */
function ahead(doc: Y.Doc, r: Rel): boolean {
  const sv = Y.encodeStateVector(doc)
  const known = Y.decodeStateVector(sv)
  return [r.item, r.type].some((id) => id !== null && id !== undefined && (known.get(id.client) ?? 0) <= id.clock)
}

/**
 * Until the page's anchor can be read, for up to a second — the page's
 * last keystrokes may still be on their way over its socket. Waited for
 * outside any lock or transaction, and only while a position names an item
 * the state has not reached yet: garbage, or an item already in the state
 * and since deleted, is answered at once. True when it is worth asking.
 */
export async function anchorReady(ctx: AuthContext, fileId: string, anchor: Anchor): Promise<boolean> {
  if ('text' in anchor) return true
  const rels = decoded(anchor)
  if (!rels) return false
  for (let tries = 0; tries < 10; tries++) {
    const waiting = await as(ctx, async (tx) => {
      const rows = await rowsOf(tx, fileId)
      if (!rows.length) return false
      const doc = docOf(rows)
      const later = rels.some((r) => ahead(doc, r))
      doc.destroy()
      return later
    })
    if (!waiting) return true
    await new Promise((r) => setTimeout(r, 100))
  }
  return false
}

export async function anchorThread(tx: Tx, ctx: AuthContext, fileId: string, threadId: string, anchor: Anchor): Promise<string | null> {
  const rels = 'text' in anchor ? null : decoded(anchor)
  if (!('text' in anchor) && !rels) return null
  await lock(tx, fileId)
  let rows = await rowsOf(tx, fileId)
  if (!rows.length) {
    /* A document nobody has opened since co-editing: its state is made
       here, as opening it would make it. */
    const [f] = await tx<{ body: unknown; workspace_id: string }[]>`
      select body, workspace_id from file
      where id = ${fileId} and deleted_at is null and body is not null and storage_key is null and url is null`
    if (!f) return null
    await tx`insert into file_yjs (id, workspace_id, file_id, bytes, actor_id)
             values (${uuidv7()}, ${f.workspace_id}, ${fileId}, ${Buffer.from(stateFrom(f.body))}, null)`
    rows = await rowsOf(tx, fileId)
  }
  const doc = docOf(rows)
  try {
    const s = 'text' in anchor ? stretchOf(doc, anchor.text) : stretchAt(doc, anchor.from, anchor.to)
    if (!s) return null
    const words = wordsOf(doc, s)
    if (!words) return ''
    const before = Y.encodeStateVector(doc)
    markThread(doc, s, threadId)
    /* Under the same cap as every other write to the state. */
    if (Y.encodeStateAsUpdate(doc).length > STATE_MOST) throw new Refused('too_large')
    const u = Y.encodeStateAsUpdate(doc, before)
    await tx`insert into file_yjs (id, workspace_id, file_id, bytes, actor_id)
             values (${uuidv7()}, ${ctx.workspaceId}, ${fileId}, ${Buffer.from(u)}, ${ctx.actorId})`
    await publish(topicOf(fileId), 'yjs', word(u, 'api'), tx)
    /*
     * Not an edit of the words, and not authorised as one: the comment's
     * right (`content.create`, asked by `addComment`, and the file's own
     * read and update policies) is what lets a commenter who may not edit
     * mark the words they comment on. So it does not say `mayEdit` was
     * asked (`app.may_edit_file`): it keeps no revision, folds nothing, and
     * moves neither the version, the revision nor the clock Docs and the
     * public page read (migration 234).
     */
    /* Only the mark goes into the stored body — onto its words there, not
       the live words with it. The stored body stays the one its revision
       says, so a caller merging against that revision merges against what
       it read; the live words reach it when the room next writes it. */
    const [f] = await tx<{ body: unknown }[]>`select body from file where id = ${fileId} and deleted_at is null`
    const stored = f ? carryRich(bodyOf(doc), f.body, threadId) : null
    if (stored && JSON.stringify(stored) !== JSON.stringify(f!.body)) {
      await tx`select set_config('tracker.keep_clock', 'on', true)`
      await tx`update file set body = ${tx.json(stored as never)} where id = ${fileId} and deleted_at is null`
      await tx`select set_config('tracker.keep_clock', 'off', true)`
    }
    return words
  } finally {
    doc.destroy()
  }
}

/** The body a `PATCH` wrote, stored as an API write: its revision moves. Answers it. */
export async function storePatched(tx: Tx, fileId: string, body: unknown): Promise<number | null> {
  await proved(tx, fileId)
  return (await storeBody(tx, fileId, body, { bump: false, api: true }))?.rev ?? null
}

/* ---------------------------------------------------------------- carets */

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

function idOf(v: unknown): { client: number; clock: number } | null | undefined {
  if (v === null || v === undefined) return null
  if (!isObject(v)) return undefined
  const { client, clock } = v
  return typeof client === 'number' &&
    Number.isSafeInteger(client) &&
    client >= 0 &&
    typeof clock === 'number' &&
    Number.isSafeInteger(clock) &&
    clock >= 0
    ? { client, clock }
    : undefined
}

/** A Yjs relative position as `y-prosemirror` writes one, rebuilt from its parts; null when it is not one. */
function relpos(v: unknown): Record<string, unknown> | null {
  if (!isObject(v)) return null
  const type = idOf(v.type)
  const item = idOf(v.item)
  const tname = v.tname === null || v.tname === undefined ? null : typeof v.tname === 'string' && v.tname.length <= 64 ? v.tname : undefined
  const assoc =
    v.assoc === null || v.assoc === undefined ? 0 : typeof v.assoc === 'number' && Number.isSafeInteger(v.assoc) ? v.assoc : undefined
  if (type === undefined || item === undefined || tname === undefined || assoc === undefined) return null
  if (type === null && item === null && tname === null) return null
  return { type, tname, item, assoc }
}

/**
 * A caret as this server passes it on: `{ cursor: { anchor, head } | null }`
 * and nothing else, rebuilt rather than relayed. Undefined for anything that
 * is not one — `{ cursor: {} }` once threw inside every other editor in the
 * room, and in every page that joined after it.
 */
export function cleanCaret(s: unknown): { cursor: { anchor: unknown; head: unknown } | null } | null | undefined {
  if (s === null) return null
  if (!isObject(s)) return undefined
  if (s.cursor === null || s.cursor === undefined) return { cursor: null }
  if (!isObject(s.cursor)) return undefined
  const anchor = relpos(s.cursor.anchor)
  const head = relpos(s.cursor.head)
  return anchor && head ? { cursor: { anchor, head } } : undefined
}

/** A caret heard from another process: the same shape, with the name that process put on it. */
function cleanRemote(s: unknown): Record<string, unknown> | null | undefined {
  const c = cleanCaret(s)
  if (!c) return c
  const user = isObject(s) ? s.user : undefined
  if (!isObject(user) || typeof user.id !== 'string' || !UUID.test(user.id) || typeof user.name !== 'string' || user.name.length > 300)
    return undefined
  return { ...c, user: { id: user.id, name: user.name } }
}

/* ------------------------------------------------------------------ rooms */

/** A count over a sliding window of `ms`. */
class Window {
  private at = 0
  private n = 0
  constructor(private readonly ms: number) {}
  add(by = 1, now = Date.now()): number {
    if (now - this.at >= this.ms) {
      this.at = now
      this.n = 0
    }
    this.n += by
    return this.n
  }
}

export type Seat = {
  id: string
  ctx: AuthContext
  ws: WSContext
  /** Whether this socket's edits are taken. */
  write: boolean
  /** When `ctx` was last read. */
  read: number
  /** Told it is read-only, and sent the state afresh; not told twice. */
  told: boolean
  /** When it was last told the document is full. */
  fullAt: number
  name: string
  /** The Yjs client ids this socket has spoken for. */
  clients: Set<number>
  /** Its updates, one after the other. */
  queue: Promise<void>
  carets: Window
  frames: Window
  room: Room
  gone: boolean
}

type Caret = { s: Record<string, unknown>; owner: Seat | 'remote'; at: number }

const rooms = new Map<string, Room>()

/*
 * What a person may send into one document, however many sockets they
 * open on it: a budget per socket was a budget per reconnect, and the
 * second review filled a document from four of them.
 */
const budgets = new Map<string, { updates: Window; bytes: Window; at: number }>()
export function budgetOf(actorId: string, fileId: string) {
  const k = `${actorId}:${fileId}`
  const now = Date.now()
  let b = budgets.get(k)
  if (!b) {
    b = { updates: new Window(10_000), bytes: new Window(10_000), at: now }
    budgets.set(k, b)
    /* Forgotten once they could no longer refuse anything. */
    if (budgets.size > 1000) for (const [key, v] of budgets) if (now - v.at > 60_000) budgets.delete(key)
  }
  b.at = now
  return b
}

/**
 * The stored body written from a state it fell behind — a deploy or a
 * crash between an edit and its write. As the last person who edited the
 * document and may still, not as whoever opened it first, who may only
 * read; the revision does not move, as for any debounced write.
 */
async function repair(opener: AuthContext, fileId: string, f: Written): Promise<void> {
  /* Read as whoever opened it: who sent the newest edit not yet folded. */
  const [last] = await as(
    opener,
    (tx) =>
      tx<{ actor_id: string }[]>`
      select actor_id from file_yjs where file_id = ${fileId} and actor_id is not null
      order by created_at desc limit 1`,
  )
  for (const actorId of [last?.actor_id, f.author_id]) {
    if (!actorId) continue
    const ctx = await contextOf(actorId, opener.workspaceId)
    if (ctx && mayEdit(ctx, f.author_id, f.project_id ?? undefined)) {
      await writeBody(ctx, fileId, false)
      return
    }
  }
}

function send(seat: Seat, frame: unknown): void {
  if (seat.gone) return
  try {
    seat.ws.send(JSON.stringify(frame))
  } catch {
    // Closing; `leave` follows.
  }
}

class Room {
  doc = new Y.Doc({ gc: true })
  seats = new Set<Seat>()
  carets = new Map<number, Caret>()
  ready: Promise<boolean>
  author = ''
  project: string | undefined
  /** The state's encoded size, at least: counted up by each update, measured when it nears the cap. */
  size = 0
  private off: (() => void) | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private timerAt = 0
  private savedAt = 0
  private pending = false
  private unversioned = false
  private firstPending: number | null = null
  private bumpedAt = 0
  /** Updates taken, counted: which edits a write began after, and so may not have read. */
  private edits = 0
  /** Who edited since the last version, each with the count at their latest edit. */
  private editors = new Map<string, { ctx: AuthContext; at: number }>()
  private writing: Promise<void> = Promise.resolve()
  closed = false

  constructor(
    readonly fileId: string,
    ctx: AuthContext,
    f: Written,
  ) {
    this.author = f.author_id
    this.project = f.project_id ?? undefined
    /* Passed on to everybody in the room but whoever it came from. */
    this.doc.on('update', (u: Uint8Array, origin: unknown) => {
      const said = { t: 'u', u: b64(u) }
      for (const seat of this.seats) if (seat !== origin) send(seat, said)
    })
    this.ready = (async () => {
      /* Listening first, then reading: what is said in between is taken
         twice, which Yjs does not mind, rather than not at all. */
      this.off = await subscribe(topicOf(fileId), (e) => this.heard(e))
      const had = await ensureState(ctx, fileId)
      if (!had) return false
      Y.applyUpdate(this.doc, had.state, REMOTE)
      this.size = had.state.length
      /*
       * The stored body left behind — a deploy or a crash between an edit
       * and the write that would have followed it. Written now, from the
       * state, as nobody in particular's edit.
       */
      if (!sameBody(bodyOf(this.doc), had.body)) void repair(ctx, fileId, f).catch(() => {})
      return true
    })().catch(() => false)
  }

  private heard(e: Event): void {
    if (e.kind === 'again') return this.shut(1012, 'again')
    /* Who the document is for changed.
       Every seat is asked again now rather than at its next fifty-second
       check: somebody taken off it stops hearing its words at once. */
    if (e.kind === 'access') return void this.asked()
    const p = (e.payload ?? {}) as { from?: string; u?: string | null; c?: number; s?: unknown; version?: number }
    if (e.kind === 'saved') {
      if (typeof p.version === 'number') for (const seat of this.seats) send(seat, { t: 'saved', version: p.version })
      return
    }
    if (p.from === INSTANCE) return
    if (e.kind === 'yjs') {
      if (typeof p.u === 'string') {
        try {
          const u = fromB64(p.u)
          Y.applyUpdate(this.doc, u, REMOTE)
          this.size += u.length
          /* Another instance's update may have been a deletion. */
          this.tight = false
        } catch {
          void this.catchUp()
        }
      } else void this.catchUp()
      return
    }
    if (e.kind === 'aw' && typeof p.c === 'number' && Number.isSafeInteger(p.c)) {
      const was = this.carets.get(p.c)
      if (was && was.owner !== 'remote') return
      const s = cleanRemote(p.s)
      if (s === undefined) return
      if (s) this.carets.set(p.c, { s, owner: 'remote', at: Date.now() })
      else this.carets.delete(p.c)
      for (const seat of this.seats) send(seat, { t: 'aw', c: p.c, s })
    }
  }

  /** Each seat asked whether it may still read the document; one that may not is closed as not found. */
  private async asked(): Promise<void> {
    for (const seat of [...this.seats]) {
      const still = await readable(seat.ctx, this.fileId).catch(() => null)
      if (still) continue
      try {
        seat.ws.close(4404, 'not found')
      } catch {
        // Already going.
      }
      await this.leave(seat)
    }
  }

  /** Read the state again and take what this room was missing — as somebody who can still read it. */
  private async catchUp(): Promise<void> {
    for (const seat of this.seats) {
      try {
        const rows = await as(seat.ctx, async (tx) => {
          const [f] = await tx`select 1 from file where id = ${this.fileId} and deleted_at is null`
          return f ? rowsOf(tx, this.fileId) : null
        })
        if (!rows) continue
        if (rows.length) {
          const doc = docOf(rows)
          Y.applyUpdate(this.doc, Y.encodeStateAsUpdate(doc), REMOTE)
          doc.destroy()
        }
        return
      } catch {
        // The next one.
      }
    }
  }

  /** Everything, for a socket that has just come in or has to start over. */
  sync(seat: Seat): void {
    send(seat, {
      t: 'sync',
      u: b64(Y.encodeStateAsUpdate(this.doc)),
      sv: b64(Y.encodeStateVector(this.doc)),
      write: seat.write,
    })
  }

  /** Rights read again when they are older than a few seconds, then `mayEdit` — every update. */
  async rights(seat: Seat): Promise<boolean> {
    if (Date.now() - seat.read > RIGHTS_FRESH) {
      const fresh = await again(seat.ctx)
      seat.read = Date.now()
      if (!fresh) {
        seat.ws.close(4401, 'ended')
        return false
      }
      seat.ctx = fresh
    }
    seat.write = mayEdit(seat.ctx, this.author, this.project)
    if (seat.write) seat.told = false
    return seat.write
  }

  /** Not yours to change: said once, and the page is put back to the server's words. */
  refuse(seat: Seat): void {
    if (seat.told) return
    seat.told = true
    send(seat, { t: 'ro' })
    this.sync(seat)
  }

  /** Full: said, and the page put back, at most every three seconds. */
  private full(seat: Seat): void {
    const now = Date.now()
    if (now - seat.fullAt < 3000) return
    seat.fullAt = now
    send(seat, { t: 'full' })
    this.sync(seat)
  }

  /**
   * Whether an update would take the state past the cap.
   *
   * Not by applying it to a copy and measuring — the third review found
   * that 226 ms an update on a 5.8 MB document, the refused ones included,
   * so one person typing in a full document held the event loop. `size` is
   * kept as an upper bound: every update taken adds its length, and the
   * state is encoded and measured only when that bound reaches the line,
   * at most every two seconds, and never again while nothing taken since
   * could have made it smaller. An update that carries no structs — a
   * deletion only — cannot make the state larger, and is taken past the
   * cap without measuring, which is how a full document is made smaller;
   * the bound is then known to be loose, and the next look measures. Once
   * the measured size and an update with structs are over the line, it is
   * refused on that alone.
   */
  private measuredAt = 0
  /** Nothing taken since the last measuring could have made the state smaller. */
  private tight = false
  private tooLarge(u: Uint8Array): boolean {
    if (this.size + u.length <= STATE_MOST) return false
    const { structs } = Y.decodeUpdate(u)
    if (structs.length === 0) {
      this.tight = false
      return false
    }
    if (!this.tight && Date.now() - this.measuredAt >= 2000) {
      this.size = Y.encodeStateAsUpdate(this.doc).length
      this.measuredAt = Date.now()
      this.tight = true
    }
    return this.size + u.length > STATE_MOST
  }

  /** Put back to the server's words without a word — an update that did not fit what it built on. */
  private reset(seat: Seat): void {
    const now = Date.now()
    if (now - seat.fullAt < 3000) return
    seat.fullAt = now
    send(seat, { t: 'reset' })
    this.sync(seat)
  }

  async take(seat: Seat, raw: unknown): Promise<void> {
    if (seat.gone) return
    if (typeof raw !== 'string' || raw.length > MAX_UPDATE) {
      seat.ws.close(1009, 'too large')
      return
    }
    const spent = budgetOf(seat.ctx.actorId, this.fileId)
    if (spent.updates.add() > UPDATES_EACH || spent.bytes.add(raw.length) > BYTES_EACH) {
      seat.ws.close(4429, 'too many')
      return
    }
    if (!(await this.rights(seat))) return this.refuse(seat)
    let u: Uint8Array
    try {
      u = fromB64(raw)
      if (isEmpty(u)) return
    } catch {
      seat.ws.close(1007, 'malformed')
      return
    }
    if (strays(this.doc, u)) return this.reset(seat)
    if (this.tooLarge(u)) return this.full(seat)
    try {
      await keep(seat.ctx, this.fileId, u)
    } catch {
      /* The database said no — the file is no longer theirs to see — or
         could not be reached. The page opens again either way and sends
         what the server lacks; a refusal is told so for good. */
      const still = await readable(seat.ctx, this.fileId).catch(() => null)
      seat.ws.close(still ? 1011 : 4404, still ? 'unavailable' : 'not found')
      return
    }
    try {
      Y.applyUpdate(this.doc, u, seat)
      this.size += u.length
    } catch {
      // Kept, and folded with the rest when the body is written.
    }
    this.changed(seat.ctx)
  }

  /** A caret, rebuilt, with the name the server knows the person by. At most ten a second. */
  caret(seat: Seat, c: unknown, s: unknown): void {
    if (typeof c !== 'number' || !Number.isSafeInteger(c) || c < 0) return
    const clean = cleanCaret(s)
    if (clean === undefined) return
    if (seat.carets.add() > CARETS_EACH) return
    const was = this.carets.get(c)
    if (was && was.owner !== seat) return
    if (!seat.clients.has(c) && seat.clients.size >= 8) return
    seat.clients.add(c)
    this.say(c, clean ? { ...clean, user: { id: seat.ctx.actorId, name: seat.name } } : null, seat)
  }

  private say(c: number, state: Record<string, unknown> | null, seat: Seat): void {
    if (state) this.carets.set(c, { s: state, owner: seat, at: Date.now() })
    else this.carets.delete(c)
    for (const other of this.seats) if (other !== seat) send(other, { t: 'aw', c, s: state })
    void publish(topicOf(this.fileId), 'aw', { from: INSTANCE, c, s: state }).catch(() => {})
  }

  private schedule(wait: number): void {
    const at = Date.now() + wait
    if (this.timer && this.timerAt <= at) return
    if (this.timer) clearTimeout(this.timer)
    this.timerAt = at
    this.timer = setTimeout(() => void this.save(false), wait)
  }

  private changed(ctx: AuthContext): void {
    this.pending = true
    this.unversioned = true
    this.edits++
    /* Taken out and put back, so the latest editor is last. */
    this.editors.delete(ctx.actorId)
    this.editors.set(ctx.actorId, { ctx, at: this.edits })
    const now = Date.now()
    this.firstPending ??= now
    const wait = Math.max(0, Math.min(SETTLE_AFTER, this.firstPending + SETTLE_AT_MOST - now))
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.schedule(wait)
  }

  /**
   * Soon, rather than in a moment — somebody left the body. Never sooner
   * than a second after the last write, however often it is asked: a
   * settle is a request to write the row, and a page saying it in a loop
   * was a write per frame.
   */
  settle(): void {
    if (!this.pending) return
    this.schedule(Math.max(SETTLE_SOON, this.savedAt + SETTLE_GAP - Date.now()))
  }

  /**
   * The body written from the state; the version moved on the first write,
   * then at most every five minutes, and when the last person leaves.
   */
  save(leaving: boolean): Promise<void> {
    this.writing = this.writing.then(async () => {
      if (!this.pending && !(leaving && this.unversioned)) return
      if (this.timer) clearTimeout(this.timer)
      this.timer = null
      this.pending = false
      this.firstPending = null
      this.savedAt = Date.now()
      const bump = this.unversioned && (leaving || Date.now() - this.bumpedAt >= VERSION_EVERY)
      /*
       * What this write has surely read: every update taken before it
       * began. One taken while it is under way may be in the rows it
       * reads or not, and is the next write's — so once the version moves
       * only the editors up to here are let go, and the state is called
       * versioned only if nothing came since. Clearing them all dropped
       * whoever typed during a slow write: the next write found nobody to
       * write as, and the body and its fold waited for somebody else's
       * edit.
       */
      const upTo = this.edits
      /* As somebody who edited, the latest first: one taken off the
         project since cannot write the row, and the next can. */
      const who = [...this.editors.values()].reverse()
      for (const { ctx } of who) {
        try {
          const done = await writeBody(ctx, this.fileId, bump, [...this.editors.keys()])
          if (done && bump) {
            this.bumpedAt = Date.now()
            if (this.edits === upTo) this.unversioned = false
            const edited: AuthContext[] = []
            for (const [actorId, e] of this.editors) {
              if (e.at > upTo) continue
              edited.push(e.ctx)
              this.editors.delete(actorId)
            }
            for (const e of edited) {
              await as(e, (tx) =>
                record(tx, e, 'file.update', { projectId: done.projectId, objectType: 'file', objectId: this.fileId }),
              ).catch(() => {})
              /* And counted as the feed has it: once a person, once a
                 version. */
              edition.used({
                workspaceId: e.workspaceId,
                actorId: e.actorId,
                method: 'WS',
                route: 'doc',
                status: 200,
                said: 'doc.edit',
                tool: null,
              })
            }
          }
          return
        } catch {
          // The next one.
        }
      }
      /* Nobody could: tried again at the next edit. */
      this.pending = true
    })
    return this.writing
  }

  async leave(seat: Seat): Promise<void> {
    seat.gone = true
    if (!this.seats.delete(seat)) return
    for (const c of seat.clients) {
      if (this.carets.get(c)?.owner === seat) this.say(c, null, seat)
    }
    if (this.seats.size > 0) return
    await this.save(true)
    if (this.seats.size === 0) this.dispose()
  }

  private shut(code: number, reason: string): void {
    for (const seat of this.seats) {
      try {
        seat.ws.close(code, reason)
      } catch {
        // Already going.
      }
    }
  }

  dispose(): void {
    if (this.closed) return
    this.closed = true
    if (rooms.get(this.fileId) === this) rooms.delete(this.fileId)
    if (this.timer) clearTimeout(this.timer)
    this.off?.()
    this.doc.destroy()
  }
}

/**
 * A socket into a document: the same question an HTTP read asks, then
 * everything the room holds. Null is a refusal, and the caller closes 4404.
 */
export async function join(ctx: AuthContext, fileId: string, ws: WSContext): Promise<Seat | null> {
  const f = await readable(ctx, fileId)
  if (!f) return null
  let room = rooms.get(fileId)
  if (!room) {
    room = new Room(fileId, ctx, f)
    rooms.set(fileId, room)
  }
  if (!(await room.ready)) {
    room.dispose()
    return null
  }
  /* Let go between the two: the last person left as this one arrived. */
  if (room.closed) return join(ctx, fileId, ws)
  const seat: Seat = {
    id: randomUUID(),
    ctx,
    ws,
    write: mayEdit(ctx, f.author_id, f.project_id ?? undefined),
    read: Date.now(),
    told: false,
    fullAt: 0,
    name: f.me ?? '',
    clients: new Set(),
    queue: Promise.resolve(),
    carets: new Window(1000),
    frames: new Window(1000),
    room,
    gone: false,
  }
  room.seats.add(seat)
  room.sync(seat)
  const now = Date.now()
  for (const [c, caret] of room.carets) {
    if (caret.owner === 'remote' && now - caret.at > 35_000) room.carets.delete(c)
    else send(seat, { t: 'aw', c, s: caret.s })
  }
  return seat
}

/** A frame from the page. A socket that floods with them of any kind is closed. */
export function heard(seat: Seat, frame: string): void {
  if (seat.gone) return
  if (seat.frames.add() > FRAMES_EACH) {
    seat.ws.close(4429, 'too many')
    return
  }
  let m: { t?: unknown; u?: unknown; c?: unknown; s?: unknown }
  try {
    m = JSON.parse(frame)
  } catch {
    return
  }
  if (!isObject(m)) return
  const room = seat.room
  if (m.t === 'u') {
    seat.queue = seat.queue.then(() => room.take(seat, m.u)).catch(() => {})
  } else if (m.t === 'aw') {
    room.caret(seat, m.c, m.s)
  } else if (m.t === 'settle' && seat.write) {
    /* After the updates sent before it; a reader has nothing to settle. */
    seat.queue = seat.queue.then(() => room.settle()).catch(() => {})
  }
}

/**
 * Asked every fifty seconds with the socket's other question: still able to
 * read it, and whether the right to edit came or went in the meantime.
 */
export async function recheck(seat: Seat): Promise<boolean> {
  const fresh = await again(seat.ctx)
  if (!fresh) return false
  seat.ctx = fresh
  seat.read = Date.now()
  if (!(await readable(fresh, seat.room.fileId))) return false
  const was = seat.write
  const now = await seat.room.rights(seat)
  if (was && !now) seat.room.refuse(seat)
  else if (!was && now) seat.room.sync(seat)
  return true
}

export function leave(seat: Seat): Promise<void> {
  return seat.room.leave(seat).catch(() => {})
}

/**
 * Every open document written now, its version moved if it changed — on
 * the way down (`SIGTERM` in `main.ts`), so a deploy does not leave the
 * stored body seconds behind the people who were typing.
 */
export async function settleAll(): Promise<void> {
  await Promise.all([...rooms.values()].map((r) => r.save(true).catch(() => {})))
}

/** For the tests: the rooms open in this process. */
export function openRooms(): number {
  return rooms.size
}
