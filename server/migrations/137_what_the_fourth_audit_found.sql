-- What the fourth audit found.

/* ------------------------------------------- a shared document's pictures

   A document shared to the web handed out every file its body named, in
   any project and any room of the workspace: a member who knew a file's
   id wrote it into a document of their own, shared that, and read the
   bytes with no session at all. Only the document's own project's files
   now, and none sent in a room. */
create or replace function public_document_files(p_token text)
returns table (id uuid, storage_key text, display_key text, content_type text)
language sql stable security definer set search_path = public as $$
  select x.id, x.storage_key, x.display_key, x.content_type
  from public_document(p_token) d
  join file src on src.id = d.id
  join file x on x.workspace_id = src.workspace_id and x.deleted_at is null and x.storage_key is not null
    and x.project_id = src.project_id and x.conversation_id is null
  where x.id::text in (select jsonb_path_query(d.body, 'strict $.**.fileId') #>> '{}')
$$;

/* ---------------------------------------------- a file sent in a room

   A file sent in a project's room was a row in the project's Docs and
   nothing else, so one sent in a channel with chosen people was read by
   everybody on the project. Such a file now names its room as well as its
   project, and is seen by whoever may see both. */
drop policy o_read on file;
create policy o_read on file for select using (
  (project_id is null or project_id in (select visible_projects()))
  and (conversation_id is null or conversation_id in (select visible_conversations()))
);

drop policy o_update on file;
create policy o_update on file for update using (
  (project_id is null or project_id in (select visible_projects()))
  and (conversation_id is null or conversation_id in (select visible_conversations()))
) with check (true);

drop policy o_write on file;
create policy o_write on file for insert with check (
  author_id = current_actor()
  and (project_id is null or project_id in (select visible_projects()))
  and (conversation_id is null or conversation_id in (select visible_conversations()))
);

/* And the files already sent: those uploaded for their first message — by
   its author, in the hour before it — in a room of their own project. A
   file put in Docs first and only later sent stays the project's. */
update file f set conversation_id = m.conversation_id
from message m join conversation cv on cv.id = m.conversation_id
where f.origin_type = 'message' and f.origin_id = m.id
  and f.conversation_id is null and f.project_id is not null and cv.project_id = f.project_id
  and f.author_id = m.author_id
  and f.created_at between m.created_at - interval '1 hour' and m.created_at;

create or replace function search_files(p_q text, p_project uuid)
returns table (id uuid, number int, project_id uuid, title text, created_at timestamptz, snippet text)
language sql stable security definer set search_path = public as $$
  with q as (select '%' || replace(replace(replace(p_q, '\', '\\'), '%', '\%'), '_', '\_') || '%' as l)
  select f.id, f.number, f.project_id, f.name, f.created_at,
         case when f.name ilike q.l then null
              else substr(f.said, greatest(1, strpos(lower(f.said), lower(p_q)) - 32), 96) end
  from file f, q
  where f.workspace_id = current_workspace()
    and (f.project_id is null or f.project_id in (select visible_projects()))
    and (f.conversation_id is null or f.conversation_id in (select visible_conversations()))
    and f.deleted_at is null
    and (f.name ilike q.l or (length(p_q) >= 3 and f.said ilike q.l))
    and (p_project is null or f.project_id = p_project)
  order by f.name ilike q.l desc, f.created_at desc
  limit 20
$$;

/* ------------------------------------------------- @everyone in a room

   A project's channel with chosen people told the whole project when
   somebody wrote `@everyone` in it. Everybody on the project only when
   nobody is chosen, as `can_see_conversation` has it. */
create or replace function room_people(p_conversation uuid) returns table (actor_id uuid)
language sql stable security definer set search_path = public as $$
  select cm.actor_id from conversation_member cm
  join conversation c on c.id = cm.conversation_id
  where cm.conversation_id = p_conversation and cm.deleted_at is null and cm.joined_at is not null
    and is_member(c.workspace_id)
  union
  select pm.actor_id from conversation c
  join project_member pm on pm.project_id = c.project_id and pm.deleted_at is null
  where c.id = p_conversation and c.project_id is not null and c.channel and is_member(c.workspace_id)
    and not exists (
      select 1 from conversation_member x
      where x.conversation_id = c.id and x.joined_at is not null and x.deleted_at is null
    )
$$;

/* ------------------------------------- an address proved by its owner

   Whoever followed an invitation link with somebody else's address made
   that account, and could turn a second factor on, make tokens and
   register a phone before the address was proved. Proving it took the
   password and the sessions back and left the rest — a factor the owner
   had never set up, which nothing they could do would turn off. Now an
   unconfirmed account claimed through a provider, or by a reset link, is
   cleared of everything its earlier holder made; and a reset of an
   account that had a password takes its phones too. */
create or replace function auth_claim_email(p_actor uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from app_user where actor_id = p_actor and email_verified_at is null) then
    update app_user set email_verified_at = now(), password_hash = null,
                        totp_enabled = false, totp_secret_enc = null, updated_at = now()
    where actor_id = p_actor;
    delete from recovery_code where actor_id = p_actor;
    update refresh_session set revoked_at = coalesce(revoked_at, now()), ended_at = now()
    where actor_id = p_actor and ended_at is null;
    update api_token set revoked_at = now() where actor_id = p_actor and revoked_at is null;
    delete from push_subscription where actor_id = p_actor;
  end if;
end $$;

create or replace function auth_set_password(p_actor uuid, p_hash text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_had boolean;
  v_unproved boolean;
begin
  select password_hash is not null, email_verified_at is null into v_had, v_unproved
  from app_user where actor_id = p_actor;
  update app_user
  set password_hash = p_hash, email_verified_at = coalesce(email_verified_at, now()), updated_at = now()
  where actor_id = p_actor;
  update refresh_session set revoked_at = coalesce(revoked_at, now()), ended_at = now()
  where actor_id = p_actor and ended_at is null;
  if v_had or v_unproved then
    update api_token set revoked_at = now() where actor_id = p_actor and revoked_at is null;
    delete from push_subscription where actor_id = p_actor;
  end if;
  if v_unproved then
    update app_user set totp_enabled = false, totp_secret_enc = null, updated_at = now()
    where actor_id = p_actor;
    delete from recovery_code where actor_id = p_actor;
  end if;
  insert into security_event (id, workspace_id, actor_id, kind)
  select gen_random_uuid(), m.workspace_id, p_actor, 'password_reset'
  from membership m
  where m.actor_id = p_actor and m.deleted_at is null and m.joined_at is not null;
end $$;

/* ---------------------------------------------------- whose card it is

   A plan is paid with somebody's card, and the workspace can change hands.
   The new owner then moved the old owner's subscription to a dearer plan,
   took back their cancellation, and opened their account at Polar. The
   payer is kept with the subscription, and only the payer changes what it
   charges. Those already paid for are the owner's
   at the time, which until today is who paid. */
alter table billing_subscription add column if not exists payer_id uuid references actor(id);
update billing_subscription b set payer_id = m.actor_id
from membership m
where b.payer_id is null and m.workspace_id = b.workspace_id and m.role = 'owner'
  and m.deleted_at is null and m.joined_at is not null;

create or replace function billing_payer(p_id text, p_payer uuid) returns void
language sql security definer set search_path = public as $$
  update billing_subscription set payer_id = p_payer
  where id = p_id and payer_id is null and exists (select 1 from actor where id = p_payer)
$$;
grant execute on function billing_payer(text, uuid) to tracker_app;

drop function billing_of(uuid);
create function billing_of(p_workspace uuid)
returns table (id text, customer_id text, payer_id uuid, plan text, period text, status text,
               current_period_end timestamptz, cancel_at_period_end boolean, ended_at timestamptz)
language sql stable security definer set search_path = public as $$
  select b.id, b.customer_id, b.payer_id, b.plan, b.period, b.status, b.current_period_end,
         b.cancel_at_period_end, b.ended_at
  from billing_subscription b
  where b.workspace_id = p_workspace and role_in(p_workspace) = 'owner'
  order by billing_live(b.status) desc, b.modified_at desc
  limit 1
$$;
grant execute on function billing_of(uuid) to tracker_app;
