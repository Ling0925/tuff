import { HEADS, SAYS } from '../data/words.js'
import { Dot, GroupLabel, Hairline, Panel, ProjectChip } from './kit.jsx'
import { Icon } from './glyphs.jsx'
import { short } from './MyTasks.jsx'
import type { Theirs } from './Stats.jsx'

/**
 * What is open on somebody — a person's page and an agent's, in Members.
 * One list for both:
 * it is the same question asked about either.
 */
export function TheirWork({ open, onOpen }: { open: Theirs[]; onOpen: (projectId: string, taskId: string) => void }) {
  return (
    <div className="mt-5">
      <GroupLabel>{HEADS.onThem}</GroupLabel>
      {open.length === 0 ? (
        /* Under the label's own inset, not twelve pixels left of it. */
        <p className="mt-2 px-3 text-sm text-ink-3">{SAYS.nothingOpenHere}</p>
      ) : (
        <div className="mt-2">
          <Panel>
            {open.map((t, i) => (
              <div key={t.id} className="contents">
                {i > 0 && <Hairline inset={14} />}
                {/* The same row the other lists of tasks draw, because it
                    is the same list of tasks asked about somebody else. */}
                <div
                  data-their-task
                  data-row
                  onClick={(e) => {
                    if ((e.target as Element).closest('button,a,input,select')) return
                    onOpen(t.project_id, t.id)
                  }}
                  /* The row a project's list draws, to the pixel — it
                     is the same list of tasks, asked about somebody
                     else. */
                  className="flex items-center gap-3 py-3 pr-4"
                  style={{ paddingLeft: 16 }}
                >
                  <span className="flex size-5 shrink-0 items-center justify-center">
                    <Dot icon={t.icon} color={t.color} />
                  </span>
                  {/* The title is the button, the way it is on My tasks.
                      The whole row answers a press, but a row that is
                      only a `div` with a handler is a row a keyboard
                      cannot reach at all — and this screen is somebody's
                      work, which is the last list anybody should have to
                      use a mouse to open. */}
                  <button
                    data-open-theirs
                    onClick={() => onOpen(t.project_id, t.id)}
                    className="min-w-px flex-1 truncate text-left text-base text-ink"
                  >
                    {t.title}
                  </button>
                  <span data-id className="w-[74px] shrink-0 font-mono text-sm max-sm:hidden text-ink-3">
                    {t.project_key}-{t.number}
                  </span>
                  <span className="flex h-5 w-[86px] shrink-0 items-center justify-end max-sm:w-auto">
                    {t.due_on && (
                      <span
                        data-late={t.overdue || undefined}
                        className="flex items-center gap-1 text-base tabular-nums"
                        /* Late and still open is the only thing here that
                           is wrong rather than merely true, and the
                           server decides which — one definition of late,
                           written once. */
                        style={{ color: t.overdue ? 'var(--due)' : 'var(--ink-3)' }}
                      >
                        <Icon name="cal" size={14} />
                        {short(t.due_on)}
                      </span>
                    )}
                  </span>
                  <span className="flex w-[150px] shrink-0 items-center overflow-hidden max-sm:hidden">
                    <ProjectChip id={t.project_id} name={t.project_name} />
                  </span>
                </div>
              </div>
            ))}
          </Panel>
        </div>
      )}
    </div>
  )
}
