/*
 * Saved views, taken out.
 *
 * Built, used, and decided against — the product does not want a view with a
 * name on it. The view spec says what the panel asks and the address
 * holds; a saved view was a name for one set of those answers, and the answer
 * to whether that is worth a table is no.
 *
 * Dropped rather than left to sit. A table nothing writes to is a table the
 * next person has to work out the status of, and the schema is the one place
 * where "we tried this" must not be readable as "this is how it works".
 */
drop table if exists saved_view;
