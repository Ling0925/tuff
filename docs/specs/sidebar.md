
## Cut only when it would not fit

The projects and the chats were cut at eight each, whatever the window — a
tall screen with room to spare said "1 more chat" over empty column. Each list
now shows as many as the column has room for, measured against its height;
when both do not fit, each keeps at least eight and the projects at most half,
so a workspace with sixty projects still shows its chats. What somebody put
away stays behind "more" either way.

## The Chats page

The Chat heading in the column is a way in, as the Projects heading is: the
same button, lit under the pointer the same way, opening **every room this
person is in** at `/:ws/chat` — project channels, channels outside every
project, direct and group conversations, with what is unread in each and a
way to start one. On a phone it is the Chat tab. It is drawn from the rooms
the app already holds, so it opens whole, and a room pressed there opens at
its own address as from the column.

`/:ws/chat` used to say "Pick a conversation." on a wide screen and was the
list only on a phone. One page at both widths now, as Projects is.

### People who left

A direct conversation whose everybody else has gone — removed from the
workspace (`removing-someone.md`) or their account deleted (where they become "Deleted account") — is no longer a place in the list. It
sat among the live chats with a grey "DA" face, asked for a press it could
not answer, and grew by one for every person who ever left.

So it is not in the column's Chat list, not in its "N more chats", not in
the palette's chat doors and not in the icon's number. It is at the foot of
the Chats page, under **People who left · N**, one line saying what they are
and that they can still be read. Opened, it is what it always was: the
history, and no line to write on. Nothing is deleted.

A group conversation is one of them only when nobody else in it is still
here; one live person keeps it in the list.

The fact is the server's — `others_gone` on `GET /api/conversations`,
worked out in the query from the workspace's own memberships, which was
already there to stop a message reaching nobody. Somebody invited back has a
membership again, so the conversation comes back to the list by itself. No
new field: the one that refuses the message is the one that moves the row,
so the two cannot disagree.
