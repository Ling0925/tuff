import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import postgres from 'postgres'
import { closeDb } from './helpers.js'
import { sql } from '../src/db.js'
import { guardRls, RlsRefused, rlsVerdict } from '../src/rlsGuard.js'

/*
 * A server connected as a role row-level security does not bind refuses to
 * start, where its edition says so — `rlsGuard.ts`, the sixth audit's M3.
 * Asked here of the function the start awaits, not by starting a process
 * and watching it die.
 */
const owner = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} })

after(async () => {
  await owner.end()
  await closeDb()
})

test('each kind of role no policy binds is named, and the application role is not', () => {
  const base = { role: 'r', superuser: false, bypass: false, owns: false }
  assert.equal(rlsVerdict(base), null)
  assert.match(rlsVerdict({ ...base, superuser: true }) ?? '', /superuser/)
  assert.match(rlsVerdict({ ...base, bypass: true }) ?? '', /BYPASSRLS/)
  assert.match(rlsVerdict({ ...base, owns: true }) ?? '', /owns the tables/)
  assert.match(rlsVerdict(undefined) ?? '', /did not say/)
})

test('the application role the tests run as passes, refusing or not', async () => {
  const said: string[] = []
  await guardRls(sql, 'app', true, (s) => said.push(s))
  await guardRls(sql, 'app', false, (s) => said.push(s))
  assert.deepEqual(said, [])
})

test('connected as the tables’ owner, a refusing start throws and a lenient one says so', async () => {
  await assert.rejects(
    guardRls(owner, 'app', true, () => {}),
    RlsRefused,
  )
  const said: string[] = []
  await guardRls(owner, 'app', false, (s) => said.push(s))
  assert.equal(said.length, 1)
  assert.match(said[0]!, /DATABASE_URL_APP/)
})

test('a role that only inherits from the owner is the owner, as far as a policy is concerned', async () => {
  const name = `rls_guard_${Date.now().toString(36)}`
  const me = (await owner<{ me: string }[]>`select current_user::text as me`)[0]!.me
  await owner.unsafe(`create role ${name} nologin inherit`)
  try {
    await owner.unsafe(`grant ${me} to ${name}`)
    await owner.begin(async (tx) => {
      await tx.unsafe(`set local role ${name}`)
      const said: string[] = []
      await guardRls(tx as unknown as postgres.Sql, 'app', false, (s) => said.push(s))
      assert.equal(said.length, 1)
      assert.match(said[0]!, /owns the tables/)
    })
  } finally {
    await owner.unsafe(`drop role ${name}`)
  }
})

test('a server of your own refuses to start without its isolation', async () => {
  const { edition: community } = await import('../src/edition.js')
  assert.equal(community.rlsFailClosed, true)
})
