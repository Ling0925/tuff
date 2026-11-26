import { say } from '../data/words.js'

/** Making a conversation, a channel's settings and how loud it is — `ui/Channels.tsx`. */
export const CHANNELS = say({
  pickAtLeastOne: ['Select at least one person', 'Sélectionnez au moins une personne', '至少选择一人'],
  pickedOf: [
    (n: number, of: number) => `${n} of ${of}`,
    (n: number, of: number) => `${n} sur ${of}`,
    (n: number, of: number) => `已选 ${n}/${of}`,
  ],
  clear: ['Clear', 'Tout désélectionner', '清除'],
  selectAll: ['Select all', 'Tout sélectionner', '全选'],
  notYourself: ['You can’t remove yourself', 'Vous ne pouvez pas vous retirer', '不能移除你自己'],
  newConversation: ['New conversation', 'Nouvelle conversation', '新建对话'],
  channel: ['Channel', 'Canal', '频道'],
  directMessage: ['Direct message', 'Message direct', '私信'],
  nameExample: ['e.g. general', 'p. ex. general', '例如 general'],
  everyoneInWorkspace: ['Everyone in the workspace', 'Toutes les personnes de l’espace de travail', '工作区中的所有成员'],
  everyoneOnProject: ['Everyone on the project', 'Toutes les personnes du projet', '项目中的所有成员'],
  whoToMessage: ['Who to message', 'À qui écrire', '发给谁'],
  settingsFor: [
    (room: string) => `Channel settings for ${room}`,
    (room: string) => `Paramètres du canal ${room}`,
    (room: string) => `${room} 的频道设置`,
  ],
  channelName: ['Channel name', 'Nom du canal', '频道名称'],
  deleteChannel: ['Delete channel', 'Supprimer le canal', '删除频道'],
  /* Asked first, then offered back. */
  deleteChannelAsk: [
    (room: string) => `Delete #${room} for everyone? Its messages go with it. You can undo this right after.`,
    (room: string) => `Supprimer #${room} pour tout le monde ? Ses messages seront supprimés avec lui. Vous pourrez annuler juste après.`,
    (room: string) => `为所有人删除 #${room}？其消息也会一并删除。操作后可以立即撤销。`,
  ],
  keep: ['Cancel', 'Annuler', '取消'],
  channelDeleted: [
    (room: string) => `Deleted #${room}`,
    (room: string) => `Canal supprimé : #${room}`,
    (room: string) => `已删除 #${room}`,
  ],
  allNew: ['All new messages', 'Tous les nouveaux messages', '所有新消息'],
  allNewSaid: [
    'Every new message adds to the unread count.',
    'Chaque nouveau message s’ajoute au nombre de non-lus.',
    '每条新消息都会计入未读数。',
  ],
  mentionsOnly: ['Mentions only', 'Mentions uniquement', '仅提及'],
  mentionsOnlySaid: [
    'Notified only when someone mentions you. Other messages show a grey count.',
    'Notification uniquement quand quelqu’un vous mentionne. Les autres messages affichent un nombre en gris.',
    '仅当有人提及你时通知。其他消息显示为灰色计数。',
  ],
  nothing: ['Nothing', 'Rien', '无'],
  nothingSaid: [
    'Muted. A grey count, no notifications.',
    'En sourdine. Un nombre en gris, aucune notification.',
    '已静音。显示灰色计数，不发送通知。',
  ],
  notificationsFor: [
    (room: string) => `Notifications for ${room}`,
    (room: string) => `Notifications pour ${room}`,
    (room: string) => `${room} 的通知`,
  ],
  notifyMeAbout: ['Notify me about', 'Me notifier pour', '通知我'],
  /** A room's incoming webhooks. */
  hooks: ['Incoming webhooks', 'Webhooks entrants', '传入 Webhook'],
  hooksSaid: [
    (room: string) => `Other tools can post to ${room} with the same JSON as a Slack incoming webhook.`,
    (room: string) => `D’autres outils peuvent publier dans ${room} avec le même JSON qu’un webhook entrant Slack.`,
    (room: string) => `其他工具可以使用与 Slack 传入 Webhook 相同的 JSON 向 ${room} 发布消息。`,
  ],
  noHooks: ['No webhooks yet.', 'Aucun webhook pour l’instant.', '还没有 Webhook。'],
  hookName: ['Name, e.g. Deploys', 'Nom, p. ex. Déploiements', '名称，例如 部署'],
  addHook: ['Add webhook', 'Ajouter un webhook', '添加 Webhook'],
  copyNow: [
    'Copy this URL now. You won’t see it again.',
    'Copiez cette URL maintenant. Vous ne la reverrez plus.',
    '请立即复制此 URL，之后将不再显示。',
  ],
  copy: ['Copy', 'Copier', '复制'],
  copied: ['Copied', 'Copié', '已复制'],
  /** Who answers for it — whoever added it, or last gave it a new URL. */
  hookBy: [
    (who: string, turned: boolean, last: string | null) =>
      `${turned ? 'New URL by' : 'Added by'} ${who} · ${last ? `Last posted ${last}` : 'Never posted'}`,
    (who: string, turned: boolean, last: string | null) =>
      `${turned ? 'Nouvelle URL par' : 'Ajouté par'} ${who} · ${last ? `Dernière publication ${last}` : 'Jamais utilisé'}`,
    (who: string, turned: boolean, last: string | null) =>
      `${turned ? '新 URL 由' : '添加者：'} ${who} · ${last ? `上次发布 ${last}` : '从未发布'}`,
  ],
  /** Its maker's account changed hands. */
  hookStopped: [
    'Stopped. Get a new URL to start it again.',
    'Arrêté. Créez une nouvelle URL pour le relancer.',
    '已停止。获取新 URL 以重新启动。',
  ],
  newUrl: ['New URL', 'Nouvelle URL', '新 URL'],
  newUrlSure: ['The old URL stops working. New URL?', 'L’ancienne URL ne fonctionnera plus. Nouvelle URL ?', '旧 URL 将失效。生成新 URL？'],
  remove: ['Remove', 'Supprimer', '移除'],
  removeSure: ['Remove this webhook?', 'Supprimer ce webhook ?', '移除此 Webhook？'],
  done: ['Done', 'Terminé', '完成'],
})
