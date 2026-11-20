/*
 * Who I may see, as a set rather than a question asked per row.
 *
 * The last screen over the design's budget: the people list of a
 * thousand-member workspace took 269 ms, and none of it was the query. Both
 * policies on the way — `m_read` on membership and `a_read` on actor — were
 * written as predicates over the row, so `role_in(workspace_id)` and
 * `is_outside()` were called once per person, each running a query of its
 * own. A thousand people, several thousand calls.
 *
 * Migration 014 made this argument for the four entities and 029 for the
 * rooms. Same rule, same answers, computed once per query as a hashed
 * InitPlan rather than per row.
 *
 * `is_outside()` has no argument at all and still could not be folded out of
 * a per-row predicate; here it is asked once, inside the set.
 */
create function staff_workspaces() returns setof uuid
language sql stable security definer set search_path = public as $$
  select m.workspace_id from membership m
  where m.actor_id = current_actor() and m.deleted_at is null and m.joined_at is not null
    and m.role in ('owner', 'admin', 'member')
    and not is_outside()
$$;

/*
 * Everybody whose name I am allowed to read: myself, the people of a
 * workspace I am staff in, and anybody I share a project with. A guest is on
 * the third arm only, which is what keeps an agency's client from reading the
 * roster.
 */
create function visible_actors() returns setof uuid
language sql stable security definer set search_path = public as $$
  select current_actor()
  union
  select m.actor_id from membership m
  where m.deleted_at is null and m.workspace_id in (select staff_workspaces())
  union
  select theirs.actor_id
  from project_member mine
  join project_member theirs on theirs.project_id = mine.project_id
    and theirs.deleted_at is null
  where mine.actor_id = current_actor() and mine.deleted_at is null
$$;

grant execute on function staff_workspaces to tracker_app;
grant execute on function visible_actors to tracker_app;

drop policy m_read on membership;
create policy m_read on membership for select using (
  actor_id = current_actor() or workspace_id in (select staff_workspaces())
);

drop policy a_read on actor;
create policy a_read on actor for select using (id in (select visible_actors()));
