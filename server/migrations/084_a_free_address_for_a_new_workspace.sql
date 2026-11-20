-- The next free address for a workspace's name.
--
-- Registration was handed its address by the caller and refused a taken one,
-- which a sign-up screen cannot know in advance. `new_workspace` already
-- picks the next free one for a second workspace; this is that loop on its
-- own, as a definer, because the rows it has to look past are other
-- people's and row-level security hides them from whoever is asking.
create function free_workspace_slug(p_name text) returns citext
language plpgsql stable security definer set search_path = public as $$
declare
  raw text := left(coalesce(slugify(p_name), 'workspace'), 36);
  base text := case when length(raw) < 3 then raw || '-team' else raw end;
  candidate citext := base;
  n int := 1;
begin
  while exists (select 1 from workspace where slug = candidate) loop
    n := n + 1;
    candidate := base || '-' || n;
  end loop;
  return candidate;
end $$;

grant execute on function free_workspace_slug(text) to tracker_app;
