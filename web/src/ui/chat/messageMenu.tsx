import { useState } from 'react'
import { MORE, ACTS } from '../../data/words.js'
import { CHAT as W } from '../../words/chat.js'
import { type PersonInWorkspace } from '@tracker/shared-schema'
import { type IconName, Icon } from '../glyphs.jsx'
import { useAttach } from '../kit.jsx'
import { Doc } from '../Doc.jsx'
import { asDoc } from '../../data/doc.js'
import { ChatComposer } from '../ChatComposer.jsx'
import { type Message } from './lines.jsx'

/**
 * Its link, Edit, and Delete behind one more press — it cannot be taken back.
 *
 * A phone's sheet draws the same menu `tall`, at a thumb's 44, with the
 * reply and the text — which a desk keeps on the card beside the message —
 * added at its head.
 */
export function MessageMenu({
  canEdit,
  canDelete,
  onEdit,
  onDelete,
  onPromote,
  onCopyLink,
  onReply,
  onCopyText,
  onSelectText,
  onQuote,
  tall = false,
}: {
  /** The address that opens the room at it. */
  onCopyLink?: () => void
  canEdit: boolean
  canDelete: boolean
  onEdit: () => void
  onDelete: () => void
  /** What was decided here stops living only here — `chat-threads.md`. */
  onPromote?: () => void
  onReply?: () => void
  onCopyText?: () => void
  onSelectText?: () => void
  /** Into the line as a quote — `docs/specs/chat-composer.md`. */
  onQuote?: () => void
  tall?: boolean
}) {
  const [sure, setSure] = useState(false)
  if (sure) {
    return (
      <div className="flex flex-col gap-3 p-3">
        <span className={tall ? 'text-lg' : 'text-base'} style={{ color: 'var(--ink)' }}>
          {W.deleteForEveryone}
        </span>
        <span className="flex justify-end gap-2">
          <button
            onClick={() => setSure(false)}
            className={`flex items-center rounded-full px-3 text-base font-medium transition-colors mouse:hover:bg-[var(--hover)] ${tall ? 'h-11' : 'h-8'} text-ink-2`}
          >
            {MORE.cancel}
          </button>
          <button
            data-testid="confirm-delete-message"
            onClick={onDelete}
            className={`flex items-center rounded-full px-4 text-base font-medium ${tall ? 'h-11' : 'h-8'} bg-danger`}
            style={{ color: '#fff' }}
          >
            {ACTS.delete}
          </button>
        </span>
      </div>
    )
  }
  const row = (testId: string, icon: IconName, words: string, press: () => void, danger = false) => (
    <button
      data-row
      data-testid={testId}
      data-danger={danger || undefined}
      onClick={press}
      className={`flex w-full items-center gap-3 text-left ${tall ? 'px-4 text-lg' : 'px-3 text-base'}`}
      style={{ height: tall ? 44 : 'var(--row-h)', color: danger ? 'var(--danger)' : 'var(--ink)' }}
    >
      <Icon name={icon} size={tall ? 20 : 16} style={{ color: danger ? undefined : 'var(--ink-2)' }} />
      {words}
    </button>
  )
  return (
    <div data-menu className="py-1">
      {onReply && row('sheet-reply', 'reply', W.replyInThread, onReply)}
      {onCopyText && row('copy-message-text', 'copy', W.copyText, onCopyText)}
      {onSelectText && row('select-message-text', 'type', W.selectText, onSelectText)}
      {onQuote && row('quote-message', 'quote', W.quote, onQuote)}
      {onCopyLink && row('copy-message-link', 'link', W.copyMessageLink, onCopyLink)}
      {onPromote && row('make-task-from-message', 'tasks', MORE.makeATask, onPromote)}
      {canEdit && row('edit-message', 'compose', W.editMessage, onEdit)}
      {canDelete && row('delete-message', 'trash', W.deleteMessage, () => setSure(true), true)}
    </div>
  )
}

/**
 * A message rewritten in place: its words in the line, its files as tiles
 * above it each with a bin, and the clip for more where the room has a
 * project to keep them in — `docs/specs/message-edit.md`.
 */
export function MessageEditor({
  m,
  projectId,
  roomId,
  people,
  meId,
  onCancel,
  onSave,
}: {
  m: Message
  projectId: string | null
  roomId: string | null
  people: PersonInWorkspace[]
  meId?: string | undefined
  onCancel: () => void
  onSave: (body: { type: 'doc'; content: unknown[] }) => void
}) {
  const content = ((m.body as { content?: { type?: string }[] } | null)?.content ?? []) as { type?: string }[]
  /* A file and a GIF are kept beside the words being edited, each with a
     way to take it out — the line's editor knows neither. */
  const extra = (n: { type?: string }) => n.type === 'attachment' || n.type === 'gif'
  const words = content.filter((n) => !extra(n))
  const [kept, setKept] = useState(() => content.filter(extra))
  const attach = useAttach(`room:${roomId}`)
  return (
    <div data-message-editor className="flex flex-col gap-2">
      {kept.map((node, i) => (
        <div key={i} data-message-extra className="relative">
          <Doc body={{ type: 'doc', content: [node] }} />
          <button
            type="button"
            data-testid="drop-message-extra"
            aria-label={MORE.remove}
            title={MORE.remove}
            onMouseDown={(e) => {
              e.preventDefault()
              setKept((all) => all.filter((_, at) => at !== i))
            }}
            className="absolute top-3 right-3 flex size-7 items-center justify-center bg-[rgb(0_0_0/0.55)] transition-colors mouse:hover:bg-[rgb(0_0_0/0.8)]"
            style={{ borderRadius: 'var(--r-row)', color: '#fff' }}
          >
            <Icon name="trash" size={16} />
          </button>
        </div>
      ))}
      <ChatComposer
        placeholder={W.editMessage}
        projectId={projectId}
        {...(roomId ? { roomId } : {})}
        initial={{ type: 'doc', content: words.length ? words : [{ type: 'paragraph' }] }}
        people={people.filter((p) => p.actor_id !== meId)}
        clip={attach.clip}
        tray={attach.strip}
        holding={kept.length + attach.held.length > 0 || attach.uploading}
        onPaste={(data) => attach.take(data)}
        onCancel={onCancel}
        onSend={async (doc) => {
          /* A file added while editing is waited for, as a sent one is. */
          await attach.ready()
          const held = attach.spend()
          onSave({ type: 'doc', content: [...doc.content, ...kept, ...asDoc('', held).content] })
        }}
      />
    </div>
  )
}
