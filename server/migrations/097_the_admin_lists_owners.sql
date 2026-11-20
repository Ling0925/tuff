/*
 * The admin's first list is the people who own workspaces, each with what
 * they own. A list of workspaces alone said a
 * company's name a dozen times and never who was behind them.
 */
create function operator_owners(p_q text, p_before_at timestamptz, p_before_id uuid, p_limit int)
returns table (
  actor_id uuid, name text, email text, created_at timestamptz,
  seen_at timestamptz, avatar_key text, second_factor boolean, workspaces json
)
language sql stable security definer set search_path = public as $$
  select u.actor_id, a.name, u.email::text, u.created_at,
         a.seen_at, a.avatar_key, u.totp_enabled,
         (
           select json_agg(json_build_object(
             'id', w.id, 'name', w.name, 'slug', w.slug::text, 'plan', w.plan,
             'created_at', w.created_at,
             'mark_icon', w.mark_icon, 'mark_tint', w.mark_tint, 'icon_key', w.icon_key,
             'people', workspace_people(w.id),
             'projects', (select count(*) from project p
                          where p.workspace_id = w.id and p.deleted_at is null),
             'bytes', workspace_storage_bytes(w.id),
             'gift', (select json_build_object('until', g.until)
                      from plan_gift g where g.workspace_id = w.id)
           ) order by w.created_at)
           from membership m join workspace w on w.id = m.workspace_id
           where m.actor_id = u.actor_id and m.role = 'owner'
             and m.deleted_at is null and w.deleted_at is null
         )
  from app_user u join actor a on a.id = u.actor_id
  where is_operator() and a.deleted_at is null
    and exists (
      select 1 from membership m join workspace w on w.id = m.workspace_id
      where m.actor_id = u.actor_id and m.role = 'owner'
        and m.deleted_at is null and w.deleted_at is null
    )
    and (p_q is null
         or a.name ilike '%' || p_q || '%' or u.email::text ilike '%' || p_q || '%'
         or exists (
           select 1 from membership m join workspace w on w.id = m.workspace_id
           where m.actor_id = u.actor_id and m.role = 'owner'
             and m.deleted_at is null and w.deleted_at is null
             and (w.name ilike '%' || p_q || '%' or w.slug::text ilike '%' || p_q || '%')
         ))
    and (p_before_at is null or (u.created_at, u.actor_id) < (p_before_at, p_before_id))
  order by u.created_at desc, u.actor_id desc
  limit least(greatest(p_limit, 1), 100)
$$;
grant execute on function operator_owners(text, timestamptz, uuid, int) to tracker_app;
