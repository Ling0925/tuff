import { say } from '../data/words.js'

/** Making a conversation, a channel's settings and how loud it is — `ui/Channels.tsx`. */
export const CHANNELS = say({
  pickAtLeastOne: ['Select at least one person', 'Sélectionnez au moins une personne'],
  pickedOf: [(n: number, of: number) => `${n} of ${of}`, (n: number, of: number) => `${n} sur ${of}`],
  clear: ['Clear', 'Tout désélectionner'],
  selectAll: ['Select all', 'Tout sélectionner'],
  notYourself: ['You can’t remove yourself', 'Vous ne pouvez pas vous retirer'],
  newConversation: ['New conversation', 'Nouvelle conversation'],
  channel: ['Channel', 'Canal'],
  directMessage: ['Direct message', 'Message direct'],
  nameExample: ['e.g. general', 'p. ex. general'],
  everyoneInWorkspace: ['Everyone in the workspace', 'Toutes les personnes de l’espace de travail'],
  everyoneOnProject: ['Everyone on the project', 'Toutes les personnes du projet'],
  whoToMessage: ['Who to message', 'À qui écrire'],
  settingsFor: [(room: string) => `Channel settings for ${room}`, (room: string) => `Paramètres du canal ${room}`],
  channelName: ['Channel name', 'Nom du canal'],
  deleteChannel: ['Delete channel', 'Supprimer le canal'],
  /* Asked first, then offered back. */
  deleteChannelAsk: [
    (room: string) => `Delete #${room} for everyone? Its messages go with it. You can undo this right after.`,
    (room: string) => `Supprimer #${room} pour tout le monde ? Ses messages seront supprimés avec lui. Vous pourrez annuler juste après.`,
  ],
  keep: ['Cancel', 'Annuler'],
  channelDeleted: [(room: string) => `Deleted #${room}`, (room: string) => `Canal supprimé : #${room}`],
  allNew: ['All new messages', 'Tous les nouveaux messages'],
  allNewSaid: ['Every new message adds to the unread count.', 'Chaque nouveau message s’ajoute au nombre de non-lus.'],
  mentionsOnly: ['Mentions only', 'Mentions uniquement'],
  mentionsOnlySaid: [
    'Notified only when someone mentions you. Other messages show a grey count.',
    'Notification uniquement quand quelqu’un vous mentionne. Les autres messages affichent un nombre en gris.',
  ],
  nothing: ['Nothing', 'Rien'],
  nothingSaid: ['Muted. A grey count, no notifications.', 'En sourdine. Un nombre en gris, aucune notification.'],
  notificationsFor: [(room: string) => `Notifications for ${room}`, (room: string) => `Notifications pour ${room}`],
  notifyMeAbout: ['Notify me about', 'Me notifier pour'],
  /** A room's incoming webhooks. */
  hooks: ['Incoming webhooks', 'Webhooks entrants'],
  hooksSaid: [
    (room: string) => `Other tools can post to ${room} with the same JSON as a Slack incoming webhook.`,
    (room: string) => `D’autres outils peuvent publier dans ${room} avec le même JSON qu’un webhook entrant Slack.`,
  ],
  noHooks: ['No webhooks yet.', 'Aucun webhook pour l’instant.'],
  hookName: ['Name, e.g. Deploys', 'Nom, p. ex. Déploiements'],
  addHook: ['Add webhook', 'Ajouter un webhook'],
  copyNow: ['Copy this URL now. You won’t see it again.', 'Copiez cette URL maintenant. Vous ne la reverrez plus.'],
  copy: ['Copy', 'Copier'],
  copied: ['Copied', 'Copié'],
  /** Who answers for it — whoever added it, or last gave it a new URL. */
  hookBy: [
    (who: string, turned: boolean, last: string | null) =>
      `${turned ? 'New URL by' : 'Added by'} ${who} · ${last ? `Last posted ${last}` : 'Never posted'}`,
    (who: string, turned: boolean, last: string | null) =>
      `${turned ? 'Nouvelle URL par' : 'Ajouté par'} ${who} · ${last ? `Dernière publication ${last}` : 'Jamais utilisé'}`,
  ],
  newUrl: ['New URL', 'Nouvelle URL'],
  newUrlSure: ['The old URL stops working. New URL?', 'L’ancienne URL ne fonctionnera plus. Nouvelle URL ?'],
  remove: ['Remove', 'Supprimer'],
  removeSure: ['Remove this webhook?', 'Supprimer ce webhook ?'],
  done: ['Done', 'Terminé'],
})
