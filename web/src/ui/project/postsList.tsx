import { MAKE, SAYS } from '../../data/words.js'
import { PROJECT_SAID as W } from '../../words/project.js'
import { Doc } from '../Doc.jsx'
import { nearPost, publishPost } from '../PostDetail.jsx'
import { NewButton } from '../New.jsx'
import { Toolbar, PageTitle, EmptyState, Avatar, Button } from '../kit.jsx'
import { POST_DETAIL } from '../../words/postDetail.js'
import { LABEL } from '../../data/tools.js'
import { dayAndClock } from '../../data/said.js'
import { type Post, type ProjectProps } from '../Project.jsx'
import { type ProjectFrame } from './useProjectFrame.js'
import { type ProjectContent } from './useProjectContent.js'

/* A card that said it could not be published — this screen's, never the
   server's. */
type Shown = Post & { notPublished?: boolean }

/**
 * Announcements, newest first — the reader's own drafts above them,
 */
export function postsList({
  project,
  canWrite,
  objectId,
  onNavigate,
  posts,
  setPosts,
  shown,
  load,
}: Pick<ProjectProps, 'project' | 'canWrite' | 'objectId'> &
  Pick<ProjectFrame, 'onNavigate' | 'posts' | 'setPosts' | 'shown'> &
  Pick<ProjectContent, 'load'>): React.ReactNode {
  /*
   * A draft published from its card: it leaves the drafts and lands at the
   * top of what was published, at once, with the hour it is now — and goes
   * back, saying so, if the server refuses. The press is the only way in:
   * nothing here publishes on a read or an address.
   */
  const publish = (id: string) => {
    let was: Post[] | null = null
    setPosts((had) => {
      was = had
      if (!had) return had
      const it = had.find((x) => x.id === id)
      if (!it) return had
      const rest = had.filter((x) => x.id !== id)
      const drafts = rest.filter((x) => x.audience === 'author').length
      const out: Shown = { ...it, audience: 'project', created_at: new Date().toISOString(), notPublished: false }
      return [...rest.slice(0, drafts), out, ...rest.slice(drafts)]
    })
    /* Put back only when the publishing failed — not when the list read
       after it did, which would show a published one as a draft. */
    void publishPost(id).then(
      () => void load().catch(() => {}),
      () =>
        setPosts((had) => {
          const back = was ?? had
          return back && back.map((x) => (x.id === id ? ({ ...x, notPublished: true } as Shown) : x))
        }),
    )
  }
  return (
    shown === 'posts' &&
    !objectId && (
      <div data-foot className="reads flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto">
        {/* The bar the tasks have: the name and a round plus beside it
                on the left, the rest on the right — TRA-98. */}
        <Toolbar>
          <span className="mr-auto flex min-w-px items-center gap-3">
            <PageTitle>{LABEL.posts}</PageTitle>
            {/* A window with a title and the words, in the editor a
                    task's description has — an announcement is what it says,
                    and a one-line field made it a headline with nothing under
                    it. */}
            {canWrite && (
              <NewButton
                label={MAKE.newPost}
                variant="round"
                testId="create-new-post"
                what={{ kind: 'post', projectId: project.id }}
                onMade={async () => {
                  await load()
                }}
              />
            )}
          </span>
          {/* No "Ask every week": nothing ever asked again, so it made an
                  announcement with a question for a title and a promise the
                  product did not keep. */}
        </Toolbar>

        {posts && posts.length === 0 && (
          <EmptyState
            art="pinboard"
            title={SAYS.nothingPostedYet}
            /* The way to the first one where the eye already is, as
                   every other empty tool has. */
            action={
              canWrite ? (
                <NewButton
                  label={MAKE.newPost}
                  testId="empty-new-post"
                  what={{ kind: 'post', projectId: project.id }}
                  onMade={async () => {
                    await load()
                  }}
                />
              ) : undefined
            }
          >
            {canWrite ? W.postsHint : W.postsWait}
          </EmptyState>
        )}

        {/*
              A post is a card, not a row — and the whole of it, not an
              envelope to open.

              It was a title with a line of grey under it, which made an
              announcement look like a list item — and an announcement that
              reads like a list item is one nobody reads. Then a title and
              its first line, which still made every one a door. Now each is
              what was said, pictures and all; only the replies stay behind
              it.

              The whole card opens it, lighter under the pointer like every
              other thing that opens something. Not a press on what answers
              for itself inside — a link, a picture, a name, the buttons —
              nor one that ends a selection, which is somebody copying a
              sentence. And not one from a picture opened over the screen:
              a portal's clicks still bubble through the tree it came from.
            */}
        {(posts ?? []).map((p: Shown) => (
          <article
            key={p.id}
            data-post
            data-post-draft={p.audience === 'author' || undefined}
            onPointerEnter={() => nearPost(p.id)}
            onClick={(e) => {
              const at = e.target as Element
              if (!e.currentTarget.contains(at)) return
              if (at.closest('a, button, img, video, input, label, [role="button"]')) return
              if (window.getSelection()?.toString()) return
              onNavigate({ tool: 'posts', objectId: p.id })
            }}
            className="flex shrink-0 cursor-pointer flex-col gap-3 bg-[var(--panel)] px-4 py-4 transition-[background-color] duration-150 mouse:hover:bg-[color-mix(in_oklch,var(--panel),var(--ink)_4%)]"
            style={{ borderRadius: 'var(--r-card)' }}
          >
            <div className="flex items-center gap-3">
              <Avatar name={p.author_name} {...(p.author_id ? { id: p.author_id } : {})} url={p.author_avatar_url} size={28} />
              <div className="flex min-w-px flex-col">
                <span className="text-base font-medium text-ink">{p.author_name}</span>
                <span className="text-base text-ink-2">
                  {/* A draft has not been said, so it has no hour yet:
                      where the hour goes, what it is. Only its author
                      ever sees one. */}
                  {p.audience === 'author' ? <span data-draft-mark>{POST_DETAIL.draft}</span> : dayAndClock(p.created_at)}
                  {p.schedule && <span data-schedule>{W.asked(p.schedule)}</span>}
                </span>
              </div>
              {p.audience === 'author' && (
                <span className="ml-auto flex shrink-0 items-center gap-3">
                  {p.notPublished && (
                    <span role="status" data-not-published className="text-sm text-danger">
                      {POST_DETAIL.couldNotPublish}
                    </span>
                  )}
                  <Button tone="primary" data-testid="publish-draft" onClick={() => publish(p.id)}>
                    {POST_DETAIL.publish}
                  </Button>
                </span>
              )}
            </div>
            {/* The heading opens it too. A card with one small link at
                    the bottom is a card people read and leave. */}
            <button
              data-open-post
              className="self-start text-left text-xl font-medium text-ink"
              style={{ letterSpacing: 'var(--track-title)' }}
              onClick={() => onNavigate({ tool: 'posts', objectId: p.id })}
            >
              {p.title}
            </button>
            {/* The renderer a message uses, not an editor per card. */}
            <Doc body={p.body} />
            {/* How many replies, when there are any — quiet, under the
                    words. There was a blue Reply on every card, which the
                    card being pressable made a second way to do one thing,
                    and the loudest line on a card that had nothing to say
                    about replies. */}
            {(p.reply_count ?? 0) > 0 && (
              <span data-post-replies className="text-sm text-ink-3">
                {W.replies(p.reply_count ?? 0)}
              </span>
            )}
          </article>
        ))}

        {/* The feed used to be here. It is a page of its own now:
                announcements are what a project chose to say, and a list that
                grows by a line every time anybody touches anything pushed
                them off the screen. */}
      </div>
    )
  )
}
