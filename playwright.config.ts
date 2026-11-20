import { defineConfig } from '@playwright/test'

/**
 * The paths a person actually walks. Nothing else belongs here — e2e are
 * expensive, and the set is chosen explicitly rather than grown.
 *
 * The server and the web app are started separately (pnpm dev / pnpm web):
 * bringing up Postgres from the Playwright config would hide database state
 * inside the test runner.
 */
export default defineConfig({
  testDir: './e2e',
  /**
   * Four at a time, every test on its own — `fullyParallel`, because nearly
   * all of them are in one file and Playwright otherwise gives a file to one
   * worker. That is why four workers once measured no faster than one: the
   * big file ran on one of them while three waited.
   *
   * Twelve minutes one at a time, four minutes this way. Each worker has
   * its own share of the seeded studios (`account()` in `helpers.ts`), so
   * no two tests are ever in one studio at once; and a handful of tests that
   * assumed the order they ran in — the first project in the sidebar has
   * work, the second person in a picker is me — were made to say what they
   * meant.
   *
   * One retry, for the few that measure frames and lose one on a machine
   * running four browsers. The check names every test that needed it.
   *
   * `E2E_WORKERS=2` for a machine somebody is working on: four browsers
   * took the whole of it for five minutes.
   *
   * Two on CI. The runner has four cores, and four browsers beside the
   * server, the preview and Postgres made every test there 3.2 times as
   * long as here (3865 s against 1196 s, summed over the same 337 tests,
   * 9 November) — so anything over ten seconds here crossed the thirty
   * second ceiling there, and a dozen different tests timed out each day
   * from 1 November with the server answering in under half a second
   * throughout (the traces). The tests were waiting for a starved
   * browser, not for the product.
   */
  fullyParallel: true,
  workers: Number(process.env.E2E_WORKERS) || (process.env.CI ? 2 : 4),
  retries: 1,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: { baseURL: 'http://localhost:5180', trace: 'retain-on-failure' },
  reporter: [['list']],
})
