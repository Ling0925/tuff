import * as Y from 'yjs'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { keepOpen } from './socket.js'
import { drawable } from './coeditCheck.js'

/*
 * A document written together.
 *
 * The page's half of the room: a Yjs document kept in step with the
 * server's over `/ws/docs/:id`, and who else is in it. The editor binds to
 * `doc` through `ui/editor/collab.ts`; nothing here knows about the editor.
 */

/** What comes from the server rather than from this page. */
export const REMOTE = Symbol('remote')
/** The fragment the editor binds to — `FRAGMENT` in `server/src/yjson.ts`. */
export const FRAGMENT = 'default'
/** Edits made inside this window go to the server as one. */
const BATCH = 30
/** A caret goes out at most this often — the server passes on ten a second. */
const CARET_EVERY = 120
/** A caret said again this often, and dropped when not heard of for longer than this. */
const CARET_AGAIN = 15_000
const CARET_GONE = 35_000

const b64 = (u: Uint8Array) => {
  let s = ''
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000))
  return btoa(s)
}
const fromB64 = (s: string) => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0))

const hasAnything = (u: Uint8Array) => {
  const { structs, ds } = Y.decodeUpdate(u)
  return structs.length > 0 || ds.clients.size > 0
}

type CaretState = Record<string, unknown> & { user?: { id?: string; name?: string } }
type Change = { added: number[]; updated: number[]; removed: number[] }

/**
 * Who else is in the document and where their caret is — the shape
 * `y-prosemirror`'s caret plugin reads (`getStates`, `getLocalState`,
 * `setLocalStateField`, `on('change')`), without `y-protocols`' wire format:
 * a caret travels as one JSON frame, and the server puts the name on it.
 */
export class Carets {
  readonly clientID: number
  private states = new Map<number, CaretState>()
  private heardAt = new Map<number, number>()
  private local: CaretState | null = {}
  private listeners = new Map<string, Set<(change: Change, origin: unknown) => void>>()

  constructor(
    readonly doc: Y.Doc,
    private readonly say: (state: CaretState | null) => void,
  ) {
    this.clientID = doc.clientID
  }

  getLocalState(): CaretState | null {
    return this.local
  }

  setLocalState(state: CaretState | null): void {
    this.local = state
    this.say(state)
  }

  setLocalStateField(field: string, value: unknown): void {
    this.setLocalState({ ...(this.local ?? {}), [field]: value })
  }

  /** Everybody else's — this page's own is never drawn. */
  getStates(): Map<number, CaretState> {
    return this.states
  }

  on(event: string, fn: (change: Change, origin: unknown) => void): void {
    const set = this.listeners.get(event) ?? new Set()
    set.add(fn)
    this.listeners.set(event, set)
  }

  off(event: string, fn: (change: Change, origin: unknown) => void): void {
    this.listeners.get(event)?.delete(fn)
  }

  private emit(change: Change): void {
    for (const event of ['change', 'update']) for (const fn of this.listeners.get(event) ?? []) fn(change, REMOTE)
  }

  /** Somebody's caret, or their leaving. */
  heard(c: number, s: CaretState | null): void {
    if (c === this.clientID) return
    if (s && !drawable(this.doc, s)) return
    const had = this.states.has(c)
    if (s) {
      this.states.set(c, s)
      this.heardAt.set(c, Date.now())
      this.emit({ added: had ? [] : [c], updated: had ? [c] : [], removed: [] })
    } else if (had) {
      this.states.delete(c)
      this.heardAt.delete(c)
      this.emit({ added: [], updated: [], removed: [c] })
    }
  }

  /** A page closed without a word leaves no caret behind. */
  sweep(): void {
    const now = Date.now()
    for (const [c, at] of this.heardAt) if (now - at > CARET_GONE) this.heard(c, null)
  }

  forgetAll(): void {
    for (const c of [...this.states.keys()]) this.heard(c, null)
  }
}

export type Live = {
  /** A new document when the server put this page back to its words. */
  doc: Y.Doc
  carets: Carets
  /** Synced with the server at least once on this document. */
  ready: boolean
  /** Whether this page's edits are taken. */
  write: boolean
  /** The version as the server last said it. */
  version: number | null
  /** Edits the server has not taken: made while the connection was down. */
  unsent: boolean
  /** Counts the documents this session has had, for the editor's key. */
  generation: number
  /** The document is at its size limit: only taking things out is saved. */
  full: boolean
  /** This page does not know a block the document holds, and stopped writing until it is reloaded. */
  muted: boolean
}

/**
 * A session on one document: the socket, the shared document, the carets.
 * `leave` closes it.
 */
export function join(fileId: string) {
  let state: Live
  const listeners = new Set<() => void>()
  const tell = () => {
    state = { ...state }
    for (const fn of listeners) fn()
  }

  /* Whether the socket is open and has had this connection's `sync`. */
  let synced = false
  /* Told it is read-only: the next `sync` starts a new document. */
  let fresh = false
  let queue: Uint8Array[] = []
  let timer: ReturnType<typeof setTimeout> | null = null
  let caretTimer: ReturnType<typeof setTimeout> | null = null
  let caretWaiting = false
  /* What the server said, apart from what this page decided: a page that
     does not know a block the document holds stops sending (`mute`). */
  let allowed = false
  let muted = false
  let fullTimer: ReturnType<typeof setTimeout> | null = null
  /* Asked of every update before it is applied: whether it holds something
     the editor cannot draw. Set by the editor once its schema is known. */
  let strange: ((u: Uint8Array) => boolean) | null = null
  const apply = (u: Uint8Array) => {
    if (!muted && strange?.(u)) mute()
    Y.applyUpdate(state.doc, u, REMOTE)
  }
  const mute = () => {
    /* At once, so nothing the editor does to its copy on the way in is
       sent; the screen is told after, as this can be asked while the
       editor is being made. */
    muted = true
    queue = []
    if (state.write || !state.muted) {
      state.write = false
      state.muted = true
      queueMicrotask(tell)
    }
  }

  const flush = () => {
    timer = null
    if (!synced || !state.write || queue.length === 0) return
    const u = queue.length === 1 ? queue[0]! : Y.mergeUpdates(queue)
    queue = []
    socket.send(JSON.stringify({ t: 'u', u: b64(u) }))
  }

  /* At most one caret frame in a batch's window; the latest wins. */
  const sayCaret = () => {
    if (caretTimer) {
      caretWaiting = true
      return
    }
    if (synced) socket.send(JSON.stringify({ t: 'aw', c: state.doc.clientID, s: state.carets.getLocalState() }))
    caretTimer = setTimeout(() => {
      caretTimer = null
      if (caretWaiting) {
        caretWaiting = false
        sayCaret()
      }
    }, CARET_EVERY)
  }

  const make = (generation: number): Live => {
    const doc = new Y.Doc()
    doc.on('update', (u: Uint8Array, origin: unknown) => {
      if (origin === REMOTE || doc !== state?.doc) return
      /* A reader's page never sends: what the editor does to its own copy
         on the way in is not an edit. */
      if (!state.write) return
      if (!synced) {
        if (!state.unsent) {
          state.unsent = true
          tell()
        }
        return
      }
      queue.push(u)
      timer ??= setTimeout(flush, BATCH)
    })
    const carets = new Carets(doc, () => sayCaret())
    return { doc, carets, ready: false, write: false, version: null, unsent: false, generation, full: false, muted }
  }
  state = make(0)

  const onWord = (ev: MessageEvent) => {
    let m: { t?: string; u?: string; sv?: string; write?: boolean; c?: number; s?: CaretState | null; version?: number }
    try {
      m = JSON.parse(String(ev.data))
    } catch {
      return
    }
    if (m.t === 'sync' && typeof m.u === 'string' && typeof m.sv === 'string') {
      /* Put back to the server's words, or let in to write after reading:
         either way a new document, so nothing this page did to its copy
         while it could not write is sent as an edit. */
      if (fresh || (state.ready && !allowed && m.write === true)) {
        fresh = false
        state.carets.forgetAll()
        state.doc.destroy()
        state = make(state.generation + 1)
      }
      apply(fromB64(m.u))
      allowed = m.write === true
      state.write = allowed && !muted
      synced = true
      queue = []
      /* What this page has and the server lacks: edits made while the
         connection was down, or sent into a socket that was closing. */
      if (state.write) {
        const mine = Y.encodeStateAsUpdate(state.doc, fromB64(m.sv))
        if (hasAnything(mine)) socket.send(JSON.stringify({ t: 'u', u: b64(mine) }))
      }
      state.unsent = false
      state.ready = true
      sayCaret()
      tell()
      return
    }
    if (m.t === 'u' && typeof m.u === 'string') {
      try {
        apply(fromB64(m.u))
      } catch {
        // A word that does not apply is one the next `sync` makes whole.
      }
      return
    }
    if (m.t === 'aw' && typeof m.c === 'number') return state.carets.heard(m.c, m.s ?? null)
    if (m.t === 'saved' && typeof m.version === 'number') {
      state.version = m.version
      tell()
      return
    }
    if (m.t === 'full') {
      /* Refused for size: the `sync` after it puts this page back. */
      fresh = true
      state.full = true
      tell()
      /* Said for a while after the last refusal, not for ever: taking
         things out is saved, and the next refusal says it again. */
      if (fullTimer) clearTimeout(fullTimer)
      fullTimer = setTimeout(() => {
        state.full = false
        tell()
      }, 8000)
      return
    }
    if (m.t === 'reset') {
      /* An update this page sent did not fit what the server has: the
         `sync` after it starts this page again from the server's words. */
      fresh = true
      return
    }
    if (m.t === 'ro') {
      fresh = true
      allowed = false
      state.write = false
      tell()
    }
  }

  const socket = keepOpen(
    `/ws/docs/${fileId}`,
    onWord,
    () => {},
    () => {
      synced = false
      state.carets.forgetAll()
    },
  )

  const again = setInterval(() => {
    state.carets.sweep()
    if (synced) socket.send(JSON.stringify({ t: 'aw', c: state.doc.clientID, s: state.carets.getLocalState() }))
  }, CARET_AGAIN)

  return {
    get: () => state,
    subscribe(fn: () => void) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    /** This page cannot be trusted to write the document: it stops sending. */
    mute,
    /** What the editor cannot draw, asked of every update before it lands. */
    guard(fn: (u: Uint8Array) => boolean) {
      strange = fn
    },
    /** Left the body: written now rather than in a moment. */
    settle() {
      if (timer) {
        clearTimeout(timer)
        flush()
      }
      if (synced) socket.send(JSON.stringify({ t: 'settle' }))
    },
    leave() {
      if (timer) clearTimeout(timer)
      flush()
      clearInterval(again)
      if (caretTimer) clearTimeout(caretTimer)
      if (fullTimer) clearTimeout(fullTimer)
      socket.send(JSON.stringify({ t: 'aw', c: state.doc.clientID, s: null }))
      socket.stop()
      listeners.clear()
      state.doc.destroy()
    },
  }
}

export type Session = ReturnType<typeof join>

/** The session for the document on the screen, opened with it and closed when it goes. */
export function useCoedit(fileId: string | null): { session: Session | null; live: Live | null } {
  const [session, setSession] = useState<Session | null>(null)
  useEffect(() => {
    if (!fileId) return
    const s = join(fileId)
    setSession(s)
    return () => {
      s.leave()
      setSession(null)
    }
  }, [fileId])
  const live = useSyncExternalStore(
    (fn) => session?.subscribe(fn) ?? (() => {}),
    () => session?.get() ?? null,
  )
  return { session, live }
}
