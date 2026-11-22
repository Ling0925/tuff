import { one, say } from '../data/words.js'

/** What an agent did this week — `ui/AgentWeek.tsx`. Tasks are feminine. */
export const AGENT_WEEK = say({
  thisWeek: ['This week', 'Cette semaine'],
  thisMonth: ['This month', 'Ce mois-ci'],
  week: ['Week', 'Semaine'],
  month: ['Month', 'Mois'],
  /* Given to it in the period — "Assign" is "Attribuer" in the glossary. */
  took: ['Took', 'Attribuées'],
  finished: ['Finished', 'Terminées'],
  open: ['Open now', 'Ouvertes'],
  questions: ['Questions', 'Questions'],
  nAnswered: [(n: number) => `${n} answered`, (n: number) => `${n} avec réponse`],
  tokens: ['Tokens', 'Jetons'],
  noPrice: ['No price', 'Sans prix'],
  latest: ['Latest', 'Dernières actions'],
  nothingThisWeek: ['Nothing this week.', 'Rien cette semaine.'],
  nothingThisMonth: ['Nothing this month.', 'Rien ce mois-ci.'],
  noTasks: ['No tasks.', 'Aucune tâche.'],
  showMore: ['Show more', 'Afficher plus'],
  /* On a question's row: how many it asked there. */
  nQuestions: [(n: number) => `${n} question${n === 1 ? '' : 's'}`, (n: number) => `${n} ${one(n) ? 'question' : 'questions'}`],
  /* What a tile opens, for a screen reader: "Took: 4". */
  tile: [(label: string, n: string) => `${label}: ${n}`, (label: string, n: string) => `${label} : ${n}`],
})
