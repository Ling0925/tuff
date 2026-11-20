import { v7 as uuidv7 } from 'uuid'
import type { Tx } from '../db.js'
import type { AuthContext } from '../auth/context.js'
import { emit } from '../webhooks.js'
import { publish } from '../realtime.js'

/** What a project's Slack channel hears of. */
const SLACK_NEWS = new Set(['task.create', 'task.update', 'task.comment', 'post.create'])

/**
 * The activity log is immutable and names the author of every action,
 * including the ones that arrived through a tool.
 *
 * `origin` is taken from the context, which took it from the token — not from
 * anything the caller sends. A person must be able to tell their own action
 * from their tool's, and a tool must not be able to pretend otherwise.
 */
export async function record(
  tx: Tx,
  ctx: AuthContext,
  action: string,
  about: {
    projectId?: string | null
    objectType?: string | null
    objectId?: string | null
    meta?: Record<string, unknown>
    /*
     * A line for the feed, and nothing sent out — not even to the screens.
     * A task copied is one event with two lines — on the copy and on the
     * original — and GitHub, Slack and the webhooks hear it once, from the
     * copy.
     */
    feedOnly?: boolean
  } = {},
): Promise<void> {
  /*
   * A file the project does not have — a document still its author's or
   * its chosen people's — gets its line, which the feed's own policy shows
   * only to whoever may read the file, and is told to nothing else: not
   * the project's socket, not its webhooks.
   */
  let feedOnly = about.feedOnly === true
  /* And the line itself its actor's for good: publishing a document later
     does not show what was done in it while it was kept (migration 285). */
  let kept = false
  if (about.objectType === 'file' && about.objectId) {
    /* Its own answer, or that of the document holding it — asked of the
       row, not under the asker's policies (`file_apart`, migration 284). */
    const [f] = await tx<{ apart: boolean }[]>`select file_apart(${about.objectId}) as apart`
    kept = f?.apart === true
    feedOnly = feedOnly || kept
  }
  await tx`
    insert into activity_event
      (id, workspace_id, project_id, actor_id, action, object_type, object_id, origin, meta, kept)
    values (${uuidv7()}, ${ctx.workspaceId}, ${about.projectId ?? null}, ${ctx.actorId},
            ${action}, ${about.objectType ?? null}::object_kind, ${about.objectId ?? null},
            ${ctx.viaGithub ? 'github' : ctx.viaMcp ? 'mcp' : 'web'}::origin_kind,
            ${tx.json((about.meta ?? {}) as never)}, ${kept})`

  /*
   * And owed to GitHub, when the task's project syncs its issues.
   * Here because every change to a task and to what
   * is said on it passes through here, in the same transaction; a change
   * GitHub itself caused is not sent back to it.
   */
  if (about.objectType === 'task' && about.projectId && about.objectId && !ctx.viaGithub && !feedOnly) {
    const kind = action === 'task.delete' ? 'gone' : 'task'
    await tx`
      insert into github_out (id, workspace_id, project_id, kind, object_id, actor_id)
      select ${uuidv7()}, ${ctx.workspaceId}, ${about.projectId}, ${kind}, ${about.objectId}, ${ctx.actorId}
      from github_link
      where project_id = ${about.projectId} and issues and deleted_at is null`
  }

  /*
   * And owed to the project's Slack channel, when it has one.
   * What is news is decided beside the rows, in
   * `slack_queue`; an import's thousand tasks are not.
   */
  if (
    /* Nor what GitHub did here: it is done as whoever linked the
       repository, and a stranger's comment on a public one would be
       posted under their name. */
    about.projectId &&
    about.objectId &&
    !ctx.viaImport &&
    !ctx.viaGithub &&
    !feedOnly &&
    SLACK_NEWS.has(action) &&
    (action !== 'task.update' || about.meta?.finished === true || about.meta?.moved_to !== undefined)
  ) {
    await tx`select slack_queue(${action}, ${about.projectId}, ${about.objectId}, ${ctx.actorId})`
  }

  // Webhooks fire from the same call that writes the feed, in the same
  // transaction. An event that reaches a receiver for something the feed never
  // recorded, or the other way round, is the kind of disagreement nobody can
  // debug afterwards.
  if (!feedOnly)
    await emit(tx, ctx.workspaceId, action, {
      project_id: about.projectId ?? null,
      object_type: about.objectType ?? null,
      object_id: about.objectId ?? null,
      actor_id: ctx.actorId,
      origin: ctx.viaGithub ? 'github' : ctx.viaMcp ? 'mcp' : 'web',
      ...(about.meta ?? {}),
    })

  /*
   * Everyone looking at the project hears that it changed.
   *
   * Published here rather than in each handler, because every mutation
   * already comes through this call — a handler that forgot to publish would
   * be a screen that goes stale for one kind of change and not the others,
   * and nobody would find out until two people were on it at once.
   *
   * The fact travels, not the row: a client that hears "something happened"
   * fetches through the endpoint it would have used anyway, so there is one
   * path into the data rather than two that can drift apart.
   */
  /* Not a feed-only line: the copy's own event already told the screens,
     and this one would tell the original's watchers that a copy exists
     somewhere they may not be able to see. */
  if (about.projectId && !feedOnly) {
    await publish(
      `project:${about.projectId}`,
      action,
      {
        object_type: about.objectType ?? null,
        object_id: about.objectId ?? null,
        actor_id: ctx.actorId,
        /* The tab that did it, so that tab alone can ignore the echo. The
           same person's other device has a different one and refetches. */
        tab: ctx.tab ?? null,
      },
      tx,
    )
  }
}
