import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  checkForRelease,
  isNewer,
  isSecurityRelease,
  parseVersion,
  readRelease,
  RELEASES_LATEST,
  releaseCheck,
  type CheckDeps,
  type Release,
} from '../src/updates.js'
import { edition as community } from '../src/edition.js'
import { edition } from '../src/edition.js'
import { env } from '../src/env.js'

/*
 * "A new version is out".
 * The check with every part it reads handed in: nothing here
 * reaches GitHub, and a test that tried would fail on `fetch` below.
 */

const release = (over: Record<string, unknown> = {}) => ({
  tag_name: 'v1.3.0',
  html_url: 'https://github.com/usetuff/tuff/releases/tag/v1.3.0',
  published_at: '2026-11-10T12:00:00Z',
  draft: false,
  prerelease: false,
  body: '### Added\n\n- Something.\n',
  ...over,
})

type Asked = { url: string; init: RequestInit | undefined }

function deps(over: Partial<CheckDeps> & { answer?: () => Promise<Response> } = {}) {
  const asked: Asked[] = []
  const kept: (Release | null)[] = []
  const d: CheckDeps = {
    instance: true,
    enabled: true,
    version: '1.2.0',
    due: async () => true,
    fetch: (async (url: string, init?: RequestInit) => {
      asked.push({ url: String(url), init })
      return over.answer ? over.answer() : Response.json(release())
    }) as typeof fetch,
    keep: async (r) => void kept.push(r),
    ...over,
  }
  return { d, asked, kept }
}

test('versions compare as numbers, part by part', () => {
  assert.equal(isNewer('1.10.0', '1.9.9'), true)
  assert.equal(isNewer('2.0.0', '1.99.99'), true)
  assert.equal(isNewer('1.2.1', '1.2.0'), true)
  assert.equal(isNewer('1.2.0', '1.2.0'), false, 'the same is not newer')
  assert.equal(isNewer('1.2.0', '1.3.0'), false, 'a server newer than the release is told nothing')
  assert.equal(isNewer('1.9.9', '1.10.0'), false)
  /* Nothing released from 0.0.0: never a notice. */
  assert.equal(isNewer('1.0.0', '0.0.0'), false)
  assert.equal(isNewer('0.0.1', '0.0.0'), false)
  assert.equal(isNewer('0.1.0', '0.0.9'), true, 'a real 0.x release still hears of the next')
  /* Anything that is not plain X.Y.Z is never newer. */
  for (const odd of ['v1.3.0', '1.3', '1.3.0-rc.1', '1.3.0+build', '01.3.0', '', 'latest']) {
    assert.equal(isNewer(odd, '1.2.0'), false, odd)
    assert.equal(parseVersion(odd), null, odd)
  }
  assert.deepEqual(parseVersion('10.20.30'), [10, 20, 30])
})

test('a security release is one whose notes have a Security heading', () => {
  assert.equal(isSecurityRelease('### Fixed\n\n- x\n\n### Security\n\n- A fix.\n'), true)
  assert.equal(isSecurityRelease('## Security\n- x'), true)
  assert.equal(isSecurityRelease('#### security  \n- x'), true)
  assert.equal(isSecurityRelease('### Fixed\n\n- Security of the session cookie.\n'), false, 'the word in a line is not the heading')
  assert.equal(isSecurityRelease('### Security fixes\n'), false, 'nothing else on the line')
  assert.equal(isSecurityRelease('# Security\n'), false)
  assert.equal(isSecurityRelease(''), false)
})

test('GitHub’s answer is read as a release, or not at all', () => {
  assert.deepEqual(readRelease(release()), {
    version: '1.3.0',
    url: 'https://github.com/usetuff/tuff/releases/tag/v1.3.0',
    published_at: '2026-11-10T12:00:00Z',
    security: false,
  })
  assert.equal(readRelease(release({ body: '### Security\n\n- Fixed.\n' }))?.security, true)
  assert.equal(readRelease(release({ published_at: 'not a date' }))?.published_at, null)
  assert.equal(readRelease(release({ tag_name: '1.3.0' })), null, 'a tag without its v')
  assert.equal(readRelease(release({ tag_name: 'v1.3.0-rc.1' })), null)
  assert.equal(readRelease(release({ draft: true })), null)
  assert.equal(readRelease(release({ prerelease: true })), null)
  for (const url of [
    'https://evil.example.com/usetuff/tuff/releases/tag/v1.3.0',
    'https://github.com/someone/tuff/releases/tag/v1.3.0',
    'http://github.com/usetuff/tuff/releases/tag/v1.3.0',
    'https://github.com/usetuff/tuff/releases/tag/v1.3.0?x=<script>',
    'javascript:alert(1)',
  ]) {
    assert.equal(readRelease(release({ html_url: url })), null, url)
  }
  assert.equal(readRelease(null), null)
  assert.equal(readRelease('v1.3.0'), null)
  assert.equal(readRelease({ message: 'API rate limit exceeded' }), null)
})

test('the check asks once, with Tuff/<version> and nothing about the server, and keeps the answer', async () => {
  const { d, asked, kept } = deps()
  assert.equal(await checkForRelease(d), 'heard')
  assert.equal(asked.length, 1)
  assert.equal(asked[0]!.url, RELEASES_LATEST)
  assert.equal(RELEASES_LATEST, 'https://api.github.com/repos/usetuff/tuff/releases/latest')
  const init = asked[0]!.init!
  assert.equal(init.method ?? 'GET', 'GET')
  assert.equal(init.body, undefined)
  assert.deepEqual(init.headers, { accept: 'application/vnd.github+json', 'user-agent': 'Tuff/1.2.0' })
  assert.ok(init.signal, 'a timeout')
  assert.deepEqual(kept, [readRelease(release())])
})

test('nothing is asked on the service, when it is off, from a build at 0.0.0, or within a day', async () => {
  for (const [over, said] of [
    [{ instance: false }, 'service'],
    [{ enabled: false }, 'off'],
    [{ version: '0.0.0' }, 'unreleased'],
    [{ version: 'unknown' }, 'unreleased'],
    [{ due: async () => false }, 'not_due'],
  ] as const) {
    const { d, asked, kept } = deps(over)
    assert.equal(await checkForRelease(d), said)
    assert.equal(asked.length, 0, said)
    assert.deepEqual(kept, [], said)
  }
})

test('a failure is quiet: the time is noted, nothing thrown, nothing logged', async () => {
  const lines: unknown[] = []
  const [log, error, warn] = [console.log, console.error, console.warn]
  console.log = console.error = console.warn = (...a: unknown[]) => void lines.push(a)
  try {
    for (const answer of [
      async () => {
        throw new TypeError('fetch failed')
      },
      async () => new Response('{"message":"API rate limit exceeded"}', { status: 403 }),
      async () => new Response('not json', { status: 200 }),
      async () => Response.json(release({ tag_name: 'nightly' })),
    ]) {
      const { d, kept } = deps({ answer })
      assert.equal(await checkForRelease(d), 'failed')
      assert.deepEqual(kept, [null], 'came to nothing: the time is noted, the last answer kept')
    }
    /* The database failing, either side of the request. */
    assert.equal(
      await checkForRelease(
        deps({
          due: async () => {
            throw new Error('db down')
          },
        }).d,
      ),
      'failed',
    )
    assert.equal(
      await checkForRelease(
        deps({
          keep: async () => {
            throw new Error('db down')
          },
        }).d,
      ),
      'failed',
    )
  } finally {
    console.log = log
    console.error = error
    console.warn = warn
  }
  assert.deepEqual(lines, [])
})

test('UPDATE_CHECK=off reads as off; empty or anything else leaves it on', () => {
  const was = process.env.UPDATE_CHECK
  try {
    for (const off of ['off', 'OFF', ' off ', 'false', 'no', '0']) {
      process.env.UPDATE_CHECK = off
      assert.equal(env.updateCheck, false, off)
    }
    for (const on of ['', 'on', 'true', 'yes']) {
      process.env.UPDATE_CHECK = on
      assert.equal(env.updateCheck, true, on)
    }
    delete process.env.UPDATE_CHECK
    assert.equal(env.updateCheck, true)
  } finally {
    if (was === undefined) delete process.env.UPDATE_CHECK
    else process.env.UPDATE_CHECK = was
  }
})

test('the job is the community edition’s alone', () => {
  /* `edition` is whichever edition this tree builds, the hosted service's or
     the community's; `community` is always the community edition's. */
  if (edition.plans) assert.equal(edition.jobs({ turned: () => Date.now() }).includes(releaseCheck), false, 'the service never asks')
  assert.deepEqual(community.jobs({ turned: () => Date.now() }), [releaseCheck])
  assert.equal(releaseCheck.every, 60 * 60 * 1000, 'hourly, and the database says whether a day has passed')
})
