import { useEffect, useRef, useState } from 'react'
import { COMMENTS as W } from '../words/comments.js'
import { asDoc, withCard } from '../data/doc.js'
import { Comments, type Comment, type OnWordsThreads } from './Comments.jsx'
import { Avatar, Composer } from './kit.jsx'

/**
 * A thread beside the words it is on.
 *
 * Opened two ways: words chosen and Comment pressed, which is a new thread
 * — the words, a line to write on; or a tinted stretch pressed, which is
 * the thread already there. Drawn whole on its first frame, inside the
 * document's column under the line the words end on, so it scrolls with
 * them. Escape or a press anywhere else closes it.
 */

export type CardAt = { top: number; left: number }

export type WordsCardState =
  | { kind: 'new'; at: CardAt; quote: string; send: (body: unknown) => Promise<string> }
  | { kind: 'thread'; at: CardAt; id: string }

export function WordsCard({
  card,
  comments,
  meId,
  canWrite,
  canEditAny,
  projectId,
  post,
  words,
  onChanged,
  onClose,
  onMade,
}: {
  card: WordsCardState
  comments: Comment[]
  meId: string
  canWrite: boolean
  canEditAny: boolean
  projectId: string
  post: string
  words: OnWordsThreads
  onChanged: () => Promise<void> | void
  onClose: () => void
  /** The new thread is made: the card becomes it. */
  onMade: (id: string) => void
}) {
  const box = useRef<HTMLDivElement | null>(null)
  const mine = comments.find((c) => c.author_id === meId)
  const me = { name: mine?.author_name ?? W.you, avatar_url: mine?.author_avatar_url ?? null }
  const [note, setNote] = useState('')
  /* What was sent and not yet answered, drawn at once; and a refusal, said in the card. */
  const [sending, setSending] = useState<string | null>(null)
  const [refused, setRefused] = useState<string | null>(null)

  useEffect(() => {
    const away = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null
      if (!t || box.current?.contains(t)) return
      /* Another tinted stretch opens its own thread; that press is its. */
      if (t.closest('[data-testid="file-body"] [data-comment], [data-text-bar], [data-popover], [role="menu"]')) return
      onClose()
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('pointerdown', away, true)
    window.addEventListener('keydown', key, true)
    return () => {
      document.removeEventListener('pointerdown', away, true)
      window.removeEventListener('keydown', key, true)
    }
  }, [onClose])

  return (
    <div
      ref={box}
      data-words-card={card.kind === 'thread' ? card.id : 'new'}
      className="words-card absolute z-[40] flex w-[360px] max-w-full flex-col bg-float"
      style={{ top: card.at.top, left: card.at.left, borderRadius: 'var(--r-card)', boxShadow: 'var(--float-shadow)' }}
    >
      {card.kind === 'thread' ? (
        <Comments
          comments={comments}
          meId={meId}
          canWrite={canWrite}
          canEditAny={canEditAny}
          projectId={projectId}
          post={post}
          onChanged={onChanged}
          only={card.id}
          words={words}
        />
      ) : (
        <div className="flex flex-col gap-3 p-4">
          <p data-thread-words className="truncate border-l-2 pl-2 text-sm text-ink-2" style={{ borderColor: 'var(--comment-line)' }}>
            {card.quote}
          </p>
          {sending !== null ? (
            /* Said, on its way: the line it will be, in the place it will stand. */
            <div className="flex gap-3 opacity-60">
              <Avatar name={me.name} id={meId} url={me.avatar_url} size={24} />
              <div className="flex min-w-px flex-1 flex-col gap-1">
                <span className="text-sm text-ink">{me.name}</span>
                <span className="text-base text-ink">{sending}</span>
              </div>
            </div>
          ) : (
            <Composer
              testId="comment-on-words-field"
              placeholder={W.addAComment}
              autoFocus
              value={note}
              onChange={setNote}
              projectId={projectId}
              onSend={(text, attached, named, linkCard) => {
                const said = text.trim()
                if (!said && attached.length === 0) return
                setNote('')
                setRefused(null)
                setSending(said)
                void card
                  .send(withCard(asDoc(said, attached, named), linkCard))
                  .then((id) => onMade(id))
                  .catch((e: Error & { said?: { error?: { code?: string } } }) => {
                    setSending(null)
                    setNote(text)
                    setRefused(e.said?.error?.code === 'anchor_gone' ? W.wordsGone : W.couldNotComment)
                  })
              }}
            />
          )}
          {refused && (
            <p role="alert" className="text-sm text-danger">
              {refused}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
