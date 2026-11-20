import { one, say } from '../data/words.js'

/** A task's own screen — `ui/TaskDetail.tsx`. A task is feminine. */
export const TASK_DETAIL = say({
  agentWorking: [(who: string) => `${who} is working on it`, (who: string) => `${who} y travaille`],
  backToTasks: ['Back to Tasks', 'Retour aux tâches'],
  notFound: [
    'Can’t find this task. It may have been deleted, or it’s in a project you’re not a member of.',
    'Tâche introuvable. Elle a peut-être été supprimée, ou elle se trouve dans un projet dont vous n’êtes pas membre.',
  ],
  copiedAsPrompt: ['Copied as prompt', 'Copiée en prompt'],
  couldNotCopy: ['Couldn’t copy. Try again.', 'Impossible de copier. Réessayez.'],
  more: ['More', 'Plus'],
  copyAsPrompt: ['Copy as prompt', 'Copier en prompt'],
  exportPdf: ['Export PDF', 'Exporter en PDF'],
  /* A copy in a project. */
  copyToProject: ['Copy to project…', 'Copier vers un projet…'],
  copyTitle: [(handle: string) => `Copy ${handle} to a project`, (handle: string) => `Copier ${handle} vers un projet`],
  copyThisProject: ['This project', 'Ce projet'],
  copyNowhere: ['There’s no project you can add tasks to.', 'Aucun projet où vous pouvez ajouter des tâches.'],
  copyPick: ['Choose a project to see what the copy will be.', 'Choisissez un projet pour voir ce que sera la copie.'],
  copyHere: ['A copy with its own number, beside the original.', 'Une copie avec son propre numéro, à côté de l’originale.'],
  copyThere: [
    (p: string) => `A copy in ${p}, with its own number. The original stays where it is.`,
    (p: string) => `Une copie dans ${p}, avec son propre numéro. L’originale reste où elle est.`,
  ],
  copyList: [(l: string) => `Goes to ${l}.`, (l: string) => `Elle ira dans ${l}.`],
  copyParts: [
    (n: number) => (n === 1 ? '1 subtask is copied, done or not as it is.' : `${n} subtasks are copied, done or not as they are.`),
    (n: number) =>
      n === 1
        ? '1 sous-tâche est copiée, terminée ou non comme elle l’est.'
        : `${n} sous-tâches sont copiées, terminées ou non comme elles le sont.`,
  ],
  copyFiles: [
    (n: number) => (n === 1 ? '1 file in the description is copied.' : `${n} files in the description are copied.`),
    (n: number) => (n === 1 ? '1 fichier de la description est copié.' : `${n} fichiers de la description sont copiés.`),
  ],
  copyLabels: [(names: string) => `Labels left off: ${names}.`, (names: string) => `Étiquettes non reprises : ${names}.`],
  copyUnassigned: [
    (names: string, p: string) => `Not assigned to ${names}. They aren’t on ${p}.`,
    (names: string, p: string) => `Non attribuée à ${names}. Ils ne sont pas membres de ${p}.`,
  ],
  copyNotCarried: [
    'Comments, history, time and the sprint stay with the original.',
    'Les commentaires, l’historique, le temps et le sprint restent avec l’originale.',
  ],
  copyGithubTo: [
    (p: string) => `It becomes an issue in ${p}’s GitHub repository.`,
    (p: string) => `Elle deviendra un ticket dans le dépôt GitHub de ${p}.`,
  ],
  copy: ['Copy', 'Copier'],
  copying: ['Copying…', 'Copie…'],
  couldntCopy: ['Couldn’t copy the task. Try again.', 'Impossible de copier la tâche. Réessayez.'],
  /* The facts at the head of the PDF. */
  done: ['Done', 'Terminée'],
  assignedTo: [(who: string) => `Assigned to ${who}`, (who: string) => `Attribuée à ${who}`],
  dueOn: [(day: string) => `Due ${day}`, (day: string) => `Échéance le ${day}`],
  noList: ['No list', 'Aucune liste'],
  noOne: ['No one', 'Personne'],
  nLabels: [(n: number) => (n === 1 ? `${n} label` : `${n} labels`), (n: number) => (one(n) ? `${n} étiquette` : `${n} étiquettes`)],
  /* No priority — a priority is feminine. */
  noPriority: ['None', 'Aucune'],
  dueDateOf: [(title: string) => `Due date of ${title}`, (title: string) => `Échéance de ${title}`],
  noHistory: ['No history yet', 'Aucun historique pour l’instant'],
  seeMoreInActivity: ['See more in Activity', 'Voir plus dans Activité'],
  /* No time logged — a time is masculine. */
  noTime: ['None', 'Aucun'],
  removeHours: [(hours: string) => `Remove ${hours}`, (hours: string) => `Retirer ${hours}`],
  dayOfTheTime: ['Date the time was spent', 'Date du temps passé'],
  /* Changing your own entry. */
  changeHours: [(hours: string) => `Change ${hours}`, (hours: string) => `Modifier ${hours}`],
  addNote: ['Add a note', 'Ajouter une note'],
  noteOfTheTime: ['Note', 'Note'],
  /* What AI tools reported spending on it. */
  aiUsage: ['AI usage', 'Utilisation de l’IA'],
  tokens: [(n: string) => `${n} tokens`, (n: string) => `${n} jetons`],
  removeSpend: [(what: string) => `Remove ${what}`, (what: string) => `Retirer ${what}`],
  /* What the pickers on the new sub-task's form name it after: "Priority
     of the new sub-task", "Priorité de la nouvelle sous-tâche". */
  theNewSubTask: ['the new sub-task', 'la nouvelle sous-tâche'],
  triageHead: ['In Triage', 'En triage'],
  triageWaits: ['Nobody has accepted this yet.', 'Personne ne l’a encore acceptée.'],
  triageMarkAs: ['Mark as duplicate', 'Marquer comme doublon'],
  triageAccept: ['Accept', 'Accepter'],
  triageDeclined: ['Declined in Triage.', 'Refusée au triage.'],
  triageDeclinedBecause: [(why: string) => `Declined in Triage: ${why}`, (why: string) => `Refusée au triage : ${why}`],
  triageCanceled: ['Canceled', 'Annulé'],
  triageNotSaid: ['Moved, but the comment couldn’t be added.', 'Déplacée, mais le commentaire n’a pas pu être ajouté.'],
  triageDecline: ['Decline', 'Refuser'],
  triageDuplicate: ['Duplicate', 'Doublon'],
  triageWhy: ['Why (optional)', 'Pourquoi (facultatif)'],
  triageWhichOne: ['Choose the task it repeats', 'Choisissez la tâche qu’elle répète'],
  triageFind: ['Find the task it repeats', 'Trouver la tâche qu’elle répète'],
  triageDuplicateOf: [(of: string) => `Duplicate of ${of}.`, (of: string) => `Doublon de ${of}.`],
  /* What it waits on and what waits on it. */
  blockedBy: ['Blocked by', 'Bloquée par'],
  blocks: ['Blocks', 'Bloque'],
  addBlocker: ['Add a blocker', 'Ajouter une tâche bloquante'],
  findBlocker: ['Find the task it waits on', 'Trouver la tâche attendue'],
  removeBlocker: [(handle: string) => `Remove ${handle}`, (handle: string) => `Retirer ${handle}`],
  blockerLoop: ['That would make a loop: it already waits on this task.', 'Cela créerait une boucle : elle attend déjà cette tâche.'],
  blockerFailed: ['Couldn’t add it. Try again.', 'Impossible de l’ajouter. Réessayez.'],
  noTaskFound: ['No task found.', 'Aucune tâche trouvée.'],
  triageFoldedIn: [
    (it: string) => `${it} was a duplicate of this and was closed.`,
    (it: string) => `${it} était un doublon de cette tâche et a été fermée.`,
  ],
})
