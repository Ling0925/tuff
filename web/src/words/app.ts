import { one, say } from '../data/words.js'

/* A role by the name a person reads, in the lower case the English has. */
const ROLES: Record<string, string> = {
  owner: 'propriétaire',
  admin: 'administrateur',
  member: 'membre',
  guest: 'invité',
  client: 'client',
}

/** The shell: signing in, the screens it draws itself, a person, the inbox — `ui/App.tsx`. */
export const APP = say({
  /* Signing in. */
  codeDidNotWork: ['That code didn’t work. Try again.', 'Ce code n’a pas fonctionné. Réessayez.', '验证码无效，请重试。'],
  signInExpired: ['Your sign-in expired. Sign in again.', 'Votre connexion a expiré. Reconnectez-vous.', '登录已过期，请重新登录。'],
  wrongPassword: ['Incorrect email or password.', 'Adresse e-mail ou mot de passe incorrect.', '邮箱或密码不正确。'],
  checkEmail: ['Check your email.', 'Consultez vos e-mails.', '请查收邮件。'],
  backToSignIn: ['Back to sign in', 'Retour à la connexion', '返回登录'],
  oneMoreStep: ['One more step.', 'Encore une étape.', '还差一步。'],
  signInToTuff: ['Sign in to Tuff.', 'Connectez-vous à Tuff.', '登录 Tuff。'],
  email: ['Email', 'Adresse e-mail', '邮箱'],
  codeOrRecovery: ['Code from your app, or a recovery code', 'Code de votre application, ou code de secours', '应用中的验证码，或恢复代码'],
  forgot: ['Forgot your password?', 'Mot de passe oublié ?', '忘记密码？'],
  createWorkspace: ['Create a workspace', 'Créer un espace de travail', '创建工作区'],
  /* Removed from a workspace, at the sign-in that follows — `docs/specs/removing-someone.md`. */
  removedFrom: [
    (name: string) => `You were removed from ${name}. Its data has been cleared from this device.`,
    (name: string) => `Vous ne faites plus partie de ${name}. Ses données ont été effacées de cet appareil.`,
    (name: string) => `你已被移出 ${name}，其数据已从本设备清除。`,
  ],
  removedFromIt: [
    'You were removed from the workspace. Its data has been cleared from this device.',
    'Vous ne faites plus partie de l’espace de travail. Ses données ont été effacées de cet appareil.',
    '你已被移出该工作区，其数据已从本设备清除。',
  ],

  /* The shell's own screens. */
  strandedOffline: [
    'You’re offline, and this workspace hasn’t been loaded on this device yet. Reconnect to open it.',
    'Vous êtes hors ligne, et cet espace de travail n’a pas encore été chargé sur cet appareil. Reconnectez-vous pour l’ouvrir.',
    '你处于离线状态，且此工作区尚未加载到本设备。请重新联网后再打开。',
  ],
  workspaceSettings: ['Workspace settings', 'Paramètres de l’espace de travail', '工作区设置'],
  account: ['Account', 'Compte', '账户'],
  more: ['More', 'Plus', '更多'],
  search: ['Search', 'Rechercher', '搜索'],
  /* The place, every room — not a project's tab, which is "Discussion". */
  chat: ['Chat', 'Discussions', '聊天'],
  nothingHere: ['Nothing here.', 'Rien ici.', '这里什么都没有。'],
  archivedBanner: [
    'This project is archived and hidden from the sidebar and lists. Nothing in it was deleted.',
    'Ce projet est archivé et masqué de la barre latérale et des listes. Rien n’y a été supprimé.',
    '该项目已归档，已从侧边栏和列表中隐藏。其中的内容没有被删除。',
  ],
  sample: ['This is a sample project', 'Ceci est un projet d’exemple', '这是一个示例项目'],
  sampleBody: [
    'Look around — nothing in it is real or on anyone. Delete it when you’re done.',
    'Explorez-le — rien n’y est réel ni attribué à quelqu’un. Supprimez-le quand vous aurez terminé.',
    '随便看看——里面没有真实内容，也不属于任何人。看完后可以删除。',
  ],
  deleteSample: ['Delete sample', 'Supprimer l’exemple', '删除示例'],
  projectsBody: [
    'A project keeps its tasks, chat, docs and announcements in one place.',
    'Un projet réunit ses tâches, sa discussion, ses documents et ses annonces au même endroit.',
    '项目把任务、聊天、文档和公告集中在一处。',
  ],
  addedYouBody: [
    'When someone adds you to a project, it appears here.',
    'Quand quelqu’un vous ajoute à un projet, il apparaît ici.',
    '有人把你加入项目后，它会出现在这里。',
  ],

  /* Members. */
  ownerOnlyMembers: [
    'Only the owner can see People & Agents in this workspace.',
    'Dans cet espace de travail, seul le propriétaire peut voir Personnes et agents.',
    '此工作区中只有所有者可以查看「成员与代理」。',
  ],
  invitePeople: ['Invite people', 'Inviter des personnes', '邀请成员'],
  /* The plus at the head of Members, when it does both. */
  inviteOrConnect: ['Invite people or connect an agent', 'Inviter des personnes ou connecter un agent', '邀请成员或连接代理'],
  /* The column's two groups. */
  groupPeople: ['People', 'Personnes', '成员'],
  groupAgents: ['AI Agents', 'Agents IA', 'AI 代理'],
  noOneByThatName: ['No one by that name.', 'Personne ne porte ce nom.', '没有找到这个名字。'],
  /* Lower case: what a search for an invitation without an address is matched against. */
  anyoneWithTheLinkFound: ['anyone with the link', 'toute personne ayant le lien', '持链接的任何人'],
  anyoneWithTheLink: ['Anyone with the link', 'Toute personne ayant le lien', '持链接的任何人'],
  revoke: ['Revoke', 'Révoquer', '撤销'],
  /* Sending an invitation again. */
  resend: ['Resend', 'Renvoyer', '重新发送'],
  copyNewLink: ['Copy new link', 'Copier un nouveau lien', '复制新链接'],
  copyNewLinkHint: [
    'Makes a new link. The old one stops working.',
    'Crée un nouveau lien. L’ancien ne fonctionnera plus.',
    '生成新链接，旧链接将失效。',
  ],
  newLinkCopied: [
    'New link copied. The old one no longer works.',
    'Nouveau lien copié. L’ancien ne fonctionne plus.',
    '已复制新链接，旧链接已失效。',
  ],
  sentAgain: ['Sent again. The old link no longer works.', 'Renvoyée. L’ancien lien ne fonctionne plus.', '已重新发送，旧链接已失效。'],
  couldntSendAgain: [
    'Couldn’t send it again. Try again later.',
    'Impossible de la renvoyer. Réessayez plus tard.',
    '无法重新发送，请稍后再试。',
  ],
  owner: ['Owner', 'Propriétaire', '所有者'],
  member: ['Member', 'Membre', '成员'],
  nProjects: [
    (n: number) => (n === 1 ? `${n} project` : `${n} projects`),
    (n: number) => (one(n) ? `${n} projet` : `${n} projets`),
    (n: number) => `${n} 个项目`,
  ],
  noProjectsYet: ['no projects yet', 'aucun projet pour l’instant', '暂无项目'],
  until: [(day: string) => `until ${day}`, (day: string) => `jusqu’au ${day}`, (day: string) => `直到 ${day}`],
  ownerOnlySettings: [
    'Only the owner can change this workspace’s settings.',
    'Seul le propriétaire peut modifier les paramètres de cet espace de travail.',
    '只有所有者可以修改此工作区的设置。',
  ],

  /* One person. */
  role: [
    (r: string | null | undefined) => r,
    (r: string | null | undefined) => (r ? (ROLES[r] ?? r) : r),
    (r: string | null | undefined) => (r ? (ROLES[r] ?? r) : r),
  ],
  joined: [(day: string) => `joined ${day}`, (day: string) => `membre depuis le ${day}`, (day: string) => `${day} 加入`],
  removeFromWorkspace: ['Remove from the workspace', 'Retirer de l’espace de travail', '从工作区移除'],
  removeName: [(name: string) => `Remove ${name}?`, (name: string) => `Retirer ${name}\u00a0?`, (name: string) => `移除 ${name}？`],
  remove: ['Remove', 'Retirer', '移除'],
  removeSays: [
    'They’ll lose access to this workspace right away and come off their open tasks. Their messages, tasks and files stay. To bring them back, invite them again.',
    'Cette personne perd immédiatement l’accès à cet espace de travail et est retirée de ses tâches en cours. Ses messages, tâches et fichiers restent. Pour la faire revenir, invitez-la à nouveau.',
    '该成员将立即失去此工作区的访问权限，并从正在进行的任务中移除。其消息、任务和文件会保留。如需恢复，请重新邀请。',
  ],
  /* The open links somebody else made, which removal leaves standing —
     offered in the same dialog, `docs/specs/removing-someone.md`. */
  removeLinks: [
    (n: number) => (n === 1 ? 'Also revoke the open invite link' : `Also revoke ${n} open invite links`),
    (n: number) => (one(n) ? 'Révoquer aussi le lien d’invitation ouvert' : `Révoquer aussi les ${n} liens d’invitation ouverts`),
    (n: number) => `同时撤销 ${n} 个邀请链接`,
  ],
  removeLinksSays: [
    'Anyone who has an open link can still use it to join.',
    'Toute personne qui a un lien ouvert peut encore l’utiliser pour rejoindre l’espace de travail.',
    '持有有效链接的人仍可通过链接加入。',
  ],
  nOpen: [(n: number) => `${n} open`, (n: number) => (one(n) ? `${n} ouverte` : `${n} ouvertes`), (n: number) => `${n} 项未完成`],
  nothingOpen: ['Nothing open', 'Aucune tâche ouverte', '没有未完成项'],
  nOverdue: [(n: number) => ` · ${n} overdue`, (n: number) => ` · ${n} en retard`, (n: number) => ` · ${n} 项逾期`],
  couldNotAdd: [
    'Couldn’t add them to that project. Try again.',
    'Impossible d’ajouter cette personne à ce projet. Réessayez.',
    '无法将其加入该项目，请重试。',
  ],
  addToAProject: ['Add to a project', 'Ajouter à un projet', '加入项目'],
  project: ['Project', 'Projet', '项目'],
  may: ['May', 'Peut', '5 月'],
  ordinaryOnly: [
    'They’ll be able to create tasks and channels. Only someone who manages this project can give more.',
    'Cette personne pourra créer des tâches et des canaux. Seule une personne qui gère ce projet peut lui en donner davantage.',
    '该成员可以创建任务和频道。只有管理此项目的人才能授予更多权限。',
  ],
  adding: ['Adding…', 'Ajout…', '正在添加…'],
  addTo: [
    (project: string | undefined) => `Add to ${project ?? 'project'}`,
    (project: string | undefined) => `Ajouter à ${project ?? 'ce projet'}`,
    (project: string | undefined) => `加入 ${project ?? '项目'}`,
  ],
  canCreate: ['Can create', 'Peut créer', '可创建'],
  channels: ['Channels', 'Canaux', '频道'],
  canProjects: ['Can create projects.', 'Peut créer des projets.', '可以创建项目。'],
  cantProjects: ['Can’t create projects.', 'Ne peut pas créer de projets.', '不能创建项目。'],
  canChannels: [
    'Can create workspace channels, and project channels where the project allows it.',
    'Peut créer des canaux dans l’espace de travail, et dans les projets qui l’autorisent.',
    '可以在工作区中创建频道，并在允许的项目中创建项目频道。',
  ],
  cantChannels: [
    'Can’t create channels anywhere, even where a project allows it.',
    'Ne peut créer de canaux nulle part, même là où un projet l’autorise.',
    '无法在任何地方创建频道，即使项目允许。',
  ],
  membersPage: ['People & Agents page', 'Page Personnes et agents', '「成员与代理」页面'],
  canMembers: [
    'Can open People & Agents, with everyone’s work, weeks and hours.',
    'Peut ouvrir Personnes et agents, avec le travail, les semaines et les heures de chacun.',
    '可以打开「成员与代理」，查看每个人的工作、周报和工时。',
  ],
  cantMembers: [
    'Can’t open People & Agents. Can still assign tasks to anyone and add them to projects.',
    'Ne peut pas ouvrir Personnes et agents. Peut tout de même attribuer des tâches à tout le monde et ajouter des personnes aux projets.',
    '无法打开「成员与代理」。仍可向任何人指派任务，并将其加入项目。',
  ],
  canInvite: ['Can invite people to the workspace.', 'Peut inviter des personnes dans l’espace de travail.', '可以邀请成员加入工作区。'],
  cantInvite: [
    'Can’t invite people to the workspace.',
    'Ne peut pas inviter de personnes dans l’espace de travail.',
    '不能邀请成员加入工作区。',
  ],
  connectAgents: ['Connect agents', 'Connecter des agents', '连接代理'],
  canAgents: [
    'Can connect AI agents to their projects.',
    'Peut connecter des agents IA à ses projets.',
    '可以将 AI 代理连接到自己的项目。',
  ],
  cantAgents: ['Can’t connect AI agents.', 'Ne peut pas connecter d’agents IA.', '不能连接 AI 代理。'],
  agents: ['Agents', 'Agents', '代理'],
  agent: ['Agent', 'Agent', '代理'],

  /* What is addressed to you: why it arrived, and when. */
  mentioned: ['mentioned you', 'vous a mentionné', '提到了你'],
  assigned: ['assigned to you', 'vous est attribuée', '指派给你'],
  subscribed: ['new activity', 'nouvelle activité', '新动态'],
  joinedYou: ['accepted your invitation', 'a accepté votre invitation', '接受了你的邀请'],
  posted: ['new announcement', 'nouvelle annonce', '新公告'],
  replied: ['replied in a thread', 'a répondu dans un fil de discussion', '在话题中回复'],
  due: ['due', 'échéance', '到期'],
  added: ['added you to a project', 'vous a ajouté à un projet', '把你加入了项目'],
  shared: ['shared a document with you', 'a partagé un document avec vous', '与你共享了文档'],
  reminder: ['reminder', 'rappel', '提醒'],
  unblocked: ['ready to start', 'prête à commencer', '可以开始了'],
  asked: ['asked you a question', 'vous pose une question', '向你提问'],
  /* The inbox's two views. */
  allNotes: ['All', 'Toutes', '全部'],
  needsYou: ['Needs you', 'En attente de vous', '需要你'],
  nothingNeedsYou: ['Nothing needs you', 'Rien ne vous attend', '没有需要你处理的事项'],
  nothingNeedsYouHint: ['Questions from agents show up here.', 'Les questions des agents s’affichent ici.', '代理的提问会显示在这里。'],
  askedBy: [(who: string) => `${who} asks`, (who: string) => `${who} demande`, (who: string) => `${who} 提问`],
  /* What somebody did, said after their name when the note has no line of
     its own — "Emily Brooks mentioned you". */
  didMention: ['mentioned you', 'vous a mentionné', '提到了你'],
  didAssign: ['assigned you', 'vous a attribué une tâche', '给你指派了任务'],
  didPost: ['posted an announcement', 'a publié une annonce', '发布了公告'],
  didReply: ['replied in a thread', 'a répondu dans un fil de discussion', '在话题中回复'],
  didAdd: ['added you to a project', 'vous a ajouté à un projet', '把你加入了项目'],
  didShare: ['shared a document with you', 'a partagé un document avec vous', '与你共享了文档'],
  didAsk: ['asked you a question', 'vous pose une question', '向你提问'],
  didChange: ['made a change', 'a fait une modification', '做了修改'],
  aConversation: ['A conversation', 'Une conversation', '一个对话'],
  saidBy: [(who: string) => `${who}: `, (who: string) => `${who} : `, (who: string) => `${who}：`],
  justNow: ['now', 'à l’instant', '刚刚'],
  minutesAgo: [(n: number) => `${n}m ago`, (n: number) => `il y a ${n} min`, (n: number) => `${n} 分钟前`],
  hoursAgo: [(n: number) => `${n}h ago`, (n: number) => `il y a ${n} h`, (n: number) => `${n} 小时前`],
  daysAgo: [(n: number) => `${n}d ago`, (n: number) => `il y a ${n} j`, (n: number) => `${n} 天前`],
})
