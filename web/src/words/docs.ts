import { say } from '../data/words.js'

/** A project's Files, the list — `ui/Docs.tsx`. */
export const DOCS = say({
  /* Where a file was first put, when the task has no handle. */
  task: ['Task', 'Tâche'],

  /* The kinds the list narrows to — `docs/specs/docs.md`, "Four kinds and
     whose". Uploads, not Files: the tool itself is Files now. */
  docs: ['Docs', 'Documents'],
  images: ['Images', 'Images'],
  uploads: ['Uploads', 'Importations'],
  links: ['Links', 'Liens'],

  /* Whose — Google Drive's words, and its French. */
  recent: ['Recent', 'Récents'],
  mine: ['My documents', 'Mes documents'],
  sharedWithMe: ['Shared with me', 'Partagés avec moi'],
  whose: ['Whose', 'Propriétaire'],
  kinds: ['Kind', 'Type'],

  /* The bin. Apple's
     words for it (Files, Photos, Notes), and its French. */
  recentlyDeleted: ['Recently Deleted', 'Suppressions récentes'],
  binEmpty: [(n: number) => `Nothing deleted in the last ${n} days.`, (n: number) => `Aucun élément supprimé ces ${n} derniers jours.`],
  binHint: [
    (n: number) => `Deleted files stay here for ${n} days, then go for good.`,
    (n: number) => `Les fichiers supprimés restent ici ${n} jours, puis sont supprimés définitivement.`,
  ],
  deletedBy: [(name: string) => `Deleted by ${name}`, (name: string) => `Supprimé par ${name}`],
  deletedByYou: ['Deleted by you', 'Supprimé par vous'],
  daysLeft: [
    (n: number) => (n === 1 ? '1 day left' : `${n} days left`),
    (n: number) => (n === 1 ? 'Il reste 1 jour' : `Il reste ${n} jours`),
  ],
  restore: ['Restore', 'Restaurer'],
  restoreName: [(name: string) => `Restore ${name}`, (name: string) => `Restaurer ${name}`],
  deleteForever: ['Delete forever', 'Supprimer définitivement'],
  deleteForeverName: [(name: string) => `Delete ${name} forever`, (name: string) => `Supprimer ${name} définitivement`],
  deleteForeverAsk: [(name: string) => `Delete “${name}” forever?`, (name: string) => `Supprimer « ${name} » définitivement ?`],
  cannotBeUndone: [
    'It goes now, with its comments, and this can’t be undone.',
    'Il sera supprimé maintenant, avec ses commentaires. Cette action est irréversible.',
  ],
  /* A private document goes with the files it holds. */
  andItsPictures: [
    (n: number) => (n === 1 ? 'The file in it goes too.' : `The ${n} files in it go too.`),
    (n: number) =>
      n === 1 ? 'Le fichier qu’il contient sera aussi supprimé.' : `Les ${n} fichiers qu’il contient seront aussi supprimés.`,
  ],

  /* A pinned row's card — `docs/specs/docs.md`, "A pinned document is a page". */
  updated: [(when: string) => `Updated ${when}`, (when: string) => `Modifié ${when}`],

  /* What a link is, read from its address, when the place has no name of its own. */
  link: ['Link', 'Lien'],
  figmaFile: ['Figma file', 'Fichier Figma'],
  notionPage: ['Notion page', 'Page Notion'],
  loomVideo: ['Loom video', 'Vidéo Loom'],
  youtubeVideo: ['YouTube video', 'Vidéo YouTube'],
  miroBoard: ['Miro board', 'Tableau Miro'],

  /* What a row is, under its name. */
  folder: ['Folder', 'Dossier'],
  document: ['Document', 'Document'],
  image: ['Image', 'Image'],
  file: ['File', 'Fichier'],

  /* A row. */
  open: [(name: string) => `Open ${name}`, (name: string) => `Ouvrir ${name}`],
  shared: ['Shared to the web', 'Partagé sur le web'],
  in: ['· in', '· dans'],
  unpinName: [(name: string) => `Unpin ${name}`, (name: string) => `Désépingler ${name}`],
  pinName: [(name: string) => `Pin ${name}`, (name: string) => `Épingler ${name}`],
  unpin: ['Unpin', 'Désépingler'],
  pinToTop: ['Pin to the top', 'Épingler en haut'],
  downloadName: [(name: string) => `Download ${name}`, (name: string) => `Télécharger ${name}`],
  download: ['Download', 'Télécharger'],
  moreFor: [(name: string) => `More for ${name}`, (name: string) => `Plus d’options pour ${name}`],

  /* Deleting one, and Undo. */
  deleteDocument: ['Delete document', 'Supprimer le document'],
  deleteFile: ['Delete file', 'Supprimer le fichier'],
  deleteLink: ['Delete link', 'Supprimer le lien'],
  editLink: ['Edit link', 'Modifier le lien'],
  deleted: [(name: string) => `Deleted ${name}`, (name: string) => `Supprimé : ${name}`],

  /* Adding a link. */
  addALink: ['Add a link', 'Ajouter un lien'],
  cancel: ['Cancel', 'Annuler'],
  add: ['Add', 'Ajouter'],
  name: ['Name', 'Nom'],
  optional: ['Optional', 'Facultatif'],

  /* A file on its way up. */
  tryAgain: ['Try again', 'Réessayer'],
  finishing: ['Finishing…', 'Finalisation…'],
  sentOf: [(percent: number, size: string) => `${percent}% of ${size}`, (percent: number, size: string) => `${percent} % de ${size}`],
  dismiss: ['Dismiss', 'Fermer'],
  stopUploading: ['Stop uploading', 'Arrêter l’importation'],
})
