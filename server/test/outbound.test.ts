import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type AddressInfo } from 'node:net'
import type { LookupAddress } from 'node:dns'
import { guardedLookup, outward, privateAddress, publicHttps, pushService, type Resolve } from '../src/outbound.js'

/*
 * DNS rebinding. A name whose server
 * answers a public address the first time it is asked and the server's own
 * the second. Checked with one lookup and connected with another, the check
 * saw the first answer and the socket the second.
 */
test('a webhook cannot be rebound between the check and the connection', async () => {
  // What the attacker's name server would reach: a port on this machine.
  let reached = 0
  const inside = createServer((s) => {
    reached++
    s.destroy()
  })
  await new Promise<void>((r) => inside.listen(0, '127.0.0.1', r))
  const port = (inside.address() as AddressInfo).port
  try {
    let asked = 0
    const rebinding: Resolve = (_host, done) => {
      asked++
      // Public to the check; on a random port, nothing answers there in time.
      done(null, asked === 1 ? [{ address: '8.8.8.8', family: 4 }] : [{ address: '127.0.0.1', family: 4 }])
    }
    await assert.rejects(outward(`https://rebind.example:${port}/hook`, { body: '{}' }, { resolve: rebinding, timeoutMs: 300 }))
    assert.equal(asked, 1, 'the name is looked up once, and the socket is given that answer')
    assert.equal(reached, 0, 'nothing inside was reached')

    // A name that answers the inside at the moment of connecting is refused there.
    const inward: Resolve = (_host, done) => done(null, [{ address: '127.0.0.1', family: 4 }])
    await assert.rejects(
      outward(`https://rebind.example:${port}/hook`, { body: '{}' }, { resolve: inward }),
      (e: NodeJS.ErrnoException) => e.code === 'EPRIVATE',
    )
    // One private answer among public ones is as bad as all of them.
    const mixed: Resolve = (_host, done) =>
      done(null, [
        { address: '8.8.8.8', family: 4 },
        { address: '::ffff:127.0.0.1', family: 6 },
      ])
    await assert.rejects(
      outward(`https://rebind.example:${port}/hook`, { body: '{}' }, { resolve: mixed }),
      (e: NodeJS.ErrnoException) => e.code === 'EPRIVATE',
    )
    assert.equal(reached, 0)
    // Written as an address, or not https, it never gets as far as a lookup.
    await assert.rejects(outward(`https://127.0.0.1:${port}/hook`, { body: '{}' }))
    await assert.rejects(outward(`http://rebind.example:${port}/hook`, { body: '{}' }, { resolve: rebinding }))
    assert.equal(reached, 0)
  } finally {
    inside.close()
  }

  // And a public answer goes to the socket as it was checked.
  const got = await new Promise<string | LookupAddress[]>((r, j) =>
    guardedLookup((_h, done) => done(null, [{ address: '8.8.8.8', family: 4 }]))('x.example', { all: true }, (e, a) => (e ? j(e) : r(a))),
  )
  assert.deepEqual(got, [{ address: '8.8.8.8', family: 4 }])
})

/* `outbound.ts`: the server only calls addresses on the public internet. */
test('a webhook or a push endpoint cannot point the server inside its own network', async () => {
  for (const ip of [
    '127.0.0.1',
    '10.1.2.3',
    '172.20.0.1',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '::1',
    'fd00::1',
    '::ffff:127.0.0.1',
  ])
    assert.equal(privateAddress(ip), true, ip)
  assert.equal(privateAddress('8.8.8.8'), false)
  // The 6to4 relay and the documentation blocks.
  for (const ip of ['192.88.99.1', '198.51.100.7', '203.0.113.7', '::ffff:203.0.113.7']) assert.equal(privateAddress(ip), true, ip)
  for (const ip of ['192.88.98.1', '198.51.101.1', '203.0.114.1']) assert.equal(privateAddress(ip), false, ip)
  assert.equal(await publicHttps('http://8.8.8.8/hook'), false, 'https only')
  assert.equal(await publicHttps('https://127.0.0.1/hook'), false)
  assert.equal(await publicHttps('https://169.254.169.254/latest/meta-data'), false)
  assert.equal(await publicHttps('https://postgres.railway.internal/x'), false)
  assert.equal(await publicHttps('https://localhost/x'), false)
  assert.equal(await publicHttps('https://[::ffff:127.0.0.1]/hook'), false, 'mapped, as the parser writes it')
  assert.equal(await publicHttps('https://[::ffff:a9fe:a9fe]/x'), false)
  assert.equal(privateAddress('fe90::1'), true)
  // IPv6 is public only in global unicast: every other form is refused,
  // including the ones nobody thought to list.
  for (const ip of [
    '::',
    '::7f00:1',
    '::127.0.0.1',
    '64:ff9b::7f00:1',
    '2002:7f00:1::1',
    '2001:db8::1',
    '2001::1',
    'ff02::1',
    '100::1',
    'fe80::1%en0',
  ])
    assert.equal(privateAddress(ip), true, ip)
  for (const ip of ['2607:f8b0:4005:80a::200e', '2a00:1450:4001:82a::200e', '::ffff:8.8.8.8']) assert.equal(privateAddress(ip), false, ip)
  assert.equal(await publicHttps('https://8.8.8.8/hook'), true)
  assert.equal(pushService('https://fcm.googleapis.com/fcm/send/abc'), true)
  assert.equal(pushService('https://web.push.apple.com/abc'), true)
  assert.equal(pushService('https://evil.example/fcm.googleapis.com'), false)
  assert.equal(pushService('http://fcm.googleapis.com/x'), false)
})
