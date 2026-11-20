/*
 * A new project's key and slug are chosen against every project in the
 * workspace, not only the ones the person making it can see.
 *
 * Both triggers ran as the person inserting, so row-level security hid from
 * them every deleted project and every project they are not on. The key
 * `WEB` of a Website in the bin, or of one somebody else runs, looked free;
 * the trigger took it, the unique index refused it, and making a project
 * answered 500 — found by the browser tests binning a "Bin …" project and
 * then making a "Binned …" one. Run as the table's owner, they see what the
 * unique indexes see. The insert itself is still the person's, under the
 * same policies as before; all these read is which keys and slugs are taken.
 */
alter function project_key_fills_itself() security definer set search_path = public;
alter function project_slug_fills_itself() security definer set search_path = public;
