# A body somebody can write in

The four entities keep their prose as a document rather than a string. That
was true from the first migration and nothing used it: every screen wrote
`asDoc(text)` — one paragraph, one text node — and read it back with
`plain()`. A textarea pretending to be a document.

This is the editor that makes the shape true.

## No new dependency

TipTap v3 has been in `web/package.json` since the beginning, unused, and
the stored shape is ProseMirror's because of it. The chosen stack does
not name an editor, so adding one would have been a question; there is
nothing to ask.

StarterKit brings bold, italic, strike, underline, code, code block,
headings, both lists, quote, horizontal rule, hard break and **link**.

## Attachments are not an image extension

`@tiptap/extension-image` stores a URL in the document. Ours cannot: a blob
URL here is signed over the key and an expiry, and a link that outlived its
check would be a public URL — which is the whole reason the signature
exists. A `src` written into a task body would be a 403 within minutes and a
broken picture for ever after.

So the node stores what does not expire: `fileId`. The URL is resolved when
the node is drawn, from `GET /api/files/:id/url`, and the browser caches the
bytes it loaded. One node covers both, told apart by the file's type:

```
{ type: 'attachment', attrs: { fileId, name, kind: 'image' | 'file' } }
```

`Node.create()` from `@tiptap/core` — already installed — is all it takes.

## Where an inserted file goes

Into the project's Docs, as a `file` row. The project's handbook already says what Docs
is: documents, uploads and links, one row with a different place to read
from. A screenshot pasted into a task is a file of that project, and a file
of that project is findable, countable against the storage ceiling, and
subject to the same permissions as every other file.

The alternative — an upload that exists only inside one body — is a second
kind of file with its own lifetime, its own visibility question and its own
clear-out. That is the fifth entity wearing a different hat.

Pasting, dropping and picking all go through `POST /api/projects/:id/uploads`,
which already exists and already counts the bytes before writing them.

## Everywhere something is written, not only the long bodies

For a while only the editor could take a file — so a task's description could
carry a screenshot and the two places people actually send things, a comment
and a message, could not. The thing anybody wants to attach is almost always
a picture of what they are talking about, and talking about it happens in the
reply.

The line stays a line. It is not an editor: the file is sent the moment it is
chosen, and what waits on the screen is a **chip with its name on it**, which
can be taken off again. Named rather than shown, because the thing worth
checking before pressing Enter is that it is the right file, and a thumbnail
of something not yet sent reads as something already sent.

What is attached rides in the body as the same `attachment` node — so nothing
new stores it, nothing new draws it, and a picture in a comment is the same
row in Docs as a picture in a description. Chat had to stop flattening its
messages to a string to show one; it had its own copy of `asDoc` and its own
flattener, which is exactly the drift `data/doc.ts` exists to stop.

**A direct conversation has no clip.** A file is a row in a project's Docs —
that is its home, its permission and whose storage ceiling it counts against
— and a direct conversation has no project to put one in. Rather than offer
it and refuse it, the clip is not drawn. Attachments between two people need
somewhere for a file to live that is not a project, and that is a question
about the schema, not a button.

## Two components, not one

**`Editor`** is TipTap, for the three long bodies: a task, an announcement, a
document. Editing in place, the way those screens already work.

**`Doc`** is a plain React walk over the document JSON, read-only, for
everywhere a body is shown and not edited — comments, messages, search.

Not one component in two modes, because the second one has to be cheap. A
channel with a million messages draws bodies by the hundred, and an editor
instance per message is a ProseMirror view per message. The design measures
this screen; a read-only renderer is a function.

## Flat, reached for or not

A task's title and its body are the same offer — text you change by clicking
it — and they were drawn as two different things: the title bare, the body
on a panel for ever. Then both took a ground under the pointer, held while
the caret was in them. That made the words the largest lit block on the
screen the moment a hand crossed them, and a ground needs room round the
words to stand in, so the body sat twelve pixels lower than it had to.

Neither has a ground now. The caret says where somebody is writing, and the
screen does not need to say it twice. With the ground gone so is its room:
the title and the body are one block, eight apart, so the description reads
as the paragraph under its heading rather than the next section. The same
on a document's own screen.

## The `+` is beside the empty line

A row under the body said "Add, or press /" under every description, whether
or not anybody was about to put anything in, and a long way from the line it
would have put it on. It is a `+` in the margin now, beside the line the
caret is on when that line is empty — the place the next block will go —
and gone as soon as there are words on it. It opens the same list the slash
does.

That list opens under the caret when it fits and over it when it does not
— on a line near the foot of a long body it used to run off the bottom of
the window — held to the room on that side and scrolled inside it.

It is drawn over the page, twenty pixels left of the words and never past
the panel's edge, rather than inside the body: the body scrolls in a box
that clips at the words' left edge, and the first version stood in that
margin and was cut off by it. Halfway between the panel's edge and the
words came next, and put it far out in the grey once a task stood in the
middle of a wide panel. A round ground under the pointer, as the other
small round controls have.

## What is put in can be held and taken out

A press on a picture always selected it — ProseMirror does that for any
atom — and nothing said so. The only way to remove one was to put the caret
after it and press Backspace twice without seeing what the first press had
done. Worse, inserting left the new picture selected, so the first letter of
the sentence after it replaced it.

Now a picture, a video or a file that is selected carries the ring a taken
card carries on the board, drawn inside its edge so a column-wide picture
does not lose it to the scroller, and a bin in its corner for whoever is not
reaching for the keyboard. Backspace and Delete take it out as they take out
a selected word. The bar of text marks does not come up over it — it has
nothing to offer a picture. After an insert the caret goes onto the line
that follows, or a new one when the picture was the last thing.

A video is a `<video>` in the editor as it is when read, not a chip with its
name: an editor that draws it as something else is one where you cannot
tell which of two clips you are deleting.

A divider is a hairline in the middle of a sixteen-pixel strip, so it can be
pressed at all; selected, the line takes the accent and two pixels. The
browser's own highlight is put away while a node is selected — ProseMirror
marks the body for exactly this — or the strip paints as a blue bar.

## The bar stands still

The marks over a selection were TipTap's bubble menu, which follows the
selection: every word a drag took in moved it along the line, and it jumped
between lines. It is the component's own bar now, drawn over the page at a
place in the document — where the selection started — fixed when it comes
up and kept until the selection goes. It comes up when the hand lets go,
not at the first letter a drag crosses, and with Shift and the arrows at
once.

## A link is typed over its words

The browser's prompt box, at the top of the window and in the browser's
own look, is gone. The link mark opens a field in the bar's place, over the
words it will go on; Enter applies, Escape goes back. An address typed
without a scheme is given `https://`, because `example.com` is what people
type. Anything that is not `http` or `https` is refused — `javascript:` is
something a colleague clicks. A selection already inside a link opens the
field with its address and a way to take it off.

## Addresses are links, wherever they stand

An address typed into a body — `https://…`, `http://…` or `www.…` — is a
link, whether it was typed, pasted, sent by an agent, imported or written
through the API as plain text. Three places make it one, and all
three read one rule, `addresses` in the shared schema, so a sentence is
linked over the same span everywhere:

- **Written by an agent or an import** — `fromMarkdown` makes it a link mark
  as it reads the Markdown.
- **Read** — `Doc` draws an address in plain text as a link. Comments,
  messages, announcements in the list and a shared document.
- **Open in an editor** — a task's description, a document, an
  announcement, a message being changed. Drawn as a link by a decoration,
  not made one by a mark: opening a body to read it never writes it back
  changed. TipTap's own autolink still marks one as it is typed.

The edges: punctuation that ends a sentence is not part of the address
(`https://x.com/a.`), and a closing bracket is only when the address opened
it — `(see https://x.com/a)` links `https://x.com/a`, and a Wikipedia
address ending `_(film)` keeps its bracket. `www.` is given `https://`. A
word stuck to the front (`awww.`, `me@www.…`) is not an address. Nothing in
code — a span or a block — is ever linked, nor anything already inside a
link, and only the web: `javascript:` or `data:` written out stays words. A
long address breaks where it must rather than widening its column.

Not in a notification: its preview sits inside the row that opens the
thing, and a link inside a button is two doors in one place.

## Code is coloured

Comments, strings, numbers, keywords and the names of things called or
declared, in the colours GitHub's light and dark themes give them —
`--code-*` in the tokens. It was one expression over the text in
`data/highlight.ts`, not a grammar per language, while a highlighter
package was a dependency nobody had agreed to. It is lowlight now, by decision, with a language per block and a bar to choose it.
Chat keeps the one expression. Either way the
colour is drawn, never stored.

## A link is followed with ⌘

In the editor a press on a link puts the caret in its words — that is what
somebody editing them wants — so a link is followed with ⌘ (Ctrl elsewhere)
held, in a new tab; while the key is down links say so, with a pointer and a
heavier underline. Where the body is only read, a press is enough.

## A code block is one thing

No bar of text marks over a selection inside code: bold, headings and lists
mean nothing there. And it can be taken out whole — it could not, since a
press puts the caret in its text and Backspace deletes characters: Escape
inside it selects the block, with the ring a picture wears, and Backspace
then takes it out; a bin on its bar does the same under the pointer.

## Pictures: smaller, larger, saved

A selected picture has a handle on its right edge; dragged, it narrows the
picture down to 136 pixels — the width its three controls need to stay on
it —, and the width is written into the node (`width`,
in pixels, multiples of four) when the hand lets go — one step of undo, and
`Doc` draws it at that width. Dragged back out to the column, it is its own
size again. Beside the bin: open it in the lightbox `Doc` already had, and
save it — under the pointer as well as on a selected picture, since the
controls were otherwise found only by pressing the picture first. On a picture narrower than the three controls they stand beside it.

A resize is saved as it is made. The body saves when it is left, and a
picture made narrower keeps the caret in the editor, so the new width sat
unsaved and a reload threw it away; a resize, a removal by the bin and a
send landing now carry a mark on their transaction that saves the body at
once. Typing still saves on leaving — a document keeps a version per save.
The handle stops where the picture does: a picture put in before its size
was recorded learns it when it loads (on the screen, not in the document —
reading is not an edit) and is held to it, so dragging past its width no
longer widens an empty box around it.

## Two lines that were never drawn

The quote's bar and the divider were both drawn in `--hairline`, a token
that does not exist, so neither had a line at all. They use
`--line-strong` now; the quote's bar is four pixels.

## And an empty one says what it is for

Flat, a body with nothing in it is a gap, so the
placeholder stopped being decoration and started being the only thing saying
what the space is. Which is when it turned out it had never been drawn. Three
things were wrong at once, each of them enough on its own:

- `data-placeholder` was a prop on `EditorContent`, a React component, which
  drops attributes it does not recognise. It never reached the DOM. It goes
  through `editorProps.attributes` now, onto the editable element, the same
  way the test id does.
- the rule looked for `p:only-child:empty`, and an empty paragraph in a
  ProseMirror view holds a `<br class="ProseMirror-trailingBreak">` — the
  browser needs it to give the line a height. The paragraph is never empty,
  so the rule never matched.
- `content: attr(data-placeholder)` reads the element the pseudo belongs to,
  which is the paragraph and not the editor holding the words. It resolved to
  an empty string. The words travel down as a custom property instead.

None of it showed while the body sat on a panel: an empty panel is itself an
invitation to write. The thing that was covering the bug was the thing that
made the bug not matter, which is the hard kind to find.

It reaches every editor, so a read-only announcement that nobody wrote a body
for now says "Nothing was written." where it used to say nothing at all.

## Two ways in, one list

**Over a selection**, a bubble: bold, italic, strike, underline, code, the
two heading levels, both lists, quote, link. Nothing until there is a
selection — a bar of sixteen buttons above every description is chrome over
content, and most bodies here are two sentences.

**At the caret**, a block menu, opened by `/` or by the button under the
body. One list behind both, because they are one question asked two ways:
somebody who knows types the slash, somebody who does not presses the
button, and a product where the two offer different things has to explain
which is which.

`/` opens it **only at the start of a block**. Anywhere else a slash is a
slash — a date, a path, "and/or" — and a menu that opens on those interrupts
writing rather than helping it. Typing on narrows the list; the arrows walk
it; Enter takes the one that is chosen and takes the `/quote` out with it,
because the command is not part of what was written.

Two heading levels and not six. A description is prose: the third level of
heading in a paragraph of four sentences is a distinction nobody reading it
can use.

## What is not here

**Colours, fonts, alignment.** A description is prose, not a
document format. Every one of those is a way to make two tasks look
different from each other for no reason a reader benefits from. Tables
came in after all, and so did a callout's five tones and a
toggle: a tone says what kind of aside a callout is, which
is a reason a reader benefits from.

**A checklist.** Ticking things off is what a task's parts are for.
The subtasks spec took the checklist out of the product on the
grounds that two ways to break a task apart is one too many; putting one
back inside a body would make three.

**Comments and messages stay plain to write.** They are rendered with `Doc`,
so a body that has structure shows it — but the composer is one line and
stays one line. A message is a sentence.
