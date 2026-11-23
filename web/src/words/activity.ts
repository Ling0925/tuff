import { say } from '../data/words.js'

/** A project's Activity — `ui/Activity.tsx`. */
export const ACTIVITY = say({
  findIn: ['Find in activity', 'Rechercher dans l’activité', '在动态中查找'],
  all: ['All', 'Tout', '全部'],
  noneMatch: [
    (words: string) => `No activity matches “${words}”.`,
    (words: string) => `Aucune activité ne correspond à « ${words} ».`,
    (words: string) => `没有动态匹配「${words}」。`,
  ],
  noneIn: [
    (tab: string) => `No activity in ${tab} yet.`,
    (tab: string) => `Aucune activité dans ${tab} pour l’instant.`,
    (tab: string) => `${tab} 中还没有动态。`,
  ],
  emptyBody: [
    'Everything that happens in this project shows up here, with who did it and when.',
    'Tout ce qui se passe dans ce projet apparaît ici, avec qui l’a fait et quand.',
    '此项目中发生的一切都会显示在这里，包括是谁在何时做的。',
  ],
  showMore: ['Show more', 'Afficher plus', '显示更多'],
})
