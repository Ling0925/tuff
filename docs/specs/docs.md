# Files, as a list somebody works from

A project's Files holds documents written here, files uploaded, links to
things kept elsewhere, and folders. What changed, and why:

- **A picture shows in the list.** Its row carries the picture itself — the
  copy for showing, signed for the reader in `GET /projects/:id/files` as
  `thumb_url` — and pressing it opens the lightbox, paging through the
  pictures in the list. The original stands in only when it is at most
  512 KB: pictures an agent uploaded have no copy (it has no browser to
  make one), and a list of their eight-megabyte originals, every one
  decoded for a 48-pixel tile, ran Safari on a phone out of memory — "A
  problem repeatedly occurred". Past that the row shows the picture's mark,
  and the tiles load as they come on screen.
- **A PDF opens over the page**, in the browser's own viewer, with
  **Download** beside it. It is served as `application/pdf`, known by its
  first bytes as a picture is (`sniff`): served as a byte stream, as it was,
  the viewer drew a white sheet and the browser saved the file instead. Anything uploaded can be saved from its row.
- **A picture or a video is shown on its own screen**, not linked to. An
  upload opened from the list was its name and "Open the file", so a picture
  had to be opened in another tab to be seen at all. It is drawn under its
  name now, in a frame of a fixed height so the screen does not grow when
  the bytes land, fitted inside it; pressed, it opens full size. A video
  plays there. Anything else keeps **Open the file**.
- **The list narrows by kind** — now Docs, Images, Uploads, Links ("Four kinds and whose", below) — shown
  once there is anything to narrow; a kind with nothing in it says so when
  it is picked. It was shown only once there were two kinds to tell apart,
  and was not found; then always, and over an empty Docs it was five tabs
  at the foot of an empty screen narrowing nothing.
- **A new document opens in the editor at once**, named "Untitled" with the
  name chosen, ready to be typed over. It was a field asking for a name
  first: a form between somebody and what they meant to write.
- **A link says where it goes.** Read from its address: Google Docs, Sheets,
  Slides and Drive, Figma (named by the file's own name), GitHub (`acme/web
  #41`), Notion, Linear, Loom, YouTube, Miro, Trello, Dropbox, Airtable, by
  their mark and a better name than the host. Anywhere else is drawn with
  the link's own glyph and named by its host — not the host's first letter,
  which is a mark nobody knows the place by and read as a broken picture.
  Pasting an address anywhere on Docs adds it; pressing a link opens it
  where it lives.
  The mark is the place's own icon in its own colours, drawn as the place
  draws it — Figma's five shapes, Google Docs' blue page with its folded
  corner, YouTube's red play — standing on nothing, the way a file type's
  icon does, where it was one white glyph on the place's colour: a
  monochrome glyph on a tile was a logo nobody had seen. GitHub's Octocat
  is black, and takes the row's ink so it turns white on the dark theme,
  as GitHub draws it there. The icons are copied in once from public-domain
  and CC0 collections (the source of each is in the file), committed in
  `web/src/ui/brandIcons.tsx` rather than fetched: a favicon service, or
  the place itself, would be told which links a workspace holds every time
  the list is drawn.
- **A document can be named with #**, in a room and in a task's comments,
  as a task is: the # list offers the documents written in the project(s)
  after its tasks, and the name in the message opens the document.
  `GET /projects/:id/nameable?q=` answers a task's comments; a room keeps
  `GET /conversations/:id/tasks?q=`, which now carries documents too
  (`kind: "doc"`).
  The composer has a button for each — the check for a task, the page for
  a doc — and each opens the # list for its own kind (`&kind=task|doc`);
  # typed by hand offers both.

- **Newest first, pins on top, no folders.** The list is ordered by when a
  thing was added, newest at the head, because what was just put there is
  what somebody comes looking for. A file can be **pinned** — the pin on its
  row, for anybody who may add to the project — and stands above the rest
  with no heading over it — a written document as a page, anything else
  as the first rows — the latest pin first (`PUT /files/:id/pin`,
  `file.pinned_at`). Folders are gone from the screen: nobody can make one,
  and what was put in one shows in the one list.

Not done: a document named in a task's own description (the editor there
has no # yet), and previews of a link's page (title and image fetched from
it) — the name comes from the address alone.

## A link's address

A link's name could be changed on its screen and its address could not,
although `PATCH /api/files/:id` took a `url` — and wrote nothing with it:
the update set the name, the folder and the version, and dropped the
address on the floor. A link moved to a new place was deleted
and added again, with its comments left on the old one.

Now the address under the name has **Change** beside it, for whoever may
edit the link (`content.edit.own` for one's own, `content.edit.any` or the
workspace's switch for somebody else's — as its name). Pressed, the line
becomes a field in its place, holding the address: Enter or leaving it
keeps it, Escape puts it back. On the screen at once, put back if the
server says no. Pressing a link's row opens the place it goes, so its own
screen was reached only by its address; the row's ⋯ has **Edit link** for
that, above Delete.

The server takes an address only for a row that is a link already, and
only `http` or `https`: a document or an upload given an address would
become a link, and `null` would leave a link pointing nowhere — both
`400`. The feed's `file.update` line carries `relinked` when the address
changed.

## Where a file was sent

A file sent in a room, put on a task, an announcement or a comment becomes a
row in Docs, and the row now says where — "· in #tracker-main", "· in
TRA-12 Homepage hero" — with the place as a link back. The first place a
file is used is written on it (`file.origin_type`, `origin_id`; migration
089, which also works it out for the files already used) when the body that
carries it is saved; a file uploaded straight into Docs says nothing.

- **A file going up is a row at once.** Chosen with Upload (several at a
  time), dropped anywhere on Docs, or pasted there, each file stands at the
  head of the list the moment it is given, with a line that fills and how
  much of how much has gone. × stops it. One that fails — too large, or the
  line dropped — says so, with Try again. The row gives way when the list
  holds the file, so nothing blinks out between the two.

- **A document's head is a task's.** On the project's bar, across the whole
  width with a line under it and eight all round, as a task's: a round way
  back to Docs, its version beside it, and at the other end a ⋯ menu with
  Copy link and Export PDF — where a task keeps its rarer actions. Its name
  starts at the height a task's title does. It was a grey
  "← back" and an "Export PDF" at the far edge of the window, on a row of
  its own under an empty bar.
- **Pictures in the list stay decoded between visits.** The thumbnails are
  held as decoded images once the list is read (and when the project reads
  it ahead), so coming back to Docs draws them on the first frame rather
  than fetching and decoding each one again behind its blank tile. Only the
  first twelve — a phone's first screen of rows — and only one project's:
  it held two hundred, read for the whole list as soon as a project opened,
  and a project of screenshots held most of a gigabyte of pictures on a
  board that showed none of them. The rows below load as they come on screen, as they always did.

## One way in

Docs' bar has one plus beside its name, as every tool has, and it offers
the three things Docs holds: **New document**, **Upload file**, **Add link**.
Upload and Add link were pills on the right of the bar as well — two more
ways to say "add", which left the bar room for the search and nothing else.
Dropping files anywhere on Docs still uploads them.

## Files, not Docs

The tool is called **Files** wherever a person reads it — the project's
tabs, its column in the sidebar, the phone's tool menu, the palette's
doors, the window's title — "Fichiers" in French. It holds
uploads and links beside the documents, and "Docs" named one of its four
kinds as if it were the whole. Only the words moved: the address is still
`/:ws/:project/files`, the stored kind still `files`, and the code's own
names (`Docs.tsx`, `DocsRows`) stay, because renaming them buys nothing a
person sees.

## Four kinds and whose

The list narrows by kind — **Docs, Images, Uploads, Links**, in that order —
and there is no All: Docs is where it opens. A list of everything at once
put the handful of documents somebody writes from among forty screenshots
sent in chat. The kind of non-picture uploads was "Files", which is the
tool's own name now; it is **Uploads**, as Slack's and Dropbox's "uploads"
are. A folder, where one is left from before, counts as Docs; none is drawn.
Images has a picture for its glyph, where it had the upload arrow.

At the other end of the same row, a menu: **Recent · My documents ·
Shared with me** — Google Drive's three, in its words and its French
(Récents, Mes documents, Partagés avec moi). It was drawn as a second set
of segments beside the kinds, and two segmented controls on one row were
two questions at the same volume, when whose is changed far less often
than the kind. The button is filled, as the other menus' buttons are (the
view's "Assigned to") — the choice's glyph, its name and the up-down
chevron — and as wide as the widest of the
three whatever is chosen, so the row does not move when it changes; the
menu is the product's own, with a check by the one chosen, and the arrow
keys walk it. Recent is everybody's; My documents is what
the reader added; Shared with me is what somebody else did. Whichever it
is, the list is in the order things last changed (`updated_at`), pins
first: "recent" is what moved, which is what somebody comes back to the
list for — it was the order things were added.

**Each kind has its own address** (): `/files/docs`,
`/files/images`, `/files/uploads`, `/files/links` — and Recently Deleted
`/files/deleted`. Words, so they never meet a file's
number (`/files/7`). In the path rather than `?kind=`, because each is a
place somebody can be sent to and come back to with back, and nothing in
the app already reads a word after `/files/`. Pressing a kind's tab is a
step (`push`): back walks back through the tabs, and back from a file
opened under Images is Images. The address is the one answer to which kind
is open.

Whose is kept on this browser, under the reader's id (`docs-whose:<id>`
in localStorage), as a board's narrowed columns are: a view of the list,
not a thing a team has one answer to, and a link sent to somebody should
not arrive narrowed. The kind last chosen is kept too (`docs-kind:<id>`),
but only to fill in a bare `/files` — settled with `replace`, so back
does not walk through it. Recently Deleted is never kept. A kept `all`
from before reads as Docs, a kept `files` as Uploads.

Something just added is shown where it lands. A link added or pasted turns
the list to Links, a file given to Images or Uploads by its type (the
first one's, when several go up together), and Shared with me to Recent —
which is where something one has just added can be. Without it, a link
added while Docs was open went into a list nobody was looking at.

**On a phone** the kinds with their words and the menu are some 480
points against the 343 a phone has inside its gutters. The kinds drop
their words there but for the open one — glyphs, as the other crowded
segments do — and the menu's button is its glyph and its
chevron, the words being in the menu it opens. Both stay on one row and
nothing runs off the edge; the kinds still scroll within their share if a
language makes them longer than it.

A kind with nothing in it says so; so does a choice of whose that leaves
the kind empty ("Nothing you added here yet", "Nothing from others here
yet").

## Pictures, large

Images shows the pictures as pictures, not as rows with a 48-pixel tile:
**three to a row** on a desk, **two from 1024 down, and two on a phone** —
three on a 343-point phone are tiles of 108 points, which is a row of
thumbnails nobody can tell apart. Every slot is four by three whatever the
picture's own shape, and the picture fills it (`object-fit: cover`): the
rows line up, and the slot is there before the bytes are, so nothing moves
when they land — the stored width and height are not needed for it, and
the list does not carry them. Gaps are twelve, eight on a phone.

The name and the size come up over the foot of the tile, on a shade, under
the pointer — and stay there on a screen with no pointer to hover with.
Pressing a picture opens the lightbox, paging through the pictures, as
before; the pin and Download sit in its top corner.

## A document's mark

A written document can wear a colour and an icon, as a project does:
one of the same sixteen glyphs (`MarkIcon`) and one
of the ten tints, both nullable on `file` (`mark_icon`, `mark_tint`,
migration 276). Null is a document's own look — the doc glyph, white, on
the accent — and what every document wore until now.

It is changed on the document's own screen, from the mark over its name:
pressed, the rails unfold under it — the project's picker itself
(`MarkRails` in `kit/marks.tsx`, taken out of the project's settings so
there is one), the first cell of each being "Default". Each press is the
change, on the screen at once and put back if the server says no.
`PATCH /api/files/:id` takes `mark_icon` and `mark_tint` from whoever may
edit the document (`content.edit.own`, or `content.edit.any` and the
switch, as its name); a link or an upload is `409 not_document` — a link
wears its place's icon and a picture is itself. A change is a
`file.update` line with `meta.remarked`; putting back what was there
writes nothing.

The mark is drawn by one component, `DocMark`, everywhere the document is:
its row in Files, its pinned card, its own head, and the palette's results
(`GET /api/search` carries both for a file).

## Pinning moves

A pin moves the thing to the head rather than taking it from one place
and drawing it in another. Every row, page and tile is measured as the
list is drawn; when what is pinned changes, each one slides from where it
was to where it is now (240 ms, a strong ease-out, transform only), and a
written document's page — new at the head — rises from where its row was,
from a little smaller and faded. Unpinning walks the same way back.
Only a change of pins within a second of a press on a pin moves anything:
nothing moves when the list is redrawn for another reason — a kind or a
choice of whose pressed, the server's fresh answer over a kept copy that
was a pin behind, which slid the head on opening the screen until this
rule — and nothing moves
under reduced motion (`usePinMotion` in `Docs.tsx`).

## A pinned document is a page

Pinned rows stand at the head of the list as pages. No card
around them: the page is the thing — a US Letter sheet, 17 by 22, at a
width of its column. The columns share the list's width, so the row of
pages starts and ends where the list under it does — three across a
desktop list, two on a phone, never narrower than 204; an empty column
keeps its place, so a single page is not stretched across the list. A written document's page has
its mark in its colour at the top, its name under it, and its first lines
under that, set small — headings in the ink, the rest quieter — on a flat
page with its border and its corners, so it reads as a page held at arm's
length rather than a tile with words on it; a picture in it, the first
one, takes the room the lines would. Two more sheets stand behind it,
fanned a degree or two, still. Under the page, only when it last changed,
small and quiet — the name is on the page.

The lines come with the list: a pinned written document's row carries
`preview` — at most six lines and 600 characters from its first eight
blocks, and the file id of its first picture, drawn from the list's own
signed `thumb_url` — so the page is drawn whole the moment the list is,
and nothing is asked for after it. Only a written document is a page: a
pinned link or upload stays a row, first in the list, as it was — a page
with a link's name and nothing under it was a blank sheet standing for an
address — and pictures are the Images grid, where a press opens the
lightbox and a pin is the grid's own. The page's
size is fixed, so it is its size before anything on it has loaded.

Under the pointer the page lifts two pixels, 200 ms on a strong ease-out;
nothing turns and nothing lights. It leaned toward the pointer in three
dimensions with a light that followed, and that was taken out: on a list
read every day, a page that moves under the hand is a page that will not
hold still to be read. None on a screen with no pointer, none under
reduced motion. The page is content and stays flat: no glass.
