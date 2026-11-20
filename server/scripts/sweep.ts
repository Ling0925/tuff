/**
 * The workspaces the harness leaves behind.
 *
 * Every server test registers an owner, and an owner comes with a workspace.
 * Nothing removed them, so they accumulated one per test per run — two and a
 * half thousand of them on this machine before anybody looked. None of it is
 * visible: the tests still pass, the screens still work, and the only symptom
 * is that row-level security has more workspaces to look past every time
 * anything is read, so the suite gets slower by a hair a run until it is
 * slower by minutes.
 *
 * That is the shape of most of the bugs in this codebase — nothing fails, it
 * just quietly costs more. So the sweep runs before the tests do, and the
 * cost cannot come back.
 *
 * Only what the harness made: the three slug prefixes are the marker, and
 * nothing a person set up looks like one.
 */
import { pathToFileURL } from 'node:url'
import postgres from 'postgres'
import { env } from '../src/env.js'
import { refusal } from './local.js'

/**
 * What a development database keeps: `ours`, where anything worth keeping
 * goes, and `studio`, the account `pnpm dev:account` rebuilds.
 */
const KEPT = ['ours', 'studio']

export async function sweep(): Promise<{ workspaces: number; actors: number }> {
  /*
   * As the table owner, through the definer functions rather than a plain
   * select or delete.
   *
   * `workspace` is readable only by its members, and asked plainly as
   * nobody the throwaway ones came back as an empty list — and an empty
   * list is indistinguishable from a clean database. That is what let two
   * and a half thousand of them pile up while the sweep reported success
   * every single run. And the owner's: the purges are nobody else's to
   * call (migration 227).
   */
  const owner = postgres(env.databaseUrl, { max: 1, onnotice: () => {} })
  try {
    const [swept] = await owner<{ n: number }[]>`
      select purge_workspaces_like(array['ws-%', 'studio-%', 'load-%']) as n`
    /*
     * And, on a database on this machine, every other workspace older than an
     * hour. The three prefixes were never the whole of it: tests name their
     * owners' workspaces after what they test — `b-`, `ways-`, `octo-s-workspace`
     * and a hundred more — and a hundred thousand of them had piled up, the
     * operator's searches taking twelve seconds through them. A list of
     * prefixes is one every new test file has to remember to join; the rule a
     * development database already keeps (nothing is kept outside `ours`) is
     * one nobody does. The hour spares a test running beside this one.
     * Never on a database elsewhere: `local.ts`.
     */
    let rest = 0
    if (!refusal('the sweep', process.env)) {
      /* A thousand at a time, each its own transaction: a hundred thousand in
         one would hold every lock it took until the last. */
      for (;;) {
        const [r] = await owner<{ n: number }[]>`
          select count(purge_workspace(id))::int as n from (
            select id from workspace
            where slug <> all(${KEPT}) and created_at < now() - interval '1 hour'
            limit 1000
          ) w`
        const n = Number(r?.n ?? 0)
        rest += n
        if (n < 1000) break
      }
    }
    const [gone] = await owner<{ n: number }[]>`select purge_orphan_actors() as n`
    return { workspaces: Number(swept?.n ?? 0) + rest, actors: Number(gone?.n ?? 0) }
  } finally {
    await owner.end()
  }
}

/*
 * Run directly — `pnpm sweep`, and the pretest hook. Imported, it is just the
 * function above and nothing happens.
 *
 * Through `pathToFileURL`, not string concatenation: this repository lives in
 * a directory with a space in its name, and `import.meta.url` percent-encodes
 * it while `process.argv[1]` does not. Compared as strings they never match,
 * the guard is false, and the script exits silently having done nothing —
 * which is how the first version of this sweep swept nothing twice.
 */
/*
 * And the database the tests share, told it is not a server of one's own.
 *
 * `pnpm migrate` ends with the edition's own step, and in the public
 * repository that is the community edition's: it marks the database as a
 * community server (`instance_setting.community`), whose rules refuse a
 * sign-up once somebody owns it — the sign-ups every test file makes. The
 * tests run the core's rules (`test/helpers.ts`), and `instance.test.ts`
 * tests the community's on a database it makes and drops. As the table
 * owner, since only the owner may change the setting; nothing is claimed
 * or unclaimed, so a development server started again marks it again.
 */
export async function unmarkCommunity(): Promise<boolean> {
  const owner = postgres(env.databaseUrl, { max: 1, onnotice: () => {} })
  try {
    const rows = await owner<{ id: boolean }[]>`update instance_setting set community = false where id and community returning id`
    return rows.length > 0
  } finally {
    await owner.end()
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]!).href) {
  if (await unmarkCommunity()) console.log('the shared database was marked a community server; unmarked for the tests')
  const { workspaces, actors } = await sweep()
  console.log(`swept ${workspaces} workspaces, ${actors} accounts`)
  process.exit(0)
}
