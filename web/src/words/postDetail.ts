import { say } from '../data/words.js'

/** An announcement, opened — `ui/PostDetail.tsx`. */
export const POST_DETAIL = say({
  back: ['Back to Announcements', 'Retour aux annonces'],
  /* Following it. As a task's pill says it. */
  subscribe: ['Subscribe', 'Suivre'],
  subscribed: ['Subscribed', 'Suivie'],
  gone: [
    'This announcement isn’t available. It may have been deleted, or it’s in a project you’re not on.',
    'Cette annonce n’est pas disponible. Elle a peut-être été supprimée, ou elle se trouve dans un projet dont vous ne faites pas partie.',
  ],
  unsaved: [
    'Couldn’t save. Try again — your changes are still here.',
    'Impossible d’enregistrer. Réessayez — vos modifications sont toujours là.',
  ],
  more: ['More', 'Plus d’options'],
  linkCopied: ['Link copied', 'Lien copié'],
  couldNotCopy: ['Couldn’t copy link', 'Impossible de copier le lien'],
  copyLink: ['Copy link', 'Copier le lien'],
  deletePost: ['Delete announcement', 'Supprimer l’annonce'],
  /* On an agent's announcement, to whoever may change it — its title and
     words open until Done. */
  editPost: ['Edit announcement', 'Modifier l’annonce'],
  doneEditing: ['Done', 'Terminé'],
  deleteTheirs: [
    (who: string) => `Delete ${who}’s announcement for everyone? You can undo this right after.`,
    (who: string) => `Supprimer l’annonce de ${who} pour tout le monde ? Vous pourrez annuler juste après.`,
  ],
  /* The toast after it. */
  deleted: [(title: string) => `Deleted ${title}`, (title: string) => `Annonce supprimée : ${title}`],
  keep: ['Cancel', 'Annuler'],
  deleteIt: ['Delete', 'Supprimer'],
  /* After the date: how often a check-in is asked, as its author wrote it —
     "Every Monday". */
  asked: [(schedule: string) => ` · asked ${schedule}`, (schedule: string) => ` · posée ${schedule}`],
  whatAbout: ['What is it about?', 'De quoi s’agit-il ?'],
  nothingWritten: ['Nothing written yet.', 'Rien d’écrit pour l’instant.'],
})
