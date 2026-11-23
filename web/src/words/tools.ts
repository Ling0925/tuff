import type { Tool } from '@tracker/shared-schema'
import { say } from '../data/words.js'

/**
 * What the four tools are called, and the two tabs that are not tools.
 *
 * The one place a tool is named. The database stores `tool_kind` —
 * `posts, tasks, files, messages` — and nobody reads those words: the tabs,
 * the switches in the project's settings, the dialog that makes a project,
 * the phone's tab menu, the activity filter, the palette and the window's
 * title all read them from here, through `LABEL` in `data/tools.ts`. Two
 * lists is how a tool gets renamed on its tab and keeps its old name on the
 * switch that turns it off.
 *
 * Keyed by the schema's own `Tool`, so a fifth kind there is a build that
 * fails here rather than a raw word on a screen.
 */
export const TOOLS: Record<Tool | 'activity' | 'settings', string> = say({
  tasks: ['Tasks', 'Tâches', '任务'],
  posts: ['Announcements', 'Annonces', '公告'],
  messages: ['Chat', 'Discussion', '聊天'],
  /* Files, not Docs: it holds uploads and links beside the documents —
     `docs/specs/docs.md`. The address is still `/files`. */
  files: ['Files', 'Fichiers', '文件'],
  activity: ['Activity', 'Activité', '动态'],
  settings: ['Settings', 'Paramètres', '设置'],
})
