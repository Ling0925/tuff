import { one, say } from '../data/words.js'

/** A project's tasks, the list and the board — `ui/Tasks.tsx`. */
export const TASKS = say({
  /* What each order is called, said on a column while a card is held over
     it: "Sorted by due date". */
  sortDue: ['due date', 'date d’échéance', '截止日期'],
  sortRecent: ['last updated', 'dernière modification', '最近更新'],
  sortPriority: ['priority', 'priorité', '优先级'],
  sortTitle: ['title', 'titre', '标题'],
  sortCycle: ['sprint', 'sprint', '迭代'],
  sortCreated: ['created date', 'date de création', '创建日期'],

  /* The card. */
  age: [(n: number) => `${n}d`, (n: number) => `${n} j`, (n: number) => `${n} 天`],
  sprintFor: [(title: string) => `Sprint for ${title}`, (title: string) => `Sprint de ${title}`, (title: string) => `${title} 的迭代`],
  created: [(date: string) => `Created ${date}`, (date: string) => `Créée le ${date}`, (date: string) => `创建于 ${date}`],
  updated: [(date: string) => `Updated ${date}`, (date: string) => `Modifiée le ${date}`, (date: string) => `更新于 ${date}`],

  /* The way back after a delete. */
  deletedOne: [
    (title: string) => `Deleted ${title}`,
    (title: string) => `Tâche supprimée : ${title}`,
    (title: string) => `已删除 ${title}`,
  ],
  deletedMany: [
    (n: number) => `Deleted ${n === 1 ? '1 task' : `${n} tasks`}`,
    (n: number) => (one(n) ? `${n} tâche supprimée` : `${n} tâches supprimées`),
    (n: number) => `已删除 ${n} 个任务`,
  ],

  /* The bar that says what is taken. */
  selected: [
    (n: number) => `${n} selected`,
    (n: number) => (one(n) ? `${n} sélectionnée` : `${n} sélectionnées`),
    (n: number) => `已选择 ${n} 项`,
  ],
  /** What a menu over the selection is about: "Assignee of 3 tasks". */
  nTasks: [
    (n: number) => (n === 1 ? `${n} task` : `${n} tasks`),
    (n: number) => (one(n) ? `${n} tâche` : `${n} tâches`),
    (n: number) => `${n} 个任务`,
  ],

  /* The bands a list is grouped into, when the band has nothing to be named by. */
  noAssignee: ['No assignee', 'Sans responsable', '无负责人'],
  noLabels: ['No labels', 'Sans étiquette', '无标签'],
  noPriority: ['No priority', 'Sans priorité', '无优先级'],
  noDueDate: ['No due date', 'Sans échéance', '无截止日期'],
  dueByToday: ['Due today or earlier', 'Échéance aujourd’hui ou avant', '今天或更早到期'],
  dueLater: ['Due later', 'Échéance plus tard', '之后到期'],
  noList: ['No list', 'Sans liste', '无列表'],

  /* The bar over the work. */
  board: ['Board', 'Tableau', '看板'],
  /* What a board's columns are, in its View menu: the lists, or the members.
     Members, as the project's own people are
     called on its Settings and in Linear's and Asana's grouping. */
  columns: ['Columns', 'Colonnes', '列'],
  columnsLists: ['Status', 'Statut', '状态'],
  columnsMembers: ['Members', 'Membres', '成员'],
  /* The ring before a card's title on the board of members, for whoever
     cannot see it: the list the task is in. */
  statusIs: [(list: string) => `Status: ${list}`, (list: string) => `Statut : ${list}`, (list: string) => `状态：${list}`],

  /* A column in the people view. */
  notOnProject: ['Not on this project', 'Hors du projet', '不在此项目中'],
  doneCount: [(n: number) => `${n} done`, (n: number) => (one(n) ? `${n} terminée` : `${n} terminées`), (n: number) => `${n} 已完成`],
  openCount: [
    (n: number) => (n === 1 ? '1 open task' : `${n} open tasks`),
    (n: number) => (one(n) ? `${n} tâche en cours` : `${n} tâches en cours`),
    (n: number) => `${n} 个未完成任务`,
  ],

  /* A column on the board. */
  expand: [(name: string) => `Expand ${name}`, (name: string) => `Développer la colonne ${name}`, (name: string) => `展开 ${name}`],
  collapse: [(name: string) => `Collapse ${name}`, (name: string) => `Réduire la colonne ${name}`, (name: string) => `收起 ${name}`],
  /* The face beside a list an agent takes. */
  takesHere: [
    (name: string) => `${name} takes new tasks here`,
    (name: string) => `${name} prend les nouvelles tâches de cette liste`,
    (name: string) => `${name} 在这里接收新任务`,
  ],

  noTasks: ['No tasks yet', 'Aucune tâche pour l’instant', '还没有任务'],
  noTasksBody: [
    'Create a task for anything someone needs to do.',
    'Créez une tâche pour tout ce que quelqu’un doit faire.',
    '为任何需要完成的事情创建任务。',
  ],

  /* The View panel. */
  allLists: ['All lists', 'Toutes les listes', '所有列表'],
  grouping: ['Grouping', 'Regroupement', '分组'],
  label: ['Label', 'Étiquette', '标签'],
  dueDate: ['Due date', 'Échéance', '截止日期'],
  ordering: ['Ordering', 'Tri', '排序'],
  manual: ['Manual', 'Manuel', '手动'],
  title: ['Title', 'Titre', '标题'],
  lastUpdated: ['Last updated', 'Dernière modification', '最近更新'],
  /* When it was made, newest first. */
  createdOrder: ['Created', 'Date de création', '创建时间'],
  direction: ['Direction', 'Ordre', '方向'],
  firstToLast: ['First to last', 'Croissant', '从前到后'],
  lastToFirst: ['Last to first', 'Décroissant', '从后到前'],
  showOnRow: ['Show on each row', 'Afficher sur chaque ligne', '在每行显示'],
  showOnCard: ['Show on each card', 'Afficher sur chaque carte', '在每张卡片显示'],
  number: ['Number', 'Numéro', '编号'],
  dates: ['Dates', 'Dates', '日期'],
  ageSwitch: ['Age', 'Ancienneté', '时长'],
  /* The task's first picture at the head of its card. */
  images: ['Images', 'Images', '图片'],

  /* Whose work, in the View panel. */
  assignedTo: ['Assigned to', 'Attribuées à', '指派给'],
  everyone: ['Everyone', 'Tout le monde', '所有人'],
  mine: ['Mine', 'Les miennes', '我的'],
  noOne: ['No one', 'Personne', '无人'],
  noOneByThatName: ['No one by that name.', 'Personne ne porte ce nom.', '没有找到这个名字。'],
  /* A row's and a card's mark while what it waits on is open.
     Asana's "En attente de". */
  waitingOn: [
    (handle: string) => `Waiting on ${handle}`,
    (handle: string) => `En attente de ${handle}`,
    (handle: string) => `等待 ${handle}`,
  ],
  waitingOnMore: [
    (handle: string, more: number) => `Waiting on ${handle} +${more}`,
    (handle: string, more: number) => `En attente de ${handle} +${more}`,
    (handle: string, more: number) => `等待 ${handle} +${more}`,
  ],
})
