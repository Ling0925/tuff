/*
 * Which release of Tuff this is.
 *
 * The one place the version is written. The release script changes the
 * line below and nothing else does; `/health` reports it, the image is
 * tagged with it, and the public mirror's tag is checked against it, so a
 * tag that disagrees with the code it points at is refused rather than
 * published.
 *
 * Semver, `X.Y.Z`, no `v`. Between releases it keeps the last release's
 * number: the commit (`COMMIT`) says how far past it a build is. `0.0.0`
 * means nothing has been released yet.
 */
export const VERSION = '0.0.0'

/*
 * The commit this build came from, seven characters, or `unknown`. Railway
 * says it in the environment; the image is given it at build time
 * (`GIT_SHA`, a build argument in the Dockerfile).
 */
export const COMMIT = (process.env.RAILWAY_GIT_COMMIT_SHA || process.env.GIT_SHA || 'unknown').slice(0, 7)
