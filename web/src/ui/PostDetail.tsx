import { useCallback, useEffect, useRef, useState } from 'react'
import { BAR, HEADS } from '../data/words.js'
import { api, untilAnswered } from '../data/api.js'
import { Editor, type EditorHandle } from './Editor.jsx'
import { DropHere, useDropFiles } from './DropFiles.jsx'
import { EDITOR } from '../words/editor.js'
import { Discussion, type Comment } from './Comments.jsx'
import { Avatar, MentionedIn, Popover, Toolbar, readLinks, notALogin } from './kit.jsx'
import { recall, remember } from '../data/memory.js'
import { Round, RoundFace } from './TaskDetail.jsx'
import { Icon } from './glyphs.jsx'
import { dayAndClock } from '../data/said.js'
import { POST_DETAIL as W } from '../words/postDetail.js'
import { offerUndo } from '../data/undo.js'
import { SubscribePill } from './Leaving.jsx'

type Full = {
  id: string
  title: string
  body: unknown
  category: string | null
  schedule: string | null
  author_id: string
  author_name: string
  author_avatar_url?: string | null
  created_at: string
  /** Whether **you** follow it. */
  subscribed?: boolean
  /** Whether an agent wrote it. */
  author_agent?: boolean
  /** What the server's PATCH and DELETE would answer. */
  may_edit?: boolean
  may_delete?: boolean
}

/**
 * An announcement, opened.
 *
 * It could be written and never read. The card carried a Reply button that
 * put the post's id in the address, and nothing was rendered for it — so
 * `GET /api/posts/:id`, its patch, its delete and its comments endpoint all
 * existed and nothing in the product had ever called them. A post is one of
 * the four entities and it was the only one without a screen.
 *
 * Shaped after the document, because the argument is the same one: the
 * comments belong to the row, the body is edited in place, and a read must
 * never overwrite what somebody is in the middle of writing.
 */
type PostRead = { post: Full; comments: Comment[] }

/*
 * Read ahead while the hand is on the card, as a task and a document are —
 * so the announcement opens on its words and its replies, not on nothing
 * for a round trip. Once per announcement; the screen still asks again.
 */
const asked = new Set<string>()
export function nearPost(postId: string): void {
  if (asked.has(postId) || recall<PostRead>(`post:${postId}`)) return
  asked.add(postId)
  void readLinks('post', postId).catch(() => {})
  void api<PostRead>(`/posts/${postId}`)
    .then((r) => remember<PostRead>(`post:${postId}`, r))
    .catch(() => asked.delete(postId))
}

export function PostDetail({
  postId,
  projectId,
  canWrite,
  canEditAny,
  canDeleteAny = false,
  meId,
  onClose,
  onChanged,
  onGone,
}: {
  postId: string
  /** Where a picture or a file put into the body becomes a row. */
  projectId: string
  canWrite: boolean
  /** `content.edit.said`: whether somebody else's words are yours to change. */
  canEditAny: boolean
  /** Whoever runs the project, or the owner (`content.edit.said`): may take
      away an announcement somebody else wrote — the same rule the server's
      delete keeps (`mayEditSaid`). */
  canDeleteAny?: boolean
  /** Whose post it is decides whether the editing is offered at all. */
  meId: string
  onClose: () => void
  onChanged: () => void
  /** Deleted, or put back: the list it goes back to, at once. */
  onGone?: ((id: string, gone: boolean) => void) | undefined
}) {
  /* Opened on what it said last time, and replaced in place by the read —
     a screen that stood blank for a round trip on every visit. */
  const [post, setPost] = useState<Full | null>(() => recall<PostRead>(`post:${postId}`)?.post ?? null)
  const [comments, setComments] = useState<Comment[]>(() => recall<PostRead>(`post:${postId}`)?.comments ?? [])
  const [text, setText] = useState<unknown>(() => recall<PostRead>(`post:${postId}`)?.post.body ?? null)
  const [gone, setGone] = useState(false)
  const [unsaved, setUnsaved] = useState(false)
  /* Deleting somebody else's announcement, asked about first. */
  const [asking, setAsking] = useState(false)
  /* "Link copied", for a moment, beside the menu it came from. */
  const [copied, setCopied] = useState<string | null>(null)
  /* An agent's announcement opened for changing by Edit — somebody else's
     words are never a field open for a keystroke until somebody asks. */
  const [editing, setEditing] = useState(false)
  const title = useRef<HTMLInputElement | null>(null)
  /*
   * The title being written, apart from the announcement's: set when the
   * field takes the caret and let go once what it held is saved, or was
   * not changed. Until then the field shows it, and a read that lands
   * meanwhile — one asked before the save, say — does not put the old
   * title back under the caret. It wrote into `post` as it was typed, and
   * leaving it compared the field with itself: a new title was never sent,
   * one's own included, from the day the screen was made.
   */
  const [draftTitle, setDraftTitle] = useState<string | null>(null)
  /* What the field held when it took the caret: leaving it saves only a
     change made since. Kept over a save that failed, so leaving it again
     tries again. */
  const titleWas = useRef<string | null>(null)
  /* The body as the server last answered it, to leave unsaid a body
     nobody changed — Edit, a click into the words, Done was a change
     announced to everybody and every webhook. */
  const keptBody = useRef<string | null>(JSON.stringify(recall<PostRead>(`post:${postId}`)?.post.body ?? null))

  /* Whether what is in the field is the person's and not the server's. The
     document screen has the long version of this argument; the short one is
     that news arrives here by refetching, and a refetch must not take back a
     paragraph somebody is halfway through. */
  const touched = useRef(false)
  // biome-ignore lint/correctness/useExhaustiveDependencies: a different announcement is a different draft
  useEffect(() => {
    touched.current = false
    setUnsaved(false)
  }, [postId])

  const load = useCallback(async () => {
    /* What points at it, asked beside it: the section is drawn inside the
       post, and asked from there it grew in a round trip after the post. */
    const [r] = await Promise.all([api<PostRead>(`/posts/${postId}`), readLinks('post', postId).catch(() => [])])
    remember<PostRead>(`post:${postId}`, r)
    setPost(r.post)
    setComments(r.comments)
    if (touched.current) return
    keptBody.current = JSON.stringify(r.post.body ?? null)
    setText(r.post.body ?? null)
  }, [postId])

  useEffect(() => {
    setGone(false)
    /* Gone only when the server says so: a refusal it could not help — a
       restart, a 500 — is asked again rather than called a deletion. */
    return untilAnswered(load, () => setGone(true))
  }, [load])

  /** The body, for files let go around it. */
  const into = useRef<EditorHandle | null>(null)
  const drop = useDropFiles(Boolean(post && openFor(post, meId, canWrite, editing)), (files) => into.current?.files?.(files))
  /* Opened by Edit, the title takes the caret — after the render that
     lets it. */
  useEffect(() => {
    if (editing) title.current?.focus()
  }, [editing])

  if (gone) {
    return (
      <div className="flex h-full flex-col">
        <Toolbar>
          <Back onClose={onClose} />
        </Toolbar>
        <p className="mt-6 text-sm text-ink-2">{W.gone}</p>
      </div>
    )
  }
  if (!post) return null

  const mine = post.author_id === meId
  /*
   * Off the screen and out of the list at once; the delete and the list
   * follow, and the shell's toast offers it back for thirty seconds, on ⌘Z
   * too.
   */
  const takeAway = () => {
    const { id, title } = post
    onClose()
    onGone?.(id, true)
    const deleting = api(`/posts/${id}`, { method: 'DELETE' }).finally(() => onChanged())
    offerUndo(
      W.deleted(title),
      deleting,
      () => api(`/posts/${id}/restore`, { method: 'POST' }),
      () => {
        onGone?.(id, false)
        onChanged()
      },
    )
  }
  /* One's own, open as it always was; an agent's, behind Edit, to
     whoever the server says may change it — its connector, whoever runs
     the project or holds `edit.any` on it, the owner (`may_edit`). Another person's, never: the
     server lets whoever runs the project change it, and a field open on
     somebody else's words is an edit nobody meant. Narrower than the
     server, never wider. */
  const offered = !mine && post.author_agent === true && post.may_edit === true
  const editable = openFor(post, meId, canWrite, editing)
  const deletable = post.may_delete ?? ((canWrite && mine) || canDeleteAny)

  /* Given the value, never read from state — the handler closes over the
     render it was made in, and leaving a field in the same tick as the last
     keystroke then compares against text that is one render old, decides
     nothing changed and writes nothing. No request, no error, no sign. */
  async function patch(part: Record<string, unknown>): Promise<boolean> {
    if (!post) return false
    try {
      await api(`/posts/${post.id}`, { method: 'PATCH', body: JSON.stringify(part) })
      setUnsaved(false)
      touched.current = false
      onChanged()
      return true
    } catch {
      setUnsaved(true)
      return false
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* The head a task and a document have, on the project's bar: a round
          way back, and the rarer things behind ⋯ — delete among them, which
          stood on the bar as a red word, the loudest thing on the screen for
          the rarest act. `docs/specs/docs.md`. */}
      <Toolbar>
        <div className="flex w-full items-center gap-3">
          <Back onClose={onClose} />
          {unsaved && (
            <span data-unsaved className="min-w-px truncate text-sm text-danger">
              {W.unsaved}
            </span>
          )}
          <span className="ml-auto flex items-center gap-2">
            {offered && editing && (
              <button
                type="button"
                data-testid="post-done"
                /* Pressed, the field it leaves saves first — as leaving it
                   anywhere else does. */
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  ;(document.activeElement as HTMLElement | null)?.blur?.()
                  setEditing(false)
                }}
                className="inline-flex h-8 items-center rounded-full px-3 text-sm font-medium"
                style={{ background: 'var(--track-on)', boxShadow: 'var(--control-shadow)', color: 'var(--ink)' }}
              >
                {W.doneEditing}
              </button>
            )}
            {copied && (
              <span className="text-sm text-ink-3" role="status">
                {copied}
              </span>
            )}
            <SubscribePill
              testId="follow-post"
              on={Boolean(post.subscribed)}
              path={`/posts/${post.id}`}
              words={W}
              onChange={(on) => setPost((p) => (p ? { ...p, subscribed: on } : p))}
            />
            <Popover
              shape="bare"
              width={232}
              align="right"
              testId="post-menu"
              said={W.more}
              /* Shut, the question goes with it: reopened, ⋯ is the menu again. */
              onOpenChange={(open) => {
                if (!open) setAsking(false)
              }}
              sheet={false}
              label={<RoundFace icon="ellipsis" on={false} />}
            >
              {(close) => (
                <div data-menu className="py-1">
                  <button
                    data-row
                    data-testid="copy-post-link"
                    onClick={() => {
                      close()
                      void navigator.clipboard
                        .writeText(location.href)
                        .then(() => setCopied(W.linkCopied))
                        .catch(() => setCopied(W.couldNotCopy))
                        .finally(() => setTimeout(() => setCopied(null), 1800))
                    }}
                    className="flex w-full items-center gap-3 px-3 text-left text-base text-ink"
                    style={{ height: 'var(--row-h)' }}
                  >
                    <Icon name="link" size={16} className="text-ink-2" />
                    {W.copyLink}
                  </button>
                  {offered && !editing && !asking && (
                    <button
                      data-row
                      data-testid="edit-post"
                      onClick={() => {
                        close()
                        setEditing(true)
                      }}
                      className="flex w-full items-center gap-3 px-3 text-left text-base text-ink"
                      style={{ height: 'var(--row-h)' }}
                    >
                      <Icon name="compose" size={16} className="text-ink-2" />
                      {W.editPost}
                    </button>
                  )}
                  {deletable && asking && (
                    /* Somebody else's announcement is not taken away on one
                       press: it says whose it is and that it goes for
                       everyone, and the red word is the second press. Undo
                       follows either way. */
                    <div data-testid="delete-post-ask" className="flex flex-col gap-3 px-3 py-2">
                      <p className="m-0 text-base text-ink">{W.deleteTheirs(post.author_name)}</p>
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setAsking(false)}
                          className="h-8 rounded-[var(--r-row)] px-3 text-base text-ink-2 mouse:hover:bg-[var(--hover)]"
                        >
                          {W.keep}
                        </button>
                        <button
                          type="button"
                          data-testid="delete-post-confirm"
                          onClick={() => {
                            close()
                            setAsking(false)
                            takeAway()
                          }}
                          className="h-8 rounded-[var(--r-row)] bg-danger px-3 text-base font-medium text-white"
                        >
                          {W.deleteIt}
                        </button>
                      </div>
                    </div>
                  )}
                  {deletable && !asking && (
                    <button
                      data-row
                      data-testid="delete-post"
                      onClick={() => {
                        if (!mine) return setAsking(true)
                        close()
                        takeAway()
                      }}
                      className="flex w-full items-center gap-3 px-3 text-left text-base text-danger"
                      style={{ height: 'var(--row-h)' }}
                    >
                      <Icon name="trash" size={16} />
                      {W.deletePost}
                    </button>
                  )}
                </div>
              )}
            </Popover>
          </span>
        </div>
      </Toolbar>

      {/* Files held anywhere over it go into the body — `docs/specs/drop-files.md`. */}
      <div className="relative flex min-h-0 flex-1 flex-col" {...drop.handlers}>
        {drop.held && <DropHere bleed said={EDITOR.dropIntoPost} />}
        <div data-foot className="reads min-h-0 flex-1 overflow-y-auto pt-4">
          <div className="max-w-[720px]">
            <div className="flex items-center gap-3">
              <Avatar name={post.author_name} id={post.author_id} url={post.author_avatar_url} size={28} />
              <div className="flex flex-col">
                <span className="text-base font-medium text-ink">{post.author_name}</span>
                <span className="text-base text-ink-2">
                  {dayAndClock(post.created_at)}
                  {post.schedule && <span data-schedule>{W.asked(post.schedule)}</span>}
                </span>
              </div>
            </div>

            {/* The size a task's and a document's title is. */}
            <input
              {...notALogin}
              ref={title}
              data-testid="post-title"
              className="mt-4 w-full bg-transparent text-xl leading-[1.3] font-medium outline-none text-ink"
              value={draftTitle ?? post.title}
              disabled={!editable}
              onFocus={(e) => {
                if (draftTitle !== null) return
                titleWas.current = e.target.value
                setDraftTitle(e.target.value)
              }}
              onChange={(e) => setDraftTitle(e.target.value)}
              onBlur={(e) => {
                const title = e.target.value.trim()
                if (!title || title === titleWas.current?.trim()) {
                  setDraftTitle(null)
                  return
                }
                void patch({ title }).then((ok) => {
                  if (!ok) return
                  setPost((p) => (p ? { ...p, title } : p))
                  titleWas.current = title
                  /* Typed on while it was saving: what is in the field now
                     is not what was sent, and stays to be saved on leaving. */
                  setDraftTitle((d) => (d?.trim() === title ? null : d))
                })
              }}
            />

            <div className="mt-3">
              <Editor
                /* Made with whether it takes keys, and kept so: Edit and
                   Done make it again, open or shut, as a document's is
                   made again when it starts being written together. */
                key={editable ? 'open' : 'shut'}
                testId="post-body"
                handle={into}
                value={text}
                projectId={projectId}
                editable={editable}
                placeholder={editable ? W.whatAbout : W.nothingWritten}
                onChange={(next) => {
                  touched.current = true
                  setText(next)
                }}
                // On leaving the body rather than on every keystroke.
                onSettle={(next) => {
                  if (!post) return
                  const said = JSON.stringify(next)
                  /* Nothing typed since it was saved, or back to what the
                     server has: no change, and nothing is said about one. */
                  if (!touched.current || said === keptBody.current) {
                    touched.current = false
                    return
                  }
                  touched.current = false
                  setPost({ ...post, body: next })
                  void patch({ body: next }).then((ok) => {
                    if (ok) keptBody.current = said
                    else touched.current = true
                  })
                }}
              />
            </div>

            <div className="mt-6 flex flex-col gap-6">
              <MentionedIn type="post" id={post.id} />
              <Discussion
                title={HEADS.replies}
                comments={comments}
                meId={meId}
                canWrite={canWrite}
                canEditAny={canEditAny}
                projectId={projectId}
                post={`/posts/${post.id}/comments`}
                /* And the list behind, whose card says how many replies. */
                onChanged={() => {
                  onChanged()
                  return load()
                }}
                label={BAR.reply}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/* Whether the title and the words take a keystroke: one's own, as the
   server allows; an agent's, once Edit was pressed and the server said
   this reader may (`may_edit`). Unsaid — a read from before the field
   existed — one's own stays open, as it was. */
function openFor(post: Full, meId: string, canWrite: boolean, editing: boolean): boolean {
  if (post.author_id === meId) return canWrite && post.may_edit !== false
  return editing && post.author_agent === true && post.may_edit === true
}

const Back = ({ onClose }: { onClose: () => void }) => (
  <Round icon="chevL" label={W.back} testId="close-post" on={false} onPress={onClose} />
)
