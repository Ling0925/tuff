import { one, say } from '../data/words.js'

/** The column down the side — `ui/Sidebar.tsx`. */
export const SIDEBAR = say({
  direct: ['Direct', 'Message direct'],
  /* The place, every room — not a project's tab, which is "Discussion". */
  chat: ['Chat', 'Discussions'],
  moreProjects: [
    (n: number) => (n === 1 ? '1 more project' : `${n} more projects`),
    (n: number) => (one(n) ? `${n} autre projet` : `${n} autres projets`),
  ],
  moreChats: [
    (n: number) => (n === 1 ? '1 more chat' : `${n} more chats`),
    (n: number) => (one(n) ? `${n} autre conversation` : `${n} autres conversations`),
  ],
  showInList: ['Show in the list', 'Réafficher'],
  hide: ['Hide', 'Masquer'],
  /** Over the rooms put away, in an open list — `docs/specs/sidebar-hide.md`. */
  hidden: ['Hidden', 'Masquées'],
  /** Leaving a channel. */
  leaveChannel: ['Leave channel', 'Quitter le canal'],
  leaveName: [(room: string) => `Leave #${room}?`, (room: string) => `Quitter #${room}\u00a0?`],
  leaveChosen: [
    (room: string) => `You’ll stop seeing #${room}. Someone in it can add you back.`,
    (room: string) => `Vous ne verrez plus #${room}. Une personne du canal pourra vous rajouter.`,
  ],
  leaveOpen: [
    (room: string) =>
      `#${room} stays open to everyone on the project. It moves to More chats, and you’re only notified when someone mentions you.`,
    (room: string) =>
      `#${room} reste ouvert à toutes les personnes du projet. Il passe dans les autres conversations, et vous n’êtes notifié que si quelqu’un vous mentionne.`,
  ],
  leave: ['Leave', 'Quitter'],
  leaving: ['Leaving…', 'Départ…'],
  cancel: ['Cancel', 'Annuler'],
  couldntLeave: ['Couldn’t leave. Try again.', 'Impossible de quitter. Réessayez.'],
  showLess: ['Show less', 'Afficher moins'],
})
