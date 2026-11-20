// After `vite build`: the edition's own public pages, when it has them.
//
// The service's build writes the landing, the plans and the site as HTML
// (`cloud/prerender.tsx`, read by the hosted service's own code). A tree
// without `cloud/` has none of them, and its `/` is the app's sign-in, so
// there is nothing to write and the build is the bundle alone.
import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const web = fileURLToPath(new URL('..', import.meta.url))
if (existsSync(`${web}src/cloud/prerender.tsx`)) {
  execFileSync('vite', ['build', '--ssr', 'src/cloud/prerender.tsx', '--outDir', 'dist-ssr'], { cwd: web, stdio: 'inherit' })
  execFileSync(process.execPath, ['scripts/cloud/prerender.mjs'], { cwd: web, stdio: 'inherit' })
}
/* Your own server's page has nothing of the site's in it already: the
   unfurl and the App Store offer come out of `index.html` as Vite serves
   and builds it — `ownServerPage` in `vite.config.ts`. */
