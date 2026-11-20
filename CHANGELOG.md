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
