# The order of the sidebar

Projects and conversations can be dragged into the order somebody wants them
in. Everything else in the sidebar is fixed — My tasks, Notifications,
Members, Settings are the shape of the product, and a person who has moved
Settings to the top has a sidebar nobody else can be talked through.

## Whose order it is

One person's, not the team's.

The design refuses settings, and what it refuses is a team having to agree on
an answer. Which project somebody wants at the top of *their* sidebar is not a
question the team has one of — it is the same kind of answer as how wide they
keep the sidebar, which is already theirs alone.

But unlike the width it is not kept on the machine. A width is a fact about a
screen; an order is a decision about work, and a decision that is on the
laptop and not on the phone reads as the phone having lost it. So it is on the
server, per actor, and the native clients get it for free.

## Where it lives

`sidebar_place`: actor, workspace, kind, object, key. A service record nobody
creates by hand, not a fifth entity and not a field on one of the four — the
thing being recorded is not a property of the project, it is a property of one
person's relationship to it.

Not on `project_member`, which was the obvious home and is the wrong one: an
owner sees every project in the workspace whether or not they are on it
(`visible_projects()`), so most of an owner's sidebar has no membership row to
hang a key on.

## The keys

Fractional, between the neighbours, computed on the server from the id the row
should sit behind — the same rule tasks follow. Three clients each generating
their own keys is three clients that disagree about order the first time two
people drag at once, and this product has three clients by the end of the
design.

**The first drag writes the whole list.** A key on the moved row alone would
make it jump past everything unplaced, so dragging the third project up one
place would send it to the top. The first placement in a workspace materialises
the order that is already on the screen, and then moves the one row. After
that there is nothing unplaced to disagree with.

A row with no key sorts after every row that has one, which is what happens to
a project made after somebody arranged their sidebar: it arrives at the bottom
of the arranged ones rather than in the middle of them. Being new is not a
position somebody chose.

## Saying where it will land

The row being carried stays where it is and goes quiet; a line is drawn in the
gap it would drop into, with a dot at the left end so it reads as a place and
not as a hairline between two rows.

Not the board's answer, on purpose. There, where a card will land is shown by
leaving the gap it would leave — which works because a column is wide and a
card is tall enough for the hole to read as one. A sidebar row is a thin strip
among identical thin strips, and the same trick there reads as the list having
twitched.

The line is drawn **over** the rows and takes no space. That distinction is
the whole reason the board rejected one: a two-pixel line inserted into the
flow moved everything below it by two pixels, which changed what was under the
pointer, which moved the line. An overlay moves nothing.

## What it is not

Not a position in the project itself, and not visible to anybody else. Two
people on one project can have it first and last, and neither is wrong.

Not a replacement for the cap: the sidebar still shows the first few and
"n more", because a sidebar is a way in, not an inventory.

Not reachable from the keyboard yet, and not by a finger. Dragging with a
pointer is the gesture this screen has: a row keeps `touch-action: pan-y` so
that a finger still scrolls the sidebar, which means a touch reorder would
have to begin with a long press. Both of those are different controls — worth
building, not built here, and said out loud rather than discovered.
