import { MAKE, SAYS } from '../../data/words.js'
import { PROJECT_SAID as W } from '../../words/project.js'
import { Doc } from '../Doc.jsx'
import { nearPost } from '../PostDetail.jsx'
import { NewButton } from '../New.jsx'
import { Toolbar, PageTitle, EmptyState, Avatar } from '../kit.jsx'
import { LABEL } from '../../data/tools.js'
import { dayAndClock } from '../../data/said.js'
import { type ProjectProps } from '../Project.jsx'
import { type ProjectFrame } from './useProjectFrame.js'
import { type ProjectContent } from './useProjectContent.js'

/**
 * Announcements, newest first.
 */
export function postsList({
  project,
  canWrite,
  objectId,
  onNavigate,
  posts,
  shown,
  load,
}: Pick<ProjectProps, 'project' | 'canWrite' | 'objectId'> &
  Pick<ProjectFrame, 'onNavigate' | 'posts' | 'shown'> &
  Pick<ProjectContent, 'load'>): React.ReactNode {
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
        {(posts ?? []).map((p) => (
          <article
            key={p.id}
            data-post
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
              <div className="flex flex-col">
                <span className="text-base font-medium text-ink">{p.author_name}</span>
                <span className="text-base text-ink-2">
                  {dayAndClock(p.created_at)}
                  {p.schedule && <span data-schedule>{W.asked(p.schedule)}</span>}
                </span>
              </div>
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
