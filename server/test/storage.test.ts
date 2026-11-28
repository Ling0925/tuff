import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { closeDb, withActor, uuidv7, makeOwner, addPerson, makeProject, bearerFor } from './helpers.js'
import { get, put, signKey, verifyKey } from '../src/storage.js'
import { app } from '../src/http/routes.js'

/* A small valid JPEG, for the copy for showing posts: the route asks
   wholeness of what it stores now, and the twelve header bytes these were
   are not a picture. */
const SMALL_JPEG = new Uint8Array(
  Buffer.from(
    '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAIAAgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDgKKKK+eP2E//Z',
    'base64',
  ),
)
/*
 * The tests' own directory is emptied before a run, by the test script,
 * and not here.
 *
 * This removed `.storage` once — the directory the dev server keeps
 * uploads in, since both run from `server/` — and every `pnpm check`
 * deleted every file anybody had put in locally, `ours` included. Then it
 * removed `.storage-test` when this file finished, and the files run side
 * by side: a board's pictures written in that moment went with it, and
 * "a picture the board does not keep leaves no bytes behind" counted seven
 * of its ten, in the full run only.
 */
after(async () => {
  await closeDb()
})

test('a signed link expires and cannot be moved to another key', async () => {
  const stored = await put('ws-1', new TextEncoder().encode('hello'), 'text/plain')
  const token = signKey(stored.key)

  assert.ok(verifyKey(stored.key, token))
  // The signature covers the key, so a link to one document is not a link to
  // the next id along.
  assert.equal(verifyKey('ws-1/something-else', token), false)

  const expired = signKey(stored.key, -1)
  // Expiry is the whole point: this route is reached with a link, and a link
  // that outlives its permission check is a public URL with extra steps.
  assert.equal(verifyKey(stored.key, expired), false)

  const bytes = await get(stored.key)
  assert.equal(new TextDecoder().decode(bytes!), 'hello')
})

/**
 * The link, fetched the way a browser fetches it: with no bearer token.
 *
 * Everything above this asks `verifyKey` directly, and `verifyKey` was
 * always right. What nothing asked was whether the route could be reached —
 * it sits under `/api/*`, which required an `Authorization` header, and an
 * `<img src>` sends none. So every project icon and every uploaded file
 * answered 401 in a browser while this file was green.
 *
 * The header is left off on purpose. Putting one on is what a test does
 * without thinking, and it is the one thing that makes this pass wrongly.
 */
test('a signed link is fetched by a browser, which sends no token', async () => {
  const stored = await put('ws-link', new TextEncoder().encode('a picture'), 'image/png')
  const url = `/api/blob/${encodeURIComponent(stored.key)}?token=${signKey(stored.key)}`

  const r = await app.request(url)
  assert.equal(r.status, 200, 'the signature is the authorisation here, not a bearer token')
  assert.equal(await r.text(), 'a picture')

  // And the signature is still the whole of it: a wrong one is refused, with
  // no bearer to fall back on.
  const wrong = `/api/blob/${encodeURIComponent(stored.key)}?token=1.nonsense`
  assert.equal((await app.request(wrong)).status, 403)
  assert.equal((await app.request(`/api/blob/${encodeURIComponent(stored.key)}`)).status, 403)

  // An expired one too, which is what keeps a link out of a screenshot from
  // being a public URL.
  const stale = `/api/blob/${encodeURIComponent(stored.key)}?token=${signKey(stored.key, -1)}`
  assert.equal((await app.request(stale)).status, 403)
})

test('a key carries its workspace', async () => {
  const stored = await put('ws-abc', new Uint8Array([1, 2, 3]), 'application/octet-stream')
  // So a path bug in a later driver cannot reach another tenant's prefix even
  // if the id came from outside.
  assert.ok(stored.key.startsWith('ws-abc/'))
})

test('storage is counted per workspace and not across them', async () => {
  const a = await makeOwner()
  const b = await makeOwner()
  const p = await makeProject(a.ctx, a.workspaceId, 'Acme')

  await withActor(a.ctx.actorId, async (tx) => {
    await tx`
      insert into file (id, workspace_id, project_id, author_id, name, storage_key,
                        size_bytes, uploaded_at)
      values (${uuidv7()}, ${a.workspaceId}, ${p}, ${a.ctx.actorId}, 'big.bin', 'k', 1000, now())`
  })

  const [mine] = await withActor(a.ctx.actorId, (tx) => tx<{ bytes: string }[]>`select workspace_storage_bytes(${a.workspaceId}) as bytes`)
  const [theirs] = await withActor(
    b.ctx.actorId,
    (tx) => tx<{ bytes: string }[]>`select workspace_storage_bytes(${b.workspaceId}) as bytes`,
  )
  // A flat price per workspace needs a ceiling per workspace, and one
  // customer's uploads must not count against another's.
  assert.equal(Number(mine!.bytes), 1000)
  assert.equal(Number(theirs!.bytes), 0)
})

/**
 * Asking for it as a download, which is a header and not a route.
 *
 * The name travels in the link because this route
 * has only a key — and a filename is user input going verbatim into a
 * header, which is the part worth testing.
 */
test('a link can ask for the file to be saved, and the name cannot break the header', async () => {
  const { workspaceId } = await makeOwner()
  const stored = await put(workspaceId, new TextEncoder().encode('bytes'), 'text/plain')
  const link = (q: string) => `/api/blob/${encodeURIComponent(stored.key)}?token=${signKey(stored.key)}${q}`

  // Without it, the bytes are shown rather than saved.
  const shown = await app.request(link(''))
  assert.equal(shown.status, 200)
  assert.equal(shown.headers.get('content-disposition'), null)

  const saved = await app.request(link('&download=1&name=notes.txt'))
  assert.equal(saved.status, 200)
  assert.equal(saved.headers.get('content-disposition'), `attachment; filename="notes.txt"; filename*=UTF-8''notes.txt`)

  /* Opened with its name, it is shown — and if the browser cannot show it
     and saves it instead, it saves it under that name, not the address. */
  const opened = await app.request(link('&name=notes.txt'))
  assert.equal(opened.headers.get('content-disposition'), `inline; filename="notes.txt"; filename*=UTF-8''notes.txt`)

  // A name in another alphabet is a header still, and arrives whole.
  const cyrillic = await app.request(link(`&download=1&name=${encodeURIComponent('Резюме.pdf')}`))
  const header = cyrillic.headers.get('content-disposition') ?? ''
  assert.ok(header.includes(`filename*=UTF-8''${encodeURIComponent('Резюме.pdf')}`), header)
  assert.ok(/^[\x20-\x7e]*$/.test(header), header)

  /*
   * A name with a quote and a newline in it cannot end the header early or
   * add another. Header injection through a filename is the oldest version
   * of this mistake, and the filename here is whatever somebody called the
   * file when they uploaded it.
   */
  const nasty = await app.request(link(`&download=1&name=${encodeURIComponent('a".txt\r\nX-Evil: yes')}`))
  assert.equal(nasty.status, 200)
  assert.equal(nasty.headers.get('x-evil'), null)
  const said = nasty.headers.get('content-disposition') ?? ''
  assert.ok(!said.includes('\r') && !said.includes('\n'), said)
  assert.equal(said.split('"').length, 3, `one pair of quotes, got ${said}`)

  // And a name made entirely of what is stripped still lands as something.
  const empty = await app.request(link(`&download=1&name=${encodeURIComponent('<>|?*')}`))
  assert.equal(empty.headers.get('content-disposition'), `attachment; filename="file"; filename*=UTF-8''file`)

  /* The signature does not cover the parameter, which is the documented
     trade — but it still covers the key, so a download of something else
     is refused exactly as a view of it would be. */
  const other = await put(workspaceId, new TextEncoder().encode('not yours'), 'text/plain')
  const forged = `/api/blob/${encodeURIComponent(other.key)}?token=${signKey(stored.key)}&download=1`
  assert.equal((await app.request(forged)).status, 403)
})

/**
 * A video asks for a part, and gets that part.
 *
 * The route read the whole object into memory and sent all of it to every
 * request, so a `<video>` asking for its opening second waited for the whole
 * file, could not be scrubbed, and would not play in Safari at all, which
 * asks for ranges and gives up on a server that ignores them.
 */
test('a range is answered with that range, typed from the start of the file', async () => {
  // An mp4's opening box, then a body long enough to cut into.
  const head = [0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]
  const bytes = new Uint8Array([...head, ...Array.from({ length: 500 }, (_, i) => i % 256)])
  const stored = await put('ws-range', bytes, 'video/mp4')
  const link = `/api/blob/${encodeURIComponent(stored.key)}?token=${signKey(stored.key)}`

  const whole = await app.request(link)
  assert.equal(whole.status, 200)
  assert.equal(whole.headers.get('accept-ranges'), 'bytes')
  assert.equal(whole.headers.get('content-type'), 'video/mp4')
  assert.equal((await whole.arrayBuffer()).byteLength, bytes.length)

  // From the middle: the type is still known, though the first bytes are
  // not in this answer.
  const part = await app.request(link, { headers: { range: 'bytes=100-199' } })
  assert.equal(part.status, 206)
  assert.equal(part.headers.get('content-range'), `bytes 100-199/${bytes.length}`)
  assert.equal(part.headers.get('content-type'), 'video/mp4')
  assert.deepEqual(new Uint8Array(await part.arrayBuffer()), bytes.slice(100, 200))

  // Open-ended, as a video's first request is.
  const rest = await app.request(link, { headers: { range: 'bytes=500-' } })
  assert.equal(rest.status, 206)
  assert.deepEqual(new Uint8Array(await rest.arrayBuffer()), bytes.slice(500))

  // Past the end is refused rather than answered with nothing.
  const past = await app.request(link, { headers: { range: `bytes=${bytes.length + 10}-` } })
  assert.equal(past.status, 416)
})

/**
 * The same link for the same bytes, inside a window.
 *
 * A link made from the second it was asked for was a new URL on every
 * response, so the browser's cache — which keys on the whole URL — never
 * served a picture twice.
 */
test('a link signed twice in a row is the same link, and good for at least its window', () => {
  const a = signKey('ws/k', 3600)
  const b = signKey('ws/k', 3600)
  assert.equal(a, b)
  const expires = Number(a.split('.')[0])
  const now = Math.floor(Date.now() / 1000)
  assert.ok(expires - now >= 3600)
  assert.ok(expires - now <= 7200)
  assert.ok(verifyKey('ws/k', a))
})

/**
 * A file's link opens for the person it was made for, and nobody else.
 *
 * It used to stand on its own: pasted anywhere, it opened the file for the
 * rest of its hour, signed in or not. Now it is signed over its reader and
 * checked against the browser's cookie, or a bearer token.
 */
test('a link made for a reader opens only with that reader’s cookie or token', async () => {
  const { fileCookie, linkForReader, signKey: sign } = await import('../src/storage.js')
  const stored = await put('ws-mine', new TextEncoder().encode('a private picture'), 'image/png')
  const link = linkForReader(stored.key, 'actor-a')

  // Nobody: refused, though the link is signed and in date.
  assert.equal((await app.request(link)).status, 403)

  // The person it was made for, by their cookie.
  const mine = await app.request(link, { headers: { cookie: `tracker_files=${fileCookie('actor-a')}` } })
  assert.equal(mine.status, 200)
  assert.equal(await mine.text(), 'a private picture')

  // Somebody else signed in: refused.
  const theirs = await app.request(link, { headers: { cookie: `tracker_files=${fileCookie('actor-b')}` } })
  assert.equal(theirs.status, 403)

  // A cookie somebody made up: refused.
  const forged = await app.request(link, { headers: { cookie: 'tracker_files=actor-a.9999999999.0000' } })
  assert.equal(forged.status, 403)

  // Taking `for=me` off does not turn it into an open link: the signature
  // covers the reader, so the plain check fails.
  assert.equal((await app.request(link.replace('for=me&', ''))).status, 403)

  // And a plain signature presented as a reader's link fails the reader's check.
  const plain = `/api/blob/${encodeURIComponent(stored.key)}?for=me&token=${sign(stored.key)}`
  assert.equal((await app.request(plain, { headers: { cookie: `tracker_files=${fileCookie('actor-a')}` } })).status, 403)
})

test('a signed-in answer gives the browser its cookie for files, and signing out takes it', async () => {
  const { token } = await makeOwner()
  const r = await app.request('/api/me', { headers: { authorization: `Bearer ${token}` } })
  assert.equal(r.status, 200)
  const set = r.headers.get('set-cookie') ?? ''
  assert.match(set, /tracker_files=/)
  assert.match(set, /HttpOnly/)
  assert.match(set, /Path=\/api\/blob/)

  const out = await app.request('/auth/logout', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } })
  assert.match(out.headers.get('set-cookie') ?? '', /tracker_files=;.*Max-Age=0/)
})

/* A picture's copy for showing. */
test('a picture takes a copy for showing from its uploader, and links hand it out', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const p = await makeProject(ctx, workspaceId, 'Acme')
  const sam = await addPerson(ctx, workspaceId, 'member', [p])
  const samToken = await bearerFor(sam.actorId, workspaceId)

  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAFAAAAAoCAIAAADmAupWAAAATklEQVR4nO3PAQ3AIADAMEAO5hCMmbv4k71VsM197viT9XXA2wzXGa4zXGe4znCd4TrDdYbrDNcZrjNcZ7jOcJ3hOsN1husM1xmuM1z3AL/zAcRgtCDyAAAAAElFTkSuQmCC',
    'base64',
  )
  const form = new FormData()
  form.append('file', new Blob([png], { type: 'image/png' }), 'shot.png')
  const made = await app.request(`/api/projects/${p}/uploads`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: form,
  })
  const { id } = (await made.json()) as { id: string }

  const send = (who: string, bytes: Uint8Array) => {
    const f = new FormData()
    f.append('file', new Blob([new Uint8Array(bytes).buffer as ArrayBuffer], { type: 'image/jpeg' }), 'display.jpg')
    return app.request(`/api/files/${id}/display`, { method: 'POST', headers: { authorization: `Bearer ${who}` }, body: f })
  }
  const jpeg = SMALL_JPEG

  // Not somebody else's picture.
  assert.equal((await send(samToken, jpeg)).status, 403)
  // Not bytes that say they are a JPEG and are not.
  assert.equal((await send(token, new TextEncoder().encode('<svg></svg>'))).status, 400)
  assert.equal((await send(token, jpeg)).status, 204)

  const r = await app.request(`/api/files/${id}/url`, { headers: { authorization: `Bearer ${token}` } })
  const body = (await r.json()) as { url: string; display_url: string | null }
  assert.ok(body.display_url)
  assert.notEqual(body.display_url, body.url)
})

/**
 * A list's tile is the copy for showing, or a small original — never a
 * large one: a phone decoding dozens of eight-megabyte originals for
 * 48-pixel tiles ran out of memory. `docs/specs/docs.md`.
 */
test('a large picture with no copy for showing has no tile in the list, a small one or one with a copy does', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const p = await makeProject(ctx, workspaceId, 'Acme')
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAFAAAAAoCAIAAADmAupWAAAATklEQVR4nO3PAQ3AIADAMEAO5hCMmbv4k71VsM197viT9XXA2wzXGa4zXGe4znCd4TrDdYbrDNcZrjNcZ7jOcJ3hOsN1husM1xmuM1z3AL/zAcRgtCDyAAAAAElFTkSuQmCC',
    'base64',
  )
  const upload = async (name: string, bytes: Buffer) => {
    const form = new FormData()
    form.append('file', new Blob([new Uint8Array(bytes).buffer as ArrayBuffer], { type: 'image/png' }), name)
    const r = await app.request(`/api/projects/${p}/uploads`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form })
    return ((await r.json()) as { id: string }).id
  }
  const small = await upload('small.png', png)
  const large = await upload('large.png', Buffer.concat([png, Buffer.alloc(600 * 1024)]))
  const tiles = async () => {
    const r = await app.request(`/api/projects/${p}/files`, { headers: { authorization: `Bearer ${token}` } })
    const { files } = (await r.json()) as { files: { id: string; thumb_url: string | null }[] }
    return Object.fromEntries(files.map((f) => [f.id, f.thumb_url]))
  }
  let t = await tiles()
  assert.ok(t[small], 'a small original is its own tile')
  assert.equal(t[large], null, 'a large original is not')

  const f = new FormData()
  f.append('file', new Blob([SMALL_JPEG.buffer as ArrayBuffer], { type: 'image/jpeg' }), 'display.jpg')
  assert.equal(
    (await app.request(`/api/files/${large}/display`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: f })).status,
    204,
  )
  t = await tiles()
  assert.ok(t[large], 'its copy for showing is')
})

/**
 * An SVG is drawn, and can never be a page that runs anything.
 *
 * It went out as bytes for a while, which was safe and drew a broken
 * picture in the list and the lightbox. As itself it carries the sandbox:
 * opened by its link it has no script, no requests and no origin, and in an
 * `<img>` a browser runs nothing in it anyway.
 */
test('an SVG is served as one, inside the sandbox', async () => {
  const svg = new TextEncoder().encode('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
  const stored = await put('ws-svg', svg, 'image/svg+xml')
  const r = await app.request(`/api/blob/${encodeURIComponent(stored.key)}?token=${signKey(stored.key)}`)
  assert.equal(r.status, 200)
  assert.equal(r.headers.get('content-type'), 'image/svg+xml')
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff')
  assert.match(r.headers.get('content-security-policy') ?? '', /default-src 'none'.*sandbox/)
  // And from the middle, typed from its start like any other file.
  const part = await app.request(`/api/blob/${encodeURIComponent(stored.key)}?token=${signKey(stored.key)}`, {
    headers: { range: 'bytes=10-20' },
  })
  assert.equal(part.headers.get('content-type'), 'image/svg+xml')
})
