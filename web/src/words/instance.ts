import { say } from '../data/words.js'

/** Your own server's owner screen — `ui/Instance.tsx`. */
export const INSTANCE = say({
  title: ['Server settings', 'Paramètres du serveur'],

  signUp: ['Sign-up', 'Inscriptions'],
  anyone: ['Anyone can create an account', 'Tout le monde peut créer un compte'],
  anyoneHint: ['Off: people join when someone invites them.', 'Désactivé : on rejoint le serveur sur invitation.'],

  owners: ['Owners', 'Propriétaires'],
  ownersHint: [
    'Owners see this page. The server always keeps at least one.',
    'Les propriétaires voient cette page. Le serveur en garde toujours au moins un.',
  ],
  you: ['You', 'Vous'],
  remove: ['Remove', 'Retirer'],
  addPlaceholder: ['Email of an existing account', 'E-mail d’un compte existant'],
  add: ['Add owner', 'Ajouter'],
  noAccount: ['No account has that email.', 'Aucun compte n’utilise cette adresse e-mail.'],
  unconfirmed: ['That account hasn’t confirmed its email yet.', 'Ce compte n’a pas encore confirmé son adresse e-mail.'],
  lastOwner: ['The server needs at least one owner.', 'Le serveur doit avoir au moins un propriétaire.'],

  email: ['Email', 'E-mail'],
  mailOn: ['Email is set up.', 'L’envoi d’e-mails est configuré.'],
  mailOff: ['Email isn’t set up, so no emails are sent.', 'L’envoi d’e-mails n’est pas configuré : aucun e-mail n’est envoyé.'],
  testLetter: ['Send a test email', 'Envoyer un e-mail de test'],
  testHint: ['It goes to your own email.', 'Il est envoyé à votre propre adresse e-mail.'],
  sent: ['Sent. Check your inbox.', 'Envoyé. Consultez votre boîte de réception.'],
  sentToLog: ['Written to the server’s log.', 'Écrit dans le journal du serveur.'],
  notSent: ['Couldn’t send it. Check the server’s log.', 'Impossible de l’envoyer. Consultez le journal du serveur.'],
  /* Setting mail up here. */
  connect: ['Connect', 'Connecter'],
  save: ['Save', 'Enregistrer'],
  saving: ['Saving…', 'Enregistrement…'],
  savedSaid: ['Saved.', 'Enregistré.'],
  disconnect: ['Disconnect', 'Déconnecter'],
  /* Proving it is them before mail changes. */
  proveIt: ['To save or disconnect, confirm it’s you.', 'Pour enregistrer ou déconnecter, confirmez votre identité.'],
  yourPassword: ['Your password', 'Votre mot de passe'],
  codeFromAuthenticator: ['Code from your authenticator app', 'Code de votre application d’authentification'],
  codeFromEmail: ['Code from your email', 'Code reçu par e-mail'],
  notThem: ['That didn’t match. Try again.', 'Cela ne correspond pas. Réessayez.'],

  version: ['Version', 'Version'],
  running: [(v: string) => `Version ${v}`, (v: string) => `Version ${v}`],
  checkOn: ['Tuff checks for new versions once a day.', 'Tuff recherche une nouvelle version une fois par jour.'],
  checkOff: ['Checking for new versions is off.', 'La recherche de nouvelles versions est désactivée.'],
  unreleased: [
    'A development build. It doesn’t check for new versions.',
    'Une version de développement. Elle ne recherche pas de nouvelles versions.',
  ],
  isOut: [(v: string) => `Version ${v} is out`, (v: string) => `La version ${v} est disponible`],
  securityUpdate: ['Security update', 'Mise à jour de sécurité'],
  howToUpdate: ['To update, run this on the server:', 'Pour mettre à jour, exécutez cette commande sur le serveur :'],
  releaseNotes: ['Release notes', 'Notes de version'],
  updateAvailable: ['A security update is available', 'Une mise à jour de sécurité est disponible'],

  tooMany: ['Too many attempts. Try again in a few minutes.', 'Trop de tentatives. Réessayez dans quelques minutes.'],
  failed: ['Couldn’t save that. Try again.', 'Impossible d’enregistrer. Réessayez.'],
})
