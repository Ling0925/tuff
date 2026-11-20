/*
 * When a subscription was last written to.
 *
 * It was a plain `update push_subscription set last_used_at = now()` from the
 * sender, and the sender has no actor: `ps_update` is `actor_id =
 * current_actor()`, so the statement matched nothing and said nothing. Every
 * device looked as though it had never been used, including the ones being
 * used every two seconds.
 *
 * Fourth time in this file's history — `subscribers`, `notify_prefs`,
 * `push_about`, this. The rule is simple and keeps being forgotten: anything
 * the worker touches goes through a function that runs as the owner, because
 * asking as nobody is a check that reads as working and does not.
 *
 */
create function push_used(p_id uuid) returns void
language sql volatile security definer set search_path = public as $$
  update push_subscription set last_used_at = now(), updated_at = now() where id = p_id
$$;

grant execute on function push_used to tracker_app;
