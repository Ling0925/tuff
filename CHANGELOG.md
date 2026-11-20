# Changelog

All notable changes to Tuff for your own server are written down here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and Tuff uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html):

- a **major** version can need you to do something by hand when you update — it says what;
- a **minor** version adds features;
- a **patch** version fixes things.

The database is migrated forward when the app starts, and migrations never
run backwards. To go back to an older version, restore the backup taken
before the update: `scripts/update.sh` takes one and prints the commands.

## [Unreleased]

The first public release of Tuff for your own server.

### Added

- Projects with tasks, a board, chat, docs and announcements, and an
  activity feed for each project.
- My tasks, Members, search across everything with ⌘K, and notifications.
- Chat in project channels and direct messages, with threads.
- An MCP server for AI agents, with the same permissions as people.
- Email sign-in with a second factor, and Google, Apple or GitHub sign-in
  with your own keys.
- Mail through your own SMTP server or Resend.
- Push notifications in the browser and the installed web app.
- Importing from Asana, Jira, Linear, Slack and GitHub Issues.
- English and French.
- Server settings for the server's owner: who else is an owner, whether
  anyone can sign up, and a test email.
- A released image for linux/amd64 and linux/arm64,
  `ghcr.io/usetuff/tuff`, signed with cosign, with build provenance and
  an SBOM.
- `scripts/update.sh`, which backs up the database, moves to a new
  release and waits until it is healthy.
- `/health` reports the running version.
- Server settings shows the running version and says when a newer one is
  out. A security release also puts a red dot on the owner's picture. The
  worker asks GitHub once a day; `UPDATE_CHECK=off` turns that off.
- A release with a `### Security` section in this changelog is a security
  release.
