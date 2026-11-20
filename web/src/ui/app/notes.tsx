import { useEffect, useRef, useState } from 'react'
import { HEADS, MORE, ACTS, SAYS, LOCALE } from '../../data/words.js'
import { APP as W } from '../../words/app.js'
import { dropQuestions, useQuestions, type Question } from '../../data/needsYou.js'
import { useShown, SLIDING, EmptyState, Panel, Hairline, Avatar, Segments } from '../kit.jsx'
import { Icon, type IconName } from '../glyphs.jsx'
import { Choices } from '../Choices.jsx'

export type Note = {
  id: string
  reason:
    | 'mentioned'
    | 'assigned'
    | 'subscribed'
    | 'joined'
    | 'posted'
    | 'replied'
    | 'due'
    | 'added'
    | 'shared'
    | 'reminder'
    | 'unblocked'
    | 'asked'
  object_type: string
  /** What happened, in the product's words — `docs/specs/notifications.md`. */
  what?: string | null
  object_id: string
  /** Which project it happened in — the inbox has always sent this. */
  project_id: string | null
  title: string | null
  read_at: string | null
  created_at: string
  /* What it is about, said without opening it — `docs/specs/inbox.md`. */
  project_name?: string | null
  project_key?: string | null
  project_slug?: string | null
  task_number?: number | null
  room_name?: string | null
  room_channel?: boolean | null
  room_others?: string | null
  said_by?: string | null
  said?: string | null
  /* Who did it and what kind of thing — `docs/specs/inbox.md`, "Who, and
     what kind". */
  kind?: string | null
  by_id?: string | null
  by_name?: string | null
  by_avatar_url?: string | null
  excerpt?: string | null
}

/**
 * What is addressed to you, over the screen rather than instead of it.
 *
 * This was a page. A page is the wrong size for it: an inbox is glanced at
 * and dismissed — nine times out of ten to open one of the things in it and
 * get back to work — and a page makes that a departure and a return, with the
 * screen somebody was reading erased on the way out and rebuilt on the way
 * back.
 *
 * `/:ws/notifications` is still the address, because a link to your own inbox
 * is a link like any other and the addresses spec lists it. What
 * changed is only what the address draws: the panel opens over whatever was
 * there and closing puts the address back, which is exactly what `?q=` does
 * for search. `App` holds the screen underneath in a ref for both of them.
 *
 * From the right, and it leaves the same way it arrived — spatial
 * consistency: a thing that comes in from one edge and goes out of another
 * is two things as far as the eye is concerned.
 */
export function NotesPanel({
  open,
  notes,
  newHere,
  onClose,
  onReadAll,
  onGo,
}: {
  open: boolean
  notes: Note[] | null
  /** What was new while it has been open — see `newHere` in `App`. */
  newHere: ReadonlySet<string>
  onClose: () => void
  onReadAll: () => void | Promise<void>
  /** Where a note is about, opened — and it read. */
  onGo: (n: Note) => void
}) {
  const { there, shown, ref } = useShown(open, SLIDING)
  /*
   * Two views over one panel: All, as it
   * was, and Needs you, the questions asked of you, each with its buttons.
   * A question answered here keeps its row, saying the answer, until the
   * panel is shut: a list never moves under the pointer.
   */
  const questions = useQuestions()
  const [view, setView] = useState<'all' | 'needs'>('all')
  const answered = useRef(new Set<string>())
  const [, setAnsweredCount] = useState(0)
  useEffect(() => {
    if (open) return
    dropQuestions(answered.current)
    answered.current = new Set()
    setAnsweredCount(0)
  }, [open])
  const waiting = (questions ?? []).filter((q) => !answered.current.has(q.id)).length

  /* Escape shuts it, like every other thing that is over the screen. */
  useEffect(() => {
    if (!open) return
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [open, onClose])

  if (!there) return null

  return (
    <>
      {/* The work goes back, and pressing it is the way out. A modal task:
          one thing to answer, and the thing behind is not where you are. */}
      <div
        data-notes-scrim
        className="fixed inset-0 z-40 transition-opacity bg-scrim"
        style={{
          backdropFilter: 'blur(var(--scrim-blur))',
          WebkitBackdropFilter: 'blur(var(--scrim-blur))',
          opacity: shown ? 1 : 0,
          transitionDuration: `${SLIDING}ms`,
          /*
           * It takes presses only while it is up.
           *
           * The node is held in the document for as long as the panel takes
           * to leave — `useShown` — so without this it went on swallowing
           * every click for a quarter of a second after the panel was shut,
           * invisibly. Three tests caught it as "the sidebar stopped
           * answering", which is what a person would have called it too.
           */
          pointerEvents: shown ? 'auto' : 'none',
        }}
        onPointerDown={onClose}
      />
      <aside
        ref={ref}
        data-notes-panel
        role="dialog"
        aria-label={HEADS.notifications}
        className="fixed inset-y-0 right-0 z-40 flex w-[min(420px,92vw)] flex-col bg-surface"
        style={{
          transform: shown ? 'translateX(0)' : 'translateX(100%)',
          /* The drawer curve, the same one the sidebar uses: the house
             ease-out is nine tenths through in half the time, which over
             this distance is a flick rather than a panel. */
          transition: `transform ${SLIDING}ms var(--ease-drawer)`,
          boxShadow: 'var(--card-shadow)',
        }}
      >
        <div className="flex flex-col gap-4 px-5 pt-6 pb-4">
          {/* Its own heading on every screen: the panel covers the bar a phone
              would otherwise have named it in. */}
          <div className="flex shrink-0 items-center gap-3">
            <h1
              className="min-w-0 flex-1 truncate text-title font-medium max-sm:text-xl text-ink"
              style={{ letterSpacing: 'var(--track-display)' }}
            >
              {HEADS.notifications}
            </h1>
            {
              <span className="flex shrink-0 items-center gap-3">
                <button onClick={() => void onReadAll()} className="shrink-0 text-base font-medium text-accent">
                  {MORE.markAllRead}
                </button>
                {/*
                  The way out, where a panel's way out is.
                  
                  Escape closes it and so does the screen behind it, and
                  both are the quicker gesture once you know them. This is
                  for the hand that is already on the pointer and looking
                  for the thing to press — which on a surface that covers
                  the screen is the one control a person expects to find
                  without hunting.
                  
                  Last, past the one action the panel has: it is about the
                  panel rather than about what is in it, which is the same
                  reason the window's own controls are at the end of the
                  bar rather than among the work.
                */}
                <button
                  data-testid="close-notes"
                  aria-label={ACTS.close}
                  onClick={onClose}
                  className="flex size-6 shrink-0 items-center justify-center text-ink-3"
                  style={{ borderRadius: 'var(--r-field)' }}
                >
                  <Icon name="close" size={16} />
                </button>
              </span>
            }
          </div>
          <Segments
            fill
            value={view}
            onPick={setView}
            items={[
              { key: 'all', label: W.allNotes, testId: 'notes-all' },
              { key: 'needs', label: W.needsYou, testId: 'notes-needs-you', count: waiting || undefined },
            ]}
          />
        </div>
        {/* Split by why it arrived, not by what it was about: the first two
            are addressed to you, the third is you keeping an eye on it. */}
        {/*
          The end is clear of the phone's home indicator: the panel runs to
          the foot of the glass, over the tabs, and nothing else lifts it.
        */}
        <div
          className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5"
          style={{ paddingBottom: 'calc(24px + env(safe-area-inset-bottom, 0px))' }}
          data-reads-down
          data-own-bar
        >
          {view === 'needs' && questions && questions.length === 0 && (
            <EmptyState art="cubbies" title={W.nothingNeedsYou}>
              {W.nothingNeedsYouHint}
            </EmptyState>
          )}
          {view === 'needs' && questions && questions.length > 0 && (
            <Panel className="shrink-0" data-needs-you>
              {questions.map((q, i) => (
                <div key={q.id} className="contents">
                  {i > 0 && <Hairline inset={60} />}
                  <QuestionRow
                    q={q}
                    onAnswered={() => {
                      answered.current.add(q.id)
                      setAnsweredCount(answered.current.size)
                    }}
                    onGo={() => onGo(asNote(q))}
                  />
                </div>
              ))}
            </Panel>
          )}
          {view === 'all' && notes && notes.length === 0 && (
            <EmptyState art="cubbies" title={SAYS.nothingWaiting}>
              {SAYS.whenSomethingNeedsYou}
            </EmptyState>
          )}
          {/*
            Its full height, never the scroller's: a `Panel` clips what is
            in it (`overflow: hidden`, for its corners), and a flex item that
            clips may shrink to nothing — so it shrank to the scroller, cut
            off every row past the first screen, and left the scroller with
            nothing to scroll.: on a phone the list would not move.
          */}
          {view === 'all' && notes && notes.length > 0 && (
            <Panel className="shrink-0">
              {notes.map((n, i) => (
                <div key={n.id} className="contents">
                  {i > 0 && <Hairline inset={60} />}
                  <NoteRow n={n} fresh={!n.read_at || newHere.has(n.id)} onGo={() => onGo(n)} />
                </div>
              ))}
            </Panel>
          )}
        </div>
      </aside>
    </>
  )
}

/* Why a note arrived, said in words where nothing else says it. */
const REASON: Record<Note['reason'], { icon: IconName; said: string }> = {
  mentioned: { icon: 'at', said: W.mentioned },
  assigned: { icon: 'person', said: W.assigned },
  subscribed: { icon: 'bell', said: W.subscribed },
  joined: { icon: 'people', said: W.joinedYou },
  posted: { icon: 'megaphone', said: W.posted },
  replied: { icon: 'reply', said: W.replied },
  due: { icon: 'cal', said: W.due },
  added: { icon: 'folder', said: W.added },
  shared: { icon: 'doc', said: W.shared },
  reminder: { icon: 'bell', said: W.reminder },
  unblocked: { icon: 'wait', said: W.unblocked },
  asked: { icon: 'flag', said: W.asked },
}

/* What somebody did, after their name, for a note with no line of its own. */
const DID: Partial<Record<Note['reason'], string>> = {
  mentioned: W.didMention,
  assigned: W.didAssign,
  posted: W.didPost,
  replied: W.didReply,
  added: W.didAdd,
  shared: W.didShare,
  asked: W.didAsk,
  joined: W.joinedYou,
  subscribed: W.didChange,
}

/*
 * What was done, as a glyph and a colour — `docs/specs/inbox.md`, "Who, and
 * what kind".
 *
 * Addressed to you, the reason is the news: a mention is `@` whatever it was
 * said in. Something you only watch wore a bell, every one of them, and a
 * bell says nothing about what happened — so there the kind decides: a
 * comment is a bubble, a finished task a tick, a move the board. The colours
 * are the system's own tints, one to a family, so a column of them can be
 * scanned for the green ones without reading a word.
 */
const KIND: Record<string, { icon: IconName; tone: string }> = {
  commented: { icon: 'bubble', tone: 'var(--tint-6)' },
  replied: { icon: 'reply', tone: 'var(--tint-6)' },
  finished: { icon: 'check', tone: 'var(--tint-3)' },
  reopened: { icon: 'statusOpen', tone: 'var(--tint-4)' },
  moved: { icon: 'board', tone: 'var(--tint-4)' },
  gave: { icon: 'person', tone: 'var(--tint-7)' },
  took_off: { icon: 'person', tone: 'var(--tint-7)' },
  dated: { icon: 'cal', tone: 'var(--tint-1)' },
  undated: { icon: 'cal', tone: 'var(--tint-1)' },
  wrote: { icon: 'doc', tone: 'var(--tint-9)' },
  posted: { icon: 'megaphone', tone: 'var(--tint-8)' },
  /* An agent's question, in the accent: it waits on you. */
  asked: { icon: 'flag', tone: 'var(--accent)' },
  answered: { icon: 'check', tone: 'var(--tint-3)' },
  handoff: { icon: 'flag', tone: 'var(--accent)' },
  handoff_cap: { icon: 'flag', tone: 'var(--accent)' },
}
const BY_REASON: Record<Note['reason'], { icon: IconName; tone: string }> = {
  mentioned: { icon: 'at', tone: 'var(--tint-5)' },
  assigned: { icon: 'person', tone: 'var(--tint-7)' },
  replied: { icon: 'reply', tone: 'var(--tint-6)' },
  posted: { icon: 'megaphone', tone: 'var(--tint-8)' },
  due: { icon: 'cal', tone: 'var(--tint-1)' },
  added: { icon: 'folder', tone: 'var(--tint-9)' },
  shared: { icon: 'doc', tone: 'var(--tint-9)' },
  joined: { icon: 'people', tone: 'var(--tint-9)' },
  subscribed: { icon: 'bell', tone: 'var(--tint-9)' },
  /* A moment you chose, in the accent: it is the one note you asked for. */
  reminder: { icon: 'bell', tone: 'var(--accent)' },
  /* What it waited on is done: green, the colour of finished. */
  unblocked: { icon: 'wait', tone: 'var(--tint-3)' },
  asked: { icon: 'flag', tone: 'var(--accent)' },
}
function glyphOf(n: Note): { icon: IconName; tone: string } {
  if (n.reason === 'due') return n.kind === 'overdue' ? { icon: 'clock', tone: 'var(--due)' } : BY_REASON.due
  if (n.reason === 'subscribed' && n.kind && KIND[n.kind]) return KIND[n.kind]!
  return BY_REASON[n.reason] ?? BY_REASON.subscribed
}

/**
 * The ground of a note that is new to this look at the panel: the accent,
 * a breath of it over the panel. Solid, not laid over, so the ring that cuts
 * the badge out of the face can be the same colour as the row it is on.
 */
const NEW_GROUND = 'color-mix(in srgb, var(--accent) 8%, var(--panel))'

/** What a note is about, in words: the task's handle and title, the room. */
function noteSubject(n: Note): string {
  if (n.object_type === 'task' && n.project_key && n.task_number) return `${n.project_key}-${n.task_number} ${n.title ?? ''}`.trim()
  if (n.object_type === 'conversation') {
    if (n.room_channel) {
      const own = (n.room_name ?? 'main').toLowerCase().replace(/\s+/g, '-')
      return `# ${n.project_slug ? `${n.project_slug}-${own}` : own}`
    }
    return n.room_others ?? W.aConversation
  }
  return n.title ?? n.object_type
}

/**
 * One thing addressed to you — `docs/specs/inbox.md`.
 *
 * Read the way Linear and GitHub draw theirs: the face of who did it, with
 * what kind of thing it was as a badge on it; then who and what they did,
 * with the time at the end of that line; what it was done to; what they
 * said, when they said something; and where. The row is the door: it opens
 * the thing and marks it read.
 *
 * New is a tint over the whole row and a dot by the time. It stays while
 * the panel is open — `newHere` in `App` — and the panel opened again has
 * none: what was new is still worth seeing as new while you look at it.
 */
function NoteRow({ n, fresh, onGo }: { n: Note; fresh: boolean; onGo: () => void }) {
  const why = REASON[n.reason] ?? REASON.subscribed
  const glyph = glyphOf(n)
  const where = n.object_type === 'conversation' ? null : n.project_name
  /* Who, from the note — or, for a mention written before notes knew,
     from the message that named you. */
  const who = n.by_name ?? (n.said ? n.said_by : null) ?? null
  const said = n.excerpt ?? n.said ?? null
  /* The line already starts with the name, in the reader's language —
     "Emily Brooks moved it to Done" — so the name is set in weight and
     the rest follows it; a line that does not ("Due tomorrow") is said
     as it is. */
  const line = n.what ?? (who ? (DID[n.reason] ?? why.said) : why.said)
  const named = who && (n.what ? n.what.startsWith(who) : true)
  const rest = named && n.what ? n.what.slice(who!.length) : named ? ` ${line}` : line
  const ground = fresh ? NEW_GROUND : 'var(--panel)'
  return (
    <button
      data-note
      data-row
      data-unread={fresh || undefined}
      data-kind={n.kind ?? n.reason}
      onClick={onGo}
      className="flex w-full items-start gap-3 px-4 py-3 text-left"
      style={fresh ? { background: NEW_GROUND } : undefined}
    >
      <span className="relative mt-1 flex size-8 shrink-0">
        {who ? (
          <Avatar name={who} {...(n.by_id ? { id: n.by_id } : {})} url={n.by_avatar_url} size={32} on={ground} />
        ) : (
          /* Nobody did it — a date arriving — so the disc is the glyph. */
          <span className="flex size-8 items-center justify-center rounded-full bg-hover" style={{ color: glyph.tone }}>
            <Icon name={glyph.icon} size={16} />
          </span>
        )}
        {who && (
          <span
            data-note-glyph
            aria-hidden
            className="absolute -right-1 -bottom-1 flex size-4 items-center justify-center rounded-full"
            style={{ background: glyph.tone, color: '#ffffff', boxShadow: `0 0 0 2px ${ground}` }}
          >
            <Icon name={glyph.icon} size={12} />
          </span>
        )}
      </span>
      <span className="flex min-w-px flex-1 flex-col gap-1">
        <span className="flex items-start gap-2">
          <span data-note-what className="min-w-px flex-1 text-base leading-[1.4] break-words text-ink-2">
            {named && (
              <span data-note-by className="font-semibold text-ink">
                {who}
              </span>
            )}
            {rest}
          </span>
          <span className="flex h-5 shrink-0 items-center gap-2 text-xs tabular-nums text-ink-3">
            {ago(n.created_at)}
            {fresh && <span aria-hidden className="size-2 rounded-full bg-accent" />}
          </span>
        </span>
        <span className="text-base leading-[1.4] break-words text-ink" style={{ fontWeight: fresh ? 500 : 400 }}>
          {noteSubject(n)}
        </span>
        {said && (
          <span data-note-said className="line-clamp-2 text-sm leading-[1.4] break-words text-ink-2">
            {said.length > 240 ? `${said.slice(0, 240)}…` : said}
          </span>
        )}
        {where && <span className="text-xs text-ink-3">{where}</span>}
      </span>
    </button>
  )
}

/** "now", "5m", "3h", "2d", or the date — said the way a list of notes is scanned. */
function ago(at: string): string {
  const s = (Date.now() - Date.parse(at)) / 1000
  if (s < 60) return W.justNow
  if (s < 3600) return W.minutesAgo(Math.floor(s / 60))
  if (s < 86400) return W.hoursAgo(Math.floor(s / 3600))
  if (s < 7 * 86400) return W.daysAgo(Math.floor(s / 86400))
  return new Date(at).toLocaleDateString(LOCALE, { day: 'numeric', month: 'short' })
}

/** A question as the note the panel already knows how to open. */
function asNote(q: Question): Note {
  return {
    id: q.id,
    reason: 'asked',
    object_type: 'task',
    object_id: q.task_id,
    project_id: q.project_id,
    title: q.title,
    read_at: q.created_at,
    created_at: q.created_at,
    project_name: q.project_name,
    project_key: q.project_key ?? null,
    project_slug: q.project_slug,
    task_number: q.task_number,
  }
}

/**
 * One question waiting on you: who asks,
 * on which task, what, and the buttons to answer it there. The question
 * and the task open the task; the buttons answer without leaving.
 */
function QuestionRow({ q, onAnswered, onGo }: { q: Question; onAnswered: () => void; onGo: () => void }) {
  return (
    <div data-question-row={q.id} className="flex w-full items-start gap-3 px-4 py-3">
      <span className="relative mt-1 flex size-8 shrink-0">
        <Avatar name={q.by_name} id={q.by_id} url={q.by_avatar_url ?? null} size={32} on="var(--panel)" />
        <span
          aria-hidden
          className="absolute -right-1 -bottom-1 flex size-4 items-center justify-center rounded-full"
          style={{ background: 'var(--accent)', color: '#ffffff', boxShadow: '0 0 0 2px var(--panel)' }}
        >
          <Icon name="flag" size={12} />
        </span>
      </span>
      <span className="flex min-w-px flex-1 flex-col gap-2">
        <button type="button" data-row onClick={onGo} className="flex flex-col gap-1 text-left">
          <span className="flex items-start gap-2">
            <span className="min-w-px flex-1 text-base leading-[1.4] break-words text-ink-2">
              <span className="font-semibold text-ink">{W.askedBy(q.by_name)}</span>
            </span>
            <span className="flex h-5 shrink-0 items-center text-xs tabular-nums text-ink-3">{ago(q.created_at)}</span>
          </span>
          {q.excerpt && <span className="text-base leading-[1.4] break-words text-ink">{q.excerpt}</span>}
          <span className="text-xs text-ink-3">
            {q.project_key ? `${q.project_key}-${q.task_number} ` : ''}
            {q.title} · {q.project_name}
          </span>
        </button>
        <Choices id={q.id} choices={q.choices} answer={null} answeredBy={null} canAnswer onAnswered={onAnswered} />
      </span>
    </div>
  )
}
