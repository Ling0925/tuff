/*
 * Incoming webhooks into a room, in Slack's shape.
 *
 * A room's address with a secret in it, which takes Slack's incoming-
 * webhook JSON and puts a message in the room under the hook's name. The
 * secret is kept as its SHA-256 and never readable by the application
 * role: it is written through `room_hook_make` and `room_hook_turn`, and
 * a post from outside is matched through `room_hook_take`, which answers
 * only when the hash is right.
 *
 * Every table carries `workspace_id`, so `purge_workspace` takes it with
 * the rest; and a hook goes with its room, by cascade, so a room deleted
 * for good is not held back by its hooks.
 */

create table room_hook (
  id uuid primary key,
  workspace_id uuid not null references workspace(id) on delete cascade,
  conversation_id uuid not null references conversation(id) on delete cascade,
  name text not null check (length(name) between 1 and 80),
  secret_hash text not null check (secret_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid not null references actor(id) on delete cascade,
  created_at timestamptz not null default now(),
  turned_at timestamptz,
  last_used_at timestamptz,
  deleted_at timestamptz
);
create index room_hook_by_room on room_hook (conversation_id) where deleted_at is null;
/* For the triggers below, which find a person's hooks when they go. */
create index room_hook_by_maker on room_hook (created_by, workspace_id) where deleted_at is null;

alter table room_hook enable row level security;
/* Read by whoever can read the room — the room's settings list them for
   the people who may manage them, which the handler asks `can()`. */
create policy rh_read on room_hook for select to tracker_app
  using (workspace_id = current_workspace() and can_see_conversation(conversation_id));
create policy rh_remove on room_hook for update to tracker_app
  using (workspace_id = current_workspace() and can_see_conversation(conversation_id))
  with check (workspace_id = current_workspace());
grant select (id, workspace_id, conversation_id, name, created_by, created_at, turned_at, last_used_at, deleted_at)
  on room_hook to tracker_app;
grant update (deleted_at) on room_hook to tracker_app;

/* The hook a message came through; null for every other message. */
alter table message add column hook_id uuid references room_hook(id) on delete set null;

/*
 * A new hook on a room the caller can see, which must be a channel: a
 * direct conversation is nobody's to point the outside at. Who may is
 * `can()`'s to say (`hook.manage`) and the handler asks it first. Twenty a
 * room, counted under a lock on the room, so two at once cannot both be the
 * twentieth. Answers `made`, `full`, or `no`.
 */
create function room_hook_make(p_id uuid, p_room uuid, p_name text, p_hash text) returns text
language plpgsql volatile security definer set search_path = public as $$
begin
  if current_actor() is null or current_workspace() is null then
    return 'no';
  end if;
  if not can_see_conversation(p_room) then
    return 'no';
  end if;
  perform 1 from conversation c where c.id = p_room and c.workspace_id = current_workspace()
    and c.deleted_at is null and c.channel for update;
  if not found then
    return 'no';
  end if;
  if (select count(*) from room_hook h where h.conversation_id = p_room and h.deleted_at is null) >= 20 then
    return 'full';
  end if;
  insert into room_hook (id, workspace_id, conversation_id, name, secret_hash, created_by)
  values (p_id, current_workspace(), p_room, p_name, p_hash, current_actor());
  return 'made';
end $$;
revoke execute on function room_hook_make(uuid, uuid, text, text) from public;
grant execute on function room_hook_make(uuid, uuid, text, text) to tracker_app;

/*
 * A new secret for a hook on a room the caller can see; the old one stops
 * working in the same statement. And the hook is the caller's from now on:
 * it posts with their sight and their rights, and goes when they go — a
 * hook somebody turned over and handed to a tool is theirs to answer for,
 * not whoever first made it.
 */
create function room_hook_turn(p_id uuid, p_hash text) returns boolean
language plpgsql volatile security definer set search_path = public as $$
declare
  n int;
begin
  if current_actor() is null then
    return false;
  end if;
  update room_hook h set secret_hash = p_hash, turned_at = now(), created_by = current_actor()
  where h.id = p_id and h.deleted_at is null
    and h.workspace_id = current_workspace()
    and can_see_conversation(h.conversation_id);
  get diagnostics n = row_count;
  return n = 1;
end $$;
revoke execute on function room_hook_turn(uuid, text) from public;
grant execute on function room_hook_turn(uuid, text) to tracker_app;

/*
 * Whether somebody may still manage a room's hooks — `hook.manage` in
 * `can()`, said again here for a request with nobody signed in: the owner;
 * or a member the owner has not kept from opening channels who, in a
 * project's channel, holds `channel.create` or runs the project there.
 * Keep the two together.
 */
create function may_manage_hooks(p_actor uuid, p_workspace uuid, p_project uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from membership m
    where m.workspace_id = p_workspace and m.actor_id = p_actor
      and m.joined_at is not null and m.deleted_at is null
      /* Never an address nobody has proved: `hook.manage` is in
         NEVER_UNPROVED, so not even an unproved owner — whom `can()`
         otherwise counts as a member — may. */
      and auth_email_confirmed(p_actor) is not false
      and (m.role = 'owner'
           or (m.role = 'member' and m.may_create_channels
               and (p_project is null
                    or exists (select 1 from project_member pm
                               where pm.project_id = p_project and pm.actor_id = p_actor
                                 and pm.deleted_at is null
                                 and pm.rights && array['channel.create', 'manage']::text[])))))
$$;
revoke execute on function may_manage_hooks(uuid, uuid, uuid) from public;

/*
 * A post from outside, with nobody signed in: the hook, when the hash is
 * its own, the hook and its room stand, the room is still a channel, and
 * whoever answers for the hook is still in the workspace and may still
 * manage the room's hooks. Nothing at all otherwise — an unknown id and a
 * wrong secret are the same answer. The message is then written as them,
 * under their own policies, which ask the rest.
 */
create function room_hook_take(p_id uuid, p_hash text)
returns table (workspace_id uuid, conversation_id uuid, created_by uuid, name text)
language plpgsql stable security definer set search_path = public as $$
begin
  return query
    select h.workspace_id, h.conversation_id, h.created_by, h.name
    from room_hook h
    join conversation c on c.id = h.conversation_id
    where h.id = p_id and h.secret_hash = p_hash and h.deleted_at is null
      and c.deleted_at is null and c.channel
      and may_manage_hooks(h.created_by, h.workspace_id, c.project_id);
end $$;
revoke execute on function room_hook_take(uuid, text) from public;
grant execute on function room_hook_take(uuid, text) to tracker_app;

/* When a hook last put a message in its room — only a post it took. */
create function room_hook_used(p_id uuid) returns void
language sql volatile security definer set search_path = public as $$
  update room_hook set last_used_at = now() where id = p_id and deleted_at is null
$$;
revoke execute on function room_hook_used(uuid) from public;
grant execute on function room_hook_used(uuid) to tracker_app;

/*
 * Taken out of the workspace, off the project, or out of the channel, a
 * person's hooks there go for good — so bringing them back later does not
 * bring back an address a tool somewhere still holds.
 */
create function room_hooks_go_with_their_maker() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  /* A room's people are taken out by `joined_at` going null; the rest by
     `deleted_at`. Either, from a row that was in. */
  if tg_table_name = 'conversation_member' then
    if not (old.deleted_at is null and old.joined_at is not null
            and (new.deleted_at is not null or new.joined_at is null)) then
      return new;
    end if;
  elsif new.deleted_at is null or old.deleted_at is not null then
    return new;
  end if;
  if tg_table_name = 'membership' then
    update room_hook set deleted_at = now()
    where created_by = new.actor_id and workspace_id = new.workspace_id and deleted_at is null;
  elsif tg_table_name = 'project_member' then
    update room_hook h set deleted_at = now()
    from conversation c
    where c.id = h.conversation_id and c.project_id = new.project_id
      and h.created_by = new.actor_id and h.deleted_at is null;
  else
    update room_hook set deleted_at = now()
    where conversation_id = new.conversation_id and created_by = new.actor_id and deleted_at is null;
  end if;
  return new;
end $$;
create trigger room_hooks_go_with_membership after update of deleted_at on membership
  for each row execute function room_hooks_go_with_their_maker();
create trigger room_hooks_go_with_project_member after update of deleted_at on project_member
  for each row execute function room_hooks_go_with_their_maker();
create trigger room_hooks_go_with_conversation_member after update of joined_at, deleted_at on conversation_member
  for each row execute function room_hooks_go_with_their_maker();
