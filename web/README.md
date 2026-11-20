# web

The web app: React, Tailwind and Tiptap, built by Vite. The server serves
the build (`web/dist`) from its own origin.

- `src/main.tsx` starts it; `src/ui/` holds the screens and `src/ui/kit/`
  the shared controls.
- `src/data/` is what the screens stand on: `api.ts` (requests, with the
  token), `route.ts` (the hand-written routing: every screen has an
  address), `memory.ts` (the last answer of each screen, so it opens on
  what it showed), `socket.ts` (live updates).
- `src/words/` holds every word the app says, in English with its French
  beside it. A component never writes a word of its own.
- `test/` holds tests of the app's pure logic; the browser tests are in
  `e2e/` at the root.

[`docs/architecture.md`](../docs/architecture.md) says how it fits with the
server.

```bash
pnpm --filter @tracker/web dev     # http://localhost:5180, against the server on 8787
pnpm --filter @tracker/web build   # web/dist
pnpm --filter @tracker/web test
```
