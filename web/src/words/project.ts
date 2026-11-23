import { one, say } from '../data/words.js'

/** A project's tools — `ui/Project.tsx`: the tab menu, Announcements and Files. */
export const PROJECT_SAID = say({
  tooLarge: [
    (mb: number) => `Too large. Files can be up to ${mb} MB.`,
    (mb: number) => `Trop volumineux. Les fichiers peuvent faire jusqu’à ${mb} Mo.`,
    (mb: number) => `文件过大。文件最大 ${mb} MB。`,
  ],
  couldNotUpload: ['Couldn’t upload. Try again.', 'Impossible d’importer. Réessayez.', '上传失败，请重试。'],
  switchTab: ['Switch tab', 'Changer d’onglet', '切换标签页'],
  postsHint: [
    'Use announcements for news and decisions.',
    'Utilisez les annonces pour partager les nouvelles et les décisions.',
    '用公告发布消息和决定。',
  ],
  postsWait: [
    'When someone posts an announcement, it appears here.',
    'Quand quelqu’un publie une annonce, elle apparaît ici.',
    '有人发布公告后，会显示在这里。',
  ],
  asked: [(when: string) => ` · asked ${when}`, (when: string) => ` · demandée ${when}`, (when: string) => ` · 提问于 ${when}`],
  replies: [
    (n: number) => `${n} ${n === 1 ? 'reply' : 'replies'}`,
    (n: number) => `${n} ${one(n) ? 'réponse' : 'réponses'}`,
    (n: number) => `${n} 条回复`,
  ],
  findInDocs: ['Find in files', 'Rechercher un fichier', '在文件中查找'],
  addToDocs: ['Add to files', 'Ajouter aux fichiers', '添加到文件'],
  uploadFile: ['Upload file', 'Importer un fichier', '上传文件'],
  docsHint: [
    'Write a document, upload a file or add a link.',
    'Rédigez un document, importez un fichier ou ajoutez un lien.',
    '编写文档、上传文件或添加链接。',
  ],
  docsWait: [
    'When someone adds a document, it appears here.',
    'Quand quelqu’un ajoute un document, il apparaît ici.',
    '有人添加文档后，会显示在这里。',
  ],
  noResults: [
    (q: string) => `No results for “${q}”.`,
    (q: string) => `Aucun résultat pour « ${q} ».`,
    (q: string) => `没有「${q}」的结果。`,
  ],
  noDocuments: ['No documents here yet.', 'Aucun document ici pour l’instant.', '这里还没有文档。'],
  noImages: ['No images here yet.', 'Aucune image ici pour l’instant.', '这里还没有图片。'],
  noLinks: [
    'No links here yet. Paste a link anywhere on this page to add it.',
    'Aucun lien ici pour l’instant. Collez un lien n’importe où sur cette page pour l’ajouter.',
    '这里还没有链接。在此页面任意位置粘贴链接即可添加。',
  ],
  noFiles: ['No uploads here yet.', 'Aucune importation ici pour l’instant.', '这里还没有上传的文件。'],
  /* Whose, when it narrows a kind to nothing. */
  noneMine: ['Nothing you added here yet.', 'Rien de ce que vous avez ajouté ici pour l’instant.', '你还没有在这里添加任何内容。'],
  noneShared: ['Nothing from others here yet.', 'Rien des autres ici pour l’instant.', '这里还没有其他人添加的内容。'],
  /* Leaving a project. */
  leaveProject: ['Leave project', 'Quitter le projet', '退出项目'],
  /* The project's column folded into the sidebar and back.
     Said as where the tools go, which is
     what the press does. */
  toolsToSidebar: ['Show in sidebar', 'Afficher dans la barre latérale', '在侧边栏显示'],
  toolsToColumn: ['Show as a column', 'Afficher en colonne', '以列显示'],
  leaveName: [(name: string) => `Leave ${name}?`, (name: string) => `Quitter ${name}\u00a0?`, (name: string) => `退出 ${name}？`],
  leaveSays: [
    'You’ll no longer see its tasks, chat, files or announcements. Anyone on the project or the workspace owner can add you back.',
    'Vous ne verrez plus ses tâches, discussions, fichiers ni annonces. Une personne du projet ou le propriétaire de l’espace de travail peut vous rajouter.',
    '你将不再看到它的任务、聊天、文件或公告。项目成员或工作区所有者可以把你加回来。',
  ],
  leaveSaysOwner: [
    'You’ll come off its list of people. As the workspace owner, you can still open it and add yourself back.',
    'Vous ne figurerez plus parmi les personnes du projet. En tant que propriétaire de l’espace de travail, vous pouvez toujours l’ouvrir et vous y rajouter.',
    '你将不再出现在其成员列表中。作为工作区所有者，你仍可打开它并把自己加回。',
  ],
  leave: ['Leave', 'Quitter', '退出'],
  leaving: ['Leaving…', 'Départ…', '正在退出…'],
  couldntLeave: ['Couldn’t leave the project. Try again.', 'Impossible de quitter le projet. Réessayez.', '无法退出项目，请重试。'],
})
