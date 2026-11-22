
## Reading it, and going there

- **Opening the panel is reading it.** Everything in it is marked read on
  the server and the bell's count goes; the rows that were new keep a tint
  of the accent across the whole row, and a dot by the time, for as long as
  the panel is open, because what was new is still worth seeing as new
  while you look at it. The panel remembers which they were rather than
  reading `read_at`, which the server set the moment it opened: the next
  answer — a note arriving, another device reading — took every tint away
  while the person was still looking. Shut and opened again, they are read
  and plain. The panel reads the inbox before it marks it read: a note
  the socket had announced and the page had not yet read — opened on the
  chime, or with the bell lit by an older note — was marked read on the
  server first and came into the open panel plain. *Mark all as read* is asked for, so it clears them at once.
- **Every word is shown.** A task's title wraps rather than being cut at one
  line — the title is the whole of what the note says.
- **Who, and what they did.** A row is read the way Linear's and GitHub's
  are: the face of who did it, with what kind of thing it was as a badge
  on its corner; then **who** and what they did — *Emily Brooks moved it
  to Done* — with the time at the end of that line; what it was done to;
  what they said, if they said something; and the project. See "Who, and
  what kind" below.
- **What happened.** A note carries a line — *Bruno moved it to Done* —
  under its subject, where a mention in a room carries what was said.
  That line already says why the note came, so the words under it drop the
  reason and keep where and when — "Sam Carter assigned you" over
  "assigned to you · Acme rebrand" was the same news told twice.
- **What was said.** A mention in a room carries the room — `# tracker-main`
  or the people in a direct conversation — and the message that named you,
  with who said it.
- **The row is the door.** A task opens the task, a post the post, a file
  the file, a room the room.

## Who, and what kind

A row used to be a grey disc with a glyph for why the note came, and the
person behind it was a name inside a sentence. Every note about something
you watch wore the same bell, whatever had happened.

A note now keeps **who did it** (`by_id`) and **what kind of thing**
(`kind`), migration 181, and the inbox answers with their name and face
(`by_name`, `by_avatar_url`). An agent is an actor like anybody, so it has
its face too. The functions that write notes take the doer from the
session, never from what they are passed: a note naming somebody else as
its author would be words put in their mouth. A merged note takes both
from the last thing done, as it takes the line.

The badge is the reason when the note is addressed to you — `@` for a
mention, a person for an assignment, a reply arrow, a megaphone, a folder,
people for an invitation followed — and the kind when you only watch the
thing: a bubble for a comment, a tick for finished, the board for a move,
a reopened circle, a person for a change of hands, a calendar for a date,
a page for the description. Each family has one of the system's tints, so
the green ones can be found without reading. A reminder of a date has
nobody behind it, so its disc is the glyph itself — a calendar, or a clock
in the due colour once it is late.

The name is set in weight at the head of the line, which already begins
with it in the reader's language; a line that does not ("Due tomorrow") is
said as it is, and a note with no line says the name and what they did —
*Emily Brooks mentioned you*.

**What a comment said.** A note about a comment carries its first words
(`excerpt`), read under the reader's own policies, so it is only ever a
comment they could open. It is shown in the panel and nowhere else: a
push is drawn on a lock screen, and `what` stays the product's words
(`docs/specs/notifications.md`).

Notes written before this have neither, and are drawn as they were — the
disc and the glyph — except a mention in a room, which knew who said it.

## Somebody followed your invitation

An invitation went out and nothing came back: whoever sent it found out the
person was in by noticing a new face in Members. Now the person who made
the invitation is told — `joined`, about the `actor` who arrived — whichever
way it was followed: a new account, somebody signed in pressing join, or
Google or Apple. The row says the name and "accepted your invitation", and
opens their page in Members. A push says the same.

Only the person who sent it, and only while they are still in the
workspace. Not the owner as well: a manager inviting their own team is the
manager's news, and an owner who wants to see who is here has Members.
Quiet hours hold it like any other note, and a note that could not be
written never stops somebody joining — they are in either way.

`unread` gained `joined` beside the other three, and the icon counts it.

## Only what is still there

A note about a task, an announcement or a file that went to the bin — or
whose project did — is not listed and not counted. It was both: opened, it
said "Can't find this task", and unread it was a count on the bell that no
reading could clear. Asked of the row under the reader's own policies, so
what the inbox lists is what opens. Brought back from the bin, its notes
come back with it.
