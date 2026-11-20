import { say } from '../data/words.js'

/** Slack, in the workspace's settings and a project's — `ui/Slack.tsx`. */
export const SLACK_POSTS = say({
  head: ['Slack', 'Slack'],
  notSetUp: ['Slack isn’t set up on this server.', 'Slack n’est pas configuré sur ce serveur.'],
  connect: ['Connect Slack', 'Connecter Slack'],
  connectAgain: ['Connect again', 'Reconnecter'],
  connecting: ['Connecting…', 'Connexion…'],
  disconnect: ['Disconnect', 'Déconnecter'],
  connectedTo: [(team: string) => `Connected to ${team}`, (team: string) => `Connecté à ${team}`],
  connectHint: ['Each project can post its news to a Slack channel.', 'Chaque projet peut publier ses nouvelles dans un canal Slack.'],
  disconnectHint: [
    'Projects stop posting to Slack, and Tuff is removed from it.',
    'Les projets ne publient plus dans Slack, et Tuff en est retiré.',
  ],
  broken: ['Slack stopped accepting Tuff. Connect it again to carry on.', 'Slack n’accepte plus Tuff. Reconnectez-le pour continuer.'],
  previewsNeedAgain: [
    'Connect again so links to Tuff pasted in a project’s channel show a preview.',
    'Reconnectez Slack pour que les liens Tuff collés dans le canal d’un projet affichent un aperçu.',
  ],
  ownerConnects: [
    'The workspace owner connects Slack in Settings.',
    'Le propriétaire de l’espace de travail connecte Slack dans les paramètres.',
  ],

  channel: ['Slack channel', 'Canal Slack'],
  noChannel: ['No channel', 'Aucun canal'],
  privateMark: ['private', 'privé'],
  pickHint: [
    'Private channels show here once you add Tuff to them: /invite @Tuff.',
    'Les canaux privés s’affichent ici une fois Tuff ajouté : /invite @Tuff.',
  ],
  willPost: [
    (channel: string) =>
      `New tasks, finished tasks, comments and announcements in this project will be posted in ${channel}. Links to this project pasted there show a preview. Anyone in that channel can read them, even if they aren’t in Tuff.`,
    (channel: string) =>
      `Les nouvelles tâches, les tâches terminées, les commentaires et les annonces de ce projet seront publiés dans ${channel}. Les liens vers ce projet collés dans ce canal afficheront un aperçu. Tous les membres de ce canal pourront les lire, même s’ils ne sont pas dans Tuff.`,
  ],
  postHere: [(channel: string) => `Post to ${channel}`, (channel: string) => `Publier dans ${channel}`],
  posting: [
    (channel: string, who: string) => `Posting to ${channel}, set by ${who}.`,
    (channel: string, who: string) => `Publication dans ${channel}, choisi par ${who}.`,
  ],
  stopped: [
    (channel: string) => `Stopped: Tuff can’t post in ${channel} any more. Choose a channel again.`,
    (channel: string) => `Arrêté : Tuff ne peut plus publier dans ${channel}. Choisissez à nouveau un canal.`,
  ],
  stop: ['Stop posting', 'Arrêter la publication'],
  aPrivateChannel: ['a private channel', 'un canal privé'],
})
