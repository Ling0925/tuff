import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { refusal } from '../scripts/local.js'

/*
 * `pnpm seed`, `pnpm dev:account` and `pnpm load` make accounts with the
 * password in the repository: on a development database only.
 */
const here = 'postgres://tracker:tracker@localhost:5455/tracker'

test('a database on this machine is let through', () => {
  for (const url of [
    here,
    'postgres://u:p@127.0.0.1:5432/t',
    'postgres://u:p@[::1]:5432/t',
    'postgres:///tracker?host=/var/run/postgresql',
  ]) {
    assert.equal(refusal('seed.ts', { DATABASE_URL: url }), null, url)
  }
  assert.equal(refusal('seed.ts', { DATABASE_URL: here, NODE_ENV: 'development' }), null)
})

test('production is refused, wherever its database is and whatever else is set', () => {
  for (const env of ['production', 'Production ', 'PRODUCTION']) {
    assert.match(refusal('seed.ts', { DATABASE_URL: here, NODE_ENV: env }) ?? '', /NODE_ENV is production/)
    assert.match(refusal('seed.ts', { DATABASE_URL: here, NODE_ENV: env, SEED_ANY_DATABASE: '1' }) ?? '', /NODE_ENV is production/)
  }
})

test('a database on another machine is refused unless asked for on purpose', () => {
  const far = 'postgres://postgres:secret@db.example.com:5432/railway'
  const said = refusal('dev.ts', { DATABASE_URL: far }) ?? ''
  assert.match(said, /db\.example\.com, not on this machine/)
  assert.doesNotMatch(said, /secret/, 'the password in the URL is never repeated')
  assert.match(refusal('dev.ts', { DATABASE_URL: 'postgres://u:p@postgres:5432/tracker' }) ?? '', /postgres, not on this machine/)
  assert.equal(refusal('dev.ts', { DATABASE_URL: far, SEED_ANY_DATABASE: '1' }), null)
  assert.match(refusal('dev.ts', { DATABASE_URL: far, SEED_ANY_DATABASE: 'yes' }) ?? '', /not on this machine/)
  assert.match(refusal('dev.ts', {}) ?? '', /not a URL/)
})

test('the scripts stop before they touch anything', () => {
  const scripts = fileURLToPath(new URL('../scripts/', import.meta.url))
  for (const script of ['seed.ts', 'dev.ts', 'load.ts']) {
    const run = spawnSync(process.execPath, ['--import', 'tsx', `${scripts}${script}`], {
      env: { ...process.env, NODE_ENV: 'production', DATABASE_URL: 'postgres://nobody:nothing@127.0.0.1:1/none' },
      encoding: 'utf8',
      timeout: 30_000,
    })
    assert.equal(run.status, 1, `${script}: ${run.stderr}`)
    assert.match(run.stderr, new RegExp(`${script.replace('.', '\\.')} refused: NODE_ENV is production`))
  }
})
