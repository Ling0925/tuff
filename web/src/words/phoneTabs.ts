import { say } from '../data/words.js'

/** A phone's tabs, its More screen — `ui/PhoneTabs.tsx`. */
export const PHONE_TABS = say({
  places: ['Places', 'Navigation', '导航'],
  tasks: ['Tasks', 'Tâches', '任务'],
  /* The place, every room — not a project's tab, which is "Discussion". */
  chat: ['Chat', 'Discussions', '聊天'],
  more: ['More', 'Plus', '更多'],
  search: ['Search', 'Rechercher', '搜索'],
  workspaceSettings: ['Workspace settings', 'Paramètres de l’espace de travail', '工作区设置'],
  accountSettings: ['Account settings', 'Paramètres du compte', '账户设置'],
})
