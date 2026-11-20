# Removing somebody from a workspace

The owner takes a person out of a workspace from their card in Members.
Every request they make is refused from that moment — the session check
asks for a live membership on each one — but an audit found that removal
cut that and nothing else: what the person had set going kept going, and
the doors they had been given stayed on their hinges for the day they
came back.

Removal is one act, and it ends everything the person had in that
workspace and nothing they have anywhere else: an account can be in
several, and the others are not touched.

## What removal does

In one transaction (`remove_from_workspace`), for that workspace only:

- **Their membership and their projects end**, as they did.
- **Every invitation they made and nobody has used is withdrawn.** A link
  they posted in a channel let them, or anybody, walk back in with no
  owner pressing anything.
- **Their sessions in it end** on every device, their tokens for it —
  the ones they made and the ones an agent was given through OAuth — are
  revoked, what they followed is let go, and their phones and browsers
  stop being sent its notifications. Before, all of
  these failed while they were out and came back to life the moment
  they were invited again, and an agent connected by OAuth kept minting
  itself new tokens the whole time.
- **They leave every room** they were in there, as leaving a channel
  does — a group's direct conversation too, which goes on without them:
  back, they would read what was said while they were out. A
  conversation of two keeps them, so it still says who it was with, and
  takes nothing more. Their messages stay.
- **They come off every open task** they were on, as Asana does: the
  task becomes nobody's, which is what the Nobody's filter is for, rather
  than somebody's who can be neither seen nor taken off. A finished task
  keeps their name — it is a record of who did it.
- **A Slack channel they linked stops**, as a GitHub repository does when
  the person who linked it loses the project: it was posting the
  project's words to a channel of their choosing.

A member can do the same to themselves — **Leave workspace**, the same
body in the database (`workspace_member_end`).

## Coming back

Only by an invitation made after they were removed: one made before is
refused even if somebody kept it. They arrive with no old sessions, no
old tokens and in no rooms, as somebody new does.

That holds for their account. An open link anybody may join by, made by
somebody else before the removal — posted in a channel they read — is
still a link anybody may join by, from another address: that is what
such a link is.

So the dialog that removes somebody offers to end them in the same press,
when there are any: *Also revoke 2 open invite links*, with *Anyone who
has an open link can still use it to join* under it. The box starts
unticked — it ends links other people made and may have sent to somebody
they want in — and the links go only when it was ticked, in the removal's
own request (`DELETE /api/people/:id` with `{ "withdraw_links": true }`,
in the same transaction as the removal). Nothing in the address, and no
value but `true`, asks it. An invitation sent to an address is not an
open link and stays; the owner withdraws it, or any link, one at a time
on the Members screen as before. It said only, before, that this could
be done in Settings, which a person reading the dialog took as done.

## On their devices

The removal ended their sessions, and the next renewal from a device they
were using was answered `401 unauthorized`, the same as a token that had
run out: they were put back at the sign-in with no word of why. A device
holding a session from before removal ended sessions fared worse — the
renewal carried it into their oldest other workspace, under the address of
the one they had lost, with what this browser kept of the old one still on
its disk.

- **The renewal says so.** `/auth/refresh` answers `401 removed` with the
  workspace's id and name, for the token that was live when they were
  removed — not a copy spent before it, which learns nothing — and never a
  session somewhere else. Back by a new invitation, an old token is only
  `unauthorized` again. A workspace deleted is not somebody removed.
- **The browser clears it before it says it.** The answer carries
  `Clear-Site-Data: "cache"` and drops the file cookie, as signing out
  does; the web then deletes what it kept to read offline, the drafts and
  rooms under `tracker:`, and this device's push subscription
  (`offline.md`), and only then goes to the sign-in.
- **The sign-in says it:** *You were removed from Studio. Its data
  has been cleared from this device.* A quiet line over the form, not an
  error — nothing they did was wrong — kept for the tab until they sign
  in again, which takes them to a workspace they are still in.
- **The apps do the same** with the same answer: clear what they keep of
  that workspace, say the sentence, and sign in again. The shape is
  `RemovedFrom` in the generated protocol.

## What the others see

- **Their face on what they said** opens a card that says they are no
  longer in this workspace (`person-card.md`).
- **A direct conversation with them** stays readable, says *No longer in
  this workspace* where the composer was, and takes no new messages:
  they would reach nobody.
- **No presence** for somebody removed: a green dot said they were here
  when they were active somewhere else.
- **The removal itself asks first.** It took one press in a menu, with
  everything above behind it.

## The schema decides

`can_see_conversation` and `visible_conversations` ask for a live
membership as well as a room membership, so an open socket, a queued
push and anything else that asks them stops — not only the requests
that happen to check the session. A socket's own recheck asks for the
membership too, and nobody removed is sent the notice that something was
said in a room or a note was written for them.

## Security

- Every door above tested as an attack: their own invitation and an old
  one, a token, a refresh token after re-joining, the rooms as a socket
  asks for them, a group's conversation and a conversation of two, a
  direct message sent to them.
  And what the renewal tells: only the live token's holder, only while
  they are out, only a workspace that still stands.
- Reviewed independently before it ships, twice: the first review found
  this whole list, the second that sessions were not ended, that the
  socket for one's own notices stayed open, and that a group's direct
  conversation kept them — fixed here.
