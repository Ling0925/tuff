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
  /* After an update. */
  updatedFromTo: [
    (from: string, to: string) => `Updated from version ${from} to ${to}`,
    (from: string, to: string) => `Mis à jour de la version ${from} vers la version ${to}`,
  ],
  updatedTo: [(to: string) => `Updated to version ${to}`, (to: string) => `Mis à jour vers la version ${to}`],
  backupAt: ['Backup from before the update:', 'Sauvegarde d’avant la mise à jour :'],
  noChanges: ['No database changes, so no backup was needed.', 'Aucune modification de la base de données, donc aucune sauvegarde.'],
  backupSkipped: [
    'No backup was taken: SKIP_PRE_MIGRATION_BACKUP is set.',
    'Aucune sauvegarde n’a été faite : SKIP_PRE_MIGRATION_BACKUP est défini.',
  ],
  noBackup: [
    'No backup was taken: no backup folder is set (BACKUP_DIR).',
    'Aucune sauvegarde n’a été faite : aucun dossier de sauvegarde n’est défini (BACKUP_DIR).',
  ],
  backupNotAVolume: [
    'No backup was taken: the backup folder isn’t a volume, so a backup there would be lost with the container.',
    'Aucune sauvegarde n’a été faite : le dossier des sauvegardes n’est pas un volume, elle aurait été perdue avec le conteneur.',
  ],
  backupPostgresNewer: [
    'No backup was taken: the database runs a newer Postgres than this version can back up.',
    'Aucune sauvegarde n’a été faite : la base de données utilise une version de Postgres plus récente que celle que cette version sait sauvegarder.',
  ],
  changes: [
    (n: number) => (n === 1 ? '1 database change' : `${n} database changes`),
    (n: number) => (n === 1 ? '1 modification de la base de données' : `${n} modifications de la base de données`),
  ],
  dismiss: ['Dismiss', 'Ignorer'],

  tooMany: ['Too many attempts. Try again in a few minutes.', 'Trop de tentatives. Réessayez dans quelques minutes.'],
  failed: ['Couldn’t save that. Try again.', 'Impossible d’enregistrer. Réessayez.'],
})
