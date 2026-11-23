import type { ReactNode } from 'react'
import { say } from '../data/words.js'

/** Connecting an agent — `ui/Connect.tsx`. */
export const CONNECT = say({
  docTitle: ['Connect an agent — Tuff', 'Connecter un agent — Tuff', '连接代理 — Tuff'],
  badLink: [
    'This connection link isn’t valid. Start again from your agent.',
    'Ce lien de connexion n’est pas valide. Recommencez depuis votre agent.',
    '此连接链接无效。请从你的代理重新开始。',
  ],
  didntWork: ['That didn’t work. Try again.', 'Cela n’a pas fonctionné. Réessayez.', '操作失败，请重试。'],
  connectAnAgent: ['Connect an agent', 'Connecter un agent', '连接代理'],
  signInFirst: [
    'Sign in to Tuff first, then you’ll come back here to allow it.',
    'Connectez-vous d’abord à Tuff, puis vous reviendrez ici pour l’autoriser.',
    '请先登录 Tuff，然后会回到这里进行授权。',
  ],
  signIn: ['Sign in', 'Se connecter', '登录'],
  connectNamed: [(agent: string) => `Connect ${agent}`, (agent: string) => `Connecter ${agent}`, (agent: string) => `连接 ${agent}`],
  wants: [
    (agent: ReactNode) => <>{agent} wants to work in Tuff as you.</>,
    (agent: ReactNode) => <>{agent} souhaite travailler dans Tuff en votre nom.</>,
    (agent: ReactNode) => <>{agent} 想以你的身份在 Tuff 中工作。</>,
  ],
  goesTo: [
    (host: ReactNode) => <>Allowing sends you to {host}. If you don’t know that address, cancel.</>,
    (host: ReactNode) => <>En autorisant, vous serez envoyé vers {host}. Si vous ne connaissez pas cette adresse, annulez.</>,
  ],
  workspace: ['Workspace', 'Espace de travail', '工作区'],
  canChange: [
    'It can read and change your projects, tasks, docs and chat, the way you can.',
    'Il peut lire et modifier vos projets, tâches, documents et discussions, comme vous.',
    '它可以像你一样读取和更改你的项目、任务、文档和聊天。',
  ],
  cantDelete: [
    'It can’t delete anything or change the workspace’s settings.',
    'Il ne peut rien supprimer ni modifier les paramètres de l’espace de travail.',
    '它不能删除任何内容，也不能更改工作区设置。',
  ],
  underYourName: [
    'What it does shows under your name. Disconnect it any time under Tokens in your account.',
    'Ce qu’il fait apparaît sous votre nom. Déconnectez-le à tout moment dans Jetons, sous Compte.',
    '它的操作会显示在你的名字下。你可以随时在账户的「令牌」中断开它。',
  ],
  /* Signing in as an agent. */
  signInAs: ['Sign in as', 'Se connecter en tant que', '登录身份'],
  you: [(name: string) => `${name} (you)`, (name: string) => `${name} (vous)`, (name: string) => `${name}（你）`],
  wantsAs: [
    (client: ReactNode, agent: ReactNode) => (
      <>
        {client} wants to work in Tuff as {agent}.
      </>
    ),
    (client: ReactNode, agent: ReactNode) => (
      <>
        {client} souhaite travailler dans Tuff en tant que {agent}.
      </>
    ),
    (client: ReactNode, agent: ReactNode) => (
      <>
        {client} 想以 {agent} 的身份在 Tuff 中工作。
      </>
    ),
  ],
  agentCanChange: [
    (agent: string) => `It works only in ${agent}’s projects, with ${agent}’s rights.`,
    (agent: string) => `Il travaille seulement dans les projets de ${agent}, avec les droits de ${agent}.`,
    (agent: string) => `它只能在 ${agent} 的项目中、以 ${agent} 的权限工作。`,
  ],
  agentUnderName: [
    (agent: string) => `What it does shows under ${agent}’s name. Disconnect it any time on ${agent}’s page in People & Agents.`,
    (agent: string) =>
      `Ce qu’il fait apparaît sous le nom de ${agent}. Déconnectez-le à tout moment sur la page de ${agent}, dans Personnes et agents.`,
    (agent: string) => `它的操作会显示在 ${agent} 的名字下。你可以随时在「成员与代理」中 ${agent} 的页面上断开它。`,
  ],
  allow: ['Allow', 'Autoriser', '允许'],
  cancel: ['Cancel', 'Annuler', '取消'],
})
