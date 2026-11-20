-- Finding the workspaces to throw away.
--
-- `purge_workspace` has existed since 021 and the sweep that calls it has
-- never removed anything. The sweep asks `select id from workspace where slug
-- like 'studio-%'` with no actor set, and row-level security on `workspace`
-- is `using (is_member(id))` — with nobody set, nobody is a member, so the
-- query honestly returns nothing and the loop over it does nothing.
--
-- Nothing failed. `pnpm check` printed "cleared 0 old studios" and meant it,
-- while the database went to two and a half thousand workspaces and the test
-- suite got slower by a hair every run for weeks. This is the third time in
-- this codebase that emptiness has been read as permission, and it will not
-- be the last: a policy is absolute, so the places that must step around it
-- have to say so out loud.
--
-- Definer, so it sees what the policy hides, and narrow: it takes slug
-- patterns and nothing else, so the most it can be talked into is deleting a
-- workspace whose slug somebody chose to look like a throwaway one.
create function purge_workspaces_like(p_patterns text[])
returns integer language plpgsql security definer set search_path = public as $$
declare
  w uuid;
  n integer := 0;
begin
  for w in select id from workspace where slug like any (p_patterns) loop
    perform purge_workspace(w);
    n := n + 1;
  end loop;
  return n;
end $$;

grant execute on function purge_workspaces_like to tracker_app;
