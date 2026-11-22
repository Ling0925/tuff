import { createHmac } from 'node:crypto'

/*
 * The sign-in role's connection string.
 *
 * `DATABASE_URL_AUTH` when it is set. Otherwise made from
 * `DATABASE_URL_APP`: the same host, port and database, the user
 * `tracker_auth`, and a password derived from the application's — an
 * HMAC-SHA256 of the word `tracker_auth` keyed by the application role's
 * password, in hexadecimal. The migrating start makes the role's password
 * match whichever of the two this answers (`letTheAppIn`), and the serving
 * start connects with the same answer, so a server upgraded without a new
 * variable signs people in exactly as it did before: nothing to add on
 * Railway, in a compose file, in the try mode or in CI.
 *
 * Derived rather than shared: the two roles must have different passwords
 * or a connection could not tell which it is, and a derivation needs no
 * second secret to be kept anywhere. Whoever reads `DATABASE_URL_APP` can
 * work this one out — and whoever reads the environment has every secret in
 * it anyway, `JWT_SECRET` first. What the role stops is SQL run as the
 * application, which reads no environment.
 *
 * Empty when there is nothing to derive it from — no `DATABASE_URL_APP`, or
 * one that is not `tracker_app` with a password (a developer pointing the
 * application at the owner on purpose). The sign-in code then shares the
 * application's connection (`db.ts`), which as the owner may do everything.
 */
export function authUrlFrom(explicit: string | undefined, appUrl: string | undefined): string {
  const said = (explicit ?? '').trim()
  if (said) return said
  if (!appUrl) return ''
  let u: URL
  try {
    u = new URL(appUrl)
  } catch {
    return ''
  }
  let user: string
  let secret: string
  try {
    user = decodeURIComponent(u.username)
    secret = decodeURIComponent(u.password)
  } catch {
    return ''
  }
  if (user !== 'tracker_app' || !secret) return ''
  u.username = 'tracker_auth'
  u.password = createHmac('sha256', secret).update('tracker_auth').digest('hex')
  return u.toString()
}
