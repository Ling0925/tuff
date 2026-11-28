import { one, say } from '../data/words.js'

/** A task's own screen — `ui/TaskDetail.tsx`. A task is feminine. */
export const TASK_DETAIL = say({
  agentWorking: [(who: string) => `${who} is working on it`, (who: string) => `${who} y travaille`, (who: string) => `${who} 正在处理`],
  backToTasks: ['Back to Tasks', 'Retour aux tâches', '返回任务'],
  notFound: [
    'Can’t find this task. It may have been deleted, or it’s in a project you’re not a member of.',
    'Tâche introuvable. Elle a peut-être été supprimée, ou elle se trouve dans un projet dont vous n’êtes pas membre.',
    '找不到此任务。它可能已被删除，或位于你未加入的项目中。',
  ],
  copiedAsPrompt: ['Copied as prompt', 'Copiée en prompt', '已复制为提示词'],
  couldNotCopy: ['Couldn’t copy. Try again.', 'Impossible de copier. Réessayez.', '复制失败，请重试。'],
  more: ['More', 'Plus', '更多'],
  copyAsPrompt: ['Copy as prompt', 'Copier en prompt', '复制为提示词'],
  exportPdf: ['Export PDF', 'Exporter en PDF', '导出 PDF'],
  /* A copy in a project. */
  copyToProject: ['Copy to project…', 'Copier vers un projet…', '复制到项目…'],
  copyTitle: [
    (handle: string) => `Copy ${handle} to a project`,
    (handle: string) => `Copier ${handle} vers un projet`,
    (handle: string) => `将 ${handle} 复制到项目`,
  ],
  copyThisProject: ['This project', 'Ce projet', '此项目'],
  copyNowhere: [
    'There’s no project you can add tasks to.',
    'Aucun projet où vous pouvez ajouter des tâches.',
    '没有你可以添加任务的项目。',
  ],
  copyPick: [
    'Choose a project to see what the copy will be.',
    'Choisissez un projet pour voir ce que sera la copie.',
    '选择项目以查看副本的内容。',
  ],
  copyHere: [
    'A copy with its own number, beside the original.',
    'Une copie avec son propre numéro, à côté de l’originale.',
    '一份带有自己编号的副本，与原任务并列。',
  ],
  copyThere: [
    (p: string) => `A copy in ${p}, with its own number. The original stays where it is.`,
    (p: string) => `Une copie dans ${p}, avec son propre numéro. L’originale reste où elle est.`,
    (p: string) => `在 ${p} 中复制，拥有自己的编号。原任务保持原位。`,
  ],
  copyList: [(l: string) => `Goes to ${l}.`, (l: string) => `Elle ira dans ${l}.`, (l: string) => `将放入 ${l}。`],
  copyParts: [
    (n: number) => (n === 1 ? '1 subtask is copied, done or not as it is.' : `${n} subtasks are copied, done or not as they are.`),
    (n: number) =>
      n === 1
        ? '1 sous-tâche est copiée, terminée ou non comme elle l’est.'
        : `${n} sous-tâches sont copiées, terminées ou non comme elles le sont.`,
    (n: number) => `将复制 ${n} 个子任务，完成状态保持不变。`,
  ],
  copyFiles: [
    (n: number) => (n === 1 ? '1 file in the description is copied.' : `${n} files in the description are copied.`),
    (n: number) => (n === 1 ? '1 fichier de la description est copié.' : `${n} fichiers de la description sont copiés.`),
    (n: number) => `描述中的 ${n} 个文件将被复制。`,
  ],
  copyLabels: [
    (names: string) => `Labels left off: ${names}.`,
    (names: string) => `Étiquettes non reprises : ${names}.`,
    (names: string) => `未复制的标签：${names}。`,
  ],
  copyUnassigned: [
    (names: string, p: string) => `Not assigned to ${names}. They aren’t on ${p}.`,
    (names: string, p: string) => `Non attribuée à ${names}. Ils ne sont pas membres de ${p}.`,
    (names: string, p: string) => `未指派给 ${names}。他们不在 ${p} 中。`,
  ],
  copyNotCarried: [
    'Comments, history, time and the sprint stay with the original.',
    'Les commentaires, l’historique, le temps et le sprint restent avec l’originale.',
    '评论、历史、工时和迭代仍保留在原任务上。',
  ],
  copyGithubTo: [
    (p: string) => `It becomes an issue in ${p}’s GitHub repository.`,
    (p: string) => `Elle deviendra un ticket dans le dépôt GitHub de ${p}.`,
    (p: string) => `它将成为 ${p} 的 GitHub 仓库中的一个议题。`,
  ],
  copy: ['Copy', 'Copier', '复制'],
  copying: ['Copying…', 'Copie…', '复制中…'],
  couldntCopy: ['Couldn’t copy the task. Try again.', 'Impossible de copier la tâche. Réessayez.', '无法复制任务，请重试。'],
  /* The task itself in another project. */
  moveTitle: ['Move to project…', 'Déplacer vers un projet…', '移动到项目…'],
  moveManyTitle: [
    (n: number) => `Move ${n} tasks to a project`,
    (n: number) => `Déplacer ${n} tâches vers un projet`,
    (n: number) => `移动 ${n} 个任务到项目`,
  ],
  moveThere: [
    (p: string) => `The task itself moves to ${p}.`,
    (p: string) => `La tâche elle-même est déplacée vers ${p}.`,
    (p: string) => `任务本身将移动到 ${p}。`,
  ],
  moveComments: [
    (n: number) => `${n === 1 ? '1 comment moves' : `${n} comments move`} with it.`,
    (n: number) => (n === 1 ? '1 commentaire la suit.' : `${n} commentaires la suivent.`),
    (n: number) => `${n} 条评论将一起移动。`,
  ],
  moveParts: [
    (n: number) => (n === 1 ? '1 subtask moves with it, whether done or not.' : `${n} subtasks move with it, whether done or not.`),
    (n: number) => (n === 1 ? '1 sous-tâche la suit, terminée ou non.' : `${n} sous-tâches la suivent, terminées ou non.`),
    (n: number) => `${n} 个子任务将一起移动，完成状态保持不变。`,
  ],
  moveNotCarried: [
    'Its sprint and repeating chain stay behind.',
    'Son sprint et sa chaîne de répétition restent en arrière.',
    '它的迭代和重复链不会随迁。',
  ],
  move: ['Move', 'Déplacer', '移动'],
  moving: ['Moving…', 'Déplacement…', '移动中…'],
  couldntMove: ['Couldn’t move the task. Try again.', 'Impossible de déplacer la tâche. Réessayez.', '无法移动任务，请重试。'],
  moveNowhere: [
    'There is no other project you can move tasks into.',
    'Aucun autre projet ne vous permet d’y déplacer des tâches.',
    '没有其他你有权限移入任务的项目。',
  ],
  movePick: ['Choose the project it is moving to.', 'Choisissez le projet de destination.', '选择要移动到的项目。'],
  moveReading: ['Reading what will move…', 'Lecture de ce qui sera déplacé…', '正在读取移动后的内容…'],
  moveSameStatus: ['Same status', 'Même statut', '相同状态'],
  moveStatusCreated: [
    (l: string) => `Goes to ${l}, which will be copied there too.`,
    (l: string) => `Elle ira dans ${l}, qui sera copié dans le projet.`,
    (l: string) => `将放入 ${l}，该状态也会一并复制。`,
  ],
  moveLabelsCreated: [
    (names: string) => `Labels copied there: ${names}.`,
    (names: string) => `Étiquettes copiées dans le projet : ${names}.`,
    (names: string) => `将复制到项目中的标签：${names}。`,
  ],
  /* The facts at the head of the PDF. */
  done: ['Done', 'Terminée', '已完成'],
  assignedTo: [(who: string) => `Assigned to ${who}`, (who: string) => `Attribuée à ${who}`, (who: string) => `已指派给 ${who}`],
  dueOn: [(day: string) => `Due ${day}`, (day: string) => `Échéance le ${day}`, (day: string) => `${day} 到期`],
  noList: ['No list', 'Aucune liste', '无列表'],
  noOne: ['No one', 'Personne', '无人'],
  nLabels: [
    (n: number) => (n === 1 ? `${n} label` : `${n} labels`),
    (n: number) => (one(n) ? `${n} étiquette` : `${n} étiquettes`),
    (n: number) => `${n} 个标签`,
  ],
  /* No priority — a priority is feminine. */
  noPriority: ['None', 'Aucune', '无'],
  dueDateOf: [
    (title: string) => `Due date of ${title}`,
    (title: string) => `Échéance de ${title}`,
    (title: string) => `${title} 的截止日期`,
  ],
  noHistory: ['No history yet', 'Aucun historique pour l’instant', '还没有历史记录'],
  seeMoreInActivity: ['See more in Activity', 'Voir plus dans Activité', '在「动态」中查看更多'],
  /* No time logged — a time is masculine. */
  noTime: ['None', 'Aucun', '无'],
  removeHours: [(hours: string) => `Remove ${hours}`, (hours: string) => `Retirer ${hours}`, (hours: string) => `移除 ${hours}`],
  dayOfTheTime: ['Date the time was spent', 'Date du temps passé', '工时日期'],
  /* Changing your own entry. */
  changeHours: [(hours: string) => `Change ${hours}`, (hours: string) => `Modifier ${hours}`, (hours: string) => `修改 ${hours}`],
  addNote: ['Add a note', 'Ajouter une note', '添加备注'],
  noteOfTheTime: ['Note', 'Note', '备注'],
  /* What AI tools reported spending on it. */
  aiUsage: ['AI usage', 'Utilisation de l’IA', 'AI 用量'],
  tokens: [(n: string) => `${n} tokens`, (n: string) => `${n} jetons`, (n: string) => `${n} 个令牌`],
  removeSpend: [(what: string) => `Remove ${what}`, (what: string) => `Retirer ${what}`, (what: string) => `移除 ${what}`],
  /* What the pickers on the new sub-task's form name it after: "Priority
     of the new sub-task", "Priorité de la nouvelle sous-tâche". */
  theNewSubTask: ['the new sub-task', 'la nouvelle sous-tâche', '新的子任务'],
  triageHead: ['In Triage', 'En triage', '待分诊'],
  triageWaits: ['Nobody has accepted this yet.', 'Personne ne l’a encore acceptée.', '还没有人接受。'],
  triageMarkAs: ['Mark as duplicate', 'Marquer comme doublon', '标为重复'],
  triageAccept: ['Accept', 'Accepter', '接受'],
  triageDeclined: ['Declined in Triage.', 'Refusée au triage.', '已在分诊中拒绝。'],
  triageDeclinedBecause: [
    (why: string) => `Declined in Triage: ${why}`,
    (why: string) => `Refusée au triage : ${why}`,
    (why: string) => `已在分诊中拒绝：${why}`,
  ],
  triageCanceled: ['Canceled', 'Annulé', '已取消'],
  triageNotSaid: [
    'Moved, but the comment couldn’t be added.',
    'Déplacée, mais le commentaire n’a pas pu être ajouté.',
    '已移动，但评论未能添加。',
  ],
  triageDecline: ['Decline', 'Refuser', '拒绝'],
  triageDuplicate: ['Duplicate', 'Doublon', '重复'],
  triageWhy: ['Why (optional)', 'Pourquoi (facultatif)', '原因（可选）'],
  triageWhichOne: ['Choose the task it repeats', 'Choisissez la tâche qu’elle répète', '选择它重复的任务'],
  triageFind: ['Find the task it repeats', 'Trouver la tâche qu’elle répète', '查找它重复的任务'],
  triageDuplicateOf: [(of: string) => `Duplicate of ${of}.`, (of: string) => `Doublon de ${of}.`, (of: string) => `${of} 的重复项。`],
  /* What it waits on and what waits on it. */
  blockedBy: ['Blocked by', 'Bloquée par', '被阻塞于'],
  blocks: ['Blocks', 'Bloque', '阻塞'],
  addBlocker: ['Add a blocker', 'Ajouter une tâche bloquante', '添加阻塞任务'],
  findBlocker: ['Find the task it waits on', 'Trouver la tâche attendue', '查找它等待的任务'],
  removeBlocker: [(handle: string) => `Remove ${handle}`, (handle: string) => `Retirer ${handle}`, (handle: string) => `移除 ${handle}`],
  blockerLoop: [
    'That would make a loop: it already waits on this task.',
    'Cela créerait une boucle : elle attend déjà cette tâche.',
    '这会造成循环：它已经在等待此任务。',
  ],
  blockerFailed: ['Couldn’t add it. Try again.', 'Impossible de l’ajouter. Réessayez.', '无法添加，请重试。'],
  noTaskFound: ['No task found.', 'Aucune tâche trouvée.', '未找到任务。'],
  triageFoldedIn: [
    (it: string) => `${it} was a duplicate of this and was closed.`,
    (it: string) => `${it} était un doublon de cette tâche et a été fermée.`,
    (it: string) => `${it} 与它重复，已关闭。`,
  ],
})
