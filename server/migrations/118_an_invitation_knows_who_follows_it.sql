/*
 * An invitation followed by somebody already in Tuff.
 *
 * The link asked everybody for a name, an email and a password, somebody
 * signed in to Tuff that minute included: their own password typed again,
 * for a workspace they had been asked into. Signed in, the link is one
 * press. It needs to know which workspace the invitation is to and whether
 * the person following it is in it already — a member pressing their own
 * link spent it, and the invitation it was meant for went with it.
 *
 * Only for a session with somebody in it, and only the workspace's id: its
 * name was already on the page for anybody holding the link.
 */
create function invite_for_me(p_token_hash text)
returns table (workspace_id uuid, member boolean)
language sql stable security definer set search_path = public as $$
  select i.workspace_id,
         exists (
           select 1 from membership m
           where m.workspace_id = i.workspace_id and m.actor_id = current_actor()
             and m.deleted_at is null and m.joined_at is not null
         )
  from invite i
  where i.token_hash = p_token_hash and current_actor() is not null
$$;
grant execute on function invite_for_me(text) to tracker_app;
