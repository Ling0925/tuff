import { Hono } from 'hono'
import { edition } from '../edition.js'

/**
 * Which of this site's addresses the Apple apps open.
 *
 * A route and not a file in `web/public`: a file with no extension is served
 * as bytes, and Apple reads JSON. The site's own pages, the API and every
 * file are excluded first, and everything else is the app's, because Apple
 * takes the first rule that matches.
 */
export const apple = new Hono()

/**
 * The team and the bundle the apps are signed as: `APPLE_APP_ID`, else the
 * service's own (`edition.vendor`). On your own server there is none unless
 * it is set, and nothing is served — a server naming the service's app as
 * its own would hand its links to an app that talks only to usetuff.com.
 * Read at each request, so a test can set it.
 */
export function appleAppId(raw: string | undefined, vendor: string | null): string | null {
  return (raw ?? '').trim() || vendor || null
}

/* The site's: the public pages, what is not a screen, the operator's own,
   and any address with a dot in it, which is a file.

   And the web's own ways in. Google sends a browser back to
   `/signin?handoff=…` from its own domain, which is the one kind of
   navigation the system hands to an app — so with the app installed, a
   sign-in begun in Safari would have ended in the app with a ticket meant
   for the page. A document shared to the web, `/d/…`, is read by people
   with no account, in a browser — and so is a board by its link, `/b/…`,
   and a project's feedback page, `/f/…`. */
export const site = [
  '/',
  '/welcome',
  '/pricing',
  '/about',
  '/changelog',
  '/changelog/*',
  '/help',
  '/help/*',
  '/blog',
  '/blog/*',
  '/compare',
  '/compare/*',
  '/alternatives/*',
  '/for/*',
  '/privacy',
  '/terms',
  '/refunds',
  '/fr',
  '/fr/*',
  '/signin',
  '/signup',
  '/forgot',
  /* A change of address's links are pressed in a browser, the new
     address's from the account's own session,
     The apps' screen posts a link as it opens,
     which the server no longer takes for either. */
  '/verify/eml_*',
  '/verify/apv_*',
  '/d/*',
  '/b/*',
  '/f/*',
  '/agent-board',
  '/api/*',
  '/auth/*',
  '/oauth/*',
  '/assets/*',
  '/.well-known/*',
  '/mcp',
  '/mcp/*',
  '/digest/*',
  '/admin',
  '/admin/*',
  '/*/admin',
  '/*/admin/*',
  '*.*',
]

/* A connection begun on the web comes back to a screen of the web, with a
   code only that page can finish: GitHub's install and authorisation and
   Slack's land on `/:ws/settings?github=…` or `?slack=…`, and
   `/:ws/account?github=…`. Those are screens' addresses, so with the app
   installed the system handed them to it — the app does not finish another
   window's connection, and on a phone GitHub never connected.
   Only with that parameter: the same screens without it are still the
   app's. */
export const returns = [
  { '/': '/*/settings', '?': { github: '*' } },
  { '/': '/*/settings', '?': { slack: '*' } },
  { '/': '/*/account', '?': { github: '*' } },
]

apple.get('/.well-known/apple-app-site-association', (c) => {
  const appID = appleAppId(process.env.APPLE_APP_ID, edition.vendor?.appleAppId ?? null)
  if (!appID) return c.json({ error: { code: 'not_found' } }, 404)
  c.header('cache-control', 'public, max-age=3600')
  return c.json({
    applinks: {
      details: [
        {
          appIDs: [appID],
          components: [
            ...site.map((path) => ({ '/': path, exclude: true })),
            ...returns.map((r) => ({ ...r, exclude: true })),
            { '/': '/*' },
          ],
        },
      ],
    },
    /* A password kept for the site is the app's too, and the other way round. */
    webcredentials: { apps: [appID] },
  })
})
