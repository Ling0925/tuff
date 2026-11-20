import { one, say } from '../data/words.js'

/** A person's numbers and weeks, and their hours — `ui/Stats.tsx`. Tasks are feminine. */
export const STATS = say({
  stats: ['Stats', 'Statistiques'],
  open: ['Open', 'Ouvertes'],
  overdue: ['Overdue', 'En retard'],
  finishedFourWeeks: ['Finished, 4 weeks', 'Terminées, 4 semaines'],
  nOpen: [(n: number) => `${n} open`, (n: number) => `${n} ${one(n) ? 'ouverte' : 'ouvertes'}`],
  nOverdue: [(n: number) => `${n} overdue`, (n: number) => `${n} en retard`],
  /* Short in French: the folded line is one line beside the heading. */
  nFinishedFourWeeks: [(n: number) => ` · ${n} finished, 4 weeks`, (n: number) => ` · ${n} ${one(n) ? 'terminée' : 'terminées'}, 4 sem.`],
  finishedByWeek: ['Finished, by week', 'Terminées, par semaine'],
  inTwelveWeeks: [(n: number) => `${n} in 12 weeks`, (n: number) => `${n} en 12 semaines`],
  thisWeek: ['this week', 'cette semaine'],
  chart: [(title: string, said: string) => `${title}: ${said}`, (title: string, said: string) => `${title} : ${said}`],
  hoursThirtyDays: ['Hours, 30 days', 'Heures, 30 jours'],
  aTask: ['A task', 'Une tâche'],
  notOnATask: ['Not on a task', 'Hors tâche'],
  activity: ['Activity', 'Activité'],
  /* `1 action`, `2 actions` — a count and its noun, agreeing. */
  activeDays: [(n: number) => `${n} active day${n === 1 ? '' : 's'}`, (n: number) => `${n} ${one(n) ? 'jour actif' : 'jours actifs'}`],
  actions: [(n: number) => `${n} action${n === 1 ? '' : 's'}`, (n: number) => `${n} ${one(n) ? 'action' : 'actions'}`],
  activityOver: [
    (weeks: number, days: string, actions: string) => `Activity over ${weeks} weeks: ${days}, ${actions}`,
    (weeks: number, days: string, actions: string) => `Activité sur ${weeks} semaines : ${days}, ${actions}`,
  ],
  less: ['Less', 'Moins'],
  more: ['More', 'Plus'],
})
