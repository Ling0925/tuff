#!/usr/bin/env bash
# Full check: permissions, isolation, types, codegen, browser.
# Brings up Postgres, the server and the web app itself; leaves them running.
set -uo pipefail
cd "$(dirname "$0")/.."

fail=0
step() { printf '\n\033[1m%s\033[0m\n' "$1"; }
ok()   { printf '  ✓ %s\n' "$1"; }
bad()  { printf '  ✗ %s\n' "$1"; fail=1; }

[ -f .env ] || { echo "no .env — copy .env.example"; exit 1; }
set -a; . ./.env; set +a

step "Postgres"
# The development database by name: a `.env` that also runs a server of
# your own says COMPOSE_FILE=docker-compose.prod.yml, and this is not that.
dev_db() { docker compose -f docker-compose.dev.yml "$@"; }
# Asked of the database `DATABASE_URL` names, not of a container: 0 when it
# answers, 2 when nothing listens there at all, 1 for anything else — a
# database not made yet, a wrong password.
db_answers() {
  (cd server && node -e '
    const sql = require("postgres")(process.env.DATABASE_URL, { max: 1, connect_timeout: 3, onnotice() {} })
    sql`select 1`.then(() => process.exit(0), (e) => process.exit(e.code === "ECONNREFUSED" ? 2 : 1))
  ') >/dev/null 2>&1
}
# Brought up only when nothing answers. A Postgres already running there is
# used as it is — the one another checkout of this repository started, with
# `.env` naming a database of this checkout's own on it. Starting the compose
# file from a second folder would be a second container under that folder's
# name, on the same port and on the same named volume as the first.
db_answers; was=$?
[ $was = 2 ] && dev_db up -d >/dev/null 2>&1
for _ in $(seq 1 40); do
  db_answers && break
  sleep 1
done
if db_answers; then
  [ $was = 2 ] && ok "up" || ok "up — the one already running"
else
  bad "did not come up — or DATABASE_URL names a database it does not have"
  exit 1
fi
pnpm --filter @tracker/server migrate >/dev/null 2>&1 && ok "migrations applied" || bad "migrations"

step "Permissions"
# The permission matrix, row by row. It is the input to the code, not a picture
# of it, so this is where the two are held against each other.
pnpm --filter @tracker/shared-schema test 2>&1 | grep -q "^ℹ fail 0" \
  && ok "the matrix, the four switches, the hard stops" || bad "permission matrix"

step "Isolation"
# Under a ceiling, because a suite that hangs is a failure and not a wait.
# Twice now a test file has passed everything and then held an open socket, so
# node never exited and this line waited forever for a result that had already
# happened. A check that can hang indefinitely is a check people stop running.
capped() { perl -e 'alarm shift @ARGV; exec @ARGV' "$@"; }
capped 600 pnpm --filter @tracker/server test 2>&1 | grep -q "^ℹ fail 0" \
  && ok "workspace, project, permissions, secrets" \
  || bad "isolation tests (or they did not finish inside 10 minutes)"

step "Lint"
# Biome, over the web app, the server and the tests: the format the code is
# written in, a hook's dependencies said in full, nothing imported or
# declared and never used. Everything else is off — `biome.jsonc` says why.
# The same pass `pnpm lint` runs; `pnpm format` writes the format.
pnpm lint >/tmp/check-lint.log 2>&1 \
  && ok "format, hook dependencies, nothing unused" \
  || bad "lint — details in /tmp/check-lint.log"

step "Build"
[ "$(pnpm typecheck 2>&1 | grep -cE 'error TS')" = 0 ] && ok "types" || bad "types"
# The web's own few, about what it writes rather than how it looks.
pnpm --filter @tracker/web test 2>&1 | grep -q "^ℹ fail 0" && ok "web: what a body is written as" || bad "web unit tests"
pnpm generate >/dev/null 2>&1
generated=(shared-schema/generated)
[ -z "$(git status --porcelain -- "${generated[@]}")" ] \
  && ok "generated/ matches the schema" \
  || bad "generated/ is stale — run pnpm generate and commit"

step "Application"
# Always restart rather than reusing whatever is listening. A stale server from
# an earlier run serves the old code, and the check would pass against it —
# a green report on code that was never run is worse than a red one.
lsof -ti:"${PORT:-8787}" | xargs kill -9 2>/dev/null
lsof -ti:5180 | xargs kill -9 2>/dev/null
sleep 1
# Detached from this shell's stdin as well as its output. A background child
# that still holds the pipe keeps `pnpm check | …` open long after the script
# itself has finished, and the run looks hung when it is done.
# Letters go to a file too, which the browser tests read to follow a link
# from an email as a person would (`letterTo` in `e2e/helpers.ts`).
rm -f /tmp/tuff-outbox.jsonl
(MAIL_OUTBOX_FILE=/tmp/tuff-outbox.jsonl pnpm --filter @tracker/server start >/dev/null 2>&1 </dev/null &)
# Built, not the dev server. The browser tests are tests of what ships, and
# the dev server is a different thing answering for it — one that compiles on
# demand and holds an HMR socket while it proxies every API call. CI failed
# twenty-three tests on requests that never came back through it.
pnpm --filter @tracker/web build >/dev/null 2>&1 || bad "web did not build"
(pnpm --filter @tracker/web preview >/dev/null 2>&1 </dev/null &)
for _ in $(seq 1 30); do curl -sf localhost:8787/health >/dev/null && break; sleep 1; done
for _ in $(seq 1 30); do curl -sf localhost:5180 >/dev/null && break; sleep 1; done
curl -sf localhost:8787/health >/dev/null && ok "server responds" || bad "server did not start"
curl -sf localhost:5180 >/dev/null && ok "web responds" || bad "web did not start"

# Twenty-four studios: the browser runs four at a time, each worker in its
# own share of them, so no two tests are ever in one studio at once.
SEED=$(SEED_STUDIOS=24 pnpm --filter @tracker/server seed 2>/dev/null)
EMAIL=$(echo "$SEED" | grep 'Sign in:' | awk '{print $3}')
[ -n "$EMAIL" ] && ok "seed: $(echo "$SEED" | grep 'Studios:' | awk '{print $2}') studios, three projects each, three people" || bad "seed"

step "Browser"
#
# The long half of this check, and the one that can be put off.
#
# Everything above takes sixteen seconds together; this takes four
# minutes, four tests at a time, and was twelve one at a time. While
# the product is being built rather than shipped, `NO_E2E=1 pnpm check` is
# the fast pass and this runs before anything goes live.
#
# Said out loud rather than quietly skipped. A check that silently does
# less than it did yesterday is how somebody reads "All green" and believes
# something that was not tested — and this is the half that has caught the
# last three faults the other half could not see: a tab order nothing
# asserted, labels dropped on create, a size of zero printed as "1 KB".
if [ -n "${NO_E2E:-}" ]; then
  printf '  \033[33m•\033[0m skipped — NO_E2E is set. The browser is where the last three faults were found.\n'
  e2e=0
else
  # Judged by the runner's own exit code, not by finding the word "passed" in
  # its output. Two checks once overlapped, each killing the other's server,
  # and a run that stopped after thirty of sixty-four tests still printed
  # "30 passed" — so the grep found what it was looking for and the check said
  # all green. A report that can be true of a run that did not finish is worse
  # than no report.
  set -o pipefail
  # Under `nice`: the browsers wait for whoever is using the machine, rather
  # than the other way round.
  E2E_EMAIL="$EMAIL" nice -n 15 npx playwright test 2>&1 | tee /tmp/check-e2e.log
  e2e=$?
  set +o pipefail
fi
if [ $e2e = 0 ]; then
  if [ -n "${NO_E2E:-}" ]; then
    :
  else
    ok "$(grep -oE '[0-9]+ passed' /tmp/check-e2e.log | tail -1): the paths a person walks"
    # A test that failed and passed on its second try is said by name, every
    # time: green with a retry is not the same green, and a test that keeps
    # needing one is a fault being hidden by the harness.
    if grep -qE '[0-9]+ flaky' /tmp/check-e2e.log; then
      printf '  \033[33m•\033[0m %s — passed only on a second try:\n' "$(grep -oE '[0-9]+ flaky' /tmp/check-e2e.log | tail -1)"
      awk '/^ +[0-9]+ flaky/{on=1;next} /^ +[0-9]+ (skipped|passed|did not run)/{on=0} on && /›/' /tmp/check-e2e.log | head -10 | sed 's/^ */      /'
    fi
  fi
else
  bad "e2e — details in /tmp/check-e2e.log"
fi

# The account to sign in with is this one, never the seeded one: the seed's
# credentials change every run and scroll off, and printing them as if they
# were durable once sent somebody to a sign-in screen for an account they
# could not find again.
step "Accounts"
# Judged by the exit code, not run and forgotten. Both of these went into a log
# nobody reads, and the day one of them started failing on every single run the
# check still printed the sign-in line and said all green — the third time in
# this file that a step was believed because it had been started. A check that
# hands out credentials for an account it did not manage to make is worse than
# one that says nothing.
pnpm --filter @tracker/server dev:account >/tmp/check-dev.log 2>&1 \
  && ok "the account to sign in with, and the studio rebuilt" \
  || bad "dev:account — details in /tmp/check-dev.log"

printf '\n'
if [ $fail = 0 ] && [ -n "${NO_E2E:-}" ]; then
  # Not "All green", because the browser did not run. Two words that mean
  # different things should not be the same two words: somebody reading
  # "All green" an hour from now will not remember which pass this was.
  printf '\033[33mGreen, without the browser.\033[0m\n'
  printf '  Run `pnpm check` with no NO_E2E before anything goes live.\n'
  printf '  Sign in: http://localhost:5180 — dev@example.com / correct-horse-battery-staple\n'
elif [ $fail = 0 ]; then
  printf '\033[32mAll green.\033[0m\n'
  printf '  Sign in: http://localhost:5180 — dev@example.com / correct-horse-battery-staple\n'
else
  printf '\033[31mThere are failures (see ✗ above).\033[0m\n'
fi
exit $fail
