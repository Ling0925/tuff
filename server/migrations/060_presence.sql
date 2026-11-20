/*
 * Who is here — `docs/specs/presence.md`.
 *
 * Two columns on the actor, because being here is a property of a person
 * and not a fifth entity. `seen_at` is when they were last active, not when
 * a socket opened: a laptop asleep with a tab open holds its websocket for
 * hours, and a connection is not a person. `presence` is what they chose,
 * or null for "work it out".
 */
alter table actor
  add column seen_at timestamptz,
  add column presence text;

alter table actor
  add constraint actor_presence_known
    check (presence is null or presence in ('away', 'busy'));

/*
 * And the one answer, so no screen invents its own threshold.
 *
 * Three states and not five: "offline" and "idle" are the same answer to
 * the person looking — nobody is coming back to you in the next minute — so
 * they are one state, and calling it away says the useful half.
 */
-- `stable` and not `immutable`: it reads the clock, and a function that
-- promises the same answer for the same arguments while quietly depending on
-- `now()` is one the planner is entitled to fold into a constant.
create function presence_of(p_seen timestamptz, p_chosen text) returns text
language sql stable parallel safe as $$
  select case
    when p_chosen = 'busy' then 'busy'
    when p_chosen = 'away' then 'away'
    when p_seen is null then 'away'
    when p_seen > now() - interval '5 minutes' then 'here'
    else 'away'
  end
$$;
