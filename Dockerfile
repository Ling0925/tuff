# The image the product runs as — one image, two processes.
#
# `server` and `worker` are the same build started with different commands:
# the worker sends mail and push, drains the webhook queue and runs the
# clear-out. Without it webhooks never fire and nothing is ever really
# deleted — both of which look like working features until somebody checks.
# Two images would be two chances for them to drift apart.
#
# Multi-stage, because the build needs pnpm, the toolchain and every
# devDependency, and the thing that runs needs none of them. The result is
# the compiled server, the production node_modules and the built web
# client — around a tenth of what the build stage weighs.
#
# Built for linux/amd64 and linux/arm64 by the release workflow. The build
# stage runs on the builder's own
# platform, since what it makes — JavaScript and a static client — is the
# same on both, and running tsc and Vite under emulation took the arm64
# half from a minute to the best part of half an hour. Only the production
# dependencies are installed on the target platform, in their own stage,
# so anything with a native part would be fetched for the right machine.
# Today nothing in them has one.

# ---------------------------------------------------------------- build
# Node by its exact release, not `22`: a floating tag is whatever the
# builder's cache last pulled, and on 21 October 2026 that mattered —
# eight eMudhra intermediate CA keys were compromised and Node carries its
# own copy of the roots, so only 22.23.4 and later stop trusting them for
# the server's own calls out (mail, push, webhooks, sign-in, storage).
# Raised by hand, on purpose.
FROM --platform=$BUILDPLATFORM node:22.23.4-alpine AS build
WORKDIR /app

# pnpm by the version the repo pins, so the lockfile is read by the tool
# that wrote it.
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

# The manifests first and the sources after: Docker caches by layer, and a
# change to a source file should not re-download the dependency tree.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY shared-schema/package.json shared-schema/
COPY server/package.json server/
COPY web/package.json web/
RUN pnpm install --frozen-lockfile

COPY . .

# The client is a static build; the server is type-checked and compiled.
# `pnpm build` at the root does both — the same command CI runs, so a green
# CI means a buildable image.
RUN pnpm build

# ------------------------------------------------------------- deps
# What production needs, and only that, installed on the platform it will
# run on. This was `pnpm install --prod` over the build stage's tree, which
# unlinks the devDependencies and leaves them in the store: the image
# carried TypeScript, Playwright, esbuild and two builds of lightningcss,
# 198 MB of node_modules for a server whose dependencies are a few MB.
#
# The server and what it depends on (the schema), not the web client,
# whose dependencies are compiled into `web/dist` already. No install
# scripts: nothing here needs one, and a dependency's postinstall is code
# from somebody else run during the build.
FROM node:22.23.4-alpine AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY shared-schema/package.json shared-schema/
COPY server/package.json server/
COPY web/package.json web/
RUN pnpm install --frozen-lockfile --prod --ignore-scripts --filter '@tracker/server...'

# ------------------------------------------------------------------ run
FROM node:22.23.4-alpine AS run
WORKDIR /app

# What the image says it is, for `docker inspect` and the registry's page.
# The release workflow adds the version, the commit and the date.
LABEL org.opencontainers.image.title="Tuff" \
      org.opencontainers.image.description="A project manager for small teams and their AI agents: tasks, chat, docs and announcements." \
      org.opencontainers.image.url="https://usetuff.com" \
      org.opencontainers.image.source="https://github.com/usetuff/tuff" \
      org.opencontainers.image.documentation="https://github.com/usetuff/tuff/blob/main/docs/self-hosting.md" \
      org.opencontainers.image.licenses="AGPL-3.0-only"

# Not root. A process that can write its own code is one an injection can
# rewrite, and `node` is a user the base image already has.
ENV NODE_ENV=production
# Sixteen threads for libuv rather than four. Password hashing runs there
# beside every file read and DNS lookup, and four was a pool one burst of
# sign-ins could fill for the whole process.
ENV UV_THREADPOOL_SIZE=16

# No `ENV PORT`. The server defaults to 8787 on its own when nothing says
# otherwise, and a platform that assigns the port passes it in the
# environment. Baked into the image it would win over what the platform
# sets, so the server would listen on 8787 while the proxy knocks
# somewhere else: the container reads healthy and every request comes
# back 502.

# Owned by root and only readable by `node`, which runs it: the process
# can write its uploads and nothing of its own code. The code was owned by
# `node` before, which said the opposite of the line above it.
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/server/node_modules ./server/node_modules
COPY --from=deps /app/shared-schema/node_modules ./shared-schema/node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/shared-schema/package.json ./shared-schema/package.json
COPY --from=build /app/shared-schema/dist ./shared-schema/dist
COPY --from=build /app/server/package.json ./server/package.json
COPY --from=build /app/server/dist ./server/dist
# Read at start: the app migrates the database before it answers.
COPY --from=build /app/server/migrations ./server/migrations
# The built client, which the server serves: one origin for the app and the
# API, so there is no CORS and no second place to deploy.
COPY --from=build /app/web/dist ./web/dist

# Where uploads land until the storage driver is S3-compatible. A named
# volume is mounted here in production — without one an upload is lost on
# the next deploy, which is a data-loss bug wearing a deployment's clothes.
ENV STORAGE_DIR=/data/storage
# Where your own server dumps the database before it migrates
# (`server/src/backup.ts`): compose mounts the `db-backups` volume here,
# and a new volume takes this folder's owner and mode. The service's
# edition never dumps, whatever this says.
#
# No `VOLUME /backups` here, though it would keep a dump past a container
# made without a volume: Railway refuses to build a Dockerfile with
# `VOLUME` in it, and usetuff.com and the Railway template are built from
# this one. The app looks instead: a /backups that is not a mount point
# gets no dump, and the log and Server settings say why.
ENV BACKUP_DIR=/backups
# `pg_dump` for that dump, and `pg_restore` to put one back: Alpine's
# client for Postgres 17, the major version the compose file runs. A
# `pg_dump` older than the server refuses it, and the start says so
# before anything is migrated. About 7 MB with libpq.
# And the base image's npm, npx, yarn and corepack go: nothing here runs
# them, and npm's own bundled dependencies are most of what a scanner
# reports against a Node image.
RUN apk add --no-cache postgresql17-client \
 && mkdir -p /data/storage /backups && chown -R node:node /data /backups && chmod 700 /backups \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
           /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-*

# Which commit this is, for `/health` (`server/src/version.ts`). The
# release workflow passes it; a platform that builds from git may set it
# in the environment instead.
ARG GIT_SHA=unknown
ENV GIT_SHA=$GIT_SHA

USER node
EXPOSE 8787

# Answered by the server itself, so an unhealthy container is one that
# cannot serve rather than one whose process happens to be alive.
#
# `/health`, not `/api/health`. Everything under `/api` goes through
# authentication and answers 401 without a session — which is the right
# answer to that request and the wrong thing to hang a healthcheck on. The
# first version of this asked for the wrong path and would have reported
# every container unhealthy from the moment it started serving correctly.
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# `--conditions=compiled` is how `@tracker/shared-schema` resolves to its
# built JavaScript. Without it Node is handed a `.ts` file and cannot run
# it; with it as a package default, every tool in the repo would need a
# build step before it could run anything. Production opts in; nothing
# else has to opt out.
CMD ["node", "--conditions=compiled", "server/dist/main.js"]
