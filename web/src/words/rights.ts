import { say } from '../data/words.js'

/** What each permission on a project is called — `data/rights.ts`. */
export const RIGHTS_SAID = say({
  createTasks: ['Create tasks', 'Créer des tâches'],
  deleteTasks: ['Delete tasks', 'Supprimer des tâches'],
  createChannels: ['Create channels', 'Créer des canaux'],
  deleteChannels: ['Delete channels', 'Supprimer des canaux'],
  editOthers: ['Edit others’ tasks', 'Modifier les tâches des autres'],
  changeSettings: ['Change settings', 'Modifier les paramètres'],
  editOthersHint: ['Also their announcements, documents and comments', 'Ainsi que leurs annonces, documents et commentaires'],
  /* The same right deletes others' rows in Docs. */
  deleteTasksHint: ['Also others’ documents, files and links', 'Ainsi que les documents, fichiers et liens des autres'],
})
