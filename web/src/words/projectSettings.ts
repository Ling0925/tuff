import { one, say } from '../data/words.js'

/** A project's settings — `ui/ProjectSettings.tsx`. */
export const PROJECT_SETTINGS = say({
  endBeforeStart: ['The end date can’t be before the start date.', 'La date de fin ne peut pas précéder la date de début.'],
  nameOf: [(name: string) => `Name of ${name}`, (name: string) => `Nom de ${name}`],
  startOf: [(name: string) => `Start of ${name}`, (name: string) => `Début de ${name}`],
  endOf: [(name: string) => `End of ${name}`, (name: string) => `Fin de ${name}`],
  tasks: [(n: number) => (n === 1 ? '1 task' : `${n} tasks`), (n: number) => `${n} ${one(n) ? 'tâche' : 'tâches'}`],
  removeKeepTasks: ['Remove, keep tasks', 'Retirer, garder les tâches'],
  couldNotAddSprint: ['Couldn’t add the sprint. Try again.', 'Impossible d’ajouter le sprint. Réessayez.'],
  sprintName: ['Sprint name', 'Nom du sprint'],
  starts: ['Starts', 'Début'],
  sprintStarts: ['Sprint starts', 'Début du sprint'],
  ends: ['Ends', 'Fin'],
  sprintEnds: ['Sprint ends', 'Fin du sprint'],

  changeIcon: ['Change icon', 'Changer l’icône'],
  change: ['Change', 'Changer'],
  uploadPicture: ['Upload picture', 'Importer une image'],
  couldNotUpload: ['Couldn’t upload. Try again.', 'Impossible d’importer. Réessayez.'],
  default: ['Default', 'Par défaut'],

  toolsHint: [
    'Turn off any tools this project doesn’t need. All four are on by default.',
    'Désactivez les outils dont ce projet n’a pas besoin. Les quatre sont activés par défaut.',
  ],
  listsHint: [
    'The stages a task moves through. A task moved into the list with the Finished icon is marked done.',
    'Les étapes par lesquelles passe une tâche. Une tâche déplacée dans la liste à l’icône Terminée est marquée comme terminée.',
  ],
  /* The agent that takes a list's new tasks. */
  listAgentOf: [
    (list: string) => `Agent that takes new tasks in ${list}`,
    (list: string) => `Agent qui prend les nouvelles tâches de ${list}`,
  ],
  listAgentSaid: [
    (name: string) => `New tasks here with no one assigned go to ${name}.`,
    (name: string) => `Les nouvelles tâches de cette liste sans responsable sont attribuées à ${name}.`,
  ],
  listAgentGone: [
    (name: string) => `${name} isn’t on this project anymore, so new tasks here aren’t assigned to anyone.`,
    (name: string) => `${name} ne fait plus partie de ce projet : les nouvelles tâches de cette liste ne sont attribuées à personne.`,
  ],
  theAgent: ['The agent', 'L’agent'],
  labelsHint: [
    'What kind of work a task is. Each project has its own labels, and new projects start with Bug, Feature and Improvement.',
    'Le type de travail d’une tâche. Chaque projet a ses propres étiquettes, et un nouveau projet commence avec Bug, Fonctionnalité et Amélioration.',
  ],
  sprintsHint: [
    'A sprint is a named date range you can add tasks to. Sprints don’t start or end on their own: tasks stay in a sprint after its dates pass, until someone moves them.',
    'Un sprint est une période nommée à laquelle vous pouvez ajouter des tâches. Un sprint ne commence ni ne se termine tout seul : les tâches y restent une fois ses dates passées, jusqu’à ce que quelqu’un les déplace.',
  ],
  peopleHint: [
    'Add people who are already in the workspace; someone new needs an invitation first. Choose what each person can do in this project.',
    'Ajoutez des personnes déjà présentes dans l’espace de travail ; une nouvelle personne doit d’abord être invitée. Choisissez ce que chacun peut faire dans ce projet.',
  ],
  addPeople: ['Add people', 'Ajouter des personnes'],
  everyoneIsHere: ['Everyone in the workspace is here.', 'Tout l’espace de travail est déjà là.'],
  inviteSomeoneNew: ['Invite someone new', 'Inviter une nouvelle personne'],
  hoursHint: [
    'Time logged on this project’s tasks, by person. To log time, open a task.',
    'Le temps saisi sur les tâches de ce projet, par personne. Pour saisir du temps, ouvrez une tâche.',
  ],
  aiUsage: ['AI usage', 'Utilisation de l’IA'],
  aiUsageHint: [
    'Tokens and cost that AI tools reported on this project’s tasks, by person and tool.',
    'Les jetons et le coût signalés par les outils d’IA sur les tâches de ce projet, par personne et par outil.',
  ],
  aiTotal: ['Total', 'Total'],
  tokens: [(n: string) => `${n} tokens`, (n: string) => `${n} jetons`],
  templateHint: [
    'Makes a new project with the same tools, lists, labels and tasks. Due dates aren’t copied, and no task is marked done.',
    'Crée un nouveau projet avec les mêmes outils, listes, étiquettes et tâches. Les échéances ne sont pas copiées, et aucune tâche n’est marquée comme terminée.',
  ],
  importHead: ['Import tasks', 'Importer des tâches'],
  importFromCsv: ['From a CSV file', 'Depuis un fichier CSV'],
  importHint: [
    'Export from Jira, Asana, Linear or any spreadsheet as CSV. You’ll choose which column is which before anything is added.',
    'Exportez depuis Jira, Asana, Linear ou un tableur au format CSV. Vous choisirez à quoi correspond chaque colonne avant tout ajout.',
  ],
  chooseFile: ['Choose file', 'Choisir un fichier'],
  importEmpty: ['That file has no rows to import.', 'Ce fichier ne contient aucune ligne à importer.'],
  importRows: [
    (n: number) => `${n} ${n === 1 ? 'row' : 'rows'} found`,
    (n: number) => `${n} ${n === 1 ? 'ligne trouvée' : 'lignes trouvées'}`,
  ],
  importN: [(n: number) => `Import ${n} ${n === 1 ? 'task' : 'tasks'}`, (n: number) => `Importer ${n} ${n === 1 ? 'tâche' : 'tâches'}`],
  importing: [(n: number) => `Importing… ${n}`, (n: number) => `Importation… ${n}`],
  importDone: [
    (n: number) => `${n} ${n === 1 ? 'task' : 'tasks'} imported.`,
    (n: number) => `${n} ${n === 1 ? 'tâche importée' : 'tâches importées'}.`,
  ],
  importStopped: [(n: number) => `Stopped after ${n}.`, (n: number) => `Arrêté après ${n}.`],
  statusesHint: ['Where each status in the file goes', 'Où va chaque statut du fichier'],
  colTitle: ['Title', 'Titre'],
  colBody: ['Description', 'Description'],
  colStatus: ['Status', 'Statut'],
  colAssignee: ['Assignee', 'Responsable'],
  colDue: ['Due date', 'Échéance'],
  colPriority: ['Priority', 'Priorité'],
  colLabels: ['Labels', 'Étiquettes'],
  colKey: ['Old key', 'Ancienne clé'],
  colNone: ['—', '—'],
  triageHead: ['Triage', 'Triage'],
  triageOn: ['Triage new tasks', 'Trier les nouvelles tâches'],
  triageHint: [
    'Tasks from GitHub, chat and agents wait in a Triage list until someone accepts, declines or marks them as duplicates.',
    'Les tâches venues de GitHub, du chat et des agents attendent dans une liste Triage qu’on les accepte, les refuse ou les marque comme doublons.',
  ],
  makeACopy: ['Make a copy', 'Faire une copie'],
  copy: ['Copy', 'Copier'],
  copyOf: [(name: string) => `${name} copy`, (name: string) => `${name} (copie)`],
  copyMade: [
    (name: string) => `${name} is ready — find it in the sidebar.`,
    (name: string) => `${name} est prêt — retrouvez-le dans la barre latérale.`,
  ],
  archived: ['Archived', 'Archivé'],
  archive: ['Archive', 'Archiver'],
  archivedHint: [
    'Hidden from the sidebar and project lists. Restore it to keep working in it.',
    'Masqué dans la barre latérale et les listes de projets. Restaurez-le pour continuer à y travailler.',
  ],
  archiveHint: [
    'Hides it from the sidebar and project lists, and keeps everything in it. Find it under Projects → Archived.',
    'Le masque dans la barre latérale et les listes de projets, et conserve tout son contenu. Retrouvez-le dans Projets → Archivés.',
  ],
  moveToBin: ['Move to bin', 'Mettre à la corbeille'],
  binHint: [
    'Removes it from everywhere. You can restore it from Projects → Bin for 30 days, then it’s permanently deleted.',
    'Le retire de partout. Vous pouvez le restaurer depuis Projets → Corbeille pendant 30 jours, puis il est supprimé définitivement.',
  ],

  everything: ['Everything', 'Tout'],
  readOnly: ['Read only', 'Lecture seule'],
  /* A role as the server spells it, said as a person would. */
  role: [
    (role: string) => role,
    (role: string) =>
      (({ owner: 'propriétaire', admin: 'administrateur', member: 'membre', guest: 'invité', client: 'client' }) as Record<string, string>)[
        role
      ] ?? role,
  ],
  noLongerAMember: ['no longer a member', 'n’est plus membre'],

  changeColour: ['Change colour', 'Changer la couleur'],
  changeColourFor: [(name: string) => `Change colour for ${name}`, (name: string) => `Changer la couleur de ${name}`],
  removeFrom: [
    (n: number) => `Remove from ${n === 1 ? '1 task' : `${n} tasks`}`,
    (n: number) => `Retirer de ${n} ${one(n) ? 'tâche' : 'tâches'}`,
  ],
  labelExists: ['A label with this name already exists.', 'Une étiquette porte déjà ce nom.'],
  colourOf: [(name: string) => `Colour of ${name}`, (name: string) => `Couleur de ${name}`],
  move: [(name: string) => `Move ${name}`, (name: string) => `Déplacer ${name}`],
  dragToReorder: ['Drag to reorder, or use the arrow keys', 'Faites glisser pour réorganiser, ou utilisez les flèches'],
  changeIconFor: [(name: string) => `Change icon for ${name}`, (name: string) => `Changer l’icône de ${name}`],
  removeNamed: [(name: string) => `Remove ${name}`, (name: string) => `Retirer ${name}`],
  whereTheyGo: [
    (n: number) => (n === 1 ? 'This list has 1 task. Choose where it goes.' : `This list has ${n} tasks. Choose where they go.`),
    (n: number) =>
      one(n)
        ? `Cette liste contient ${n} tâche. Choisissez où la déplacer.`
        : `Cette liste contient ${n} tâches. Choisissez où les déplacer.`,
  ],
  moveTasksTo: ['Move tasks to', 'Déplacer les tâches vers'],
  noList: ['No list', 'Sans liste'],
})
