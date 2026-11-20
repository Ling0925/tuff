/*
 * Ways to sign in, added from the Apple and Android apps.
 *
 * The sheet an app goes to the provider in carries no cookie of the app's,
 * so the callback cannot link: it leaves what the provider said waiting as
 * a `linked` ticket, and the app finishes it over the session that asked,
 * with the secret whose SHA-256 the link ticket is bound to. `binding` of
 * a `linked` ticket is the hash of the link ticket it came from, the
 * provider, and who the provider named, as JSON — nobody's to read but
 * through `auth_ticket_binding`.
 */

alter table auth_ticket drop constraint auth_ticket_kind_check;
alter table auth_ticket add constraint auth_ticket_kind_check
  check (kind in ('reset', 'handoff', 'verify', 'bind', 'approve', 'email', 'reauth', 'link', 'linked'));
