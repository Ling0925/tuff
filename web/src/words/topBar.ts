import { one, say } from '../data/words.js'

/* A role by the name a person reads. The English is the role as the server
   says it; the French is the glossary's, in the same lower case. */
const ROLES: Record<string, string> = {
  owner: 'propriétaire',
  admin: 'administrateur',
  member: 'membre',
  guest: 'invité',
  client: 'client',
}

/** The bar across the top, and the workspace menu — `ui/TopBar.tsx`. */
export const TOP_BAR = say({
  themeSystem: ['Theme: follows the system', 'Thème : selon le système', '主题：跟随系统'],
  themeLight: ['Theme: light', 'Thème : clair', '主题：浅色'],
  themeDark: ['Theme: dark', 'Thème : sombre', '主题：深色'],
  back: ['Back', 'Retour', '返回'],
  notifications: ['Notifications', 'Notifications', '通知'],
  unread: [
    (n: number) => `Notifications, ${n} unread`,
    (n: number) => `Notifications, ${n} ${one(n) ? 'non lue' : 'non lues'}`,
    (n: number) => `通知，${n} 条未读`,
  ],
  /* The dot on a workspace's mark. */
  newElsewhere: ['New notifications in another workspace', 'Nouvelles notifications dans un autre espace de travail', '其他工作区有新通知'],
  newThere: ['New notifications', 'Nouvelles notifications', '新通知'],
  yourAccount: ['Your account', 'Votre compte', '你的账户'],
  active: ['Active', 'Actif', '活跃'],
  away: ['Away', 'Absent', '离开'],
  busy: ['Do not disturb', 'Ne pas déranger', '请勿打扰'],
  accountSettings: ['Account settings', 'Paramètres du compte', '账户设置'],
  help: ['Help', 'Aide', '帮助'],
  workspaceSettings: ['Workspace settings', 'Paramètres de l’espace de travail', '工作区设置'],
  role: [
    (r: string | null | undefined) => r,
    (r: string | null | undefined) => (r ? (ROLES[r] ?? r) : r),
    (r: string | null | undefined) => (r ? (ROLES[r] ?? r) : r),
  ],
})
