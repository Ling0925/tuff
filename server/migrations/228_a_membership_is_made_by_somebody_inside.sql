/*
 * What the application role may write into the two tables that say who is
 * somebody, and where, the sixth audit, M3.
 *
 * Migration 002 let the application insert any membership at all
 * (`with check (true)`) and update any session (`using (true)`), because
 * sign-up and invitations wrote those rows from the server before there was
 * anybody to check against. They have long since moved into definer
 * functions (`new_workspace`, `accept_invite`, `register_owner`, the agents'
 * own), which run as the owner and are not bound by either policy. What
 * stayed open was a way, for an injection anywhere in a request, to make
 * itself an owner of any workspace or to move every session to one actor.
 *
 * A membership the application writes itself is now the one thing it
 * writes them for: somebody inside a workspace adding a plain member to
 * it, under their own name — the people an import brings in with the work
 * (`http/import.ts`). Never an owner or an admin, never into a workspace
 * the writer is not in, and never on somebody else's behalf.
 *
 * And a session is never updated by the application at all: every change
 * to one — rotating, ending, naming its device — is a definer function's
 * (`auth_spend_refresh`, `auth_end_session`, …). The policy goes and so
 * does the grant, so an update is refused out loud rather than matching
 * nothing.
 *
 * Inserting a session stays open. Signing in writes one for an actor
 * before there is any actor to be in the transaction, and moving that into
 * a function that takes the same actor id would be the same door with a
 * different name.
 */

drop policy m_write on membership;
create policy m_write on membership for insert with check (
  role = 'member'
  and invited_by = current_actor()
  and is_member(workspace_id)
);

drop policy sess_update on refresh_session;
revoke update on refresh_session from tracker_app;
