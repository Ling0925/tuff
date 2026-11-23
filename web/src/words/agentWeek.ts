import { one, say } from '../data/words.js'

/** What an agent did this week — `ui/AgentWeek.tsx`. Tasks are feminine. */
export const AGENT_WEEK = say({
  thisWeek: ['This week', 'Cette semaine', '本周'],
  thisMonth: ['This month', 'Ce mois-ci', '本月'],
  week: ['Week', 'Semaine', '周'],
  month: ['Month', 'Mois', '月'],
  /* Given to it in the period — "Assign" is "Attribuer" in the glossary. */
  took: ['Took', 'Attribuées', '领取'],
  finished: ['Finished', 'Terminées', '已完成'],
  open: ['Open now', 'Ouvertes', '当前未完成'],
  questions: ['Questions', 'Questions', '提问'],
  nAnswered: [(n: number) => `${n} answered`, (n: number) => `${n} avec réponse`, (n: number) => `${n} 条已回答`],
  tokens: ['Tokens', 'Jetons', '令牌'],
  noPrice: ['No price', 'Sans prix', '无价格'],
  latest: ['Latest', 'Dernières actions', '最近动态'],
  nothingThisWeek: ['Nothing this week.', 'Rien cette semaine.', '本周没有动态。'],
  nothingThisMonth: ['Nothing this month.', 'Rien ce mois-ci.', '本月没有动态。'],
  noTasks: ['No tasks.', 'Aucune tâche.', '没有任务。'],
  showMore: ['Show more', 'Afficher plus', '显示更多'],
  /* On a question's row: how many it asked there. */
  nQuestions: [
    (n: number) => `${n} question${n === 1 ? '' : 's'}`,
    (n: number) => `${n} ${one(n) ? 'question' : 'questions'}`,
    (n: number) => `${n} 个问题`,
  ],
  /* What a tile opens, for a screen reader: "Took: 4". */
  tile: [
    (label: string, n: string) => `${label}: ${n}`,
    (label: string, n: string) => `${label} : ${n}`,
    (label: string, n: string) => `${label}：${n}`,
  ],
})
