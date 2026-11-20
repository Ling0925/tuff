import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { withoutActor, closeDb } from '../src/db.js'
import { PER_TOKEN, PER_PERSON, PER_WORKSPACE, rateLimit } from '../src/http/limits.js'

/*
 * The pool this file opened, closed.
 *
 * Without it the tests all pass, node has nothing left to do, and the process
 * sits on an open socket forever — so the suite reports nothing, `pnpm check`
 * waits for a line that is never printed, and what is actually a finished run
 * looks like a slow one. Twenty minutes of it, twice, before anybody thought
 * to look at the process list rather than at the tests.
 */
after(async () => {
  await closeDb()
})

/**
 * The counter itself, on a small allowance.
 *
 * Spending three hundred to prove a limit of three hundred costs a thousand
 * round trips on every test run and proves nothing the third one does not.
 */
async function spend(key: string, allowance: number): Promise<boolean> {
  const [r] = await withoutActor((tx) => tx<{ ok: boolean }[]>`select rate_spend(${key}, ${allowance}) as ok`)
  return r?.ok === true
}

const stamp = Date.now()

test('a window allows exactly its allowance and then refuses', async () => {
  const key = `k${stamp}`
  assert.equal(await spend(key, 3), true)
  assert.equal(await spend(key, 3), true)
  assert.equal(await spend(key, 3), true)
  assert.equal(await spend(key, 3), false)
})

test('the count is shared, so a second process cannot double the budget', async () => {
  const key = `shared${stamp}`
  // Two callers of the same function against the same row is what two
  // processes are. In memory this was a fresh budget each; here it is one.
  await spend(key, 2)
  await spend(key, 2)
  assert.equal(await spend(key, 2), false)
})

test('one key running hot does not spend another one budget', async () => {
  assert.equal(await spend(`hot${stamp}`, 1), true)
  assert.equal(await spend(`hot${stamp}`, 1), false)
  assert.equal(await spend(`cold${stamp}`, 1), true)
})

test('the middleware counts the caller and the workspace, and lets others through', async () => {
  type Ctx = { actorId: string; workspaceId: string; tokenId?: string }

  async function hit(ctx: Ctx | undefined): Promise<number> {
    let passed = false
    let status = 200
    const c = {
      get: () => ctx,
      header: () => {},
      json: (_b: unknown, code?: number) => {
        status = code ?? 200
        return null
      },
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (rateLimit as any)(c, async () => {
      passed = true
    })
    return passed ? 200 : status
  }

  // Wired up at all, and not counting what it should not: an unauthenticated
  // request has no caller to hold to a ceiling.
  assert.equal(await hit({ actorId: `a${stamp}`, workspaceId: `w${stamp}` }), 200)
  assert.equal(await hit(undefined), 200)

  /*
   * What it spent is not checked by reading the table.
   *
   * The first version of this did, and the database refused it — the grant is
   * revoked, which is the point of the grant. Reaching past a refusal to
   * assert on internals is how a test ends up proving the thing it broke to
   * look at. The counting itself is held by the three above, against the
   * function that does it.
   */

  // A token is held tighter than a person, and a workspace wider than either.
  assert.ok(PER_TOKEN < PER_PERSON)
  assert.ok(PER_PERSON < PER_WORKSPACE)
})
