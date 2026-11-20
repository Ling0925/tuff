import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkState, releaseLink, securityDue, type ServerVersion } from '../src/data/release.js'

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
