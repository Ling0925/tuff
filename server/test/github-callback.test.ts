import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'

/* A deployment at an address of its own, and the GitHub App a person
   connects in Account settings — before anything reads the environment. */
process.env.APP_URL = 'https://tuff.example.org/'
process.env.GITHUB_CLIENT_ID = 'app-client'
process.env.GITHUB_CLIENT_SECRET = 'app-secret'
process.env.GITHUB_WEBHOOK_SECRET = 'test-secret'
process.env.GITHUB_APP_ID = '1'
process.env.GITHUB_PRIVATE_KEY = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({
  type: 'pkcs1',
  format: 'pem',
}) as string

const { app } = await import('../src/http/routes.js')
const { registerUser } = await import('../src/auth/flows.js')
const { closeDb } = await import('./helpers.js')

after(async () => {
  await closeDb()
})

/* A fake GitHub that writes down the redirect_uri every trade was sent with. */
const traded: string[] = []
const id = 8_000_000 + Math.floor(Math.random() * 1_000_000)
const real = globalThis.fetch
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (!url.startsWith('https://github.com/') && !url.startsWith('https://api.github.com/')) return real(input, init)
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } })
  if (url === 'https://github.com/login/oauth/access_token') {
    const raw = String(init?.body ?? '')
    const f: Record<string, string> = raw.startsWith('{') ? JSON.parse(raw) : Object.fromEntries(new URLSearchParams(raw))
    traded.push(f.redirect_uri ?? '')
    if (f.code !== 'the-code' || f.client_secret !== 'app-secret') return json({ error: 'bad_verification_code' })
    return json({ access_token: 'gho_callback', token_type: 'bearer', scope: '' })
  }
  if (url === 'https://api.github.com/user') return json({ id, login: `octo${id}`, name: null, avatar_url: null })
  return json({ message: 'Not Found' }, 404)
}) as typeof fetch

/*
 * GitHub sends a person back to this deployment's own address, from
 * `APP_URL`, and the code is traded with the same one — never the
 * service's, which a server of somebody else's cannot receive.
 */
test('connecting GitHub sends the person back to APP_URL, and trades the code with the same address', async () => {
  const stamp = Date.now().toString(36)
  const me = await registerUser({
    email: `callback${stamp}@example.com`,
    password: 'correct-horse-battery-staple',
    name: 'Cal',
    workspace_name: `C ${stamp}`,
  })
  const start = await app.request('/api/github/me/start', { method: 'POST', headers: { authorization: `Bearer ${me.access_token}` } })
  assert.equal(start.status, 200)
  const to = new URL(((await start.json()) as { url: string }).url)
  assert.equal(to.origin + to.pathname, 'https://github.com/login/oauth/authorize')
  assert.equal(to.searchParams.get('redirect_uri'), 'https://tuff.example.org/auth/github/callback')

  const done = await app.request('/api/github/me', {
    method: 'POST',
    headers: { authorization: `Bearer ${me.access_token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ code: 'the-code', state: to.searchParams.get('state') }),
  })
  assert.equal(done.status, 201)
  assert.deepEqual(traded, ['https://tuff.example.org/auth/github/callback'])
})
