import type { Attached } from './upload.js'

/**
 * A rich-text body, in and out.
 *
 * The four entities all keep their prose as a document rather than as a
 * string, because a body carries mentions and links and those are structure,
 * not punctuation. Everything the web writes is still one paragraph of plain
 * text, so this is the pair of functions that stands between the two — and
 * it stood in two files, one per screen that has a body, which is two
 * chances for the shapes to drift apart from each other.
 */
/** Something # or @ named on a plain line: the words it was written as, and the node it stands for. */
export type Named = { label: string; node: { type: 'taskref' | 'docref' | 'mention'; attrs: Record<string, unknown> } }

/**
 * A line of words, with what # and @ named in it made into the nodes they are.
 *
 * Longest first, and only where the words end there: `@Sam` is not the
 * start of `@Samantha`, and with both on a line the shorter one took the
 * longer one's first letters and left "antha" behind it.
 */
function line(text: string, named: readonly Named[]): unknown[] {
  let parts: unknown[] = [{ type: 'text', text }]
  for (const n of [...named].sort((a, b) => b.label.length - a.label.length)) {
    parts = parts.flatMap((p) => {
      const t = p as { type: string; text?: string }
      if (t.type !== 'text' || !t.text) return [p]
      const at = whole(t.text, n.label)
      if (at < 0) return [p]
      const before = t.text.slice(0, at)
      const after = t.text.slice(at + n.label.length)
      return [...(before ? [{ type: 'text', text: before }] : []), n.node, ...(after ? [{ type: 'text', text: after }] : [])]
    })
  }
  return parts
}

/** Where `label` stands in `text` as a whole — not followed by more of a word. */
function whole(text: string, label: string): number {
  for (let at = text.indexOf(label); at >= 0; at = text.indexOf(label, at + 1)) {
    const next = text.slice(at + label.length, at + label.length + 2)
    if (!/^[\p{L}\p{N}_]/u.test(next)) return at
  }
  return -1
}

export const asDoc = (text: string, attached: readonly Attached[] = [], named: readonly Named[] = []) => ({
  type: 'doc',
  content: [
    ...(text ? [{ type: 'paragraph', content: line(text, named) }] : []),
    /*
     * A file is a node in the body, not a field beside it.
     *
     * It is how a picture already lives in a task's description, so a comment
     * or a message carrying one needs nothing new to store it and nothing new
     * to draw it — `docs/specs/rich-text.md`. A separate "attachments" column
     * would be a second place a file can be, with its own lifetime and its
     * own question about who may see it.
     */
    ...attached.map((a) => ({
      type: 'attachment',
      attrs: {
        fileId: a.id,
        name: a.name,
        kind: a.kind,
        /* Its size and a blurred glance, so a reader keeps its room and
           shows it at once — `measure` in `data/upload.ts`. */
        ...(a.pixelWidth && a.pixelHeight ? { pixelWidth: a.pixelWidth, pixelHeight: a.pixelHeight } : {}),
        ...(a.blur ? { blur: a.blur } : {}),
      },
    })),
  ],
})

/** What was written, as a person typed it, for a field to be edited in. */
export function plain(body: unknown): string {
  const doc = body as { content?: { content?: Inline[] }[] }
  return doc?.content?.map((p) => p.content?.map((t) => t.text ?? namedAs(t)?.label ?? '').join('') ?? '').join('\n') ?? ''
}

type Inline = { type?: string; text?: string; attrs?: Record<string, unknown> }

/**
 * A person, a task or a document named inline, as the words a line shows
 * it by — the same words the comment line writes it as, so an edit that
 * leaves them alone keeps the thing they stand for. A comment that named
 * somebody lost the name entirely the first time it was edited: the node
 * has no text, and the field was filled from the text.
 * `docs/specs/task-mentions.md`.
 */
function namedAs(t: Inline): Named | null {
  const a = t.attrs ?? {}
  if (t.type === 'mention') return { label: `@${String(a.label ?? '')}`, node: t as Named['node'] }
  if (t.type === 'taskref') {
    return { label: `${a.key ? `${String(a.key)}-` : '#'}${String(a.number ?? '')} ${String(a.title ?? '')}`, node: t as Named['node'] }
  }
  if (t.type === 'docref') return { label: String(a.title ?? ''), node: t as Named['node'] }
  return null
}

/** Everything a body names inline, for an edit of its words to keep. */
export function namedIn(body: unknown): Named[] {
  const doc = body as { content?: { content?: Inline[] }[] } | null
  return (doc?.content ?? []).flatMap((p) => (p.content ?? []).map(namedAs).filter((n): n is Named => n !== null))
}

/**
 * The same body with its words replaced, keeping everything that is not words.
 *
 * Editing a comment means editing the line somebody typed. A body can also
 * hold attachments, and rebuilding it from the text alone would drop the
 * picture that was sent with it — a screenshot deleted by somebody fixing a
 * typo, with nothing on the screen to say it had gone.
 *
 * The paragraphs go and one paragraph takes their place; everything else
 * keeps its order. Empty text leaves the body with only its attachments,
 * which is a message that is a picture and nothing else.
 */
export function retext(body: unknown, text: string, named: readonly Named[] = []): unknown {
  const doc = body as { type?: string; content?: { type?: string }[] } | null
  const kept = (doc?.content ?? []).filter((n) => n.type !== 'paragraph')
  return {
    type: 'doc',
    content: [...(text ? [{ type: 'paragraph', content: line(text, named) }] : []), ...kept],
  }
}

/** A body with a link's card under its words, when one was kept. */
export function withCard<T extends { content: unknown[] }>(doc: T, card: { url: string } | null | undefined): T {
  return card ? { ...doc, content: [...doc.content, { type: 'preview', attrs: card }] } : doc
}
