# server

The API server and the worker, on Node.js and [Hono](https://hono.dev).

- `src/main.ts` starts the server: it migrates the database, serves the
  REST API, the websockets, the MCP endpoint and the built web app.
- `src/worker.ts` is the same code started as the background worker: mail,
  push, webhooks, imports and the clear-out of deleted things.
- `src/http/` holds the routes, one file per area; `routes.ts` puts them
  together.
- `src/auth/` is sign-in, sessions, tokens and the second factor;
  `context.ts` builds who is asking and `allow()`, the one place access is
  decided (through `can()` in `@tracker/shared-schema`).
- `src/db.ts` holds the connections and `withActor()`, the transaction every
  query on workspace data runs in, which row-level security reads.
- `src/mcp/` is the MCP server: over HTTP at `/mcp`, or over stdio with
  `pnpm --filter @tracker/server mcp`.
- `migrations/` are plain SQL, applied in order on start. They only go
  forward.
- `test/` runs against a real Postgres (`pnpm db:up` at the root).

[`docs/architecture.md`](../docs/architecture.md) explains how a request
goes through these, and [`docs/api.md`](../docs/api.md) is the contract.

```bash
pnpm --filter @tracker/server dev       # the server, restarted on change
pnpm --filter @tracker/server worker    # the worker
pnpm --filter @tracker/server test      # the tests
```

Both read their settings from the environment (`.env.example` lists them):
load `.env` into the shell first, with `set -a; . ./.env; set +a`.
