import { say } from '../data/words.js'

/** A task's card in a message — `ui/TaskCard.tsx`. */
export const TASK_CARD = say({
  gone: ['This task was deleted or you don’t have access to it.', 'Cette tâche a été supprimée, ou vous n’y avez pas accès.'],
  age: [(n: number) => `${n}d`, (n: number) => `${n} j`],
  created: [(date: string) => `Created ${date}`, (date: string) => `Créée le ${date}`],
  updated: [(date: string) => `Updated ${date}`, (date: string) => `Modifiée le ${date}`],
})
