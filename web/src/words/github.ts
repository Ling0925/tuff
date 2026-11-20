import { say } from '../data/words.js'

/** GitHub, in the workspace's settings, a project's and a task — `ui/Github.tsx`. */
export const GITHUB = say({
  head: ['GitHub', 'GitHub'],
  notSetUp: ['GitHub isn’t set up on this server.', 'GitHub n’est pas configuré sur ce serveur.'],
  connect: ['Connect GitHub', 'Connecter GitHub'],
  linkYoursFirst: ['Connect your GitHub', 'Connecter votre GitHub'],
  linkYoursFirstHint: [
    'First your own GitHub, so Tuff can see the installation you make is yours. Then connect the workspace.',
    'D’abord votre propre GitHub, pour que Tuff voie que l’installation que vous faites est la vôtre. Puis connectez l’espace de travail.',
  ],
  connecting: ['Connecting…', 'Connexion…'],
  disconnect: ['Disconnect', 'Déconnecter'],
  connectedTo: [(who: string) => `Connected to ${who}`, (who: string) => `Connecté à ${who}`],
  connectHint: [
    'Pull requests that name a task show on it and move it along.',
    'Les pull requests qui citent une tâche s’affichent dessus et la font avancer.',
  ],
  disconnectHint: [
    'Projects stop hearing from GitHub. The app stays installed on GitHub until you remove it there.',
    'Les projets ne reçoivent plus rien de GitHub. L’application reste installée sur GitHub jusqu’à ce que vous l’y supprimiez.',
  ],
  ownerConnects: [
    'The workspace owner connects GitHub in Settings.',
    'Le propriétaire de l’espace de travail connecte GitHub dans les paramètres.',
  ],

  repository: ['Repository', 'Dépôt'],
  noRepository: ['No repository', 'Aucun dépôt'],
  linkedBy: [
    (who: string) => `Linked by ${who}. Changes from GitHub are made as them.`,
    (who: string) => `Lié par ${who}. Les changements venus de GitHub sont faits en son nom.`,
  ],
  linkHint: [
    'Name a task in a branch or pull request, like RED-12, to link it. “Fixes RED-12” finishes it when merged.',
    'Citez une tâche dans une branche ou une pull request, par exemple RED-12, pour la lier. « Fixes RED-12 » la termine à la fusion.',
  ],
  takenBy: ['Linked to another project', 'Lié à un autre projet'],
  stopped: [
    (who: string) => `Stopped: ${who} can no longer change this project, and GitHub acted as them. Link it again as yourself.`,
    (who: string) => `Arrêté : ${who} ne peut plus modifier ce projet, et GitHub agissait en son nom. Liez-le à nouveau en votre nom.`,
  ],
  relink: ['Link as me', 'Lier en mon nom'],
  syncIssues: ['Keep issues in sync', 'Synchroniser les issues'],
  syncIssuesHint: [
    'Its issues and this project’s tasks become the same, both ways: titles, descriptions, status, people, labels and comments. Open issues are brought in.',
    'Ses issues et les tâches de ce projet deviennent les mêmes, dans les deux sens : titres, descriptions, statut, personnes, étiquettes et commentaires. Les issues ouvertes sont importées.',
  ],
  confirmPublic: [
    (repo: string) => `${repo} is public, and so will be every task and comment in this project. Type ${repo} to confirm.`,
    (repo: string) => `${repo} est public, et chaque tâche et commentaire de ce projet le sera aussi. Saisissez ${repo} pour confirmer.`,
  ],
  unlink: ['Unlink', 'Délier'],

  yours: ['Your GitHub', 'Votre GitHub'],
  linkYours: ['Connect your GitHub', 'Connecter votre GitHub'],
  unlinkYours: ['Disconnect', 'Déconnecter'],
  yoursHint: [
    'So issues assigned to you on GitHub are yours here, and what you write here is written on GitHub as you.',
    'Pour que les issues qui vous sont attribuées sur GitHub soient les vôtres ici, et que ce que vous écrivez ici le soit sur GitHub en votre nom.',
  ],
  yoursAs: [(login: string) => `Connected as @${login}`, (login: string) => `Connecté en tant que @${login}`],
  pulls: ['Pull requests', 'Pull requests'],
  onGithub: ['On GitHub', 'Sur GitHub'],
  issueIn: [(repo: string) => `Issue in ${repo}`, (repo: string) => `Issue dans ${repo}`],
  draft: ['Draft', 'Brouillon'],
  open: ['Open', 'Ouverte'],
  merged: ['Merged', 'Fusionnée'],
  closed: ['Closed', 'Fermée'],
  approved: ['Approved', 'Approuvée'],
  changes: ['Changes requested', 'Modifications demandées'],
  inReview: ['In review', 'En revue'],
  checksPassed: ['Checks passed', 'Vérifications réussies'],
  checksFailed: ['Checks failed', 'Vérifications échouées'],
  checksRunning: ['Checks running', 'Vérifications en cours'],
  closes: ['Closes it', 'La termine'],
  copyBranch: ['Copy branch name', 'Copier le nom de branche'],
  branchCopied: ['Branch name copied', 'Nom de branche copié'],
})
