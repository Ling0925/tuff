import { say } from '../data/words.js'

/** The line a message is written on — `ui/ChatComposer.tsx`. */
export const COMPOSER = say({
  message: ['Message', 'Message'],
  pasteLink: ['Paste or type a link', 'Collez ou saisissez un lien'],
  bold: ['Bold', 'Gras'],
  italic: ['Italic', 'Italique'],
  underline: ['Underline', 'Souligné'],
  strikethrough: ['Strikethrough', 'Barré'],
  link: ['Link', 'Lien'],
  numbered: ['Numbered list', 'Liste numérotée'],
  bulleted: ['Bulleted list', 'Liste à puces'],
  quote: ['Quote', 'Citation'],
  code: ['Code', 'Code'],
  codeBlock: ['Code block', 'Bloc de code'],
  removeGif: ['Remove GIF', 'Retirer le GIF'],
  hideFormatting: ['Hide formatting', 'Masquer la mise en forme'],
  showFormatting: ['Show formatting', 'Afficher la mise en forme'],
  emoji: ['Emoji', 'Emoji'],
  gif: ['GIF', 'GIF'],
  mentionSomeone: ['Mention someone', 'Mentionner une personne'],
  mentionTask: ['Mention a task', 'Mentionner une tâche'],
  mentionDoc: ['Mention a doc', 'Mentionner un document'],
  /** The heading over what `#` found. */
  matching: [
    (only: 'task' | 'doc' | null, q: string) => `${only === 'doc' ? 'Docs' : only === 'task' ? 'Tasks' : 'Tasks and docs'} matching “${q}”`,
    (only: 'task' | 'doc' | null, q: string) =>
      `${only === 'doc' ? 'Documents' : only === 'task' ? 'Tâches' : 'Tâches et documents'} correspondant à « ${q} »`,
  ],
  typeTitleWord: ['Type a word from the title', 'Saisissez un mot du titre'],
  /** The example is a handle from the list — `MYP-61` — or, with none, "a code". */
  typeTitleOrCode: [
    (code: string | null) => `Type a title, a number or ${code ?? 'a code'}`,
    (code: string | null) => `Saisissez un titre, un numéro ou ${code ?? 'un code'}`,
  ],
  noDocs: ['No matching docs in projects you share', 'Aucun document correspondant dans les projets que vous partagez'],
  noTasks: ['No matching tasks in projects you share', 'Aucune tâche correspondante dans les projets que vous partagez'],
  noTasksOrDocs: [
    'No matching tasks or docs in projects you share',
    'Aucune tâche ni aucun document correspondant dans les projets que vous partagez',
  ],
  /** The whole room as one name, in the list under `@` and in the message. */
  everyone: ['everyone', 'tous'],
  everyoneHere: ['Everyone in this room', 'Tout le monde ici'],
  searchKlipy: ['Search KLIPY', 'Rechercher sur KLIPY'],
  gifsFailed: ['Couldn’t load GIFs. Try again.', 'Impossible de charger les GIF. Réessayez.'],
  noGifs: ['No GIFs found.', 'Aucun GIF trouvé.'],
})
