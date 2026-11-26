import { say } from '../data/words.js'

/** Following an invitation — `ui/Join.tsx`. */
export const JOIN = say({
  docTitle: ['Join — Tuff', 'Rejoindre — Tuff'],
  /* An invitation into a workspace that wears its own name. */
  docTitleIn: [(workspace: string) => `Join — ${workspace}`, (workspace: string) => `Rejoindre — ${workspace}`],
  couldntJoin: ['Couldn’t join. Try again.', 'Impossible de rejoindre l’espace de travail. Réessayez.'],
  enterAll: ['Enter your name, email and password.', 'Saisissez votre nom, votre adresse e-mail et votre mot de passe.'],
  codeMismatch: ['That code didn’t match.', 'Ce code ne correspond pas.'],
  /* Signed in with an address nobody has proved yet. */
  confirmFirst: [
    'Confirm your email first. Open the link we sent you to choose a password, then join.',
    'Confirmez d’abord votre adresse e-mail. Ouvrez le lien que nous vous avons envoyé pour choisir un mot de passe, puis rejoignez l’espace.',
  ],
  /* The same, on your own server with no mail set up. */
  confirmFirstNoMail: [
    'Your email isn’t confirmed, and this server can’t send email yet. Ask the server’s owner to set up email, or to invite you again.',
    'Votre adresse e-mail n’est pas confirmée, et ce serveur ne peut pas encore envoyer d’e-mails. Demandez au propriétaire du serveur de configurer l’envoi d’e-mails, ou de vous inviter à nouveau.',
  ],
  noLonger: ['This link is no longer valid', 'Ce lien n’est plus valide'],
  noLongerBody: [
    'It was already used, it expired, or it was cancelled. Ask the person who invited you for a new one.',
    'Il a déjà été utilisé, il a expiré ou il a été annulé. Demandez-en un nouveau à la personne qui vous a envoyé l’invitation.',
  ],
  theWorkspace: ['the workspace', 'l’espace de travail'],
  alreadyIn: [(where: string) => `You’re already in ${where}`, (where: string) => `Vous êtes déjà dans ${where}`],
  signedInAnd: [
    (name: string, where: string) => `You’re signed in as ${name}, and ${where} is one of your workspaces.`,
    (name: string, where: string) => `Vous êtes connecté en tant que ${name}, et ${where} fait partie de vos espaces de travail.`,
  ],
  open: [(where: string) => `Open ${where}`, (where: string) => `Ouvrir ${where}`],
  join: [(where: string) => `Join ${where}`, (where: string) => `Rejoindre ${where}`],
  signedInAs: [
    (name: string, email: string) => `You’re signed in as ${name} (${email}).`,
    (name: string, email: string) => `Vous êtes connecté en tant que ${name} (${email}).`,
  ],
  sentTo: [(email: string) => `This invitation was sent to ${email}.`, (email: string) => `Cette invitation a été envoyée à ${email}.`],
  joining: ['Joining…', 'Un instant…'],
  anotherAccount: ['Use another account', 'Utiliser un autre compte'],
  newOrNot: [
    'New to Tuff? Choose a password. Already have an account? Use its email and password.',
    'Première fois sur Tuff ? Choisissez un mot de passe. Vous avez déjà un compte ? Utilisez son adresse e-mail et son mot de passe.',
  ],
  yourName: ['Your name', 'Votre nom'],
  email: ['Email', 'Adresse e-mail'],
  code: ['Code from your app, or a recovery code', 'Code de votre application, ou code de secours'],
  joinButton: ['Join', 'Rejoindre'],
})
