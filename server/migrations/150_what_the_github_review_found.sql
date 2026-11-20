/*
 * What an independent review of the GitHub integration found.
 *
 * Who installed the app: GitHub says it in the `installation` event's
 * sender, and that person — not anybody whose GitHub merely lists the
 * installation, which every member with read access to one of its
 * repositories does — is who may claim it for a workspace.
 */
create function github_installer(p_installation bigint) returns bigint
language sql stable security definer set search_path = public as $$
  select (payload #>> '{sender,id}')::bigint
  from github_event
  where event = 'installation' and installation_id = p_installation
    and payload ->> 'action' = 'created'
  order by received_at desc
  limit 1
$$;
grant execute on function github_installer(bigint) to tracker_app;

/* Who wrote a comment on GitHub, so only they can change or withdraw it
   here: an edit by anybody else on GitHub is not put in their mouth. */
alter table github_comment add column author_github_id bigint;
