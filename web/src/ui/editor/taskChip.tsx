import { createContext, useContext, useState, type ReactNode } from 'react'
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps, type Editor as Tip } from '@tiptap/react'
import { Fragment } from '@tiptap/pm/model'
import { cleanLine, lineSays, lineThreads, type LineNode } from '@tracker/shared-schema'
import { api } from '../../data/api.js'
import { followHere } from '../../data/route.js'
import { TaskRef } from '../refs.js'
import { taskChanged, useTaskCard } from '../TaskCard.jsx'
import { PersonDoorsContext } from '../PersonCard.jsx'
import { Avatar } from '../kit.jsx'
import { Icon } from '../glyphs.jsx'
import { EDITOR as W } from '../../words/editor.js'

/**
 * A task named in a body, drawn alive.
 *
 * The same node `#` writes (`TaskRef`), with one more attribute while it is
 * being made — `making`, a token the page finds it again by when the server
 * answers with the task's id. Drawn inline in the sentence: a tick, the
 * handle, the whole title as the task says it now — wrapping across lines
 * as the words it replaced did — and who has it; read from the
 * task's card and read again whenever the project's socket says the task
 * changed, so a task done on the board is done here while the document is
 * open.
 *
 * A chip made from a line that carried more than words holds that line in
 * `line`, and draws it — links that follow, mentions, a thread's words —
 * while the task is still called by it. Renamed elsewhere, it says the new
 * title in words.
 */
export const TaskChip = TaskRef.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      making: { default: null, renderHTML: () => ({}) },
    }
  },
  addNodeView() {
    return ReactNodeViewRenderer(Chip, { as: 'span' })
  },
})

/**
 * A press on a thread's words, given to the screen that holds the threads:
 * it opens the newest open one there and answers whether it did. Inside a
 * chip those words open the thread, not the task.
 */
export const ThreadPress = createContext<((target: EventTarget | null) => boolean) | null>(null)

/** A chip turned back into the words it stood for: its line, or its title. */
export function wordsOfChip(ed: Tip, title: string, raw: unknown): Fragment {
  const line = cleanLine(raw)
  if (line) {
    try {
      return Fragment.fromJSON(ed.schema, line)
    } catch {
      // A mark this editor does not have: the words alone.
    }
  }
  return title ? Fragment.from(ed.schema.text(title)) : Fragment.empty
}

/** A link in a chip followed: here when it is this product's own, otherwise in a new tab. */
function follow(href: string, e: React.MouseEvent | React.KeyboardEvent) {
  const held = e.metaKey || e.ctrlKey || e.shiftKey || e.altKey
  if (!held && followHere(href)) return
  window.open(href, '_blank', 'noopener,noreferrer')
}

/** The line, drawn: only what `cleanLine` kept, so only an address a link may have. */
function drawLine(line: LineNode[]): ReactNode[] {
  return line.map((n, i) => {
    if (n.type === 'mention')
      return (
        <span key={i} data-mention={n.attrs.id} className="chat-mention">
          @{n.attrs.label}
        </span>
      )
    let out: ReactNode = n.text
    for (const m of n.marks ?? []) {
      if (m.type === 'bold') out = <strong>{out}</strong>
      else if (m.type === 'italic') out = <em>{out}</em>
      else if (m.type === 'underline') out = <u>{out}</u>
      else if (m.type === 'strike') out = <s>{out}</s>
      else if (m.type === 'code') out = <code>{out}</code>
      else if (m.type === 'comment') out = <span data-comment={m.attrs.ids}>{out}</span>
      else if (m.type === 'link')
        out = (
          <a href={m.attrs.href} target="_blank" rel="noreferrer noopener" data-chip-link draggable={false}>
            {out}
          </a>
        )
    }
    return <span key={i}>{out}</span>
  })
}

function Chip({ node, editor }: NodeViewProps) {
  const a = node.attrs as {
    id: string | null
    projectId: string | null
    number: number | null
    key: string | null
    title: string
    line: unknown
    making: string | null
  }
  const card = useTaskCard(a.making ? null : a.id)
  const doors = useContext(PersonDoorsContext)
  const threadPress = useContext(ThreadPress)
  /* Ticked here, before the server has said so; the card read after it replaces it. */
  const [ticking, setTicking] = useState<boolean | null>(null)
  const done = ticking ?? Boolean(card?.completed_at)
  const handle = card
    ? card.project_key
      ? `${card.project_key}-${card.number}`
      : `#${card.number}`
    : a.key
      ? `${a.key}-${a.number ?? ''}`
      : a.number
        ? `#${a.number}`
        : ''
  const title = card?.title ?? a.title
  /* The line it was made from, while the task is still called by it. */
  const line = cleanLine(a.line)
  const says = lineSays(line, title)
  /* Renamed: the thread on the line's words is carried by the title instead, so it is never lost. */
  const threads = says ? '' : lineThreads(line).join(' ')
  const who =
    card?.assignees?.[0] ??
    (card?.assignee_id ? { id: card.assignee_id, name: card.assignee_name ?? '', avatar_url: card.assignee_avatar_url } : null)
  /* A task deleted, or one the reader cannot see — the server says the
     same of both: the words it was made from, as words, and no more. No
     tint, no tick, nothing that opens a task that is not there; the links
     in the line are the document's own and still work. Drawn, not
     written: the document keeps the chip, so a task brought back from the
     bin comes back alive in it, and somebody who can see the task still
     sees the chip. */
  const hidden = card === null

  function open() {
    if (!a.id) return
    const project = card?.project_id ?? a.projectId
    if (project) doors?.openTask(project, a.id)
  }

  /* A link's words follow the link; a thread's words open the thread; anything else opens the task. */
  function press(e: React.MouseEvent) {
    const t = e.target as HTMLElement
    const link = t.closest?.('a[data-chip-link]') as HTMLAnchorElement | null
    if (link) {
      e.preventDefault()
      e.stopPropagation()
      follow(link.href, e)
      return
    }
    if (threadPress?.(t)) {
      e.stopPropagation()
      return
    }
    open()
  }

  async function tick() {
    if (!a.id) return
    const to = !done
    setTicking(to)
    try {
      await api(`/tasks/${a.id}`, { method: 'PATCH', body: JSON.stringify({ completed: to }) })
      taskChanged(a.id)
    } catch {
      // Refused: put back as it is.
    } finally {
      setTicking(null)
    }
  }

  const words = says ? drawLine(line) : title

  return (
    <NodeViewWrapper
      as="span"
      data-task-chip={a.id ?? ''}
      data-done={(!hidden && done) || undefined}
      data-gone={hidden || undefined}
      contentEditable={false}
      className="task-chip"
    >
      {hidden ? (
        <span className="task-chip-title">
          {says ? (
            /* The words were the document's: its links still go where they went, and its threads open. */
            <span
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => {
                const link = (e.target as HTMLElement).closest?.('a[data-chip-link]') as HTMLAnchorElement | null
                if (link) {
                  e.preventDefault()
                  e.stopPropagation()
                  follow(link.href, e)
                } else if (threadPress?.(e.target)) e.stopPropagation()
              }}
            >
              {words}
            </span>
          ) : (
            a.title
          )}
        </span>
      ) : (
        <>
          <button
            type="button"
            role="checkbox"
            aria-checked={done}
            aria-label={done ? W.reopenTask : W.completeTask}
            data-task-tick
            disabled={!a.id || a.making !== null || !editor.isEditable}
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              e.stopPropagation()
              void tick()
            }}
            className="task-chip-tick"
          >
            {done && <Icon name="check" size={12} />}
          </button>
          {/* Glued to the handle: a line could break between the tick's box
              and the words after it, and left the tick alone at the end of
              one line on an empty tint, its task starting on the next. A
              word joiner forbids that break and takes no room. */}
          {'\u2060'}
          {/* A span, not a button: a button is one box and its words cannot
              wrap with the sentence; these do, as the line they replaced. */}
          <span
            role="button"
            tabIndex={a.id ? 0 : -1}
            aria-disabled={!a.id || undefined}
            data-task-open
            onMouseDown={(e) => e.preventDefault()}
            onClick={press}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' && e.key !== ' ') return
              e.preventDefault()
              /* A link with the focus is followed by its own key. */
              const link = (e.target as HTMLElement).closest?.('a[data-chip-link]') as HTMLAnchorElement | null
              if (link) follow(link.href, e)
              else open()
            }}
            title={title}
            className="task-chip-open"
          >
            {/* The handle and the title's first word kept on one line: a
                non-breaking space, so "" never ends a line alone. */}
            <span className="task-chip-handle">{a.making ? W.makingTask : handle}</span>
            {'\u00a0'}
            <span className="task-chip-title" data-comment={threads || undefined}>
              {words}
            </span>
            {who && (
              <span className="task-chip-face">
                <Avatar id={who.id} name={who.name} url={who.avatar_url ?? null} size={16} />
              </span>
            )}
          </span>
        </>
      )}
    </NodeViewWrapper>
  )
}
