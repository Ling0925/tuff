import { say } from '../data/words.js'

/** The workspace's settings — `ui/WorkspaceSettings.tsx`: its name and look, the switches, the handover. */
export const WORKSPACE_SETTINGS = say({
  couldNotSave: ['Couldn’t save. Try again.', 'Impossible d’enregistrer. Réessayez.', '保存失败，请重试。'],
  couldNotUpload: ['Couldn’t upload. Try again.', 'Impossible d’importer. Réessayez.', '上传失败，请重试。'],
  workspace: ['Workspace', 'Espace de travail', '工作区'],
  changeIcon: ['Change icon', 'Changer l’icône', '更改图标'],
  workspaceName: ['Workspace name', 'Nom de l’espace de travail', '工作区名称'],
  uploading: ['Uploading…', 'Importation…', '上传中…'],
  changePicture: ['Change picture', 'Changer l’image', '更改图片'],
  uploadPicture: ['Upload picture', 'Importer une image', '上传图片'],
  removePicture: ['Remove picture', 'Retirer l’image', '移除图片'],
  symbol: ['Symbol', 'Symbole', '符号'],
  firstLetter: ['First letter', 'Première lettre', '首字母'],
  colour: ['Colour', 'Couleur', '颜色'],

  creatingProjects: ['Creating projects', 'Création de projets', '创建项目'],
  creatingProjectsHint: [
    'Who can create projects. The owner always can, and you can allow specific people in People & Agents.',
    'Qui peut créer des projets. Le propriétaire le peut toujours, et vous pouvez l’autoriser à certaines personnes dans Personnes et agents.',
    '谁可以创建项目。所有者始终可以，你也可以在「成员与代理」中允许特定成员。',
  ],
  invitingPeople: ['Inviting people', 'Invitation de personnes', '邀请成员'],
  invitingPeopleHint: [
    'Who can invite people to the workspace.',
    'Qui peut inviter des personnes dans l’espace de travail.',
    '谁可以邀请成员加入工作区。',
  ],
  editingOthers: ['Editing what others wrote', 'Modification du contenu des autres', '编辑他人的内容'],
  editingOthersHint: [
    'Whether members can edit documents and task descriptions written by someone else. Messages and comments can only be edited by their author.',
    'Si les membres peuvent modifier les documents et les descriptions de tâches écrits par quelqu’un d’autre. Les messages et les commentaires ne peuvent être modifiés que par leur auteur.',
    '成员是否可以编辑他人编写的文档和任务描述。消息和评论只能由作者本人编辑。',
  ],
  membersPage: ['People & Agents page', 'Page Personnes et agents', '成员与代理页面'],
  membersPageHint: [
    'Who can open People & Agents, with everyone’s work, weeks and hours. Everyone can still assign tasks to anyone and add them to projects.',
    'Qui peut ouvrir Personnes et agents, avec le travail, les semaines et les heures de chacun. Tout le monde peut toujours attribuer des tâches à n’importe qui et ajouter des personnes aux projets.',
    '谁可以打开「成员与代理」，查看每个人的工作、周报和工时。所有人仍然可以向任何人指派任务并将其加入项目。',
  ],
  everyone: ['Everyone', 'Tout le monde', '所有人'],
  onlyTheOwner: ['Only the owner', 'Le propriétaire seulement', '仅所有者'],
  allowed: ['Allowed', 'Autorisé', '允许'],
  notAllowed: ['Not allowed', 'Non autorisé', '不允许'],
  permissions: ['Permissions', 'Autorisations', '权限'],

  owner: ['Owner', 'Propriétaire', '所有者'],
  deleteWorkspace: ['Delete workspace', 'Supprimer l’espace de travail', '删除工作区'],
  deleteWorkspaceEllipsis: ['Delete workspace…', 'Supprimer l’espace de travail…', '删除工作区…'],
  /* Your own server's last owner who can sign in. */
  deleteLastOwner: [
    'This is the last workspace of this server’s only owner. Add another owner in Server settings first.',
    'C’est le dernier espace de travail du seul propriétaire de ce serveur. Ajoutez d’abord un autre propriétaire dans les paramètres du serveur.',
    '这是服务器唯一所有者的最后一个工作区。请先在「服务器设置」中添加另一位所有者。',
  ],
  deleteHint: [
    'For everybody in it, at once. We keep it for 30 days in case you change your mind.',
    'Pour tous ses membres, immédiatement. Nous le gardons 30 jours au cas où vous changeriez d’avis.',
    '对其中所有成员立即生效。我们会保留 30 天，以防你改变主意。',
  ],
  deleteName: [(name: string) => `Delete “${name}”?`, (name: string) => `Supprimer « ${name} » ?`, (name: string) => `删除「${name}」？`],
  deleteWhat: [
    (projects: number, people: number, agents: number) =>
      `${projects} ${projects === 1 ? 'project' : 'projects'} with their tasks, chats and files, for ${people} ${people === 1 ? 'person' : 'people'}${agents ? ` and ${agents} ${agents === 1 ? 'agent' : 'agents'}` : ''}. Everybody loses it at once and is told by email.`,
    (projects: number, people: number, agents: number) =>
      `${projects} ${projects <= 1 ? 'projet' : 'projets'} avec leurs tâches, discussions et fichiers, pour ${people} ${people <= 1 ? 'personne' : 'personnes'}${agents ? ` et ${agents} ${agents <= 1 ? 'agent' : 'agents'}` : ''}. Tout le monde le perd immédiatement et en est prévenu par e-mail.`,
    (projects: number, people: number, agents: number) =>
      `${projects} 个项目及其任务、聊天和文件，涉及 ${people} 人${agents ? `和 ${agents} 个代理` : ''}。所有人会立即失去它，并会收到邮件通知。`,
  ],
  deleteBack: [
    (support: string) => `We keep it for 30 days: to bring it back, write to ${support}. After that it’s gone for good.`,
    (support: string) => `Nous le gardons 30 jours : pour le récupérer, écrivez à ${support}. Ensuite, il disparaît définitivement.`,
    (support: string) => `我们会保留 30 天：如需恢复，请写信至 ${support}。之后将永久删除。`,
  ],
  /* Your own server, whose owner sets how long it is kept (`PURGE_AFTER_DAYS`). */
  deleteBackOwn: [
    'It isn’t gone for good straight away: to bring it back, ask the owner of this server.',
    'Il n’est pas supprimé définitivement tout de suite : pour le récupérer, demandez au propriétaire de ce serveur.',
    '它不会立即永久删除：如需恢复，请联系此服务器的所有者。',
  ],
  typeName: [
    (name: string) => `Type “${name}” to confirm`,
    (name: string) => `Saisissez « ${name} » pour confirmer`,
    (name: string) => `输入「${name}」以确认`,
  ],
  deleting: ['Deleting…', 'Suppression…', '删除中…'],
  deleteGo: ['Delete workspace', 'Supprimer l’espace de travail', '删除工作区'],
  couldNotDelete: [
    'Couldn’t delete the workspace. Try again.',
    'Impossible de supprimer l’espace de travail. Réessayez.',
    '无法删除工作区，请重试。',
  ],
  handOver: ['Hand over the workspace', 'Transférer l’espace de travail', '转让工作区'],
  handOverHint: [
    'Make someone else the owner. You’ll stay as a member, on every project you can open now.',
    'Transférez la propriété à quelqu’un d’autre. Vous resterez membre, sur chaque projet que vous pouvez ouvrir aujourd’hui.',
    '将所有权交给其他人。你将成为成员，保留你现在可以打开的每个项目。',
  ],
  inviteFirst: [
    'Invite someone first. A workspace can only be handed to someone in it.',
    'Invitez d’abord quelqu’un. Un espace de travail ne peut être transféré qu’à l’un de ses membres.',
    '请先邀请成员。工作区只能转让给其中的成员。',
  ],
  handOverEllipsis: ['Hand over…', 'Transférer…', '转让…'],
  wrongPasswordOrCode: [
    'Incorrect password or code. Try again.',
    'Mot de passe ou code incorrect. Réessayez.',
    '密码或验证码不正确，请重试。',
  ],
  codeDidNotMatch: [
    'That code didn’t match. Try again, or email yourself a new one.',
    'Ce code ne correspond pas. Réessayez, ou recevez-en un nouveau par e-mail.',
    '验证码不匹配。请重试，或通过邮件获取新的验证码。',
  ],
  wrongPassword: ['Incorrect password. Try again.', 'Mot de passe incorrect. Réessayez.', '密码不正确，请重试。'],
  tooManyAttempts: [
    'Too many attempts. Wait a few minutes and try again.',
    'Trop de tentatives. Patientez quelques minutes, puis réessayez.',
    '尝试次数过多。请等待几分钟后重试。',
  ],
  couldNotHandOver: ['Couldn’t hand it over. Try again.', 'Impossible de le transférer. Réessayez.', '无法转让，请重试。'],
  handingOver: ['Handing over…', 'Transfert…', '转让中…'],
  makeTheOwner: [
    (name: string | null) => `Make ${name ?? 'them'} the owner`,
    (name: string | null) => (name ? `Transférer à ${name}` : 'Transférer'),
    (name: string | null) => `将所有权转让给 ${name ?? '对方'}`,
  ],
  whatTheyWillDo: [
    'They’ll manage the people and every project. You’ll become a member, and only they can make you the owner again.',
    'Cette personne gérera les personnes et tous les projets. Vous deviendrez membre, et seule elle pourra vous rendre la propriété.',
    '对方将管理成员和所有项目。你将变为成员，只有对方能再次把所有权交给你。',
  ],
  newOwner: ['New owner', 'Nouveau propriétaire', '新所有者'],
  yourPassword: ['Your password', 'Votre mot de passe', '你的密码'],
  password: ['Password', 'Mot de passe', '密码'],
  codeFromAuthenticator: [
    'Code from your authenticator, or a recovery code',
    'Code de votre application d’authentification, ou code de secours',
    '身份验证器中的验证码，或恢复代码',
  ],
  codeFromEmail: ['Code from your email', 'Code reçu par e-mail', '邮件中的验证码'],
})
