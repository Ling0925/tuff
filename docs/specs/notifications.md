# What reaches you

The inbox, push and email answer one question — what happened that is
yours to know — and until now they answered it with gaps a person could
fall through without anybody noticing. The person a task was given to
heard about the giving and nothing after. An announcement, which is
somebody deciding to tell people something, told nobody. "New activity"
said that something happened and not what, and said it on every save,
including the ones that changed nothing. Nobody was reminded of a date. A
reply in a thread reached the person it answered only if it named them.
And somebody who never turned push on found out about all of it by opening
the product.

This closes those, and keeps the rule `notify.ts` was written around: a
note nobody needed is how people learn to ignore the ones they did.

## Why a note arrives

`mentioned`, `assigned`, `subscribed`, `messaged` and `joined` as before
(`messaged` to an agent, in a conversation of the two of them, is
`mentioned`), and four more:

| reason | when | to whom |
| --- | --- | --- |
| `posted` | an announcement is published | everybody on its project, which is who may read it |
| `replied` | a reply in a thread | whoever started the thread and whoever has replied in it, but the one replying |
| `due` | a task is due tomorrow, or was due yesterday and is still open | the person it is on |
| `added` | somebody puts you on a project | you |
| `reminder` | a moment you chose on a task has come | you; not held by quiet hours |
| `unblocked` | the last open task a task waited on is finished | the waiting task's assignees who may read both |

A room set to **Nothing** lets nothing through, a thread reply included. A
room set to **Mentions only** lets a thread reply through: a thread you
started or answered in is a conversation you are in, not a room you are
watching.

## The person on a task follows it

Being given a task subscribes you to it, the way making one or commenting
on one already did. It came back after an unsubscribe, too: being given a
task is new information about whether you want to hear about it. Taking
somebody off a task leaves them subscribed, so they hear that it went to
somebody else; they can stop watching from the task, as anybody can.

## What happened, not that something did

A note carries a line, `what`, saying what happened in the product's
words: *Bruno moved it to Done*, *Ada changed the due date to 31 Oct*,
*Dev gave it to Chiara*, *Mia commented*, *Ada wrote in the description*,
*Due tomorrow*. The inbox shows it under the subject; a push shows it in
place of "New activity".

It is never what anybody wrote. A push is drawn on a lock screen, which is
not ours to write private words on, and a line that
quoted a comment would put it there.

**Only what is worth telling.** The people watching a task hear that it
moved, was finished or reopened, changed hands, changed date, or was
written on — and not that it was renamed, labelled, reprioritised or
dragged up its column. Those are in the task's activity for anybody who
looks. A save that changed nothing tells nobody anything: the task's
handler compared every field for the activity log already, and the notes
now read the same comparison instead of firing on every request.

**One note for a burst.** A note about something you are watching waits
thirty seconds before it may leave, and anything else that happens to the
same thing in that time replaces its line rather than adding a second
note. Somebody moving a card and then setting its date is one note on
your phone, saying the last thing they did. `assigned`, `mentioned` and
`due` are never held or merged — each is addressed to you.

## Reminded of a date

At nine in the morning, in the zone of the person a task is on: the day
before it is due, *Due tomorrow*; the day after, if it is still open,
*Overdue since 31 Oct*. Once each, per task and per date — moving the date
earns a new pair, and a task finished before the morning is reminded of
nothing. Quiet hours hold it like any other note. Nobody is reminded of a
task that is on nobody; a reminder addressed to a whole project is how a
project learns to ignore them.

The worker does this (`pnpm worker`), which is one more thing that does
nothing without it.

## Email, once a day

Somebody who has not read a note four hours after it arrived gets one
email a day with what is waiting: the subject and the line for each, ten
at most and a count of the rest, each a link to the thing. Between eight
in the morning and eight at night where they are, outside their quiet
hours, and never a second the same day. Notes it has mentioned are not
mentioned again. Reading them in the product is what stops the next email
— there is nothing to clear.

It is on by default, and is the one switch this adds, under Notifications
in your account: *Email me what I missed*. A setting where a sensible
default exists is what the project's handbook forbids, and this is the exception it
allows for — a product that mails you has to let you stop it, from the
mail itself as much as from the screen. Every digest ends with a link
that turns it off without signing in, signed so it turns off nobody else.
Opening the link asks, with one button; the button does it. It used to do
it on opening, and a mail scanner that follows every link turned people's
digests off for them. The mail also carries `List-Unsubscribe` and
`List-Unsubscribe-Post` (RFC 8058), so Gmail and Mail put their own
Unsubscribe beside the sender, which posts to the same link.

Across workspaces: one email for a person, grouped by workspace, rather
than one per company.

## Smaller

- **Calling the room.** `@everyone` in a room's composer names every
  member of the room; it is a mention for each of them and reaches them
  as one, through **Mentions only** but not through **Nothing**. Only in
  rooms — a task or an announcement has its own way of reaching people.
- **Put on a project.** Being added to a project is an `added` note that
  opens the project.

## Many at once

An announcement to a project of a thousand, or `@everyone` in a big room,
is a thousand notes written inside the request of whoever pressed Publish.
They were three or four queries a person — the switch, the quiet hours, the
insert, the notice — which nobody noticed while a task had a handful of
watchers. Now everybody's hours are one query (`notify_when`, the quiet-hour
rule as one SQL expression, `held_until`), every note that is not merged is
one insert (`notify_many`), and the notices are one per reason. The merge
asks an index of waiting notes rather than walking somebody's unread.
`pnpm load` announces to a project of a hundred — the team this is built
for now — and holds it to 200 ms; a thousand measured 266 ms.

## What it costs

`notification` gains `what` and `emailed_at`; `app_user` gains
`email_digest` and `last_digest_at`; `due_reminder` remembers which
reminders were sent. Notes are written through `notify_once`, a definer
function that inserts or merges, because merging means touching a row that
belongs to somebody else. Migration 128.
