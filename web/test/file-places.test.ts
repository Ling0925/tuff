import { test } from 'node:test'
import assert from 'node:assert/strict'

/*
 * Each of Files' places has an address:
 * `/files/docs`, `/files/images`, `/files/uploads`, `/files/links` and
 * Recently Deleted at `/files/deleted`, while `/files/7` is still a file.
 */
;(globalThis as { location?: unknown }).location = new URL('https://usetuff.test/')
const { format, known, parse } = await import('../src/data/route.js')

const P = '0190a000-0000-7000-8000-000000000001'
known({ workspace: 'acme', projects: [{ id: P, slug: 'site' }] })

test('a place in Files is read from its address and written back to it', () => {
  for (const kind of ['docs', 'images', 'uploads', 'links', 'deleted']) {
    const r = parse(`/acme/site/files/${kind}`)
    assert.deepEqual(r, { view: 'projects', projectId: P, tool: 'files', kind }, kind)
    assert.equal(format(r), `/acme/site/files/${kind}`)
  }
})

test('a number after files is still a file, and a bare /files names no place', () => {
  assert.deepEqual(parse('/acme/site/files/7'), { view: 'projects', projectId: P, tool: 'files', at: 7 })
  assert.deepEqual(parse('/acme/site/files'), { view: 'projects', projectId: P, tool: 'files' })
  assert.equal(format({ view: 'projects', projectId: P, tool: 'files' }), '/acme/site/files')
})

test('a file open wins over the place it was opened from', () => {
  assert.equal(format({ view: 'projects', projectId: P, tool: 'files', kind: 'images', at: 7 }), '/acme/site/files/7')
})

test('the words mean a place only under files', () => {
  assert.deepEqual(parse('/acme/site/tasks/deleted'), { view: 'projects', projectId: P, tool: 'tasks', objectId: 'deleted' })
  assert.equal(format({ view: 'projects', projectId: P, tool: 'posts', kind: 'images' }), '/acme/site/posts')
  assert.deepEqual(parse('/acme/site/files/whatever'), { view: 'projects', projectId: P, tool: 'files', objectId: 'whatever' })
})
