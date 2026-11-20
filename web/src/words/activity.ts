import { say } from '../data/words.js'

/** A project's Activity — `ui/Activity.tsx`. */
export const ACTIVITY = say({
  findIn: ['Find in activity', 'Rechercher dans l’activité'],
  all: ['All', 'Tout'],
  noneMatch: [(words: string) => `No activity matches “${words}”.`, (words: string) => `Aucune activité ne correspond à « ${words} ».`],
  noneIn: [(tab: string) => `No activity in ${tab} yet.`, (tab: string) => `Aucune activité dans ${tab} pour l’instant.`],
  emptyBody: [
    'Everything that happens in this project shows up here, with who did it and when.',
    'Tout ce qui se passe dans ce projet apparaît ici, avec qui l’a fait et quand.',
  ],
  showMore: ['Show more', 'Afficher plus'],
})
