# Reading a room back

A channel holds everything ever said in it and the screen asks for fifty.
What follows is how the other three hundred are reached.

## The sheet has to be able to scroll

It could not. The history sat in a flex column with `justify-end`, which is
the obvious way to keep a short conversation at the bottom of its sheet — and
when the children are taller than the box, that puts the overflow out of the
**top**, where there is nothing to scroll to: `scrollHeight` counts what is
below the viewport and not what is above it, so the box reported itself as not
overflowing, the wheel did nothing, and the last fifty messages were all
anybody could reach.

On a fixture with five messages in a room this is invisible. It was found by
writing three hundred into one and looking at it, which is the argument for a
fixture that can be the size the thing is.

The slack is taken by an auto margin on an empty first child instead. It does
the one thing `justify-end` was there for — fills the gap while the
conversation is short — and resolves to nothing once there is enough to
scroll, so the overflow goes downward where it can be reached.

## A page at a time, as the top is reached

`GET /api/conversations/:id/messages` takes a `cursor` and answers with
`next_cursor`, like every other list in the product. The screen asks for the
next page when the reader comes within four hundred pixels of the top, and
stops when the answer carries no cursor.

**The reader stays where they were.** Prepending rows moves everything below
them down by their height, so somebody reading a sentence ends up reading one
from twenty minutes earlier. The distance from the top of the loaded history
to the bottom is noted before the rows go in and restored after they are in
the document and before the frame is painted — a layout effect, not a
`requestAnimationFrame`, which sometimes ran before React had committed the
new rows and restored against the old height. That left the sheet at the very
top, where it stopped asking for more, because a reader holding at the top
sends no further scroll events to ask with. So a restore that lands near the
top asks for the next page itself.

**A message arriving does not move the sheet.** The room scrolls to the newest
message when it opens and whenever a message arrives *while the reader is at
the bottom*. Once they have scrolled away, nothing moves them: being carried
to the present because somebody else typed is the page being taken out of
their hands.

**And a refresh keeps what was read back.** Anything happening in the room
refetches the newest fifty; replacing the list with them threw away everything
somebody had scrolled back to. The two are merged by id, so a message arriving
while you are reading last Tuesday leaves you on last Tuesday.

## Where you left off

A room with twelve unread in it used to open at its newest message and say
nothing about the twelve. The number in the sidebar was the only place
anybody was told how much they had missed, and it went the moment they
arrived — so the answer to "what is new here" was to scroll up until the
messages started looking familiar.

So the history carries a line: a rule across the width in the accent, with
the count on it, above the first message that arrived after the reader last
looked. The day pill is a label on one conversation; this is a seam in one,
and it is drawn differently for that reason.

**The room opens at the line, not at the bottom.** What is under it is what
has not been read, and it should be the next thing read. Put at the top of
the sheet, so the unread fill it. A room with one new message cannot scroll
that far and lands at the bottom, which is also right.

**Both answers are frozen when the room opens.** The screen marks the room
read as it shows it, so by the time the first frame is painted the count is
nothing and the mark has moved — a line computed from live values would
disappear as it was drawn. They are taken once, while the room is rendered
for the first time, and kept until the room is left. Somebody reading back
through twelve messages can still see where the twelve began.

**And the line agrees with the count.** Neither counts the reader's own
words. The boundary comes from the server as `read_through` beside the
`unread` count, because the two have to be measured from the same instant:
"12 new" above a line with nine messages under it is a number nobody
believes again.

**Enough of the room is asked for to hold the line.** A page is fifty, so a
room with ninety unread would open at the bottom with the line out of sight —
the one case where somebody most needs to be told where they stopped. When
there is a count, the first page asks for it plus a little, to the two
hundred the endpoint allows.

## Reading is up to the last word

The mark is the newest message in the room, not the clock — `docs/api.md`.
And the screen says it once per newest message rather than once per render:
on `[roomId, messages.length]` it fired on opening, again when what was
remembered was drawn, and again when the fetch landed, which is three
writes, three words round the socket and three refetches of the sidebar for
one room being opened.

## What is not here

No virtualisation. The load table has a channel with a million
messages in it, and nothing above makes that screen fast — it makes it
reachable. Fifty rows a page and a reader who stops somewhere is the common
case; a million rows in the document is a different piece of work, and
`pnpm load` is where it will be measured.

## Kept at the bottom while it fills

A room refreshed at its last message opened above it, and drifted further
up as it loaded. The sheet was put at the bottom when the messages were
drawn, and then what was in them kept arriving — pictures sent before
their size was recorded, a video's frame — each pushing the bottom down
past where the sheet had been put. The messages sit in one box whose
height is watched; while the reader is at the bottom, and only then, the
bottom is kept as it grows. Scrolled up to read, nothing moves under them.

That held one refresh in two. With the pictures in the cache they grow in
the same frame the sheet is put at the bottom, so the scroll event of that
placement arrived reading a gap of eight hundred pixels and said the reader
had left — and the bottom stopped being kept. A scroll the screen makes
itself is marked for the two frames its event takes, and not read as the
reader's. The browser's own scroll anchoring is off on the sheet for the
same reason: where the sheet stands is decided here.
