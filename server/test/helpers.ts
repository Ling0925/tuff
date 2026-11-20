import { RIGHTS_ON_JOINING } from '@tracker/shared-schema'
import { v7 as uuidv7 } from 'uuid'
import postgres from 'postgres'
import { asWorker, withActor, withActorEverywhere, withoutActor, closeDb as closeAppDb } from '../src/db.js'
import { registerUser } from '../src/auth/flows.js'
import { authenticate, type AuthContext } from '../src/auth/context.js'
import { issueAccessToken } from '../src/auth/tokens.js'
import type { Role } from '@tracker/shared-schema'
import { edition } from '../src/edition.js'

/*
 * The core's rules, in either tree. In the public repository `edition.ts`
 * is the community edition, whose server is claimed by one owner and then
 * closed to sign-up — and every test here signs somebody up. Here it is
 * the service's, which never had the switch on. So it is off for the
 * tests in both, and `instance.test.ts`, which is about that switch, turns
 * the community edition on itself, on a database of its own.
 */
edition.instance = false

/*
 * The tests ask their questions of the actor, not of a session: most of them
 * are about what row-level security lets one person see, and several make two
 * workspaces on purpose. So `withActor` here is the unbounded one, and a test
 * that is about the session's workspace says so with `inWorkspace`.
 */
export { withActorEverywhere as withActor, withoutActor, asWorker, uuidv7 }

/*
 * The tables' owner, for the fixtures the application may not write: a
 * membership of any role, for anybody. The application role adds only a
 * plain member, as somebody already inside, under their own name
 * (migration 228) — which is what an import does and nothing a test needs
 * to put a person in place. Opened when first asked for.
 */
let tableOwner: postgres.Sql | null = null
export const asTableOwner = (): postgres.Sql => (tableOwner ??= postgres(process.env.DATABASE_URL!, { max: 2, onnotice: () => {} }))

export async function closeDb(): Promise<void> {
  if (tableOwner) await tableOwner.end()
  tableOwner = null
  await closeAppDb()
}
export const inWorkspace = withActor

/** Unique from a uuid, not from the clock: test files run in parallel. */
export function stamp(): string {
  return uuidv7().replace(/-/g, '').slice(0, 16)
}

export async function makeOwner(): Promise<{
  ctx: AuthContext
  workspaceId: string
  /** The bearer itself, for the tests that go through HTTP rather than round it. */
  token: string
}> {
  const s = stamp()
  const session = await registerUser({
    email: `owner${s}@example.com`,
    password: 'correct-horse-battery-staple',
    name: `Owner ${s.slice(0, 4)}`,
    workspace_name: `WS ${s.slice(0, 4)}`,
    workspace_slug: `ws-${s}`,
  })
  /*
   * On a plan with room in it.
   *
   * A registered workspace is `solo`, which holds two — right for somebody
   * signing up and wrong for a fixture, because most of these tests put
   * three or four people in a workspace and would spend their time being
   * refused by a ceiling they are not about. A test that is *about* the
   * ceiling sets its own plan.
   */
  await withActorEverywhere(session.actor_id, (tx) => tx`update workspace set plan = 'team' where id = ${session.workspace_id}`)
  /* Asked after, so the context says the plan it is on. */
  const ctx = await authenticate(`Bearer ${session.access_token}`)
  if (!ctx) throw new Error('the owner did not authenticate')
  return { ctx, workspaceId: session.workspace_id, token: session.access_token }
}

/** Somebody else in the same workspace, with a role and a project list. */
export async function addPerson(
  owner: AuthContext,
  workspaceId: string,
  role: Role,
  projectIds: string[] = [],
  /** What they hold on those projects. */
  rights: readonly string[] = [...RIGHTS_ON_JOINING],
): Promise<AuthContext> {
  const actorId = uuidv7()
  await withoutActor(async (tx) => {
    await tx`insert into actor (id, name) values (${actorId}, ${role})`
  })
  await asTableOwner()`
    insert into membership (id, workspace_id, actor_id, role, joined_at)
    values (${uuidv7()}, ${workspaceId}, ${actorId}, ${role}::role_kind, now())`
  await withActorEverywhere(owner.actorId, async (tx) => {
    for (const p of projectIds) {
      await tx`
        insert into project_member (id, workspace_id, project_id, actor_id, added_by, rights)
        values (${uuidv7()}, ${workspaceId}, ${p}, ${actorId}, ${owner.actorId}, ${rights})`
    }
  })
  const { DEFAULT_SETTINGS } = await import('@tracker/shared-schema')
  return {
    actorId,
    workspaceId,
    role,
    settings: DEFAULT_SETTINGS,
    rights: Object.fromEntries(projectIds.map((p) => [p, [...rights]])),
    mayCreateProjects: null,
    mayCreateChannels: true,
    maySeeMembers: null,
    mayInvitePeople: null,
    mayConnectAgents: false,
    agent: false,
    operator: false,
    instanceOwner: false,
    plan: 'solo',
    viaMcp: false,
    tokenProjectIds: [],
  }
}

/**
 * A bearer for somebody `addPerson` made.
 *
 * `makeOwner` gets one from registering; everybody else exists only as an
 * actor row, so a test that has to go through HTTP as them — because the
 * thing being tested is what the endpoint refuses — had no way to.
 */
export function bearerFor(actorId: string, workspaceId: string): Promise<string> {
  return issueAccessToken({ sub: actorId, workspace_id: workspaceId })
}

/** Somebody who runs those projects — holds every permission on them. */
export function addManager(owner: AuthContext, workspaceId: string, projectIds: string[]): Promise<AuthContext> {
  return addPerson(owner, workspaceId, 'member', projectIds, [
    'task.create',
    'task.delete',
    'channel.create',
    'channel.delete',
    'edit.any',
    'manage',
  ])
}

export async function makeProject(ctx: AuthContext, workspaceId: string, name: string): Promise<string> {
  const id = uuidv7()
  await withActorEverywhere(ctx.actorId, async (tx) => {
    await tx`
      insert into project (id, workspace_id, name) values (${id}, ${workspaceId}, ${name})`
    await tx`
      insert into project_member (id, workspace_id, project_id, actor_id, added_by)
      values (${uuidv7()}, ${workspaceId}, ${id}, ${ctx.actorId}, ${ctx.actorId})`
  })
  return id
}
