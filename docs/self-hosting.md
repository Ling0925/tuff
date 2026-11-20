# Running Tuff on your own server

The README has the short version. This is everything else: each setting,
versions and updates, building from source, checking the image's
signature, running behind a proxy of your own, the owner from the command
line, push notifications, and signing in with other accounts.

## Try it on your computer

```bash
scripts/setup.sh --try
```

This is Tuff for one computer, to see what it is before you set up a
server. It needs Docker, `openssl` and `curl`, and:

1. finds a free port from 8080 up — one where nothing answers on
   `127.0.0.1` or `::1`;
2. makes the passwords and a setup token, in `.env.try`;
3. downloads the release's image, or builds this checkout when there is
   none (between releases, version `0.0.0`), and says which first;
4. starts Postgres, the app and the worker from `docker-compose.try.yml`,
   with no Caddy and no TLS, the app published on `127.0.0.1` only;
5. waits until `/health` answers, prints the setup link
   (`http://localhost:<port>/setup?token=…`) and opens your browser on it.
   `--no-open` leaves the browser alone.

| | |
| --- | --- |
| Run it again | `scripts/setup.sh --try` starts the same install, with its data and its port. |
| Stop it | `docker compose -p tuff-try-<six> -f docker-compose.try.yml --env-file .env.try stop`, with the name the script prints (it prints the whole line). |
| Start fresh | `scripts/setup.sh --try --fresh` lists what it would delete — the database, the uploaded files and `.env.try` — and deletes them only when you type `delete`. It deletes only volumes labelled with this folder, and nothing when there is no `.env.try` naming them. |

**It keeps to itself.** It reads and writes `.env.try`, never `.env`, and
runs as a compose project of its own, `tuff-try-` and six characters of
the folder's path, with its own volumes and its own image
(`tuff:try-` and the same six). A real install in the same folder is never
touched. Name the project on every `docker compose` command for it
(`-p`), as the script does: a `COMPOSE_PROJECT_NAME` set in your shell
would otherwise win.

**It is not a server.** It runs over plain http with `TRY_LOCALHOST=1`,
which lets the browser keep its cookies on `http://localhost` (Safari
refuses secure cookies there). The app refuses to start with that setting
unless `APP_URL` is `http://localhost:<port>` or `http://127.0.0.1:<port>`,
and answers only requests addressed to `localhost` or `127.0.0.1` that no
proxy or tunnel says it forwarded. Mail can
be set up on the setup screen as on a server; signing in with Google, Apple
or GitHub needs a server's address and HTTPS. To run Tuff for a team, set
up a server as below.

## What runs

`docker compose up -d` starts four containers from `docker-compose.prod.yml`:

| Service    | What it does |
| ---------- | ------------ |
| `postgres` | The database, on the `pgdata-prod` volume. Not published on any port. |
| `app`      | The API and the web app, on port 8787 inside the network. Migrates the database when it starts, after backing it up to the `db-backups` volume ([Backups](#backups)). Runs `ghcr.io/usetuff/tuff:$TUFF_VERSION`. |
| `worker`   | The same image, running the background work: mail, digests, webhooks, push, and the clear-out that really deletes what was deleted. |
| `caddy`    | HTTPS, and the only thing reachable from outside. |

Files people attach go to the `uploads` volume unless you set up a bucket.

### Three database roles

The database has three roles, and each process uses the narrowest one:

- `tracker` owns the tables and runs the migrations. It skips row-level
  security, so it never answers a request. The app uses it to migrate and
  for its start-up step, and the owner command and `reseal` use it.
- `tracker_app` answers every request, and holds the connection that
  listens for live updates (`LISTEN`). Row-level security applies to it:
  one workspace cannot read another's rows, even through a bug in a query.
- `tracker_worker` alone may call the worker's own functions.

The database functions that run as the owner can be run only by the role
each is granted to. The purges, which delete whole workspaces, are the
owner's alone.

The migrations create `tracker_app` and `tracker_worker` with no password.
Each time the app starts it gives them the passwords from `APP_DB_PASSWORD`
and `WORKER_DB_PASSWORD`. To change one, change it in `.env` and run
`docker compose up -d`.

The app and the worker check this when they start. If the role they query
as is a superuser, has `BYPASSRLS`, or owns the tables, they refuse to
start and the log says why: something has overridden `DATABASE_URL_APP`,
and with it every workspace could read every other. Fix the URL and run
`docker compose up -d`.

## Settings

All settings live in `.env`, next to `docker-compose.prod.yml`. Every line
in it reaches the app and the worker. After a change, run
`docker compose up -d`.

### Required

`scripts/setup.sh` writes all of these.

| Variable | Meaning |
| -------- | ------- |
| `COMPOSE_FILE` | `docker-compose.prod.yml`, so that a plain `docker compose` uses it. Add `:docker-compose.build.yml` to build from source (below). |
| `TUFF_VERSION` | The release that runs, like `1.0.0`. `setup.sh` writes this checkout's version; `scripts/update.sh` changes it. |
| `DOMAIN` | The name Caddy serves and gets a certificate for, like `tuff.example.com`. `localhost` gets a certificate of Caddy's own; to try Tuff on your computer, [`setup.sh --try`](#try-it-on-your-computer) is simpler. |
| `APP_URL` | **Required.** The address people open, like `https://tuff.example.com`; the server refuses to start without it. Links in emails — a password reset among them — are made from it and never from the request's `Host`, which whoever sends the request writes. Links in emails and the sign-in providers' redirects use it, and so do what has no request to read an address from: Slack's messages (Slack stays off without it) and the link previewer, which tells the sites it reads `TuffBot/1.0 (+APP_URL)`. Include the port if it is not 443. |
| `POSTGRES_PASSWORD` | Password of `tracker`, the database owner. |
| `APP_DB_PASSWORD` | Password of `tracker_app`. |
| `WORKER_DB_PASSWORD` | Password of `tracker_worker`. |
| `JWT_SECRET` | Signs sessions. Changing it signs everybody out. |
| `ENCRYPTION_KEY` | Encrypts what the server keeps to read back: second-factor secrets, GitHub and Slack tokens, an import's API key, the mail password or key saved in Server settings. At least 32 characters (`openssl rand -hex 32`). `setup.sh` writes it for a new server; without it they are encrypted with a key derived from `JWT_SECRET`, as before. See [Rotating the secrets](#rotating-the-secrets). |
| `SETUP_TOKEN` | The setup link's one-time token: `APP_URL/setup?token=…` opens the screen that sets up email and creates the owner's account. `setup.sh` writes it and prints the link; the app prints it in its log on every start until the server has an owner. It stops working the moment there is one. At least 32 letters and digits; anything shorter refuses to start. See [The first opening](#the-first-opening). |
| `OWNER_EMAIL` | Your email, as the server's owner. Until somebody owns the server, only this address can become the owner, on the setup screen or by signing up and confirming it. Left empty, any address can, through the setup link. **Left empty with no `SETUP_TOKEN` either, the first person to sign up and confirm an address owns the server.** It means nothing once the server has an owner. |

The three passwords must be letters and digits only, because they are put
into connection URLs as they are. `openssl rand -hex 24` makes a good one.
`POSTGRES_PASSWORD` is fixed once the database exists: Postgres reads it
only the first time, when the volume is empty.

### Ports

| Variable | Default | Meaning |
| -------- | ------- | ------- |
| `HTTP_PORT` | `80` | Host port for plain HTTP, which Caddy redirects to HTTPS and uses to get its certificate. |
| `HTTPS_PORT` | `443` | Host port for HTTPS. |

Let's Encrypt needs ports 80 and 443 on the public address. Use other ports
only with `localhost`, or behind a proxy of your own (below).

### Mail

Mail is set up on the setup screen or in **Server settings → Email**:
SMTP (server, port — 465, 587, 25 or 2525 — TLS, STARTTLS or none, user
and password) or a Resend API key, and the address mail comes from. The
password or key is stored encrypted with `ENCRYPTION_KEY` and never shown
again: the screen says only that one is saved, and keeps it while the
server and user stay the same. The app and the worker both send with what
is saved, the worker within thirty seconds of a change.

A mail server saved there must be at a **public address**. Tuff looks the
name up when it is saved and again for every email, refuses it if any of
its addresses is private, loopback, link-local, carrier-grade NAT
(100.64.0.0/10) or an IPv6 unique local address, and connects to the
address it checked. A relay of your own on a private network — a
`postfix` container on the compose network, a mail server on your LAN —
needs `SMTP_ALLOW_PRIVATE=1` in `.env`; plain SMTP ("none") is then allowed
to it, with no user. Link-local and cloud metadata addresses are refused
even then. `SMTP_URL` in `.env` is not checked this way: it is the
machine's own setting.

The variables below do the same from `.env`. **Set there, they win**:
Server settings shows them as set by the server's environment and cannot
change them.

| Variable | Default | Meaning |
| -------- | ------- | ------- |
| `SMTP_URL` | none | Your SMTP server: `smtps://user:password@host:465` for TLS, or `smtp://user:password@host:587` for STARTTLS, which is then required. Percent-encode `@`, `:` and `/` in the user and password. Nothing after the port. |
| `MAIL_FROM` | none | Who emails are from: `tuff@example.com` or `Tuff <tuff@example.com>`. Required whenever mail is set up, with `SMTP_URL` or `RESEND_API_KEY`: without it the app and the worker refuse to start. There is no default sender. |
| `RESEND_API_KEY` | none | Send through [Resend](https://resend.com) instead. Used only when `SMTP_URL` is not set. |
| `SMTP_ALLOW_PRIVATE` | off | `1` lets a mail server saved in Server settings be at a private address — a relay of your own, like a `postfix` container. Never link-local or a cloud's metadata address. |

A password is never sent in the clear: `smtp://` with a password must
upgrade with STARTTLS, or the email is not sent. A relay on the same
network with no password, like a `postfix` container, may be plain.

With no mail, emails are not sent and their links are not logged, and the
screens say so rather than "check your email": sign-up and "Forgot your
password?" say this server can't send email and to ask its owner. The
owner is made on the setup screen (below), with no email. Inviting still
works: an
invitation to an email address shows its link to whoever invited them, to
send on themselves. The link works once, only with that address, and
expires in a week; following it confirms the address. A forgotten password
cannot be reset without mail. Server settings has a button that sends a
test email.

Where an email or a screen would send somebody for help — to bring back a
deleted workspace, or about an email or password change they did not
make — it tells them to ask the owner of this server, not usetuff.com.

### Files

| Variable | Default | Meaning |
| -------- | ------- | ------- |
| `STORAGE_S3_ENDPOINT` | none | An S3-compatible endpoint, like `https://s3.eu-west-1.amazonaws.com` or a MinIO or R2 address. |
| `STORAGE_S3_BUCKET` | none | The bucket. |
| `STORAGE_S3_KEY` | none | Access key. |
| `STORAGE_S3_SECRET` | none | Secret key. |
| `STORAGE_S3_REGION` | `auto` | The bucket's region. |

Set all four of the first ones or none. Without them files go to the
`uploads` volume. Moving from the volume to a bucket does not copy the files
that are already there.

### Push notifications

| Variable | Default | Meaning |
| -------- | ------- | ------- |
| `VAPID_PUBLIC_KEY` | none | The public half of the server's push key. |
| `VAPID_PRIVATE_KEY` | none | The private half. |
| `VAPID_SUBJECT` | none | How a push service can reach you: `mailto:you@example.com`. Required with the keys: without it push stays off, and the app's log says so. |

Without them, the app runs and its notification settings say push is not
set up. Make the pair once:

```bash
docker compose exec app node -e "const c=require('crypto');const k=c.generateKeyPairSync('ec',{namedCurve:'prime256v1'});const p=k.publicKey.export({format:'jwk'});console.log('VAPID_PUBLIC_KEY='+Buffer.concat([Buffer.from([4]),Buffer.from(p.x,'base64url'),Buffer.from(p.y,'base64url')]).toString('base64url'));console.log('VAPID_PRIVATE_KEY='+k.privateKey.export({format:'jwk'}).d)"
```

Add both lines and `VAPID_SUBJECT` to `.env`, then `docker compose up -d`.
**Keep the pair.** A new one ends every subscription anybody has made, and
people have to turn notifications on again.

Push reaches browsers and the installed web app. The iPhone and Android
apps talk only to usetuff.com, so they get nothing from your server, and
your server does not claim its links for them: `/.well-known/apple-app-site-association`
is served only when `APPLE_APP_ID` names an app of your own
(`TEAMID.com.example.app`), and `/.well-known/assetlinks.json` names an
Android app only when `ANDROID_PACKAGE` and `ANDROID_CERT_SHA256` both say
which.

### Signing in with Google, Apple or GitHub

Each one is off until both of its values are set. Then its button appears
on the sign-in screen.

| Variable | Meaning |
| -------- | ------- |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | An OAuth client of type "Web application" in Google Cloud. Redirect URI: `APP_URL/auth/oauth/google/callback`. |
| `APPLE_CLIENT_ID` | A Services ID in Apple Developer, with Sign in with Apple on. Return URL: `APP_URL/auth/oauth/apple/callback`. |
| `APPLE_TEAM_ID`, `APPLE_KEY_ID` | Your team, and the id of a Sign in with Apple key. |
| `APPLE_PRIVATE_KEY` | That key's `.p8` file, with `\n` for its line breaks. |
| `GITHUB_SIGNIN_CLIENT_ID`, `GITHUB_SIGNIN_CLIENT_SECRET` | A GitHub OAuth App. Callback URL: `APP_URL/auth/oauth/github/callback`. |

On your own server a provider never makes the first account: until
somebody owns the server, a new account through Google, Apple or GitHub is
refused, and the owner signs up with email (see "The owner from the command
line"). After that, somebody new can sign in with a provider only when they
have an invitation, or when an owner has turned sign-up on.

### GitHub and Slack in projects

A project can link a GitHub repository or post to Slack, through apps you
make yourself. Without them, Settings says they are not set up here.

| Variable | Meaning |
| -------- | ------- |
| `GITHUB_APP_ID`, `GITHUB_APP_SLUG` | A GitHub App of your own, and the slug in its address. |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | The App's client id and secret. Callback URL: `APP_URL/auth/github/callback`. Setup URL: `APP_URL/auth/github/installed`. |
| `GITHUB_PRIVATE_KEY` | The App's private key, with `\n` for its line breaks. |
| `GITHUB_WEBHOOK_SECRET` | The App's webhook secret. Webhook URL: `APP_URL/hooks/github`. |
| `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET` | A Slack app of your own. Redirect URL: `APP_URL/auth/slack/callback`. |
| `SLACK_SIGNING_SECRET` | Its signing secret. Event requests URL: `APP_URL/hooks/slack`. |

### Everything else

| Variable | Default | Meaning |
| -------- | ------- | ------- |
| `PURGE_AFTER_DAYS` | `30` | How long a deleted thing can be restored before the worker removes it for good. At least 1; empty or not a number is the default. |
| `PG_POOL_MAX` | `20` | Database connections each process keeps. |
| `KLIPY_API_KEY` | none | A [KLIPY](https://klipy.com) key, for the GIF button in chat. |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | none | Cloudflare Turnstile keys. A project's public feedback page refuses every message without them. |
| `ORIGIN_SECRET` | none | Only if Cloudflare is in front: see the proxy notes below. |
| `TUFF_IMAGE` | `ghcr.io/usetuff/tuff` | Where the image is pulled from, for a registry of your own that mirrors it. |
| `TRY_LOCALHOST` | off | Only for [trying Tuff on your computer](#try-it-on-your-computer), which sets it. Never on a server: with any `APP_URL` but `http://localhost` or `http://127.0.0.1` the app refuses to start. |
| `UPDATE_CHECK` | on | `off` stops the daily request for the latest release — see [Hearing of a new version](#hearing-of-a-new-version). |
| `BACKUP_RETENTION_DAYS` | `30` | How long the backups taken before migrating are kept. At least 1; empty or not a number is the default. See [Backups](#backups). |
| `SKIP_PRE_MIGRATION_BACKUP` | off | `1` migrates without backing up first. Only if you have backups of your own. |

The compose file sets `DATABASE_URL`, `DATABASE_URL_APP`,
`DATABASE_URL_WORKER`, `NODE_ENV`, `STORAGE_DIR`, `WEB_DIR`,
`MIGRATE_ON_START`, `BACKUP_DIR` and `PORT` itself, and a line in `.env`
with one of those names is ignored.

## Behind a proxy of your own

If the machine already runs nginx, Traefik or another proxy, you can drop
Caddy:

1. Delete the `caddy` service from `docker-compose.prod.yml` (or copy the
   file and point `COMPOSE_FILE` at the copy).
2. Publish the app to the machine only, under `app:`

   ```yaml
   ports: ['127.0.0.1:8787:8787']
   ```

3. Proxy your domain to `http://127.0.0.1:8787`, with websockets
   (`Upgrade` and `Connection` headers) and a body limit of at least 100 MB
   for uploads.

Never publish port 8787 to the internet without a proxy.

**How Tuff finds a person's IP.** Sign-in attempts, sign-ups and the API
are limited per IP. Tuff reads the IP from `X-Forwarded-For`, and takes the
**second-to-last** entry when there are two or more, or the only entry when
there is one. That is right when the one proxy in front of Tuff **replaces**
the header with the address that connected to it. It is wrong when the
proxy **appends** to whatever the request already carried: then a client
that sends its own `X-Forwarded-For: anything` chooses the address Tuff
sees, and gets a fresh allowance on every request.

- **Caddy**, as shipped, replaces the header. Nothing to do.
- **nginx**: use

  ```nginx
  proxy_set_header X-Forwarded-For $remote_addr;
  ```

  and **not** `$proxy_add_x_forwarded_for`, which appends.
- **Traefik** replaces the header by default, for requests from addresses
  it does not trust. Do not set `forwardedHeaders.insecure`, and do not put
  addresses the internet can reach in `forwardedHeaders.trustedIPs`.
- **Two proxies** (a load balancer, then nginx): the inner one should append
  exactly once, so the header reaches Tuff as `client, load-balancer`, and
  the outer one should replace.
- **No `X-Forwarded-For` at all**, as when port 8787 is open directly: every
  request looks like one person, and the limits are shared by everybody.

**Cloudflare in front.** Tuff takes the person's IP from `CF-Connecting-IP`
in two cases:

- the address it read from `X-Forwarded-For` (as above) is in Cloudflare's
  published ranges — so your own proxy must pass Cloudflare's address
  through as described, not a header the client wrote;
- or the request carries `X-Origin-Secret` equal to `ORIGIN_SECRET`. Add a
  request header rule in Cloudflare that sets it to a long random value,
  and put the same value in `ORIGIN_SECRET`.

Otherwise it uses `X-Forwarded-For` as above.

## The first opening

`setup.sh` writes `SETUP_TOKEN` and ends by printing the setup link,
`https://tuff.example.com/setup?token=…`. Open it once the stack is up:

1. **Email.** SMTP or Resend and the sender, with "Send a test email",
   which saves what you typed and sends one to the address under it. Or
   "Skip for now": the screen says what won't work without email —
   invitations, notifications and password reset links — and that you can
   still invite people by link.
2. **Your account.** Name, email and a password of 12 characters or more.
   With `OWNER_EMAIL` set, the email is that one and cannot be changed.
   "Create account" makes it the server's owner, marks its email
   confirmed and signs you in. No email is sent and no command is needed.

If an account already has that email — somebody signed up with it before
you — it is taken over: your password, its email confirmed, and every
session, token and sign-in it had ended.

The link stops working the moment the server has an owner, however it got
one, and the server answers "This server already has an owner". The token
travels in a header, never in an address, and the page takes it out of the
address bar as it opens. Ten wrong tokens from one address in a quarter of
an hour, and that address waits. Until there is an owner the app prints
the link in its log on every start, so `docker compose logs app` finds it
again.

**Keep the link to yourself**: whoever opens it first is the owner. With
the link armed and `OWNER_EMAIL` empty, nobody can claim the server by
signing up, so there is nothing to race for. Without `SETUP_TOKEN` there is
no setup screen and the server behaves as below.

## The owner from the command line

With `OWNER_EMAIL` set, only that address can sign up while nobody owns
the server. The email it gets asks you to choose a password, and doing so
makes you the owner. Everybody else is told sign-up is closed. The address
is matched without regard to case. Only the app's own start reads it: a
migration run by hand leaves the server's address as it was, and if a
restart empties it before anybody owns the server, the log says so.

**With `OWNER_EMAIL` empty and no `SETUP_TOKEN`, the first account to
confirm its email owns the server**, whoever it is, and sign-up closes
after it. (With a `SETUP_TOKEN`, sign-up stays closed until the setup link
is used.) Then become the
owner before anybody else can reach the server. Its name is in the
Certificate Transparency logs minutes after Caddy gets a certificate, and
people watch them for new servers. Until you are the owner, let only your
own IP reach port 443; port 80 can stay open for the certificate.

Either way, Google, Apple and GitHub never make the first account, and
their buttons appear only once the server has an owner.

Without mail nobody can confirm, so name the owner from the machine:

```bash
docker compose exec app node --conditions=compiled server/dist/instanceOwner.js you@example.com
```

Sign up with that address first. The command shows the account's name and
when it was made, and asks before it does anything (`--yes` skips the
question). It then makes the account the owner, marks its email
confirmed, clears its password, signs it out everywhere, and prints a reset
link to this terminal, valid for an hour. Open it and choose a password.
The link is not written to any log.

The same command brings back a server whose owners can no longer sign in.
It refuses a server that already has an owner who can: owners add other
owners in Server settings.

When no mail is set up, nobody owns the server yet and there is no
`SETUP_TOKEN`, the app's log says so on every start, with this command.

## Versions and updates

Tuff has numbered releases, `X.Y.Z`, following
[semantic versioning](https://semver.org): a patch fixes things, a minor
version adds features, and a major version may need you to do something,
which [`CHANGELOG.md`](../CHANGELOG.md) and the release notes say. Every
release is a tag here, a [GitHub release](https://github.com/usetuff/tuff/releases)
and an image, `ghcr.io/usetuff/tuff:X.Y.Z`. `X.Y` and `latest` move to the
newest release; `.env` pins an exact one in `TUFF_VERSION`, so nothing
changes until you decide it should.

The running version is in `/health`:

```bash
curl -s https://tuff.example.com/health    # {"ok":true,"version":"1.0.0","commit":"…",…}
```

### Updating

```bash
git fetch --tags
git checkout v1.2.0          # the release you are moving to
scripts/update.sh 1.2.0
```

Without a version, `update.sh` takes the latest release; check out its tag
first all the same.

`update.sh`:

1. finds the latest release on GitHub (no account needed), or takes the one
   you name, and shows the changelog between yours and it;
2. asks before going on (`--yes` skips the question, `--dry-run` stops here);
3. pulls the new image while the old one keeps serving;
4. sets `TUFF_VERSION` in `.env` and runs `docker compose up -d`;
5. waits up to five minutes (`TUFF_UPDATE_WAIT`, in seconds) for the app to
   be healthy and report the new version, and says which backup the
   server took.

The backup is the server's own: when the new version has migrations, the
app backs the database up before applying any of them, and doesn't start
if it can't ([Backups](#backups)). After the update, Server settings says
which version you came from, where the backup is, and links to the release
notes, until you dismiss it.

If the app doesn't come up, `update.sh` prints the commands to go back to
the version you had, with the database as it was: stop the app and the
worker, put the old `TUFF_VERSION` back, restore the server's backup with
`scripts/restore.sh` if the database was migrated, and start again. It
reads whether anything was migrated from the database itself; when nothing
was, the version is all there is to put back. While the app is still
backing up or migrating, `update.sh` keeps waiting past its five minutes.

**Checking out the tag is part of updating.** The image holds the app; the
compose file, `Caddyfile` and the scripts come from this checkout, and the
tag is where they match the image. `main` moves between releases and is not
what a server should follow. A release that needs a change to them says so, and `update.sh` warns when the
checkout is older than the release you're moving to.

**Migrations only go forward.** The app migrates the database when it
starts, and an older release can't run on a database a newer one has
migrated. So `update.sh` refuses to move to an older release unless you pass
`--force`, which is for after you've restored a backup taken on that
release.

Updating by hand is the same steps, and the server backs up the same way:

```bash
# set TUFF_VERSION=1.2.0 in .env
docker compose pull
docker compose up -d
```

### Hearing of a new version

Server settings shows the version you run. When a newer one is out, it
says so there, with a link to the release notes and the command,
`scripts/update.sh`. A security release also puts a red dot on your
picture in the top bar, for the server's owners only, until the server
runs that version.

To know, the worker makes **one request a day**:

```
GET https://api.github.com/repos/usetuff/tuff/releases/latest
User-Agent: Tuff/1.2.0
Accept: application/vnd.github+json
```

That is all it sends: no token, no address of your server, no count of
anything, no identifier. GitHub sees the request itself — your server's IP
address and the version in `User-Agent` — as it sees any request. The
answer it keeps is the latest version, the link to its notes, when it was
published and whether it is a security release. A request that fails or
times out (ten seconds) is ignored, and tried again the next day. A build
at `0.0.0`, which is not a release, never asks.

To turn it off, put this in `.env` and restart:

```bash
UPDATE_CHECK=off
```

Nothing is sent from then on, and Server settings says that checking is
off. You can still watch this repository for releases only (**Watch →
Custom → Releases**).

### Checking the image

Each release image is signed with [cosign](https://docs.sigstore.dev/)
without a key: the signature's certificate says it was made by this
repository's release workflow, at a release tag.

```bash
cosign verify ghcr.io/usetuff/tuff:1.0.0 \
  --certificate-identity-regexp '^https://github.com/usetuff/tuff/\.github/workflows/release\.yml@refs/tags/v' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

It also carries SLSA build provenance and an SPDX SBOM, attached by
BuildKit, and a provenance attestation you can check with the GitHub CLI:

```bash
gh attestation verify oci://ghcr.io/usetuff/tuff:1.0.0 -R usetuff/tuff
docker buildx imagetools inspect ghcr.io/usetuff/tuff:1.0.0 --format '{{ json .SBOM }}'
```

### Building from source

To run your own changes, or a commit between releases, build the image
from this checkout instead of pulling it. In `.env`:

```bash
COMPOSE_FILE=docker-compose.prod.yml:docker-compose.build.yml
```

then `docker compose up -d --build`. The first build takes a few minutes.
To update, `git fetch --tags && git checkout v1.2.0` and
`docker compose up -d --build` again; the app backs the database up before
it migrates, as a released image does. `update.sh` refuses to run on a
server built this way, since the version it would set isn't what you
built.

## Backups

### Before every migration

When the app starts and the database has migrations it hasn't applied —
after an update, almost always — it backs the database up first, with
`pg_dump` in Postgres's own format, into the `db-backups` volume:

```
/backups/tuff-1.2.0-m301-20261120-101500.dump   # the version it ran before, its newest migration, the date and time (UTC)
```

- **Only when something is pending.** A restart of the same version takes
  no backup. Nor does a new database on its first start.
- **One per update.** The pending migrations go in one transaction, so one
  that fails leaves the database as the backup has it. If the app is
  started again after that — its restart policy does it every minute — it
  uses the backup it already took instead of taking another, and says so.
- **A failed backup stops the start.** If the dump fails or comes out
  empty — a full disk is the usual cause — no migration is applied, the app
  doesn't start, and its log (`docker compose logs app`) says why and what
  to do. The database is as it was, so going back to your old
  `TUFF_VERSION` is safe. Compose stops the old container before it starts
  the new one, so the server is down until you do one or the other; the
  app's restart policy keeps retrying, and each try applies nothing.
- **When a backup can't be kept or made, the app migrates without one and
  says so** in its log and in Server settings: when `/backups` isn't a
  volume (a compose file from before this, or a platform that gives the
  container no volume there), since a backup there would be lost with the
  container; and when the database runs a newer major version of Postgres
  than the image's `pg_dump` (17), which can't read it.
- **Kept 30 days**, and the newest two always, whatever their age. Older
  ones are deleted when the app next migrates. `BACKUP_RETENTION_DAYS` in
  `.env` changes it.
- **`SKIP_PRE_MIGRATION_BACKUP=1`** in `.env` migrates without one, for a
  server whose database is backed up some other way. The log says no backup
  was taken. **On Railway**, the template sets it: the container's disk
  doesn't outlive a deploy, a service gets one volume, and Railway's own
  Postgres backups are the backup there.

To list them, or copy one off the machine:

```bash
docker compose exec postgres ls -l /backups
docker compose cp app:/backups/tuff-1.2.0-m301-20261120-101500.dump .
```

They live on the same disk as the database. They undo an update that went
wrong; they don't protect you from losing the machine. Copy them, or the
backups below, somewhere else.

### Restoring one

One command, with the backup's name:

```bash
scripts/restore.sh tuff-1.2.0-m301-20261120-101500.dump
```

It checks the file is a whole dump before it changes anything, stops the
app and the worker, renames the database to
`tracker_before_restore_<date>`, and restores the backup as `tracker` with
`pg_restore --create`, so the database's own settings and rights come back
with it. Nothing is dropped: if the restore fails, or you stop it with
Ctrl-C, the database is renamed back. It works on the compose project
`.env` names, whatever `COMPOSE_PROJECT_NAME` your shell has, and says
which before it starts. Then put `TUFF_VERSION` in `.env` back to the version in the file's
name (and check out its tag), and run `docker compose up -d`. Once you've
checked everything is there, drop the old database with the command
`restore.sh` prints:

```bash
docker compose exec postgres dropdb -U tracker tracker_before_restore_20261120_103000
```

`update.sh` prints the `restore.sh` command with the right file name when an
update fails after migrating.

### Whenever you like

The database, in Postgres's own format:

```bash
mkdir -p -m 700 backups
(umask 077; docker compose exec -T postgres pg_dump -U tracker -d tracker --format=custom > backups/tuff-$(date +%F).dump)
```

The attached files, when they are on the `uploads` volume:

```bash
docker compose cp app:/data/storage backups/tuff-files-$(date +%F)
```

And `.env`, which holds the database passwords and the push key.

To restore onto a new machine: copy `.env` across, set `TUFF_VERSION` in
it to the release the backup was taken on, run `docker compose up -d` once
so the database and its roles exist, then

```bash
docker compose cp backups/tuff-files-2026-01-31/. app:/data/storage
docker compose exec -u root app chown -R node:node /data/storage
scripts/restore.sh backups/tuff-2026-01-31.dump
docker compose up -d
```

`restore.sh` takes a file on this machine as well as a name in the
`db-backups` volume, and does the same with it.

## Rotating the secrets

Change a secret when it may have leaked. Each one is a line in `.env`,
then `docker compose up -d`.

- **`APP_DB_PASSWORD`, `WORKER_DB_PASSWORD`**: change the line. The app
  sets the role's new password when it starts.
- **`POSTGRES_PASSWORD`**: Postgres read it once, when the volume was made.
  Change it in the database first —
  `docker compose exec -T postgres psql -U tracker -d tracker -c "alter role tracker password 'NEW'"` —
  then in `.env`.
- **`JWT_SECRET`**: change the line. Everybody is signed out and signs in
  again; apps and agents keep working, since their tokens are not signed
  with it. If the server has no `ENCRYPTION_KEY` yet, set one first (next
  item), or second factors and GitHub and Slack links stop working:
  without it they are encrypted with a key from `JWT_SECRET`.
- **`ENCRYPTION_KEY`, the first time**: add it, run `docker compose up -d`,
  then move what is already stored onto it:

  ```bash
  docker compose exec app node --conditions=compiled server/dist/reseal.js
  ```

  It prints how many it moved. After that, `JWT_SECRET` can be changed on
  its own.
- **`ENCRYPTION_KEY`, changing it**: move the old value to
  `ENCRYPTION_KEY_PREVIOUS`, put a new one in `ENCRYPTION_KEY`, run
  `docker compose up -d`, then the same `reseal.js` command. When it has
  moved everything, delete `ENCRYPTION_KEY_PREVIOUS` and run
  `docker compose up -d` again.

Something the server can no longer open — after a key was lost rather than
rotated — is counted by `reseal.js` and left alone. A person whose second
factor cannot be opened can still sign in with a recovery code, then turn
the factor off and on again. A GitHub or Slack link that cannot be opened
has to be connected again, and so does mail saved in Server settings: until
then no email is sent, and the log says so once.

## Logs and health

```bash
docker compose ps                 # all four should be running
docker compose logs -f app worker
curl -s https://tuff.example.com/health   # "version" is the running release
```

Nothing watches the worker for you. If it stops, emails, notifications
and deletions quietly wait, so check it now and then, or point your own
monitoring at `docker compose ps worker`.
