# The keyboard reaches the row it is standing on

A task could be opened from the keyboard and the palette could take you
anywhere, but the row under the cursor could not be acted on: assigning,
moving, prioritising all meant opening the task or reaching for the pointer.
The cursor the arrow keys move was a reading position and nothing else.

Each letter **opens the control that is already on that row**, and does not
act on its own.

| | |
| --- | --- |
| `x` | take the row, or put it back — `docs/specs/many-at-once.md` |
| `s` | where it is: the same ring and menu the row draws |
| `p` | how urgent: the same mark and menu |
| `a` | who has it |
| `Enter` | open it |

That each letter opens a menu rather than doing something is the rule, not a
shortcut taken. A letter that acts on its own is a letter somebody presses by
accident, and the undo this product deliberately does not have is the reason
that matters more here than elsewhere. The digits inside the menu then pick,
which is how the list menu has always worked.

It also means there is one control per question. The key does not know what
assigning *is*; it finds the thing on the row that already knows and presses
it, the way a hand would.

## The digits are two things, and they do not collide

**1…6 open the tabs** while a project is on the screen, in the order the
tabs are drawn: `1` Tasks, `2` Chat, `3` Files, `4` Announcements, `5`
Activity, `6` Settings. Positions and not names — `2` is whatever is second
in *this* project, so a project without a chat has no hole in its keyboard
and nobody learns a different number per project.

**Inside an open menu the digits pick**, which they have always done. The
two never meet: the tab shortcut stands down while any row menu is open,
the same way it stands down for a field, for anything editable, and for a
dialog or the palette already asking a question. A menu on the screen is one
question, and switching tabs is the wrong answer to it.

The key and not the character, like the letters — but a digit needs its own
test. `Digit1` is the number-row key wherever the layout put the characters,
which on a French AZERTY types `&` unshifted; somebody pressing it means the
first tab. `Numpad1` counts too. Shift does not: `Shift+1` is `!` and a
different intention.

## A room puts the hand in its field, and Escape takes it out

Arriving at a chat room — by its tab, by `2`, by the next room over or into
a thread — puts the cursor in the message field: a room is opened to say
something in it. With a mouse and a keyboard only; on a phone a focused
field is the keyboard sliding over half the room somebody came to read. And
not taken from another field, a dialog or the palette.

That is where the digits stop switching tabs: in a field they are typed,
which is right — a message may start with a number, and nothing can tell
"2 questions" from "the second tab". So **Escape in an empty field leaves
it**, and the bare keys are the screen's again: `Esc` then `1` is Tasks.
With words in the field Escape does nothing — those are somebody's half-
written message. The digit that switched to the room is not typed into its
field: the tab shortcut takes the key before the field exists.

A modifier that switched tabs from inside a field was weighed and not done:
⌘1…9 and Ctrl+1…9 are the browser's own tabs, and ⌥ types characters on a
Mac. One key out of the field is the smaller thing to learn.

## Who has it, on the row

Assigning needed a control before a letter could open one: the row drew a
face and the face did nothing. It is the same shape as the list's ring and
the priority's mark now — a mark that is also the way to change what it
marks — and it appears under the pointer when nobody is on the task, for the
same reason the priority mark does: a column of empty circles down a list
nobody has assigned says nothing about any of it.

## What has no letter, and why

**Dates.** A date wants a calendar, which is a different kind of control from
a menu of five things, and the one that exists lives on the task's own screen.
A letter that opens a date field in a list row is a field that has to be
dismissed, which is a mode — and this screen has none.

**Nothing on the board.** There is no cursor to stand on: the arrow keys walk
a list, and a board is walked with the eye. A task opened from the board
is paged through in the board's order all the same — see "Paging through
an open task" below.

## Escape shuts the task, once nothing nearer wants it

The key already closes things all over the product, and each of those
handlers is right: the nearest thing to dismiss is what the hand meant.
What was missing is the press on a task with nothing open, where the only
way back to the list was the mouse.

It is bound on the task's own screen rather than in the shell. A global
"Escape goes back" was tried and taken out — most local handlers leave no
sign they ran, so there is no honest test for "nothing was open", and
firing anyway shut a menu and left the screen on one press.

Two things make it work, and both were found the hard way.

**The palette lays no sheet.** `[data-over]` was the whole test, and the
palette is invisible to it — so Escape over a task shut the palette and
the task together. The guard asks for the palette by name as well.

**The guard runs in the capture phase.** In the bubble phase the
palette's handler goes first, closes itself, and lets React flush
synchronously; a second bubble listener then looks for the thing it
should defer to and finds it already gone. Capture runs before any of
them, while what is open is still open. The close itself is deferred a
frame, so whatever was open gets the press and this one does nothing.

A field is the third exception: Escape in one gives up what is being
typed, which is the field's business.

## Paging through an open task

With a task open, **← and → open the one before and the one after it** in
the list it was opened from, in the order that list draws its rows. Reading
ten tasks was opening one, shutting it, finding the next row and opening
that; the arrows make it one key per task.

**Which list.** The one behind the task, as the address describes it: the
open task keeps `?view=`, the grouping, the ordering and the narrowing it
was opened with, so the same rows in the same order are the ones paged
through. On the list that is the walk the cursor takes — a task, then its
parts, then the next task, nothing from a shut band. On the board it is
each open column top to bottom, the columns left to right, which is the
order the eye reads it in. A task the list does not draw (a part opened
from its parent while the parts are hidden, a task narrowed out) has no
place in it, and the arrows do nothing there. A task opened from My tasks
opens in its project and pages through that project's list: the address
is the source of truth for where somebody is, and My tasks is not behind
the task once it is open.

**Left and right, not up and down.** Up and down already belong to the
list's cursor, and to the caret in the title and the body, which they
carry between. Left and right were free on a task's screen, and they are what Mail, Gmail and
every reader of one thing out of a list use for the next and the previous.
`j` and `k` stay the list's.

**At the ends, nothing.** The first task has no previous one and the last
no next; the key does nothing there. It does not wrap round: arriving back
at the top of a list without having been told is reading the same task
twice and believing it is new.

**Not while something else has the key.** In a field or the description
the arrows move the caret, which is what they are for there. A menu, a
dialog, the palette or a picture opened large keep them for themselves.
Anything nearer that already moved by the key — a column's width handle,
the calendar — said so by preventing the default, and this defers to it,
the same order Escape keeps. With a modifier the key is something else
(⌥← is a word, ⌘← is the browser's back). And one press, one task: a key
held down does not run down the list, filling the history with addresses
nobody read.

**The address is pushed, as opening a task pushes it.** Each task paged to
is a place somebody went, and Back retraces them the way it retraces a part
opened from its parent. Replacing was weighed: Back would then leave the
paging in one step. But Escape already does that — it shuts the task onto
the list — and a Back that skipped tasks somebody read is a Back that does
not go where they were. The list cursor moves with the paging, so Escape
lands on the row of the task last read rather than the one the paging
started from.

**Drawn whole.** Both neighbours of the open task are read ahead (`near`,
as the pointer does for the row under it), so the task the key opens is
drawn with its body and comments from its first frame. Nothing animates: a
key is answered at once — "nothing jerks". The screen is the same one from
task to task, so it is put back at its head before the paint, or the next
task opened scrolled to wherever the last one was left.

**Each task's own body, empty when it has none.** The screen is the same
one, and the description's editor is not: it is made again for every task,
from that task's remembered body, so nothing typed, uploading or held in
it can be carried to the next task and saved there. A read of the last
task that answers after the step is not drawn. It was one editor kept
across the step, which took a new body in only when there was one — so a
task with no description, paged to, showed the one before it, and a press
into it and away wrote that description onto the wrong task.

## From a title into its text

On a task's and a document's own screen, Enter or Down in the title puts
the caret at the start of the body's first line of words — not on a picture
that happens to come first; a body with no line is given one. The title
keeps what it said and saves as it does on leaving it. Enter while a word
is still being composed accepts the composition and goes nowhere.

Up from the body's first line is back to the title, the caret at the end of
it. From anywhere a line above the caret is still the body's, Up moves
within the body as it always has.

A picture, a file or a rule that opens the body is different: Up from it
makes an empty line above it and puts the caret there, because otherwise
nothing could ever be written before it short of cutting it out and pasting
it back. Up from that line is the title, as from any first line.

## Copy as prompt

⌘⌥P (Ctrl⌥P elsewhere) on a task's screen puts the task on the clipboard as
a prompt for an agent. The code of the key, not its
letter, so it works in any layout.

## Editing a message

In a room or a thread, **↑ in the empty line opens the last message you
wrote there** for editing, as Slack's does: the message most
often changed is the one just sent, with the typo seen the moment it
landed. Empty means nothing at all — no words, no line begun with
Shift+Enter, no file or GIF waiting to go. With anything in the line ↑ is
the caret's, and so it is while `@`, `#` or `:` has a list open. A room
where you have said nothing leaves the key alone.

**E over a message opens that one**, if it is yours — the one under the
pointer, or the one the keyboard is on (a button in its row has the focus).
Not in a field, where it is a letter; not while a menu, a dialog or the
palette is asking something; and not while another message is already open
for editing. Somebody else's message does nothing: the letter does not
offer what the ⋯ menu would not.

Both open the same editor the menu does, and it behaves as it always has:
Enter saves, Escape leaves the message as it was. Opened from the line,
the hand goes back to the line after either, so a typo fixed is ↑, the fix,
Enter, and on with the next message. The message is scrolled into view if
it was above the fold, at once — nothing a key does is animated.

The row is asked by an event on its own element rather than by an id handed
down to every row: the same message can be drawn in the room and in its
thread at once, and the one meant is the one in the list the hand is in.
