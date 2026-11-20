import { test } from 'node:test'
import assert from 'node:assert/strict'
import { backupState, checkState, releaseLink, securityDue, type ServerVersion } from '../src/data/release.js'

/*
 * "A new version is out" on the owner's screen and face.
 * The server decides
 * what is newer; these are the screen's own decisions about what it was
 * sent.
 */

const v = (over: Partial<ServerVersion> = {}): ServerVersion => ({
  current: '1.2.0',
  commit: 'abc1234',
  check: true,
  latest: null,
  updated: null,
  ...over,
})
const latest = (security: boolean) => ({
  version: '1.3.0',
  url: 'https://github.com/usetuff/tuff/releases/tag/v1.3.0',
  published_at: '2026-11-10T12:00:00Z',
  security,
})

test('the dot is for a security release the server does not run yet, and for nobody without one', () => {
  assert.equal(securityDue(v({ latest: latest(true) })), true)
  assert.equal(securityDue(v({ latest: latest(false) })), false, 'an ordinary release: the row, no dot')
  assert.equal(securityDue(v()), false, 'nothing newer: the server sends no latest once it runs it')
  assert.equal(securityDue(undefined), false, 'not an owner, or the service: no server at all')
  assert.equal(securityDue(null), false)
})

test('the version row says whether the check runs, or that this build is not a release', () => {
  assert.equal(checkState(v()), 'on')
  assert.equal(checkState(v({ check: false })), 'off')
  assert.equal(checkState(v({ current: '0.0.0' })), 'unreleased')
  assert.equal(checkState(v({ current: '0.0.0', check: false })), 'unreleased')
})

test('the notes link is only ever a page under usetuff/tuff’s releases', () => {
  assert.equal(releaseLink('https://github.com/usetuff/tuff/releases/tag/v1.3.0'), 'https://github.com/usetuff/tuff/releases/tag/v1.3.0')
  for (const bad of [
    'javascript:alert(1)',
    'https://evil.example.com/usetuff/tuff/releases/tag/v1.3.0',
    'https://github.com/usetuff/tuff/issues/1',
    'https://github.com/usetuff/tuff/releases/tag/v1.3.0"><x',
    '',
  ]) {
    assert.equal(releaseLink(bad), null, bad)
  }
})

test('the notice after an update says where the backup is, or why there is none', () => {
  const u = {
    from: '1.2.0',
    to: '1.3.0',
    at: '2026-11-20T10:15:00Z',
    backup: null,
    no_backup: null,
    migrations: 0,
    notes: null,
  } as const
  assert.equal(backupState({ ...u, backup: '/backups/tuff-1.2.0-m301-20261120-101500.dump', migrations: 3 }), 'taken')
  assert.equal(backupState(u), 'unchanged', 'nothing migrated: no backup needed')
  for (const why of ['skipped', 'no_folder', 'not_a_volume', 'postgres_newer'] as const) {
    assert.equal(backupState({ ...u, migrations: 2, no_backup: why }), why)
  }
  assert.equal(backupState({ ...u, migrations: 2 }), 'no_folder', 'migrated, no backup, no reason said')
})
