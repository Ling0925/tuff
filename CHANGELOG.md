# Changelog

All notable changes to Tuff for your own server are written down here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and Tuff uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html):

- a **major** version can need you to do something by hand when you update — it says what;
- a **minor** version adds features;
- a **patch** version fixes things.

The database is migrated forward when the app starts, and migrations never
run backwards. To go back to an older version, restore the backup taken
before the update: the app takes one before it migrates, and
`scripts/update.sh` prints the commands.

## [Unreleased]

### Added

- A list an agent takes: in a project's list settings, choose an agent, and
  new tasks in that list with nobody on them go to it.
- A repeating task given to an agent wakes it each time the next one is
  made, so an agent can do a piece of work every week.
- An agent's page says what it did this week or month: the tasks it took,
  finished and holds, the questions it asked and how many were answered,
  and what it spent, each number opening its tasks.
- A project's instructions for agents: mark one of its documents
  "For agents" and agents connected over MCP are told to read it first. It
  gives them no rights of their own.
- Browser push works with no setup: with no VAPID keys in `.env`, the
  server makes a pair on first start and keeps it in the database, sealed.
  Keys in `.env` still win.
- Files loads in pages, pinned documents first, so a project with
  thousands of files opens fast.

### Changed

- Pinned documents are four across on a desktop.

### Fixed

- A document opened again right after it was named no longer writes
  "Untitled" back over its name.
- Lists read in pages (announcements, notifications, activity, a room's
  search, Recently Deleted, projects, tasks by date) no longer skip rows
  written at the same moment.
- A task opened from My Tasks no longer shows a blank window first, and a
  new notification no longer arrives already read.
- People & Agents draws its agents and invitations with its people.
- A task's chip no longer leaves its tick alone at the end of a line.

### Security

- Signing in has a database role of its own. The application's connection
  can no longer change anybody's password, address or second factor, make
  or end a session or a token, delete an account, or set the server's mail
  or owners — even if it ran SQL it shouldn't. Nothing to set: the role's
  password is derived from `DATABASE_URL_APP`. A managed Postgres whose
  migrating user isn't a superuser needs `ADMIN OPTION` on `tracker_app`;
  see the self-hosting guide.
- The application role no longer writes a person's sign-in columns
  directly, and a session or API token can only be made for oneself.

## [1.0.0] - 2026-11-20

The first public release of Tuff for your own server.

### Added

- Projects with four tools: Tasks (a list and a board, with labels, due
  dates, sub-tasks and blockers), Chat, Files and Announcements, and an
  Activity feed for each project.
- Files: documents written together, pictures, uploads and links. Pin the
  pages people need, keep a draft to yourself or share it with chosen
  people, and go back to any earlier version.
- My Tasks, People & Agents, search across everything with ⌘K, and
  notifications.
- Chat in project channels and direct messages, with threads, mentions and
  reactions, and a chat opened beside the board.
- An MCP server for AI agents, with the permissions you give them. An agent
  asks with choices when it needs a decision, and the question waits in
  Needs you.
- GitHub, with a GitHub App of your own: pull requests show on their task
  and move it, and a repository's issues and a project's tasks stay in sync
  both ways.
- Email sign-in with a second factor, and Google, Apple or GitHub sign-in
  with your own keys.
- A setup link for the first opening: set up email from the screen (your
  own SMTP server or Resend, with a test email) or skip it, then create the
  owner's account. No commands.
- Push notifications in the browser and the installed web app.
- Importing from Asana, Jira, Linear, Slack and GitHub Issues.
- English and French.
- Server settings for the server's owner: who else is an owner, whether
  anyone can sign up, and email.
- `scripts/setup.sh --try`: Tuff on your own computer, to see it before
  you set up a server.
- A one-click template on Railway: the app, the worker, Postgres and a
  bucket for files, every secret generated.
- A released image for linux/amd64 and linux/arm64,
  `ghcr.io/usetuff/tuff`, signed with cosign, with build provenance and
  an SBOM.
- A backup before every migration: the app dumps the database into the
  `db-backups` volume before it applies any, and doesn't start if the
  dump fails. Kept 30 days (`BACKUP_RETENTION_DAYS`);
  `SKIP_PRE_MIGRATION_BACKUP=1` skips it. After an update, Server settings
  says which version you came from and where the backup is, or why none
  was taken. `scripts/restore.sh` puts one back, keeping the database it
  replaces.
- `scripts/update.sh`, which moves to a new release, waits until it is
  healthy, and names the backup the server took.
- `/health` reports the running version.
- Server settings shows the running version and says when a newer one is
  out. A security release also puts a red dot on the owner's picture. The
  worker asks GitHub once a day; `UPDATE_CHECK=off` turns that off.
- A release with a `### Security` section in this changelog is a security
  release.

[Unreleased]: https://github.com/usetuff/tuff/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/usetuff/tuff/releases/tag/v1.0.0
