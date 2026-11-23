import { say } from '../data/words.js'

/** A task's card in a message — `ui/TaskCard.tsx`. */
export const TASK_CARD = say({
  gone: [
    'This task was deleted or you don’t have access to it.',
    'Cette tâche a été supprimée, ou vous n’y avez pas accès.',
    '此任务已被删除，或你无权访问。',
  ],
  age: [(n: number) => `${n}d`, (n: number) => `${n} j`, (n: number) => `${n} 天`],
  created: [(date: string) => `Created ${date}`, (date: string) => `Créée le ${date}`, (date: string) => `创建于 ${date}`],
  updated: [(date: string) => `Updated ${date}`, (date: string) => `Modifiée le ${date}`, (date: string) => `更新于 ${date}`],
})
