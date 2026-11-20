#!/usr/bin/env bash
# Writes the `.env` that `docker compose up` reads — once.
#
#   scripts/setup.sh tuff.example.com you@example.com
#   scripts/setup.sh                     # asks; localhost if nobody answers
#
# The address is the owner's (OWNER_EMAIL): until somebody owns the server,
# only that address can become its owner. Left blank, any address can —
# through the setup link.
#
# The setup link (SETUP_TOKEN) is printed at the end: it opens the screen
# that sets up email and creates the owner's account, and stops working
# the moment the server has an owner. The server's name is public within
# minutes of its certificate, so the link, not the first visitor, decides
# who owns it.
#
# Every other secret is random, from `openssl rand`, and never printed. It
# refuses to touch a `.env` that is already there: the database passwords
# in it are the ones the database was made with, and writing new ones would
# lock the app out of its own data.
#
# HTTP_PORT and HTTPS_PORT, set when this runs, are written too — for a
# machine where 80 and 443 are taken.
#
# The release it sets up is this checkout's: check out a release's tag
# first (`git checkout v1.2.3`). On `main`, between releases, there is no
# image to pull, and TUFF_BUILD=1 sets the server up to build this checkout
# instead (docker-compose.build.yml).
set -euo pipefail
cd "$(dirname "$0")/.."

# A link too, even one that points nowhere: writing through it would put
# the secrets wherever it points.
if [ -e .env ] || [ -L .env ]; then
  echo ".env is already here, so nothing was written."
  echo "It holds the passwords your database was made with. To start again from"
  echo "nothing, stop Tuff, delete the data (docker compose down -v) and .env, and run this again."
  exit 1
fi
command -v openssl >/dev/null 2>&1 || { echo "openssl is needed to make the secrets. Install it and run this again."; exit 1; }

# Compose 2.24 is the first that reads an env_file marked `required: false`,
# which docker-compose.prod.yml uses; an older one fails on it with a
# message about the file rather than the version.
command -v docker >/dev/null 2>&1 || { echo "Docker is needed to run Tuff. Install Docker with Compose 2.24 or newer and run this again."; exit 1; }
compose=$(docker compose version --short 2>/dev/null | sed 's/^v//') || compose=''
case "$compose" in
  [0-9]*.[0-9]*) ;;
  *) echo "Docker Compose isn't available (\`docker compose version\` said nothing). Tuff needs Compose 2.24 or newer."; exit 1 ;;
esac
compose_major=${compose%%.*}
compose_minor=${compose#*.}
compose_minor=${compose_minor%%.*}
if [ "$compose_major" -lt 2 ] || { [ "$compose_major" -eq 2 ] && [ "$compose_minor" -lt 24 ]; }; then
  echo "Docker Compose $compose is too old: Tuff needs 2.24 or newer. Update Docker and run this again."
  exit 1
fi

domain=${1:-}
if [ -z "$domain" ] && [ -t 0 ]; then
  printf 'The domain Tuff will answer at (blank for localhost): '
  read -r domain
fi
domain=${domain:-localhost}
case "$domain" in
  *[!A-Za-z0-9.-]*|.*|*.) echo "\"$domain\" is not a domain name. Give it as tuff.example.com, without https://."; exit 1 ;;
esac

owner_email=${2:-${OWNER_EMAIL:-}}
if [ -z "$owner_email" ] && [ -t 0 ]; then
  printf 'Your email, as the owner of this server (blank to choose it on the setup screen): '
  read -r owner_email
fi
# The check sign-up makes (zod's email, `Register` in server/src/http/routes.ts):
# an address it would refuse is an owner who can never sign up.
email_shape="^([A-Za-z0-9_'+-]+\.)*[A-Za-z0-9_'+-]*[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9-]*\.)+[A-Za-z]{2,}$"
if [ -n "$owner_email" ] && ! [[ "$owner_email" =~ $email_shape ]]; then
  echo "\"$owner_email\" is not an email address. Give it as you@example.com, or leave it blank."
  exit 1
fi

http_port=${HTTP_PORT:-80}
https_port=${HTTPS_PORT:-443}
for port in "$http_port" "$https_port"; do
  case "$port" in
    ''|*[!0-9]*|0*) ok=0 ;;
    *) [ ${#port} -le 5 ] && [ "$port" -le 65535 ] && ok=1 || ok=0 ;;
  esac
  [ "$ok" = 1 ] || { echo "\"$port\" is not a port. HTTP_PORT and HTTPS_PORT are numbers from 1 to 65535."; exit 1; }
done
app_url=https://$domain
[ "$https_port" = 443 ] || app_url=$app_url:$https_port

# The release to run: this checkout's own (server/src/version.ts), so the
# image matches the compose file and scripts beside it. TUFF_VERSION, set
# when this runs, picks another.
version=${TUFF_VERSION:-$(sed -n "s/^export const VERSION = '\([0-9.]*\)'.*/\1/p" server/src/version.ts)}
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "\"$version\" is not a version. Give TUFF_VERSION as 1.2.0."; exit 1; }

# 0.0.0 is what the source says between releases: no image is ever built
# for it, so `docker compose up` would fail pulling one. A release's tag
# says its own version; building this checkout is the other way to run it.
compose_file=docker-compose.prod.yml
build=0
if [ "${TUFF_BUILD:-}" = 1 ]; then
  build=1
  compose_file=docker-compose.prod.yml:docker-compose.build.yml
elif [ "$version" = 0.0.0 ]; then
  echo "This checkout is not a release (server/src/version.ts says 0.0.0), so there is no image to pull."
  echo
  echo "Check out a release and run this again:"
  echo "  git fetch --tags && git tag --sort=-v:refname | head -3"
  echo "  git checkout v1.2.3"
  echo
  echo "Or build this checkout yourself (docker-compose.build.yml): run this again as"
  echo "  TUFF_BUILD=1 scripts/setup.sh $*"
  echo "and start it with: docker compose up -d --build"
  exit 1
fi

secret() { openssl rand -hex "$1"; }
setup_token=$(secret 32)

umask 077
# Never over a file that appeared since the check above.
set -o noclobber
cat > .env <<EOF
# Written by scripts/setup.sh on $(date -u +%Y-%m-%d). Every setting is in
# docs/self-hosting.md. Keep this file: the passwords below are the ones
# the database was made with.

# Which compose file \`docker compose\` reads here.
COMPOSE_FILE=$compose_file

# The release that runs. scripts/update.sh moves it forward.
TUFF_VERSION=$version

# Where Tuff answers. Caddy gets a certificate for it by itself.
DOMAIN=$domain
APP_URL=$app_url
HTTP_PORT=$http_port
HTTPS_PORT=$https_port

# This server's owner. Until somebody owns it, only this address can become
# the owner, on the setup screen or by signing up. Empty: any address, on
# the setup screen.
OWNER_EMAIL="$owner_email"

# The setup link's token: https://<domain>/setup?token=<this>. It works
# until the server has an owner, and never again. The app prints the link
# in its log on every start until then.
SETUP_TOKEN=$setup_token

# Secrets. Never share them; changing JWT_SECRET signs everybody out.
# ENCRYPTION_KEY opens second factors and GitHub and Slack links: see
# "Rotating the secrets" in docs/self-hosting.md before changing it.
POSTGRES_PASSWORD=$(secret 24)
APP_DB_PASSWORD=$(secret 24)
WORKER_DB_PASSWORD=$(secret 24)
JWT_SECRET=$(secret 32)
ENCRYPTION_KEY=$(secret 32)

# Mail. Set it up on the setup screen or later in Server settings; or here,
# and then it is read-only there. See "Mail" in README.md.
# SMTP_URL=smtps://user:password@smtp.example.com:465
# MAIL_FROM=Tuff <tuff@example.com>
EOF

echo "Wrote .env for $app_url."
echo
echo "Next:"
if [ "$build" = 1 ]; then
  echo "  docker compose up -d --build    # the first build takes a few minutes"
else
  echo "  docker compose up -d"
fi
echo
echo "Then open this link to set up email and create your account${owner_email:+ (as $owner_email)}:"
echo
echo "  $app_url/setup?token=$setup_token"
echo
echo "Keep it to yourself: whoever opens it first becomes the owner. It stops"
echo "working once you have an account. The app prints it in its log until then."
