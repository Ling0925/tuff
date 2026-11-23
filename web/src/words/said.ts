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
  'project.create': ['created the project', 'a créé le projet', '创建了项目'],
  'project.copy': ['created the project as a copy', 'a créé le projet en tant que copie', '以副本形式创建了项目'],
  'project.import': ['imported the project from another tool', 'a importé le projet depuis un autre outil', '从其他工具导入了项目'],
  'cycle.create': ['added a sprint', 'a ajouté un sprint', '添加了迭代'],
  'project.update': ['changed the project', 'a modifié le projet', '更改了项目'],
  'project.icon': ['updated the project’s picture', 'a mis à jour l’image du projet', '更新了项目图标'],
  'project.icon.remove': ['removed the project’s picture', 'a retiré l’image du projet', '移除了项目图标'],
  'project.archive': ['archived the project', 'a archivé le projet', '归档了项目'],
  'project.unarchive': ['unarchived the project', 'a désarchivé le projet', '取消了项目归档'],
  'project.github': ['linked a GitHub repository to the project', 'a lié un dépôt GitHub au projet', '为项目关联了 GitHub 仓库'],
  'github.install': ['connected GitHub', 'a connecté GitHub', '连接了 GitHub'],
  'project.slack': ['chose the project’s Slack channel', 'a choisi le canal Slack du projet', '选择了项目的 Slack 频道'],
  'project.feedback.on': ['turned on the project’s feedback page', 'a activé la page de retours du projet', '开启了项目的反馈页面'],
  'project.feedback.off': ['turned off the project’s feedback page', 'a désactivé la page de retours du projet', '关闭了项目的反馈页面'],
  'project.slack.stop': ['stopped posting the project to Slack', 'a arrêté la publication du projet dans Slack', '停止了向 Slack 发布项目'],
  'slack.connect': ['connected Slack', 'a connecté Slack', '连接了 Slack'],
  'slack.disconnect': ['disconnected Slack', 'a déconnecté Slack', '断开了 Slack'],
  'project.member.add': ['added someone to the project', 'a ajouté quelqu’un au projet', '将某人加入了项目'],
  'project.member.remove': ['removed someone from the project', 'a retiré quelqu’un du projet', '将某人移出了项目'],
  'project.leave': ['left the project', 'a quitté le projet', '离开了项目'],
  'project.member.rights': ['changed someone’s permissions', 'a modifié les autorisations de quelqu’un', '更改了某人的权限'],
  'task.create': ['created', 'a créé', '创建了'],
  'task.update': ['changed', 'a modifié', '更改了'],
  'task.delete': ['deleted', 'a supprimé', '删除了'],
  /* A copy, and the original it came from. */
  'task.copy': ['copied', 'a copié', '复制了'],
  'task.copied': ['copied', 'a copié', '复制了'],
  /* The next one of a series, made when the last was done. */
  'task.repeat': ['made the next one of', 'a créé la suivante de', '创建了下一项'],
  'task.comment': ['commented on', 'a commenté', '评论了'],
  'task.comment.edit': ['edited a comment on', 'a modifié un commentaire sur', '编辑了评论：'],
  'task.comment.delete': ['deleted a comment on', 'a supprimé un commentaire sur', '删除了评论：'],
  /* Undo, after a delete. */
  'task.comment.restore': ['restored a comment on', 'a restauré un commentaire sur', '恢复了评论：'],
  'post.create': ['announced', 'a publié', '发布了'],
  'post.update': ['edited', 'a modifié', '编辑了'],
  'post.delete': ['deleted', 'a supprimé', '删除了'],
  'post.restore': ['restored', 'a restauré', '恢复了'],
  'post.comment': ['replied to', 'a répondu à', '回复了'],
  'post.comment.edit': ['edited a reply to', 'a modifié une réponse à', '编辑了回复：'],
  'post.comment.delete': ['deleted a reply to', 'a supprimé une réponse à', '删除了回复：'],
  'post.comment.restore': ['restored a reply to', 'a restauré une réponse à', '恢复了回复：'],
  'file.create': ['wrote', 'a rédigé', '撰写了'],
  'file.upload': ['uploaded', 'a importé', '上传了'],
  'file.update': ['edited', 'a modifié', '编辑了'],
  'file.public': ['shared to the web', 'a rendu public', '共享到了网络'],
  'file.private': ['stopped sharing to the web', 'a rendu privé', '取消了网络共享'],
  /* Saved as a template, and taken back. */
  'file.template': ['saved as a template', 'a enregistré comme modèle', '保存为模板'],
  'file.untemplate': ['stopped using as a template', 'a retiré des modèles', '取消作为模板'],
  /* The project's instructions for agents. */
  'file.for_agents': ['marked for agents', 'a marqué pour les agents', '标记为供代理使用'],
  'file.not_for_agents': ['stopped marking for agents', 'a retiré la mention pour les agents', '取消供代理使用'],
  /* Published, and who it is for changed. */
  'file.publish': ['published', 'a publié', '发布了'],
  'file.access': ['changed who can see', 'a modifié qui peut voir', '更改了可见范围：'],
  'file.delete': ['deleted', 'a supprimé', '删除了'],
  /* Undo, after a delete. */
  'file.restore': ['restored', 'a restauré', '恢复了'],
  /* For good, from Recently Deleted. */
  'file.purge': ['deleted forever', 'a supprimé définitivement', '永久删除了'],
  'file.comment': ['commented on', 'a commenté', '评论了'],
  'file.comment.edit': ['edited a comment on', 'a modifié un commentaire sur', '编辑了评论：'],
  'file.comment.delete': ['deleted a comment on', 'a supprimé un commentaire sur', '删除了评论：'],
  'file.comment.restore': ['restored a comment on', 'a restauré un commentaire sur', '恢复了评论：'],
  'conversation.create': ['created the channel', 'a créé le canal', '创建了频道'],
  'conversation.delete': ['deleted the channel', 'a supprimé le canal', '删除了频道'],
  'conversation.restore': ['restored the channel', 'a restauré le canal', '恢复了频道'],
  'conversation.rename': ['renamed the channel', 'a renommé le canal', '重命名了频道'],
  'conversation.members': ['changed the members of', 'a modifié les membres de', '更改了成员：'],
  'conversation.import': ['imported Slack history into', 'a importé l’historique Slack dans', '导入了 Slack 历史到'],
  'list.progress': ['updated a list’s progress', 'a mis à jour l’avancement d’une liste', '更新了列表进度'],
  'list.delete': ['deleted a list', 'a supprimé une liste', '删除了列表'],
  /* Who takes a list's new tasks. */
  'list.agent': [
    'changed which agent takes a list’s new tasks',
    'a modifié l’agent qui prend les nouvelles tâches d’une liste',
    '更改了负责列表新任务的代理',
  ],
  'task.import': ['imported tasks from a spreadsheet', 'a importé des tâches depuis un tableur', '从表格导入了任务'],
  'time.log': ['logged time', 'a saisi du temps', '记录了工时'],
  'time.remove': ['removed logged time', 'a supprimé du temps saisi', '移除了记录的工时'],
  'time.edit': ['changed logged time', 'a modifié du temps saisi', '更改了记录的工时'],
  'people.role': ['changed someone’s role', 'a modifié le rôle de quelqu’un', '更改了某人的角色'],
  'people.rights': ['changed what someone can create', 'a modifié ce que quelqu’un peut créer', '更改了某人可创建的内容'],
  'people.remove': ['removed someone', 'a retiré quelqu’un', '移除了某人'],
  'people.leave': ['left the workspace', 'a quitté l’espace de travail', '离开了工作区'],
  'conversation.leave': ['left the channel', 'a quitté le canal', '离开了频道'],
})

/** The verb, where one action is several things — `task.update` above all. */
export const VERBS = say({
  moved: ['moved', 'a déplacé', '移动了'],
  assigned: ['assigned', 'a attribué', '指派了'],
  /* "a retiré l’attribution de Fix the login à Sam": the task in the
     middle, where French has it. */
  unassigned: ['unassigned', 'a retiré l’attribution de', '取消了指派：'],
  setDue: ['set the due date on', 'a fixé l’échéance de', '设置了截止日期：'],
  clearedDue: ['cleared the due date on', 'a retiré l’échéance de', '清除了截止日期：'],
  prioritised: ['prioritised', 'a défini la priorité de', '设置了优先级：'],
  unprioritised: ['removed the priority from', 'a retiré la priorité de', '移除了优先级：'],
  renamed: ['renamed', 'a renommé', '重命名了'],
  finished: ['finished', 'a terminé', '完成了'],
  reopened: ['reopened', 'a rouvert', '重新打开了'],
  scheduled: ['scheduled', 'a planifié', '安排了时间：'],
  wroteBody: ['edited the description of', 'a modifié la description de', '编辑了描述：'],
  reordered: ['reordered', 'a réordonné', '重新排序了'],
  setRepeat: ['set a repeat on', 'a défini la répétition de', '设置了重复：'],
  clearedRepeat: ['stopped repeating', 'a arrêté la répétition de', '取消了重复：'],
  labelled: ['labelled', 'a étiqueté', '添加了标签：'],
  unlabelled: ['removed the labels from', 'a retiré les étiquettes de', '移除了标签：'],
  loggedTimeOn: ['logged time on', 'a saisi du temps sur', '记录了工时：'],
  removedTimeFrom: ['removed time from', 'a retiré du temps de', '移除了工时：'],
  changedTimeOn: ['changed time on', 'a modifié le temps sur', '更改了工时：'],
  renamedProject: ['renamed the project', 'a renommé le projet', '重命名了项目'],
  changedTools: ['changed the project’s tools', 'a modifié les outils du projet', '更改了项目工具'],
  wroteProjectBody: ['wrote the project description', 'a rédigé la description du projet', '撰写了项目描述'],
  clearedProjectBody: ['cleared the project description', 'a effacé la description du projet', '清除了项目描述'],
  /* An earlier version put back. */
  restoredVersion: ['restored an earlier version of', 'a restauré une version antérieure de', '恢复了较早版本：'],
})

/**
 * The verb beside the thing itself, where nothing follows it. French puts
 * the pronoun before the verb and agrees with it — `l’a créée` for a task
 * or an announcement, `l’a créé` for a document — so each line is a pair:
 * what it says of a masculine thing, then of a feminine one.
 */
export const ALONE = say<Record<string, readonly [string, string]>>({
  'task.create': [both('created it'), ['l’a créé', 'l’a créée'], both('创建了它')],
  'task.update': [both('changed it'), ['l’a modifié', 'l’a modifiée'], both('更改了它')],
  'task.delete': [both('deleted it'), ['l’a supprimé', 'l’a supprimée'], both('删除了它')],
  'task.copy': [both('made it as a copy'), ['l’a créé en copie', 'l’a créée en copie'], both('以副本创建了它')],
  'task.copied': [both('copied it'), ['l’a copié', 'l’a copiée'], both('复制了它')],
  'task.repeat': [both('made it as the next one'), ['l’a créé comme le suivant', 'l’a créée comme la suivante'], both('创建了它的下一项')],
  setRepeat: [both('set it to repeat'), both('a défini la répétition'), both('设置为重复')],
  clearedRepeat: [both('stopped it repeating'), both('a arrêté la répétition'), both('取消了重复')],
  'post.delete': [both('deleted it'), ['l’a supprimé', 'l’a supprimée'], both('删除了它')],
  'post.restore': [both('restored it'), ['l’a restauré', 'l’a restaurée'], both('恢复了它')],
  'file.delete': [both('deleted it'), ['l’a supprimé', 'l’a supprimée'], both('删除了它')],
  'file.restore': [both('restored it'), ['l’a restauré', 'l’a restaurée'], both('恢复了它')],
  'file.purge': [both('deleted it forever'), ['l’a supprimé définitivement', 'l’a supprimée définitivement'], both('永久删除了它')],
  restoredVersion: [both('restored an earlier version'), both('a restauré une version antérieure'), both('恢复了较早版本')],
  moved: [both('moved it'), ['l’a déplacé', 'l’a déplacée'], both('移动了它')],
  assigned: [both('assigned it'), ['l’a attribué', 'l’a attribuée'], both('指派了它')],
  unassigned: [both('unassigned it'), both('a retiré l’attribution'), both('取消了它的指派')],
  setDue: [both('set its due date'), both('a fixé l’échéance'), both('设置了它的截止日期')],
  prioritised: [both('prioritised it'), both('a défini la priorité'), both('设置了它的优先级')],
  renamed: [both('renamed it'), ['l’a renommé', 'l’a renommée'], both('重命名了它')],
  finished: [both('finished it'), ['l’a terminé', 'l’a terminée'], both('完成了它')],
  reopened: [both('reopened it'), ['l’a rouvert', 'l’a rouverte'], both('重新打开了它')],
  scheduled: [both('scheduled it'), ['l’a planifié', 'l’a planifiée'], both('安排了它的时间')],
  reordered: [both('reordered it'), ['l’a réordonné', 'l’a réordonnée'], both('重新排序了它')],
  labelled: [both('labelled it'), ['l’a étiqueté', 'l’a étiquetée'], both('添加了它的标签')],
  'post.update': [both('edited it'), ['l’a modifié', 'l’a modifiée'], both('编辑了它')],
  'file.update': [both('edited it'), ['l’a modifié', 'l’a modifiée'], both('编辑了它')],
  'post.create': [both('announced it'), ['l’a publié', 'l’a publiée'], both('发布了它')],
  'file.create': [both('wrote it'), ['l’a rédigé', 'l’a rédigée'], both('撰写了它')],
  'file.upload': [both('uploaded it'), ['l’a importé', 'l’a importée'], both('上传了它')],
  wroteBody: [both('edited its description'), both('a modifié la description'), both('编辑了它的描述')],
  'task.comment': [both('commented on it'), both('a ajouté un commentaire'), both('评论了它')],
  'file.comment': [both('commented on it'), both('a ajouté un commentaire'), both('评论了它')],
  'task.comment.edit': [both('edited a comment on it'), both('a modifié un commentaire'), both('编辑了对它的评论')],
  'file.comment.edit': [both('edited a comment on it'), both('a modifié un commentaire'), both('编辑了对它的评论')],
  'task.comment.delete': [both('deleted a comment on it'), both('a supprimé un commentaire'), both('删除了对它的评论')],
  'file.comment.delete': [both('deleted a comment on it'), both('a supprimé un commentaire'), both('删除了对它的评论')],
  'task.comment.restore': [both('restored a comment on it'), both('a restauré un commentaire'), both('恢复了对它的评论')],
  'file.comment.restore': [both('restored a comment on it'), both('a restauré un commentaire'), both('恢复了对它的评论')],
  'post.comment': [both('replied to it'), both('a répondu'), both('回复了它')],
  'post.comment.edit': [both('edited a reply to it'), both('a modifié une réponse'), both('编辑了对它的回复')],
  'post.comment.delete': [both('deleted a reply to it'), both('a supprimé une réponse'), both('删除了对它的回复')],
  'post.comment.restore': [both('restored a reply to it'), both('a restauré une réponse'), both('恢复了对它的回复')],
  clearedDue: [both('cleared its due date'), both('a retiré l’échéance'), both('清除了它的截止日期')],
  unprioritised: [both('removed its priority'), both('a retiré la priorité'), both('移除了它的优先级')],
  unlabelled: [both('removed its labels'), both('a retiré les étiquettes'), both('移除了它的标签')],
  loggedTimeOn: [both('logged time on it'), both('a saisi du temps'), both('记录了它的工时')],
  removedTimeFrom: [both('removed time from it'), both('a retiré du temps'), both('移除了它的工时')],
  changedTimeOn: [both('changed time on it'), both('a modifié le temps'), both('更改了它的工时')],
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
  movedTo: [(to: string) => `to ${to}`, (to: string) => `vers ${to}`, (to: string) => `至 ${to}`],
  /* A copy names the other task by its handle, or the other project as
     "another project" to whoever is not on it. */
  copiedFrom: [(from: string) => `from ${from}`, (from: string) => `depuis ${from}`, (from: string) => `源自 ${from}`],
  copiedTo: [(to: string) => `to ${to}`, (to: string) => `vers ${to}`, (to: string) => `至 ${to}`],
  /* A task put under another, or out from under it, by its handle. */
  under: [(parent: string) => `under ${parent}`, (parent: string) => `sous ${parent}`, (parent: string) => `位于 ${parent} 下`],
  outOf: [(parent: string) => `out of ${parent}`, (parent: string) => `hors de ${parent}`, (parent: string) => `从 ${parent} 下移出`],
  repeatedFrom: [(from: string) => `after ${from}`, (from: string) => `après ${from}`, (from: string) => `在 ${from} 之后`],
  dueFor: [(day: string) => `due ${day}`, (day: string) => `échéance le ${day}`, (day: string) => `${day} 到期`],
  anotherProject: ['another project', 'un autre projet', '另一个项目'],
  movedFromTo: [
    (to: string, from: string) => `to ${to}, from ${from}`,
    (to: string, from: string) => `de ${from} vers ${to}`,
    (to: string, from: string) => `至 ${to}，原为 ${from}`,
  ],
  givenTo: [(who: string) => `to ${who}`, (who: string) => `à ${who}`, (who: string) => `给 ${who}`],
  takenOff: [(who: string) => `from ${who}`, (who: string) => `à ${who}`, (who: string) => `从 ${who} 移除`],
  dueOn: [(day: string) => `to ${day}`, (day: string) => `au ${day}`, (day: string) => `至 ${day}`],
  priorityAs: [(p: string) => `as ${p}`, (p: string) => `sur ${p}`, (p: string) => `为 ${p}`],
  between: [
    (from: string, to: string) => `${from} – ${to}`,
    (from: string, to: string) => `du ${from} au ${to}`,
    (from: string, to: string) => `${from} – ${to}`,
  ],
  startsOn: [(from: string) => from, (from: string) => `à partir du ${from}`, (from: string) => from],
  until: [(to: string) => `until ${to}`, (to: string) => `jusqu’au ${to}`, (to: string) => `直到 ${to}`],
  taskWas: [(was: string) => `from “${was}”`, (was: string) => `(anciennement « ${was} »)`, (was: string) => `原为「${was}」`],
  /* Only ever about a task, which is feminine. */
  taskRenamed: ['renamed', 'renommée', '已重命名'],
  renamedTo: [
    (to: string, was: string) => `to “${to}”, from “${was}”`,
    (to: string, was: string) => `« ${was} » en « ${to} »`,
    (to: string, was: string) => `改为「${to}」，原为「${was}」`,
  ],
  renamedToOnly: [(to: string) => `to “${to}”`, (to: string) => `en « ${to} »`, (to: string) => `改为「${to}」`],
  andDescription: ['and the description', 'et la description', '以及描述'],
  andClearedDescription: ['and cleared the description', 'et a effacé la description', '并清除了描述'],
  labelledAs: [(names: string) => `as ${names}`, (names: string) => `avec ${names}`, (names: string) => `为 ${names}`],
  toolsTo: [(names: string) => `to ${names}`, (names: string) => `(${names})`, (names: string) => `为 ${names}`],
  spent: [(hours: string) => hours, (hours: string) => `(${hours})`, (hours: string) => hours],
  /* A changed entry, what it was. */
  wasSpent: [(hours: string) => `was ${hours}`, (hours: string) => `au lieu de ${hours}`, (hours: string) => `原为 ${hours}`],
  roleTo: [
    (role: string) => `to ${role}`,
    (role: string) => `en ${ROLE_FR[role] ?? role}`,
    (role: string) =>
      `为 ${({ owner: '所有者', admin: '管理员', member: '成员', guest: '访客', client: '客户' } as Record<string, string>)[role] ?? role}`,
  ],
})

/** When, and who did it. */
export const SAID = say({
  today: ['Today', 'Aujourd’hui', '今天'],
  yesterday: ['Yesterday', 'Hier', '昨天'],
  /** "Today at 11:30", "12 Oct at 14:05". */
  dayAt: [
    (day: string, clock: string) => `${day} at ${clock}`,
    (day: string, clock: string) => `${day} à ${clock}`,
    (day: string, clock: string) => `${day} ${clock}`,
  ],
  /** Under a line of a task's history: "Today 11:30". */
  stamp: [
    (day: string, clock: string) => `${day} ${clock}`,
    (day: string, clock: string) => `${day} à ${clock}`,
    (day: string, clock: string) => `${day} ${clock}`,
  ],
  /** A person's own action, told from one an AI agent took for them with
      their token — Claude, ChatGPT, Cursor. Linear and Notion say "via"
      and the app's name; the name is not kept, so this says what kind. */
  viaAgent: ['via AI agent', 'via un agent IA', '通过 AI 代理'],
  /** Beside an agent's own name, as Slack puts APP beside an app's: what it
      wrote is an agent's, and "via" anything would say it twice. */
  agent: ['Agent', 'Agent', '代理'],
  /** A change GitHub caused, made as the person who linked the repository. */
  viaGithub: ['via GitHub', 'via GitHub', '来自 GitHub'],
  imported: ['imported', 'importé', '已导入'],
})
