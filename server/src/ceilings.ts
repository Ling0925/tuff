import { allow, type AuthContext } from './auth/context.js'
import type { Tx } from './db.js'
import { edition } from './edition.js'
import type { Refusal } from './editionShape.js'

/*
 * What a workspace is held to, asked of the edition — `edition.ceilings`.
 * On the service a plan holds it to people, bytes, agents and a feedback
 * page, and the refusals say how to move up; on your own server nothing
 * holds it, so every question here answers "there is room" and a refusal
 * below is never said.
 */

/* What is said where the database refused for a ceiling the edition does
   not name — a workspace full, its bytes spent — in words that name no
   plan. */
const FULL: Refusal = { error: { code: 'limit', message: 'This workspace is full.' } }
const NO_ROOM: Refusal = { error: { code: 'limit', message: 'This workspace is out of storage.' } }

/**
 * A deletion whose paid plans were stopped first, and which finds another
 * to stop when it comes to delete — one started, or a workspace that came
 * to count as the account's alone, in between. Nothing is deleted, and the
 * next press stops that one too.
 */
export const CHANGED_MEANWHILE: Refusal = {
  error: { code: 'conflict', message: 'Something changed in the meantime. Nothing was deleted. Try again.' },
}

/** Whether a list read again holds anything not in what was just stopped. */
export const moreToStop = (now: { id: string }[], stopped: readonly string[]): boolean => now.some((s) => !stopped.includes(s.id))

/** A workspace full, said to whoever invites (`inviter`) or follows a link (`invited`). */
export const fullRefusal = (to: 'inviter' | 'invited'): Refusal =>
  edition.ceilings ? edition.ceilings.says[to === 'inviter' ? 'full' : 'fullAsk'] : FULL

/** A workspace out of storage. */
export const storageRefusal = (): Refusal => edition.ceilings?.says.storage ?? NO_ROOM

/** Whether the workspace holds as many people as it may. */
export const workspaceFull = async (tx: Tx, workspaceId: string): Promise<boolean> =>
  edition.ceilings ? edition.ceilings.full(tx, workspaceId) : false

/** Whether `size` more bytes fit, at a first look before they are stored. */
export const fits = async (tx: Tx, workspaceId: string, size: number): Promise<boolean> =>
  edition.ceilings ? edition.ceilings.fits(tx, workspaceId, size) : true

/** The same, asked again under a lock once they are stored. */
export const roomFor = async (tx: Tx, workspaceId: string, size: number): Promise<boolean> =>
  edition.ceilings ? edition.ceilings.roomFor(tx, workspaceId, size) : true

/** Why an agent, a token or a connection is held back here, or null. */
export const agentsHeld = (ctx: AuthContext): Refusal | null =>
  edition.ceilings && !allow(ctx, 'agent.use') ? edition.ceilings.says.agents : null

/** Whether a feedback page is held back for this workspace. */
export const feedbackHeld = (ctx: Pick<AuthContext, 'plan'>): boolean => edition.ceilings?.free(ctx.plan) === true
