import { Icon } from '../glyphs.jsx'

/* Members' groups folded in this browser. */
export const SHUT_GROUPS = 'tracker:members-shut'
export function readShutGroups(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(SHUT_GROUPS) ?? '[]') as unknown
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

/**
 * The head of one of Members' two groups, and the switch that folds it.
 *
 * The whole row is the switch, as a band's strip is on the tasks list: an
 * arrow alone is too small to aim at. The size of the rows under it and
 * told apart by colour, as the sidebar's headings are; how many beside the
 * word, so a folded group still says what it holds.
 */
export function MembersGroup({
  group,
  said,
  count,
  shut,
  onFold,
}: {
  group: 'people' | 'agents'
  said: string
  count: number
  shut: boolean
  onFold: () => void
}) {
  return (
    <button
      type="button"
      data-members-group={group}
      data-testid={`members-group-${group}`}
      aria-expanded={!shut}
      onClick={onFold}
      className={`flex w-full shrink-0 items-center gap-2 rounded-[var(--r-row)] px-2 text-left text-base text-[var(--ink-3)] transition-colors mouse:hover:bg-[var(--hover)] mouse:hover:text-[var(--ink-2)] ${group === 'agents' ? 'mt-3' : ''}`}
      style={{ height: 'var(--nav-h)', letterSpacing: 'var(--track-body)' }}
    >
      {/* In the avatars' column, so the word starts where the names do. */}
      <span className="flex size-5 shrink-0 items-center justify-center">
        <Icon
          name="chevR"
          size={14}
          className="transition-transform duration-150 motion-reduce:transition-none"
          style={{ transform: shut ? undefined : 'rotate(90deg)', transitionTimingFunction: 'var(--ease-out)' }}
        />
      </span>
      <span className="ml-1 truncate">{said}</span>
      <span data-members-count className="tabular-nums">
        {count}
      </span>
    </button>
  )
}
