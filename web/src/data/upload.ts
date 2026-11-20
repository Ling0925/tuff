/**
 * Sending the bytes and getting a row back.
 *
 * Through the upload endpoint that already exists, so a picture put into a
 * body — a task's, a comment's, a message's — is a file of the project:
 * findable in Docs, counted against the storage ceiling, under the same
 * permissions as every other file. An upload that lived only inside one body
 * would be a second kind of file with its own lifetime, its own visibility
 * question and its own clear-out — `docs/specs/rich-text.md`.
 *
 * It lived inside the document editor, which was the only thing that could
 * take a file. Three things can now.
 */
import { createContext } from 'react'
import { stored } from './api.js'
import { boardSays, boardSecret } from './boardApi.js'

/** A file already sent, waiting to be part of what is written. */
export type Attached = {
  id: string
  name: string
  kind: Kind
  /*
   * The file as the browser already holds it, for the preview.
   *
   * An object URL and not the stored file read back: the bytes are here the
   * moment somebody picks them, and a thumbnail that waits for the server is
   * one that arrives after the moment it was for. Revoked when the strip
   * lets the file go — a page holding a hundred of these is holding a
   * hundred files in memory.
   */
  preview?: string
  /** Its own pixels and a blurred glance at it — `measure`. */
  pixelWidth?: number
  pixelHeight?: number
  blur?: string
  /** Kept on this machine for the tile it waits on, and never sent: what it
      was called while it went up, and how big it is. */
  key?: string
  size?: number
}

/**
 * A picture's or a video's own size, and a sixty-four-pixel glance at it,
 * read from the file in hand before any of it is sent.
 *
 * The size keeps the room for it, so nothing under it moves when it lands;
 * the glance is what fills that room meanwhile — the picture itself,
 * blurred, rather than a grey box that turns into it. Both travel inside the
 * body, on the attachment node, so every reader draws them at once with
 * nothing to ask for: under a kilobyte.
 */
export type Measured = { pixelWidth?: number; pixelHeight?: number; blur?: string }

export async function measure(file: File): Promise<Measured> {
  const kind = kindOf(file.type)
  try {
    if (kind === 'image') {
      const b = await createImageBitmap(file)
      const out: Measured = { pixelWidth: b.width, pixelHeight: b.height }
      const blur = glance(b, b.width, b.height)
      b.close()
      return blur ? { ...out, blur } : out
    }
    if (kind === 'video') return await firstFrame(file)
  } catch {
    // A format the browser cannot read here is drawn as it always was.
  }
  return {}
}

function glance(source: CanvasImageSource, w: number, h: number): string | undefined {
  if (!w || !h) return undefined
  /* Sixty-four on the long side: at twenty-four it was a wash of colour
     that read as broken rather than as the picture on its way. About three
     kilobytes. */
  const scale = 64 / Math.max(w, h)
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(w * scale))
  c.height = Math.max(1, Math.round(h * scale))
  const g = c.getContext('2d')
  if (!g) return undefined
  g.imageSmoothingQuality = 'high'
  g.drawImage(source, 0, 0, c.width, c.height)
  return c.toDataURL('image/jpeg', 0.8)
}

/** A video's frame size and a glance at a frame near its start. */
function firstFrame(file: File): Promise<Measured> {
  return new Promise((done) => {
    const v = document.createElement('video')
    const url = URL.createObjectURL(file)
    let settled = false
    const finish = (out: Measured) => {
      if (settled) return
      settled = true
      URL.revokeObjectURL(url)
      done(out)
    }
    const size = (): Measured => (v.videoWidth && v.videoHeight ? { pixelWidth: v.videoWidth, pixelHeight: v.videoHeight } : {})
    v.preload = 'auto'
    v.muted = true
    v.playsInline = true
    v.onloadedmetadata = () => {
      v.currentTime = Math.min(0.1, (v.duration || 1) / 2)
    }
    v.onseeked = () => {
      const blur = glance(v, v.videoWidth, v.videoHeight)
      finish(blur ? { ...size(), blur } : size())
    }
    v.onerror = () => finish({})
    setTimeout(() => finish(size()), 2500)
    v.src = url
  })
}

export type Kind = 'image' | 'video' | 'file'

/**
 * What this is, from what the browser says it picked.
 *
 * Only for drawing. The server decides what the file *is* from its bytes —
 * a type the client supplied is a type an attacker supplied — and what it
 * decides is what comes back on the row afterwards. This one answers a
 * narrower question: which box to draw before any of that has happened.
 */
export function kindOf(type: string): Kind {
  if (type.startsWith('image/')) return 'image'
  if (type.startsWith('video/')) return 'video'
  return 'file'
}

/**
 * How far a send has got, and the way to stop it.
 *
 * `fetch` cannot say how much of a body has gone, so a send somebody is
 * watching goes by `XMLHttpRequest`, which can — the same request, with a
 * number to draw.
 */
export type Watch = {
  onProgress: (fraction: number) => void
  /** Handed the way to cancel, once the request exists. */
  onAbortable?: (abort: () => void) => void
}

/**
 * Where an upload goes: a project's Docs, or — written `room:<id>` — a
 * conversation outside every project.
 */
export function uploadsTo(home: string): string {
  if (home.startsWith('room:')) return `/api/conversations/${home.slice(5)}/uploads`
  /* Into a document — `doc:<project>:<file>`: the document's own, seen by
     whoever sees it. */
  if (home.startsWith('doc:')) {
    const [, project, file] = home.split(':')
    return `/api/projects/${project}/uploads?into=${file}`
  }
  return `/api/projects/${home}/uploads`
}

/**
 * Where what is uploaded on this screen belongs, when that is a document
 * rather than its project: an open document says so for everything inside
 * it — its body and the comments under it — so a picture put into a draft
 * is the draft's from the first byte.
 */
export const UploadInto = createContext<string | null>(null)

export async function upload(projectId: string, file: File, watch?: Watch): Promise<Attached | null> {
  const form = new FormData()
  form.append('file', file)
  /* On a board: pictures only, to the board's own route, with its secret. */
  const secret = boardSecret()
  if (secret) {
    if (kindOf(file.type) !== 'image') {
      boardSays('type')
      return null
    }
    const r = await fetch('/api/board/app/images', {
      method: 'POST',
      headers: { 'x-api-version': '1', authorization: `Board ${secret}` },
      body: form,
    }).catch(() => null)
    if (!r?.ok) {
      const said = ((await r?.json().catch(() => ({}))) ?? {}) as { error?: { code?: string; message?: string } }
      boardSays(said.error?.code === 'pictures' ? 'more' : 'refused', said.error?.message)
      return null
    }
    const made = (await r.json()) as { id: string; width?: number; height?: number }
    return { id: made.id, name: 'Picture', kind: 'image' }
  }
  if (watch) {
    const made = await new Promise<{ id: string; name?: string } | null>((done) => {
      const x = new XMLHttpRequest()
      x.open('POST', uploadsTo(projectId))
      x.setRequestHeader('x-api-version', '1')
      x.setRequestHeader('authorization', `Bearer ${stored()?.access_token ?? ''}`)
      x.upload.onprogress = (e) => e.lengthComputable && watch.onProgress(e.loaded / e.total)
      x.onload = () => {
        if (x.status < 200 || x.status >= 300) return done(null)
        try {
          done(JSON.parse(x.responseText) as { id: string; name?: string })
        } catch {
          done(null)
        }
      }
      x.onerror = () => done(null)
      x.onabort = () => done(null)
      watch.onAbortable?.(() => x.abort())
      x.send(form)
    })
    if (made) showLater(made.id, file)
    return made ? { id: made.id, name: made.name ?? file.name, kind: kindOf(file.type) } : null
  }
  // Not through api(): multipart sets its own content type.
  const r = await fetch(uploadsTo(projectId), {
    method: 'POST',
    headers: {
      'x-api-version': '1',
      authorization: `Bearer ${stored()?.access_token ?? ''}`,
    },
    body: form,
  })
  if (!r.ok) return null
  const made = (await r.json()) as { id: string; name?: string }
  showLater(made.id, file)
  return {
    id: made.id,
    name: made.name ?? file.name,
    kind: kindOf(file.type),
  }
}

/**
 * A copy of a picture for showing, made here and sent beside the original.
 *
 * A phone's photo is four megabytes and is drawn eight hundred pixels wide:
 * every reader downloaded all of it, behind a blur, to see what a fifth of
 * it shows. The browser that has the bytes makes the copy — no more than
 * 1600 pixels on the long side, which is sharp at twice the column's width —
 * and sends it after the original, in the background. Bodies draw it; the
 * lightbox and Save use the original.
 *
 * Not for a picture that is already small, not for a GIF (the copy would
 * not move) or an SVG (it would not scale), and not when the copy would
 * save little. WebP where the browser can write it, keeping transparency;
 * otherwise JPEG, and then not for a PNG, whose transparency JPEG would
 * fill with black.
 */
const LONGEST = 1600

export function showLater(fileId: string, file: File): void {
  if (kindOf(file.type) !== 'image' || /gif|svg/.test(file.type)) return
  void copyForShowing(file)
    .then((copy) => {
      if (!copy) return
      const form = new FormData()
      form.append('file', copy, 'display')
      return fetch(`/api/files/${fileId}/display`, {
        method: 'POST',
        headers: { 'x-api-version': '1', authorization: `Bearer ${stored()?.access_token ?? ''}` },
        body: form,
      })
    })
    .catch(() => {
      // Without its copy the picture is drawn from the original, as before.
    })
}

let writesWebp: boolean | null = null
function canWriteWebp(): boolean {
  if (writesWebp === null) {
    const c = document.createElement('canvas')
    c.width = c.height = 1
    writesWebp = c.toDataURL('image/webp').startsWith('data:image/webp')
  }
  return writesWebp
}

async function copyForShowing(file: File): Promise<Blob | null> {
  const bitmap = await createImageBitmap(file)
  const { width: w, height: h } = bitmap
  const long = Math.max(w, h)
  if (long <= LONGEST && file.size < 600 * 1024) {
    bitmap.close()
    return null
  }
  const webp = canWriteWebp()
  if (!webp && file.type === 'image/png') {
    bitmap.close()
    return null
  }
  const k = Math.min(1, LONGEST / long)
  const c = document.createElement('canvas')
  c.width = Math.round(w * k)
  c.height = Math.round(h * k)
  const g = c.getContext('2d')
  if (!g) {
    bitmap.close()
    return null
  }
  g.imageSmoothingQuality = 'high'
  g.drawImage(bitmap, 0, 0, c.width, c.height)
  bitmap.close()
  const blob = await new Promise<Blob | null>((done) => c.toBlob(done, webp ? 'image/webp' : 'image/jpeg', 0.82))
  // Worth a second file only when it is much smaller than the first.
  return blob && blob.size < file.size * 0.7 ? blob : null
}
