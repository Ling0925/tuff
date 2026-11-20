# Comments

## Threads

A comment can answer another. Comments on a task were one flat column, so an
answer to the third remark stood under the eighth with nothing saying which
it answered. A reply names the comment it answers (`parent_id`), one level
deep: a reply to a reply answers the same comment — the server sees to it —
so a thread is a comment and the answers under it, never a tree read
sideways. A reply can only answer a comment on the same thing.

Each thread is a card: the comment, its answers under it, and a line to
leave another. A reply whose comment was taken away stands as a thread of
its own rather than vanishing with it. A new comment, starting a thread, is
the line under all of them.

## Edit and delete

Behind a menu on the comment, not two words on its line: they were the
loudest thing on every comment, in red, for the two things done to one least
often. Under the pointer on a desk, always there on a touch screen.

Editing is in place — Enter keeps, Escape leaves it. What is not words, a
picture or a file sent with it, is shown while editing with a way to take it
out; the edit keeps what is left. Fixing a typo never drops a screenshot,
and dropping one is a choice made where it can be seen.

Whose may be changed: your own, and somebody else's by the owner and
whoever holds `edit.any` or `manage` on the project (`content.edit.said`,
`mayEditSaid`). Somebody else's is never changed or taken back through a token — an
agent's, a person's tool, one held to a few projects, the owner's own — nor
by GitHub or an import acting as somebody: rewriting a comment into nothing
is deleting it, and no token deletes a comment. Whoever ran a project could
hand a tool a token and have it empty somebody's comment, the way
closed for announcements;. One's own stays a token's to change —
`update_comment` is for that, and GitHub carrying an edit made there acts
as the comment's own author. Resolving or reopening a thread on a
document's words changes nothing anybody said, and stays open to tokens.

The row policy said only the author until the same change: the owner's
edit of somebody else's comment answered 404 and their delete answered 200
and took nothing away. `cmt_update` now lets through the author and who
`content.edit.said` lets through — the owner whose address is proved (an
unproved owner is a member to `can()`, and to `may_edit_said`), and
`edit.any` or `manage` on the project — within a limited token's projects
(migrations 236 and 237).

A comment is as hidden as what it is on. A file sent in a project's room
with chosen people is hidden from everybody outside the room, the owner
and the runners included; its comments were read by the whole project and,
for a day, changed and deleted by the owner and the runners. Reading,
changing and taking one back now ask for the file under its own policies
too — in `cmt_read`, `cmt_update` and the server's `held()` — and an object
the asker cannot read is a 404. Found by the review of. A task's
and an announcement's are not asked for: their read policies are their
project's, which the comment's own already asks, and a comment's project
is its object's. Asking anyway (migration 237) cost a probe of `task` per
comment — a project's per-task comment counts went from 58 to about 200
ms — and migration 238 asks for the file alone. A comment on any other
kind of thing is read by nobody.

Whoever may change a comment changes its words. Its author, workspace,
project, what it is on and when it was made never change: a trigger
refuses it (migration 237), since the policy's check let anybody past it
rewrite any column.

## One block, wherever something is said about a thing

A task, a document and an announcement end the same way: what was said,
under the document's quiet grey label rather than a heading the size of
the task's own sections (`Discussion` in `Comments.tsx`) — it is read after
the thing, not announced. A document and an
announcement drew theirs with a small grey label over an indented "Nothing
said yet.", so one conversation looked like three features. None of them
says "Nothing said yet." any more: the line to write on is right under the
heading and says it better. An
announcement's is headed Replies and its line says Reply; the shape is the
same.

## The line on top

The line to write a new comment on stands above the comments, and the
threads run newest first under it. At the foot, under every thread and each
thread's own reply line, it read as one more reply, and what was just said
landed below everything else, out of sight. A thread's replies still run in
the order they were said, under it.
