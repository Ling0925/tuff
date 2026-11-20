import type { ReactNode } from 'react'
import { say } from '../data/words.js'

/** Connecting an agent — `ui/Connect.tsx`. */
export const CONNECT = say({
  docTitle: ['Connect an agent — Tuff', 'Connecter un agent — Tuff'],
  badLink: [
    'This connection link isn’t valid. Start again from your agent.',
    'Ce lien de connexion n’est pas valide. Recommencez depuis votre agent.',
  ],
  didntWork: ['That didn’t work. Try again.', 'Cela n’a pas fonctionné. Réessayez.'],
  connectAnAgent: ['Connect an agent', 'Connecter un agent'],
  signInFirst: [
    'Sign in to Tuff first, then you’ll come back here to allow it.',
    'Connectez-vous d’abord à Tuff, puis vous reviendrez ici pour l’autoriser.',
  ],
  signIn: ['Sign in', 'Se connecter'],
  connectNamed: [(agent: string) => `Connect ${agent}`, (agent: string) => `Connecter ${agent}`],
  wants: [
    (agent: ReactNode) => <>{agent} wants to work in Tuff as you.</>,
    (agent: ReactNode) => <>{agent} souhaite travailler dans Tuff en votre nom.</>,
  ],
  goesTo: [
    (host: ReactNode) => <>Allowing sends you to {host}. If you don’t know that address, cancel.</>,
    (host: ReactNode) => <>En autorisant, vous serez envoyé vers {host}. Si vous ne connaissez pas cette adresse, annulez.</>,
  ],
  workspace: ['Workspace', 'Espace de travail'],
  canChange: [
    'It can read and change your projects, tasks, docs and chat, the way you can.',
    'Il peut lire et modifier vos projets, tâches, documents et discussions, comme vous.',
  ],
  cantDelete: [
    'It can’t delete anything or change the workspace’s settings.',
    'Il ne peut rien supprimer ni modifier les paramètres de l’espace de travail.',
  ],
  underYourName: [
    'What it does shows under your name. Disconnect it any time under Tokens in your account.',
    'Ce qu’il fait apparaît sous votre nom. Déconnectez-le à tout moment dans Jetons, sous Compte.',
  ],
  /* Signing in as an agent. */
  signInAs: ['Sign in as', 'Se connecter en tant que'],
  you: [(name: string) => `${name} (you)`, (name: string) => `${name} (vous)`],
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
  ],
  agentCanChange: [
    (agent: string) => `It works only in ${agent}’s projects, with ${agent}’s rights.`,
    (agent: string) => `Il travaille seulement dans les projets de ${agent}, avec les droits de ${agent}.`,
  ],
  agentUnderName: [
    (agent: string) => `What it does shows under ${agent}’s name. Disconnect it any time on ${agent}’s page in People & Agents.`,
    (agent: string) =>
      `Ce qu’il fait apparaît sous le nom de ${agent}. Déconnectez-le à tout moment sur la page de ${agent}, dans Personnes et agents.`,
  ],
  allow: ['Allow', 'Autoriser'],
  cancel: ['Cancel', 'Annuler'],
})
