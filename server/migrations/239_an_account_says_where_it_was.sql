/*
 * An account in no workspace says where it was.
 *
 * Every way into the product makes a workspace or joins one, so an account
 * that is in none got there by leaving: taken out of the workspace it was
 * invited into, or that workspace deleted. The operators' list of people
 * showed nothing for such an account, and "how can somebody sign up without
 * a workspace?" had no answer on the screen. Now each account carries the
 * workspaces it was in and is not any more — the latest three, with why
 * and when. A workspace erased for good after its days in the bin leaves no
 * row at all, so an account with neither is one whose workspace is gone
 * entirely.
 *
 * The return type grows, so the function is dropped and made again, and
 * granted by name as 227 asks of every definer.
 */
drop function operator_people(text, timestamptz, uuid, int);

create function operator_people(p_q text, p_before_at timestamptz, p_before_id uuid, p_limit int)
returns table (
  actor_id uuid, name text, email text, created_at timestamptz,
  seen_at timestamptz, avatar_key text, second_factor boolean, workspaces json, gone json
)
language sql stable security definer set search_path = public as $$
  select u.actor_id, a.name, u.email::text, u.created_at,
         a.seen_at, a.avatar_key, u.totp_enabled,
         coalesce((
           select json_agg(json_build_object(
             'id', w.id, 'name', w.name, 'slug', w.slug::text,
             'role', m.role::text, 'plan', w.plan
           ) order by w.name)
           from membership m join workspace w on w.id = m.workspace_id
           where m.actor_id = u.actor_id and m.deleted_at is null and w.deleted_at is null
         ), '[]'),
         coalesce((
           select json_agg(json_build_object(
             'name', g.name, 'role', g.role, 'why', g.why, 'at', g.at
           ) order by g.at desc)
           from (
             select w.name, m.role::text as role,
                    case when w.deleted_at is not null then 'workspace_deleted' else 'removed' end as why,
                    coalesce(w.deleted_at, m.deleted_at) as at
             from membership m join workspace w on w.id = m.workspace_id
             where m.actor_id = u.actor_id
               and (m.deleted_at is not null or w.deleted_at is not null)
               /* Not a workspace they are back in. */
               and not exists (
                 select 1 from membership again
                 where again.actor_id = u.actor_id and again.workspace_id = m.workspace_id
                   and again.deleted_at is null and w.deleted_at is null
               )
             order by coalesce(w.deleted_at, m.deleted_at) desc
             limit 3
           ) g
         ), '[]')
  from app_user u join actor a on a.id = u.actor_id
  where is_operator() and a.deleted_at is null
    and (p_q is null or a.name ilike '%' || p_q || '%' or u.email::text ilike '%' || p_q || '%')
    and (p_before_at is null or (u.created_at, u.actor_id) < (p_before_at, p_before_id))
  order by u.created_at desc, u.actor_id desc
  limit least(greatest(p_limit, 1), 100)
$$;
revoke execute on function operator_people(text, timestamptz, uuid, int) from public;
grant execute on function operator_people(text, timestamptz, uuid, int) to tracker_app;
