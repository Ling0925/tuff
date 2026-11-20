import { say } from '../data/words.js'

/** The Chats page, every room — `ui/chat/Chats.tsx`. */
export const CHATS = say({
  /* The place, every room — not a project's tab, which is "Discussion". */
  head: ['Chat', 'Discussions'],
  start: ['New chat', 'Nouvelle discussion'],
  /* Direct conversations whose other people were removed or deleted their
     account — docs/specs/sidebar.md, "The Chats page". */
  left: ['People who left', 'Personnes parties'],
  leftAbout: [
    'They were removed from the workspace or deleted their account. You can still read these chats.',
    'Ces personnes ont été retirées de l’espace de travail ou ont supprimé leur compte. Vous pouvez toujours lire ces discussions.',
  ],
  direct: ['Direct', 'Message direct'],
})
