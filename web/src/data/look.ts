/**
 * How a project was last looked at, on this machine.
 *
 * The address is where the answer lives — and it is
 * silent when somebody arrives at a project without one: from the sidebar,
 * from the palette, from anywhere that names the project and not the way of
 * reading it. Silent used to mean the list, always, so choosing the board and
 * going anywhere at all threw the choice away. One project is a board and
 * another is a list, and which is which is not something a team has an
 * answer to.
 *
 * So this fills the silence and nothing more. An address that says something
 * wins, and is then remembered; an address that says nothing is corrected to
 * what was remembered, with `replace`, so the screen and the bar never
 * disagree about which of them is right — two places that both believe they
 * know the open screen disagree the first time somebody presses back.
 *
 * Per project, because the answer is about the project. In `localStorage`
 * beside the panel and the row's columns, for the reason those are there:
 * it is a preference, and a link somebody sends should not carry it.
 */
const KEY = 'tasks-look'

/** The answers that say what is on the screen — the ones the address carries. */
export type Look = {
  mode?: string
  list?: string
  group?: string
  sort?: string
  dir?: string
  who?: string
  done?: string
}

const all = (): Record<string, Look> => {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as unknown
    return raw && typeof raw === 'object' ? (raw as Record<string, Look>) : {}
  } catch {
    return {}
  }
}

export function lastLook(projectId: string): Look | null {
  return all()[projectId] ?? null
}

/**
 * Kept only when there is something to keep.
 *
 * An empty answer is the default, and writing the default back means a
 * project somebody once opened as a board and then set back to a list is
 * remembered as neither — which reads as the memory having failed.
 */
export function rememberLook(projectId: string, look: Look): void {
  const kept = Object.fromEntries(Object.entries(look).filter(([, v]) => v)) as Look
  try {
    const was = all()
    if (Object.keys(kept).length === 0) delete was[projectId]
    else was[projectId] = kept
    localStorage.setItem(KEY, JSON.stringify(was))
  } catch {
    // Nothing to do and nothing to say: the screen is still right.
  }
}
