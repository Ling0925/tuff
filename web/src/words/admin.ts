import { one, say } from '../data/words.js'

/** Webhooks, the security log and import — `ui/Admin.tsx`, `ui/AuditLog.tsx`. */
export const ADMIN = say({
  webhooksHint: [
    'Sends every change in the workspace to a URL. Each delivery is signed, so the receiver can check it came from Tuff.',
    'Envoie chaque modification de l’espace de travail à une URL. Chaque envoi est signé, pour que le destinataire puisse vérifier qu’il vient de Tuff.',
  ],
  lastResponse: [(status: number) => `Last response ${status}`, (status: number) => `Dernière réponse ${status}`],
  noDeliveries: ['No deliveries yet', 'Aucun envoi pour l’instant'],
  off: ['Off', 'Désactivé'],
  /* Turned off when the account that made it changed hands. */
  offFromBefore: ['Off · Made before its account changed hands', 'Désactivé · Créé avant que son compte change de main'],
  reviveAsk: ['Turn on this webhook?', 'Activer ce webhook ?'],
  reviveSays: [
    (host: string) =>
      `It was made before the account that made it changed hands. Once it’s on, changes in this workspace are sent to ${host}. It gets a new secret, shown once.`,
    (host: string) =>
      `Il a été créé avant que le compte qui l’a créé change de main. Une fois activé, les modifications de cet espace de travail sont envoyées à ${host}. Il reçoit un nouveau secret, affiché une seule fois.`,
  ],
  turnOff: ['Turn off', 'Désactiver'],
  /* Off and on again, its events, a test and deleting it. */
  turnOn: ['Turn on', 'Activer'],
  events: ['Events', 'Événements'],
  allEvents: ['All events', 'Tous les événements'],
  nEvents: [(n: number) => (n === 1 ? '1 event' : `${n} events`), (n: number) => (one(n) ? `${n} événement` : `${n} événements`)],
  sendTest: ['Send test', 'Envoyer un test'],
  /* The receiver's own key. */
  key: ['Authorization', 'Authorization'],
  withKey: ['Authorization set', 'Authorization définie'],
  testSent: ['Test sent. Its response shows here in a moment.', 'Test envoyé. Sa réponse s’affiche ici dans un instant.'],
  couldntTest: ['Couldn’t send a test. Try again.', 'Impossible d’envoyer un test. Réessayez.'],
  tooManyTests: ['Too many tests. Try again later.', 'Trop de tests. Réessayez plus tard.'],
  couldntChange: ['Couldn’t change the webhook. Try again.', 'Impossible de modifier le webhook. Réessayez.'],
  deleteWebhook: ['Delete', 'Supprimer'],
  deleteWebhookAsk: ['Delete this webhook?', 'Supprimer ce webhook ?'],
  deleteWebhookSays: [
    (url: string) => `Nothing more will be sent to ${url}, and its secret is gone. To pause it instead, turn it off.`,
    (url: string) => `Plus rien ne sera envoyé à ${url}, et son secret est supprimé. Pour le mettre en pause, désactivez-le plutôt.`,
  ],
  /* The events, as the list of them names them. */
  event: [
    {
      'task.create': 'Task created',
      'task.update': 'Task changed',
      'task.delete': 'Task deleted',
      'task.comment': 'Comment on a task',
      'post.create': 'Announcement posted',
      'post.update': 'Announcement edited',
      'post.delete': 'Announcement deleted',
      'post.comment': 'Reply to an announcement',
      'file.create': 'Document created',
      'file.upload': 'File uploaded',
      'file.update': 'Document or file changed',
      'file.delete': 'Document or file deleted',
      'file.purge': 'Document or file deleted forever',
      'file.comment': 'Comment on a document',
      'file.publish': 'Document published',
      'file.access': 'Who can see a document changed',
      'project.create': 'Project created',
      'project.archive': 'Project archived',
      'project.member.add': 'Someone added to a project',
      'time.log': 'Time logged',
    },
    {
      'task.create': 'Tâche créée',
      'task.update': 'Tâche modifiée',
      'task.delete': 'Tâche supprimée',
      'task.comment': 'Commentaire sur une tâche',
      'post.create': 'Annonce publiée',
      'post.update': 'Annonce modifiée',
      'post.delete': 'Annonce supprimée',
      'post.comment': 'Réponse à une annonce',
      'file.create': 'Document créé',
      'file.upload': 'Fichier importé',
      'file.update': 'Document ou fichier modifié',
      'file.delete': 'Document ou fichier supprimé',
      'file.purge': 'Document ou fichier supprimé définitivement',
      'file.comment': 'Commentaire sur un document',
      'file.publish': 'Document publié',
      'file.access': 'Accès à un document modifié',
      'project.create': 'Projet créé',
      'project.archive': 'Projet archivé',
      'project.member.add': 'Personne ajoutée à un projet',
      'time.log': 'Temps saisi',
    },
  ],

  /* The security log's lines in sentences — what each means, not its code.
     The audit log reads them, beside its own in `audit.ts`. */
  logToday: ['Today', 'Aujourd’hui'],
  logYesterday: ['Yesterday', 'Hier'],
  logSomebody: ['Someone', 'Quelqu’un'],
  logLogin: [(who: string) => `${who} signed in`, (who: string) => `Connexion de ${who}`],
  logRegister: [(who: string) => `${who} created an account`, (who: string) => `${who} a créé un compte`],
  logWorkspace: [(who: string) => `${who} created the workspace`, (who: string) => `${who} a créé l’espace de travail`],
  logTokenIssued: [(who: string, what: string) => `${who} connected ${what}`, (who: string, what: string) => `${who} a connecté ${what}`],
  logATool: ['a tool', 'un outil'],
  logTokenRevoked: [(who: string) => `${who} disconnected a tool`, (who: string) => `${who} a déconnecté un outil`],
  logInvited: [
    (who: string, role: string) => `${who} invited someone as ${role}`,
    (who: string, role: string) => `${who} a invité quelqu’un comme ${role}`,
  ],
  logJoined: [(who: string, role: string) => `${who} joined as ${role}`, (who: string, role: string) => `${who} a rejoint comme ${role}`],
  logHandedOver: [
    (who: string, to: string) => `${who} made ${to} the owner`,
    (who: string, to: string) => `${who} a fait de ${to} le propriétaire`,
  ],
  logEmail: [(who: string) => `${who} changed their email`, (who: string) => `${who} a changé son e-mail`],
  logPassword: [(who: string) => `${who} changed their password`, (who: string) => `${who} a changé son mot de passe`],
  logReset: [(who: string) => `${who} reset their password`, (who: string) => `${who} a réinitialisé son mot de passe`],
  logPurged: [
    (who: string, what: string) => `${who} deleted ${what} for good`,
    (who: string, what: string) => `${who} a supprimé ${what} définitivement`,
  ],
  logAProject: ['a project', 'un projet'],
  logRole: [
    { owner: 'owner', admin: 'admin', member: 'member', guest: 'guest', client: 'client' } as Record<string, string>,
    { owner: 'propriétaire', admin: 'administrateur', member: 'membre', guest: 'invité', client: 'client' } as Record<string, string>,
  ],
  logOn: [(browser: string, system: string) => `${browser} on ${system}`, (browser: string, system: string) => `${browser} sur ${system}`],

  importFrom: ['From Basecamp, Asana or Trello', 'Depuis Basecamp, Asana ou Trello'],
  importHint: [
    'Paste the export. If any part of it can’t be read, nothing is imported.',
    'Collez l’export. Si une partie ne peut pas être lue, rien n’est importé.',
  ],
  imported: [
    (projects: number, tasks: number) => `Imported ${projects} projects and ${tasks} tasks.`,
    (projects: number, tasks: number) =>
      `${projects} ${one(projects) ? 'projet' : 'projets'} et ${tasks} ${one(tasks) ? 'tâche' : 'tâches'} importés.`,
  ],
  importing: ['Importing…', 'Importation…'],
  import: ['Import', 'Importer'],
})
