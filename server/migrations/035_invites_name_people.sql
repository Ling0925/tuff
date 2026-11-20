/*
 * The last switch that names a client.
 *
 * `who_invites_clients` decides who may make an invite link at all — it has
 * never been about clients, and there are none now. Renamed rather than left
 * alone: a key is read by three clients and a person setting it, and one
 * that names a concept the product removed is a key that will be explained
 * wrongly by somebody in a year.
 *
 * The stored JSON is rewritten, for the reason migration 032 gives: a
 * workspace holding a shape the schema does not offer is a row that will
 * surprise whoever next parses it strictly.
 */
update workspace
set settings = (settings - 'who_invites_clients')
  || jsonb_build_object('who_invites_people', settings -> 'who_invites_clients')
where settings ? 'who_invites_clients';

alter table workspace alter column settings set default
  '{"who_creates_projects":"members","who_invites_people":"owner","edit_others_content":"documents_too"}'::jsonb;
