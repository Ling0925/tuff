# Many rows at once

Triage happens in runs. Ten things arrive, eight of them belong in the same
list, half of those belong to the same person — and until now that was
eighteen separate gestures, each one a menu opened and closed on a row that
had the same answer as the row above it.

A selection, and one action for all of it.

## Selecting

- `x` takes the row the cursor is standing on, or puts it back. The cursor is
  the one the arrow keys already move, so this is the gesture that was
  missing rather than a new idea.
- Cmd or Ctrl and a press does the same with the pointer.
- Shift and a press takes everything between the last one taken and this one,
  which is how a run of ten is taken in two gestures rather than ten.
- Escape puts the whole selection down.
- A plain press still opens the task. Selecting is deliberately the gesture
  with a modifier on it: opening is what people do far more often, and the
  common thing does not get the harder gesture.

What is selected is marked on the row, not merely lit: the travelling
highlight says where the cursor is, and a row that is chosen has to survive
the cursor moving on. The view spec draws that line.

## Acting

The bar that says what is being looked at — the chips, Board, the view
answers — says what is selected instead, for as long as anything is. The same
strip, the same height, the same place: a floating panel over the work would
be chrome on a content surface, which the glass spec refuses, and
anything that appears *beside* the list moves the list.

It carries the four things a run of tasks is triaged with — the list, the
person, the priority, and throwing them away — and each of them opens the
menu that single row already has. One control per question, wherever the
question is asked.

**One request per task, not a bulk endpoint.** Every one of these is an
endpoint that already exists and already decides permission per object; a
second path that takes a list of ids is a second permission model, which is
the rule the design leans on hardest. The screen moves first and the requests
follow, the same as every other write here.

**The selection survives the action** — twelve tasks moved to Doing are
usually twelve tasks about to be given to somebody — and is put down by
Escape, by a plain press, or by the screen changing underneath it.

## What it is not

Not a mode: nothing is switched on first. The selection exists because
something is in it, and stops existing when nothing is.

**On the board too**, which this said it was not. The argument was that a card
is dragged there and dragging is the screen's own gesture for moving work in
bulk — and that is wrong twice over. A drag moves one card, so it was never a
bulk gesture; and the list a card is in is only one of the four questions a
run of cards gets asked.

Cmd takes one, shift takes a run **within one column**: across columns there
is no single order to run along, so a shift press in another column takes just
that one. A rule nobody can predict is worse than no rule.

And a drag carries the rest of the selection with it. Dragging one of four
taken cards and leaving three behind is the gesture half-done — the selection
said these four are one thing and the drag said only this one is. They land
after the dragged card rather than at the pointer, because there is one
pointer and four cards.

**Together, and in the order they were carried.** The dragged card first, then
the rest as they stood on the board — columns left to right, each top to
bottom. That is the order the column shows while they are in the air, and the
drop puts down exactly that: contiguous at the gap, before any answer comes
back, after all of them, and on a fresh load.

It did not. The rest were sent at once, each "after the dragged card", so the
server put every one of them directly after it and the last request to arrive
came first; one that arrived before the dragged card's own move was placed
after its old key, in the column it was leaving. And the board gave them no
new key, so until the answers came they were drawn wherever their old keys
fell. Measured: three cards dropped between two came back as two at the top
of the column and one between.

So each card is moved after the one before it, **one request after another** —
the next is sent when the last has landed, because the server reads the
anchor's key and the anchor has to have moved first. Still one request per
card on the endpoint a single drag uses; a list of ids in one request would be
a second path into the data. The board writes every card's key at the drop by
walking the column the way the server will, so the answers confirm the board
rather than correct it. A failure stops the chain where it is, and the board
goes back to what the server holds.

The cost is time: the move is finished on the server after one round trip per
card, not one in all, and a reload inside that window keeps the cards already
written and drops the rest. Not measured on the deployed server. Worth
knowing; not worth a bulk endpoint.

Where the gap is drawn counts only the cards that are staying. The rest of a
selection still sitting in the column was counted as a neighbour, so three
taken from one column, picked up by the middle one and held still, drew the
card that had been below them above the gap.

**In the air, one stack.** Picked up, the selection gathers under the hand:
the card it is on, a sheet showing below it for each of the others — one
for two cards, two for three or more — and the count on its corner.
The column it passes over opens one place for it — the size of that card —
not one per card, and draws none of the others there before they are put
down. They were laid into the column as the pointer went, still drawn as
taken, which read as two blue cards already moved somewhere the hand had not
yet decided on. On release the card lands in the place that was held and the
others follow it in, in the order they stood on the board; the cards below
slide down to make room rather than jump.

Gathering closes the columns the selection came from, so the hand's spot is
wherever the column now puts it — picked up from among the cards that are
taken and held still, the stack can sit a place away from where the card
was, because the cards around it have moved. That is the column telling the
truth about what is left in it.

**The bar opens rather than appears.** Taking the first card put its
fifty-two pixels above the work in one frame, so the board jumped down
under the hand that had just pressed it, and back up on Clear. The row
grows into its height over 200ms while the bar fades in, and closes the
same way, showing the count it closed on. Height through the grid's row and
opacity on the bar — not a transform, which would make the bar the frame
its menus are placed in.

**The bar's three controls are the row's three.** List, priority and
assignee open the same menus a row opens — the assignee was the platform's
select, a grey box with an ellipsis that looked like nothing else on the
board. With several tasks there is no one answer, so neither the people nor
the priority menu ticks a row: passing `null` for "no answer" had ticked
"Nobody" and "No priority" over tasks that each had one.

**And labels and the cycle.** Labels open the menu a task's own screen
uses; the ones ticked are the ones every taken task has, a tick adds that
label to each and an untick takes it off each, and a task's other labels are
left alone — so three tasks with different labels can share one more without
losing theirs. A label typed there is made and given to all of them. The
cycle opens a menu like the priority's, nothing first; it is there only when
the project has cycles, as on a card. Each action is one chip — the control
and its word, lit under the pointer, pressed anywhere — and Clear stands
beside the count it undoes rather than at the far end of the line.

Escape shuts an open menu first and leaves the selection; the next one ends
the selection. It is heard before the menu's own Escape, because the menu is
drawn gone between one listener and the next and, heard after it, found
nothing open and took the selection too.

**⌘Z takes a move back** — Ctrl+Z off a Mac, by the key and not the
letter. A card or a stack, the last move first, for as long as the board is
open. It is not the undo the rebuild gave up: nothing is reversed. Taking a
move back is another move, through the same `PATCH`, to the column each card
left and after the card that was above it then, read top to bottom so every
anchor is already home when the next card is put after it. So it holds after
a reload and on another device, and if somebody has moved the cards around
it since, it puts each card after the same neighbour, wherever that
neighbour now is. Not while typing — a field's own undo is the one meant
there — and not under a dialog. A drop back where a single card was picked
up is not a move and is not kept.

There is no `x` on the board, because there is no cursor to stand on: the
arrow keys walk a list, and a board is walked with the eye.

## Delete

The bar's last control, in red as in a row's own menu: every task taken,
deleted softly as one row's delete is, and recorded as one step — the toast
says "Deleted 4 tasks" and its Undo, or ⌘Z, puts all four back, not the last
of them. No confirmation, for the reason a single delete has none.
