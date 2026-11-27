import { Hono } from 'hono'
import { brandOfDocument } from '../brand.js'
import { withoutActor } from '../db.js'
import { linkFor } from '../storage.js'
import { forStrangers } from '../yjson.js'

/**
 * A document anybody can read, by its link.
 *
 * No session: the token is the whole of the right, and it is found through
 * definer functions that answer only a shared, standing, written document
 * and only the files its body names. Each picture comes with a link signed
 * for an hour over its key and nobody's name, so a reader with no cookie can
 * open it — and nothing else in the workspace.
 */
export const publicDocs = new Hono()

const TOKEN = /^[A-Za-z0-9_-]{24}$/

publicDocs.get('/docs/:token', async (c) => {
  const token = c.req.param('token')
  const unshared = () => c.json({ error: { code: 'not_found', message: 'This document isn’t shared.' } }, 404)
  if (!TOKEN.test(token)) return unshared()
  const found = await withoutActor(async (tx) => {
    const [doc] = await tx<{ id: string; name: string; body: unknown; updated_at: string }[]>`
      select * from public_document(${token})`
    if (!doc) return null
    const files = await tx<{ id: string; storage_key: string; display_key: string | null; content_type: string | null }[]>`
      select * from public_document_files(${token})`
    /* Whose it is, only where the workspace's plan wears its own name.
       Anywhere else, nothing about who. */
    const brand = await brandOfDocument(tx, token)
    return { doc, files, brand }
  })
  if (!found) return unshared()
  const pictures: Record<string, { url: string; display_url: string | null }> = {}
  for (const f of found.files) {
    pictures[f.id] = { url: linkFor(f.storage_key), display_url: f.display_key ? linkFor(f.display_key) : null }
  }
  /* Read by whoever has the link, and never kept by a shared cache: turned
     off, it has to stop at once. */
  c.header('cache-control', 'private, no-store')
  c.header('x-robots-tag', 'noindex')
  /* Without what belongs to the people on the project: the threads on its
     words, and the tasks named in it, which are their title and no more. */
  return c.json({
    name: found.doc.name,
    body: forStrangers(found.doc.body),
    updated_at: found.doc.updated_at,
    pictures,
    brand: found.brand,
  })
})
