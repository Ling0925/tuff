# GIFs

A **GIF** button in a room's and a thread's line, beside the emoji, opens
KLIPY's GIFs: trending until something is typed, then what matches.

Pressing one puts it in the line, not in the room. It stands over the words
at its own shape, ninety-six tall with its room kept before it arrives, and
a ✕ on its corner takes it out again — as does Backspace in an empty line.
Words can be written with it; Enter sends both as one message, the words
and then the GIF. Sent at once, a GIF picked by mistake was a GIF in the
room for everybody, and one that wanted a word with it was two messages.
One at a time: picking another replaces the one held.

## KLIPY, and what its terms decide

- **Asked by the browser, not through us.** KLIPY's terms forbid routing
  requests through a partner's server without written approval, so the
  browser asks `api.klipy.com` itself, with the deployment's key from
  `GET /api/gifs/key`. What KLIPY sees is the words searched for, the
  browser's address, and a random id kept by that browser
  (`customer_id`) — not the account, not the workspace.
- **Drawn from KLIPY's addresses**, never copied: a message holds a node
  `{ type: "gif", attrs: { url, width, height, title } }` whose `url` is on
  `static*.klipy.com`. The server refuses a body whose GIF points anywhere
  else, and the screen draws nothing for one — a message is not a way to
  make every reader's browser fetch an address of the sender's choosing.
- **In KLIPY's order**, and the field says **Search KLIPY**, as its
  attribution rules require. Sending one tells KLIPY (the share call) with
  what was searched for.

## Without a key

`KLIPY_API_KEY` unset: `GET /api/gifs/key` answers `{ key: null }` and there
is no button. A key starts in KLIPY's testing mode at a hundred requests an
hour; production is asked for in KLIPY's partner panel.
