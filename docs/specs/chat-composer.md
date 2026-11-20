# The chat's line

TRA-97: "the main things Slack's composer does — not shortcuts, video or
audio."

## What it was

A single-line `<input>`: words, and a file through the clip. A team talking
about work writes code, lists and links into a message and calls each other
in, and none of that fitted on one line of plain text.

## What it is

A small TipTap document (`web/src/ui/ChatComposer.tsx`), the same schema the
task body uses, so what it sends is drawn by `Doc` like every other body.

- **Aa** shows a row of formatting over the line: bold, italic, underline,
  strike · link, numbered list, bulleted list · quote, code, code block. It
  stays shown until Aa is pressed again — somebody who formats once formats
  the next message too. On a phone the row scrolls sideways rather than
  wrapping to two.
- **Link** turns the row into a field for the address, over the selected
  words — never the browser's prompt. A bare `example.com` becomes
  `https://example.com`; only http(s) is accepted.
- **Emoji** opens every emoji Unicode has, found by a word, last used
  first — `docs/specs/emoji.md`. It was a grid of forty-eight, and somebody
  always wanted the forty-ninth. Picking one leaves the hand in the line;
  `:` and two letters of a name offers the ones that match where the caret
  is, as Slack's line does.
- **@** — typed, or the @ button — opens the room's members under the
  pointer, filtered as one types; ↑↓ choose, Enter or Tab take, Escape
  leaves. The pick is a `mention` node `{ id, label }`, and the server tells
  that person (`mentionedIds` reads the node — `docs/api.md`, Inbox).
- **The clip** is where it was, first on the bottom row, and only in a
  project's room — a file is a row in a project's Docs.

## Keys

- **Enter sends.** Shift+Enter is a new line — a new paragraph, or a new
  item in a list, and on an empty item out of the list — not a break inside
  one paragraph, so a list started on the second line holds only that line.
- In a **list or a code block** Enter is a new line of that, as in Slack,
  and ⌘Enter sends.
- **Escape** in an empty line gives the bare keys back to the screen
  (`keyboard.md`); with words in it, it keeps them.

## Quoting a message

**Quote** in a message's ⋯ — in a room and in a thread, and in
a phone's sheet — puts that message into the line as a quote, and the
hand after it, ready for the answer:

> **Lee Park** · View message
> the words Lee said

Who said it in bold, and *View message*, a link to the message's own
address — pressed, it
opens the room at the message, lit, its thread open when it is a reply.
A link to this product opens here rather than in a new tab.

Only the words travel. A file, a GIF, a link's card and a quote inside
the quoted message are left behind — a quote is what was said, not a
copy of the message — and a mention in it is written out as `@Lee`
rather than kept as a mention, so quoting somebody's message does not
call in everybody it named. Nothing new on the server: the quote is a
`blockquote` in the body, which every client already draws.

Quoting into a line that already has words puts the quote after them.

## What is not here

Workflow shortcuts, video clips and voice — the task said so, and each is a
product of its own.

## Failure

A message that did not reach the server comes off the screen and its
document goes back into the line whole, formatting and mentions included.
