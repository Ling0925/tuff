#!/usr/bin/env bash
# Moves this server to another release of Tuff.
#
#   scripts/update.sh              # the latest release
#   scripts/update.sh 1.2.0        # that release
#
#   --yes       don't ask before updating (needed when nobody is at the terminal)
#   --dry-run   say what would happen, change nothing
#   --force     allow moving to an older release
#
# In order: it finds the release (the latest one from GitHub, unless you
# name one), shows what changed since yours, pulls the new image while the
# old one keeps serving, sets TUFF_VERSION in .env, restarts, and waits
# until the app is healthy and reports the new version. If it isn't, it
# prints the exact commands to go back to the version you had, with your
# data as it was.
#
# The backup is the server's: before the new version applies a migration,
# the app dumps the database into the db-backups volume
# (/backups/tuff-<old version>-m<migration>-<date>-<time>.dump), and doesn't start if
# the dump fails. This script says which dump it took.
#
# Migrations only go forward. The app migrates the database when it starts,
# so an older release can't run on a database a newer one has migrated:
# going back means restoring the backup taken before the update. That is
# why moving to an older release needs --force.
#
# This script and the compose file come from this checkout, and only the
# image comes from the release. Check out the release's tag first, so they
# match it:
#
#   git fetch --tags && git checkout v1.2.0
#   scripts/update.sh 1.2.0
#
# `main` is where development happens between releases; a server follows
# the tags.
set -euo pipefail
cd "$(dirname "$0")/.."

REPO=${TUFF_REPO:-usetuff/tuff}
WAIT=${TUFF_UPDATE_WAIT:-300}

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
say()  { printf '%s\n' "$*"; }
die()  { printf '\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

target='' yes=0 dry=0 force=0
while [ $# -gt 0 ]; do
  case "$1" in
    --yes|-y)  yes=1; shift ;;
    --dry-run) dry=1; shift ;;
    --force)   force=1; shift ;;
    -h|--help) sed -n '2,/^set /s/^# \{0,1\}//p' "$0"; exit 0 ;;
    -*) die "Unknown option $1. See scripts/update.sh --help." ;;
    *) [ -z "$target" ] || die "Give one version, not $target and $1."; target=${1#v}; shift ;;
  esac
done

is_version() { [[ "$1" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]]; }
# 0 when $1 is a higher version than $2.
newer() { [ "$1" != "$2" ] && [ "$(printf '%s\n%s\n' "$1" "$2" | sort -t. -k1,1n -k2,2n -k3,3n | tail -1)" = "$1" ]; }

# --------------------------------------------------------------- where we are
[ -L .env ] && die ".env is a link. Make it a plain file and run this again."
[ -f .env ] || die "There is no .env here. Run scripts/setup.sh first, or run this from the folder Tuff was installed in."
command -v docker >/dev/null 2>&1 || die "docker isn't installed or isn't on the PATH."
docker compose version >/dev/null 2>&1 || die "docker compose isn't available. Tuff needs Docker Compose 2.24 or newer."
command -v curl >/dev/null 2>&1 || die "curl is needed to find the release. Install it and run this again."

# A value from .env, read rather than sourced: sourcing would run whatever
# the file holds.
env_value() { sed -n "s/^$1=//p" .env | tail -1 | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/"; }

case "$(env_value COMPOSE_FILE)" in
  *docker-compose.build.yml*)
    die "This server builds Tuff from this checkout (docker-compose.build.yml is in COMPOSE_FILE), so
there is no image for this script to move. The app backs the database up before it migrates. Run:
  git fetch --tags && git checkout v<version>
  docker compose up -d --build
Or, to run the released images instead, take docker-compose.build.yml out of COMPOSE_FILE in .env
and run this again." ;;
esac

current=$(env_value TUFF_VERSION)
if [ -n "$current" ] && ! is_version "$current"; then
  die "TUFF_VERSION in .env is \"$current\", which isn't a version like 1.2.0. Set it to the release you run and try again."
fi

# ------------------------------------------------------------ where to go
if [ -z "$target" ]; then
  say "Looking up the latest release of $REPO…"
  latest=$(curl -fsSL --max-time 20 -H 'Accept: application/vnd.github+json' \
    "https://api.github.com/repos/$REPO/releases/latest" 2>/dev/null \
    | sed -n 's/^ *"tag_name": *"v\{0,1\}\([^"]*\)".*/\1/p' | head -1) || true
  [ -n "$latest" ] || die "Couldn't read the latest release from GitHub. Check the connection, or name the version: scripts/update.sh 1.2.0"
  target=$latest
fi
is_version "$target" || die "\"$target\" isn't a version. Give it as 1.2.0."

if [ -n "$current" ] && [ "$current" = "$target" ]; then
  say "This server is on $target already. Nothing to do."
  exit 0
fi
if [ -n "$current" ] && newer "$current" "$target"; then
  if [ "$force" != 1 ]; then
    die "$target is older than $current, the version you run. Migrations only go forward, so an older
release can't start on this database. To go back, restore the backup taken before you
updated (see the end of docs/self-hosting.md), then run this with --force."
  fi
  bold "Going back from $current to $target, because of --force."
  say "This only works on a database restored from a backup taken on $target or earlier."
fi

bold "Tuff ${current:-(version unknown)} → $target"
if [ -z "$current" ]; then
  say "TUFF_VERSION isn't in .env yet: this server was built from source before releases had"
  say "images. It will run the released image from now on."
fi

# What changed, from the release's own CHANGELOG.md: every section from the
# target's down to (not including) the one you run.
changes=$(curl -fsSL --max-time 20 "https://raw.githubusercontent.com/$REPO/v$target/CHANGELOG.md" 2>/dev/null \
  | awk -v to="$target" -v from="$current" '
      /^## \[/ {
        if (index($0, "## [" to "]") == 1) on = 1
        else if (from != "" && index($0, "## [" from "]") == 1) exit
      }
      /^\[[^]]+\]: / { exit }
      on' \
  | perl -0pe 's/<!--.*?-->\n?//gs' | head -150) || true
if [ -n "$changes" ]; then
  printf '\n%s\n\n' "$changes"
else
  say "(Couldn't read the changelog for $target: https://github.com/$REPO/releases/tag/v$target)"
fi

# The compose file and this script are this checkout's. A checkout older
# than the release may lack something the release needs.
here=$(sed -n "s/^export const VERSION = '\([0-9.]*\)'.*/\1/p" server/src/version.ts 2>/dev/null || true)
if [ -n "$here" ] && is_version "$here" && newer "$target" "$here"; then
  say "This checkout's files are from $here. Check out the release first, so the compose file and"
  say "this script match it:  git fetch --tags && git checkout v$target"
  say "then run this again — or go on if $target's notes ask nothing of them."
  echo
fi

if [ "$dry" = 1 ]; then
  say "Dry run: nothing was pulled, backed up or changed."
  exit 0
fi
if [ "$yes" != 1 ]; then
  [ -t 0 ] || die "Not asking without a terminal. Run it with --yes to update without asking."
  printf 'Update to %s? [y/N] ' "$target"
  read -r answer
  case "$answer" in y|Y|yes|YES) ;; *) say "Nothing was changed."; exit 0 ;; esac
fi

# The target's version, for compose only: .env is not changed until the
# image is here.
dc_target() { TUFF_VERSION=$target docker compose "$@"; }

# ------------------------------------------------------------- the image
bold "Pulling $target"
dc_target pull --quiet app worker || die "Couldn't pull the image for $target. Nothing was changed; the server is as it was."

# ---------------------------------------------------------------- backup
# The server's own: before it applies a migration, the app dumps the
# database into the db-backups volume, which the postgres container can
# read too. What is there now, so the dump this update takes can be named
# afterwards.
case "$(env_value SKIP_PRE_MIGRATION_BACKUP)" in
  1|true|TRUE|yes|YES|on|ON) skipping=1 ;;
  *) skipping=0 ;;
esac
dumps() {
  docker compose exec -T postgres sh -c 'ls -1 /backups 2>/dev/null' 2>/dev/null \
    | tr -d '\r' | grep -E '^tuff-[A-Za-z0-9.]+-m[0-9]+-[0-9]{8}-[0-9]{6}\.dump$' | sort || true
}
# The backup this update stands on. First what the app said since it was
# started — "Backed up the database to …", or "… already holds the database
# from before this update" when a start before took it, which no listing
# of new files would show — and the first it named; else the oldest dump
# that wasn't there before, by the date and time in its name.
said_dump() {
  [ -n "${started:-}" ] || return 0
  docker compose logs --no-color --since "$started" app 2>/dev/null \
    | sed -n -e 's#.*\[backup\] Backed up the database to /backups/\([^ ]*\.dump\) (.*#\1#p' \
             -e 's#.*\[backup\] /backups/\([^ ]*\.dump\) already holds the database.*#\1#p' \
    | head -1
}
taken() {
  local d
  d=$(said_dump)
  [ -n "$d" ] && { printf '%s\n' "$d"; return; }
  comm -13 <(printf '%s\n' "$before") <(dumps) | sort -t- -k4,4 -k5,5 | head -1
}
# The newest migration the database has. Whether anything was migrated is
# read here, never guessed from whether a backup appeared.
schema_head() {
  docker compose exec -T postgres psql -U tracker -d tracker -qAtc 'select max(name) from schema_migration' 2>/dev/null \
    | tr -d '\r' || true
}
before=$(dumps)
head_before=$(schema_head)
if [ "$skipping" = 1 ]; then
  bold "No backup: SKIP_PRE_MIGRATION_BACKUP is set in .env"
  say "  The server won't back the database up before migrating. Have a backup of your own."
else
  bold "Backup"
  say "  If $target changes the database, the server backs it up first, to /backups in the"
  say "  db-backups volume, and doesn't start if the backup fails. Nothing to do here."
fi

# ------------------------------------------------------------ the switch
# .env rewritten whole, through a file beside it that only you can read,
# then moved over it: never half-written.
set_version() {
  local tmp
  tmp=$(umask 077; mktemp .env.update.XXXXXX)
  if grep -q '^TUFF_VERSION=' .env; then
    sed "s/^TUFF_VERSION=.*/TUFF_VERSION=$1/" .env > "$tmp"
  else
    awk -v v="$1" '{ print } /^COMPOSE_FILE=/ && !done { print ""; print "# The release that runs. scripts/update.sh moves it forward."; print "TUFF_VERSION=" v; done = 1 }
                   END { if (!done) { print ""; print "TUFF_VERSION=" v } }' .env > "$tmp"
  fi
  chmod 600 "$tmp"
  mv -f "$tmp" .env
}
set_version "$target"

rollback() {
  local why=$1 dump head_now migrated=0
  dump=$(taken)
  head_now=$(schema_head)
  [ -n "$head_now" ] && [ "$head_now" != "$head_before" ] && migrated=1
  printf '\n\033[31m%s\033[0m\n\n' "$why" >&2
  cat >&2 <<EOF
What the app said last:
  docker compose logs --tail 100 app

EOF
  if [ "$migrated" = 1 ] && [ -n "$dump" ]; then
    printf 'The database was migrated (%s → %s). The server backed it up first: /backups/%s\n' "${head_before:-?}" "$head_now" "$dump" >&2
    printf 'To go back to %s, with the database as it was before this update:\n\n' "${current:-the version you had}" >&2
  elif [ "$migrated" = 1 ]; then
    printf 'The database was migrated (%s → %s), and the server took no backup first — the log says\n' "${head_before:-?}" "$head_now" >&2
    printf 'why. Restore your own backup from before the update, then go back to %s:\n\n' "${current:-the version you had}" >&2
  else
    printf 'Nothing in the database was migrated (it is at %s, as before), so it is as it was.\n' "${head_now:-?}" >&2
    printf 'To go back to %s:\n\n' "${current:-the version you had}" >&2
  fi
  if [ "$migrated" = 1 ] && [ -n "$dump" ]; then
    printf '  scripts/restore.sh %s\n' "$dump" >&2
  else
    printf '  docker compose stop app worker\n' >&2
  fi
  if [ -n "$current" ]; then
    printf '  sed -i.bak "s/^TUFF_VERSION=.*/TUFF_VERSION=%s/" .env && rm .env.bak\n' "$current" >&2
  else
    printf '  # take the TUFF_VERSION line out of .env, add docker-compose.build.yml to COMPOSE_FILE,\n  # and check out the commit you ran before (git log)\n' >&2
  fi
  cat >&2 <<EOF
  docker compose up -d

EOF
  if [ "$migrated" = 1 ] && [ -n "$dump" ]; then
    cat >&2 <<EOF
restore.sh stops the app and the worker, keeps the database as it is now under
another name, and restores the backup as a new one, so nothing $target added
is left behind and nothing is lost if the restore fails.
EOF
  fi
  cat >&2 <<EOF
Uploaded files are not touched by an update. If you report this, include the
log above: https://github.com/$REPO/issues
EOF
  exit 1
}

bold "Starting $target"
started=$(date -u +%Y-%m-%dT%H:%M:%SZ)
docker compose up -d || rollback "docker compose couldn't start $target."

# ---------------------------------------------------------------- health
# Healthy, and saying the new version: a healthy container still running
# the old image would pass the first test alone.
#
# The app backs the database up and migrates it before it answers, and on a
# large database that outlasts any fixed wait. So past the deadline it
# keeps waiting while the app's last word since this start is that it is
# backing up or migrating, and gives up only once it isn't.
busy() {
  docker compose logs --no-color --since "$started" app 2>/dev/null \
    | grep -E '\[backup\]|\[migrate\]|migrated:|schema already current' | tail -1 \
    | grep -qE 'Backing up the database|Applying [0-9]+ migration'
}
say "Waiting for it to answer (up to ${WAIT}s, and longer while it backs up or migrates)…"
deadline=$(( $(date +%s) + WAIT ))
running='' said=0
while :; do
  id=$(docker compose ps -q app 2>/dev/null || true)
  state=$( [ -n "$id" ] && docker inspect -f '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}' "$id" 2>/dev/null || true)
  if [ "$state" = "running healthy" ]; then
    running=$(docker compose exec -T app node -e \
      "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/health').then(r=>r.json()).then(j=>console.log(j.version||'')).catch(()=>console.log(''))" \
      2>/dev/null | tr -d '\r' || true)
    [ "$running" = "$target" ] && break
  fi
  case "$state" in exited*|dead*) break ;; esac
  if [ "$(date +%s)" -ge "$deadline" ]; then
    case "$state" in running*) busy || break ;; *) break ;; esac
    if [ $(( $(date +%s) - said )) -ge 60 ]; then
      say "  Still backing up or migrating the database…"
      said=$(date +%s)
    fi
  fi
  sleep 3
done
[ "$running" = "$target" ] || rollback "Tuff $target didn't become healthy${running:+ (it says it is $running)}."

worker=$(docker compose ps --status running -q worker 2>/dev/null || true)

bold "Tuff is on $target."
dump=$(taken)
keep=$(env_value BACKUP_RETENTION_DAYS)
[[ "$keep" =~ ^[1-9][0-9]*$ ]] || keep=30
head_now=$(schema_head)
if [ -n "$dump" ]; then
  say "  Backup from before: /backups/$dump, in the db-backups volume (kept $keep days)"
elif [ -n "$head_now" ] && [ "$head_now" = "$head_before" ]; then
  say "  Nothing in the database changed, so no backup was needed."
else
  say "  The database was migrated with no backup taken first: \`docker compose logs app | grep backup\` says why."
fi
[ -n "$worker" ] || say "  The worker isn't running: check \`docker compose ps\` and \`docker compose logs worker\`."
say "  Old images can be removed with \`docker image prune\`."
