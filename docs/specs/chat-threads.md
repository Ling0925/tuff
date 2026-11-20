# Threads, reactions, and a message made into a task

TRA-102: "the chat needs reply in thread, reactions on a message, and Make a
task does not work from a message."

## Make a task

It did work, and that was the trouble. The server made the task with no
list, and a task in no list is under no heading of the list and in no column
of the board — it existed and was nowhere. The screen said nothing either
way: no confirmation, no link, and for a message whose words were all in a
list or a mention the title came out empty, the request was refused, and
nothing said so.

Now the task goes where `POST /projects/:id/tasks` would put it — the
project's first list, at the head of its column — and the title is read from
every word in the message, mentions included. The button is only there for
somebody who may make tasks in the project, and only in a project's room — a
direct conversation has no project to hold one.

**The message shows what it became.** Under it, the task's card — the one a
`#` mention brings, read when it is drawn, saying where the
task stands now, and pressed to open it. It was a line, "Task created ·
Open", that only the tab which pressed the button ever drew: gone on the
next load, never seen by anybody else in the room, and without its Open
wherever the room was reached from the sidebar. Each message now comes with
`promoted_task_id`, the task made from it if the reader may see it, so the
card is there for everybody and after a reload, and Make a task is not
offered on that message a second time.

## Threads

A thread opened in place of the channel, behind a "Back to the channel"
link, so answering one message meant losing the room. It opens beside the
room now, as Slack's does: the message it hangs off at the head, the
replies under a line that counts them, and a line of its own to write on.
The room stays where it was and keeps moving.

On a phone there is no beside: the thread takes the screen, with the way
back at its head.

Under a message with answers: "3 replies", in accent, which opens the
thread. A reply posted counts at once in the room.

While a thread is open beside the room, the message it hangs from is lit in
the accent's soft tint, and stays lit under the pointer — the eye goes
between the two panes and has to find where the answers belong.

## Reactions

An emoji on a message, from anyone who can read the room. One per person per
emoji; pressing it again takes it back. Under the message they are pills —
the emoji and how many — lit where one of them is yours, with the names on
hover, and a small face at the end of the row to add another. The card that
floats on a message under the pointer has the face too, first.

A reaction is a property of a message, not a fifth entity: rows in
`message_reaction`, bounded by workspace and visible exactly when the
message is. It does not notify anyone — a thumbs-up arriving in an inbox is
the noise the inbox was built to keep out. It travels round the room's
socket like a message, so everyone looking sees it land.

Any emoji: the web's picker offers all of Unicode's (`docs/specs/emoji.md`),
and a client may send what its own picker has, one emoji of up to sixteen
characters.

### Who reacted

Over a pill, after a beat under the pointer: the emoji large on a light
tile, and who put it there as a sentence — "You", "Robin and Sam",
"Robin, Sam and 3 others" — the way Slack draws it. It was the browser's
own title, a list of names that arrived a second late in the system's
font. Not on a touch screen, where pressing the pill is the reaction.

### The card over a message

As Slack keeps it: the three emoji this person reacts with most, one press
each — counted in this browser, starting from 👍 👀 ✅ — then the face for
any other, Reply in thread as a mark, and ⋯. Make a task went behind ⋯
with Edit and Delete: it is the rarest of them, and as words on the card
it was the widest thing there.

### A thread's row under its message

"3 replies" said there was a thread and nothing of who was in it. Under the
message now, as Slack draws it: the faces of who answered, the latest
first, four at most; how many answers; and "Last reply 2h ago". The row is
pressed to open the thread.

## Opening beside the room

A thread opened beside the room widens what the room stands in, and the
project's bar over it widens with it — the bar is over the work, and the
work is now two columns. Both go over one fifth of a second on a strong
ease-out while the thread grows from nothing by the same amount, so the
room keeps its width and only the edges move. Closing is the same way
back: the pane is kept for that fifth of a second while it folds to nothing
and the frame and the bar narrow with it. With reduced motion, nothing
slides.

Its head — "Thread", the room's name, the × — stands sixteen pixels below
the line over it, as the room's own head stands off its bar's edge; it sat
flush against that line and read as part of the bar. The words
start where the messages' faces start, and the × is a 32-pixel round on
the pane's right edge, the edge the line to write in ends on, sharing one
middle with the words. The head is part of the pane, so the pane's height
does not change for it.

## Escape shuts it

Escape closes a thread, as its × does, by the rule a task keeps: anything
laid over the page or the palette answers first, a list open under @ or #
takes it, and words being written keep it — Escape in a line with words in
it is the line's. The thread's own line, empty, is the exception: it has the
hand from the moment the thread opens, so Escape there is the way out
rather than a press that only lets go of the field.

## The same room from the column

Making a task of a message asks what the room's project lets this person
do. Inside the project that came with the project; a project's channel
opened from the column in Chat had no project to ask, and the menu had no
**Make a task** there — the same channel, the same person, one button
fewer. The chat screen now reads the room's project from the projects it
already holds, and asks its `task.create` the same way.

## Also in the room

An answer in a thread is often the answer the whole room was
waiting for — "shipped", "it was the cache" — and in a thread only the
people in it see it. Slack's line has a box for that, and so does this
one: under a thread's line, **Also send to #general** (the room's name;
in a direct conversation, its people's). Ticked, the reply goes to the
thread as always and stands in the room's history too, at the moment it
was said, with a line over its words: *replied to a thread:* and the
first words of the message the thread hangs from, pressed to open the
thread beside the room. In the thread it carries *Also sent to the
channel* under it.

The box is off for each new reply — Slack keeps it off too: most answers
belong to their thread, and a box that stayed ticked would put every
answer after the first in front of everybody.

**One message, not two.** It is a field on the reply,
`message.also_in_room` (migration 216), never a copy: an edit, a
reaction, a deletion and a link reach the one message, wherever it is
drawn. The room's history asks for messages at its top level *or* with
the field; the thread asks for its replies as before. Only a reply may
carry it — the database refuses it on a message with no thread
(`message_also_in_room_is_a_reply`), and the endpoint ignores it there.

Nobody is told twice: the thread's people hear of a reply as they always
did, and the room's count counts it once, as the message it is.
