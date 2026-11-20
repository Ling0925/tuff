import { asWorker, withActor } from './db.js'
import { edition } from './edition.js'
import { env } from './env.js'
import { COMMIT, VERSION } from './version.js'

/*
 * "A new version is out", on a server of one's own.
 *
 * Once a day the community edition's worker asks GitHub for the latest
 * release of `usetuff/tuff`: one unauthenticated GET, `User-Agent:
 * Tuff/<version>` and nothing else about the server, ten seconds at most,
 * and a failure is a line in nobody's log. `UPDATE_CHECK=off` stops it
 * before anything is sent. The owners' Server settings say what it found.
 *
 * Nothing here runs on the service: the worker's job is the community
 * edition's (`edition.community.ts`), and every function below asks
 * `edition.instance` again, so a job put in the wrong list still sends
 * nothing.
 */

export const RELEASES_LATEST = 'https://api.github.com/repos/usetuff/tuff/releases/latest'

/** What a release is, as the server keeps it. */
export type Release = { version: string; url: string; published_at: string | null; security: boolean }

/** What the owners' screen is told about versions — `ServerVersion` in shared-schema. */
export type ServerVersion = {
  current: string
  commit: string
  /** Whether the daily check runs — false with `UPDATE_CHECK=off`. */
  check: boolean
  /** A release newer than this one, or null when there is none to tell. */
  latest: Release | null
  /** The last update, until an owner dismisses it — `backup.ts`. */
  updated: ServerUpdate | null
}

/** What the last update did — `ServerUpdate` in shared-schema. */
export type ServerUpdate = {
  from: string | null
  to: string
  at: string
  backup: string | null
  no_backup: 'skipped' | 'no_folder' | 'not_a_volume' | 'postgres_newer' | null
  migrations: number
  notes: string | null
}

/** The version this server runs. A test sets it; nothing else does. */
export const running = { version: VERSION, commit: COMMIT }

const SEMVER = /^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/

/** `X.Y.Z` as three numbers, or null for anything else — a `v`, a pre-release, a build. */
export function parseVersion(v: string): [number, number, number] | null {
  const m = SEMVER.exec(v)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

/** A version something was released as: plain `X.Y.Z`, and not `0.0.0`. */
function released(v: string): [number, number, number] | null {
  const p = parseVersion(v)
  return p && (p[0] || p[1] || p[2]) ? p : null
}

/**
 * Whether `latest` is newer than `current`, part by part as numbers —
 * `1.10.0` is newer than `1.9.9`, which a comparison of strings gets wrong.
 * False when either is not a plain version, and false at `0.0.0`: nothing
 * has been released from that build, which is a developer's checkout or a
 * tree built before the first release, and a notice there tells nobody
 * anything they can act on.
 */
export function isNewer(latest: string, current: string): boolean {
  const a = parseVersion(latest)
  const b = released(current)
  if (!a || !b) return false
  for (let i = 0; i < 3; i++) {
    if (a[i]! !== b[i]!) return a[i]! > b[i]!
  }
  return false
}

/**
 * The marker of a security release:
 * its notes, the changelog's section, have a `### Security`
 * heading, Keep a Changelog's own category for fixed vulnerabilities.
 * Anywhere from `##` to `####`, any case, nothing after the word.
 */
export function isSecurityRelease(notes: string): boolean {
  return /^#{2,4}[ \t]+security[ \t]*$/im.test(notes)
}

const RELEASE_PAGE = /^https:\/\/github\.com\/usetuff\/tuff\/releases\/[A-Za-z0-9._/-]{1,200}$/

/**
 * GitHub's answer as a release, or null when it is not one this server
 * would show: a tag that is not `vX.Y.Z`, a page that is not under
 * `usetuff/tuff`'s releases, a draft or a pre-release. The database checks
 * the version and the page again.
 */
export function readRelease(body: unknown): Release | null {
  if (!body || typeof body !== 'object') return null
  const r = body as Record<string, unknown>
  if (r.draft === true || r.prerelease === true) return null
  const tag = typeof r.tag_name === 'string' ? r.tag_name : ''
  const version = tag.startsWith('v') ? tag.slice(1) : ''
  if (!parseVersion(version)) return null
  const url = typeof r.html_url === 'string' ? r.html_url : ''
  if (!RELEASE_PAGE.test(url)) return null
  const published = typeof r.published_at === 'string' && !Number.isNaN(Date.parse(r.published_at)) ? r.published_at : null
  const notes = typeof r.body === 'string' ? r.body : ''
  return { version, url, published_at: published, security: isSecurityRelease(notes) }
}

/** Why a check did not ask, or that it did. */
export type CheckSaid = 'service' | 'off' | 'unreleased' | 'not_due' | 'heard' | 'failed'

export type CheckDeps = {
  instance: boolean
  enabled: boolean
  version: string
  /** Whether a day has gone by since the last ask — the database's to say. */
  due: () => Promise<boolean>
  fetch: typeof fetch
  /** What was heard; null is a check that came to nothing. */
  keep: (r: Release | null) => Promise<void>
}

/**
 * The check itself, with what it reads handed in so a test can say every
 * part. Asks nothing on the service, nothing when it is off, nothing from
 * a build at `0.0.0`, and nothing when it asked in the last day. Never
 * throws: whatever goes wrong is a check that came to nothing.
 */
export async function checkForRelease(d: CheckDeps): Promise<CheckSaid> {
  if (!d.instance) return 'service'
  if (!d.enabled) return 'off'
  if (!released(d.version)) return 'unreleased'
  try {
    if (!(await d.due())) return 'not_due'
  } catch {
    return 'failed'
  }
  let heard: Release | null = null
  try {
    const r = await d.fetch(RELEASES_LATEST, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': `Tuff/${d.version}` },
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    })
    if (r.ok) heard = readRelease(await r.json())
  } catch {
    heard = null
  }
  try {
    await d.keep(heard)
  } catch {
    return 'failed'
  }
  return heard ? 'heard' : 'failed'
}

/** The worker's job: hourly, and the database says whether a day has passed. */
export const releaseCheck = {
  every: 60 * 60 * 1000,
  run: async (): Promise<void> => {
    await checkForRelease({
      instance: edition.instance,
      enabled: env.updateCheck,
      version: running.version,
      due: () => asWorker(async (tx) => (await tx<{ due: boolean | null }[]>`select instance_release_due() as due`)[0]?.due === true),
      fetch: (...a) => fetch(...a),
      keep: (r) =>
        asWorker(async (tx) => {
          await tx`select instance_release_heard(${r?.version ?? null}, ${r?.url ?? null}, ${r?.published_at ?? null}, ${r?.security ?? null})`
        }),
    })
  },
}

/**
 * What an owner is told — Server settings, and `/api/me` for the dot on
 * their face. The caller has asked `can(…, 'instance')`; the database asks
 * `is_instance_owner()` again and answers null to anybody else.
 */
export async function serverVersion(actorId: string, workspaceId: string): Promise<ServerVersion> {
  const check = env.updateCheck
  let latest: Release | null = null
  let updated: Omit<ServerUpdate, 'notes'> | null = null
  if (edition.instance) {
    const [r] = await withActor(
      actorId,
      workspaceId,
      (tx) => tx<{ r: Release | null; u: Omit<ServerUpdate, 'notes'> | null }[]>`
        select instance_release() as r, instance_update() as u`,
    )
    latest = r?.r ?? null
    updated = r?.u ?? null
  }
  return {
    current: running.version,
    commit: running.commit,
    check,
    latest: latest && isNewer(latest.version, running.version) ? latest : null,
    updated: updated && { ...updated, notes: releaseNotes(updated.to) },
  }
}

/**
 * The release page of a version, for the notice after an update — only
 * for a version that was released, never `0.0.0`. Built here from a
 * version the database holds to `X.Y.Z`, so it is always under
 * `usetuff/tuff`'s releases.
 */
export function releaseNotes(version: string): string | null {
  return released(version) ? `https://github.com/usetuff/tuff/releases/tag/v${version}` : null
}
