import { one, say } from '../data/words.js'

/** A project's tools — `ui/Project.tsx`: the tab menu, Announcements and Files. */
export const PROJECT_SAID = say({
  tooLarge: [
    (mb: number) => `Too large. Files can be up to ${mb} MB.`,
    (mb: number) => `Trop volumineux. Les fichiers peuvent faire jusqu’à ${mb} Mo.`,
  ],
  couldNotUpload: ['Couldn’t upload. Try again.', 'Impossible d’importer. Réessayez.'],
  switchTab: ['Switch tab', 'Changer d’onglet'],
  postsHint: ['Use announcements for news and decisions.', 'Utilisez les annonces pour partager les nouvelles et les décisions.'],
  postsWait: ['When someone posts an announcement, it appears here.', 'Quand quelqu’un publie une annonce, elle apparaît ici.'],
  asked: [(when: string) => ` · asked ${when}`, (when: string) => ` · demandée ${when}`],
  replies: [(n: number) => `${n} ${n === 1 ? 'reply' : 'replies'}`, (n: number) => `${n} ${one(n) ? 'réponse' : 'réponses'}`],
  findInDocs: ['Find in files', 'Rechercher un fichier'],
  addToDocs: ['Add to files', 'Ajouter aux fichiers'],
  uploadFile: ['Upload file', 'Importer un fichier'],
  docsHint: ['Write a document, upload a file or add a link.', 'Rédigez un document, importez un fichier ou ajoutez un lien.'],
  docsWait: ['When someone adds a document, it appears here.', 'Quand quelqu’un ajoute un document, il apparaît ici.'],
  noResults: [(q: string) => `No results for “${q}”.`, (q: string) => `Aucun résultat pour « ${q} ».`],
  noDocuments: ['No documents here yet.', 'Aucun document ici pour l’instant.'],
  noImages: ['No images here yet.', 'Aucune image ici pour l’instant.'],
  noLinks: [
    'No links here yet. Paste a link anywhere on this page to add it.',
    'Aucun lien ici pour l’instant. Collez un lien n’importe où sur cette page pour l’ajouter.',
  ],
  noFiles: ['No uploads here yet.', 'Aucune importation ici pour l’instant.'],
  /* Whose, when it narrows a kind to nothing. */
  noneMine: ['Nothing you added here yet.', 'Rien de ce que vous avez ajouté ici pour l’instant.'],
  noneShared: ['Nothing from others here yet.', 'Rien des autres ici pour l’instant.'],
  /* Leaving a project. */
  leaveProject: ['Leave project', 'Quitter le projet'],
  /* The project's column folded into the sidebar and back.
     Said as where the tools go, which is
     what the press does. */
  toolsToSidebar: ['Show in sidebar', 'Afficher dans la barre latérale'],
  toolsToColumn: ['Show as a column', 'Afficher en colonne'],
  leaveName: [(name: string) => `Leave ${name}?`, (name: string) => `Quitter ${name}\u00a0?`],
  leaveSays: [
    'You’ll no longer see its tasks, chat, files or announcements. Anyone on the project or the workspace owner can add you back.',
    'Vous ne verrez plus ses tâches, discussions, fichiers ni annonces. Une personne du projet ou le propriétaire de l’espace de travail peut vous rajouter.',
  ],
  leaveSaysOwner: [
    'You’ll come off its list of people. As the workspace owner, you can still open it and add yourself back.',
    'Vous ne figurerez plus parmi les personnes du projet. En tant que propriétaire de l’espace de travail, vous pouvez toujours l’ouvrir et vous y rajouter.',
  ],
  leave: ['Leave', 'Quitter'],
  leaving: ['Leaving…', 'Départ…'],
  couldntLeave: ['Couldn’t leave the project. Try again.', 'Impossible de quitter le projet. Réessayez.'],
})
