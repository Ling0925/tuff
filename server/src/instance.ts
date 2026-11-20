import { sql } from './db.js'
import { edition } from './edition.js'

/*
 * The instance owner, and sign-up closed on your own server.
 *
 * The rules are the database's (migration 202): `register_owner` refuses
 * an account asked for on a closed server, and confirming an address
 * claims the server or is refused, whoever calls them. What is here only
 * turns the database's refusal into an answer. Nothing happens on the
 * service, whose database is never told it is a server of one's own. The
 * owner's screen is `http/instance.ts`.
 */

/** What every way of making an account without an invitation is told when sign-up is closed. */
export const SIGN_UP_CLOSED = {
  error: { code: 'sign_up_closed', message: 'Sign-up is closed on this server. Ask someone here for an invitation.' },
} as const

/** The database refused an account, or the confirmation of an address, for closed sign-up. */
export class SignUpClosed extends Error {
  constructor() {
    super('sign_up_closed')
  }
}

/** Whether an error is that refusal — ours, or the database's `sign_up_closed`. */
export function isClosed(e: unknown): boolean {
  return e instanceof SignUpClosed || (e as { message?: string } | null)?.message === 'sign_up_closed'
}

/** The same work, with the database's refusal said as `SignUpClosed`. */
export async function orClosed<T>(work: Promise<T>): Promise<T> {
  try {
    return await work
  } catch (e) {
    if (isClosed(e)) throw new SignUpClosed()
    throw e
  }
}

/**
 * Whether somebody without an invitation may make an account — asked
 * before a form is drawn, and before a provider's account is made. The answer that counts is the database's, when
 * the account is made; this one only saves somebody filling in a form that
 * will be refused.
 */
export async function signUpOpen(): Promise<boolean> {
  if (!edition.instance) return true
  const [r] = await sql<{ open: boolean | null; community: boolean | null }[]>`
    select instance_sign_up_open() as open, instance_community() as community`
  /* A database never told it is a server of one's own enforces nothing, so
     the edition that is one takes that as closed rather than open. */
  return r?.community === true && r.open !== false
}

/**
 * Whether anybody owns this server yet — `instance_claimed`, migration 208.
 * Always on the service, which is never claimed and never asks. Until it
 * is, the sign-in screens draw no provider button: none of them can claim
 * a server (migration 207), and a button that answers "closed" is worse
 * than none.
 */
export async function serverClaimed(): Promise<boolean> {
  if (!edition.instance) return true
  const [r] = await sql<{ claimed: boolean | null }[]>`select instance_claimed() as claimed`
  return r?.claimed === true
}
