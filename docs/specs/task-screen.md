# A task's own screen

One column, 800 wide, in the middle of the pane. It was two: the words on
the left and a column of facts down the right with the history and the
hours under it, so the eye crossed the screen and back for every answer and
the thing read once a week stood beside the thing read every time.

## The title

As many lines as it takes. It was a one-line field, so on a phone the end
of most titles ran off the screen with no way to read it but to walk the
caret along; it is a text area that grows with what is in it. Enter still
goes into the body, and a pasted line break becomes a space — a title is one
sentence. A document's name is the same.

## Under the title

The facts a task is triaged by, two to a row: **status** and **assigned**,
**labels** and **priority**, **due** and — where the project has sprints —
**sprint**. Each is a word and the control that answers it, and the whole
chip is the control: a press anywhere on it opens the same menu the list's
row does. The assignee is the same menu as everywhere else, Nobody first.

**Starts** is gone from the screen. A start date answered "when does work
begin" for a timeline the product does not draw; the column stays in the
data and the contract, and nothing here asks it.

## Behind round buttons

On the bar, beside the menu, the way the list's view is opened:

- **The clock** opens the hours: the total, what was logged, and a line to
  log more.
- **The menu** (⋯) is round too, with Duplicate and Delete; on a phone it
  drops down under its button rather than rising as a sheet — two short
  rows in a corner are better as what they are on a desk.
- **The history** opens what was done to the task, newest first, with
  **Subscribe** at its head — the same question asked forward, whether you
  hear what happens next. It was "Watch" in the facts column; the inbox and
  the table call it a subscription.

One at a time, beside the task, a border and no ground. It arrives whole —
a few pixels in from the right and faded up — rather than uncovered by a
widening box, which drew it through a mask with its border and words cut
down the middle for the whole of the opening. Where the margin beside the 800-wide column takes it, it
stands in the margin and the task does not move; where it does not, the
task makes way, sliding from where it was to where it now is — after a
press on one of the round buttons only. A task opened with a panel already
open is drawn with it in place, measured before the first paint, and
nothing moves while it arrives. On a phone each opens as a sheet from the foot of the screen, the way the
menus there do — the sheet is where a thumb already is. In a sheet the
controls a person presses — Subscribe, Log time, the day, taking an hour
back — stand on a ground and are forty tall, the size of a thumb.

## The head

The way back, the task's handle and the round buttons run across the whole
width of the pane, with a light line under them: the task's head, not the
first line of its column. The way back is a round button like the others —
the word "Tasks" beside it said what the tab already says. The head is
slim and padded the same on every side — eight pixels round its row —
because it is chrome over the task, not a band of its own.

A part shows where it sits: the task it is part of, its handle and title,
then its own handle. The parent is a link to it, which was missing — the
way back up from a part was the browser's back button. Which
one was open is remembered on this device — whether a person likes the
history open is not a question a team has an answer to.

## Parts

A part cannot have parts — the database refuses it — so a part's screen has
no sub-tasks section and no button to add one. On a task of its own, "Add a
sub-task" stands on a ground like the other things a person presses; once it
has parts, a round plus beside the "Sub-tasks" heading adds the next one
instead of a second button under the list.

## On a phone, chips — TRA-99

Under 640 the facts are one wrapping row of chips rather than the
label-and-value table: status, who, labels, priority, due, sprint. Each chip
is its control and its value, and an empty one says what it would hold
(Assigned, Labels, Priority, Due, Sprint) in the quiet ink. One label shows
as itself, more as a count — a chip three labels wide is a row of its own.
Five lines of table stood between the title and the description, half the
screen; the chips take two. On a desk the table stays: there is room for the
labels, and they are read down a column.

## The Sprint row with the screen

The sprints were read when the task opened, so the Sprint row appeared a
moment after everything else and pushed what was under it down. The list
behind remembers them per project, and the task's screen draws from that
at once and reads again behind it. Reading a task ahead now happens on the
first touch as well as under the pointer — a phone has no hover — and on a
board card as on a row.

## Opened again on what was left in it

A task opens at once on what this browser remembers of it, and reads the
server behind that. The memory was written only by reads — so a title
fixed, then Back, then the task opened again, drew the title from before
the fix and jumped to the fix when the read came back. Linear does not
jump because every write goes through its local store first. This is the
same rule at the size of one task: the remembered copy follows the screen
— title, facts, body, sub-tasks, comments, time — as each is changed, so
reopening draws what was left, and the read that follows agrees with it.

And a read is not allowed to put the past back. A read asked for before
the last change made here — a hover's read ahead still on its way, a
reload that set off while the change was being sent — answers with the
task before the change; it is dropped rather than remembered or drawn.

## The title is kept as it is typed

It was kept when the field was left, and leaving the task does not always
leave the field: Escape, the browser's Back, a swipe back on a phone — the
screen went and took the new title with it. It is kept half a second after
the last key now, at once on leaving the field, and on leaving the task
however that happens (and on the page going away). Typing counts as a
change, so a read that set off before it cannot put the old title back
under the caret — which a slow read had done.
