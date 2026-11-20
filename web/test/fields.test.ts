import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

/*
 * A password field is a login to every browser, whatever its `autocomplete`
 * says: the agent window's key was one, and the browser offered the person's
 * saved sign-ins over the webhook URL above it — `ui/kit/fields.tsx`. Only
 * the ways in and the asking again for a password may have one; a key, a
 * token or a secret is `SecretInput`.
 */
const SRC = fileURLToPath(new URL('../src/', import.meta.url))

/** The files that hold a password somebody signs in with, and why. */
const LOGINS = new Map([
  ['ui/Access.tsx', 'PasswordField: signing in, signing up, a reset, a new password'],
  ['ui/WaysIn.tsx', 'the password asked again before a way in is taken off'],
  ['ui/account/security.tsx', 'the password asked again before two-step is turned off'],
  ['ui/account/yourData.tsx', 'the password asked again before the account is deleted'],
  ['ui/account/face.tsx', 'the password asked again before the email is changed'],
])

/** The code, without what its comments say about password fields. */
const code = (f: string) =>
  readFileSync(f, 'utf8')
    .replace(/(^|[\s{])\/\*[\s\S]*?\*\//g, '$1')
    .replace(/^\s*\/\/.*$/gm, '')

const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith('.tsx') ? [join(dir, e.name)] : [],
  )

test('no field outside the ways in is a password field', () => {
  const found: string[] = []
  for (const f of files(SRC)) {
    const s = code(f)
    if (/type=["']password["']|type=\{[^}]*'password'/.test(s)) found.push(relative(SRC, f))
  }
  assert.deepEqual(found.filter((f) => LOGINS.has(f)).sort(), [...LOGINS.keys()].sort(), 'the scan finds every way in')
  assert.deepEqual(
    found.filter((f) => !LOGINS.has(f)),
    [],
    'a key or a token is a SecretInput, never type="password"',
  )
})

test('a password field says which password it is', () => {
  for (const f of files(SRC)) {
    const s = code(f)
    for (const m of s.matchAll(/<input\b[^>]*?type=(?:"password"|\{[^}]*'password'[^}]*\})[\s\S]*?\/>/g)) {
      assert.match(m[0], /autoComplete=(?:"(?:current|new)-password"|\{)/, `${relative(SRC, f)}: ${m[0].slice(0, 80)}`)
    }
  }
})
