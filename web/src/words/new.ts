import { one, say } from '../data/words.js'

/** The windows a task, a project and an announcement are made in — `ui/New.tsx`. */
export const NEW = say({
  projectName: ['Project name', 'Nom du projet'],
  waitingForUpload: ['Waiting for the upload to finish…', 'En attente de la fin de l’import…'],
  toCreate: ['⌘↵ to create', '⌘↵ pour créer'],
  /** What the pickers call the task: "Assignee of the new task". */
  theNewTask: ['the new task', 'la nouvelle tâche'],
  taskTitle: ['Task title', 'Titre de la tâche'],
  noList: ['No list', 'Sans liste'],
  noOne: ['No one', 'Personne'],
  labels: [(n: number) => (n === 1 ? `${n} label` : `${n} labels`), (n: number) => (one(n) ? `${n} étiquette` : `${n} étiquettes`)],
  dueOfNewTask: ['Due date of the new task', 'Échéance de la nouvelle tâche'],
  postTitle: ['Announcement title', 'Titre de l’annonce'],
  writePost: ['Write your announcement…', 'Rédigez votre annonce…'],
  /* The switch beside Create that keeps the window open for the next
     task — Linear's words for it. */
  createMore: ['Create more', 'Créer d’autres'],
  taskCreated: ['Task created', 'Tâche créée'],
  openIt: ['Open', 'Ouvrir'],
})
