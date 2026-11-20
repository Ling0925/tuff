import { useState } from 'react'
import { MORE, MAKE, FACTS, ACTS } from '../../data/words.js'
import { TASK_DETAIL as W } from '../../words/taskDetail.js'
import {
  type Placed,
  type Label,
  type Priority,
  Status,
  PriorityPick,
  PRIORITY_SAID,
  WhoPick,
  namesOf,
  LabelPick,
  Button,
  notALogin,
} from '../kit.jsx'
import { Icon } from '../glyphs.jsx'
import { asDoc } from '../../data/doc.js'
import { type Person } from './model.js'

/** A fact about the task: its name on the left, the value it holds on the right. */
/**
 * Making a sub-task, with what a task is made of.
 *
 * Shut, it is one quiet line and nothing else: on a task that has no parts the
 * old form stood there as an empty panel with a heading above it, which is
 * furniture for something most tasks never have.
 *
 * Open, it asks what the thing being made is — a title, a description, and the
 * four answers a task carries. A form that can only take a title is a form
 * that makes you open what you just made in order to finish making it.
 */
export function NewSubtask({
  lists,
  people,
  allLabels,
  onMakeLabel,
  onMake,
  open: opened,
  onOpen: onOpened,
  bare = false,
}: {
  lists: Placed[]
  people: Person[]
  allLabels: Label[]
  onMakeLabel: (name: string, color?: string | null) => Promise<Label | null>
  onMake: (made: {
    title: string
    body?: unknown
    list_id?: string | null
    assignee_ids?: string[]
    priority?: Priority | null
    labels?: string[]
  }) => Promise<void>
  /** Opened from outside — the plus beside the heading — when there is one. */
  open?: boolean | undefined
  onOpen?: (open: boolean) => void
  /** No button of its own while shut: something else opens it. */
  bare?: boolean
}) {
  const [own, setOwn] = useState(false)
  const open = opened ?? own
  const setOpen = (to: boolean) => {
    setOwn(to)
    onOpened?.(to)
  }
  const [title, setTitle] = useState('')
  const [said, setSaid] = useState('')
  const [list, setList] = useState<string | null>(null)
  const [who, setWho] = useState<string[]>([])
  const [priority, setPriority] = useState<Priority | null>(null)
  const [labels, setLabels] = useState<Label[]>([])
  const [busy, setBusy] = useState(false)

  const shut = () => {
    setOpen(false)
    setTitle('')
    setSaid('')
    setList(null)
    setWho([])
    setPriority(null)
    setLabels([])
  }

  async function make() {
    const name = title.trim()
    if (!name || busy) return
    setBusy(true)
    try {
      await onMake({
        title: name,
        ...(said.trim() ? { body: asDoc(said.trim()) } : {}),
        list_id: list,
        assignee_ids: who,
        priority,
        labels: labels.map((l) => l.id),
      })
      shut()
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    if (bare) return null
    return (
      <button
        data-testid="add-subtask"
        onClick={() => setOpen(true)}
        /* On a ground, as the other things here a person presses are: bare
           grey words under an empty description read as a caption. */
        className="flex h-8 items-center gap-2 self-start rounded-[var(--r-row)] bg-[var(--track)] pr-3 pl-2 text-base transition-colors mouse:hover:bg-[var(--badge)] text-ink-2"
      >
        <Icon name="plusThin" size={16} />
        {MORE.addSubTask}
      </button>
    )
  }

  return (
    <div
      data-testid="subtask-form"
      className="flex flex-col gap-2 p-3 bg-surface"
      style={{
        borderRadius: 'var(--r-card)',
        border: '1px solid var(--line)',
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') shut()
      }}
    >
      <input
        {...notALogin}
        autoFocus
        data-testid="new-step"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          /* Enter makes it, because the fast way to add three in a row is to
             type and press Enter — the one thing the old line was good at. */
          if (e.key === 'Enter') void make()
        }}
        placeholder={MAKE.subTaskTitle}
        className="bg-transparent text-base font-medium outline-none text-ink"
      />
      <input
        {...notALogin}
        data-testid="new-step-said"
        value={said}
        onChange={(e) => setSaid(e.target.value)}
        placeholder={FACTS.addADescription}
        className="bg-transparent text-base outline-none text-ink-2"
      />
      <div className="flex flex-wrap items-center gap-2 pt-1">
        {/* The same controls the task itself carries: one control per
            question, wherever the question is asked. */}
        <span className="flex h-7 items-center gap-2 pr-3 pl-2 text-base bg-track text-ink" style={{ borderRadius: 'var(--r-row)' }}>
          <Status lists={lists} value={list} said={W.theNewSubTask} onPick={setList} />
          {lists.find((l) => l.id === list)?.name ?? ACTS.list}
        </span>
        <span className="flex h-7 items-center gap-2 pr-3 pl-2 text-base bg-track text-ink" style={{ borderRadius: 'var(--r-row)' }}>
          <PriorityPick value={priority} said={W.theNewSubTask} onPick={setPriority} />
          {priority ? PRIORITY_SAID[priority] : FACTS.priority}
        </span>
        <span className="flex h-7 items-center gap-2 pr-3 pl-2 text-base bg-track text-ink" style={{ borderRadius: 'var(--r-row)' }}>
          <WhoPick people={people} value={who} said={W.theNewSubTask} size={20} onPick={setWho} />
          {namesOf(people, who) || FACTS.assignee}
        </span>
        <span className="flex h-7 items-center gap-2 px-3 text-base bg-track" style={{ borderRadius: 'var(--r-row)' }}>
          <LabelPick all={allLabels} value={labels} said={W.theNewSubTask} onMake={onMakeLabel} onPick={setLabels} />
        </span>
        <span className="ml-auto flex items-center gap-2">
          <button data-testid="cancel-subtask" onClick={shut} className="text-base text-ink-3">
            {MORE.cancel}
          </button>
          <Button onClick={() => void make()} disabled={!title.trim() || busy}>
            {MORE.create}
          </Button>
        </span>
      </div>
    </div>
  )
}
