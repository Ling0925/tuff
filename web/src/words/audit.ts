import { say } from '../data/words.js'

/** The audit log — `ui/AuditLog.tsx`. */
export const AUDIT = say({
  what: ['Who did what in this workspace', 'Qui a fait quoi dans cet espace de travail'],
  hint: [
    'Sign-ins, people, permissions, settings, deletions and integrations, including actions by connected tools.',
    'Connexions, personnes, autorisations, paramètres, suppressions et intégrations, y compris les actions des outils connectés.',
  ],
  open: ['Open', 'Ouvrir'],
  back: ['Workspace settings', 'Paramètres de l’espace de travail'],
  kind: ['Type', 'Type'],
  person: ['Person', 'Personne'],
  allKinds: ['All activity', 'Toute l’activité'],
  everyone: ['Everyone', 'Tout le monde'],
  formerly: [(name: string) => `${name} (removed)`, (name: string) => `${name} (retiré)`],
  types: [
    {
      sign_ins: 'Sign-ins',
      people: 'People',
      rights: 'Permissions',
      settings: 'Settings',
      deletions: 'Deletions',
      integrations: 'Integrations',
    } as Record<string, string>,
    {
      sign_ins: 'Connexions',
      people: 'Personnes',
      rights: 'Autorisations',
      settings: 'Paramètres',
      deletions: 'Suppressions',
      integrations: 'Intégrations',
    } as Record<string, string>,
  ],
  nothing: ['Nothing here yet.', 'Rien pour l’instant.'],
  nothingNarrowed: ['Nothing matches.', 'Aucun résultat.'],
  more: ['Show more', 'Afficher plus'],
  ownerOnly: ['Only the owner can read the audit log.', 'Seul le propriétaire peut consulter le journal d’audit.'],
  couldNotLoad: ['Couldn’t load the audit log. Try again.', 'Impossible de charger le journal d’audit. Réessayez.'],
  viaAgent: ['via AI agent', 'via un agent IA'],
  viaGithub: ['from GitHub', 'depuis GitHub'],

  /* The lines that are new with this log; the security log's own are in `admin.ts`. */
  removed: [
    (who: string, them: string) => `${who} removed ${them} from the workspace`,
    (who: string, them: string) => `${who} a retiré ${them} de l’espace de travail`,
  ],
  rightsChanged: [
    (who: string, them: string) => `${who} changed what ${them} can do in the workspace`,
    (who: string, them: string) => `${who} a modifié ce que ${them} peut faire dans l’espace de travail`,
  ],
  projectRights: [
    (who: string, them: string, project: string) => `${who} changed what ${them} can do on ${project}`,
    (who: string, them: string, project: string) => `${who} a modifié ce que ${them} peut faire sur ${project}`,
  ],
  addedTo: [
    (who: string, them: string, project: string) => `${who} added ${them} to ${project}`,
    (who: string, them: string, project: string) => `${who} a ajouté ${them} à ${project}`,
  ],
  removedFrom: [
    (who: string, them: string, project: string) => `${who} removed ${them} from ${project}`,
    (who: string, them: string, project: string) => `${who} a retiré ${them} de ${project}`,
  ],
  left: [(who: string, project: string) => `${who} left ${project}`, (who: string, project: string) => `${who} a quitté ${project}`],
  leftWorkspace: [(who: string) => `${who} left the workspace`, (who: string) => `${who} a quitté l’espace de travail`],
  switched: [
    (who: string, what: string, to: string) => `${who} set ${what} to ${to}`,
    (who: string, what: string, to: string) => `${who} a réglé ${what} sur ${to}`,
  ],
  settingsChanged: [
    (who: string) => `${who} changed the workspace’s settings`,
    (who: string) => `${who} a modifié les paramètres de l’espace de travail`,
  ],
  binned: [(who: string, project: string) => `${who} deleted ${project}`, (who: string, project: string) => `${who} a supprimé ${project}`],
  restored: [
    (who: string, project: string) => `${who} restored ${project}`,
    (who: string, project: string) => `${who} a restauré ${project}`,
  ],
  workspaceDeleted: [(who: string) => `${who} deleted the workspace`, (who: string) => `${who} a supprimé l’espace de travail`],
  workspaceRestored: ['The workspace was restored', 'L’espace de travail a été restauré'],
  connected: [(who: string, what: string) => `${who} connected ${what}`, (who: string, what: string) => `${who} a connecté ${what}`],
  disconnected: [
    (who: string, what: string) => `${who} disconnected ${what}`,
    (who: string, what: string) => `${who} a déconnecté ${what}`,
  ],
  /* Tuff's connector signed in as an agent. */
  linkedAs: [
    (who: string, client: string, agent: string) => `${who} connected ${client} as ${agent}`,
    (who: string, client: string, agent: string) => `${who} a connecté ${client} en tant que ${agent}`,
  ],
  unlinkedFrom: [
    (who: string, client: string, agent: string) => `${who} disconnected ${client} from ${agent}`,
    (who: string, client: string, agent: string) => `${who} a déconnecté ${client} de ${agent}`,
  ],
  webhookAdded: [
    (who: string, host: string) => `${who} added a webhook to ${host}`,
    (who: string, host: string) => `${who} a ajouté un webhook vers ${host}`,
  ],
  webhookRemoved: [
    (who: string, host: string) => `${who} removed a webhook to ${host}`,
    (who: string, host: string) => `${who} a supprimé un webhook vers ${host}`,
  ],
  aWebhook: ['a webhook', 'un webhook'],
  /* Turned off or on, or its events changed. */
  webhookOff: [
    (who: string, host: string) => `${who} turned off a webhook to ${host}`,
    (who: string, host: string) => `${who} a désactivé un webhook vers ${host}`,
  ],
  /* What happened to a webhook's Authorization header — never the header. */
  webhookKeySet: [
    (who: string, host: string) => `${who} set the Authorization header of a webhook to ${host}`,
    (who: string, host: string) => `${who} a défini l’en-tête Authorization d’un webhook vers ${host}`,
  ],
  webhookKeyChanged: [
    (who: string, host: string) => `${who} replaced the Authorization header of a webhook to ${host}`,
    (who: string, host: string) => `${who} a remplacé l’en-tête Authorization d’un webhook vers ${host}`,
  ],
  webhookKeyRemoved: [
    (who: string, host: string) => `${who} removed the Authorization header of a webhook to ${host}`,
    (who: string, host: string) => `${who} a retiré l’en-tête Authorization d’un webhook vers ${host}`,
  ],
  agentReach: [
    (who: string, what: string) => `${who} changed how ${what} is reached`,
    (who: string, what: string) => `${who} a changé la façon de joindre ${what}`,
  ],
  webhookChanged: [
    (who: string, host: string) => `${who} changed a webhook to ${host}`,
    (who: string, host: string) => `${who} a modifié un webhook vers ${host}`,
  ],
  anAgent: ['an agent', 'un agent'],
  someone: ['someone', 'quelqu’un'],
  aProject: ['a project', 'un projet'],
})
