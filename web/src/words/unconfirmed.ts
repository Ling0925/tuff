import { say } from '../data/words.js'

/**
 * Workspaces joined before the address was confirmed — `ui/Unconfirmed.tsx`,
 */
export const UNCONFIRMED = say({
  title: ['Check your workspaces', 'Vérifiez vos espaces de travail'],
  body: [
    'Your account joined these workspaces before you confirmed your email. If that wasn’t you, someone else used your account there, and what they posted shows your name.',
    'Votre compte a rejoint ces espaces de travail avant que vous ne confirmiez votre adresse e-mail. Si ce n’était pas vous, quelqu’un d’autre y a utilisé votre compte, et ce qu’il a publié porte votre nom.',
  ],
  hint: ['Join the ones you know. Leave the others.', 'Rejoignez ceux que vous connaissez. Quittez les autres.'],
  join: ['Join', 'Rejoindre'],
  leave: ['Leave', 'Quitter'],
  owner: ['You own this workspace.', 'Vous êtes propriétaire de cet espace de travail.'],
  couldntSave: ['Couldn’t save. Try again.', 'Impossible d’enregistrer. Réessayez.'],
})
