# Who is in a room

The row under a room's bar — faces and "4 people" — opens a list of them.

It was a statement with nothing behind it: a count, and no way to learn
which four without saying something and seeing who answered.

**Where it sits.** A room opened from the sidebar has a bar across the
whole sheet, the bar an open task has: the `#` and the name, then the faces
and the count, then find, how loud it is and its settings as round grey
buttons at the end, with the sheet's rule under it. The room's reading
column starts below. It was two lines inside the column, the name over the
people, and the second was a line of chrome for three faces. On a phone the
bar has room for the name alone, so the people keep their line under it.
Inside a project the room's name is the tabs', and the people are the line
under them, as before.

## The list

- Each person: face with the presence dot, name ("· you" on your own row),
  and under it what they do in their own words — `actor.title` — or
  "Owner" when they have none and are one.
- The name opens their page (`/members/:actorId`); the bubble, shown on
  hover and to the keyboard, opens a direct conversation with them. Not on
  your own row.
- Ordered by name. Past eight people a field finds somebody by name or
  title, focused when the list opens.
- A popover over the room, not a screen: it is glanced at and shut.

## The data

`GET /api/conversations/:id/members` carries `title`, `presence` and `role`
beside the name and face, so the list draws from what the row already
loaded and opens with nothing to wait for. `docs/api.md`.
