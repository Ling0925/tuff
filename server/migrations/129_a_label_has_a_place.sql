/*
 * A label has a place in its project's order.
 *
 * Labels were listed by name, so the one a team reaches for most could sit
 * last because it was called "Urgent". Now they are in the order somebody
 * put them, as the lists are. Byte-ordered like every other key here
 * (070), and nullable: a label made before this, or by a path that does not
 * say where, comes after the ordered ones, by name, until somebody moves it.
 */
alter table label add column sort_key text collate "C";
