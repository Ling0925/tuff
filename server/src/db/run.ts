import { pathToFileURL } from 'node:url'

/*
 * `pnpm migrate`, and `node server/dist/db/run.js` in a container: the
 * migrations, after a backup on your own server — `backup.ts`.
 *
 * Its own file, not the bottom of `migrate.ts`: `backup.ts` imports
 * `migrate.ts`, and with the entry there a top-level `await import` of
 * `backup.js` waited on the module that was still evaluating it — the
 * command never ran ("unsettled top-level await").
 */
// The project path contains a space, so comparing strings against file:// does
// not work: pathToFileURL encodes it as %20, a template string does not.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url = process.env.DATABASE_URL ?? 'postgres://tracker:tracker@localhost:5433/tracker'
  const { edition } = await import('../edition.js')
  const { BackupFailed, migrateWithBackup } = await import('../backup.js')
  const { applied } = await migrateWithBackup(url, edition).catch((e: unknown) => {
    if (e instanceof BackupFailed) process.exit(1)
    throw e
  })
  console.log(applied.length ? `applied: ${applied.join(', ')}` : 'no migrations to apply')
  process.exit(0)
}
