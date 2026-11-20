# Mentions in a task

A room has had `@` for a long time: type it, pick somebody, and they
are told. A task had half of it. The server read a mention in a task's
description and in a comment and wrote "mentioned you" — and nothing on the
web could write one, so the only mentions in tasks were the ones agents and
GitHub put there. Typed into a description, `@Anna` was four letters.

## What it does

- **`@` in a task's description** — the task's own editor, on its screen
  and in the window that makes one — opens the people of the task's
  project under the caret, narrowed by what follows the `@`. ↑ ↓ walk it,
  Enter or Tab picks, Escape closes it, a press picks. The name goes in as
  the mention the chat writes — `{ type: "mention", attrs: { id, label } }`
  — and is drawn as one.
- **`@` in a comment, a reply and a comment being edited** — the line under
  a task — opens the same list over the line. What is picked is written as `@Name` on the
  line and becomes the mention when it is sent, the way `#` already names a
  task there.
- **After a space or at the start of a line**, so `me@there.com` names
  nobody, and not in a code block, where `@` is a decorator.
- **No `@everyone`.** It names a room's people, and a task has no room: the
  people watching it already hear about it, and the project's everybody is
  the announcement's job.

## Who is offered and who is told

Offered: **the project's people**, the list the assignee picker reads —
never the whole workspace. A name the reader cannot open is a notification
about nothing.

Told: whoever the body names **and may read the thing it is on**. A body
arrives from MCP, from GitHub and from imports as well as from this editor,
and any of those can name somebody who is not on the project — or who was
taken off it, left the workspace, was invited and never came, or belongs to
another workspace altogether. Before this, such a person was written a note
all the same. The push and the email were never sent — `stillSees` in
`push.ts` asks again, as them, before anything leaves — and the inbox did
not list it, but the row was theirs and the live ping reached their open
tabs.

Asked of the database, as them: `may_read(actor, kind, id)` (migration 188)
sets the reader to the person named for the length of the question and
evaluates the read policies' own `visible_projects()` — and for a file sent
in a room, `visible_conversations()`, as `o_read` on file has it. One rule
for who reads a project, not a copy of it in `can()`: two copies agree
until one of them changes. A thing that cannot be found tells nobody.

Told **once**:

- a new task tells everybody its description names;
- saving a description tells only the names it did not have before — that
  part was already true;
- a new comment tells everybody it names;
- editing a comment tells only the names the edit added. It told nobody,
  so a name added while fixing a sentence was never heard. Nobody watching
  hears about the edit itself. The words it replaces are read in the same
  transaction as the write, held, so two edits at once do not both tell;
- and **never while one is waiting**: somebody with an unread mention of
  the same thing is not told again (`already_named`, 188). A name taken out
  and put back — ⌘Z, a sentence rewritten — is the mention they have not
  looked at yet.

The comment's edit field has the same `@` list as the line it was written
on.

## Keeping a name through an edit

The description's editor did not know the mention node, nor a task or a
document named with `#`: a description that named somebody came into the
editor and lost the name on the first save. The editor holds all three now,
from the same definitions the chat's line uses (`ui/refs.ts`).

A comment is edited as a line of words, and the field was filled from the
words alone — a mention has none, so the name vanished from the comment.
It is filled with `@Name` now, and an edit that leaves those words alone
keeps the mention they stand for. A name is matched whole and the longest
first, so `@Sam` is never the first letters of `@Samantha`.

## Not done

- The Apple and Android apps cannot type a mention in a task. Theirs is
  the same list over the same project people (`/api/projects/:id/members`)
  writing the same node; the server needs nothing more.
- An announcement and a document read the same editor and could offer
  `@` the same way; they are not asked for here, and their people are the
  project's too when they are.
