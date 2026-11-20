# A person's card

TRA-103: "click somebody in the chat and see a mini profile — their time
zone, name, a big picture, a way to start a direct conversation, the email
they signed up with, their title, and their tasks and how those stand, in
the projects the person clicking is in."

## Where it opens

On a message's face or name, in a room and in a thread. A card beside what
was pressed on a desk, a sheet on a phone. It is a glance, not a screen:
everything on it is a door to the screen that says more — their page,
the conversation with them, a task.

## What is on it

- **The picture**, large — 64 — and the name under it, with the title when
  they have given one, and whether they are here, away or busy.
- **Their time**: the clock where they are and the zone's name, "4:12 PM
  local time · Europe/Lisbon". Most of a distributed team's "can I ask
  them now" is this line.
- **The email** they signed in with, as a link that writes to them.
- **Message** — opens the direct conversation with them, making it the
  first time. Not on your own card.
- **Their work, where you are too.** Per project the two of you share:
  open, late, and finished in the last thirty days. Under it, the first
  few open tasks, each a link. A project they are on and you are not is
  not on the card, even for an owner who could open it: the card answers
  "what are they doing that I am part of", and the full page is where the
  rest is.

## The time zone

The zone is the one quiet hours already use (`app_user.timezone`). It was
'UTC' for everybody, because nothing set it but a field in Settings that
few people open, so the card would have told everyone it was the middle of
the night in London. Now the browser says where it is on sign-in, once,
while the stored zone is still the default; a zone somebody chose stays
chosen. In Settings it is chosen from a list of the zones there are, each
with its offset now — "Europe/Paris · GMT+1" — rather than typed: a name
like that is not spelled right first time, and a zone the server did not
know was a quiet hour that never came.

## The title

`actor.title`: what somebody does, in their own words — "Designer", "Head of
sales". Theirs to set, under their picture in Settings, up to eighty
characters, and it is optional: no title is no line.

## Who may see it

Anybody who can read the people of the workspace (`people.read`). The email
and the zone come from a function that answers only for somebody who shares
the asker's current workspace, because `app_user` is otherwise readable by
its owner alone.

## One window, wherever a person is pressed

There were two: a face or a name in a message opened a small card beside
it, and a person in a room's list of people (or the card's own name) went
to their page in Members — two windows for one question, and the card,
sized for a glance, cut their work off at four tasks. It is one window now,
a modal in the middle of the screen, opened the same way from every face
and name: a message's, a direct conversation's head, a room's people, an
@mention.

- **The head**: the picture at 72 with their presence, the name, the title;
  their clock and zone, and their email — and **Message** beside the name.
- **Projects you share**, a panel of rows: open, late, finished in thirty
  days.
- **On them**: every open task in those projects, grouped by project, each
  a row with its handle, title and due date, late ones in the late colour —
  the window scrolls inside itself, so a person with forty tasks is a
  longer list, not a cut one.
- **Their page** — the Members screen with the role and the rest — is a
  link at the foot, for the few who administer people.

Escape or the scrim closes it; opening a task or the conversation closes it
on the way.

It opens whole. Somebody's window is read ahead while the pointer is on
their face, name or mention, and kept for a minute; pressed, the window
waits for what goes in it and is drawn at once — only if that takes longer
than four hundred milliseconds does it open on its frame and fill. It drew
its head and then, a request later, everything under it, which read as the
window jerking open.

## Somebody removed

Their face stays on what they said, and pressing it opened a card that said
*Couldn't load this profile* with a link to their page in Members, which was
not there either. Now the card says who they were — their name and face,
greyed — and that they are no longer in this workspace, and that their
messages and tasks stay where they were. No link: there is no page to go to.
The server answers `410 removed` with the name and face and nothing else.
