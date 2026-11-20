# How Tuff is built

A map for somebody opening the code for the first time: what the packages
are, the path a request takes, how changes reach other screens, what runs
in the background, how agents get in, and how the web app is put together.
The API itself is in [the contract](api.md); running a server is in
[the self-hosting guide](self-hosting.md).

## The packages

A pnpm workspace with three packages. The package and database names say
`tracker`, the product's name before it was Tuff; renaming them would sign
everybody out and break every agent's configuration for a word nobody sees.

| Folder | Package | What it is |
| --- | --- | --- |
| `shared-schema/` | `@tracker/shared-schema` | The contract as code: the entities and answers as Zod schemas, the permission matrix and `can()`, the address format. Both the server and the web app import it. |
| `server/` | `@tracker/server` | A Node.js process on [Hono](https://hono.dev): the REST API, the websockets, the MCP endpoint, sign-in, and the built web app served from the same origin. Also the worker, which is the same code started as `src/worker.ts`. |
| `web/` | `@tracker/web` | The React app, built by Vite into `web/dist`, which the server serves. |
| `e2e/` | — | Playwright tests of the paths people walk, against a seeded server. |

`shared-schema/generated/` holds what is generated from the schemas — a
JSON Schema of the API and the types the native apps decode with. It is
committed, and `pnpm generate` rewrites it: client types are never written
by hand.

## The four things

Everything a team makes is one of four entities: a **post** (an
announcement), a **task**, a **file** (a document, an upload or a link, all
in a project's Docs) and a **message**. Projects, conversations, labels,
lists and the rest are where those live or fields on them. A new feature is
expected to be a property of one of the four, not a fifth.

## A request

There is one way into the data, and it is REST. The web app, the MCP tools
and the native apps all call the same endpoints, so there is one permission
model rather than one per client.

```
request ─▶ Hono middleware ─▶ authenticate ─▶ handler ─▶ allow() / can() ─▶ withActor() ─▶ Postgres (RLS)
           limits, headers     who is asking               may they?          one transaction    which rows
```

1. **Middleware** (`server/src/http/routes.ts`) sets the security headers,
   the body limits and the rate limits.
2. **Authentication** (`server/src/auth/context.ts`) turns the bearer token
   into an `AuthContext`: the actor, the workspace the session is for, the
   role, the workspace's switches, and whether the call came through a
   token (an agent) rather than a person's session. Sessions are short-lived
   signed tokens with a refresh token beside them; API tokens are `tok_…`,
   stored hashed.
3. **The handler** (`server/src/http/*.ts`, one file per area) validates the
   body against the schema.
4. **Permission** is decided in one function, `can(action, input)` in
   `shared-schema/src/permissions.ts`, which the server reaches through
   `allow()`. The matrix there is data, and its tests hold it row by row.
   The web app asks the server which actions are available (`/api/me`
   says them) only to decide which buttons to draw; the server still
   decides. An object a person may not see answers 404, not
   403, because that it exists is information.
5. **The query** runs inside `withActor()` (`server/src/db.ts`), a
   transaction that first sets `app.actor_id` and `app.workspace_id`.
   Postgres row-level security policies read those settings, so every
   query is bounded by the workspace in the database itself: a query that
   forgets a `where` returns nothing rather than another company's rows.

The server connects as `tracker_app`, a role that row-level security
applies to and that cannot bypass it. Migrations run as the database's
owner (`DATABASE_URL`), on start, from `server/migrations/` in order; they
only go forward. The worker has a role of its own, `tracker_worker`, with
only what its jobs need.

Lists are paged by cursor, never by page number.

## Live updates

A change is saved, then published with `publish()` (`server/src/realtime.ts`),
usually inside the transaction that made it, and Postgres `LISTEN`/`NOTIFY`
carries it to every server process. A process holding a websocket for that topic passes
the event on.

There are three sockets: `/ws/me` (what is addressed to you), one per
project (`/ws/projects/:id`) and one per conversation
(`/ws/conversations/:id`). Each is checked like a request when it opens, and
the membership is asked again while it is held, so somebody removed from a
project stops hearing it. An
event names what changed; the screen reads it again through REST, so the
socket never carries anything a request would not.

Because the fan-out is in the database, a second server process needs no
other infrastructure.

## The worker

`pnpm worker` locally, the `worker` service in Docker. It sends mail,
browser push and the digest, delivers webhooks with retries, runs imports,
and permanently deletes what was deleted once its window has passed. Each
job is a loop of its own, so a slow one does not hold the others, and each
is safe to run twice. Without it the app looks fine and quietly does none
of these.

## Agents and MCP

An agent works through the same REST API as a person, with a token, and
everything it does shows under its name in Activity.

- **At an address.** `POST /mcp` on the server is a stateless MCP server
  over streamable HTTP (`server/src/mcp/remote.ts`). An agent on the web
  (ChatGPT, Claude) connects to `https://your-server/mcp` and signs in
  through OAuth with PKCE (`/.well-known/oauth-authorization-server`,
  `/oauth/register`, `/oauth/token`); the person approves it on the app's
  own page. Coding agents connect with a token in a header.
- **On a machine.** `pnpm --filter @tracker/server mcp` runs the same tools
  over stdio, with `TUFF_TOKEN` and `TUFF_URL` set.

The tools (`server/src/mcp/tools.ts`) are each one HTTP call to the
endpoint the web app uses, inside the process, so the permissions are the
same by construction. Text an agent reads from a project is data, not
instructions, and cannot widen what its token may do.

## The web app

React 19, Tailwind 4 and Tiptap for the editor, built by Vite. Some things
about it that are not the usual choice:

- **Routing is hand-written** in `web/src/data/route.ts`: `parse`, `format`
  and a `popstate` listener. The address is the only record of where you
  are, and every object has one a person can read
  (`/acme/website/tasks/41`).
- **Writes are optimistic.** The screen changes first and the request
  follows; a refusal puts it back.
- **A screen opens on what it showed last** (`web/src/data/memory.ts`) and
  the server's answer replaces it in place, so moving between screens has
  no spinners. What the device last loaded is also what it shows offline.
- **Every word on a screen** lives in `web/src/words/`, in English with its
  French beside it, never inline in a component.
- **The server answers types the app imports** from `@tracker/shared-schema`,
  so a change to an answer's shape fails the build on both sides.

In development Vite serves the app on port 5180 and proxies `/api`, `/auth`,
`/ws`, `/oauth` and `/mcp` to the server on 8787. In production the server
serves `web/dist` itself: one origin, no CORS.

## The edition seam

This repository is the open-source edition of the code that also runs the
hosted service at usetuff.com. The two differ in one file per side:
`server/src/edition.ts` and `web/src/edition.tsx` say what the service adds
(plans, billing, its website) through the hooks in `editionShape.ts`. Here
those files add nothing, and a workspace has no limits.

## Tests

- `pnpm --filter @tracker/shared-schema test`: the permission matrix.
- `pnpm --filter @tracker/server test`: the server against a real
  Postgres, including row-level security and workspace isolation.
- `pnpm --filter @tracker/web test`: the web app's pure logic.
- `pnpm e2e`: Playwright, against a seeded server.
- `pnpm check` runs all of it, with the types, the lint and the build, and
  says at the end whether it is green. `NO_E2E=1 pnpm check` leaves the
  browser out and says so.
- `pnpm load` builds a large workspace (10,000 tasks in a project, a
  million messages in a channel, 1,000 members) and fails if a screen's
  data takes longer than 200 ms.
