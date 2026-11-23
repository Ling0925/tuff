import { one, say } from '../data/words.js'

/** A project's settings — `ui/ProjectSettings.tsx`. */
export const PROJECT_SETTINGS = say({
  endBeforeStart: [
    'The end date can’t be before the start date.',
    'La date de fin ne peut pas précéder la date de début.',
    '结束日期不能早于开始日期。',
  ],
  nameOf: [(name: string) => `Name of ${name}`, (name: string) => `Nom de ${name}`, (name: string) => `${name} 的名称`],
  startOf: [(name: string) => `Start of ${name}`, (name: string) => `Début de ${name}`, (name: string) => `${name} 的开始`],
  endOf: [(name: string) => `End of ${name}`, (name: string) => `Fin de ${name}`, (name: string) => `${name} 的结束`],
  tasks: [
    (n: number) => (n === 1 ? '1 task' : `${n} tasks`),
    (n: number) => `${n} ${one(n) ? 'tâche' : 'tâches'}`,
    (n: number) => `${n} 个任务`,
  ],
  removeKeepTasks: ['Remove, keep tasks', 'Retirer, garder les tâches', '移除，保留任务'],
  couldNotAddSprint: ['Couldn’t add the sprint. Try again.', 'Impossible d’ajouter le sprint. Réessayez.', '无法添加迭代，请重试。'],
  sprintName: ['Sprint name', 'Nom du sprint', '迭代名称'],
  starts: ['Starts', 'Début', '开始'],
  sprintStarts: ['Sprint starts', 'Début du sprint', '迭代开始'],
  ends: ['Ends', 'Fin', '结束'],
  sprintEnds: ['Sprint ends', 'Fin du sprint', '迭代结束'],

  changeIcon: ['Change icon', 'Changer l’icône', '更改图标'],
  change: ['Change', 'Changer', '更改'],
  uploadPicture: ['Upload picture', 'Importer une image', '上传图片'],
  couldNotUpload: ['Couldn’t upload. Try again.', 'Impossible d’importer. Réessayez.', '上传失败，请重试。'],
  default: ['Default', 'Par défaut', '默认'],

  toolsHint: [
    'Turn off any tools this project doesn’t need. All four are on by default.',
    'Désactivez les outils dont ce projet n’a pas besoin. Les quatre sont activés par défaut.',
    '关闭此项目不需要的工具。默认四项全部开启。',
  ],
  listsHint: [
    'The stages a task moves through. A task moved into the list with the Finished icon is marked done.',
    'Les étapes par lesquelles passe une tâche. Une tâche déplacée dans la liste à l’icône Terminée est marquée comme terminée.',
    '任务经历的阶段。移动到「已完成」图标列表中的任务会被标记为完成。',
  ],
  /* The agent that takes a list's new tasks. */
  listAgentOf: [
    (list: string) => `Agent that takes new tasks in ${list}`,
    (list: string) => `Agent qui prend les nouvelles tâches de ${list}`,
    (list: string) => `负责 ${list} 新任务的代理`,
  ],
  listAgentSaid: [
    (name: string) => `New tasks here with no one assigned go to ${name}.`,
    (name: string) => `Les nouvelles tâches de cette liste sans responsable sont attribuées à ${name}.`,
    (name: string) => `此列表中没有负责人的新任务将交给 ${name}。`,
  ],
  listAgentGone: [
    (name: string) => `${name} isn’t on this project anymore, so new tasks here aren’t assigned to anyone.`,
    (name: string) => `${name} ne fait plus partie de ce projet : les nouvelles tâches de cette liste ne sont attribuées à personne.`,
    (name: string) => `${name} 已不在该项目中，因此此列表的新任务不会指派给任何人。`,
  ],
  theAgent: ['The agent', 'L’agent', '该代理'],
  labelsHint: [
    'What kind of work a task is. Each project has its own labels, and new projects start with Bug, Feature and Improvement.',
    'Le type de travail d’une tâche. Chaque projet a ses propres étiquettes, et un nouveau projet commence avec Bug, Fonctionnalité et Amélioration.',
    '任务的类型。每个项目有自己的标签，新项目默认带有「缺陷」「功能」和「改进」。',
  ],
  sprintsHint: [
    'A sprint is a named date range you can add tasks to. Sprints don’t start or end on their own: tasks stay in a sprint after its dates pass, until someone moves them.',
    'Un sprint est une période nommée à laquelle vous pouvez ajouter des tâches. Un sprint ne commence ni ne se termine tout seul : les tâches y restent une fois ses dates passées, jusqu’à ce que quelqu’un les déplace.',
    '迭代是一个有名称的日期范围，可以往里面加任务。迭代不会自动开始或结束：日期过后任务仍留在迭代中，直到有人移动它们。',
  ],
  peopleHint: [
    'Add people who are already in the workspace; someone new needs an invitation first. Choose what each person can do in this project.',
    'Ajoutez des personnes déjà présentes dans l’espace de travail ; une nouvelle personne doit d’abord être invitée. Choisissez ce que chacun peut faire dans ce projet.',
    '添加已在工作区中的成员；新成员需要先收到邀请。为每个人选择其在此项目中的权限。',
  ],
  addPeople: ['Add people', 'Ajouter des personnes', '添加成员'],
  everyoneIsHere: ['Everyone in the workspace is here.', 'Tout l’espace de travail est déjà là.', '工作区中的所有成员都已加入。'],
  inviteSomeoneNew: ['Invite someone new', 'Inviter une nouvelle personne', '邀请新成员'],
  hoursHint: [
    'Time logged on this project’s tasks, by person. To log time, open a task.',
    'Le temps saisi sur les tâches de ce projet, par personne. Pour saisir du temps, ouvrez une tâche.',
    '此项目任务上的工时，按人统计。要记录工时，请打开一个任务。',
  ],
  aiUsage: ['AI usage', 'Utilisation de l’IA', 'AI 用量'],
  aiUsageHint: [
    'Tokens and cost that AI tools reported on this project’s tasks, by person and tool.',
    'Les jetons et le coût signalés par les outils d’IA sur les tâches de ce projet, par personne et par outil.',
    'AI 工具在此项目任务上报告的令牌数与费用，按人和工具统计。',
  ],
  aiTotal: ['Total', 'Total', '总计'],
  tokens: [(n: string) => `${n} tokens`, (n: string) => `${n} jetons`, (n: string) => `${n} 个令牌`],
  templateHint: [
    'Makes a new project with the same tools, lists, labels and tasks. Due dates aren’t copied, and no task is marked done.',
    'Crée un nouveau projet avec les mêmes outils, listes, étiquettes et tâches. Les échéances ne sont pas copiées, et aucune tâche n’est marquée comme terminée.',
    '用相同的工具、列表、标签和任务创建新项目。截止日期不会复制，也没有任务会被标记为已完成。',
  ],
  importHead: ['Import tasks', 'Importer des tâches', '导入任务'],
  importFromCsv: ['From a CSV file', 'Depuis un fichier CSV', '从 CSV 文件导入'],
  importHint: [
    'Export from Jira, Asana, Linear or any spreadsheet as CSV. You’ll choose which column is which before anything is added.',
    'Exportez depuis Jira, Asana, Linear ou un tableur au format CSV. Vous choisirez à quoi correspond chaque colonne avant tout ajout.',
    '从 Jira、Asana、Linear 或任何表格导出为 CSV。添加前你可以选择每一列对应的字段。',
  ],
  chooseFile: ['Choose file', 'Choisir un fichier', '选择文件'],
  importEmpty: ['That file has no rows to import.', 'Ce fichier ne contient aucune ligne à importer.', '该文件没有可导入的行。'],
  importRows: [
    (n: number) => `${n} ${n === 1 ? 'row' : 'rows'} found`,
    (n: number) => `${n} ${n === 1 ? 'ligne trouvée' : 'lignes trouvées'}`,
    (n: number) => `找到 ${n} 行`,
  ],
  importN: [
    (n: number) => `Import ${n} ${n === 1 ? 'task' : 'tasks'}`,
    (n: number) => `Importer ${n} ${n === 1 ? 'tâche' : 'tâches'}`,
    (n: number) => `导入 ${n} 个任务`,
  ],
  importing: [(n: number) => `Importing… ${n}`, (n: number) => `Importation… ${n}`, (n: number) => `正在导入… ${n}`],
  importDone: [
    (n: number) => `${n} ${n === 1 ? 'task' : 'tasks'} imported.`,
    (n: number) => `${n} ${n === 1 ? 'tâche importée' : 'tâches importées'}.`,
    (n: number) => `已导入 ${n} 个任务。`,
  ],
  importStopped: [(n: number) => `Stopped after ${n}.`, (n: number) => `Arrêté après ${n}.`, (n: number) => `在第 ${n} 行后停止。`],
  statusesHint: ['Where each status in the file goes', 'Où va chaque statut du fichier', '文件中每个状态对应的去向'],
  colTitle: ['Title', 'Titre', '标题'],
  colBody: ['Description', 'Description', '描述'],
  colStatus: ['Status', 'Statut', '状态'],
  colAssignee: ['Assignee', 'Responsable', '负责人'],
  colDue: ['Due date', 'Échéance', '截止日期'],
  colPriority: ['Priority', 'Priorité', '优先级'],
  colLabels: ['Labels', 'Étiquettes', '标签'],
  colKey: ['Old key', 'Ancienne clé', '旧编号'],
  colNone: ['—', '—', '—'],
  triageHead: ['Triage', 'Triage', '分诊'],
  triageOn: ['Triage new tasks', 'Trier les nouvelles tâches', '分诊新任务'],
  triageHint: [
    'Tasks from GitHub, chat and agents wait in a Triage list until someone accepts, declines or marks them as duplicates.',
    'Les tâches venues de GitHub, du chat et des agents attendent dans une liste Triage qu’on les accepte, les refuse ou les marque comme doublons.',
    '来自 GitHub、聊天和代理的任务会在「分诊」列表中等待，直到有人接受、拒绝或标为重复。',
  ],
  makeACopy: ['Make a copy', 'Faire une copie', '创建副本'],
  copy: ['Copy', 'Copier', '复制'],
  copyOf: [(name: string) => `${name} copy`, (name: string) => `${name} (copie)`, (name: string) => `${name} 副本`],
  copyMade: [
    (name: string) => `${name} is ready — find it in the sidebar.`,
    (name: string) => `${name} est prêt — retrouvez-le dans la barre latérale.`,
    (name: string) => `${name} 已就绪——可在侧边栏中找到。`,
  ],
  archived: ['Archived', 'Archivé', '已归档'],
  archive: ['Archive', 'Archiver', '归档'],
  archivedHint: [
    'Hidden from the sidebar and project lists. Restore it to keep working in it.',
    'Masqué dans la barre latérale et les listes de projets. Restaurez-le pour continuer à y travailler.',
    '从侧边栏和项目列表中隐藏。恢复后可继续在其中工作。',
  ],
  archiveHint: [
    'Hides it from the sidebar and project lists, and keeps everything in it. Find it under Projects → Archived.',
    'Le masque dans la barre latérale et les listes de projets, et conserve tout son contenu. Retrouvez-le dans Projets → Archivés.',
    '将其从侧边栏和项目列表中隐藏，并保留其中所有内容。可在「项目 → 已归档」中找到。',
  ],
  moveToBin: ['Move to bin', 'Mettre à la corbeille', '移到回收站'],
  binHint: [
    'Removes it from everywhere. You can restore it from Projects → Bin for 30 days, then it’s permanently deleted.',
    'Le retire de partout. Vous pouvez le restaurer depuis Projets → Corbeille pendant 30 jours, puis il est supprimé définitivement.',
    '从所有位置移除。可在 30 天内从「项目 → 回收站」恢复，之后将永久删除。',
  ],

  everything: ['Everything', 'Tout', '全部'],
  readOnly: ['Read only', 'Lecture seule', '只读'],
  /* A role as the server spells it, said as a person would. */
  role: [
    (role: string) => role,
    (role: string) =>
      (({ owner: 'propriétaire', admin: 'administrateur', member: 'membre', guest: 'invité', client: 'client' }) as Record<string, string>)[
        role
      ] ?? role,
    (role: string) =>
      (({ owner: '所有者', admin: '管理员', member: '成员', guest: '访客', client: '客户' }) as Record<string, string>)[role] ?? role,
  ],
  noLongerAMember: ['no longer a member', 'n’est plus membre', '已不是成员'],

  changeColour: ['Change colour', 'Changer la couleur', '更改颜色'],
  changeColourFor: [
    (name: string) => `Change colour for ${name}`,
    (name: string) => `Changer la couleur de ${name}`,
    (name: string) => `更改 ${name} 的颜色`,
  ],
  removeFrom: [
    (n: number) => `Remove from ${n === 1 ? '1 task' : `${n} tasks`}`,
    (n: number) => `Retirer de ${n} ${one(n) ? 'tâche' : 'tâches'}`,
    (n: number) => `从 ${n} 个任务中移除`,
  ],
  labelExists: ['A label with this name already exists.', 'Une étiquette porte déjà ce nom.', '已有同名标签。'],
  colourOf: [(name: string) => `Colour of ${name}`, (name: string) => `Couleur de ${name}`, (name: string) => `${name} 的颜色`],
  move: [(name: string) => `Move ${name}`, (name: string) => `Déplacer ${name}`, (name: string) => `移动 ${name}`],
  dragToReorder: [
    'Drag to reorder, or use the arrow keys',
    'Faites glisser pour réorganiser, ou utilisez les flèches',
    '拖动以重新排序，或使用方向键',
  ],
  changeIconFor: [
    (name: string) => `Change icon for ${name}`,
    (name: string) => `Changer l’icône de ${name}`,
    (name: string) => `更改 ${name} 的图标`,
  ],
  removeNamed: [(name: string) => `Remove ${name}`, (name: string) => `Retirer ${name}`, (name: string) => `移除 ${name}`],
  whereTheyGo: [
    (n: number) => (n === 1 ? 'This list has 1 task. Choose where it goes.' : `This list has ${n} tasks. Choose where they go.`),
    (n: number) =>
      one(n)
        ? `Cette liste contient ${n} tâche. Choisissez où la déplacer.`
        : `Cette liste contient ${n} tâches. Choisissez où les déplacer.`,
    (n: number) => `此列表有 ${n} 个任务。请选择将它们移往何处。`,
  ],
  moveTasksTo: ['Move tasks to', 'Déplacer les tâches vers', '将任务移至'],
  noList: ['No list', 'Sans liste', '无列表'],
})
