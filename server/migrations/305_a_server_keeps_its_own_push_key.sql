/*
 * The VAPID pair your own server makes for itself.
 *
 * A server with no VAPID key in its environment makes a P-256 pair on its
 * first start and keeps it here. One row, made once by whichever start
 * gets there first — the app or the worker — and never replaced: a new
 * pair ends every browser subscription anybody has granted. No function
 * updates or deletes it; only the table's owner can.
 *
 * The rules are the database's:
 *
 * - the row is made only on a server of one's own (`community`), and read
 *   only there: the service keeps its keys in the environment and never
 *   has a row;
 * - `instance_push_key_keep` inserts only if there is none and answers
 *   what is there afterwards, so two starts at once end with one pair;
 * - the private half is sealed by the application (`auth/seal.ts`,
 *   `vapid`) and moved by `reseal` (`reseal.ts`, `SEALED`); no role but
 *   the table's owner can select it, and the definer that hands it to the
 *   application hands it sealed. The worker process reads it through the
 *   application's connection (`db.ts`, `sql`), so `tracker_worker` is
 *   granted nothing here.
 *
 * Changes no rows.
 */

create table instance_push_key (
  id boolean primary key default true check (id),
  /* The uncompressed P-256 point — 0x04, x, y — base64url without padding,
     as a browser subscribes with it. Public. */
  public_key text not null check (public_key ~ '^B[A-Za-z0-9_-]{86}$'),
  /* The private scalar, sealed by the application; never returned to a
     request and never written to a log. */
  private_key_enc text not null check (length(private_key_enc) between 20 and 400),
  created_at timestamptz not null default now()
);
alter table instance_push_key enable row level security;
revoke all on instance_push_key from public, tracker_app, tracker_worker;

/* The pair, sealed as it is, for the app and the worker process to open
   with the key they already hold. Nothing on the service. */
create function instance_push_key_kept() returns table (public_key text, private_key_enc text)
language sql stable security definer set search_path = public, pg_temp as $$
  select k.public_key, k.private_key_enc
  from instance_push_key k join instance_setting s on s.id and s.community
  where k.id
$$;
revoke all on function instance_push_key_kept() from public;
grant execute on function instance_push_key_kept() to tracker_app;

/*
 * The pair, kept if there is none yet, and whatever is kept answered.
 *
 * Two starts at once both insert; the primary key makes the second wait
 * for the first and then do nothing, and its read — a statement of its
 * own, so it sees what the first committed — returns the first's pair.
 * Nothing on the service, and nothing ever overwritten.
 */
create function instance_push_key_keep(p_public text, p_private_enc text)
returns table (public_key text, private_key_enc text)
language plpgsql security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
begin
  if not coalesce((select s.community from instance_setting s where s.id), false) then
    return;
  end if;
  insert into instance_push_key (id, public_key, private_key_enc)
  values (true, p_public, p_private_enc)
  on conflict (id) do nothing;
  return query select k.public_key, k.private_key_enc from instance_push_key k where k.id;
end $$;
revoke all on function instance_push_key_keep(text, text) from public;
grant execute on function instance_push_key_keep(text, text) to tracker_app;

/*
 * The public key the serving app signs with, said on its every start, so
 * the worker can tell when it would sign with another — `VAPID_*` set on
 * one service only, or `ENCRYPTION_KEY` or `JWT_SECRET` that differ — and
 * say so rather than every push failing in silence. Public; null when the
 * app has no pair.
 */
alter table instance_setting add column push_public_key text check (push_public_key ~ '^B[A-Za-z0-9_-]{86}$');

/* As the table owner only: the serving start. */
create function instance_push_app_key_said(p_public text) returns void
language sql security definer set search_path = public, pg_temp as $$
  update instance_setting set push_public_key = nullif(p_public, '') where id
$$;
revoke all on function instance_push_app_key_said(text) from public;

/* What the app last said it signs with. Nothing on the service. */
create function instance_push_app_key() returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select push_public_key from instance_setting where id and community
$$;
revoke all on function instance_push_app_key() from public;
grant execute on function instance_push_app_key() to tracker_app;
