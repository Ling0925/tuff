/**
 * The one door the development scripts take, and nothing else does.
 *
 * Making a workspace for somebody who already has an account is a thing the
 * product cannot do: `register_owner` makes the account and the workspace in
 * one statement, `accept_invite` joins an existing one, and there is no third
 * function — because there is no screen asking for it yet. RLS is right to
 * refuse it, since the actor is not a member of a row that does not exist.
 *
 * So these scripts connect as the table owner, the way the migrations do. It
 * is worth one file rather than two copies: a second connection with RLS off
 * is exactly the kind of thing that gets pasted once too often, and this way
 * there is a single place to read and a single place to delete when the
 * product grows a real "new workspace" endpoint.
 *
 * Nothing under `src/` may import this.
 */
import postgres from 'postgres'
import { v7 as uuidv7 } from 'uuid'
import { env } from '../src/env.js'

/** A connection with row-level security off. Close it when finished. */
export const asOwner = (): postgres.Sql =>
  postgres(env.databaseUrl, { max: 1, onnotice: () => {} })

/**
 * The workspace, made if it is not there, with this actor owning it.
 *
 * Idempotent on the slug and on the membership both, so a script that runs on
 * every check can call it every time.
 */
export async function ownWorkspace(
  sql: postgres.Sql,
  actorId: string,
  slug: string,
  name: string,
): Promise<{ id: string; made: boolean; joined: boolean }> {
  const [found] = await sql<{ id: string }[]>`
    select id from workspace where slug = ${slug} and deleted_at is null`
  const id = found?.id ?? uuidv7()
  if (!found) {
    await sql`insert into workspace (id, name, slug) values (${id}, ${name}, ${slug})`
  }
  const joined = await sql`
    insert into membership (id, workspace_id, actor_id, role, joined_at)
    values (${uuidv7()}, ${id}, ${actorId}, 'owner', now())
    on conflict do nothing
    returning id`
  return { id, made: !found, joined: joined.length > 0 }
}

/**
 * Somebody who runs the product. As the table owner,
 * because nothing the application role can do makes an operator.
 */
export async function makeOperator(sql: postgres.Sql, actorId: string): Promise<void> {
  await sql`insert into operator (actor_id) values (${actorId}) on conflict do nothing`
}

/** The actor behind an email, or null. Owner-side, so no actor is needed. */
export async function actorFor(sql: postgres.Sql, email: string): Promise<string | null> {
  const [row] = await sql<{ actor_id: string }[]>`
    select actor_id from app_user where email = ${email}`
  return row?.actor_id ?? null
}
