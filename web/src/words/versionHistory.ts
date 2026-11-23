import { say } from '../data/words.js'

/** A document's versions — `ui/VersionHistory.tsx`. As Google Docs says them. */
export const VERSION_HISTORY = say({
  title: ['Version history', 'Historique des versions', '版本历史'],
  current: ['Current version', 'Version actuelle', '当前版本'],
  /* The body a document had before it kept versions: nobody to name. */
  earliest: ['Earliest saved version', 'Plus ancienne version enregistrée', '最早保存的版本'],
  restoredFrom: [
    (n: number) => `Restored from version ${n}`,
    (n: number) => `Restaurée depuis la version ${n}`,
    (n: number) => `从版本 ${n} 恢复`,
  ],
  restore: ['Restore this version', 'Restaurer cette version', '恢复此版本'],
  restoring: ['Restoring…', 'Restauration…', '正在恢复…'],
  restored: ['Version restored', 'Version restaurée', '版本已恢复'],
  couldNotRestore: [
    'Couldn’t restore this version. Try again.',
    'Impossible de restaurer cette version. Réessayez.',
    '无法恢复此版本，请重试。',
  ],
  couldNotLoad: [
    'Couldn’t load version history. Try again.',
    'Impossible de charger l’historique des versions. Réessayez.',
    '无法加载版本历史，请重试。',
  ],
  empty: [
    'No earlier versions yet. Versions are saved as the document is edited.',
    'Aucune version antérieure pour l’instant. Les versions sont enregistrées au fil des modifications.',
    '还没有更早的版本。版本会随文档编辑自动保存。',
  ],
  emptyBody: ['This version is empty.', 'Cette version est vide.', '此版本为空。'],
})
