import { say } from '../data/words.js'

/** The audit log — `ui/AuditLog.tsx`. */
export const AUDIT = say({
  what: ['Who did what in this workspace', 'Qui a fait quoi dans cet espace de travail', '此工作区中谁做了什么'],
  hint: [
    'Sign-ins, people, permissions, settings, deletions and integrations, including actions by connected tools.',
    'Connexions, personnes, autorisations, paramètres, suppressions et intégrations, y compris les actions des outils connectés.',
    '登录、成员、权限、设置、删除和集成，包括已连接工具的操作。',
  ],
  open: ['Open', 'Ouvrir', '打开'],
  back: ['Workspace settings', 'Paramètres de l’espace de travail', '工作区设置'],
  kind: ['Type', 'Type', '类型'],
  person: ['Person', 'Personne', '成员'],
  allKinds: ['All activity', 'Toute l’activité', '所有动态'],
  everyone: ['Everyone', 'Tout le monde', '所有人'],
  formerly: [(name: string) => `${name} (removed)`, (name: string) => `${name} (retiré)`, (name: string) => `${name}（已移除）`],
  types: [
    {
      sign_ins: 'Sign-ins',
      people: 'People',
      rights: 'Permissions',
      settings: 'Settings',
      deletions: 'Deletions',
      integrations: 'Integrations',
    } as Record<string, string>,
    {
      sign_ins: 'Connexions',
      people: 'Personnes',
      rights: 'Autorisations',
      settings: 'Paramètres',
      deletions: 'Suppressions',
      integrations: 'Intégrations',
    } as Record<string, string>,
  ],
  nothing: ['Nothing here yet.', 'Rien pour l’instant.', '这里还没有内容。'],
  nothingNarrowed: ['Nothing matches.', 'Aucun résultat.', '没有匹配项。'],
  more: ['Show more', 'Afficher plus', '显示更多'],
  ownerOnly: [
    'Only the owner can read the audit log.',
    'Seul le propriétaire peut consulter le journal d’audit.',
    '只有所有者可以查看审计日志。',
  ],
  couldNotLoad: [
    'Couldn’t load the audit log. Try again.',
    'Impossible de charger le journal d’audit. Réessayez.',
    '无法加载审计日志，请重试。',
  ],
  viaAgent: ['via AI agent', 'via un agent IA', '通过 AI 代理'],
  viaGithub: ['from GitHub', 'depuis GitHub', '来自 GitHub'],

  /* The lines that are new with this log; the security log's own are in `admin.ts`. */
  removed: [
    (who: string, them: string) => `${who} removed ${them} from the workspace`,
    (who: string, them: string) => `${who} a retiré ${them} de l’espace de travail`,
    (who: string, them: string) => `${who} 将 ${them} 移出了工作区`,
  ],
  rightsChanged: [
    (who: string, them: string) => `${who} changed what ${them} can do in the workspace`,
    (who: string, them: string) => `${who} a modifié ce que ${them} peut faire dans l’espace de travail`,
    (who: string, them: string) => `${who} 更改了 ${them} 在工作区中的权限`,
  ],
  projectRights: [
    (who: string, them: string, project: string) => `${who} changed what ${them} can do on ${project}`,
    (who: string, them: string, project: string) => `${who} a modifié ce que ${them} peut faire sur ${project}`,
    (who: string, them: string, project: string) => `${who} 更改了 ${them} 在 ${project} 中的权限`,
  ],
  addedTo: [
    (who: string, them: string, project: string) => `${who} added ${them} to ${project}`,
    (who: string, them: string, project: string) => `${who} a ajouté ${them} à ${project}`,
    (who: string, them: string, project: string) => `${who} 将 ${them} 加入了 ${project}`,
  ],
  removedFrom: [
    (who: string, them: string, project: string) => `${who} removed ${them} from ${project}`,
    (who: string, them: string, project: string) => `${who} a retiré ${them} de ${project}`,
    (who: string, them: string, project: string) => `${who} 将 ${them} 从 ${project} 移除`,
  ],
  left: [
    (who: string, project: string) => `${who} left ${project}`,
    (who: string, project: string) => `${who} a quitté ${project}`,
    (who: string, project: string) => `${who} 离开了 ${project}`,
  ],
  leftWorkspace: [
    (who: string) => `${who} left the workspace`,
    (who: string) => `${who} a quitté l’espace de travail`,
    (who: string) => `${who} 离开了工作区`,
  ],
  switched: [
    (who: string, what: string, to: string) => `${who} set ${what} to ${to}`,
    (who: string, what: string, to: string) => `${who} a réglé ${what} sur ${to}`,
    (who: string, what: string, to: string) => `${who} 将 ${what} 设为 ${to}`,
  ],
  settingsChanged: [
    (who: string) => `${who} changed the workspace’s settings`,
    (who: string) => `${who} a modifié les paramètres de l’espace de travail`,
    (who: string) => `${who} 修改了工作区设置`,
  ],
  binned: [
    (who: string, project: string) => `${who} deleted ${project}`,
    (who: string, project: string) => `${who} a supprimé ${project}`,
    (who: string, project: string) => `${who} 删除了 ${project}`,
  ],
  restored: [
    (who: string, project: string) => `${who} restored ${project}`,
    (who: string, project: string) => `${who} a restauré ${project}`,
    (who: string, project: string) => `${who} 恢复了 ${project}`,
  ],
  workspaceDeleted: [
    (who: string) => `${who} deleted the workspace`,
    (who: string) => `${who} a supprimé l’espace de travail`,
    (who: string) => `${who} 删除了工作区`,
  ],
  workspaceRestored: ['The workspace was restored', 'L’espace de travail a été restauré', '工作区已恢复'],
  connected: [
    (who: string, what: string) => `${who} connected ${what}`,
    (who: string, what: string) => `${who} a connecté ${what}`,
    (who: string, what: string) => `${who} 连接了 ${what}`,
  ],
  disconnected: [
    (who: string, what: string) => `${who} disconnected ${what}`,
    (who: string, what: string) => `${who} a déconnecté ${what}`,
    (who: string, what: string) => `${who} 断开了 ${what}`,
  ],
  /* Tuff's connector signed in as an agent. */
  linkedAs: [
    (who: string, client: string, agent: string) => `${who} connected ${client} as ${agent}`,
    (who: string, client: string, agent: string) => `${who} a connecté ${client} en tant que ${agent}`,
    (who: string, client: string, agent: string) => `${who} 将 ${client} 连接为 ${agent}`,
  ],
  unlinkedFrom: [
    (who: string, client: string, agent: string) => `${who} disconnected ${client} from ${agent}`,
    (who: string, client: string, agent: string) => `${who} a déconnecté ${client} de ${agent}`,
    (who: string, client: string, agent: string) => `${who} 断开了 ${client} 与 ${agent} 的连接`,
  ],
  webhookAdded: [
    (who: string, host: string) => `${who} added a webhook to ${host}`,
    (who: string, host: string) => `${who} a ajouté un webhook vers ${host}`,
    (who: string, host: string) => `${who} 添加了指向 ${host} 的 Webhook`,
  ],
  webhookRemoved: [
    (who: string, host: string) => `${who} removed a webhook to ${host}`,
    (who: string, host: string) => `${who} a supprimé un webhook vers ${host}`,
    (who: string, host: string) => `${who} 移除了指向 ${host} 的 Webhook`,
  ],
  aWebhook: ['a webhook', 'un webhook', '一个 Webhook'],
  /* Turned off or on, or its events changed. */
  webhookOff: [
    (who: string, host: string) => `${who} turned off a webhook to ${host}`,
    (who: string, host: string) => `${who} a désactivé un webhook vers ${host}`,
    (who: string, host: string) => `${who} 关闭了指向 ${host} 的 Webhook`,
  ],
  /* What happened to a webhook's Authorization header — never the header. */
  webhookKeySet: [
    (who: string, host: string) => `${who} set the Authorization header of a webhook to ${host}`,
    (who: string, host: string) => `${who} a défini l’en-tête Authorization d’un webhook vers ${host}`,
    (who: string, host: string) => `${who} 设置了指向 ${host} 的 Webhook 的 Authorization 请求头`,
  ],
  webhookKeyChanged: [
    (who: string, host: string) => `${who} replaced the Authorization header of a webhook to ${host}`,
    (who: string, host: string) => `${who} a remplacé l’en-tête Authorization d’un webhook vers ${host}`,
    (who: string, host: string) => `${who} 更换了指向 ${host} 的 Webhook 的 Authorization 请求头`,
  ],
  webhookKeyRemoved: [
    (who: string, host: string) => `${who} removed the Authorization header of a webhook to ${host}`,
    (who: string, host: string) => `${who} a retiré l’en-tête Authorization d’un webhook vers ${host}`,
    (who: string, host: string) => `${who} 移除了指向 ${host} 的 Webhook 的 Authorization 请求头`,
  ],
  agentReach: [
    (who: string, what: string) => `${who} changed how ${what} is reached`,
    (who: string, what: string) => `${who} a changé la façon de joindre ${what}`,
    (who: string, what: string) => `${who} 更改了 ${what} 的连接方式`,
  ],
  webhookChanged: [
    (who: string, host: string) => `${who} changed a webhook to ${host}`,
    (who: string, host: string) => `${who} a modifié un webhook vers ${host}`,
    (who: string, host: string) => `${who} 修改了指向 ${host} 的 Webhook`,
  ],
  anAgent: ['an agent', 'un agent', '一个代理'],
  someone: ['someone', 'quelqu’un', '某人'],
  aProject: ['a project', 'un projet', '一个项目'],
})
