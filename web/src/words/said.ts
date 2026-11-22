import { say } from '../data/words.js'

/** What an activity event says — `data/said.ts`, for the feed and a task's history. */

/** The same words whatever the thing is called — English does not agree. */
const both = (s: string): readonly [string, string] => [s, s]

/**
 * What somebody did, by the action's own name, with what it was done to
 * coming straight after: "Sam commented on Fix the login", "Sam a commenté
 * Fix the login". Each French line is written so that the object can follow
 * the verb, which is where the screen puts it.
 */
export const DONE = say<Record<string, string>>({
  'project.create': ['created the project', 'a créé le projet'],
  'project.copy': ['created the project as a copy', 'a créé le projet en tant que copie'],
  'project.import': ['imported the project from another tool', 'a importé le projet depuis un autre outil'],
  'cycle.create': ['added a sprint', 'a ajouté un sprint'],
  'project.update': ['changed the project', 'a modifié le projet'],
  'project.icon': ['updated the project’s picture', 'a mis à jour l’image du projet'],
  'project.icon.remove': ['removed the project’s picture', 'a retiré l’image du projet'],
  'project.archive': ['archived the project', 'a archivé le projet'],
  'project.unarchive': ['unarchived the project', 'a désarchivé le projet'],
  'project.github': ['linked a GitHub repository to the project', 'a lié un dépôt GitHub au projet'],
  'github.install': ['connected GitHub', 'a connecté GitHub'],
  'project.slack': ['chose the project’s Slack channel', 'a choisi le canal Slack du projet'],
  'project.feedback.on': ['turned on the project’s feedback page', 'a activé la page de retours du projet'],
  'project.feedback.off': ['turned off the project’s feedback page', 'a désactivé la page de retours du projet'],
  'project.slack.stop': ['stopped posting the project to Slack', 'a arrêté la publication du projet dans Slack'],
  'slack.connect': ['connected Slack', 'a connecté Slack'],
  'slack.disconnect': ['disconnected Slack', 'a déconnecté Slack'],
  'project.member.add': ['added someone to the project', 'a ajouté quelqu’un au projet'],
  'project.member.remove': ['removed someone from the project', 'a retiré quelqu’un du projet'],
  'project.leave': ['left the project', 'a quitté le projet'],
  'project.member.rights': ['changed someone’s permissions', 'a modifié les autorisations de quelqu’un'],
  'task.create': ['created', 'a créé'],
  'task.update': ['changed', 'a modifié'],
  'task.delete': ['deleted', 'a supprimé'],
  /* A copy, and the original it came from. */
  'task.copy': ['copied', 'a copié'],
  'task.copied': ['copied', 'a copié'],
  /* The next one of a series, made when the last was done. */
  'task.repeat': ['made the next one of', 'a créé la suivante de'],
  'task.comment': ['commented on', 'a commenté'],
  'task.comment.edit': ['edited a comment on', 'a modifié un commentaire sur'],
  'task.comment.delete': ['deleted a comment on', 'a supprimé un commentaire sur'],
  /* Undo, after a delete. */
  'task.comment.restore': ['restored a comment on', 'a restauré un commentaire sur'],
  'post.create': ['announced', 'a publié'],
  'post.update': ['edited', 'a modifié'],
  'post.delete': ['deleted', 'a supprimé'],
  'post.restore': ['restored', 'a restauré'],
  'post.comment': ['replied to', 'a répondu à'],
  'post.comment.edit': ['edited a reply to', 'a modifié une réponse à'],
  'post.comment.delete': ['deleted a reply to', 'a supprimé une réponse à'],
  'post.comment.restore': ['restored a reply to', 'a restauré une réponse à'],
  'file.create': ['wrote', 'a rédigé'],
  'file.upload': ['uploaded', 'a importé'],
  'file.update': ['edited', 'a modifié'],
  'file.public': ['shared to the web', 'a rendu public'],
  'file.private': ['stopped sharing to the web', 'a rendu privé'],
  /* Saved as a template, and taken back. */
  'file.template': ['saved as a template', 'a enregistré comme modèle'],
  'file.untemplate': ['stopped using as a template', 'a retiré des modèles'],
  /* Published, and who it is for changed. */
  'file.publish': ['published', 'a publié'],
  'file.access': ['changed who can see', 'a modifié qui peut voir'],
  'file.delete': ['deleted', 'a supprimé'],
  /* Undo, after a delete. */
  'file.restore': ['restored', 'a restauré'],
  /* For good, from Recently Deleted. */
  'file.purge': ['deleted forever', 'a supprimé définitivement'],
  'file.comment': ['commented on', 'a commenté'],
  'file.comment.edit': ['edited a comment on', 'a modifié un commentaire sur'],
  'file.comment.delete': ['deleted a comment on', 'a supprimé un commentaire sur'],
  'file.comment.restore': ['restored a comment on', 'a restauré un commentaire sur'],
  'conversation.create': ['created the channel', 'a créé le canal'],
  'conversation.delete': ['deleted the channel', 'a supprimé le canal'],
  'conversation.restore': ['restored the channel', 'a restauré le canal'],
  'conversation.rename': ['renamed the channel', 'a renommé le canal'],
  'conversation.members': ['changed the members of', 'a modifié les membres de'],
  'conversation.import': ['imported Slack history into', 'a importé l’historique Slack dans'],
  'list.progress': ['updated a list’s progress', 'a mis à jour l’avancement d’une liste'],
  'list.delete': ['deleted a list', 'a supprimé une liste'],
  /* Who takes a list's new tasks. */
  'list.agent': ['changed which agent takes a list’s new tasks', 'a modifié l’agent qui prend les nouvelles tâches d’une liste'],
  'task.import': ['imported tasks from a spreadsheet', 'a importé des tâches depuis un tableur'],
  'time.log': ['logged time', 'a saisi du temps'],
  'time.remove': ['removed logged time', 'a supprimé du temps saisi'],
  'time.edit': ['changed logged time', 'a modifié du temps saisi'],
  'people.role': ['changed someone’s role', 'a modifié le rôle de quelqu’un'],
  'people.rights': ['changed what someone can create', 'a modifié ce que quelqu’un peut créer'],
  'people.remove': ['removed someone', 'a retiré quelqu’un'],
  'people.leave': ['left the workspace', 'a quitté l’espace de travail'],
  'conversation.leave': ['left the channel', 'a quitté le canal'],
})

/** The verb, where one action is several things — `task.update` above all. */
export const VERBS = say({
  moved: ['moved', 'a déplacé'],
  assigned: ['assigned', 'a attribué'],
  /* "a retiré l’attribution de Fix the login à Sam": the task in the
     middle, where French has it. */
  unassigned: ['unassigned', 'a retiré l’attribution de'],
  setDue: ['set the due date on', 'a fixé l’échéance de'],
  clearedDue: ['cleared the due date on', 'a retiré l’échéance de'],
  prioritised: ['prioritised', 'a défini la priorité de'],
  unprioritised: ['removed the priority from', 'a retiré la priorité de'],
  renamed: ['renamed', 'a renommé'],
  finished: ['finished', 'a terminé'],
  reopened: ['reopened', 'a rouvert'],
  scheduled: ['scheduled', 'a planifié'],
  wroteBody: ['edited the description of', 'a modifié la description de'],
  reordered: ['reordered', 'a réordonné'],
  setRepeat: ['set a repeat on', 'a défini la répétition de'],
  clearedRepeat: ['stopped repeating', 'a arrêté la répétition de'],
  labelled: ['labelled', 'a étiqueté'],
  unlabelled: ['removed the labels from', 'a retiré les étiquettes de'],
  loggedTimeOn: ['logged time on', 'a saisi du temps sur'],
  removedTimeFrom: ['removed time from', 'a retiré du temps de'],
  changedTimeOn: ['changed time on', 'a modifié le temps sur'],
  renamedProject: ['renamed the project', 'a renommé le projet'],
  changedTools: ['changed the project’s tools', 'a modifié les outils du projet'],
  wroteProjectBody: ['wrote the project description', 'a rédigé la description du projet'],
  clearedProjectBody: ['cleared the project description', 'a effacé la description du projet'],
  /* An earlier version put back. */
  restoredVersion: ['restored an earlier version of', 'a restauré une version antérieure de'],
})

/**
 * The verb beside the thing itself, where nothing follows it. French puts
 * the pronoun before the verb and agrees with it — `l’a créée` for a task
 * or an announcement, `l’a créé` for a document — so each line is a pair:
 * what it says of a masculine thing, then of a feminine one.
 */
export const ALONE = say<Record<string, readonly [string, string]>>({
  'task.create': [both('created it'), ['l’a créé', 'l’a créée']],
  'task.update': [both('changed it'), ['l’a modifié', 'l’a modifiée']],
  'task.delete': [both('deleted it'), ['l’a supprimé', 'l’a supprimée']],
  'task.copy': [both('made it as a copy'), ['l’a créé en copie', 'l’a créée en copie']],
  'task.copied': [both('copied it'), ['l’a copié', 'l’a copiée']],
  'task.repeat': [both('made it as the next one'), ['l’a créé comme le suivant', 'l’a créée comme la suivante']],
  setRepeat: [both('set it to repeat'), both('a défini la répétition')],
  clearedRepeat: [both('stopped it repeating'), both('a arrêté la répétition')],
  'post.delete': [both('deleted it'), ['l’a supprimé', 'l’a supprimée']],
  'post.restore': [both('restored it'), ['l’a restauré', 'l’a restaurée']],
  'file.delete': [both('deleted it'), ['l’a supprimé', 'l’a supprimée']],
  'file.restore': [both('restored it'), ['l’a restauré', 'l’a restaurée']],
  'file.purge': [both('deleted it forever'), ['l’a supprimé définitivement', 'l’a supprimée définitivement']],
  restoredVersion: [both('restored an earlier version'), both('a restauré une version antérieure')],
  moved: [both('moved it'), ['l’a déplacé', 'l’a déplacée']],
  assigned: [both('assigned it'), ['l’a attribué', 'l’a attribuée']],
  unassigned: [both('unassigned it'), both('a retiré l’attribution')],
  setDue: [both('set its due date'), both('a fixé l’échéance')],
  prioritised: [both('prioritised it'), both('a défini la priorité')],
  renamed: [both('renamed it'), ['l’a renommé', 'l’a renommée']],
  finished: [both('finished it'), ['l’a terminé', 'l’a terminée']],
  reopened: [both('reopened it'), ['l’a rouvert', 'l’a rouverte']],
  scheduled: [both('scheduled it'), ['l’a planifié', 'l’a planifiée']],
  reordered: [both('reordered it'), ['l’a réordonné', 'l’a réordonnée']],
  labelled: [both('labelled it'), ['l’a étiqueté', 'l’a étiquetée']],
  'post.update': [both('edited it'), ['l’a modifié', 'l’a modifiée']],
  'file.update': [both('edited it'), ['l’a modifié', 'l’a modifiée']],
  'post.create': [both('announced it'), ['l’a publié', 'l’a publiée']],
  'file.create': [both('wrote it'), ['l’a rédigé', 'l’a rédigée']],
  'file.upload': [both('uploaded it'), ['l’a importé', 'l’a importée']],
  wroteBody: [both('edited its description'), both('a modifié la description')],
  'task.comment': [both('commented on it'), both('a ajouté un commentaire')],
  'file.comment': [both('commented on it'), both('a ajouté un commentaire')],
  'task.comment.edit': [both('edited a comment on it'), both('a modifié un commentaire')],
  'file.comment.edit': [both('edited a comment on it'), both('a modifié un commentaire')],
  'task.comment.delete': [both('deleted a comment on it'), both('a supprimé un commentaire')],
  'file.comment.delete': [both('deleted a comment on it'), both('a supprimé un commentaire')],
  'task.comment.restore': [both('restored a comment on it'), both('a restauré un commentaire')],
  'file.comment.restore': [both('restored a comment on it'), both('a restauré un commentaire')],
  'post.comment': [both('replied to it'), both('a répondu')],
  'post.comment.edit': [both('edited a reply to it'), both('a modifié une réponse')],
  'post.comment.delete': [both('deleted a reply to it'), both('a supprimé une réponse')],
  'post.comment.restore': [both('restored a reply to it'), both('a restauré une réponse')],
  clearedDue: [both('cleared its due date'), both('a retiré l’échéance')],
  unprioritised: [both('removed its priority'), both('a retiré la priorité')],
  unlabelled: [both('removed its labels'), both('a retiré les étiquettes')],
  loggedTimeOn: [both('logged time on it'), both('a saisi du temps')],
  removedTimeFrom: [both('removed time from it'), both('a retiré du temps')],
  changedTimeOn: [both('changed time on it'), both('a modifié le temps')],
})

/** What a person's role is called in a sentence, as the event kept it. */
const ROLE_FR: Record<string, string> = {
  owner: 'propriétaire',
  admin: 'administrateur',
  member: 'membre',
  guest: 'invité',
  client: 'client',
}

/** The rest of the sentence: what was changed, and to what. */
export const DETAIL = say({
  movedTo: [(to: string) => `to ${to}`, (to: string) => `vers ${to}`],
  /* A copy names the other task by its handle, or the other project as
     "another project" to whoever is not on it. */
  copiedFrom: [(from: string) => `from ${from}`, (from: string) => `depuis ${from}`],
  copiedTo: [(to: string) => `to ${to}`, (to: string) => `vers ${to}`],
  /* A task put under another, or out from under it, by its handle. */
  under: [(parent: string) => `under ${parent}`, (parent: string) => `sous ${parent}`],
  outOf: [(parent: string) => `out of ${parent}`, (parent: string) => `hors de ${parent}`],
  repeatedFrom: [(from: string) => `after ${from}`, (from: string) => `après ${from}`],
  dueFor: [(day: string) => `due ${day}`, (day: string) => `échéance le ${day}`],
  anotherProject: ['another project', 'un autre projet'],
  movedFromTo: [(to: string, from: string) => `to ${to}, from ${from}`, (to: string, from: string) => `de ${from} vers ${to}`],
  givenTo: [(who: string) => `to ${who}`, (who: string) => `à ${who}`],
  takenOff: [(who: string) => `from ${who}`, (who: string) => `à ${who}`],
  dueOn: [(day: string) => `to ${day}`, (day: string) => `au ${day}`],
  priorityAs: [(p: string) => `as ${p}`, (p: string) => `sur ${p}`],
  between: [(from: string, to: string) => `${from} – ${to}`, (from: string, to: string) => `du ${from} au ${to}`],
  startsOn: [(from: string) => from, (from: string) => `à partir du ${from}`],
  until: [(to: string) => `until ${to}`, (to: string) => `jusqu’au ${to}`],
  taskWas: [(was: string) => `from “${was}”`, (was: string) => `(anciennement « ${was} »)`],
  /* Only ever about a task, which is feminine. */
  taskRenamed: ['renamed', 'renommée'],
  renamedTo: [(to: string, was: string) => `to “${to}”, from “${was}”`, (to: string, was: string) => `« ${was} » en « ${to} »`],
  renamedToOnly: [(to: string) => `to “${to}”`, (to: string) => `en « ${to} »`],
  andDescription: ['and the description', 'et la description'],
  andClearedDescription: ['and cleared the description', 'et a effacé la description'],
  labelledAs: [(names: string) => `as ${names}`, (names: string) => `avec ${names}`],
  toolsTo: [(names: string) => `to ${names}`, (names: string) => `(${names})`],
  spent: [(hours: string) => hours, (hours: string) => `(${hours})`],
  /* A changed entry, what it was. */
  wasSpent: [(hours: string) => `was ${hours}`, (hours: string) => `au lieu de ${hours}`],
  roleTo: [(role: string) => `to ${role}`, (role: string) => `en ${ROLE_FR[role] ?? role}`],
})

/** When, and who did it. */
export const SAID = say({
  today: ['Today', 'Aujourd’hui'],
  yesterday: ['Yesterday', 'Hier'],
  /** "Today at 11:30", "12 Oct at 14:05". */
  dayAt: [(day: string, clock: string) => `${day} at ${clock}`, (day: string, clock: string) => `${day} à ${clock}`],
  /** Under a line of a task's history: "Today 11:30". */
  stamp: [(day: string, clock: string) => `${day} ${clock}`, (day: string, clock: string) => `${day} à ${clock}`],
  /** A person's own action, told from one an AI agent took for them with
      their token — Claude, ChatGPT, Cursor. Linear and Notion say "via"
      and the app's name; the name is not kept, so this says what kind. */
  viaAgent: ['via AI agent', 'via un agent IA'],
  /** Beside an agent's own name, as Slack puts APP beside an app's: what it
      wrote is an agent's, and "via" anything would say it twice. */
  agent: ['Agent', 'Agent'],
  /** A change GitHub caused, made as the person who linked the repository. */
  viaGithub: ['via GitHub', 'via GitHub'],
  imported: ['imported', 'importé'],
})
