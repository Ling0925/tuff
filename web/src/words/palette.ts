import { say } from '../data/words.js'

/** The palette, over the work and as a phone's Search page — `ui/Palette.tsx`. */
export const PALETTE = say({
  workspaceSettings: ['Workspace settings', 'Paramètres de l’espace de travail'],
  accountSettings: ['Account settings', 'Paramètres du compte'],
  /* What sort of thing a recent row is. */
  project: ['Project', 'Projet'],
  person: ['Person', 'Personne'],
  room: ['Chat', 'Discussion'],
  screen: ['Screen', 'Écran'],
  task: ['Task', 'Tâche'],
  post: ['Announcement', 'Annonce'],
  doc: ['Doc', 'Document'],
  query: ['Search', 'Recherche'],
  /* The groups the rows are listed under. */
  recent: ['Recent', 'Récents'],
  owner: ['Owner', 'Propriétaire'],
  /* The place, every room — not a project's tab, which is "Discussion". */
  chat: ['Chat', 'Discussions'],
  goTo: ['Go to', 'Aller à'],
  results: ['Results', 'Résultats'],
  create: ['Create', 'Créer'],
  thisTask: ['This task', 'Cette tâche'],
  newTask: [(t: string) => `New task “${t}”`, (t: string) => `Nouvelle tâche « ${t} »`],
  /* `blocked by RED-12` typed with a task open. */
  blockedBy: [(handle: string) => `Blocked by ${handle}`, (handle: string) => `Bloquée par ${handle}`],
  typeToSearch: ['Type to search.', 'Saisissez votre recherche.'],
  noResults: ['No results.', 'Aucun résultat.'],
  /* The keys at the foot, in the lower case the English has. */
  esc: ['esc', 'échap'],
  close: ['close', 'fermer'],
  move: ['move', 'naviguer'],
  open: ['open', 'ouvrir'],
  /** Narrowing what was said. Slack's words. */
  fromAnyone: ['From anyone', 'De n’importe qui'],
  from: ['From', 'De'],
  hasLink: ['Has a link', 'Contient un lien'],
  hasFile: ['Has a file', 'Contient un fichier'],
  inThreads: ['In threads', 'Dans les fils de discussion'],
  newestFirst: ['Newest first', 'Plus récents d’abord'],
  oldestFirst: ['Oldest first', 'Plus anciens d’abord'],
  sortBy: ['Sort', 'Trier'],
})
