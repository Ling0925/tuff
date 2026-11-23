import { say } from '../data/words.js'

/** Bringing work across from Linear, Jira or Asana, in the workspace's settings — `ui/ImportFrom.tsx`. */
export const IMPORT_FROM = say({
  head: ['Import', 'Importer', '导入'],
  linearHint: [
    'Each team becomes a project, with its issues, numbers, statuses, labels, sprints and comments.',
    'Chaque équipe devient un projet, avec ses tickets, leurs numéros, statuts, étiquettes, sprints et commentaires.',
    '每个团队会成为一个项目，包含其议题、编号、状态、标签、迭代和评论。',
  ],
  jiraHint: [
    'Each project comes with its issues and their numbers, statuses, epics, sub-tasks, sprints, comments and attachments.',
    'Chaque projet arrive avec ses tickets et leurs numéros, statuts, epics, sous-tâches, sprints, commentaires et pièces jointes.',
    '每个项目会连同其议题及编号、状态、史诗、子任务、迭代、评论和附件一起导入。',
  ],
  asanaHint: [
    'Each project comes with its sections, tasks, subtasks, tags, comments and attachments.',
    'Chaque projet arrive avec ses sections, tâches, sous-tâches, tags, commentaires et pièces jointes.',
    '每个项目会连同其分区、任务、子任务、标签、评论和附件一起导入。',
  ],
  linearKey: ['Linear API key', 'Clé d’API Linear', 'Linear API 密钥'],
  linearWhere: [
    'Make one in Linear → Settings → Security & access. It’s used for this import only and deleted when it ends.',
    'Créez-en une dans Linear → Settings → Security & access. Elle ne sert qu’à cette importation et est supprimée à la fin.',
    '在 Linear → Settings → Security & access 中创建。仅用于此次导入，结束后删除。',
  ],
  jiraKey: ['Jira site, email and API token', 'Site Jira, e-mail et jeton d’API', 'Jira 站点、邮箱和 API 令牌'],
  jiraWhere: [
    'Make a token at id.atlassian.com → Security → API tokens. It’s used for this import only and deleted when it ends.',
    'Créez un jeton sur id.atlassian.com → Security → API tokens. Il ne sert qu’à cette importation et est supprimé à la fin.',
    '在 id.atlassian.com → Security → API tokens 创建令牌。仅用于此次导入，结束后删除。',
  ],
  jiraSite: ['Jira site', 'Site Jira', 'Jira 站点'],
  jiraEmail: ['Email', 'E-mail', '邮箱'],
  jiraToken: ['API token', 'Jeton d’API', 'API 令牌'],
  asanaKey: ['Asana personal access token', 'Jeton d’accès personnel Asana', 'Asana 个人访问令牌'],
  asanaWhere: [
    'Make one in Asana → My settings → Apps → Developer apps. It’s used for this import only and deleted when it ends.',
    'Créez-en un dans Asana → My settings → Apps → Developer apps. Il ne sert qu’à cette importation et est supprimé à la fin.',
    '在 Asana → My settings → Apps → Developer apps 中创建。仅用于此次导入，结束后删除。',
  ],
  findTeams: ['Find teams', 'Trouver les équipes', '查找团队'],
  findProjects: ['Find projects', 'Trouver les projets', '查找项目'],
  issues: [
    (n: number) => `${n} ${n === 1 ? 'issue' : 'issues'}`,
    (n: number) => `${n} ${n === 1 ? 'ticket' : 'tickets'}`,
    (n: number) => `${n} 个议题`,
  ],
  tasks: [
    (n: number) => `${n} ${n === 1 ? 'task' : 'tasks'}`,
    (n: number) => `${n} ${n === 1 ? 'tâche' : 'tâches'}`,
    (n: number) => `${n} 个任务`,
  ],
  start: ['Import', 'Importer', '导入'],
  running: ['Importing…', 'Importation…', '正在导入…'],
  brought: [(n: number) => `${n} brought`, (n: number) => `${n} importés`, (n: number) => `已导入 ${n} 个`],
  done: ['Done', 'Terminé', '完成'],
  failed: ['Stopped', 'Arrêté', '已停止'],
  stop: ['Stop import', 'Arrêter l’importation', '停止导入'],
})
