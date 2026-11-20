import { say } from '../data/words.js'

/** What was said under a task, a document or an announcement — `ui/Comments.tsx`. */
export const COMMENTS = say({
  addAComment: ['Add a comment…', 'Ajouter un commentaire…'],
  you: ['You', 'Vous'],
  leaveAReply: ['Leave a reply…', 'Écrire une réponse…'],
  /* A comment is masculine. */
  edited: ['edited', 'modifié'],
  more: ['More', 'Plus'],
  remove: ['Remove', 'Retirer'],
  /* The toast after deleting one. */
  deleted: ['Comment deleted', 'Commentaire supprimé'],
  /* A thread on words in a document.
     Google Docs' words in French. */
  resolve: ['Resolve', 'Résoudre'],
  reopen: ['Reopen', 'Rouvrir'],
  resolvedBy: [(name: string) => `Resolved by ${name}`, (name: string) => `Résolu par ${name}`],
  resolved: ['Resolved', 'Résolu'],
  onDeletedText: ['On deleted text', 'Sur un texte supprimé'],
  showWords: ['Show in the document', 'Afficher dans le document'],
  close: ['Close', 'Fermer'],
  wordsGone: ['Those words are no longer in the document.', 'Ce texte ne figure plus dans le document.'],
  couldNotComment: ['Couldn’t add the comment. Try again.', 'Impossible d’ajouter le commentaire. Réessayez.'],
  /* An agent's question with choices. */
  recommended: ['Recommended', 'Recommandé'],
  answered: [(choice: string) => `Answered: ${choice}`, (choice: string) => `Réponse : ${choice}`],
  couldNotAnswer: ['Couldn’t send your answer. Try again.', 'Impossible d’envoyer votre réponse. Réessayez.'],
})
