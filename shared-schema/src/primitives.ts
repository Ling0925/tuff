import { z } from 'zod'

/**
 * The API version. Sent as a header, checked on every request: a native client
 * six months out of date must be told so rather than corrupting data quietly.
 */
export const API_VERSION = 1

/**
 * The most one file may be, in bytes.
 *
 * Here rather than on the server alone because the browser now refuses a
 * file before sending it — a video is the first thing in this product that
 * meets this ceiling, and meeting it a minute into an upload is the worst
 * way to be told. Two copies of the number would be two ceilings that drift.
 *
 * Fifty megabytes is about a minute of phone video. That is a real limit
 * rather than a generous one, and the answer to meeting it is a shorter
 * clip or a bigger plan — rather than a transcoder.
 */
export const MAX_FILE_BYTES = 50 * 1024 * 1024

/** UUID v7 in practice — the generator enforces the version, not the receiver. */
export const Uuid = z.uuid()

/** Server time. Client clocks are not trusted. */
export const Timestamp = z.iso.datetime({ offset: true })

/** A date with no time and no zone: a plan, not an event. */
export const DateOnly = z.iso.date()

/** Fractional ordering key. A string, not a number: a drag moves one row. */
export const SortKey = z.string().min(1)

/** A rich-text document. Its structure is deliberately not typed here. */
export const RichText = z.record(z.string(), z.unknown())

export const Slug = z.string().regex(/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/)

export const HexColor = z.string().regex(/^#[0-9a-f]{6}$/)

/**
 * What every row in the product carries.
 *
 * `workspace_id` is on every one of them on purpose: the design requires each
 * query to be bounded by workspace in the query itself rather than in a
 * controller, and that is only possible if the column is always there.
 */
export const baseColumns = {
  id: Uuid,
  workspace_id: Uuid,
  created_at: Timestamp,
  updated_at: Timestamp,
  deleted_at: Timestamp.nullable(),
}

/**
 * What every object a person creates carries, on top of the base.
 *
 * Author, subscribers, a client-visibility flag and a stable URL are
 * cross-cutting by design — the design lists them once for all four entities
 * rather than per entity, and the schema says so in one place for the same
 * reason.
 */
export const objectColumns = {
  ...baseColumns,
  project_id: Uuid,
  author_id: Uuid,
}

export type Uuid = z.infer<typeof Uuid>
export type Timestamp = z.infer<typeof Timestamp>
export type DateOnly = z.infer<typeof DateOnly>
export type RichText = z.infer<typeof RichText>
