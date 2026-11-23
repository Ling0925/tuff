import { say } from '../data/words.js'

/** GitHub, in the workspace's settings, a project's and a task — `ui/Github.tsx`. */
export const GITHUB = say({
  head: ['GitHub', 'GitHub', 'GitHub'],
  notSetUp: ['GitHub isn’t set up on this server.', 'GitHub n’est pas configuré sur ce serveur.', '此服务器未配置 GitHub。'],
  connect: ['Connect GitHub', 'Connecter GitHub', '连接 GitHub'],
  linkYoursFirst: ['Connect your GitHub', 'Connecter votre GitHub', '连接你的 GitHub'],
  linkYoursFirstHint: [
    'First your own GitHub, so Tuff can see the installation you make is yours. Then connect the workspace.',
    'D’abord votre propre GitHub, pour que Tuff voie que l’installation que vous faites est la vôtre. Puis connectez l’espace de travail.',
    '先连接你自己的 GitHub，让 Tuff 确认你创建的安装属于你。然后再连接工作区。',
  ],
  connecting: ['Connecting…', 'Connexion…', '正在连接…'],
  disconnect: ['Disconnect', 'Déconnecter', '断开连接'],
  connectedTo: [(who: string) => `Connected to ${who}`, (who: string) => `Connecté à ${who}`, (who: string) => `已连接到 ${who}`],
  connectHint: [
    'Pull requests that name a task show on it and move it along.',
    'Les pull requests qui citent une tâche s’affichent dessus et la font avancer.',
    '提及任务的 Pull Request 会显示在任务上，并推动任务前进。',
  ],
  disconnectHint: [
    'Projects stop hearing from GitHub. The app stays installed on GitHub until you remove it there.',
    'Les projets ne reçoivent plus rien de GitHub. L’application reste installée sur GitHub jusqu’à ce que vous l’y supprimiez.',
    '项目将不再接收 GitHub 的消息。应用会保留在 GitHub 上，直到你在那里移除它。',
  ],
  ownerConnects: [
    'The workspace owner connects GitHub in Settings.',
    'Le propriétaire de l’espace de travail connecte GitHub dans les paramètres.',
    '工作区所有者可在设置中连接 GitHub。',
  ],

  repository: ['Repository', 'Dépôt', '仓库'],
  noRepository: ['No repository', 'Aucun dépôt', '无仓库'],
  linkedBy: [
    (who: string) => `Linked by ${who}. Changes from GitHub are made as them.`,
    (who: string) => `Lié par ${who}. Les changements venus de GitHub sont faits en son nom.`,
    (who: string) => `由 ${who} 关联。来自 GitHub 的更改以其身份执行。`,
  ],
  linkHint: [
    'Name a task in a branch or pull request, like RED-12, to link it. “Fixes RED-12” finishes it when merged.',
    'Citez une tâche dans une branche ou une pull request, par exemple RED-12, pour la lier. « Fixes RED-12 » la termine à la fusion.',
    '在分支或 Pull Request 中提及任务编号（例如 RED-12）即可关联。「Fixes RED-12」会在合并后完成任务。',
  ],
  takenBy: ['Linked to another project', 'Lié à un autre projet', '已关联到另一个项目'],
  stopped: [
    (who: string) => `Stopped: ${who} can no longer change this project, and GitHub acted as them. Link it again as yourself.`,
    (who: string) => `Arrêté : ${who} ne peut plus modifier ce projet, et GitHub agissait en son nom. Liez-le à nouveau en votre nom.`,
    (who: string) => `已停止：${who} 已无法更改此项目，而 GitHub 以其身份操作。请以你自己的身份重新关联。`,
  ],
  relink: ['Link as me', 'Lier en mon nom', '以我的身份关联'],
  syncIssues: ['Keep issues in sync', 'Synchroniser les issues', '同步议题'],
  syncIssuesHint: [
    'Its issues and this project’s tasks become the same, both ways: titles, descriptions, status, people, labels and comments. Open issues are brought in.',
    'Ses issues et les tâches de ce projet deviennent les mêmes, dans les deux sens : titres, descriptions, statut, personnes, étiquettes et commentaires. Les issues ouvertes sont importées.',
    '其议题与本项目的任务将双向保持一致：标题、描述、状态、成员、标签和评论。开放中的议题会被导入。',
  ],
  confirmPublic: [
    (repo: string) => `${repo} is public, and so will be every task and comment in this project. Type ${repo} to confirm.`,
    (repo: string) => `${repo} est public, et chaque tâche et commentaire de ce projet le sera aussi. Saisissez ${repo} pour confirmer.`,
    (repo: string) => `${repo} 是公开仓库，此项目中的所有任务和评论也将公开。输入 ${repo} 以确认。`,
  ],
  unlink: ['Unlink', 'Délier', '取消关联'],

  yours: ['Your GitHub', 'Votre GitHub', '你的 GitHub'],
  linkYours: ['Connect your GitHub', 'Connecter votre GitHub', '连接你的 GitHub'],
  unlinkYours: ['Disconnect', 'Déconnecter', '断开连接'],
  yoursHint: [
    'So issues assigned to you on GitHub are yours here, and what you write here is written on GitHub as you.',
    'Pour que les issues qui vous sont attribuées sur GitHub soient les vôtres ici, et que ce que vous écrivez ici le soit sur GitHub en votre nom.',
    '这样 GitHub 上指派给你的议题在这里也属于你，你在这里写的内容也会以你的名义写到 GitHub。',
  ],
  yoursAs: [
    (login: string) => `Connected as @${login}`,
    (login: string) => `Connecté en tant que @${login}`,
    (login: string) => `已连接为 @${login}`,
  ],
  pulls: ['Pull requests', 'Pull requests', 'Pull Request'],
  onGithub: ['On GitHub', 'Sur GitHub', '在 GitHub 上'],
  issueIn: [(repo: string) => `Issue in ${repo}`, (repo: string) => `Issue dans ${repo}`, (repo: string) => `${repo} 中的议题`],
  draft: ['Draft', 'Brouillon', '草稿'],
  open: ['Open', 'Ouverte', '开放'],
  merged: ['Merged', 'Fusionnée', '已合并'],
  closed: ['Closed', 'Fermée', '已关闭'],
  approved: ['Approved', 'Approuvée', '已批准'],
  changes: ['Changes requested', 'Modifications demandées', '要求修改'],
  inReview: ['In review', 'En revue', '审核中'],
  checksPassed: ['Checks passed', 'Vérifications réussies', '检查通过'],
  checksFailed: ['Checks failed', 'Vérifications échouées', '检查失败'],
  checksRunning: ['Checks running', 'Vérifications en cours', '检查进行中'],
  closes: ['Closes it', 'La termine', '完成任务'],
  copyBranch: ['Copy branch name', 'Copier le nom de branche', '复制分支名'],
  branchCopied: ['Branch name copied', 'Nom de branche copié', '已复制分支名'],
})
