/*
 * The server's version and a newer release, as its owners are told —
 * `ServerVersion` in shared-schema. The server decides what is newer; the screen only draws it.
 */

import type { ServerUpdate, ServerVersion } from '@tracker/shared-schema'

export type { ServerUpdate, ServerVersion }

/**
 * What the notice after an update says about the backup:
 * where it is, that nothing in
 * the database changed so none was needed, or why none was taken: the
 * operator skipped it, no folder was set, the folder is not a volume, or
 * the database's Postgres is newer than the image's `pg_dump`.
 */
export function backupState(u: ServerUpdate): 'taken' | 'unchanged' | 'skipped' | 'no_folder' | 'not_a_volume' | 'postgres_newer' {
  if (u.backup) return 'taken'
  if (u.migrations === 0) return 'unchanged'
  return u.no_backup ?? 'no_folder'
}

/** The one command that updates a server — `scripts/update.sh`. */
export const UPDATE_COMMAND = 'scripts/update.sh'

/**
 * Whether the owner's face carries the red dot: a security release this
 * server does not run yet. The server sends `latest` only while it is
 * newer than what runs, so the dot goes once the server runs that version.
 * Nothing for anybody who is not an owner — they are sent no `server`.
 */
export function securityDue(server: ServerVersion | null | undefined): boolean {
  return server?.latest?.security === true
}

/** What the version row says under it: the check's state, or that this build is not a release. */
export function checkState(v: ServerVersion): 'on' | 'off' | 'unreleased' {
  if (v.current === '0.0.0') return 'unreleased'
  return v.check ? 'on' : 'off'
}

/**
 * A release page the screen may link to, or null — the same shape the
 * database keeps. A link is drawn from what the server said; this is the
 * last look before it goes in an `href`.
 */
export function releaseLink(url: string): string | null {
  return /^https:\/\/github\.com\/usetuff\/tuff\/releases\/[A-Za-z0-9._/-]{1,200}$/.test(url) ? url : null
}
