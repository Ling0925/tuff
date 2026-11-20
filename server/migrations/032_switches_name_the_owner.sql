/*
 * The switches stop naming a role that is gone.
 *
 * Both of them offered "admins" as the narrow answer, and with the role
 * removed that word names nobody — the narrow answer is the owner. The
 * behaviour does not change: the value was never equal to 'members', and
 * that is still the only comparison either switch makes.
 *
 * The stored JSON is rewritten rather than read leniently, because a
 * workspace holding a value the schema does not offer is a row that will
 * surprise whoever next parses it strictly.
 */
update workspace set settings = jsonb_set(
  settings, '{who_creates_projects}', '"owner"'
) where settings->>'who_creates_projects' = 'admins';

update workspace set settings = jsonb_set(
  settings, '{who_invites_clients}', '"owner"'
) where settings->>'who_invites_clients' = 'admins';
