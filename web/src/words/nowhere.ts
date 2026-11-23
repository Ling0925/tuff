import { say } from '../data/words.js'

/** A session in no workspace — `ui/Nowhere.tsx`. */
export const NOWHERE = say({
  title: ['No workspaces', 'Aucun espace de travail', '没有工作区'],
  body: ['You’re not in any workspace yet.', 'Vous ne faites encore partie d’aucun espace de travail.', '你还没有加入任何工作区。'],
  create: ['Create workspace', 'Créer un espace de travail', '创建工作区'],
  cantCreate: [
    'Ask someone to invite you to their workspace.',
    'Demandez à quelqu’un de vous inviter dans son espace de travail.',
    '请让某人邀请你加入其工作区。',
  ],
  invited: ['Invitations', 'Invitations', '邀请'],
  join: ['Join', 'Rejoindre', '加入'],
  joining: ['Joining…', 'Connexion…', '正在加入…'],
  couldntJoin: ['Couldn’t join. Try again.', 'Impossible de rejoindre. Réessayez.', '无法加入，请重试。'],
  signedInAs: [
    (email: string) => `Signed in as ${email}`,
    (email: string) => `Connecté en tant que ${email}`,
    (email: string) => `已登录为 ${email}`,
  ],
  signOut: ['Sign out', 'Se déconnecter', '退出登录'],
  deleteAccount: ['Delete account', 'Supprimer le compte', '删除账户'],
})
