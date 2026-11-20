import { v7 as uuidv7 } from 'uuid'
import type { Tx } from './db.js'

/*
 * A document's versions, kept.
 *
 * Called inside a transaction that has asked `mayEdit` for the file and
 * said so (`app.may_edit_file`): the table's policy refuses any other, so
 * a reader's path cannot keep one however it is reached.
 */

export type Kept = {
  fileId: string
  workspaceId: string
  /** The version the document carries now, and the body it now says. */
  version: number
  body: unknown
  /** Who wrote in it since the version before, in the order they first wrote. */
  contributors: readonly string[]
  /** What the document said before this write — kept first, once, when it has no versions yet. */
  before?: { version: number; body: unknown } | null
  /** The version a restore put back. */
  restoredVersion?: number | null
}

/** Whether a body says the same as another, however its keys were written. */
async function same(tx: Tx, a: unknown, b: unknown): Promise<boolean> {
  const [r] = await tx<{ same: boolean }[]>`select ${tx.json(a as never)}::jsonb = ${tx.json(b as never)}::jsonb as same`
  return r?.same === true
}

/**
 * A version kept, unless it says what the newest already does. Answers
 * whether it was. The first one a document keeps is preceded by the body
 * it had before — the one it was created with, or had when this shipped —
 * under the number it had then, with nobody named.
 */
export async function keepVersion(tx: Tx, k: Kept): Promise<boolean> {
  if (k.body === null || k.body === undefined) return false
  /* Compared as the database keeps them: jsonb orders keys its own way. */
  const json = tx.json(k.body as never)
  const [newest] = await tx<{ same: boolean }[]>`
    select body = ${json}::jsonb as same from file_version
    where workspace_id = ${k.workspaceId} and file_id = ${k.fileId}
    order by id desc limit 1`
  if (newest?.same) return false
  if (!newest && k.before && k.before.body !== null && !(await same(tx, k.before.body, k.body))) {
    await tx`insert into file_version (workspace_id, id, file_id, version, body, contributors)
             values (${k.workspaceId}, ${uuidv7()}, ${k.fileId}, ${Math.max(1, Math.min(k.before.version, k.version))},
                     ${tx.json(k.before.body as never)}, '{}'::uuid[])`
  }
  const contributors = [...new Set(k.contributors)]
  await tx`insert into file_version (workspace_id, id, file_id, version, body, contributors, restored_version)
           values (${k.workspaceId}, ${uuidv7()}, ${k.fileId}, ${k.version}, ${json},
                   ${contributors}::uuid[], ${k.restoredVersion ?? null})`
  return true
}
