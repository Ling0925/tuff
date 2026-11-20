-- A code mailed to an account with nothing to type.
--
-- An account made through Google or Apple, with no password and no second
-- factor, was asked nothing before it was deleted or its workspace handed
-- over but its own address, typed: a session left open on somebody's desk
-- was enough. Now six digits go to its inbox and those are the yes.
alter table auth_ticket drop constraint auth_ticket_kind_check;
alter table auth_ticket add constraint auth_ticket_kind_check
  check (kind in ('reset', 'handoff', 'verify', 'bind', 'approve', 'email', 'reauth'));
