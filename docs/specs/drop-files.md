# Files dropped on a task, a document or an announcement

A picture or a file could already be dropped into a body: the editor took
it the way it takes a picked one. In practice it was missed more often than it worked, for three
reasons, all of them about where the file was let go:

- **Only the words took it.** A task with a one-line description has a
  target one line tall. A little to the side of it, nothing happened.
- **A miss left the product.** Let go anywhere else, the browser did what
  it does with a file dropped on a page: opened it in the tab, in place of
  Tuff, with whatever was being written.
- **Nothing said where it would go.** No ground lit up while the file was
  held, and a file let go on the words went in where the caret had been,
  not where it was dropped.

The window a task or an announcement is made in already
took files anywhere on it and said so. The screens the same things are
read and edited on did not.

## What it does now

- **The whole screen takes it.** On a task, a document or an
  announcement somebody may edit, a file held over the screen lights a
  ground across it: *Drop to add to the description* (the document, the
  announcement). Let go there, it goes in at the end of the body, as a
  picked one would. Several at once go in one after another.
- **On the words, it goes where it is let go.** Over the body itself the
  ground steps aside and the editor draws a line where the file will go,
  between two blocks — not in the middle of a sentence, which a picture
  would cut in two. That is ProseMirror's own drop point, so it lands
  where the line was drawn.
- **Another field keeps its own.** Over a comment being written the
  ground steps aside too: the file goes into that comment, as it did.
- **A miss stays in Tuff.** Anywhere in the product a file let go where
  nothing takes it is refused — the pointer says so while it is held —
  instead of being opened in the tab.

Only files from outside the page count. Something dragged inside it — a
card, a picture already in a body being moved — is not a file being
added, though the browser may call it one.

## What it is not

- **Not a second way in.** A dropped file goes the way a picked one goes:
  the same upload, into the project's Docs, under the same rights, drawn
  at once and sent behind. Nothing changes on the server.
- **Not on a screen that cannot be written.** Read-only, nothing lights
  up, and the miss is still refused.
- **Not an animation.** The ground appears and goes with the file held
  over it, as the window's does.
