import { say } from '../data/words.js'

/** The Chats page, every room — `ui/chat/Chats.tsx`. */
export const CHATS = say({
  /* The place, every room — not a project's tab, which is "Discussion". */
  head: ['Chat', 'Discussions', '聊天'],
  start: ['New chat', 'Nouvelle discussion', '新建聊天'],
  /* Direct conversations whose other people were removed or deleted their
     account — docs/specs/sidebar.md, "The Chats page". */
  left: ['People who left', 'Personnes parties', '已离开的成员'],
  leftAbout: [
    'They were removed from the workspace or deleted their account. You can still read these chats.',
    'Ces personnes ont été retirées de l’espace de travail ou ont supprimé leur compte. Vous pouvez toujours lire ces discussions.',
    '他们已被移出工作区或删除了账户。你仍可阅读这些聊天。',
  ],
  direct: ['Direct', 'Message direct', '私信'],
})
