-- One inbox, and the two things that keep it usable.
--
-- The design refuses a grid of checkboxes per event type, so there is exactly
-- one preference: whether chat counts. Without that separation a busy channel
-- drowns the assignments and the inbox stops being read at all, which is the
-- failure mode a matrix of switches is usually invented to fix.

alter table app_user add column notify_chat boolean not null default true;

-- Quiet hours. Notifications do not vanish, they wait: a person who is not at
-- work should not be woken, and should still find everything in the morning.
alter table app_user add column quiet_from time;
alter table app_user add column quiet_to time;
alter table app_user add column timezone text not null default 'UTC';

-- When it may leave, and whether it has. Separate from read_at: delivery is
-- about push and email, reading is about the person.
alter table notification add column deliver_after timestamptz not null default now();
alter table notification add column delivered_at timestamptz;

create index notification_pending on notification (deliver_after)
  where delivered_at is null and deleted_at is null;

-- The feed is read per workspace and per person, and both want an index. The
-- workspace one exists; this is the other.
create index activity_by_actor on activity_event (workspace_id, actor_id, at desc);

-- A link found in a body points both ways: following it back is what makes a
-- thread stop being the only place a decision lives.
create unique index object_link_unique
  on object_link (from_type, from_id, to_type, to_id) where deleted_at is null;
