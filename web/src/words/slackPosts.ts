import { say } from '../data/words.js'

/** Slack, in the workspace's settings and a project's — `ui/Slack.tsx`. */
export const SLACK_POSTS = say({
  head: ['Slack', 'Slack', 'Slack'],
  notSetUp: ['Slack isn’t set up on this server.', 'Slack n’est pas configuré sur ce serveur.', '此服务器未配置 Slack。'],
  connect: ['Connect Slack', 'Connecter Slack', '连接 Slack'],
  connectAgain: ['Connect again', 'Reconnecter', '重新连接'],
  connecting: ['Connecting…', 'Connexion…', '正在连接…'],
  disconnect: ['Disconnect', 'Déconnecter', '断开连接'],
  connectedTo: [(team: string) => `Connected to ${team}`, (team: string) => `Connecté à ${team}`, (team: string) => `已连接到 ${team}`],
  connectHint: [
    'Each project can post its news to a Slack channel.',
    'Chaque projet peut publier ses nouvelles dans un canal Slack.',
    '每个项目都可以将其消息发布到 Slack 频道。',
  ],
  disconnectHint: [
    'Projects stop posting to Slack, and Tuff is removed from it.',
    'Les projets ne publient plus dans Slack, et Tuff en est retiré.',
    '项目将停止向 Slack 发布，Tuff 也会从 Slack 中移除。',
  ],
  broken: [
    'Slack stopped accepting Tuff. Connect it again to carry on.',
    'Slack n’accepte plus Tuff. Reconnectez-le pour continuer.',
    'Slack 不再接受 Tuff。请重新连接以继续。',
  ],
  previewsNeedAgain: [
    'Connect again so links to Tuff pasted in a project’s channel show a preview.',
    'Reconnectez Slack pour que les liens Tuff collés dans le canal d’un projet affichent un aperçu.',
    '重新连接后，在项目频道中粘贴的 Tuff 链接才会显示预览。',
  ],
  ownerConnects: [
    'The workspace owner connects Slack in Settings.',
    'Le propriétaire de l’espace de travail connecte Slack dans les paramètres.',
    '工作区所有者可在设置中连接 Slack。',
  ],

  channel: ['Slack channel', 'Canal Slack', 'Slack 频道'],
  noChannel: ['No channel', 'Aucun canal', '无频道'],
  privateMark: ['private', 'privé', '私有'],
  pickHint: [
    'Private channels show here once you add Tuff to them: /invite @Tuff.',
    'Les canaux privés s’affichent ici une fois Tuff ajouté : /invite @Tuff.',
    '将 Tuff 加入私有频道后，它们会显示在这里：/invite @Tuff。',
  ],
  willPost: [
    (channel: string) =>
      `New tasks, finished tasks, comments and announcements in this project will be posted in ${channel}. Links to this project pasted there show a preview. Anyone in that channel can read them, even if they aren’t in Tuff.`,
    (channel: string) =>
      `Les nouvelles tâches, les tâches terminées, les commentaires et les annonces de ce projet seront publiés dans ${channel}. Les liens vers ce projet collés dans ce canal afficheront un aperçu. Tous les membres de ce canal pourront les lire, même s’ils ne sont pas dans Tuff.`,
    (channel: string) =>
      `此项目的新任务、已完成任务、评论和公告将发布到 ${channel}。在那里粘贴的指向此项目的链接会显示预览。该频道的所有成员都能阅读，即使他们不在 Tuff 中。`,
  ],
  postHere: [
    (channel: string) => `Post to ${channel}`,
    (channel: string) => `Publier dans ${channel}`,
    (channel: string) => `发布到 ${channel}`,
  ],
  posting: [
    (channel: string, who: string) => `Posting to ${channel}, set by ${who}.`,
    (channel: string, who: string) => `Publication dans ${channel}, choisi par ${who}.`,
    (channel: string, who: string) => `发布到 ${channel}，由 ${who} 设置。`,
  ],
  stopped: [
    (channel: string) => `Stopped: Tuff can’t post in ${channel} any more. Choose a channel again.`,
    (channel: string) => `Arrêté : Tuff ne peut plus publier dans ${channel}. Choisissez à nouveau un canal.`,
    (channel: string) => `已停止：Tuff 无法再在 ${channel} 发布。请重新选择频道。`,
  ],
  stop: ['Stop posting', 'Arrêter la publication', '停止发布'],
  aPrivateChannel: ['a private channel', 'un canal privé', '一个私有频道'],
})
