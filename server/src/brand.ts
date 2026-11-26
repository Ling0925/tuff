import type { Tx } from './db.js'
import { edition } from './edition.js'
import { linkFor } from './storage.js'

/**
 * A workspace's own name and mark, worn on what it shows to people in Tuff's
 * place.
 *
 * The database says which workspaces (`workspace_brand`, by the plan) and
 * the edition says whether any ever do: on your own server none does, and
 * nothing is asked. Every answer that carries a brand carries what this
 * file makes of a row, so a public page, an invitation and `/api/me` say
 * the same thing the same way.
 */
export type Brand = {
  name: string
  /** The workspace's picture, signed for an hour over its key alone. */
  icon_url: string | null
  mark_icon: string | null
  /** Never null: a colour nobody chose is the one the id works out. */
  mark_tint: number
}

type Row = { id: string; name: string; mark_icon: string | null; mark_tint: number | null; icon_key: string | null }

/* The switcher's hash over the workspace's id — `hashOf` in
   `web/src/data/faces.ts` — so a page that is never told the id draws the
   colour the workspace has everywhere else. */
function hashOf(seed: string): number {
  let hash = 0
  for (const ch of seed) hash = (hash * 31 + ch.charCodeAt(0)) % 100_000
  return hash
}

function worn(row: Row | undefined): Brand | null {
  if (!row) return null
  return {
    name: row.name,
    icon_url: row.icon_key ? linkFor(row.icon_key) : null,
    mark_icon: row.mark_icon,
    mark_tint: row.mark_tint ?? hashOf(row.id) % 10,
  }
}

/** A workspace's brand by its id — one the caller already holds, never one a request named. */
export async function brandOf(tx: Tx, workspaceId: string): Promise<Brand | null> {
  if (!edition.brands) return null
  const [row] = await tx<Row[]>`select * from workspace_brand(${workspaceId})`
  return worn(row)
}

/** A shared document's workspace's brand, found through the document's token. */
export async function brandOfDocument(tx: Tx, token: string): Promise<Brand | null> {
  if (!edition.brands) return null
  const [row] = await tx<Row[]>`select * from public_document_brand(${token})`
  return worn(row)
}

/** An invitation's workspace's brand, found through the invitation's hash. */
export async function brandOfInvite(tx: Tx, tokenHash: string): Promise<Brand | null> {
  if (!edition.brands) return null
  const [row] = await tx<Row[]>`select * from invite_brand(${tokenHash})`
  return worn(row)
}
