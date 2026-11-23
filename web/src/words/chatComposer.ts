import { say } from '../data/words.js'

/** The line a message is written on — `ui/ChatComposer.tsx`. */
export const COMPOSER = say({
  message: ['Message', 'Message', '消息'],
  pasteLink: ['Paste or type a link', 'Collez ou saisissez un lien', '粘贴或输入链接'],
  bold: ['Bold', 'Gras', '粗体'],
  italic: ['Italic', 'Italique', '斜体'],
  underline: ['Underline', 'Souligné', '下划线'],
  strikethrough: ['Strikethrough', 'Barré', '删除线'],
  link: ['Link', 'Lien', '链接'],
  numbered: ['Numbered list', 'Liste numérotée', '编号列表'],
  bulleted: ['Bulleted list', 'Liste à puces', '项目符号列表'],
  quote: ['Quote', 'Citation', '引用'],
  code: ['Code', 'Code', '代码'],
  codeBlock: ['Code block', 'Bloc de code', '代码块'],
  removeGif: ['Remove GIF', 'Retirer le GIF', '移除 GIF'],
  hideFormatting: ['Hide formatting', 'Masquer la mise en forme', '隐藏格式'],
  showFormatting: ['Show formatting', 'Afficher la mise en forme', '显示格式'],
  emoji: ['Emoji', 'Emoji', 'Emoji'],
  gif: ['GIF', 'GIF', 'GIF'],
  mentionSomeone: ['Mention someone', 'Mentionner une personne', '提及成员'],
  mentionTask: ['Mention a task', 'Mentionner une tâche', '提及任务'],
  mentionDoc: ['Mention a doc', 'Mentionner un document', '提及文档'],
  /** The heading over what `#` found. */
  matching: [
    (only: 'task' | 'doc' | null, q: string) => `${only === 'doc' ? 'Docs' : only === 'task' ? 'Tasks' : 'Tasks and docs'} matching “${q}”`,
    (only: 'task' | 'doc' | null, q: string) =>
      `${only === 'doc' ? 'Documents' : only === 'task' ? 'Tâches' : 'Tâches et documents'} correspondant à « ${q} »`,
    (only: 'task' | 'doc' | null, q: string) => `${only === 'doc' ? '文档' : only === 'task' ? '任务' : '任务和文档'}匹配「${q}」`,
  ],
  typeTitleWord: ['Type a word from the title', 'Saisissez un mot du titre', '输入标题中的一个词'],
  /** The example is a handle from the list — `MYP-61` — or, with none, "a code". */
  typeTitleOrCode: [
    (code: string | null) => `Type a title, a number or ${code ?? 'a code'}`,
    (code: string | null) => `Saisissez un titre, un numéro ou ${code ?? 'un code'}`,
    (code: string | null) => `输入标题、编号或 ${code ?? '代码'}`,
  ],
  noDocs: [
    'No matching docs in projects you share',
    'Aucun document correspondant dans les projets que vous partagez',
    '你参与的项目中没有匹配的文档',
  ],
  noTasks: [
    'No matching tasks in projects you share',
    'Aucune tâche correspondante dans les projets que vous partagez',
    '你参与的项目中没有匹配的任务',
  ],
  noTasksOrDocs: [
    'No matching tasks or docs in projects you share',
    'Aucune tâche ni aucun document correspondant dans les projets que vous partagez',
    '你参与的项目中没有匹配的任务或文档',
  ],
  /** The whole room as one name, in the list under `@` and in the message. */
  everyone: ['everyone', 'tous', '所有人'],
  everyoneHere: ['Everyone in this room', 'Tout le monde ici', '此房间中的所有人'],
  searchKlipy: ['Search KLIPY', 'Rechercher sur KLIPY', '搜索 KLIPY'],
  gifsFailed: ['Couldn’t load GIFs. Try again.', 'Impossible de charger les GIF. Réessayez.', '无法加载 GIF，请重试。'],
  noGifs: ['No GIFs found.', 'Aucun GIF trouvé.', '未找到 GIF。'],
})
