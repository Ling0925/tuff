import { asWorker } from './db.js'
import { issueAccessToken } from './auth/tokens.js'
import { app } from './http/routes.js'
import { fromInside } from './http/limits.js'
import { sniff } from './http/files.js'
import { Later, NAME, Refused, type Source } from './importing.js'

/**
 * The worker's half of every import.
 *
 * Each reads its product with the key and writes here through the import's
 * own doors as the person who started it, a page at a time, saying how far
 * it got after each so a stop goes on from there. A turn is a few pages, so
 * one large project does not hold the worker from everything else.
 */
export { NAME, type Source } from './importing.js'

export type Progress = {
  project_id?: string
  cursor?: string | null
  done?: boolean
  issues?: number
  reading?: number
}
export type Claimed = {
  id: string
  workspace_id: string
  actor_id: string
  key_enc: string | null
  source: Source
  teams: { id: string; key: string; name: string; issues: number }[]
  progress: Record<string, Progress>
}

export const PAGES_A_TURN = 8

export class Stopped extends Error {}

export type Kit = {
  ours: <T>(path: string, body: unknown) => Promise<T>
  put: (projectId: string, file: File) => Promise<string | null>
  save: (release?: boolean) => Promise<unknown>
}

export function kitOf(job: Claimed): Kit {
  const token = () => issueAccessToken({ sub: job.actor_id, workspace_id: job.workspace_id, via: 'import', imp: job.id })
  return {
    async ours<T>(path: string, body: unknown): Promise<T> {
      const r = await app.request(`/api${path}`, {
        method: 'POST',
        headers: { ...fromInside(), authorization: `Bearer ${await token()}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (r.status === 403) throw new Stopped('The import was refused — its project or its person is no longer there.')
      /* Our own ceiling is a wait, like theirs; any other refusal of what
         was sent is not something a retry changes. */
      if (r.status === 429) throw new Later(60)
      /* The Markdown workers busy (`parsing-off-thread.md`): a wait, for as
         long as the answer says, never the end of the import. */
      if (r.status === 503) throw new Later(Math.max(5, Number(r.headers.get('retry-after')) || 15))
      if (r.status >= 400 && r.status < 500) throw new Stopped(`Tuff refused part of the import (${r.status}).`)
      if (!r.ok) throw new Error(`${path} → ${r.status}`)
      return (await r.json()) as T
    },
    /* A file of the project, uploaded through its own door as the person. */
    async put(projectId: string, file: File): Promise<string | null> {
      const form = new FormData()
      form.set('file', file)
      const r = await app.request(`/api/projects/${projectId}/uploads`, {
        method: 'POST',
        headers: { ...fromInside(), authorization: `Bearer ${await token()}` },
        body: form,
      })
      return r.ok ? ((await r.json()) as { id: string }).id : null
    },
    save: (release = false) =>
      asWorker((tx) => tx`select linear_import_progress(${job.id}, ${tx.json(job.progress as never)}, ${release})`),
  }
}

export const finish = (id: string, error: string | null) => asWorker((tx) => tx`select linear_import_finish(${id}, ${error})`)

/**
 * One turn of an import, however its product is read: `work` brings pages
 * until it is done or the turn is up. What goes wrong is decided here, the
 * same for all three — a wait is a wait, a refusal or three failures in a
 * row end it, and the key goes with it.
 */
export async function turn(job: Claimed, work: (pages: { n: number }) => Promise<'done' | 'later'>): Promise<number> {
  const kit = kitOf(job)
  const pages = { n: 0 }
  const failures = () => (job.progress as { failures?: number }).failures ?? 0
  /* Turns since a page last went through. A turn that dies with the
     worker — out of memory, a restart — never reaches the catch below, and
     the claim lapsing gave the same import to the next turn, all day. */
  const tries = (job.progress as { turns?: number }).turns ?? 0
  if (tries >= 12) {
    await finish(job.id, 'The import kept stopping part-way.')
    return 0
  }
  ;(job.progress as { turns?: number }).turns = tries + 1
  await kit.save()
  try {
    if ((await work(pages)) === 'done') await finish(job.id, null)
    return pages.n
  } catch (e) {
    if (e instanceof Later) {
      /* Taken up again once the claim lapses; the cursor says where. A
         wait is not a turn that died: Asana's free plan can ask for hours. */
      ;(job.progress as { turns?: number }).turns = tries
      await kit.save()
      return pages.n
    }
    const tried = failures() + 1
    ;(job.progress as { failures?: number }).failures = tried
    if (!(e instanceof Stopped) && tried >= 3) {
      await finish(job.id, 'The import stopped after repeated errors.')
      return pages.n
    }
    if (e instanceof Refused && e.status === 401) {
      await finish(job.id, `${NAME[job.source]} stopped accepting the key.`)
      return pages.n
    }
    if (e instanceof Stopped) {
      await finish(job.id, e.message)
      return pages.n
    }
    await kit.save().catch(() => {})
    throw e
  }
}

/** A page went through: the count of failures in a row starts again. */
export const wentThrough = (job: Claimed) => {
  ;(job.progress as { failures?: number; turns?: number }).failures = 0
  ;(job.progress as { turns?: number }).turns = 0
}

/**
 * An issue's comments, up to two million characters of them, read before
 * any is kept: a project of a thousand long threads is a crafted one, and
 * it is not to take the worker's memory with it.
 */
export function talk<T extends { body: string }>(comments: T[], from: Source): { kept: T[]; note: string | null } {
  let size = 0
  const kept: T[] = []
  for (const c of comments.slice(0, 2000)) {
    size += c.body.length
    if (size > 2_000_000) break
    kept.push(c)
  }
  const left = comments.length - kept.length
  return { kept, note: left ? `(${left} later comments in ${NAME[from]} were too long to bring.)` : null }
}

const EXT: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'application/pdf': '.pdf',
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'video/webm': '.webm',
}

/**
 * A file named so a computer can open it. Its kind from its bytes, not the
 * other product's word for it: Linear answers a picture as a stream of
 * bytes, and kept as one it was a "File" with no name a computer could
 * open — a PNG nobody could see.
 */
export function fileOf(bytes: ArrayBuffer, said: string, label: string): File {
  const type = sniff(new Uint8Array(bytes))
  const kind = type === 'application/octet-stream' ? said : type
  const ext = EXT[kind] ?? /\.[a-z0-9]{1,5}$/i.exec(label)?.[0]?.toLowerCase() ?? ''
  const base = label
    .replace(/[^\w .-]/g, '')
    .replace(/\.[a-z0-9]{1,5}$/i, '')
    .trim()
    .slice(0, 80)
  return new File([bytes], `${base || (kind.startsWith('image/') ? 'Picture' : 'File')}${ext}`, { type: kind })
}

/** Said as a note at the cut, not dropped in silence. */
export const cut = (text: string, max: number, from: Source) =>
  text.length > max ? `${text.slice(0, max - 40)}\n\n(Shortened when brought from ${NAME[from]}.)` : text

/** One issue small enough to send on its own: its last comments go first. */
export function fits<T extends { comments: unknown[]; body: string }>(issue: T, from: Source): T {
  let comments = issue.comments
  while (comments.length && Buffer.byteLength(JSON.stringify({ ...issue, comments })) > 3_000_000) {
    comments = comments.slice(0, Math.floor(comments.length / 2))
  }
  const left = issue.comments.length - comments.length
  /* Said, not dropped in silence. */
  const body = left ? `${issue.body}\n\n(${left} later comments in ${NAME[from]} were too long to bring.)` : issue.body
  return { ...issue, body, comments }
}

/** Issues in groups whose JSON stays under a request's size. */
export function byBytes<T>(items: T[], max: number): T[][] {
  const out: T[][] = []
  let group: T[] = []
  let size = 0
  for (const item of items) {
    const n = Buffer.byteLength(JSON.stringify(item))
    if (group.length && (size + n > max || group.length >= 10)) {
      out.push(group)
      group = []
      size = 0
    }
    group.push(item)
    size += n
  }
  if (group.length) out.push(group)
  return out
}

/**
 * Issues written, a few at a time, saying the count after each. Each is
 * written as soon as its files are in — written at the page's end, a wait
 * part-way through a page left files uploaded for tasks that were not, and
 * the page read again uploaded them twice.
 */
export async function writePage<T extends { comments: unknown[]; body: string }>(
  job: Claimed,
  kit: Kit,
  p: Progress,
  issues: T[],
): Promise<void> {
  for (const part of byBytes(
    issues.map((i) => fits(i, job.source)),
    2_000_000,
  )) {
    const { written } = await kit.ours<{ written: number }>('/import/linear/issues', { project_id: p.project_id, issues: part })
    p.issues = (p.issues ?? 0) + written
    /* Moving: not a turn that keeps dying. */
    if (written) (job.progress as { turns?: number }).turns = 0
    /* Said after every few, so the page shows it moving. */
    await kit.save()
  }
}
