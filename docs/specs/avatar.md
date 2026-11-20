# A person's picture

A person can put a photograph of themselves where their initial is drawn, and
take it off again. It is the same feature a project already has, applied to
the other thing in the product that gets a small round mark beside its name.

## What is there now

`actor.avatar_url` has existed since the first migration, as a plain `text`
column. Nothing ever wrote to it — every screen reads it, the seed leaves it
null, and there has never been an endpoint that sets it. So it is not a
feature with a missing button; it is a column with a name that promises one.

Meanwhile a project's picture is finished: `project.icon_key` holds a storage
key, `POST`/`DELETE /api/projects/:id/icon` take and drop the bytes, and lists
hand back `icon_url` signed for an hour. The storage layer underneath is a
driver with one implementation and a contract — keys in, short-lived signed
URLs out — written so that swapping it for object storage is a driver change.

## The decision

A person's picture follows the project's, exactly.

That means a new `avatar_key` column rather than writing into `avatar_url`.
The distinction is the one `storage.ts` opens with: **there are no public
URLs.** A `text` column called `avatar_url` invites a link to somewhere else —
a gravatar, an S3 bucket, whatever the client pasted — and every one of those
is a URL that outlives the session, that a screenshot leaks, and that nothing
in this product controls. A key behind a signed link is none of those things.

So `avatar_url` stays where it is, unread and unwritten, and the API keeps
handing back a field of that name — now computed, the way `icon_url` is, from
a key the client never sees. The column is left rather than dropped because
dropping it is a migration that can fail on a database somebody has already
written to by hand, and it costs nothing to leave.

## The shape

| Method | Path | Action |
| --- | --- | --- |
| POST | `/api/me/avatar` | signed in; multipart, one image |
| DELETE | `/api/me/avatar` | signed in; back to the letter |

No permission beyond being signed in. A person's own face is the one thing in
this product that is theirs without a role saying so — there is no
`actor.update` to check, because there is nobody else who could be changing
it. `/api/me` is already the address for what is yours.

The limits are the project icon's, for the same reasons and so there is one
answer to "how big can it be": `image/*` only, two megabytes, 413 over that.

## An agent's face

An agent never signs in, so it cannot set its own. The owner, or whoever
connected it, sets it on the agent's page in Members — its face there is
the control — at `POST`/`DELETE /api/agents/:id/avatar`, with these limits
and this allowance. That is the one face in the product
somebody sets for someone else: an agent is the connector's, as the agent
itself is.

## What it is not

It is not a second way to set a name, and it is not an admin screen. One
person changes one picture — their own. A workspace owner who wants somebody
else's photograph changed asks them.

It is also not a crop tool. The mark is a circle and the image is drawn to
fill it (`object-fit: cover`), which is what the project's icon does; a
picture that is wrong in a circle is a picture to replace, not to adjust in a
dialog this product does not have.

## Where it is changed

Account, beside the name — the screen that already holds what is yours rather
than what is the workspace's. The control is the project's: a label that says
"Use a picture" when there is none and "Change" when there is, with "Back to
the letter" beside it once one exists.

The letter is the default, not a placeholder, exactly as the generated mark is
for a project. A person who never uploads anything has a picture already; it
is their initial on a tint derived from their id, and it tells two people with
the same initial apart better than two initials would.

## What the activity log says

Nothing. A project's icon is recorded because a project is a shared thing and
its history is read by people who did not change it — `project.icon` and
`project.icon.remove` are lines somebody else needs. A person changing their
own face has no second party to inform, and a log line for it would be a
record of somebody's appearance that they did not ask anybody to keep.

## Two letters

The mark with no picture carries two letters: the first and last names'
initials, or the first two of a single name — Bruno Costa is BC, Dev is DE.
It was one, and the tint was meant to tell people apart; with fifteen people
the tints repeat and a column of B, B and C names nobody. The pair is set at
four tenths of the mark with the tracking taken in, so it reads as one mark
down to 16px.

## Colours are dealt, not drawn

A face's colour was a hash of the id: ten colours, any number of people, and
in a team of six two or three wore the same one. Now the workspace's people
are dealt them (`data/faces.ts`): in id order each takes the colour its hash
points at unless somebody already has it, and then the next free one; only
when all ten are worn does one come round again. The same deal on every
screen and for everybody, and most people keep the colour they had.
Somebody outside the workspace's list — a name with no id — is still the
hash.
