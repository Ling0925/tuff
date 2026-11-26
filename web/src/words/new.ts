import { one, say } from '../data/words.js'

/** The windows a task, a project and an announcement are made in — `ui/New.tsx`. */
export const NEW = say({
  projectName: ['Project name', 'Nom du projet', '项目名称'],
  waitingForUpload: ['Waiting for the upload to finish…', 'En attente de la fin de l’import…', '正在等待上传完成…'],
  toCreate: ['⌘↵ to create', '⌘↵ pour créer', '⌘↵ 创建'],
  /** What the pickers call the task: "Assignee of the new task". */
  theNewTask: ['the new task', 'la nouvelle tâche', '新任务'],
  taskTitle: ['Task title', 'Titre de la tâche', '任务标题'],
  noList: ['No list', 'Sans liste', '无列表'],
  noOne: ['No one', 'Personne', '无人'],
  labels: [
    (n: number) => (n === 1 ? `${n} label` : `${n} labels`),
    (n: number) => (one(n) ? `${n} étiquette` : `${n} étiquettes`),
    (n: number) => `${n} 个标签`,
  ],
  dueOfNewTask: ['Due date of the new task', 'Échéance de la nouvelle tâche', '新任务的截止日期'],
  postTitle: ['Announcement title', 'Titre de l’annonce', '公告标题'],
  writePost: ['Write your announcement…', 'Rédigez votre annonce…', '撰写你的公告…'],
  /* The announcement's two ways out. Basecamp's
     "Post this message" and "Save as a draft", said short. */
  post: ['Post', 'Publier', '发布'],
  saveDraft: ['Save draft', 'Enregistrer le brouillon', '保存草稿'],
  toPost: ['⌘↵ to post', '⌘↵ pour publier', '⌘↵ 发布'],
  /* The switch beside Create that keeps the window open for the next
     task — Linear's words for it. */
  createMore: ['Create more', 'Créer d’autres', '继续创建'],
  taskCreated: ['Task created', 'Tâche créée', '任务已创建'],
  openIt: ['Open', 'Ouvrir', '打开'],
})
