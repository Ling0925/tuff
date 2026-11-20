/*
 * A workspace has a plan, and the plan has two ceilings.
 *
 * `plan` has existed since migration 001 with one value in it — `flat` —
 * because the design says a flat price per workspace and nothing had yet
 * needed to know which flat price. Four of them now: solo, team, company,
 * unlimited.
 *
 * The ceilings are derived from the name rather than stored beside it.
 *
 * Columns would let one workspace be given a different ceiling without a
 * deploy, which sounds useful until the column and the price list disagree
 * and nobody can say which is the real plan. A table of plans has the same
 * shape with an extra join. A function is one place, readable from a policy
 * and from `accept_invite`, and changing what a plan allows is a migration
 * — which is the right weight for changing what people are paying for.
 *
 * Immutable and not stable: these are constants per name, so the planner may
 * fold them into a query.
 */

alter table workspace drop constraint if exists workspace_plan_known;

-- Everything that exists is `flat`, which was the only value. It becomes
-- `team` — the paid tier these workspaces were implicitly on, and the one
-- whose ceilings are furthest from refusing anybody mid-sentence.
update workspace set plan = 'team' where plan = 'flat';

alter table workspace
  add constraint workspace_plan_known
  check (plan in ('solo', 'team', 'company', 'unlimited'));

alter table workspace alter column plan set default 'solo';

/*
 * How many people a plan allows, or null for no ceiling.
 *
 * Null rather than a large number: "unlimited" is a different statement
 * from "one million", and a caller that has to know which large number
 * means unlimited is a caller that will get it wrong once.
 */
create or replace function plan_people(p text) returns integer
language sql immutable set search_path = public as $$
  select case p
    -- Two, not one. A workspace where nobody can be invited is a wall
    -- somebody meets in their first minutes, before they have seen what
    -- they would be paying for; the second place is for a partner, a
    -- client, or themselves from another address. The name still holds:
    -- solo is one person working, not one row in a table.
    when 'solo'      then 2
    when 'team'      then 10
    when 'company'   then 100
    when 'unlimited' then null
  end
$$;

/* And how many bytes. Unlimited is a terabyte: storage costs money per
   gigabyte whatever the plan says, so the top plan has a ceiling too — it
   is simply one nobody reaches by working. */
create or replace function plan_bytes(p text) returns bigint
language sql immutable set search_path = public as $$
  select case p
    when 'solo'      then 1073741824::bigint           -- 1 GB
    when 'team'      then 26843545600::bigint          -- 25 GB
    when 'company'   then 107374182400::bigint         -- 100 GB
    when 'unlimited' then 1099511627776::bigint        -- 1 TB
  end
$$;

/*
 * How many people are in a workspace.
 *
 * Everybody with a membership, whatever they may do
 * threw out the sorts of people and counting only the ones who can write
 * would put that distinction back. Security definer and bounded by the
 * argument, like `workspace_storage_bytes` beside it: the count is about a
 * workspace rather than about what the reader may see inside it.
 */
create or replace function workspace_people(ws uuid) returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::integer from membership
  where workspace_id = ws and deleted_at is null
$$;

grant execute on function plan_people to tracker_app;
grant execute on function plan_bytes to tracker_app;
grant execute on function workspace_people to tracker_app;

/*
 * And the ceiling is enforced where the row is written.
 *
 * `accept_invite` is the only path that creates a membership from outside,
 * and it runs as definer — so a check in the endpoint that calls it is a
 * check with a second way in. The invite endpoint checks too, so that a
 * full workspace is refused where the owner is standing rather than to a
 * stranger following a link a week later; this is the one that cannot be
 * walked around.
 *
 * Replaced whole rather than patched, because `create or replace` on a
 * plpgsql body is the only way to change one and the body is short enough
 * that half of it in a diff would be harder to read than all of it.
 */
create or replace function accept_invite(
  p_token_hash text,
  p_actor_id uuid,
  p_name text,
  p_email citext,
  p_password_hash text
) returns table (workspace_id uuid, actor_id uuid, created_account boolean)
language plpgsql security definer set search_path = public as $$
declare
  inv     record;
  v_actor uuid;
  v_new   boolean := false;
  p       uuid;
  v_cap   integer;
begin
  update invite set used_at = now()
  where token_hash = p_token_hash
    and used_at is null
    and deleted_at is null
    and expires_at > now()
  returning * into inv;

  if inv is null then
    return;
  end if;

  select u.actor_id into v_actor from app_user u where u.email = p_email;

  /*
   * The ceiling, before anything is written and after the invite is known
   * to be good.
   *
   * Only for somebody who is not already in: accepting a second invite to a
   * a workspace you are in adds no row, and refusing it would lock a member
   * out of their own workspace for being the eleventh person to be invited.
   */
  select plan_people(w.plan) into v_cap from workspace w where w.id = inv.workspace_id;
  if v_cap is not null
     and not exists (select 1 from membership m
                     where m.workspace_id = inv.workspace_id
                       and m.actor_id = v_actor and m.deleted_at is null)
     and workspace_people(inv.workspace_id) >= v_cap then
    -- The invite is given back rather than burned: the owner upgrades and
    -- the same link works, instead of having to issue it again.
    update invite set used_at = null where id = inv.id;
    raise exception 'workspace_full' using errcode = 'check_violation';
  end if;

  if v_actor is null then
    v_actor := p_actor_id;
    v_new := true;
    insert into actor (id, name) values (v_actor, p_name);
    insert into app_user (actor_id, email, password_hash, email_verified_at)
      values (v_actor, p_email, p_password_hash, now());
  end if;

  insert into membership (id, workspace_id, actor_id, role, invited_by, joined_at)
  values (gen_random_uuid(), inv.workspace_id, v_actor, inv.role, inv.created_by, now())
  on conflict do nothing;

  foreach p in array inv.project_ids
  loop
    insert into project_member (id, workspace_id, project_id, actor_id, added_by, rights)
    values (gen_random_uuid(), inv.workspace_id, p, v_actor, inv.created_by, inv.rights)
    on conflict do nothing;
  end loop;

  update invite set used_by = v_actor where id = inv.id;

  insert into security_event (id, workspace_id, actor_id, kind, meta)
  values (gen_random_uuid(), inv.workspace_id, v_actor, 'invite_accepted',
          jsonb_build_object('role', inv.role, 'rights', inv.rights));

  return query select inv.workspace_id, v_actor, v_new;
end $$;
