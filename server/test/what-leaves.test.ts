import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

/*
 * Every outside address written in the code that ships, and why it is
 * there.
 *
 * `docs/self-hosting.md`, "What leaves your server", tells somebody running
 * Tuff what their server and its pages send, and to whom. A promise like that
 * stays true only while somebody checks it: an address added to the code
 * fails here until it is named below, and, if anything is sent to it, in
 * that section too.
 *
 * What this reads is addresses written in the code. An address that comes
 * from a setting or from a person — a webhook, a link being previewed, a
 * bucket — is not in the code, and the guide names those separately.
 */

/** Asked for something: by the server, or by the page in somebody's browser. */
const SENT: Record<string, string> = {
  'api.github.com': 'the daily release check; GitHub sign-in, the GitHub App and importing issues',
  'github.com': 'GitHub sign-in and the GitHub App trade their codes here; also links to the repository',
  'api.resend.com': 'mail, with RESEND_API_KEY',
  'accounts.google.com': 'Google sign-in',
  'oauth2.googleapis.com': 'Google sign-in, and the token Android pushes are sent with',
  'www.googleapis.com': "Google's keys, to check a Google sign-in",
  'appleid.apple.com': 'Apple sign-in, and its keys',
  'slack.com': 'the Slack app',
  'api.push.apple.com': 'iPhone pushes, with APNS_KEY',
  'api.sandbox.push.apple.com': 'iPhone pushes from a development build',
  'fcm.googleapis.com': 'Android pushes, with FCM_SERVICE_ACCOUNT',
  'challenges.cloudflare.com': "a feedback page's Turnstile, with its keys",
  'api.klipy.com': 'the GIF button, from the browser, with KLIPY_API_KEY',
  'api.linear.app': 'importing from Linear, with the token somebody pastes',
  'app.asana.com': 'importing from Asana, with the token somebody pastes',
  'api.anthropic.com': "a Claude Code routine's URL, which somebody pastes; the code names it to check one",
}

/** Written in the code and asked for nothing. */
const NAMED: Record<string, string> = {
  'raw.githubusercontent.com': "a link to the API's schema, in what the server says about itself",
  'schemas.agentskills.io': 'the schema a discovery document names',
  'www.rfc-editor.org': 'a link to the standard a discovery document follows',
  'www.w3.org': "SVG's namespace",
  'tuff.example.com': 'an example address in a message',
  'apps.apple.com': 'a link to the iPhone app',
  'mail.google.com': 'a button that opens your inbox',
  'mail.yahoo.com': 'a button that opens your inbox',
  'outlook.live.com': 'a button that opens your inbox',
  'www.icloud.com': 'a button that opens your inbox',
  'cloudflareinsights.com': "allowed by the page's policy only on usetuff.com's own pages, which this edition does not have",
  'static.cloudflareinsights.com': "allowed by the page's policy only on usetuff.com's own pages, which this edition does not have",
}

const root = join(import.meta.dirname, '..', '..')

function* files(dir: string): Generator<string> {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    /* The service's own code, where this repository carries it, does not ship. */
    if (e.name === 'cloud' || e.name === 'node_modules') continue
    const p = join(dir, e.name)
    if (e.isDirectory()) yield* files(p)
    else if (/\.tsx?$/.test(e.name) && !e.name.endsWith('.d.ts')) yield p
  }
}

/* Where a repository holds both editions, the community one is what ships;
   where it holds one, that one is. */
function ships(path: string): boolean {
  const m = /(^|\/)edition\.(tsx?)$/.exec(path)
  return !m || !existsSync(path.replace(/edition\.tsx?$/, `edition.community.${m[2]}`))
}

/* Comments cite addresses as sources and are not code. A comment here opens
   after a space, a line's start or a brace; `https://` and a glob like
   `'/assets/*'` do not. */
const uncommented = (s: string) => s.replace(/(^|[\s{(])\/\*[\s\S]*?\*\//g, '$1').replace(/(^|\s)\/\/.*$/gm, '$1')

function hosts(): Map<string, string[]> {
  const found = new Map<string, string[]>()
  for (const dir of ['server/src', 'web/src', 'shared-schema/src']) {
    for (const f of files(join(root, dir))) {
      if (!ships(f)) continue
      for (const m of uncommented(readFileSync(f, 'utf8')).matchAll(/https?:\/\/([a-z0-9-]+(?:\.[a-z0-9-]+)+)/gi)) {
        const h = m[1]!.toLowerCase()
        const where = relative(root, f)
        const had = found.get(h) ?? []
        if (!had.includes(where)) found.set(h, [...had, where])
      }
    }
  }
  return found
}

test('every outside address in the code is one this test knows why', () => {
  const found = hosts()
  /* Read at all, or the test passes on nothing. */
  assert.ok(found.has('api.github.com'), 'the scan found the release check')
  const unknown = [...found].filter(([h]) => !(h in SENT) && !(h in NAMED)).map(([h, w]) => `${h} (${w.join(', ')})`)
  assert.deepEqual(unknown, [], 'an outside address is new: name it in SENT or NAMED here, and in the guide if anything goes to it')
})

test('every address something is sent to is in the guide', () => {
  const guide = readFileSync(join(root, 'docs/self-hosting.md'), 'utf8')
  const at = guide.indexOf('\n## What leaves your server\n')
  assert.ok(at >= 0, 'the guide has its section')
  const end = guide.indexOf('\n## ', at + 1)
  const section = guide.slice(at, end < 0 ? undefined : end)
  const missing = Object.keys(SENT).filter((h) => !section.includes(`\`${h}\``))
  assert.deepEqual(missing, [], 'docs/self-hosting.md, "What leaves your server", names each of these')
})

test('nothing on either list is left over from code that is gone', () => {
  const found = hosts()
  const stale = [...Object.keys(SENT), ...Object.keys(NAMED)].filter((h) => !found.has(h))
  assert.deepEqual(stale, [], 'no longer in the code: take it off the list here, and out of the guide')
})
