import { one, say } from '../data/words.js'

/** Every project, the archive and the bin — `ui/Projects.tsx`. */
export const PROJECTS_SAID = say({
  noProjectsYet: ['No projects yet.', 'Aucun projet pour l’instant.'],
  whatAProjectIs: [
    'A project keeps its tasks, chat, docs and announcements in one place.',
    'Un projet réunit ses tâches, sa discussion, ses documents et ses annonces au même endroit.',
  ],
  archive: ['Archive', 'Archiver'],
  /* A project row's own menu, by its ⋯ — `ui/Projects.tsx`. */
  more: ['More', 'Plus'],
  moveToBin: ['Move to bin', 'Mettre à la corbeille'],
  unarchive: ['Unarchive', 'Désarchiver'],
  restore: ['Restore', 'Restaurer'],
  deletePermanently: ['Delete permanently', 'Supprimer définitivement'],
  pressAgain: ['Press again', 'Appuyez à nouveau'],
  archivedOn: [(day: string) => `archived ${day}`, (day: string) => `archivé le ${day}`],
  deletedOn: [(day: string, left: string) => `deleted ${day} · ${left}`, (day: string, left: string) => `supprimé le ${day} · ${left}`],
  lessThanADay: ['less than a day left', 'moins d’un jour restant'],
  daysLeft: [
    (n: number) => (n === 1 ? '1 day left' : `${n} days left`),
    (n: number) => (one(n) ? `${n} jour restant` : `${n} jours restants`),
  ],
})
