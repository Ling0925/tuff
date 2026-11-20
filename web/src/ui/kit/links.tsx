import { useContext, useState, useEffect } from 'react'
import { HEADS } from '../../data/words.js'
import { api } from '../../data/api.js'
import { recall, remember } from '../../data/memory.js'
import { SectionHead, Panel, Hairline } from './page.jsx'
import { PersonDoorsContext } from '../PersonCard.jsx'
import { LINKS } from '../../words/links.js'

/* ----------------------------------------------------------------- links */

/**
 * What points at this object.
 *
 * Written when somebody types a mention, so the answer to "why is this here"
 * sits on the thing rather than in a search. `GET /api/links/:type/:id`
 * answers for all four entities and only the task screen ever asked — a
 * document or an announcement somebody pointed at had no idea it had been
 * pointed at.
 *
 * Its own component because three screens asking the same question three
 * ways is three chances for one of them to drift.
 *
 * It remembers its last answer, like everything else that is unmounted when
 * you leave a screen. This section is absent while empty, so a task with
 * mentions grew one the moment its read landed and pushed the column down
 * under the hand — the one thing a late arrival can do that an empty one
 * cannot.
 */
type Pointed = { type: string; id: string; title?: string; project_id?: string | null }

/*
 * Read beside the screen's own read, not after it: the section is inside a
 * screen that draws nothing until its object arrives, so asked from here it
 * set off a round trip after the screen and grew in a round trip later.
 * The screen asks this with its own read, and the section opens on the
 * answer.
 */
const reading = new Map<string, Promise<Pointed[]>>()
export function readLinks(type: 'task' | 'post' | 'file', id: string): Promise<Pointed[]> {
  const key = `links:${type}:${id}`
  let r = reading.get(key)
  if (r) return r
  r = api<{ links: Pointed[] }>(`/links/${type}/${id}`)
    .then((a) => remember(key, a.links ?? []))
    .finally(() => reading.delete(key))
  reading.set(key, r)
  return r
}

export function MentionedIn({ type, id }: { type: 'task' | 'post' | 'file'; id: string }) {
  const key = `links:${type}:${id}`
  /* Read from the memory on every draw: the screen around it asks with its
     own read and draws again when that lands, so this is always its last
     answer. Asked from here only when nothing has asked yet. */
  const [, setAsked] = useState(0)
  useEffect(() => {
    if (recall(`links:${type}:${id}`) !== null) return
    let alive = true
    void readLinks(type, id)
      .then(() => alive && setAsked((n) => n + 1))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [type, id])
  const links = recall<Pointed[]>(key) ?? []
  const doors = useContext(PersonDoorsContext)
  /* Each row opens what it names. A message has no door from here: the
     answer carries its project, not its room. */
  const doorOf = (l: Pointed): (() => void) | null => {
    const project = l.project_id
    if (!project || !doors) return null
    if (l.type === 'task') return () => doors.openTask(project, l.id)
    if (l.type === 'file' && doors.openFile) return () => doors.openFile!(project, l.id)
    if (l.type === 'post' && doors.openPost) return () => doors.openPost!(project, l.id)
    return null
  }
  const kind = (t: string) => (t in LINKS ? LINKS[t as keyof typeof LINKS] : t)

  if (links.length === 0) return null
  return (
    <section className="flex shrink-0 flex-col gap-3">
      <SectionHead>{HEADS.mentionedIn}</SectionHead>
      <Panel>
        {links.map((l, i) => (
          <div key={`${l.type}:${l.id}`} className="contents">
            {i > 0 && <Hairline inset={14} />}
            {(() => {
              const open = doorOf(l)
              const inside = (
                <>
                  {/* The title first, the kind after it at its own width: a
                     column wide enough for "Announcement" put every task's
                     title a third of the way across. */}
                  <span className="min-w-0 flex-1 truncate text-base text-ink">{l.title}</span>
                  <span className="shrink-0 text-sm text-ink-3">{kind(l.type)}</span>
                </>
              )
              return open ? (
                <button
                  type="button"
                  data-link
                  onClick={open}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--hover)]"
                >
                  {inside}
                </button>
              ) : (
                <div data-link className="flex items-center gap-3 px-4 py-3">
                  {inside}
                </div>
              )
            })()}
          </div>
        ))}
      </Panel>
    </section>
  )
}
