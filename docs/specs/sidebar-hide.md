# A room put away

A right press on a room in the sidebar offers **Hide** — or the room is
dragged into Hidden, below. The room goes under **More chats** at the foot
of the list, behind the same "n more" the list already had for its tail,
and a right press there offers **Show in the list**.

When anybody else says something in a room somebody put away, it comes back
out for them — and stands at the head of their list, newest first, so the
thing that just woke up is the first thing they see. Speaking in it yourself
brings it back too, without moving it.

It stays at the head until the person arranges the list: dragging any room
writes the whole order down as it stands (`places.ts`), and from then on the
room is simply where it is.

Kept on the person's own `conversation_member` row — `hidden_at`,
`surfaced_at` — next to the read mark and `notify`, and set with
`PUT /api/conversations/:id/hidden { hidden }`. One person's sidebar and
nobody else's.

## Hidden is a place, and a room is dragged into it

The a word: *let me drag things everywhere here — a chat
dragged into the Hidden block is hidden.*

Opened with "n more", the list draws its rooms put away under a quiet
**Hidden** label — the column's group label, closer in its spacing, because
it is a line inside one list and not the head of another. Without it the
hidden rooms ran straight on from the shown ones, and nothing said where one
part stopped.

- **Dragged below the label**, a room is hidden, and it lands among the
  hidden ones where it was dropped.
- **Dragged above it**, a hidden room is shown, where it was dropped.
- **While the list is shut**, "n more" is what a room is dropped *on*: it
  lights in the drop line's colour — a ring and a tint, which take no room —
  and letting go there hides the room, wherever its place already puts it.

The label is counted in the drag, so the gap just above it (shown) and the
gap just below it (hidden) are two places; it cannot be picked up itself.
The row moves at once; then the hide and the place go to the server one
after the other — `PUT …/hidden` first, `POST …/place` second — and the list
is read again after, which puts the row back if either was refused. A drop
at the head of a part, with nothing drawn above it, is placed right before
the row below it: the order on the server is one list, shown and hidden
rooms mixed.

This reverses a decision written in `Capped`: that "n more" was *a way in,
not a place to put things*, because a row cannot be dropped behind something
nobody can see. That is still true of the rows behind it — only "n more"
itself is a target, and the order among them is arranged with the list open.

The projects use the same list with nothing put away and drag exactly as
they did: no label, and "n more" is not a target there.
