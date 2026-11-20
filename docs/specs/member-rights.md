# What one person may start

The owner asked for it plainly: clear settings, on the member, for who may
make projects and who may make channels.

## What was there

- **Projects** — a workspace switch, `who_creates_projects`: members, or the
  owner alone. It answers for everybody at once.
- **Channels** — `channel.create`, a right on each project, given to whoever
  joins and taken away one project at a time in that project's settings.

Neither could say "not her" or "only him", which is what an owner with one
new hire and one trusted lead is asking. To keep somebody from opening
channels meant finding every project they were on.

## What it is now

Two words on the membership, set on the person's page under **May start**:

- **Projects.** Null until the owner says something: then the switch
  decides, as before. On or off is the owner's word about this person and
  wins over the switch in both directions — a workspace where only the
  owner makes projects can still have the one lead who does.
- **Channels.** On by default. Off is a ceiling over every project the
  person is on: no project's rights reopen it. On leaves each project to
  decide, which is the finer control and stays where it was. Off also
  keeps them from opening channels outside projects.

And two more, under **People**, asked for the same way — "whether a member
sees the Members page and whether they may invite others", looked for on
the person and not in the workspace's settings:

- **Members page.** Whether they may open Members — the roster and each
  person's page with their weeks and hours. Null
  follows the workspace's switch, `who_sees_members`; on or off wins over it
  either way. Off is the screen only: they still pick anybody as an
  assignee or for a project.
- **Invite people.** Whether they may bring somebody in from outside. Null
  follows `who_invites_people`; on or off wins over it either way, so a
  workspace where only the owner invites can still have the one office
  manager who does.

Both are shaped as Projects is, because each has one workspace-wide
default to override.

The two are not shaped the same because the things under them are not:
projects have one workspace-wide default to override, and channels have a
per-project answer to cap. "On" for channels does not grant anything a
project took away — a person page that could would be a second place to
decide one project's rights.

The toggles show the answer, not the stored value: Projects reads lit when
the switch lets them, before the owner has said anything. Pressing it
writes the word down.

## Who and where

- Only the owner, through `people.role`; never on yourself, never on an
  owner — an owner always may.
- Direct conversations are not channels and are not affected: talking to
  one person is not dividing a project's chat.
- Decided in `can()`, from flags `auth_context` returns with the role, so
  every path — web, MCP, `/api/me`'s `can` — answers the same.
- `PATCH /api/people/:id { may_create_projects?, may_create_channels?,
  may_see_members?, may_invite_people? }`, logged as `people.rights`; the
  roster answers each person's `sees_members` and `invites_people` as it
  answers `creates_projects`. `docs/api.md`.
