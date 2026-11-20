import type { IconName } from '../ui/glyphs.js'
import { TOOLS } from '../words/tools.js'

/**
 * The four tools a project can have.
 *
 * Here rather than beside the tabs that draw them, because the dialog that
 * makes a project has to offer the same four under the same names. Two lists
 * of the tools is how a project gets made with a tool the tabs cannot show.
 */
/*
 * The two that are not tools are in here as well.
 *
 * Tools are what a project contains. Settings is about the container, and
 * activity is what the container leaves behind — a project does not hold
 * its history the way it holds tasks. Neither is in `project.tools`.
 *
 * The words come from `words/tools.ts`, the one place a tool is named, in
 * English and French; the order below and the glyphs are not words and
 * stay here.
 */
export const LABEL: Record<string, string> = TOOLS

/**
 * The order the tabs are read in, which is not the order they are stored in.
 *
 * `tools` says which of them this project has; what comes first is a product
 * decision and belongs here. The work, then the talking about it, then what
 * it produced, then the handful of things somebody chose to announce.
 *
 * Announcements moved from second to last of the four. The old order put it
 * straight after the work on the grounds that what was said about a project
 * comes before the chat about it — true of their weight and wrong about
 * their use. A project has a few announcements and a room that is opened
 * every hour, and tab order answers how often something is reached for.
 */
export const ORDER = ['tasks', 'messages', 'files', 'posts'] as const

/**
 * The tabs a project shows, in the order they are read.
 *
 * One function rather than the same array written at each place that draws
 * them — the wide row and the narrow strip had a copy each, which is two
 * chances for a tab to be in one of them and not the other.
 *
 * Activity sits after the four tools and before Settings — the two that are
 * not tools, together at the end.
 *
 * It was second, straight after Tasks, on the argument that what happened is
 * looked at beside the work many times a day. That is true of the week a
 * project is being set up and not of the months after it: the feed is where
 * somebody goes to find out what they missed, which is a thing that happens
 * on a Monday rather than hourly, and it was sitting in front of the room
 * the team actually talks in.
 *
 * So the order is the four tools in the order they are reached for, and
 * then the two that are about the container rather than in it.
 */
export function tabs(tools: string[], canReadActivity: boolean, canSettings = true): string[] {
  return [
    ...ORDER.filter((t) => tools.includes(t)),
    ...(canReadActivity ? ['activity'] : []),
    /* Only to whoever holds Settings: a page of switches somebody may not
       touch is a page of greyed-out refusals. */
    ...(canSettings ? ['settings'] : []),
  ]
}

/** A tool's glyph, so the tabs say what they are before they are read. */
export const TOOL_ICON: Record<string, IconName> = {
  tasks: 'tasks',
  posts: 'megaphone',
  messages: 'bubble',
  files: 'doc',
  activity: 'history',
  settings: 'gear',
}
