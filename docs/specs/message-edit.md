# Editing and deleting a message

"Messages need to be deletable and editable, attachments too."

## Edit

Your own messages, and nobody else's: a message is speech with a name on
it, and rewriting somebody's words leaves their name under yours — the
rule comments already follow (`comments.md`), without even the owner's
exception, because a room has no "running the project" reason to change
what someone said.

Under the pointer, the card on the message has a ⋯ with **Edit message**.
The message turns into its own line, in place, with what it said in it —
formatting, mentions and all — and the files it carries as tiles above,
each with a bin. The clip adds more, in a project's room. **Enter or Save**
keeps it, **Escape or Cancel** leaves it as it was. An edited message says
"(edited)" beside its time.

An edit tells nobody. A mention added in an edit is not a new message, and
an inbox that lights up for every typo fixed is one people stop reading.

## Delete

Your own messages; and in a project's room, anybody's for whoever may
change what is said there — the owner, and whoever runs the project
(`content.edit.said`). A direct conversation has nobody running it: there,
only your own.

**Delete message** asks once, inside the same menu — "Delete this message
for everyone?" — because unlike a room it cannot be taken back from the
screen. It is soft on the server, like everything, and the clear-out takes
it after thirty days.

A deleted message with answers under it stays as a line — "This message was
deleted." — so the thread still has something to hang off; without
answers it is gone. Its words, files and reactions go with it: the line
carries nothing of what it said.

## On the wire

`PATCH /api/messages/:id { body }` and `DELETE /api/messages/:id`. Both
travel round the room's socket. `edited_at` is set by the edit. A deleted
message is listed only while it has replies, with `body: null` and
`deleted: true`.
