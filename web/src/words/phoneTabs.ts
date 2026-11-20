import { say } from '../data/words.js'

/** A phone's tabs, its More screen — `ui/PhoneTabs.tsx`. */
export const PHONE_TABS = say({
  places: ['Places', 'Navigation'],
  tasks: ['Tasks', 'Tâches'],
  /* The place, every room — not a project's tab, which is "Discussion". */
  chat: ['Chat', 'Discussions'],
  more: ['More', 'Plus'],
  search: ['Search', 'Rechercher'],
  workspaceSettings: ['Workspace settings', 'Paramètres de l’espace de travail'],
  accountSettings: ['Account settings', 'Paramètres du compte'],
})
