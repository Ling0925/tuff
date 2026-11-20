# Arrival

What a person sees between pressing Enter on the address and the screen
being there.

## What it was

A blank ground, then "Loading…" in small grey type in the top-left corner,
then the whole shell at once, then each part of it filling in on its own
beat — the sidebar's projects, the avatar, the board a moment after the
column it sits in. On a slow connection: four different screens in a
second and a half, one of them a word.

## What it is

**The frame, at once.** `index.html` paints the sheets the shell is laid
on before the app's script has arrived: the work's sheet, and a project's
tools beside it when the address is a project. Nothing on them — no bars,
no shimmer, no grey lines standing in for text. A skeleton promises a
shape and then breaks the promise when the real rows are a different
number and length; the sheets are not a promise, they are the furniture,
and they are exactly where they will be.

Drawn from what the browser already knows: whether a session is stored,
the window's width, the widths the person left the sidebar and the tools
at, whether the sidebar is shut, and whether the address names a project.
Below the breakpoint there are no sheets — the work is the window — and
the frame is the ground alone.

**The app takes it away in the frame it first draws over it** — a layout
effect, so the frame and the shell are never on screen apart, and the
sign-in is never drawn over it.

**The contents arrive once, together.** The shell is drawn when `/me`
answers and every screen in it then asks for its own data. Until those
first reads are in — two frames running with none in flight, counted in
`api()` — the contents of the bar, the sidebar and the sheets are held
clear, and then they fade in over 240ms. The sheets themselves never fade;
they were already there. Never held longer than 800ms: a slow answer is a
reason to show what is there.

Once per page load. After it, moving around is instant and nothing fades:
the response budget forbids a spinner or a skeleton between screens, and a
fade between them would be the same delay wearing a softer face.

## On a phone

An installed copy opened from the home screen was a black screen for two
seconds: iOS shows nothing of its own between the tap and the page, the
frame above has no sheets to draw below the breakpoint, and the shell
waited for `/me` and then five more answers before it drew anything.

**The mark from the first instant.** iOS is given a launch image for every
screen size it comes in, light and dark: the app's mark, eighty points, in
the middle of `--canvas`. The page then draws the same mark in the same
place (`#splash`), so the one hands over to the other without moving. It
sits over the app rather than under it and fades out — 200ms — when the
first screen's contents are in, so the step from the mark to the work is
one fade and not a blank ground in between. In a tab it appears only if
the start is slow enough to be seen (after 400ms), so a quick load is not
a logo flashing past; on a laptop the frame is the arrival and there is
no mark. It removes itself after eight seconds whatever happened.

Baked from `icon.svg` by `scripts/icons.mjs`, which also writes the list of
launch images into `index.html`. iOS reads them when the app is added to
the home screen, so a copy installed before them has to be added again.

**The last answers, at once.** Every start draws the shell from what this
machine kept — the same shelf an offline start reads, `docs/specs/offline.md`
— the moment it is read off the disk, and the server's answers replace it
in place. The contents are not held clear when they come from there: they
are already what this person last saw. Only the shelf of the session that
is signed in now; not for a link into another workspace or to a project
the shelf has never heard of, where the old answers would be the wrong
screen; and never once the server has answered.

**What was last seen, not what was last fetched.** The tasks were kept
only from the server's answers, so a card moved on the board never reached
the shelf: the writes landed, nothing asked for the list again, and the
next start opened the board on the arrangement from before the move and
then put it right under the reader. A project's tasks are kept as the
screen changes them, so the shelf holds what the screen last showed.

## The numbers live twice

The frame cannot import the app — it runs before the app exists — so the
bar's 48px, the column defaults and limits (sidebar 248, 200–380, 56 shut;
tools 212, 168–320), the storage keys and the six screen names `route.ts`
refuses as project slugs are written in `index.html` too. A comment there
says so. If they drift, the cost is the frame being a few pixels off for
the half second before the shell covers it, not a fault.
