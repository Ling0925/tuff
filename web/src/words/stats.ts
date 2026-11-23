import { one, say } from '../data/words.js'

/** A person's numbers and weeks, and their hours — `ui/Stats.tsx`. Tasks are feminine. */
export const STATS = say({
  stats: ['Stats', 'Statistiques', '统计'],
  open: ['Open', 'Ouvertes', '未完成'],
  overdue: ['Overdue', 'En retard', '逾期'],
  finishedFourWeeks: ['Finished, 4 weeks', 'Terminées, 4 semaines', '已完成，4 周'],
  nOpen: [(n: number) => `${n} open`, (n: number) => `${n} ${one(n) ? 'ouverte' : 'ouvertes'}`, (n: number) => `${n} 项未完成`],
  nOverdue: [(n: number) => `${n} overdue`, (n: number) => `${n} en retard`, (n: number) => `${n} 项逾期`],
  /* Short in French: the folded line is one line beside the heading. */
  nFinishedFourWeeks: [
    (n: number) => ` · ${n} finished, 4 weeks`,
    (n: number) => ` · ${n} ${one(n) ? 'terminée' : 'terminées'}, 4 sem.`,
    (n: number) => ` · ${n} 项已完成，4 周`,
  ],
  finishedByWeek: ['Finished, by week', 'Terminées, par semaine', '已完成，按周'],
  inTwelveWeeks: [(n: number) => `${n} in 12 weeks`, (n: number) => `${n} en 12 semaines`, (n: number) => `12 周内 ${n} 项`],
  thisWeek: ['this week', 'cette semaine', '本周'],
  chart: [
    (title: string, said: string) => `${title}: ${said}`,
    (title: string, said: string) => `${title} : ${said}`,
    (title: string, said: string) => `${title}：${said}`,
  ],
  hoursThirtyDays: ['Hours, 30 days', 'Heures, 30 jours', '工时，30 天'],
  aTask: ['A task', 'Une tâche', '任务'],
  notOnATask: ['Not on a task', 'Hors tâche', '非任务'],
  activity: ['Activity', 'Activité', '动态'],
  /* `1 action`, `2 actions` — a count and its noun, agreeing. */
  activeDays: [
    (n: number) => `${n} active day${n === 1 ? '' : 's'}`,
    (n: number) => `${n} ${one(n) ? 'jour actif' : 'jours actifs'}`,
    (n: number) => `${n} 个活跃日`,
  ],
  actions: [
    (n: number) => `${n} action${n === 1 ? '' : 's'}`,
    (n: number) => `${n} ${one(n) ? 'action' : 'actions'}`,
    (n: number) => `${n} 个操作`,
  ],
  activityOver: [
    (weeks: number, days: string, actions: string) => `Activity over ${weeks} weeks: ${days}, ${actions}`,
    (weeks: number, days: string, actions: string) => `Activité sur ${weeks} semaines : ${days}, ${actions}`,
    (weeks: number, days: string, actions: string) => `${weeks} 周内的动态：${days}，${actions}`,
  ],
  less: ['Less', 'Moins', '较少'],
  more: ['More', 'Plus', '较多'],
})
