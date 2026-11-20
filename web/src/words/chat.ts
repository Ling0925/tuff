import { one, say } from '../data/words.js'

/** A room, its thread and its people — `ui/Chat.tsx`. */
export const CHAT = say({
  today: ['Today', 'Aujourd’hui'],
  yesterday: ['Yesterday', 'Hier'],
  back: ['Back', 'Retour'],
  /** A conversation beside the work. */
  openInChat: ['Open in Chat', 'Ouvrir dans Discussions'],
  close: ['Close', 'Fermer'],
  openBeside: ['Open beside', 'Ouvrir à côté'],
  messageWho: [(name: string) => `Message ${name}`, (name: string) => `Envoyer un message à ${name}`],
  findInConversation: ['Find in this conversation', 'Rechercher dans cette conversation'],
  findInChannel: ['Find in this channel', 'Rechercher dans ce canal'],
  /** What the row of faces says: the names, or how many. */
  peopleCount: [(n: number) => `${n} people`, (n: number) => (one(n) ? `${n} personne` : `${n} personnes`)],
  wholeProject: [' · everyone on the project', ' · toutes les personnes du projet'],
  /** After the first name, on a phone: how many more are in the room. */
  moreNames: [(n: number) => `+${n}`, (n: number) => `+${n}`],
  noMessagesYet: ['No messages yet', 'Aucun message pour l’instant'],
  projectCanSee: ['Everyone on this project can see this chat.', 'Toutes les personnes du projet peuvent voir cette discussion.'],
  channelCanSee: ['Only people in this channel can see it.', 'Seules les personnes de ce canal peuvent le voir.'],
  conversationCanSee: ['Only people in this conversation can see it.', 'Seules les personnes de cette conversation peuvent la voir.'],
  newMessages: [
    (n: number) => (n === 1 ? '1 new message' : `${n} new messages`),
    (n: number) => (one(n) ? `${n} nouveau message` : `${n} nouveaux messages`),
  ],
  noMatch: [(q: string) => `No messages match “${q}”.`, (q: string) => `Aucun message ne correspond à « ${q} ».`],
  hitCount: [
    (n: number, more: boolean) => `${n}${more ? '+' : ''} ${n === 1 ? 'message' : 'messages'}`,
    (n: number, more: boolean) => `${n}${more ? '+' : ''} ${one(n) && !more ? 'message' : 'messages'}`,
  ],
  hitWhen: [
    (day: string, time: string, inThread: boolean) => `${day}, ${time}${inThread ? ' · in a thread' : ''}`,
    (day: string, time: string, inThread: boolean) => `${day}, ${time}${inThread ? ' · dans un fil de discussion' : ''}`,
  ],
  showMore: ['Show more', 'Afficher plus'],
  placeholder: [
    (name: string) => `Message ${name}`.trim(),
    (name: string) => (name ? `Envoyer un message à ${name}` : 'Envoyer un message'),
  ],
  /** A task made from a message with no words in it. */
  messageFrom: [(name: string) => `Message from ${name}`, (name: string) => `Message de ${name}`],
  everyoneOnProject: ['Everyone on the project', 'Toutes les personnes du projet'],
  onlyYou: ['Only you', 'Vous uniquement'],
  selected: [(n: number) => `${n} selected`, (n: number) => (one(n) ? `${n} sélectionnée` : `${n} sélectionnées`)],
  clear: ['Clear', 'Tout désélectionner'],
  selectAll: ['Select all', 'Tout sélectionner'],
  wasDeleted: ['This message was deleted.', 'Ce message a été supprimé.'],
  /** Who reacted: "You", "Sam and You" — "Vous", "Sam et vous" mid-list. */
  you: ['You', 'Vous'],
  youAfter: ['You', 'vous'],
  someone: ['Someone', 'Quelqu’un'],
  andLast: [(first: string, last: string) => `${first} and ${last}`, (first: string, last: string) => `${first} et ${last}`],
  andOthers: [
    (first: string, n: number) => `${first} and ${n} others`,
    (first: string, n: number) => `${first} et ${n} ${one(n) ? 'autre' : 'autres'}`,
  ],
  /** After the names in bold, under the pill. The French verb agrees with
      who: *vous avez*, *Sam a*, *Sam et Robin ont*. */
  reacted: [
    (_you: boolean, _many: boolean) => ' reacted',
    (you: boolean, many: boolean) => (you ? ' avez réagi' : many ? ' ont réagi' : ' a réagi'),
  ],
  reactedWith: [
    (who: string, emoji: string, _you: boolean, _many: boolean) => `${who} reacted with ${emoji}`,
    (who: string, emoji: string, you: boolean, many: boolean) => `${who} ${you ? 'avez' : many ? 'ont' : 'a'} réagi avec ${emoji}`,
  ],
  addReaction: ['Add a reaction', 'Ajouter une réaction'],
  fromSlack: ['from Slack', 'depuis Slack'],
  edited: ['(edited)', '(modifié)'],
  uploading: ['Uploading the file…', 'Ajout du fichier…'],
  madeIntoTask: ['Made into a task', 'Transformé en tâche'],
  reactWith: [(emoji: string) => `React with ${emoji}`, (emoji: string) => `Réagir avec ${emoji}`],
  replyInThread: ['Reply in thread', 'Répondre dans le fil de discussion'],
  moreActions: ['More actions', 'Plus d’actions'],
  copyMessageLink: ['Copy link', 'Copier le lien'],
  /** A phone's sheet over a held message. */
  messageActions: ['Message actions', 'Actions du message'],
  copyText: ['Copy text', 'Copier le texte'],
  selectText: ['Select text', 'Sélectionner le texte'],
  textCopied: ['Text copied', 'Texte copié'],
  couldNotCopyText: ['Couldn’t copy the text', 'Impossible de copier le texte'],
  noLongerHere: [
    (who: string) =>
      `${!who ? 'They are' : who.includes(',') ? `${who} are` : `${who} is`} no longer in this workspace. You can still read what was said here.`,
    (who: string) =>
      `${!who ? 'Ces personnes ne font' : who.includes(',') ? `${who} ne font` : `${who} ne fait`} plus partie de cet espace de travail. Vous pouvez toujours lire ce qui a été dit ici.`,
  ],
  linkCopied: ['Link copied', 'Lien copié'],
  couldNotCopy: ['Couldn’t copy the link', 'Impossible de copier le lien'],
  /** How long since a thread last moved. */
  justNow: ['just now', 'à l’instant'],
  minutesAgo: [(n: number) => `${n}m ago`, (n: number) => `il y a ${n} min`],
  hoursAgo: [(n: number) => `${n}h ago`, (n: number) => `il y a ${n} h`],
  daysAgo: [(n: number) => `${n}d ago`, (n: number) => `il y a ${n} j`],
  onDay: [(d: string) => d, (d: string) => `le ${d}`],
  replies: [(n: number) => (n === 1 ? '1 reply' : `${n} replies`), (n: number) => (one(n) ? `${n} réponse` : `${n} réponses`)],
  lastReply: [(when: string) => `Last reply ${when}`, (when: string) => `Dernière réponse ${when}`],
  deleteForEveryone: ['Delete this message for everyone?', 'Supprimer ce message pour tout le monde ?'],
  editMessage: ['Edit message', 'Modifier le message'],
  deleteMessage: ['Delete message', 'Supprimer le message'],
  thread: ['Thread', 'Fil de discussion'],
  closeThread: ['Close thread', 'Fermer le fil de discussion'],
  reply: ['Reply…', 'Répondre…'],
  peopleInChat: [(said: string) => `People in this chat: ${said}`, (said: string) => `Personnes dans cette discussion : ${said}`],
  people: [(n: number) => (n === 1 ? '1 person' : `${n} people`), (n: number) => (one(n) ? `${n} personne` : `${n} personnes`)],
  youMark: [' · you', ' · vous'],
  owner: ['Owner', 'Propriétaire'],
  messageTo: [(name: string) => `Message ${name}`, (name: string) => `Envoyer un message à ${name}`],
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
  ],
  /** And what it says it is doing, in its own words. */
  agentDoing: [
    (name: string, doing: string) => `${name} · ${/[….!?]$/.test(doing) ? doing : `${doing}…`}`,
    (name: string, doing: string) => `${name} · ${/[….!?]$/.test(doing) ? doing : `${doing}…`}`,
  ],
  /** A reply sent to the room as well — `docs/specs/chat-threads.md`. */
  alsoSendTo: [(room: string) => `Also send to ${room}`, (room: string) => `Envoyer également à ${room}`],
  repliedToThread: ['replied to a thread:', 'a répondu à un fil de discussion :'],
  alsoSentToRoom: ['Also sent to the channel', 'Également envoyé dans le canal'],
  /** A message quoted into the line — `docs/specs/chat-composer.md`. */
  quote: ['Quote', 'Citer'],
  viewMessage: ['View message', 'Voir le message'],
  /** A message posted by an incoming webhook. */
  app: ['App', 'App'],
})
