/*
 * A reply in a thread that is also said in the room — `docs/specs/chat-threads.md`,
 * "Also in the room".
 *
 * Slack's "Also send to #channel". One message, not two: the reply stays
 * in its thread, and this says the room's history lists it too, with a
 * line saying which thread it answers. A second row would be a copy that
 * an edit, a reaction or a deletion reaches only half of.
 *
 * Only a reply may say it — a message at the top of the room is in the
 * room already. `not valid`: no row before this could have broken it, and
 * a million of them need not be read to prove so.
 */
alter table message add column also_in_room boolean not null default false;
alter table message add constraint message_also_in_room_is_a_reply
  check (not also_in_room or parent_id is not null) not valid;
