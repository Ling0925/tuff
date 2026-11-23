import { one, say } from '../data/words.js'

/** Inviting people — `ui/InviteDialog.tsx`, and its address chips. */
export const INVITE_DIALOG = say({
  removeEmail: [(email: string) => `Remove ${email}`, (email: string) => `Retirer ${email}`, (email: string) => `移除 ${email}`],
  emailAddresses: ['Email addresses', 'Adresses e-mail', '邮箱地址'],
  emailsExample: [
    'name@company.com, another@company.com',
    'nom@entreprise.com, autre@entreprise.com',
    'name@company.com，another@company.com',
  ],
  notMailed: [
    'the invitation was created, but the email wasn’t sent. Create a link for them instead.',
    'l’invitation a été créée, mais l’e-mail n’a pas été envoyé. Créez plutôt un lien pour cette personne.',
    '邀请已创建，但邮件未发送。请为其创建链接。',
  ],
  notSent: ['not sent', 'non envoyée', '未发送'],
  theLink: ['The link', 'Le lien', '链接'],
  linkNotMade: ['couldn’t be created. Try again.', 'impossible de le créer. Réessayez.', '无法创建，请重试。'],
  refusedLine: [
    (email: string, why: string) => `${email}: ${why}`,
    (email: string, why: string) => `${email} : ${why}`,
    (email: string, why: string) => `${email}：${why}`,
  ],
  invitePeople: ['Invite people', 'Inviter des personnes', '邀请成员'],
  inviteMore: ['Invite more', 'Inviter d’autres personnes', '邀请更多成员'],
  done: ['Done', 'Terminé', '完成'],
  linkInstead: ['Create a link instead', 'Créer plutôt un lien', '改为创建链接'],
  sending: ['Sending…', 'Envoi…', '发送中…'],
  sendMany: [(n: number) => `Send ${n} invitations`, (n: number) => `Envoyer ${n} invitations`, (n: number) => `发送 ${n} 个邀请`],
  sendOne: ['Send invitation', 'Envoyer l’invitation', '发送邀请'],
  sentTo: [(email: string) => `Sent to ${email}.`, (email: string) => `Envoyée à ${email}.`, (email: string) => `已发送至 ${email}。`],
  sentToMany: [
    (n: number) => `Sent to ${n} people.`,
    (n: number) => (one(n) ? `Envoyée à ${n} personne.` : `Envoyées à ${n} personnes.`),
    (n: number) => `已发送给 ${n} 人。`,
  ],
  expires: [
    'Each invitation expires after 7 days. You can cancel it in People & Agents until it’s accepted.',
    'Chaque invitation expire au bout de 7 jours. Vous pouvez l’annuler dans Personnes et agents tant qu’elle n’est pas acceptée.',
    '每个邀请 7 天后过期。在未被接受前，你可以在「成员与代理」中取消。',
  ],
  people: ['People', 'Personnes', '成员'],
  peopleHint: [
    'Each address gets its own email invitation, valid for 7 days.',
    'Chaque adresse reçoit sa propre invitation par e-mail, valable 7 jours.',
    '每个地址会收到单独的邮件邀请，有效期 7 天。',
  ],
  projects: ['Projects', 'Projets', '项目'],
  projectsHint: [
    'If you don’t choose any, they join the workspace and can be added to projects later.',
    'Si vous n’en choisissez aucun, ces personnes rejoignent l’espace de travail et pourront être ajoutées à des projets plus tard.',
    '如果不选择任何项目，他们会加入工作区，之后可再添加到项目。',
  ],
  findProject: ['Find a project', 'Trouver un projet', '查找项目'],
  noProjects: ['No projects yet.', 'Aucun projet pour l’instant.', '还没有项目。'],
  permissions: ['Permissions', 'Autorisations', '权限'],
  permissionsHint: [
    'Only someone who manages these projects can give more than new tasks and channels.',
    'Seule une personne qui gère ces projets peut accorder plus que la création de tâches et de canaux.',
    '只有管理这些项目的人才能授予超过创建任务和频道的权限。',
  ],
  copy: ['Copy', 'Copier', '复制'],
  /* A server of one's own with no mail set up: the invitation's link is
     shown to pass on by hand. */
  byHandTitle: ['This server can’t send email', 'Ce serveur ne peut pas envoyer d’e-mails', '此服务器无法发送邮件'],
  byHandHint: [
    'Copy each link and send it to that person yourself. A link works once, only with that email address, and expires in 7 days.',
    'Copiez chaque lien et envoyez-le vous-même à la personne concernée. Un lien ne fonctionne qu’une fois, uniquement avec cette adresse e-mail, et expire au bout de 7 jours.',
    '请复制每个链接并自行发送给对应的人。链接只能使用一次，仅限该邮箱地址，7 天后过期。',
  ],
  copyLinkFor: [
    (email: string) => `Copy the link for ${email}`,
    (email: string) => `Copier le lien pour ${email}`,
    (email: string) => `复制 ${email} 的链接`,
  ],
})
