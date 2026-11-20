import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { app } from '../src/http/routes.js'
import { appleAppId } from '../src/http/apple.js'
import { androidPackage } from '../src/http/android.js'
import { edition as community } from '../src/edition.js'
import { closeDb } from './helpers.js'

after(async () => {
  await closeDb()
})

/*
 * Which app is named: `APPLE_APP_ID`, else the service's own — and on your
 * own server, whose edition names none, no app and no file at all.
 */
test('the Apple app is the one APPLE_APP_ID names, and none on a server that names none', async () => {
  assert.equal(appleAppId('TEAM123456.org.example.tuff', '3ZVQY87SW6.com.usetuff.app'), 'TEAM123456.org.example.tuff')
  assert.equal(appleAppId(undefined, '3ZVQY87SW6.com.usetuff.app'), '3ZVQY87SW6.com.usetuff.app')
  assert.equal(appleAppId('  ', null), null)
  assert.equal(appleAppId(undefined, null), null)

  const was = process.env.APPLE_APP_ID
  process.env.APPLE_APP_ID = 'TEAM123456.org.example.tuff'
  try {
    const r = await app.request('/.well-known/apple-app-site-association')
    const said = (await r.json()) as { applinks: { details: { appIDs: string[] }[] }; webcredentials: { apps: string[] } }
    assert.deepEqual(said.applinks.details[0]?.appIDs, ['TEAM123456.org.example.tuff'])
    assert.deepEqual(said.webcredentials.apps, ['TEAM123456.org.example.tuff'])
  } finally {
    if (was === undefined) delete process.env.APPLE_APP_ID
    else process.env.APPLE_APP_ID = was
  }
})

/* On your own server no package of the service's is named for your certificates. */
test('the Android package is the one ANDROID_PACKAGE names, and none on a server that names none', async () => {
  assert.equal(androidPackage('org.example.tuff', 'com.usetuff.app'), 'org.example.tuff')
  assert.equal(androidPackage(undefined, 'com.usetuff.app'), 'com.usetuff.app')
  assert.equal(androidPackage(' ', community.vendor?.androidPackage ?? null), null)

  const cert = Array.from({ length: 32 }, (_, i) => (i * 3).toString(16).padStart(2, '0')).join(':')
  process.env.ANDROID_CERT_SHA256 = cert
  process.env.ANDROID_PACKAGE = 'org.example.tuff'
  try {
    const r = await app.request('/.well-known/assetlinks.json')
    const [said] = (await r.json()) as { target: { package_name: string } }[]
    assert.equal(said?.target.package_name, 'org.example.tuff')
  } finally {
    delete process.env.ANDROID_CERT_SHA256
    delete process.env.ANDROID_PACKAGE
  }
})
