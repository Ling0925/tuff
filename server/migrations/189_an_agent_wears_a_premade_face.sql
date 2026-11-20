/*
 * An agent can wear one of the product's premade faces.
 * It is held where a picture's key is, as
 * `preset:<id>`, and it is not bytes: changing it away must not queue a
 * key that names nothing in storage for the clear-out to remove.
 */
create or replace function picture_bytes_go_with_it() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  was text;
  now_ text;
begin
  was := to_jsonb(old) ->> tg_argv[0];
  now_ := to_jsonb(new) ->> tg_argv[0];
  if was is not null and was is distinct from now_ and was not like 'preset:%' then
    insert into storage_orphan (key) values (was) on conflict do nothing;
  end if;
  return new;
end $$;
