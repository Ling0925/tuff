import { say } from '../data/words.js'

/** A project's Files, the list — `ui/Docs.tsx`. */
export const DOCS = say({
  /* Where a file was first put, when the task has no handle. */
  task: ['Task', 'Tâche', '任务'],

  /* The kinds the list narrows to — `docs/specs/docs.md`, "Four kinds and
     whose". Uploads, not Files: the tool itself is Files now. */
  docs: ['Docs', 'Documents', '文档'],
  images: ['Images', 'Images', '图片'],
  uploads: ['Uploads', 'Importations', '上传'],
  links: ['Links', 'Liens', '链接'],

  /* Whose — Google Drive's words, and its French. */
  recent: ['Recent', 'Récents', '最近'],
  mine: ['My documents', 'Mes documents', '我的文档'],
  sharedWithMe: ['Shared with me', 'Partagés avec moi', '共享给我'],
  whose: ['Whose', 'Propriétaire', '所有者'],
  kinds: ['Kind', 'Type', '类型'],

  /* The bin. Apple's
     words for it (Files, Photos, Notes), and its French. */
  recentlyDeleted: ['Recently Deleted', 'Suppressions récentes', '最近删除'],
  binEmpty: [
    (n: number) => `Nothing deleted in the last ${n} days.`,
    (n: number) => `Aucun élément supprimé ces ${n} derniers jours.`,
    (n: number) => `${n} 天内没有删除任何内容。`,
  ],
  binHint: [
    (n: number) => `Deleted files stay here for ${n} days, then go for good.`,
    (n: number) => `Les fichiers supprimés restent ici ${n} jours, puis sont supprimés définitivement.`,
    (n: number) => `删除的文件会在这里保留 ${n} 天，然后永久删除。`,
  ],
  deletedBy: [(name: string) => `Deleted by ${name}`, (name: string) => `Supprimé par ${name}`, (name: string) => `由 ${name} 删除`],
  deletedByYou: ['Deleted by you', 'Supprimé par vous', '由你删除'],
  daysLeft: [
    (n: number) => (n === 1 ? '1 day left' : `${n} days left`),
    (n: number) => (n === 1 ? 'Il reste 1 jour' : `Il reste ${n} jours`),
    (n: number) => `剩余 ${n} 天`,
  ],
  restore: ['Restore', 'Restaurer', '恢复'],
  restoreName: [(name: string) => `Restore ${name}`, (name: string) => `Restaurer ${name}`, (name: string) => `恢复 ${name}`],
  deleteForever: ['Delete forever', 'Supprimer définitivement', '永久删除'],
  deleteForeverName: [
    (name: string) => `Delete ${name} forever`,
    (name: string) => `Supprimer ${name} définitivement`,
    (name: string) => `永久删除 ${name}`,
  ],
  deleteForeverAsk: [
    (name: string) => `Delete “${name}” forever?`,
    (name: string) => `Supprimer « ${name} » définitivement ?`,
    (name: string) => `永久删除「${name}」？`,
  ],
  cannotBeUndone: [
    'It goes now, with its comments, and this can’t be undone.',
    'Il sera supprimé maintenant, avec ses commentaires. Cette action est irréversible.',
    '它将连同评论立即删除，且无法撤销。',
  ],
  /* A private document goes with the files it holds. */
  andItsPictures: [
    (n: number) => (n === 1 ? 'The file in it goes too.' : `The ${n} files in it go too.`),
    (n: number) =>
      n === 1 ? 'Le fichier qu’il contient sera aussi supprimé.' : `Les ${n} fichiers qu’il contient seront aussi supprimés.`,
    (n: number) => `其中的 ${n} 个文件也会一并删除。`,
  ],

  /* A pinned row's card — `docs/specs/docs.md`, "A pinned document is a page". */
  updated: [(when: string) => `Updated ${when}`, (when: string) => `Modifié ${when}`, (when: string) => `更新于 ${when}`],

  /* What a link is, read from its address, when the place has no name of its own. */
  link: ['Link', 'Lien', '链接'],
  figmaFile: ['Figma file', 'Fichier Figma', 'Figma 文件'],
  notionPage: ['Notion page', 'Page Notion', 'Notion 页面'],
  loomVideo: ['Loom video', 'Vidéo Loom', 'Loom 视频'],
  youtubeVideo: ['YouTube video', 'Vidéo YouTube', 'YouTube 视频'],
  miroBoard: ['Miro board', 'Tableau Miro', 'Miro 白板'],

  /* What a row is, under its name. */
  folder: ['Folder', 'Dossier', '文件夹'],
  document: ['Document', 'Document', '文档'],
  image: ['Image', 'Image', '图片'],
  file: ['File', 'Fichier', '文件'],

  /* A row. */
  open: [(name: string) => `Open ${name}`, (name: string) => `Ouvrir ${name}`, (name: string) => `打开 ${name}`],
  shared: ['Shared to the web', 'Partagé sur le web', '已共享到网络'],
  in: ['· in', '· dans', '· 位于'],
  unpinName: [(name: string) => `Unpin ${name}`, (name: string) => `Désépingler ${name}`, (name: string) => `取消置顶 ${name}`],
  pinName: [(name: string) => `Pin ${name}`, (name: string) => `Épingler ${name}`, (name: string) => `置顶 ${name}`],
  unpin: ['Unpin', 'Désépingler', '取消置顶'],
  pinToTop: ['Pin to the top', 'Épingler en haut', '置顶'],
  downloadName: [(name: string) => `Download ${name}`, (name: string) => `Télécharger ${name}`, (name: string) => `下载 ${name}`],
  download: ['Download', 'Télécharger', '下载'],
  moreFor: [(name: string) => `More for ${name}`, (name: string) => `Plus d’options pour ${name}`, (name: string) => `${name} 的更多操作`],

  /* Deleting one, and Undo. */
  deleteDocument: ['Delete document', 'Supprimer le document', '删除文档'],
  deleteFile: ['Delete file', 'Supprimer le fichier', '删除文件'],
  deleteLink: ['Delete link', 'Supprimer le lien', '删除链接'],
  editLink: ['Edit link', 'Modifier le lien', '编辑链接'],
  deleted: [(name: string) => `Deleted ${name}`, (name: string) => `Supprimé : ${name}`, (name: string) => `已删除 ${name}`],

  /* Adding a link. */
  addALink: ['Add a link', 'Ajouter un lien', '添加链接'],
  cancel: ['Cancel', 'Annuler', '取消'],
  add: ['Add', 'Ajouter', '添加'],
  name: ['Name', 'Nom', '名称'],
  optional: ['Optional', 'Facultatif', '可选'],

  /* A file on its way up. */
  tryAgain: ['Try again', 'Réessayer', '重试'],
  finishing: ['Finishing…', 'Finalisation…', '正在完成…'],
  sentOf: [
    (percent: number, size: string) => `${percent}% of ${size}`,
    (percent: number, size: string) => `${percent} % de ${size}`,
    (percent: number, size: string) => `${size} 的 ${percent}%`,
  ],
  dismiss: ['Dismiss', 'Fermer', '忽略'],
  stopUploading: ['Stop uploading', 'Arrêter l’importation', '停止上传'],
})
