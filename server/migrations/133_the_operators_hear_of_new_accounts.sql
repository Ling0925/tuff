-- The people who run Tuff hear when somebody arrives.

alter table app_user add column if not exists announced_at timestamptz;
-- Everybody already here has been met.
update app_user set announced_at = now() where announced_at is null;

/*
 * Everybody confirmed and not yet announced, claimed in one statement so two
 * workers asking at once cannot both announce somebody. How they came: by an
 * invitation if the first workspace they are in is not one they made, by
 * Google or Apple if they have no password, by email otherwise.
 */
create or replace function new_accounts_claim() returns table (
  actor_id uuid, name text, email text, how text, workspace text, created_at timestamptz
)
language sql volatile security definer set search_path = public as $$
  with picked as (
    update app_user u set announced_at = now()
    where u.announced_at is null and u.email_verified_at is not null
    returning u.actor_id, u.email::text as email, u.password_hash is null as no_password, u.created_at
  )
  select p.actor_id, a.name, p.email,
         case
           when first.role <> 'owner' then 'invitation'
           when p.no_password then coalesce((select string_agg(distinct i.provider, ' or ') from auth_identity i where i.actor_id = p.actor_id), 'Google or Apple')
           else 'email'
         end,
         w.name,
         p.created_at
  from picked p
  join actor a on a.id = p.actor_id
  left join lateral (
    select m.workspace_id, m.role::text as role from membership m
    where m.actor_id = p.actor_id and m.deleted_at is null
    order by m.created_at limit 1
  ) first on true
  left join workspace w on w.id = first.workspace_id
  order by p.created_at
$$;
grant execute on function new_accounts_claim to tracker_app;

-- Where to tell them: the operators, by the address of their account.
create or replace function operator_emails() returns setof text
language sql stable security definer set search_path = public as $$
  select u.email::text from operator o join app_user u on u.actor_id = o.actor_id
  where u.email_verified_at is not null
$$;
grant execute on function operator_emails to tracker_app;
