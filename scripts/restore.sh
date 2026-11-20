#!/usr/bin/env bash
# Puts a backup of the database back.
#
#   scripts/restore.sh tuff-1.2.0-m301-20261120-101500.dump   # one the server took, in the db-backups volume
#   scripts/restore.sh backups/tuff-2026-01-31.dump            # a dump of your own, on this machine
#
#   --yes   don't ask first (needed when nobody is at the terminal)
#
# Nothing is dropped. It checks the file is a whole dump before anything
# changes, stops the app and the worker, renames the database to
# tracker_before_restore_<date>, and restores the backup as `tracker` with
# pg_restore --create, so the database's own settings and rights come back
# with it. If the restore fails or is stopped (Ctrl-C), what it made is
# dropped and the old database renamed back. The old one is kept until you
# drop it; the command is printed at the end.
#
# Then put TUFF_VERSION in .env back to the version the backup was taken on
# — the version is in the name, tuff-<version>-… — check out its tag, and
# run docker compose up -d.
set -Eeuo pipefail
cd "$(dirname "$0")/.."

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
say()  { printf '%s\n' "$*"; }
die()  { printf '\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

src='' yes=0
while [ $# -gt 0 ]; do
  case "$1" in
    --yes|-y) yes=1; shift ;;
    -h|--help) sed -n '2,/^set /s/^# \{0,1\}//p' "$0"; exit 0 ;;
    -*) die "Unknown option $1. See scripts/restore.sh --help." ;;
    *) [ -z "$src" ] || die "Give one backup, not $src and $1."; src=$1; shift ;;
  esac
done
[ -n "$src" ] || die "Which backup? See scripts/restore.sh --help. The server's own: docker compose exec postgres ls -l /backups"

[ -L .env ] && die ".env is a link. Make it a plain file and run this again."
[ -f .env ] || die "There is no .env here. Run this from the folder Tuff was installed in."
command -v docker >/dev/null 2>&1 || die "docker isn't installed or isn't on the PATH."

# The compose project this folder's .env names, or the one compose makes of
# the folder's name — said explicitly, so a COMPOSE_PROJECT_NAME exported in
# this shell for something else cannot point this at another database.
env_value() { sed -n "s/^$1=//p" .env | tail -1 | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/"; }
project=$(env_value COMPOSE_PROJECT_NAME)
[ -n "$project" ] || project=$(basename "$PWD" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9_-')
dc() { docker compose -p "$project" "$@"; }

pg=$(dc ps --status running -q postgres 2>/dev/null || true)
[ -n "$pg" ] || die "The database of the compose project \"$project\" isn't running. Start it with \`docker compose -p $project up -d postgres\` and run this again."
container=$(docker inspect -f '{{.Name}}' "$pg" | sed 's#^/##')

# A file here is read through the container's input; anything else is a
# name in the db-backups volume, which the postgres container has at /backups.
if [ -f "$src" ] && [ "${src#/backups/}" = "$src" ]; then
  where="$src"
  restore() { dc exec -T postgres "$@" < "$src"; }
else
  name=$(basename "$src")
  [[ "$name" =~ ^[A-Za-z0-9._-]+\.dump$ ]] || die "\"$src\" isn't a file here, nor the name of a backup in the db-backups volume."
  where="/backups/$name (db-backups volume)"
  restore() { dc exec -T postgres "$@" "/backups/$name"; }
fi
psql_() { dc exec -T postgres psql -U tracker -d postgres -v ON_ERROR_STOP=1 -qAt "$@"; }

bold "Checking $where"
restore pg_restore --list > /dev/null 2>&1 \
  || die "That isn't a whole database dump, or it isn't there. Nothing was changed."
say "  A whole dump."

old=tracker_before_restore_$(date -u +%Y%m%d_%H%M%S)
if [ "$yes" != 1 ]; then
  [ -t 0 ] || die "Not asking without a terminal. Run it with --yes to restore without asking."
  say "Compose project: $project    database container: $container"
  printf 'Stop the app, keep the database as %s and restore this backup as tracker? [y/N] ' "$old"
  read -r answer
  case "$answer" in y|Y|yes|YES) ;; *) say "Nothing was changed."; exit 0 ;; esac
else
  say "  Compose project $project, database container $container."
fi

bold "Stopping the app and the worker"
dc stop app worker

# Off the database and renamed in one session: the sessions on it ended
# (waiting up to five seconds for each), then the rename, tried again for
# a few seconds while anything — the health check's pg_isready among them —
# comes back in between.
bold "Keeping the database as $old"
psql_ -c "do \$\$
begin
  for i in 1..20 loop
    perform pg_terminate_backend(pid, 5000) from pg_stat_activity where datname = 'tracker' and pid <> pg_backend_pid();
    begin
      execute format('alter database tracker rename to %I', '$old');
      return;
    exception when object_in_use then
      perform pg_sleep(0.5);
    end;
  end loop;
  raise exception 'the database is still in use';
end \$\$" \
  || die "Couldn't rename the database, so nothing was changed. The app and the worker are stopped: docker compose -p $project up -d starts them."

# From here until the restore has finished, a failure or Ctrl-C puts the
# old database back: what the restore made goes, forcing off its session.
undo() {
  local why=$1
  trap - INT TERM ERR
  printf '\n' >&2
  say "Putting the database back as it was…" >&2
  psql_ -c "drop database if exists tracker with (force)" > /dev/null 2>&1 || true
  psql_ -c "alter database $old rename to tracker" > /dev/null \
    || die "The restore $why, and renaming $old back to tracker failed too. Do it by hand:
  docker compose -p $project exec postgres psql -U tracker -d postgres -c 'drop database if exists tracker with (force)' -c 'alter database $old rename to tracker'"
  die "The restore $why, so the database is as it was. The app and the worker are stopped: docker compose -p $project up -d starts them."
}
trap 'undo "was stopped"' INT TERM
trap 'undo failed' ERR

bold "Restoring"
restore pg_restore -U tracker -d postgres --create --exit-on-error
trap - INT TERM ERR

bold "Restored."
version=$(printf '%s' "$(basename "$src")" | sed -n 's/^tuff-\([0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\)-.*/\1/p')
cat <<EOF
  The database before this restore is kept as $old.

Next:
  1. Put TUFF_VERSION in .env back to ${version:-the version the backup was taken on}${version:+, the version it was taken on}, and check out its tag.
  2. docker compose -p $project up -d

Once you've checked everything is there, drop the old database:
  docker compose -p $project exec postgres dropdb -U tracker $old
EOF
