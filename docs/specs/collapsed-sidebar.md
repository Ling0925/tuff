# The sidebar, narrowed to its glyphs

Dragged past the point where a name fits, the column becomes a strip of
glyphs. Dragged back, it is what it was.

## Why there is nothing in between

The handle already moved the column between 200 and 380, and below 200 it
simply resisted. That resistance was right: at 150 a project called
"Acme rebrand" is "Acm…", which is the fault the phone work spent a day
removing from the task list. A column of three-letter names is a column
nobody can use and a product that let you make one anyway.

So the range below 200 is not a narrower sidebar, it is a different one —
and the drag crosses it rather than stopping inside it. **Under 150 the
column snaps to 56; over 100 from there it snaps back.** The two numbers
differ on purpose: one threshold would make a column that is sitting exactly
on it flicker between the two states while the hand is still.

Fifty-six is a 32px glyph with twelve either side, which is the row's own
padding.

**The glyphs grow when the names go.** Twenty beside a name and
thirty-two without one: at twenty a project's mark in a narrow column is a dot with a
lot of air round it, and the mark is the only thing left saying which
project this is. A column of glyphs is not a column of names with the names
removed — what is left has to carry the work the names were doing.

**And a room says it is one.** A channel draws its project's mark, so in a
column of glyphs a project and its channel are the same picture. A small
bubble in the corner tells them apart. That is a thing the wide column does
not have, because there the name says it — so the shut column is not quite
"the same rows without labels", and this is the one place it is not.

## It remembers the width it had

Expanding returns the column to 248 or 320 or wherever it was, not to a
default. The width was somebody's answer to how much room they wanted;
collapsing is a different question and should not throw the first answer
away.

Kept beside the width itself, on this machine. An order is a decision about
work and lives on the server — `docs/specs/sidebar-order.md` — but how wide
a column is on a 13-inch laptop is a fact about that screen, which is the
same argument the width already made.

## What the glyphs are

Everything, in the order it was already in: My tasks, Members, the projects,
the rooms. A project keeps its own mark and a room keeps its project's, so
the column is still recognisable rather than six copies of one shape.

**Not a shorter list.** Collapsing to the four headings and hiding the
projects would make the thing people actually navigate with two presses
further away than it was, in the name of tidiness.

The name arrives on hover, in the title a row already carries. Not a
designed tooltip: the browser's is late by design — about a second — which
is right for something that confirms a guess rather than something you are
meant to read.

**A room loses its second line.** In the wide column a chat room draws the
project under its name; there is no room for it and the glyph is the
project's mark, which answers the same question.

**The way to make a project is not in it.** A bare plus in a column of
glyphs is a button with nothing saying what it would make, and the heading
it hangs off is gone. `c` makes a project from anywhere and so does the
bar — this is the one place that was a third way in.

## The highlight is a square around the tile

Forty around a thirty-two, which is four either side — and not the width of
the column, which is what the wide sidebar's highlight does. In a column of
names the lit ground is the row and the row is the column; here the row is
the tile, and a highlight running the full 56 would be a band with a picture
floating in it.

It came out wrong first in a way worth recording, because the cause was not
where it looked. The highlight copies the row's own box —
`getComputedStyle(it).borderRadius` and its rectangle — and the shut row had
no width of its own, so it shrank to its contents: 28 wide against a 32
tile. The tile hung two pixels out either side and the highlight came out
*narrower* than the thing it was lighting, which reads as a vertical pill.
Giving the row a size fixed the shape without touching the highlight at all.

## The workspace sits over whatever the column's first thing is

And that thing moves. Beside a column of names the first thing is a 20px
glyph inset twelve, whose centre is 33; beside a column of glyphs it is a
40px tile inset sixteen, at 36. One padding cannot be under both — set to
sixteen for the shut column it was four pixels out in the wide one, which is
the state somebody is in nearly all the time.

So the bar's own inset follows the column: twelve beside names, sixteen
beside glyphs. Wide it lines up exactly; shut it is one pixel out, which is
where it stays — closing that pixel needs a 15, and every measurement in
this product is a multiple of four for a reason the project's handbook gives at length.

## What does not change

The order, the drag that sets it, which row is lit, where the scroll is. The
collapsed column is the same column with its labels taken off, not a second
navigation.

Below 1024 none of this applies: the sidebar is a drawer there, and a drawer
that can also be narrowed is two gestures arguing — `docs/specs/narrow.md`.

## A line between the groups

Shut, a group's heading — its name and its plus — is a short hairline
instead. The name has gone with the column's words, and the plus left on
its own between the projects and the rooms read as a thing to press rather
than as where one list ends. Making a project or a conversation is from the
column opened, or from the bar's own make button.

## Shutting moves

It shut in one frame. The width eased only while no hand was on the
handle — so a resize does not lag the pointer — and the drag across the
threshold is always held, so the one change that is a state rather than a
size jumped from 150 to 56. The bar's left block, which stands over the
column, jumped with it.

Now the travel is on for the length of a change of state and off
otherwise: 200 ms on the strong ease-out, for the column, the bar's block
over it (where the browser can interpolate to `auto`), and the project's
column when it folds into this one — two
columns moving at once read as one movement. The rows change shape in one
frame whatever the width does, names to glyphs, so they arrive in the new
shape from nothing on the same curve rather than being swapped under a
column still moving. An arrow key on the handle, or Enter on it, changes
the column without travel; reduced motion gets none.
