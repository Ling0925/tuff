import { one, say } from '../data/words.js'

/** A room, its thread and its people — `ui/Chat.tsx`. */
export const CHAT = say({
  today: ['Today', 'Aujourd’hui', '今天'],
  yesterday: ['Yesterday', 'Hier', '昨天'],
  back: ['Back', 'Retour', '返回'],
  /** A conversation beside the work. */
  openInChat: ['Open in Chat', 'Ouvrir dans Discussions', '在聊天中打开'],
  close: ['Close', 'Fermer', '关闭'],
  openBeside: ['Open beside', 'Ouvrir à côté', '在侧边打开'],
  messageWho: [
    (name: string) => `Message ${name}`,
    (name: string) => `Envoyer un message à ${name}`,
    (name: string) => `给 ${name} 发消息`,
  ],
  findInConversation: ['Find in this conversation', 'Rechercher dans cette conversation', '在此对话中查找'],
  findInChannel: ['Find in this channel', 'Rechercher dans ce canal', '在此频道中查找'],
  /** What the row of faces says: the names, or how many. */
  peopleCount: [(n: number) => `${n} people`, (n: number) => (one(n) ? `${n} personne` : `${n} personnes`), (n: number) => `${n} 人`],
  wholeProject: [' · everyone on the project', ' · toutes les personnes du projet', ' · 项目中的所有成员'],
  /** After the first name, on a phone: how many more are in the room. */
  moreNames: [(n: number) => `+${n}`, (n: number) => `+${n}`, (n: number) => `+${n}`],
  noMessagesYet: ['No messages yet', 'Aucun message pour l’instant', '还没有消息'],
  projectCanSee: [
    'Everyone on this project can see this chat.',
    'Toutes les personnes du projet peuvent voir cette discussion.',
    '此项目的所有成员都能看到此聊天。',
  ],
  channelCanSee: [
    'Only people in this channel can see it.',
    'Seules les personnes de ce canal peuvent le voir.',
    '只有此频道中的人能看到。',
  ],
  conversationCanSee: [
    'Only people in this conversation can see it.',
    'Seules les personnes de cette conversation peuvent la voir.',
    '只有此对话中的人能看到。',
  ],
  newMessages: [
    (n: number) => (n === 1 ? '1 new message' : `${n} new messages`),
    (n: number) => (one(n) ? `${n} nouveau message` : `${n} nouveaux messages`),
    (n: number) => `${n} 条新消息`,
  ],
  noMatch: [
    (q: string) => `No messages match “${q}”.`,
    (q: string) => `Aucun message ne correspond à « ${q} ».`,
    (q: string) => `没有消息匹配「${q}」。`,
  ],
  hitCount: [
    (n: number, more: boolean) => `${n}${more ? '+' : ''} ${n === 1 ? 'message' : 'messages'}`,
    (n: number, more: boolean) => `${n}${more ? '+' : ''} ${one(n) && !more ? 'message' : 'messages'}`,
    (n: number, more: boolean) => `${n}${more ? '+' : ''} 条消息`,
  ],
  hitWhen: [
    (day: string, time: string, inThread: boolean) => `${day}, ${time}${inThread ? ' · in a thread' : ''}`,
    (day: string, time: string, inThread: boolean) => `${day}, ${time}${inThread ? ' · dans un fil de discussion' : ''}`,
    (day: string, time: string, inThread: boolean) => `${day} ${time}${inThread ? ' · 在话题中' : ''}`,
  ],
  showMore: ['Show more', 'Afficher plus', '显示更多'],
  placeholder: [
    (name: string) => `Message ${name}`.trim(),
    (name: string) => (name ? `Envoyer un message à ${name}` : 'Envoyer un message'),
    (name: string) => `给 ${name} 发消息`.trim(),
  ],
  /** A task made from a message with no words in it. */
  messageFrom: [(name: string) => `Message from ${name}`, (name: string) => `Message de ${name}`, (name: string) => `来自 ${name} 的消息`],
  everyoneOnProject: ['Everyone on the project', 'Toutes les personnes du projet', '项目中的所有成员'],
  onlyYou: ['Only you', 'Vous uniquement', '仅你'],
  selected: [
    (n: number) => `${n} selected`,
    (n: number) => (one(n) ? `${n} sélectionnée` : `${n} sélectionnées`),
    (n: number) => `已选择 ${n} 项`,
  ],
  clear: ['Clear', 'Tout désélectionner', '清除'],
  selectAll: ['Select all', 'Tout sélectionner', '全选'],
  wasDeleted: ['This message was deleted.', 'Ce message a été supprimé.', '此消息已删除。'],
  /** Who reacted: "You", "Sam and You" — "Vous", "Sam et vous" mid-list. */
  you: ['You', 'Vous', '你'],
  youAfter: ['You', 'vous', '你'],
  someone: ['Someone', 'Quelqu’un', '某人'],
  andLast: [
    (first: string, last: string) => `${first} and ${last}`,
    (first: string, last: string) => `${first} et ${last}`,
    (first: string, last: string) => `${first} 和 ${last}`,
  ],
  andOthers: [
    (first: string, n: number) => `${first} and ${n} others`,
    (first: string, n: number) => `${first} et ${n} ${one(n) ? 'autre' : 'autres'}`,
    (first: string, n: number) => `${first} 和另外 ${n} 人`,
  ],
  /** After the names in bold, under the pill. The French verb agrees with
      who: *vous avez*, *Sam a*, *Sam et Robin ont*. */
  reacted: [
    (_you: boolean, _many: boolean) => ' reacted',
    (you: boolean, many: boolean) => (you ? ' avez réagi' : many ? ' ont réagi' : ' a réagi'),
    (_you: boolean, _many: boolean) => ' 做出了回应',
  ],
  reactedWith: [
    (who: string, emoji: string, _you: boolean, _many: boolean) => `${who} reacted with ${emoji}`,
    (who: string, emoji: string, you: boolean, many: boolean) => `${who} ${you ? 'avez' : many ? 'ont' : 'a'} réagi avec ${emoji}`,
    (who: string, emoji: string, _you: boolean, _many: boolean) => `${who} 用 ${emoji} 做出了回应`,
  ],
  addReaction: ['Add a reaction', 'Ajouter une réaction', '添加回应'],
  fromSlack: ['from Slack', 'depuis Slack', '来自 Slack'],
  edited: ['(edited)', '(modifié)', '（已编辑）'],
  uploading: ['Uploading the file…', 'Ajout du fichier…', '正在上传文件…'],
  madeIntoTask: ['Made into a task', 'Transformé en tâche', '已转为任务'],
  reactWith: [(emoji: string) => `React with ${emoji}`, (emoji: string) => `Réagir avec ${emoji}`, (emoji: string) => `用 ${emoji} 回应`],
  replyInThread: ['Reply in thread', 'Répondre dans le fil de discussion', '在话题中回复'],
  moreActions: ['More actions', 'Plus d’actions', '更多操作'],
  copyMessageLink: ['Copy link', 'Copier le lien', '复制链接'],
  /** A phone's sheet over a held message. */
  messageActions: ['Message actions', 'Actions du message', '消息操作'],
  copyText: ['Copy text', 'Copier le texte', '复制文本'],
  selectText: ['Select text', 'Sélectionner le texte', '选择文本'],
  textCopied: ['Text copied', 'Texte copié', '已复制文本'],
  couldNotCopyText: ['Couldn’t copy the text', 'Impossible de copier le texte', '无法复制文本'],
  noLongerHere: [
    (who: string) =>
      `${!who ? 'They are' : who.includes(',') ? `${who} are` : `${who} is`} no longer in this workspace. You can still read what was said here.`,
    (who: string) =>
      `${!who ? 'Ces personnes ne font' : who.includes(',') ? `${who} ne font` : `${who} ne fait`} plus partie de cet espace de travail. Vous pouvez toujours lire ce qui a été dit ici.`,
    (who: string) => `${!who ? '他们' : who} 已不在此工作区。你仍可阅读这里说过的话。`,
  ],
  linkCopied: ['Link copied', 'Lien copié', '已复制链接'],
  couldNotCopy: ['Couldn’t copy the link', 'Impossible de copier le lien', '无法复制链接'],
  /** How long since a thread last moved. */
  justNow: ['just now', 'à l’instant', '刚刚'],
  minutesAgo: [(n: number) => `${n}m ago`, (n: number) => `il y a ${n} min`, (n: number) => `${n} 分钟前`],
  hoursAgo: [(n: number) => `${n}h ago`, (n: number) => `il y a ${n} h`, (n: number) => `${n} 小时前`],
  daysAgo: [(n: number) => `${n}d ago`, (n: number) => `il y a ${n} j`, (n: number) => `${n} 天前`],
  onDay: [(d: string) => d, (d: string) => `le ${d}`, (d: string) => d],
  replies: [
    (n: number) => (n === 1 ? '1 reply' : `${n} replies`),
    (n: number) => (one(n) ? `${n} réponse` : `${n} réponses`),
    (n: number) => `${n} 条回复`,
  ],
  lastReply: [(when: string) => `Last reply ${when}`, (when: string) => `Dernière réponse ${when}`, (when: string) => `最后回复 ${when}`],
  deleteForEveryone: ['Delete this message for everyone?', 'Supprimer ce message pour tout le monde ?', '为所有人删除此消息？'],
  editMessage: ['Edit message', 'Modifier le message', '编辑消息'],
  deleteMessage: ['Delete message', 'Supprimer le message', '删除消息'],
  thread: ['Thread', 'Fil de discussion', '话题'],
  closeThread: ['Close thread', 'Fermer le fil de discussion', '关闭话题'],
  reply: ['Reply…', 'Répondre…', '回复…'],
  peopleInChat: [
    (said: string) => `People in this chat: ${said}`,
    (said: string) => `Personnes dans cette discussion : ${said}`,
    (said: string) => `此聊天中的人：${said}`,
  ],
  people: [
    (n: number) => (n === 1 ? '1 person' : `${n} people`),
    (n: number) => (one(n) ? `${n} personne` : `${n} personnes`),
    (n: number) => `${n} 人`,
  ],
  youMark: [' · you', ' · vous', ' · 你'],
  owner: ['Owner', 'Propriétaire', '所有者'],
  messageTo: [(name: string) => `Message ${name}`, (name: string) => `Envoyer un message à ${name}`, (name: string) => `给 ${name} 发消息`],
  /** Under the line, who is writing. */
  typing: [
    (names: string[]) =>
      names.length > 3
        ? 'Several people are typing…'
        : names.length === 1
          ? `${names[0]} is typing…`
          : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]} are typing…`,
    (names: string[]) =>
      names.length > 3
        ? 'Plusieurs personnes sont en train d’écrire…'
        : names.length === 1
          ? `${names[0]} est en train d’écrire…`
          : `${names.slice(0, -1).join(', ')} et ${names[names.length - 1]} sont en train d’écrire…`,
    (names: string[]) =>
      names.length > 3
        ? '多人在输入…'
        : names.length === 1
          ? `${names[0]} 正在输入…`
          : `${names.slice(0, -1).join('、')} 和 ${names[names.length - 1]} 正在输入…`,
  ],
  /** Under the line, an agent at work there. */
  working: [
    (names: string[]) =>
      names.length > 3
        ? 'Several agents are working…'
        : names.length === 1
          ? `${names[0]} is working…`
          : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]} are working…`,
    (names: string[]) =>
      names.length > 3
        ? 'Plusieurs agents travaillent…'
        : names.length === 1
          ? `${names[0]} travaille…`
          : `${names.slice(0, -1).join(', ')} et ${names[names.length - 1]} travaillent…`,
    (names: string[]) =>
      names.length > 3
        ? '多个代理正在工作…'
        : names.length === 1
          ? `${names[0]} 正在工作…`
          : `${names.slice(0, -1).join('、')} 和 ${names[names.length - 1]} 正在工作…`,
  ],
  /** And what it says it is doing, in its own words. */
  agentDoing: [
    (name: string, doing: string) => `${name} · ${/[….!?]$/.test(doing) ? doing : `${doing}…`}`,
    (name: string, doing: string) => `${name} · ${/[….!?]$/.test(doing) ? doing : `${doing}…`}`,
    (name: string, doing: string) => `${name} · ${/[….!?]$/.test(doing) ? doing : `${doing}…`}`,
  ],
  /** A reply sent to the room as well — `docs/specs/chat-threads.md`. */
  alsoSendTo: [
    (room: string) => `Also send to ${room}`,
    (room: string) => `Envoyer également à ${room}`,
    (room: string) => `同时发送到 ${room}`,
  ],
  repliedToThread: ['replied to a thread:', 'a répondu à un fil de discussion :', '回复了话题：'],
  alsoSentToRoom: ['Also sent to the channel', 'Également envoyé dans le canal', '同时发送到了频道'],
  /** A message quoted into the line — `docs/specs/chat-composer.md`. */
  quote: ['Quote', 'Citer', '引用'],
  viewMessage: ['View message', 'Voir le message', '查看消息'],
  /** A message posted by an incoming webhook. */
  app: ['App', 'App', '应用'],
})
