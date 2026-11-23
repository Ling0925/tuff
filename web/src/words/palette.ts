import { say } from '../data/words.js'

/** The palette, over the work and as a phone's Search page — `ui/Palette.tsx`. */
export const PALETTE = say({
  workspaceSettings: ['Workspace settings', 'Paramètres de l’espace de travail', '工作区设置'],
  accountSettings: ['Account settings', 'Paramètres du compte', '账户设置'],
  /* What sort of thing a recent row is. */
  project: ['Project', 'Projet', '项目'],
  person: ['Person', 'Personne', '成员'],
  room: ['Chat', 'Discussion', '聊天'],
  screen: ['Screen', 'Écran', '页面'],
  task: ['Task', 'Tâche', '任务'],
  post: ['Announcement', 'Annonce', '公告'],
  doc: ['Doc', 'Document', '文档'],
  query: ['Search', 'Recherche', '搜索'],
  /* The groups the rows are listed under. */
  recent: ['Recent', 'Récents', '最近'],
  owner: ['Owner', 'Propriétaire', '所有者'],
  /* The place, every room — not a project's tab, which is "Discussion". */
  chat: ['Chat', 'Discussions', '聊天'],
  goTo: ['Go to', 'Aller à', '前往'],
  results: ['Results', 'Résultats', '结果'],
  create: ['Create', 'Créer', '创建'],
  thisTask: ['This task', 'Cette tâche', '此任务'],
  newTask: [(t: string) => `New task “${t}”`, (t: string) => `Nouvelle tâche « ${t} »`, (t: string) => `新建任务「${t}」`],
  /* `blocked by RED-12` typed with a task open. */
  blockedBy: [
    (handle: string) => `Blocked by ${handle}`,
    (handle: string) => `Bloquée par ${handle}`,
    (handle: string) => `被 ${handle} 阻塞`,
  ],
  typeToSearch: ['Type to search.', 'Saisissez votre recherche.', '输入以搜索。'],
  noResults: ['No results.', 'Aucun résultat.', '没有结果。'],
  /* The keys at the foot, in the lower case the English has. */
  esc: ['esc', 'échap', 'Esc'],
  close: ['close', 'fermer', '关闭'],
  move: ['move', 'naviguer', '移动'],
  open: ['open', 'ouvrir', '打开'],
  /** Narrowing what was said. Slack's words. */
  fromAnyone: ['From anyone', 'De n’importe qui', '来自任何人'],
  from: ['From', 'De', '来自'],
  hasLink: ['Has a link', 'Contient un lien', '包含链接'],
  hasFile: ['Has a file', 'Contient un fichier', '包含文件'],
  inThreads: ['In threads', 'Dans les fils de discussion', '在话题中'],
  newestFirst: ['Newest first', 'Plus récents d’abord', '最新优先'],
  oldestFirst: ['Oldest first', 'Plus anciens d’abord', '最早优先'],
  sortBy: ['Sort', 'Trier', '排序'],
})
