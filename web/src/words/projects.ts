import { one, say } from '../data/words.js'

/** Every project, the archive and the bin — `ui/Projects.tsx`. */
export const PROJECTS_SAID = say({
  noProjectsYet: ['No projects yet.', 'Aucun projet pour l’instant.', '还没有项目。'],
  whatAProjectIs: [
    'A project keeps its tasks, chat, docs and announcements in one place.',
    'Un projet réunit ses tâches, sa discussion, ses documents et ses annonces au même endroit.',
    '项目把任务、聊天、文档和公告集中在一处。',
  ],
  archive: ['Archive', 'Archiver', '归档'],
  /* A project row's own menu, by its ⋯ — `ui/Projects.tsx`. */
  more: ['More', 'Plus', '更多'],
  moveToBin: ['Move to bin', 'Mettre à la corbeille', '移到回收站'],
  unarchive: ['Unarchive', 'Désarchiver', '取消归档'],
  restore: ['Restore', 'Restaurer', '恢复'],
  deletePermanently: ['Delete permanently', 'Supprimer définitivement', '永久删除'],
  pressAgain: ['Press again', 'Appuyez à nouveau', '再按一次'],
  archivedOn: [(day: string) => `archived ${day}`, (day: string) => `archivé le ${day}`, (day: string) => `${day} 归档`],
  deletedOn: [
    (day: string, left: string) => `deleted ${day} · ${left}`,
    (day: string, left: string) => `supprimé le ${day} · ${left}`,
    (day: string, left: string) => `${day} 删除 · ${left}`,
  ],
  lessThanADay: ['less than a day left', 'moins d’un jour restant', '剩余不足一天'],
  daysLeft: [
    (n: number) => (n === 1 ? '1 day left' : `${n} days left`),
    (n: number) => (one(n) ? `${n} jour restant` : `${n} jours restants`),
    (n: number) => `剩余 ${n} 天`,
  ],
})
