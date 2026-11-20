import { one, say } from '../data/words.js'

/**
 * Bringing a room's history from Slack — `ui/SlackImport.tsx`. The help
 * names Slack's own buttons, so its French is what Slack says in French.
 */
export const SLACK_IMPORT = say({
  noChannels: ['There are no channels in that export.', 'Cette exportation ne contient aucun canal.'],
  notAnExport: [
    'Couldn’t read this file as a Slack export. Use the .zip from Import & export data in Slack.',
    'Impossible de lire ce fichier comme une exportation Slack. Utilisez le .zip obtenu depuis Importer/Exporter des données dans Slack.',
  ],
  stopped: [
    'The import stopped partway. Messages that arrived are kept, but the rest can’t be added here.',
    'L’importation s’est arrêtée en cours de route. Les messages arrivés sont conservés, mais le reste ne peut pas être ajouté ici.',
  ],
  /** Written into a message whose file Slack would not give. */
  attachedInSlack: [(name: string) => `Attached in Slack: ${name}`, (name: string) => `Joint dans Slack : ${name}`],
  importFromSlack: ['Import from Slack', 'Importer depuis Slack'],
  howTo: ['How to export from Slack', 'Comment exporter depuis Slack'],
  progress: [
    (done: number, of: number, what: 'files' | 'messages') => `${done} of ${of} ${what}`,
    (done: number, of: number, what: 'files' | 'messages') =>
      `${done} sur ${of} ${what === 'files' ? (one(of) ? 'fichier' : 'fichiers') : one(of) ? 'message' : 'messages'}`,
  ],
  brings: ['Imports threads, names, times and files.', 'Importe les fils de discussion, les noms, les heures et les fichiers.'],
  import: ['Import', 'Importer'],
  days: [(n: number) => (n === 1 ? '1 day' : `${n} days`), (n: number) => (one(n) ? `${n} jour` : `${n} jours`)],
  gotIt: ['Got it', 'Compris'],
  freePlan: [
    'A standard export includes public channels only. Private channels and direct messages need a paid Slack plan and Slack’s approval to export all conversations. On Slack’s free plan, the export covers the last 90 days of messages and files.',
    'Une exportation standard ne comprend que les canaux publics. Les canaux privés et les messages directs nécessitent un forfait Slack payant et l’accord de Slack pour exporter toutes les conversations. Avec le forfait gratuit de Slack, l’exportation couvre les 90 derniers jours de messages et de fichiers.',
  ],

  /* The steps, and Slack's screens as they are drawn in them. */
  step1: ['Open workspace settings', 'Ouvrez les paramètres de l’espace de travail'],
  step1Said: [
    'In Slack on a computer, click Admin in the sidebar, then Workspace settings. Only owners and admins of the Slack workspace can do this.',
    'Dans Slack sur un ordinateur, cliquez sur Admin dans la barre latérale, puis sur Paramètres de l’espace de travail. Seuls les propriétaires et les administrateurs de l’espace de travail Slack peuvent le faire.',
  ],
  home: ['Home', 'Accueil'],
  dms: ['DMs', 'Messages'],
  admin: ['Admin', 'Admin'],
  manageMembers: ['Manage members', 'Gérer les membres'],
  workspaceSettings: ['Workspace settings', 'Paramètres de l’espace de travail'],
  billing: ['Billing', 'Facturation'],
  step2: ['Security → Import & export data', 'Sécurité → Importer/Exporter des données'],
  step2Said: [
    'Workspace settings opens in your browser. Open the Security tab and click Import & export data.',
    'Les paramètres de l’espace de travail s’ouvrent dans votre navigateur. Ouvrez l’onglet Sécurité et cliquez sur Importer/Exporter des données.',
  ],
  settings: ['Settings', 'Paramètres'],
  security: ['Security', 'Sécurité'],
  permissions: ['Permissions', 'Autorisations'],
  authentication: ['Authentication', 'Authentification'],
  importExport: ['Import & export data', 'Importer/Exporter des données'],
  step3: ['Choose dates and click Start Export', 'Choisissez les dates et cliquez sur Démarrer l’exportation'],
  step3Said: [
    'On the Export tab, choose a date range or keep Entire history, then click Start Export. Slack creates the file in the background.',
    'Dans l’onglet Exporter, choisissez une plage de dates ou gardez Tout l’historique, puis cliquez sur Démarrer l’exportation. Slack crée le fichier en arrière-plan.',
  ],
  export: ['Export', 'Exporter'],
  dateRange: ['Export date range: Entire history ▾', 'Plage de dates d’exportation : Tout l’historique ▾'],
  startExport: ['Start Export', 'Démarrer l’exportation'],
  step4: ['Download the .zip', 'Téléchargez le .zip'],
  step4Said: [
    'Slack emails you when it’s ready. Open the link in the email and click Ready for download to save the .zip.',
    'Slack vous envoie un e-mail quand il est prêt. Ouvrez le lien de l’e-mail et cliquez sur Prêt pour le téléchargement pour enregistrer le .zip.',
  ],
  exportReady: ['✉ Your Slack export is ready', '✉ Votre exportation Slack est prête'],
  workspaceExport: ['Workspace export · .zip', 'Exportation de l’espace de travail · .zip'],
  readyForDownload: ['Ready for download', 'Prêt pour le téléchargement'],
  step5: ['Import it here', 'Importez-le ici'],
  step5Said: [
    'Back here, click Import from Slack, choose the .zip, select the channel and click Import.',
    'De retour ici, cliquez sur Importer depuis Slack, choisissez le .zip, sélectionnez le canal et cliquez sur Importer.',
  ],
  exampleChannel: ['◉ #general · 120 days', '◉ #general · 120 jours'],
})
