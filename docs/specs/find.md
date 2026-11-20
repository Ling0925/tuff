# Finding in a room, in Docs, in Activity

The palette answers "take me to the thing I am thinking of" across the
workspace. Three screens hold more than a person can scroll through and are
asked a narrower question — *where in here was that said*: a room, a
project's Docs, and its Activity. Each gets a magnifier in its bar that
narrows what that screen shows. It is not a second search: nothing it finds
is outside the screen it is on, and the palette stays the one place to
look across everything.

## The control

A round button with the magnifier, beside the screen's other buttons. Pressed,
it opens into a field in its place; Escape empties it and closes it, and so
does the × in the field. While it holds words it stays open, so a narrowed
screen always says why it is narrowed. Results come as the words are typed.

## A room

`GET /conversations/:id/messages?q=` — the messages of that room whose words
hold the question, replies in threads included, newest first, thirty at a
time on the same cursor the history pages by. Two letters at least.

What a message says is kept beside it as plain text (`message.said`, made by
the database from the body, so nothing writes it by hand) under a trigram
index — the load table has a channel with a million messages in it,
and `ilike` on a body nobody indexed is a read of all of them.

The trigram index alone was not enough there: "Message 4242", in a room
where all million say "Message", read every entry of every trigram — 27 ms
on one run and 365 on the next. So the room's newest twenty thousand are
read first, newest first, and only when they do not fill the page is
anything older looked for, by its words: older than that, each word typed
is a word or the start of one (migration 171), as the palette's search of
messages does.

While the field holds words the history gives way to the answers: who, when,
and the line with the words lit. Pressing one empties the field and opens the
room at that message, read back as far as it takes, and lights it for a
moment; a reply opens its thread.

## Docs

Every row is already on the screen — Docs is one list — so the words narrow
it there, with nothing asked of the server: the name, the address of a link,
who put it there, and where it was sent from. It narrows together with the
kind filters.

## Activity

`GET /activity?project=&q=` — the lines whose thing (a task's title, a
post's, a file's name) or whose person holds the words. Paged like the feed.
