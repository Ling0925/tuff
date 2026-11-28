import { api } from './api.js'
import { onHost } from './host.js'
import { recall, remember } from './memory.js'
import { edition } from '../edition.jsx'
import { membersDoor } from './doors.js'

/**
 * Reads asked before the screen that needs them.
 *
 * A settings screen is a stack of sections, each asking its own question,
 * and each drew itself when its answer landed: one arrived after the
 * page had, and pushed everything under it down. Now the door to a screen
 * asks its questions while the pointer is on it, the screen waits for them
 * — four hundred milliseconds at most — before it draws, and every section
 * starts from the last answer it was given, so the second visit is whole at
 * once.
 *
 * One request per question at a time: a section asking what the door
 * already asked joins that request rather than sending another.
 */
const flying = new Map<string, Promise<unknown>>()

const key = (path: string) => `ahead:${path}`

/**
 * The answer, fresh — joining a request already on its way for it.
 *
 * `again` after a write: a read already on its way may have been sent
 * before the write and would answer with what was there before it. Triage
 * switched on was remembered as off, because nothing read the lists after
 * the press, and the next visit drew the switch off and a press turned it
 * on again (the Triage browser test, once in every full run). A read sent
 * later has the last word: an earlier one landing after it is not kept.
 */
export function ahead<T>(path: string, again = false): Promise<T> {
  const was = flying.get(path) as Promise<T> | undefined
  if (was && !again) return was
  const asking: Promise<T> = api<T>(path)
    .then((v) => (flying.get(path) === asking ? remember(key(path), v) : v))
    .finally(() => {
      if (flying.get(path) === asking) flying.delete(path)
    })
  flying.set(path, asking)
  return asking
}

/** The last answer to it, if there has been one. */
export function known<T>(path: string): T | null {
  return recall<T>(key(path))
}

/** An answer the screen already has — a write's, which says the whole —
    kept as the last one, so the next visit opens on it. */
export function know<T>(path: string, value: T): T {
  return remember(key(path), value)
}

/** Ask all of them now, for a screen about to open; nothing waits on it. */
export function warm(paths: string[]): void {
  for (const p of paths) void ahead(p).catch(() => {})
}

/**
 * Whether a screen may draw: every answer it needs is in hand, or four
 * hundred milliseconds have gone by. Known answers make it true at once.
 */
export function whenRead(paths: string[], ms = 400, also: Promise<unknown>[] = []): Promise<void> {
  if (also.length === 0 && paths.every((p) => known(p) !== null)) return Promise.resolve()
  return Promise.race([
    Promise.allSettled([...paths.map((p) => ahead(p)), ...also]).then(() => undefined),
    new Promise<void>((r) => setTimeout(r, ms)),
  ])
}

/* What each settings screen reads, said once for the door and the screen. */
export const workspaceSettingsReads = (can: string[]) => [
  /* What the edition puts in the settings beside the core's — `edition.tsx`. */
  ...edition.settingsReads(can),
  ...(can.includes('workspace.transfer') ? ['/people', '/me/email'] : []),
  ...(can.includes('audit.read') ? ['/webhooks', '/github', '/github/me', '/slack', '/import/linear'] : []),
]
export const projectSettingsReads = (id: string, can: string[]) => [
  `/projects/${id}/members`,
  `/projects/${id}/lists`,
  `/projects/${id}/labels`,
  `/projects/${id}/cycles`,
  `/time?project=${id}`,
  `/spend?project=${id}`,
  '/github',
  `/projects/${id}/github`,
  '/slack',
  `/projects/${id}/slack`,
  `/projects/${id}/feedback`,
  ...(can.includes('people.read') ? ['/people'] : []),
]
/* Members: the agents beside the people, and the invitations still out —
   each its own group in the column, which grew in under the people a beat
   after them. The people themselves
   come with the shell. */
export const membersReads = (can: string[]) => [
  ...(membersDoor(can) ? ['/agents'] : []),
  ...(can.includes('people.invite') ? ['/invites'] : []),
]
/* Your own server's owner screen. */
export const instanceReads = ['/instance']
/* On a workspace's own domain Account holds the face and the language, and
   asks nothing that belongs to the account. */
export const accountReads = (can: string[]) =>
  onHost()
    ? []
    : ['/me/email', '/me/ways-in', '/github/me', '/2fa', '/inbox/settings', '/sessions', ...(can.includes('agent.use') ? ['/tokens'] : [])]
