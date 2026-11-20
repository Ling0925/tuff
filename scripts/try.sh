#!/usr/bin/env bash
# Tuff on this computer, at http://localhost:<port> — to try it, not to
# serve a team. Run as `scripts/setup.sh --try`.
#
#   scripts/setup.sh --try              # set up, start, open the browser
#   scripts/setup.sh --try              # again: the same install, data kept
#   scripts/setup.sh --try --fresh      # delete the try install's data first
#
#   --no-open   don't open the browser
#   --fresh     delete this folder's try install (asks you to type `delete`)
#
# It finds a free port, makes the secrets, starts Postgres, the app and the
# worker with no Caddy and no TLS, waits until the app answers, and opens
# the setup link that creates your account.
#
# It keeps to itself: `.env.try` and a compose project of its own
# (tuff-try-<six characters>), never `.env`, so a real install in this
# folder is never touched. A release's checkout pulls the release's image;
# between releases (version 0.0.0) it builds this checkout instead.
# docs/self-hosting.md, "Try it on your computer", says more.
set -euo pipefail
cd "$(dirname "$0")/.."
root=$(pwd -P)

ENV_FILE=.env.try
WAIT=${TUFF_TRY_WAIT:-300}

say()  { printf '%s\n' "$*"; }
bold() { if [ -t 1 ]; then printf '\033[1m%s\033[0m\n' "$*"; else printf '%s\n' "$*"; fi; }
die()  { printf '%s\n' "$*" >&2; exit 1; }

fresh=0 open_it=1
while [ $# -gt 0 ]; do
  case "$1" in
    --fresh)   fresh=1; shift ;;
    --no-open) open_it=0; shift ;;
    -h|--help) sed -n '2,/^set /s/^# \{0,1\}//p' "$0" | sed '$d'; exit 0 ;;
    *) die "Unknown option $1. See scripts/setup.sh --try --help." ;;
  esac
done

# ------------------------------------------------------------- what it needs
command -v docker >/dev/null 2>&1 || die "Docker is needed to run Tuff. Install Docker Desktop (or Docker Engine with Compose) and run this again."
docker compose version >/dev/null 2>&1 || die "Docker Compose isn't available (\`docker compose version\` failed). Install or update Docker and run this again."
docker info >/dev/null 2>&1 || die "Docker isn't running. Start Docker Desktop (or the Docker service) and run this again."
command -v openssl >/dev/null 2>&1 || die "openssl is needed to make the secrets. Install it and run this again."
command -v curl >/dev/null 2>&1 || die "curl is needed to see when Tuff is up. Install it and run this again."

# A link could point the secrets anywhere.
[ -L "$ENV_FILE" ] && die "$ENV_FILE is a link. Make it a plain file, or delete it, and run this again."

# A value from .env.try, read rather than sourced: sourcing would run
# whatever the file holds.
stored() { [ -f "$ENV_FILE" ] && sed -n "s/^$1=//p" "$ENV_FILE" | tail -1 || true; }

# ------------------------------------------------------------ its own project
# The folder is written into .env.try and onto the volumes, as it is.
case "$root" in
  *"'"*|*$'\n'*) die "This folder's path has a quote or a line break in it. Move Tuff to a plain path and run this again." ;;
esac

# Six characters of this folder's path, so two checkouts never share an
# install. Kept in .env.try once chosen. Only ever a name of this shape —
# never a real install's, such as tuff-try or projecttracker, whatever
# TUFF_TRY_PROJECT or a hand-edited .env.try says.
hash=$(printf %s "$root" | openssl dgst -sha256 -r | cut -c1-6)
project=$(stored COMPOSE_PROJECT_NAME)
[ -n "$project" ] || project=${TUFF_TRY_PROJECT:-tuff-try-$hash}
[[ "$project" =~ ^tuff-try-[0-9a-f]{6}$ ]] || die "\"$project\" isn't a try install's name (tuff-try- and six of 0-9a-f), so this leaves it alone."

# A project of that name started from other files is somebody else's
# install, and is not ours to start, stop or delete.
theirs=$(docker compose ls -a 2>/dev/null | awk -v n="$project" '$1 == n' || true)
if [ -n "$theirs" ] && [[ "$theirs" != *"$root/docker-compose.try.yml"* ]]; then
  die "A Docker Compose project called $project already exists, started from other files:
  $theirs
It isn't this folder's try install, so this leaves it alone."
fi

# Everything the compose file asks for, given only as placeholders: enough
# for `down`, which reads no value.
placeholders() {
  env POSTGRES_PASSWORD=x APP_DB_PASSWORD=x WORKER_DB_PASSWORD=x JWT_SECRET=x APP_URL=http://localhost TRY_PORT=1024 TRY_ROOT="$root" TUFF_TRY_IMAGE="tuff:try-$hash" "$@"
}
# The project's volumes, and those of them this folder's try install made:
# docker-compose.try.yml labels each with the folder (tuff.try.root).
volumes() { docker volume ls -q --filter "label=com.docker.compose.project=$project" | sort | tr '\n' ' ' | sed 's/ *$//'; }
ours() { docker volume ls -q --filter "label=com.docker.compose.project=$project" --filter "label=tuff.try.root=$root" | sort | tr '\n' ' ' | sed 's/ *$//'; }

# ---------------------------------------------------------------- start fresh
if [ "$fresh" = 1 ]; then
  have=$(volumes)
  if [ -z "$have" ] && [ ! -f "$ENV_FILE" ]; then
    say "There is no try install in this folder to delete. Setting one up."
  else
    # Only what .env.try names, and only volumes this folder made.
    [ -f "$ENV_FILE" ] || die "Docker has volumes for $project ($have), but there is no $ENV_FILE here
naming them, so --fresh deletes nothing. If they are this folder's old try
install and you want them gone, delete them yourself:
  docker volume rm $have"
    mine=$(ours)
    [ "$have" = "$mine" ] || die "Not every volume of $project was made by this folder's try install
(all: ${have:-none}; this folder's: ${mine:-none}), so --fresh deletes nothing."
    bold "Start fresh: this deletes the try install in this folder."
    say
    say "  Docker project  $project (its containers)"
    say "  Volumes         ${have:-none} — the database and the uploaded files:"
    say "                  every account, project, task, message and file in it"
    [ -f "$ENV_FILE" ] && say "  $ENV_FILE        its passwords and its setup link"
    say
    say "A real install in this folder (.env and its volumes) is not touched."
    printf 'Type delete to delete them: '
    answer=''
    read -r answer || true
    [ "$answer" = delete ] || die "Nothing was deleted."
    placeholders docker compose -p "$project" -f "$root/docker-compose.try.yml" --env-file /dev/null down --remove-orphans
    # By name, each one carrying this folder's label: never `down -v`.
    [ -z "$mine" ] || docker volume rm $mine >/dev/null
    rm -f "$ENV_FILE"
    say "Deleted. Setting up a new one."
    say
  fi
fi

# Data with no .env.try is a database whose password is gone.
if [ ! -f "$ENV_FILE" ] && [ -n "$(volumes)" ]; then
  die "Docker has data for $project ($(volumes)), but $ENV_FILE, which held its database
password, is gone, so that data can't be opened. If it is this folder's old try install,
delete it yourself and run this again:
  docker volume rm $(volumes)"
fi

# ------------------------------------------------------------------- the port
# Free when nothing answers on 127.0.0.1 or ::1. Connecting, not binding:
# on macOS a bind to 127.0.0.1 succeeds beside a server on [::1], and a
# browser opening localhost would reach that one.
answers() {
  local host
  for host in 127.0.0.1 ::1; do
    (exec 3<>"/dev/tcp/$host/$1") 2>/dev/null && return 0
  done
  return 1
}
running() { [ -n "$(placeholders docker compose -p "$project" -f "$root/docker-compose.try.yml" --env-file /dev/null ps -q --status running app 2>/dev/null)" ]; }

port=$(stored TRY_PORT)
if [ -n "$port" ] && { ! [[ "$port" =~ ^[0-9]{4,5}$ ]] || [ "$port" -lt 1024 ] || [ "$port" -gt 65535 ]; }; then
  say "TRY_PORT in $ENV_FILE isn't a port from 1024 to 65535. Finding one."
  port=''
fi
if [ -n "$port" ] && answers "$port" && ! running; then
  say "Port $port, which this install used before, is taken now. Finding another."
  port=''
fi
if [ -z "$port" ]; then
  # Not the ports a development checkout of Tuff uses (8787, 5180, 5455).
  for p in $(seq 8080 8180); do
    case "$p" in 8787|5180|5455) continue ;; esac
    answers "$p" || { port=$p; break; }
  done
  [ -n "$port" ] || die "No free port between 8080 and 8180. Stop something that listens there and run this again."
fi

# ------------------------------------------------------------- the image
version=$(sed -n "s/^export const VERSION = '\([0-9.]*\)'.*/\1/p" server/src/version.ts)
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "Can't read the version from server/src/version.ts."
sha=$(git rev-parse --short HEAD 2>/dev/null || echo unknown)

# An image of this checkout's own: another folder's try install, or a
# real install's tuff:source, is never replaced.
image="tuff:try-$hash" pull=build
if [ "${TUFF_BUILD:-}" = 1 ]; then
  bold "Building Tuff from source, a few minutes the first time."
elif [ "$version" = 0.0.0 ]; then
  bold "Building Tuff from source, a few minutes the first time."
  say "This checkout is between releases (version 0.0.0), so there is no image to download."
else
  image="${TUFF_IMAGE:-ghcr.io/usetuff/tuff}:$version" pull=missing
fi

# --------------------------------------------------------------- .env.try
secret() { openssl rand -hex "$1"; }
keep() { local v; v=$(stored "$1"); [ -n "$v" ] && printf %s "$v" || secret "$2"; }
first=0
[ -f "$ENV_FILE" ] || first=1

write_env() {
  local tmp
  tmp=$(mktemp "$ENV_FILE.XXXXXX")
  cat > "$tmp" <<EOF
# Tuff on this computer — written by scripts/setup.sh --try. Not for a
# server: docs/self-hosting.md is how to run one. Keep this file while you
# keep the install: the passwords below are the ones its database was made
# with. scripts/setup.sh --try --fresh deletes both.

# This install's own compose project, apart from any other in this folder.
# Name it on every command: an exported COMPOSE_PROJECT_NAME wins over this.
#   docker compose -p $project -f docker-compose.try.yml --env-file $ENV_FILE <command>
COMPOSE_PROJECT_NAME=$project
COMPOSE_FILE=docker-compose.try.yml
# Written on the volumes, so --fresh deletes only this folder's.
TRY_ROOT='$root'

TUFF_TRY_IMAGE=$image
TUFF_TRY_PULL=$pull

TRY_PORT=$port
APP_URL=http://localhost:$port

# The setup link's token: http://localhost:$port/setup?token=<this>.
SETUP_TOKEN=$setup_token

POSTGRES_PASSWORD=$postgres_password
APP_DB_PASSWORD=$app_db_password
WORKER_DB_PASSWORD=$worker_db_password
JWT_SECRET=$jwt_secret
ENCRYPTION_KEY=$encryption_key
EOF
  mv -f "$tmp" "$ENV_FILE"
}

umask 077
setup_token=$(keep SETUP_TOKEN 32)
postgres_password=$(keep POSTGRES_PASSWORD 24)
app_db_password=$(keep APP_DB_PASSWORD 24)
worker_db_password=$(keep WORKER_DB_PASSWORD 24)
jwt_secret=$(keep JWT_SECRET 32)
encryption_key=$(keep ENCRYPTION_KEY 32)

# Only what .env.try says: a variable of the same name in this shell would
# win over it, and the passwords must be the database's.
dc() {
  env -u POSTGRES_PASSWORD -u APP_DB_PASSWORD -u WORKER_DB_PASSWORD -u JWT_SECRET -u ENCRYPTION_KEY \
    -u APP_URL -u SETUP_TOKEN -u TRY_PORT -u TRY_ROOT -u COMPOSE_FILE -u COMPOSE_PROJECT_NAME -u COMPOSE_PROFILES \
    TUFF_TRY_IMAGE="$image" TUFF_TRY_PULL="$pull" GIT_SHA="$sha" \
    docker compose --env-file "$ENV_FILE" -p "$project" -f "$root/docker-compose.try.yml" "$@"
}

# Said with every name, as somebody should type it: a COMPOSE_PROJECT_NAME
# exported in their shell would otherwise point it at another project.
compose="docker compose -p $project -f docker-compose.try.yml --env-file $ENV_FILE"

write_env
if [ "$pull" = missing ]; then
  bold "Downloading Tuff $version."
  if ! dc pull --quiet app worker; then
    say
    bold "There is no image of Tuff $version to download, so building it from source instead, a few minutes the first time."
    image="tuff:try-$hash" pull=build
    write_env
  fi
fi

# ------------------------------------------------------------------ start
if [ "$first" = 1 ]; then
  say "Starting Tuff at http://localhost:$port."
else
  say "Starting this folder's try install again, with its data, at http://localhost:$port."
fi
if [ "$pull" = build ]; then dc up -d --build; else dc up -d; fi

waited=0
until curl -fsS -o /dev/null "http://127.0.0.1:$port/health" 2>/dev/null; do
  if [ "$waited" -ge "$WAIT" ]; then
    die "Tuff didn't answer at http://localhost:$port within $WAIT seconds. What it said:
  $compose logs app"
  fi
  sleep 2
  waited=$((waited + 2))
done

# --------------------------------------------------------------- the link
url="http://localhost:$port"
status=$(curl -s -o /dev/null -w '%{http_code}' -H "x-setup-token: $setup_token" "http://127.0.0.1:$port/auth/setup" || true)
say
if [ "$status" = 200 ]; then
  bold "Tuff is running. Open this link to create your account:"
  say
  say "  $url/setup?token=$setup_token"
  open_at="$url/setup?token=$setup_token"
else
  bold "Tuff is running at $url"
  open_at=$url
fi
say
say "It runs on this computer only, over plain http. To run Tuff for a team,"
say "set up a server: docs/self-hosting.md."
say
say "Stop it:        $compose stop"
say "Start it again: scripts/setup.sh --try   (your data is kept)"
say "Start fresh:    scripts/setup.sh --try --fresh"

if [ "$open_it" = 1 ] && [ -t 1 ]; then
  case "$(uname -s)" in
    Darwin) open "$open_at" >/dev/null 2>&1 || true ;;
    Linux)  if command -v xdg-open >/dev/null 2>&1; then xdg-open "$open_at" >/dev/null 2>&1 & fi ;;
  esac
fi
