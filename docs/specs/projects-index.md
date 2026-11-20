# Every project, and the ones put away

`/:ws/projects` is the index the sidebar is not: every project this person
is on, then the archived ones, then the bin. It reads the way the rest of
the product's lists do: a panel of rows per group, each row
what it is in ink and the facts after it in grey, its actions shown with
the pointer on it.

## The three groups

- **Projects** — mark and name. Pressed, it opens. Behind its ⋯,
  **Leave project**, for anybody on it ("Leaving
  is your own" — this is the one place it is); with the pointer on it,
  Archive and Move to bin for whoever may.
- **Archived · n** — out of the sidebar and the lists, everything in it
  kept. Pressed, an archived project **opens**, as it was: its tasks, its
  rooms, its documents, with a strip across the top saying it is archived
  and **Put it back**. It used to answer "This project is not here", which
  made archiving indistinguishable from losing it — and its rooms were
  promised to be "there to be read when the archived project is opened".
- **Bin · n** — deleted, kept for thirty days and then cleared out for
  good. Each row says when it went and how long it has left — "deleted 19
  Oct · 27 days left" — rather than a date to subtract from.

## Put away, and folded

The archive and the bin are folded under one row — "Archived · 2   Bin ·
5" — and open when it is pressed. Open by default they stood under the
projects longer than the list the screen is for, and on a phone the bin
alone filled the screen below the one project somebody had. They are for
tidying up, which is done now and then; the row says how much is there,
so nothing is out of sight without being counted.

On a phone **New project** stands at the start of the line, where the
list starts: the title is in the bar there, and the button alone at the far
edge read as an afterthought.

## Delete for good

The bin also takes a project out **for good**, now rather than in thirty
days: **Delete for good** on its row, pressed twice — the first press asks,
the second does it — because this is the one act on the screen that
cannot be taken back. The workspace's owner's alone.

It takes everything the project held: its tasks and their parts, lists,
cycles and labels, its announcements, documents and files, its rooms and
every message in them, the comments, the hours, the activity, who was on
it, and whatever pointed at any of those — watches, notifications, links,
places in somebody's sidebar. The bytes of its files go too: they are
queued when their rows go and the worker removes them, keeping any that a
row somewhere still points at (`storage_orphan`).

The thirty-day clear-out does the same to a project that has sat in the
bin that long. It could not before: a project's tasks were not deleted
with it, so the project row could never be removed — and the clear-out,
meeting a row it could not remove, gave up on everything else as well.

## A project has a name and no description

The web neither asks for a description nor shows one. A project is named
for what it is, its rooms and documents say the rest, and a second line
under every name in the index was a line nobody wrote twice. The field is
still in the API, for what an import or another client sends.

## What can be done from the list

Whoever may archive and delete projects (`project.archive`) has, on a
row's hover: **Archive** and **Move to bin** on a project, **Put back** and
**Move to bin** on an archived one, **Restore** in the bin. The same acts as
a project's Settings, from the place somebody tidying up is already
looking at.

## Archive and Move to bin are told apart

In a project's Settings the two were a filled **Archive** and a red word
**Delete**, side by side under one heading — and the filled one read as the
button. Three projects meant for the bin were archived one after another
before anybody noticed. They are two rows now, each saying what it does in
a line under its own button: **Archive** — out of the sidebar, everything
kept, found under Projects; **Move to bin** — out of everywhere, restorable
from the bin for thirty days, then gone.
