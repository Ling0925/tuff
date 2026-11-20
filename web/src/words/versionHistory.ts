import { say } from '../data/words.js'

/** A document's versions — `ui/VersionHistory.tsx`. As Google Docs says them. */
export const VERSION_HISTORY = say({
  title: ['Version history', 'Historique des versions'],
  current: ['Current version', 'Version actuelle'],
  /* The body a document had before it kept versions: nobody to name. */
  earliest: ['Earliest saved version', 'Plus ancienne version enregistrée'],
  restoredFrom: [(n: number) => `Restored from version ${n}`, (n: number) => `Restaurée depuis la version ${n}`],
  restore: ['Restore this version', 'Restaurer cette version'],
  restoring: ['Restoring…', 'Restauration…'],
  restored: ['Version restored', 'Version restaurée'],
  couldNotRestore: ['Couldn’t restore this version. Try again.', 'Impossible de restaurer cette version. Réessayez.'],
  couldNotLoad: ['Couldn’t load version history. Try again.', 'Impossible de charger l’historique des versions. Réessayez.'],
  empty: [
    'No earlier versions yet. Versions are saved as the document is edited.',
    'Aucune version antérieure pour l’instant. Les versions sont enregistrées au fil des modifications.',
  ],
  emptyBody: ['This version is empty.', 'Cette version est vide.'],
})
