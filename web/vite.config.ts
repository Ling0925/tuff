import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { existsSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { inlineScripts, pageHeaders } from '../shared-schema/src/headers.js'

// Proxy to the server so that there is no CORS and cookies and headers behave
// the same as they do in production behind one domain.
const proxy = {
  '/api': 'http://localhost:8787',
  '/ws': { target: 'ws://localhost:8787', ws: true },
  '/auth': 'http://localhost:8787',
  /* An agent signing in from elsewhere, and its MCP server — the page that
     asks, `/oauth/authorize`, is the app's and not proxied. */
  '/oauth/register': 'http://localhost:8787',
  '/oauth/token': 'http://localhost:8787',
  '/.well-known/oauth': 'http://localhost:8787',
  '/mcp': 'http://localhost:8787',
  /* A board's own MCP server; the board's page is the app's. */
  '^/b/[0-9A-Za-z]+/mcp$': 'http://localhost:8787',
  /* The link at the foot of a digest — `docs/specs/notifications.md`. */
  '/digest/off': 'http://localhost:8787',
  /* A room's incoming webhooks, at the address its settings show. */
  '/hooks/rooms': 'http://localhost:8787',
}

/*
 * The headers production sends, on the built app the browser tests run
 * against — so a policy that would refuse something the app does fails a
 * test here instead of a page in production. `shared-schema/src/headers.ts`.
 */
function guarded(): Record<string, string> {
  try {
    const page = readFileSync(new URL('./dist/index.html', import.meta.url), 'utf8')
    return pageHeaders({
      scriptHashes: inlineScripts(page).map((s) => `sha256-${createHash('sha256').update(s).digest('base64')}`),
      production: false,
    })
  } catch {
    return {}
  }
}

/*
 * Your own server's page is the app's alone.
 * What a link to usetuff.com unfurls as — its headline, its
 * price, its picture — and Safari's offer of the App Store app, which talks
 * only to usetuff.com, are the site's. A tree without `cloud/` is the
 * community edition, and they come out of `index.html` here, as `pnpm web`
 * serves it and as it is built; the service's page is left as written.
 */
const service = existsSync(new URL('./src/cloud', import.meta.url))
function ownServerPage(): Plugin {
  return {
    name: 'own-server-page',
    transformIndexHtml: (html) =>
      service
        ? html
        : html
            .replace(/[ \t]*<meta (?:property="og:[^"]*"|name="twitter:[^"]*"|name="apple-itunes-app")[^>]*>\n?/g, '')
            .replace(/<meta name="description" content="[^"]*"/, '<meta name="description" content="Tasks, chat and docs for a team and its AI agents."'),
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), ownServerPage()],
  server: { port: 5180, proxy },
  /*
   * The built app, on the same port and behind the same proxy.
   *
   * The browser tests ran against the dev server, which is also compiling
   * modules on demand and holding an HMR socket while it answers every API
   * call. On a slow machine that surface gives way: CI logged twenty
   * `ECONNRESET`s from the proxy and twenty-three tests failed waiting on
   * requests that never came back. Tests of what ships should run against
   * what ships.
   */
  preview: { port: 5180, proxy, headers: guarded() },
})
