import { Hono } from 'hono'
import { edition } from '../edition.js'
import { returns, site } from './apple.js'

/**
 * Which of this site's addresses the Android app opens, and that the site's
 * passwords are its too. The twin of
 * `apple-app-site-association`, in Google's Digital Asset Links.
 *
 * The app is named by its package and the certificates it is signed with
 * (`ANDROID_CERT_SHA256`, comma-separated, as Play Console prints them).
 * With none set, no app is named: a statement for a certificate nobody holds
 * is a door left open for whoever signs with it first. The package is
 * `ANDROID_PACKAGE`, else the service's own (`edition.vendor`); on your own
 * server there is none unless it is set, and nothing is named.
 *
 * Android 15 reads the same exclusions Apple does (`dynamic_app_link_components`),
 * so the site keeps its own pages on a phone as on an iPhone; an older
 * Android opens every address the app's manifest claims, and the app hands
 * the site's back to the browser.
 */
export const android = new Hono()

/** The package to name, or none. Read at each request, so a test can set it. */
export function androidPackage(raw: string | undefined, vendor: string | null): string | null {
  return (raw ?? '').trim() || vendor || null
}
const certs = () =>
  (process.env.ANDROID_CERT_SHA256 ?? '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter((s) => /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(s))

android.get('/.well-known/assetlinks.json', (c) => {
  c.header('cache-control', 'public, max-age=3600')
  const fingerprints = certs()
  const package_name = androidPackage(process.env.ANDROID_PACKAGE, edition.vendor?.androidPackage ?? null)
  if (!fingerprints.length || !package_name) return c.json([])
  return c.json([
    {
      relation: ['delegate_permission/common.handle_all_urls', 'delegate_permission/common.get_login_creds'],
      target: { namespace: 'android_app', package_name, sha256_cert_fingerprints: fingerprints },
      relation_extensions: {
        'delegate_permission/common.handle_all_urls': {
          dynamic_app_link_components: [
            ...site.map((path) => ({ '/': path, exclude: true })),
            ...returns.map((r) => ({ ...r, exclude: true })),
            { '/': '/*' },
          ],
        },
      },
    },
  ])
})
