import { say } from '../data/words.js'

/** Bringing work across from Linear, Jira or Asana, in the workspace's settings — `ui/ImportFrom.tsx`. */
export const IMPORT_FROM = say({
  head: ['Import', 'Importer'],
  linearHint: [
    'Each team becomes a project, with its issues, numbers, statuses, labels, sprints and comments.',
    'Chaque équipe devient un projet, avec ses tickets, leurs numéros, statuts, étiquettes, sprints et commentaires.',
  ],
  jiraHint: [
    'Each project comes with its issues and their numbers, statuses, epics, sub-tasks, sprints, comments and attachments.',
    'Chaque projet arrive avec ses tickets et leurs numéros, statuts, epics, sous-tâches, sprints, commentaires et pièces jointes.',
  ],
  asanaHint: [
    'Each project comes with its sections, tasks, subtasks, tags, comments and attachments.',
    'Chaque projet arrive avec ses sections, tâches, sous-tâches, tags, commentaires et pièces jointes.',
  ],
  linearKey: ['Linear API key', 'Clé d’API Linear'],
  linearWhere: [
    'Make one in Linear → Settings → Security & access. It’s used for this import only and deleted when it ends.',
    'Créez-en une dans Linear → Settings → Security & access. Elle ne sert qu’à cette importation et est supprimée à la fin.',
  ],
  jiraKey: ['Jira site, email and API token', 'Site Jira, e-mail et jeton d’API'],
  jiraWhere: [
    'Make a token at id.atlassian.com → Security → API tokens. It’s used for this import only and deleted when it ends.',
    'Créez un jeton sur id.atlassian.com → Security → API tokens. Il ne sert qu’à cette importation et est supprimé à la fin.',
  ],
  jiraSite: ['Jira site', 'Site Jira'],
  jiraEmail: ['Email', 'E-mail'],
  jiraToken: ['API token', 'Jeton d’API'],
  asanaKey: ['Asana personal access token', 'Jeton d’accès personnel Asana'],
  asanaWhere: [
    'Make one in Asana → My settings → Apps → Developer apps. It’s used for this import only and deleted when it ends.',
    'Créez-en un dans Asana → My settings → Apps → Developer apps. Il ne sert qu’à cette importation et est supprimé à la fin.',
  ],
  findTeams: ['Find teams', 'Trouver les équipes'],
  findProjects: ['Find projects', 'Trouver les projets'],
  issues: [(n: number) => `${n} ${n === 1 ? 'issue' : 'issues'}`, (n: number) => `${n} ${n === 1 ? 'ticket' : 'tickets'}`],
  tasks: [(n: number) => `${n} ${n === 1 ? 'task' : 'tasks'}`, (n: number) => `${n} ${n === 1 ? 'tâche' : 'tâches'}`],
  start: ['Import', 'Importer'],
  running: ['Importing…', 'Importation…'],
  brought: [(n: number) => `${n} brought`, (n: number) => `${n} importés`],
  done: ['Done', 'Terminé'],
  failed: ['Stopped', 'Arrêté'],
  stop: ['Stop import', 'Arrêter l’importation'],
})
