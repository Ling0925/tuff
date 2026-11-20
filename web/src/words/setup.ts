import { say } from '../data/words.js'

/** Your own server's first opening — `ui/Setup.tsx`. */
export const SETUP = say({
  docTitle: ['Set up Tuff', 'Configurer Tuff'],
  step: [(n: number) => `Step ${n} of 2`, (n: number) => `Étape ${n} sur 2`],

  mailTitle: ['Set up email.', 'Configurez l’envoi d’e-mails.'],
  mailIntro: [
    'Tuff sends invitations, notifications and password reset links by email.',
    'Tuff envoie les invitations, les notifications et les liens de réinitialisation de mot de passe par e-mail.',
  ],
  testTo: ['Send a test email to', 'Envoyer un e-mail de test à'],
  test: ['Send a test email', 'Envoyer un e-mail de test'],
  testing: ['Sending…', 'Envoi…'],
  testSent: ['Sent. Check that inbox.', 'Envoyé. Consultez cette boîte de réception.'],
  testFailed: ['Couldn’t send it. Check the settings and try again.', 'Impossible de l’envoyer. Vérifiez les paramètres et réessayez.'],
  continue: ['Continue', 'Continuer'],
  skip: ['Skip for now', 'Ignorer pour l’instant'],

  skipTitle: ['Continue without email?', 'Continuer sans e-mails\u00a0?'],
  skipWont: [
    'Without email, Tuff can’t send invitations, notifications or password reset links.',
    'Sans e-mails, Tuff ne peut pas envoyer d’invitations, de notifications ni de liens de réinitialisation de mot de passe.',
  ],
  skipWill: [
    'You can still invite people: Tuff shows you a link to send them yourself.',
    'Vous pouvez quand même inviter des personnes\u00a0: Tuff vous donne un lien à leur envoyer vous-même.',
  ],
  skipLater: [
    'You can set up email later in Server settings.',
    'Vous pourrez configurer l’envoi d’e-mails plus tard dans les paramètres du serveur.',
  ],
  skipGo: ['Continue without email', 'Continuer sans e-mails'],
  back: ['Back', 'Retour'],

  ownerTitle: ['Create your account.', 'Créez votre compte.'],
  ownerIntro: [
    'You’ll be the owner of this server. You can add other owners later.',
    'Vous serez le propriétaire de ce serveur. Vous pourrez ajouter d’autres propriétaires plus tard.',
  ],
  name: ['Your name', 'Votre nom'],
  email: ['Email', 'Adresse e-mail'],
  ownerEmailFixed: ['This server is set up for this email.', 'Ce serveur est configuré pour cette adresse e-mail.'],
  create: ['Create account', 'Créer le compte'],
  creating: ['Creating…', 'Création…'],

  badLinkTitle: ['This link doesn’t work.', 'Ce lien ne fonctionne pas.'],
  badLink: [
    'Use the setup link from the server’s log or from setup.sh.',
    'Utilisez le lien de configuration du journal du serveur ou de setup.sh.',
  ],
  doneTitle: ['This server is set up.', 'Ce serveur est configuré.'],
  done: ['It already has an owner. Sign in to continue.', 'Il a déjà un propriétaire. Connectez-vous pour continuer.'],
  signIn: ['Sign in', 'Se connecter'],
  tooMany: ['Too many attempts. Try again in a few minutes.', 'Trop de tentatives. Réessayez dans quelques minutes.'],
  couldntReach: [
    'Couldn’t reach Tuff. Check your connection and try again.',
    'Impossible de joindre Tuff. Vérifiez votre connexion et réessayez.',
  ],
})
