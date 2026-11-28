import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { app } from '../src/http/routes.js'
import { closeDb, makeOwner } from './helpers.js'
import { wholeImage } from '../src/wholeImage.js'

after(async () => {
  await closeDb()
})

/*
 * A picture that is not all there is refused at the door, not stored.
 *
 * What production showed: progressive JPEGs cut off on their way up — a
 * character lost in base64 transport shifts every byte after it — listed
 * with the right sizes and the right dimensions, because those are read
 * off the header alone, and drew as a blur or a grey box, and nobody was
 * ever told. The originals on the agent's disk were sound. Now the upload
 * itself says the file is incomplete, with a 400 the agent reads, instead
 * of storing what cannot be drawn.
 *
 * Valid files are stored byte for byte, as they always were: the check
 * only reads.
 */

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAFElEQVR4nGM8ISfHgA0wYRUdtBIA0MoBFD5jqJkAAAAASUVORK5CYII='
const GIF = 'R0lGODdhCAAIAIEAAMgeHgAAAAAAAAAAACwAAAAACAAIAAAIDwABCBxIsKDBgwgTKkwYEAA7'
const GIF_ANIMATED =
  'R0lGODlhCAAIAIEAAMgeHgAAAAAAAAAAACH/C05FVFNDQVBFMi4wAwEAAAAsAAAAAAgACAAACA8AAQgcSLCgwYMIEypMGBAAIfkEAQAAAQAsAAAAAAgACACBZB4eAAAAAAAAAAAACA8AAQgcSLCgwYMIEypMGBAAOw=='
const WEBP = 'UklGRjoAAABXRUJQVlA4IC4AAACwAQCdASoIAAgAAUAmJaACdLoABDAAAP7x3I/4DdfFtMv/vYL/3YL/3YL/WwAA'
const JPEG_BASELINE =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAIAAgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDgKKKK+eP2E//Z'
const JPEG_PROGRESSIVE =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wgARCAAQABADASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAVAQEBAAAAAAAAAAAAAAAAAAAEBv/aAAwDAQACEAMQAAABihYH/8QAFBABAAAAAAAAAAAAAAAAAAAAIP/aAAgBAQABBQIf/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAIP/aAAgBAQAGPwIf/8QAFBABAAAAAAAAAAAAAAAAAAAAIP/aAAgBAQABPyEf/9oADAMBAAIAAwAAABD7/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPxB//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPxB//8QAFBABAAAAAAAAAAAAAAAAAAAAIP/aAAgBAQABPxAf/9k='

const bytes = (b64: string): Uint8Array<ArrayBuffer> => {
  const raw = Buffer.from(b64, 'base64')
  const out = new Uint8Array(raw.byteLength)
  out.set(raw)
  return out
}
const json = async (r: Response) => (await r.json()) as Record<string, unknown>

async function setUp() {
  const owner = await makeOwner()
  const as = { 'content-type': 'application/json', authorization: `Bearer ${owner.token}` }
  const project = (
    await json(await app.request('/api/projects', { method: 'POST', headers: as, body: JSON.stringify({ name: 'Pictures' }) }))
  ).id as string
  const upload = async (data: Uint8Array<ArrayBuffer>, name = 'picture', type = 'image/jpeg') => {
    const form = new FormData()
    form.set('file', new File([data], name, { type }))
    return app.request(`/api/projects/${project}/uploads`, {
      method: 'POST',
      headers: { authorization: `Bearer ${owner.token}` },
      body: form,
    })
  }
  return { owner, as, project, upload }
}

test('whole pictures of every kind are stored, byte for byte', async () => {
  const { owner, upload } = await setUp()
  for (const [b64, name, type] of [
    [PNG, 'a.png', 'image/png'],
    [GIF, 'a.gif', 'image/gif'],
    [GIF_ANIMATED, 'anim.gif', 'image/gif'],
    [WEBP, 'a.webp', 'image/webp'],
    [JPEG_BASELINE, 'a.jpg', 'image/jpeg'],
    [JPEG_PROGRESSIVE, 'p.jpg', 'image/jpeg'],
  ] as const) {
    const sent = bytes(b64)
    const r = await upload(sent, name, type)
    assert.equal(r.status, 201, `${name}: ${JSON.stringify(await r.clone().json())}`)
    const { id } = await json(r)
    /* And back exactly as sent — nothing altered. */
    const links = (await json(
      await app.request(`/api/files/${id}/url`, { headers: { authorization: `Bearer ${owner.token}`, 'x-api-version': '1' } }),
    )) as { url: string }
    const back = new Uint8Array(await (await app.request(links.url, { headers: { authorization: `Bearer ${owner.token}` } })).arrayBuffer())
    assert.equal(createHash('sha256').update(back).digest('hex'), createHash('sha256').update(sent).digest('hex'), name)
  }
})

test('a picture cut short is refused with a 400 that says so, whatever its kind', async () => {
  const { upload } = await setUp()
  for (const [b64, name, type] of [
    [PNG, 'a.png', 'image/png'],
    [GIF, 'a.gif', 'image/gif'],
    [WEBP, 'a.webp', 'image/webp'],
    [JPEG_BASELINE, 'a.jpg', 'image/jpeg'],
  ] as const) {
    const whole = bytes(b64)
    for (const cut of [Math.floor(whole.length / 2), whole.length - 2]) {
      const r = await upload(whole.subarray(0, cut), name, type)
      assert.equal(r.status, 400, `${name} cut at ${cut}`)
      const said = await json(r)
      assert.equal((said.error as { code: string }).code, 'broken')
    }
  }
})

/* The production case exactly: a progressive JPEG missing its end — the
   bytes that were stored and served and drawn as a blur before anybody
   looked. */
test('a progressive JPEG missing its EOI is refused', async () => {
  const { upload } = await setUp()
  const whole = bytes(JPEG_PROGRESSIVE)
  assert.equal(whole[whole.length - 2], 0xff)
  assert.equal(whole[whole.length - 1], 0xd9)
  const r = await upload(whole.subarray(0, whole.length - 2), 'p.jpg', 'image/jpeg')
  assert.equal(r.status, 400)
  const said = await json(r)
  assert.match((said.error as { message: string }).message, /incomplete/)
})

test('anything that is not a picture takes its own chances, as it always has', async () => {
  const { upload } = await setUp()
  const r = await upload(new TextEncoder().encode('plain words, not a picture at all'), 'notes.txt', 'text/plain')
  assert.equal(r.status, 201)
  const r2 = await upload(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]), 'doc.pdf', 'application/pdf')
  assert.equal(r2.status, 201)
})

test('the walk itself: edge cases without the door', () => {
  const png = bytes(PNG)
  const jpeg = bytes(JPEG_PROGRESSIVE)
  // Trailing bytes after the end are tolerated — encoders pad.
  assert.equal(wholeImage(new Uint8Array([...png, 0, 0])), 'png')
  assert.equal(wholeImage(new Uint8Array([...jpeg, 0, 0])), 'jpeg')
  // No picture inside at all is broken, not "valid".
  assert.equal(wholeImage(new Uint8Array([0xff, 0xd8, 0xff, 0xd9])), 'broken')
  // Not a picture: nothing to say.
  assert.equal(wholeImage(new Uint8Array([1, 2, 3, 4])), null)
})

/* An agent's base64 is strict now: one character outside the alphabet is
   refused with where it is, rather than dropped — which shifted every byte
   after it into corruption with a sound header. */
test('upload_file refuses invalid base64 and says where', async () => {
  const owner = await makeOwner()
  const as = { 'content-type': 'application/json', authorization: `Bearer ${owner.token}` }
  const project = (await json(await app.request('/api/projects', { method: 'POST', headers: as, body: JSON.stringify({ name: 'B64' }) })))
    .id as string
  const token = (
    await json(await app.request('/api/tokens', { method: 'POST', headers: as, body: JSON.stringify({ name: 'Claude Code' }) }))
  ).token as string
  let n = 0
  const tool = async (name: string, args: Record<string, unknown>) => {
    const r = await json(
      await app.request('/mcp', {
        method: 'POST',
        headers: { ...as, authorization: `Bearer ${token}`, accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++n, method: 'tools/call', params: { name, arguments: args } }),
      }),
    )
    return r.result as { content: { text: string }[]; isError?: boolean }
  }

  /* A character outside the alphabet: refused, with its place. Node's own
     decoder would have dropped it without a word. */
  const good = Buffer.from(bytes(PNG)).toString('base64')
  const withBad = good.slice(0, 40) + '-' + good.slice(41)
  const bad = await tool('upload_file', { project_id: project, name: 'a.png', content_base64: withBad })
  assert.equal(bad.isError, true)
  assert.match(bad.content[0]!.text, /not valid base64/)
  assert.match(bad.content[0]!.text, /position 40/)

  /* Whitespace-wrapped, as a long string often is: fine. */
  const wrapped = `${good.slice(0, 48)}\n${good.slice(48)}`
  const ok = await tool('upload_file', { project_id: project, name: 'a.png', content_base64: wrapped })
  assert.notEqual(ok.isError, true, ok.content[0]!.text)

  /* Valid base64 of a broken picture: the upload's own refusal, through. */
  const cut = Buffer.from(bytes(JPEG_PROGRESSIVE).subarray(0, 300)).toString('base64')
  const broken = await tool('upload_file', { project_id: project, name: 'p.jpg', content_base64: cut })
  assert.equal(broken.isError, true)
  assert.match(broken.content[0]!.text, /incomplete/)
})
