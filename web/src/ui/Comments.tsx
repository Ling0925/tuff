import { useRef, useState } from 'react'
import { dayAndClock } from '../data/said.js'
import { ACTS, SAYS } from '../data/words.js'
import { COMMENTS as W } from '../words/comments.js'
import { SAID } from '../words/said.js'
import type { CommentOnObject } from '@tracker/shared-schema'
import { api } from '../data/api.js'
import { dropUndo, offerUndo } from '../data/undo.js'
import { asDoc, namedIn, plain, retext, withCard, type Named } from '../data/doc.js'
import { Doc } from './Doc.jsx'
import { Origin } from './Origin.jsx'
import { Avatar, Composer, GroupLabel, Hairline, Panel, Popover, useNaming, notALogin } from './kit.jsx'
import { Icon } from './glyphs.jsx'
import { Choices } from './Choices.jsx'
import type { Callable } from './Editor.jsx'

/* From the contract — `shared-schema/src/responses.ts`. */
export type Comment = CommentOnObject

/** What can be done to the comments, on the screen first. */
type Acts = {
  add: (body: unknown, parentId: string | null) => Promise<void>
  edit: (id: string, body: unknown) => Promise<void>
  remove: (id: string) => Promise<void>
  /** Settle a thread on words, or open it again. */
  resolve: (id: string, on: boolean) => Promise<void>
  /** An agent's question answered — read the comments again. */
  answered: () => Promise<void>
  /** Who is pressing, said beside an answer before the server says it. */
  meName: string
}

/**
 * Threads on words in a document:
 * where their words are, and which have lost them.
 */
export type OnWordsThreads = {
  /** Scroll to a thread's words and open it there. */
  show: (id: string) => void
  /** Threads whose words are in the document no longer, as the page sees it now. */
  gone: ReadonlySet<string>
}

/**
 * What was said about something, and the three things a person does with it.
 *
 * It was written three times — once on a task, once on an announcement, once
 * on a document — at three different sizes, each with its own copy of the
 * author line and the "via AI agent" mark. Three copies of one row is three
 * chances for one of them to stop matching the others, and it showed: only
 * one of them ever got an avatar, and none of them could be edited or taken
 * back.
 *
 * **Saying it is not the same as writing a document.** A comment is a line.
 * So editing one happens in place, in a field the same size and in the same
 * position as the text it replaces — nothing moves when it opens — and it is
 * Enter to keep, Escape to leave it alone. A dialog for one sentence is a
 * form in front of the work.
 *
 * **An edit says so.** A sentence that can be rewritten with nothing to show
 * for it is a thread nobody can rely on; a thread where every change is
 * announced in the feed is a thread people stop editing typos in. A quiet
 * word beside the date is the whole of the middle answer.
 *
 * **What is not words survives the edit.** A body can carry a picture, and
 * rebuilding it from the line alone would drop the screenshot somebody sent
 * — deleted by the person fixing a typo, with nothing saying it had gone.
 */
/**
 * What was said about a task, a document or an announcement, under it — one
 * block, the document's: a quiet grey label, and the comments with their
 * line to write on.
 *
 * A document and an announcement drew it their own way — a small grey label
 * over an indented "Nothing said yet." — so the same conversation looked
 * like three features. `docs/specs/comments.md`.
 */
export function Discussion({ title, ...rest }: Parameters<typeof Comments>[0] & { title: string }) {
  return (
    <section data-discussion className="flex shrink-0 flex-col gap-2 pb-2">
      {/* The document's label, quiet and grey, rather than a heading the
          size of the task's own sections: what was said under a thing is
          read after it, not announced. No "Nothing said yet." under it —
          the line to write on is right there and says it better. */}
      <GroupLabel>{title}</GroupLabel>
      <Comments {...rest} />
    </section>
  )
}

export function Comments({
  comments,
  meId,
  canWrite,
  canEditAny,
  projectId,
  post,
  onChanged,
  label = W.addAComment,
  people,
  only,
  words,
}: {
  comments: Comment[]
  meId: string
  /** `content.create` here: whether there is anything to write with. */
  canWrite: boolean
  /** `content.edit.said`: whether somebody else's words are yours to change. */
  canEditAny: boolean
  /** Where a file put on a line becomes a row — `docs/specs/rich-text.md`. */
  projectId: string
  /** Where a new one goes, e.g. `/tasks/:id/comments`. */
  post: string
  onChanged: () => Promise<void> | void
  label?: string
  /** Who `@` offers — the people of the thing's project. None, no `@`.
      `docs/specs/task-mentions.md`. */
  people?: readonly Callable[]
  /** One thread and nothing else — a thread's card beside its words. */
  only?: string
  /** Threads on words, on a written document. */
  words?: OnWordsThreads
}) {
  const [note, setNote] = useState('')
  /* Settled or opened here, before the server has said so. */
  const [settling, setSettling] = useState<Map<string, boolean>>(new Map())
  /*
   * What this screen has done that the server has not said back yet: new
   * comments, rewritten ones and deleted ones, drawn at once. Each write
   * waited for the server and then for the whole task to be read again —
   * two trips in a row — before anything moved. The overlay goes when the
   * read that follows the write comes back.
   */
  const [added, setAdded] = useState<Comment[]>([])
  const [rewritten, setRewritten] = useState<Map<string, unknown>>(new Map())
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const me = comments.find((c) => c.author_id === meId)
  const acts: Acts = {
    async answered() {
      await onChanged()
    },
    meName: me?.author_name ?? W.you,
    async add(body, parentId) {
      const temp = {
        id: `pending:${Date.now()}`,
        author_id: meId,
        author_name: me?.author_name ?? W.you,
        author_avatar_url: me?.author_avatar_url ?? null,
        body,
        parent_id: parentId,
        created_at: new Date().toISOString(),
        edited_at: null,
      } as Comment
      setAdded((had) => [...had, temp])
      try {
        await api(post, { method: 'POST', body: JSON.stringify({ body, ...(parentId ? { parent_id: parentId } : {}) }) })
        await onChanged()
      } finally {
        setAdded((had) => had.filter((c) => c.id !== temp.id))
      }
    },
    async edit(id, body) {
      setRewritten((had) => new Map(had).set(id, body))
      try {
        await api(`/comments/${id}`, { method: 'PATCH', body: JSON.stringify({ body }) })
        await onChanged()
      } finally {
        setRewritten((had) => {
          const next = new Map(had)
          next.delete(id)
          return next
        })
      }
    },
    async resolve(id, on) {
      setSettling((had) => new Map(had).set(id, on))
      try {
        await api(`/comments/${id}/resolved`, { method: 'PUT', body: JSON.stringify({ resolved: on }) })
        await onChanged()
      } finally {
        setSettling((had) => {
          const next = new Map(had)
          next.delete(id)
          return next
        })
      }
    },
    async remove(id) {
      setHidden((had) => new Set(had).add(id))
      const shown = () =>
        setHidden((had) => {
          const next = new Set(had)
          next.delete(id)
          return next
        })
      const deleting = api(`/comments/${id}`, { method: 'DELETE' })
      /* Offered back at once, in the shell's toast and on ⌘Z — the press
         that deleted it was a moment ago, and the thread is where it was
         read. */
      offerUndo(
        W.deleted,
        deleting,
        () => api(`/comments/${id}/restore`, { method: 'POST' }),
        async () => {
          await onChanged()
          shown()
        },
      )
      try {
        await deleting
        await onChanged()
      } catch {
        // Refused: it is put back, because it is still there.
        dropUndo()
        shown()
      }
    },
  }
  comments = [
    ...comments
      .filter((c) => !hidden.has(c.id))
      .map((c) =>
        rewritten.has(c.id)
          ? { ...c, body: rewritten.get(c.id) as Comment['body'], edited_at: c.edited_at ?? new Date().toISOString() }
          : c,
      )
      .map((c) =>
        settling.has(c.id)
          ? {
              ...c,
              resolved_at: settling.get(c.id) ? (c.resolved_at ?? new Date().toISOString()) : null,
              resolved_by_name: settling.get(c.id) ? (c.resolved_by_name ?? me?.author_name ?? W.you) : null,
            }
          : c,
      ),
    ...added,
  ]

  /*
   * Threads: a comment and the answers to it, in one card.
   *
   * Comments were one flat column, so an answer to the third remark stood
   * under the eighth with nothing saying which it answered. A reply names
   * the comment it answers, one level deep — `docs/specs/comments.md` — and
   * the answers stand under it with a line to add another. A reply whose
   * comment was taken away stands as a thread of its own rather than
   * vanishing with it.
   */
  const ids = new Set(comments.map((c) => c.id))
  const tops = comments.filter((c) => !c.parent_id || !ids.has(c.parent_id))
  const answers = new Map<string, Comment[]>()
  for (const c of comments) {
    if (c.parent_id && ids.has(c.parent_id)) answers.set(c.parent_id, [...(answers.get(c.parent_id) ?? []), c])
  }

  return (
    <div className="flex flex-col gap-3">
      {/*
        The line to write on above what was said, and the newest thread
        under it: at the foot, under every thread and its own reply line, it
        read as one more reply, and what was just said landed out of sight
        below the rest. `docs/specs/comments.md`.
      */}
      {canWrite && !only && (
        <Composer
          testId="new-comment"
          placeholder={label}
          value={note}
          onChange={setNote}
          /* Where a file put on this line becomes a row —
             `docs/specs/rich-text.md`. */
          projectId={projectId}
          {...(people ? { people } : {})}
          onSend={(text, attached, named, card) => {
            setNote('')
            void acts.add(withCard(asDoc(text.trim(), attached, named), card), null).catch(() => setNote(text))
          }}
        />
      )}
      {[...tops]
        .reverse()
        .filter((top) => !only || top.id === only)
        .map((top) => (
          <Thread
            key={top.id}
            top={top}
            {...(words ? { words } : {})}
            open={Boolean(only)}
            answers={answers.get(top.id) ?? []}
            meId={meId}
            canWrite={canWrite}
            canEditAny={canEditAny}
            projectId={projectId}
            acts={acts}
            {...(people ? { people } : {})}
          />
        ))}
    </div>
  )
}

function Thread({
  top,
  answers,
  meId,
  canWrite,
  canEditAny,
  projectId,
  acts,
  people,
  words,
  open = false,
}: {
  top: Comment
  /** Threads on words: where they are. */
  words?: OnWordsThreads
  /** Drawn open whatever it is — the card beside its words. */
  open?: boolean
  answers: Comment[]
  meId: string
  canWrite: boolean
  canEditAny: boolean
  projectId: string
  acts: Acts
  people?: readonly Callable[]
}) {
  const [reply, setReply] = useState('')
  const [unfolded, setUnfolded] = useState(false)
  const quote = top.quote ?? null
  const resolved = Boolean(quote && top.resolved_at)
  const gone = Boolean(quote && (words ? words.gone.has(top.id) : top.on_deleted_text))
  /*
   * Settled: one line — the words it was on, Resolved, and by whom — that
   * opens the thread again when pressed. Put away, not taken away.
   */
  if (resolved && !open && !unfolded) {
    return (
      <button
        type="button"
        data-thread={top.id}
        data-resolved
        onClick={() => setUnfolded(true)}
        className="flex h-10 w-full items-center gap-2 px-4 text-left text-sm text-ink-3 mouse:hover:text-ink-2"
        style={{ borderRadius: 'var(--r-card)', boxShadow: 'inset 0 0 0 1px var(--line)' }}
      >
        <Icon name="check" size={14} />
        <span className="shrink-0">{top.resolved_by_name ? W.resolvedBy(top.resolved_by_name) : W.resolved}</span>
        <span className="min-w-px truncate">“{quote}”</span>
      </button>
    )
  }
  return (
    <Panel>
      <div data-thread={top.id} className="contents">
        {quote && (
          <div data-thread-words className="flex items-center gap-2 px-4 pt-3">
            <button
              type="button"
              disabled={gone || !words}
              title={W.showWords}
              onClick={() => words?.show(top.id)}
              className="min-w-px flex-1 truncate border-l-2 pl-2 text-left text-sm text-ink-2"
              style={{ borderColor: gone ? 'var(--line-strong)' : 'var(--comment-line)' }}
            >
              {gone && <span className="mr-2 text-ink-3">{W.onDeletedText}</span>}
              <span style={gone ? { textDecoration: 'line-through' } : undefined}>{quote}</span>
            </button>
            {!top.id.startsWith('pending:') && canWrite && (
              <button
                type="button"
                data-testid={resolved ? 'reopen-thread' : 'resolve-thread'}
                onClick={() => {
                  setUnfolded(false)
                  void acts.resolve(top.id, !resolved).catch(() => {})
                }}
                className="flex h-7 shrink-0 items-center gap-1 px-2 text-sm text-ink-2 mouse:hover:bg-[var(--hover)] mouse:hover:text-ink"
                style={{ borderRadius: 'var(--r-row)' }}
              >
                {!resolved && <Icon name="check" size={14} />}
                {resolved ? W.reopen : W.resolve}
              </button>
            )}
          </div>
        )}
        <Said
          comment={top}
          mine={top.author_id === meId}
          canEditAny={canEditAny}
          canAnswer={canWrite && !top.id.startsWith('pending:')}
          acts={acts}
          people={people}
        />
        {answers.map((a) => (
          <div key={a.id} className="contents">
            <Hairline inset={14} />
            <Said comment={a} mine={a.author_id === meId} canEditAny={canEditAny} acts={acts} people={people} />
          </div>
        ))}
        {/* Not under a comment still on its way: an answer needs the id the
            server gives it, and one sent too soon was refused in silence. */}
        {canWrite && !top.id.startsWith('pending:') && (
          <>
            <Hairline inset={0} />
            <div className="px-3 py-2">
              <Composer
                testId="reply-comment"
                placeholder={W.leaveAReply}
                value={reply}
                onChange={setReply}
                projectId={projectId}
                {...(people ? { people } : {})}
                onSend={(text, attached, named, card) => {
                  setReply('')
                  void acts.add(withCard(asDoc(text.trim(), attached, named), card), top.id).catch(() => setReply(text))
                }}
              />
            </div>
          </>
        )}
      </div>
    </Panel>
  )
}

function Said({
  comment,
  mine,
  canEditAny,
  canAnswer = false,
  acts,
  people,
}: {
  comment: Comment
  mine: boolean
  canEditAny: boolean
  /** Whether an agent's question here is this person's to answer. */
  canAnswer?: boolean
  acts: Acts
  people?: readonly Callable[] | undefined
}) {
  const [editing, setEditing] = useState<string | null>(null)
  /* Who @ named while editing, beside who the comment already named —
     `docs/specs/task-mentions.md`. */
  const [picked, setPicked] = useState<Named[]>([])
  const call = useNaming(
    editing ?? '',
    (v) => setEditing(v),
    editing === null ? [] : (people ?? []),
    (n) => setPicked((had) => [...had, n]),
  )
  /* What is not words, while editing — each can be taken out, and the edit
     keeps what is left. */
  const [extras, setExtras] = useState<unknown[]>([])
  /* Escape has to stop the blur that follows it from keeping what it just
     threw away. Held in a ref because the blur arrives in the same tick. */
  const dropped = useRef(false)
  const may = (mine || canEditAny) && !comment.id.startsWith('pending:')

  function open() {
    setPicked([])
    setExtras(kept(comment.body))
    setEditing(plain(comment.body))
  }

  async function keep(text: string) {
    setEditing(null)
    const said = text.trim()
    const before = kept(comment.body)
    if (said === plain(comment.body).trim() && extras.length === before.length && picked.length === 0) return
    // What is not words is kept unless it was taken out here: the picture
    // sent with it is not the person's typo — `docs/specs/rich-text.md`.
    /* And the names in its words, wherever the edit left their words alone. */
    await acts.edit(comment.id, retext({ type: 'doc', content: extras }, said, [...namedIn(comment.body), ...picked])).catch(() => {})
  }

  return (
    <div data-comment className="group flex gap-3 px-4 py-3">
      <Avatar
        name={comment.author_name}
        {...(comment.author_id ? { id: comment.author_id } : {})}
        url={comment.author_avatar_url}
        size={24}
      />
      <div className="flex min-w-px flex-1 flex-col gap-1">
        <div className="flex items-baseline gap-2 text-sm">
          <span className="text-ink">{comment.author_name}</span>
          {/* A person must be able to tell their own words from the ones
              their tool wrote for them. */}
          <Origin origin={comment.origin} authorId={comment.author_id} />
          {/* Brought from Linear, under the name Linear gave: said, so a
              colleague's face is not taken for their saying it here. */}
          {comment.origin === 'import' && <span className="text-ink-3">{SAID.imported}</span>}
          <span className="text-ink-3">{dayAndClock(comment.created_at)}</span>
          {comment.edited_at && (
            <span data-edited className="text-ink-3">
              {W.edited}
            </span>
          )}
          {/*
            Edit and delete behind a menu, not two words on the line: they
            were the loudest thing on every comment, in red, for the two
            things done to one least often. Under the pointer on a desk;
            always there on a touch screen, where there is no pointer to
            bring it.
          */}
          {may && (
            <span className="ml-auto flex shrink-0 opacity-0 transition-opacity on-group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100">
              <Popover
                shape="bare"
                width={160}
                align="right"
                sheet={false}
                testId="comment-menu"
                said={W.more}
                label={
                  <span data-control className="flex size-7 items-center justify-center rounded-full text-ink-2">
                    <Icon name="ellipsis" size={14} />
                  </span>
                }
              >
                {(close) => (
                  <div data-menu className="py-1">
                    <button
                      data-row
                      data-testid="edit-comment"
                      onClick={() => {
                        close()
                        open()
                      }}
                      className="flex w-full items-center gap-3 px-3 text-left text-base text-ink"
                      style={{ height: 'var(--row-h)' }}
                    >
                      <Icon name="compose" size={16} className="text-ink-2" />
                      {ACTS.edit}
                    </button>
                    {/* Not asked about: Undo follows it, in the toast and
                        on ⌘Z. */}
                    <button
                      data-row
                      data-testid="delete-comment"
                      onClick={() => {
                        close()
                        void acts.remove(comment.id)
                      }}
                      className="flex w-full items-center gap-3 px-3 text-left text-base text-danger"
                      style={{ height: 'var(--row-h)' }}
                    >
                      <Icon name="trash" size={16} />
                      {ACTS.delete}
                    </button>
                  </div>
                )}
              </Popover>
            </span>
          )}
        </div>

        {editing === null ? (
          /* Drawn rather than flattened: a comment is written as one line, but
             one written by a tool or pasted from somewhere can carry
             structure, and `plain()` threw it away silently. */
          <>
            <Doc body={comment.body} />
            {/* An agent's question: its choices, or the answer. */}
            {comment.choices && comment.choices.length > 0 && (
              <div data-question={comment.id} className="pt-1">
                <Choices
                  id={comment.id}
                  choices={comment.choices}
                  answer={comment.answer}
                  answeredBy={comment.answered_by_name}
                  canAnswer={canAnswer}
                  onAnswered={acts.answered}
                  meName={acts.meName}
                />
              </div>
            )}
          </>
        ) : (
          <>
            {/*
              It has to look like a field.
              
              The first version replaced the text with a bare transparent
              input in the same place, which is the right *position* and no
              signal at all: press edit and nothing changes but the caret.
              The ground is the one every other field in the product has, and
              the line height matches the paragraph it replaces so the row
              does not change height as it opens.
            */}
            <span className="relative flex flex-col">
              {call.list}
              <input
                {...notALogin}
                data-testid="edit-comment-field"
                autoFocus
                className="w-full rounded-[var(--r-row)] px-2 text-base leading-[1.5] outline-none bg-track text-ink"
                style={{
                  letterSpacing: 'var(--track-body)',
                }}
                value={editing}
                onChange={(e) => setEditing(e.target.value)}
                onKeyDown={(e) => {
                  if (call.key(e)) return
                  if (e.key === 'Enter') {
                    void keep(e.currentTarget.value)
                  } else if (e.key === 'Escape') {
                    dropped.current = true
                    setEditing(null)
                  }
                }}
                // Kept on the way out, the same as the task's title: leaving a
                // field is not a way of throwing away what was typed in it.
                onBlur={(e) => {
                  if (dropped.current) {
                    dropped.current = false
                    return
                  }
                  void keep(e.currentTarget.value)
                }}
              />
            </span>
            {/* Said once, quietly, and directly under the field it is about.
                Enter and Escape are invisible otherwise, and a control whose
                two exits are both guesses is one people leave by clicking
                away and hoping. */}
            <span className="pl-2 text-xs text-ink-3">{SAYS.enterToKeep}</span>
            {/* What is not words, still there — each with a way to take it
                out, kept on the edit's Enter like the words are. */}
            {extras.map((node, i) => (
              <div key={i} data-comment-extra className="relative">
                <Doc body={{ type: 'doc', content: [node] }} />
                <button
                  type="button"
                  data-testid="drop-comment-extra"
                  aria-label={W.remove}
                  title={W.remove}
                  /* Pressed, not clicked: the field keeps the caret, so the
                     blur that would keep the edit does not fire. */
                  onMouseDown={(e) => {
                    e.preventDefault()
                    setExtras((all) => all.filter((_, at) => at !== i))
                  }}
                  className="absolute top-3 right-3 flex size-7 items-center justify-center bg-[rgb(0_0_0/0.55)] transition-colors mouse:hover:bg-[rgb(0_0_0/0.8)]"
                  style={{ borderRadius: 'var(--r-row)', color: '#fff' }}
                >
                  <Icon name="trash" size={16} />
                </button>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  )
}

/** The parts of a body that are not the line somebody typed. */
function kept(body: unknown): unknown[] {
  const doc = body as { content?: { type?: string }[] } | null
  return (doc?.content ?? []).filter((n) => n.type !== 'paragraph')
}
