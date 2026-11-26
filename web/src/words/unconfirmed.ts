import { say } from '../data/words.js'

/**
 * Workspaces joined before the address was confirmed — `ui/Unconfirmed.tsx`,
 */
export const UNCONFIRMED = say({
  title: ['Check your workspaces', 'Vérifiez vos espaces de travail', '检查你的工作区'],
  body: [
    'Your account joined these workspaces before you confirmed your email. If that wasn’t you, someone else used your account there, and what they posted shows your name.',
    'Votre compte a rejoint ces espaces de travail avant que vous ne confirmiez votre adresse e-mail. Si ce n’était pas vous, quelqu’un d’autre y a utilisé votre compte, et ce qu’il a publié porte votre nom.',
    '你的账户在你确认邮箱之前加入了这些工作区。如果这不是你本人操作，说明有人在那里使用了你的账户，他们发布的内容会显示你的名字。',
  ],
  hint: [
    'Join the ones you know. Leave the others.',
    'Rejoignez ceux que vous connaissez. Quittez les autres.',
    '加入你认识的工作区，退出其他工作区。',
  ],
  join: ['Join', 'Rejoindre', '加入'],
  leave: ['Leave', 'Quitter', '退出'],
  owner: ['You own this workspace.', 'Vous êtes propriétaire de cet espace de travail.', '你拥有此工作区。'],
  couldntSave: ['Couldn’t save. Try again.', 'Impossible d’enregistrer. Réessayez.', '保存失败，请重试。'],
})
