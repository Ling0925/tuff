import { one, say } from '../data/words.js'

/** The column down the side — `ui/Sidebar.tsx`. */
export const SIDEBAR = say({
  direct: ['Direct', 'Message direct', '私信'],
  /* The place, every room — not a project's tab, which is "Discussion". */
  chat: ['Chat', 'Discussions', '聊天'],
  moreProjects: [
    (n: number) => (n === 1 ? '1 more project' : `${n} more projects`),
    (n: number) => (one(n) ? `${n} autre projet` : `${n} autres projets`),
    (n: number) => `还有 ${n} 个项目`,
  ],
  moreChats: [
    (n: number) => (n === 1 ? '1 more chat' : `${n} more chats`),
    (n: number) => (one(n) ? `${n} autre conversation` : `${n} autres conversations`),
    (n: number) => `还有 ${n} 个对话`,
  ],
  showInList: ['Show in the list', 'Réafficher', '在列表中显示'],
  hide: ['Hide', 'Masquer', '隐藏'],
  /** Over the rooms put away, in an open list — `docs/specs/sidebar-hide.md`. */
  hidden: ['Hidden', 'Masquées', '已隐藏'],
  /** Leaving a channel. */
  leaveChannel: ['Leave channel', 'Quitter le canal', '退出频道'],
  leaveName: [(room: string) => `Leave #${room}?`, (room: string) => `Quitter #${room}\u00a0?`, (room: string) => `退出 #${room}？`],
  leaveChosen: [
    (room: string) => `You’ll stop seeing #${room}. Someone in it can add you back.`,
    (room: string) => `Vous ne verrez plus #${room}. Une personne du canal pourra vous rajouter.`,
    (room: string) => `你将不再看到 #${room}。频道中的成员可以把你加回来。`,
  ],
  leaveOpen: [
    (room: string) =>
      `#${room} stays open to everyone on the project. It moves to More chats, and you’re only notified when someone mentions you.`,
    (room: string) =>
      `#${room} reste ouvert à toutes les personnes du projet. Il passe dans les autres conversations, et vous n’êtes notifié que si quelqu’un vous mentionne.`,
    (room: string) => `#${room} 仍对项目中的所有成员开放。它会移到「更多聊天」，只有有人提及你时才会通知。`,
  ],
  leave: ['Leave', 'Quitter', '退出'],
  leaving: ['Leaving…', 'Départ…', '正在退出…'],
  cancel: ['Cancel', 'Annuler', '取消'],
  couldntLeave: ['Couldn’t leave. Try again.', 'Impossible de quitter. Réessayez.', '无法退出，请重试。'],
  showLess: ['Show less', 'Afficher moins', '显示更少'],
})
