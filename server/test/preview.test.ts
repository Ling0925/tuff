import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { app } from '../src/http/routes.js'
import { cardFrom, readCard } from '../src/http/preview.js'
import { closeDb, makeOwner } from './helpers.js'

after(closeDb)

/** The server is not a way into its own network. */
test('a card is not read from a private address, or from anything but the web', async () => {
  const { token } = await makeOwner()
  const ask = (url: string) => app.request(`/api/preview?url=${encodeURIComponent(url)}`, { headers: { authorization: `Bearer ${token}` } })
  for (const url of [
    'http://127.0.0.1:8787/api/me',
    'http://localhost:5432',
    'http://169.254.169.254/latest/meta-data',
    'http://10.0.0.1/',
    'http://[::1]/',
  ]) {
    assert.equal((await ask(url)).status, 422, url)
  }
  for (const url of ['file:///etc/passwd', 'ftp://example.com', 'javascript:alert(1)']) {
    assert.equal((await ask(url)).status, 400, url)
  }
  assert.equal((await app.request('/api/preview?url=https://example.com')).status, 401)
})

/* The guard as an attacker meets it: something really listening on the
   machine, asked for by every way of writing its address. Port 80 above
   has nothing on it, so a refusal there proved nothing. */
test('an address written as an IPv6 literal is refused before anything is asked', async () => {
  const hits: string[] = []
  const listen = (host: string) =>
    new Promise<{ port: number; close: () => void }>((done) => {
      const s = createServer((req, res) => {
        hits.push(`${host} ${req.url}`)
        res.writeHead(200, { 'content-type': 'text/html' })
        res.end('<html><head><title>Inside</title></head></html>')
      })
      s.listen(0, host, () => done({ port: (s.address() as AddressInfo).port, close: () => s.close() }))
    })
  const four = await listen('127.0.0.1')
  const six = await listen('::1')
  try {
    for (const url of [
      `http://127.0.0.1:${four.port}/`,
      `http://[::ffff:127.0.0.1]:${four.port}/`,
      `http://[::ffff:7f00:1]:${four.port}/`,
      `http://[::1]:${six.port}/`,
      `http://[::]:${six.port}/`,
      `http://[0:0:0:0:0:0:0:1]:${six.port}/`,
    ]) {
      assert.equal(await readCard(url), null, url)
    }
    assert.deepEqual(hits, [])
  } finally {
    four.close()
    six.close()
  }
})

/* A page made to be read slowly: a megabyte of `<meta` with no end, a
   title opened and never closed, a character past Unicode. Read whole it
   was minutes of a server doing nothing else; only the head is read now. */
/* How long it takes is `bench/parsers.bench.ts`. */
test('a page made to be slow to read comes to nothing, and a number past Unicode is no error', () => {
  const at = new URL('https://example.com/x')
  assert.equal(cardFrom('<meta'.repeat(200_000) + '<title'.repeat(100_000), at.href, at), null)
  const card = cardFrom(
    '<head><meta property="og:title" content="Fine &#9999999; &#x41;"><meta name="description" content="d"></head>',
    at.href,
    at,
  )
  assert.equal(card?.title, 'Fine  A')
  assert.equal(card?.description, 'd')
  assert.equal(cardFrom('<head><title>Plain</title></head>', at.href, at)?.title, 'Plain')
})
