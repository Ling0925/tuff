import { say } from '../data/words.js'

/** What was said under a task, a document or an announcement — `ui/Comments.tsx`. */
export const COMMENTS = say({
  addAComment: ['Add a comment…', 'Ajouter un commentaire…', '添加评论…'],
  you: ['You', 'Vous', '你'],
  leaveAReply: ['Leave a reply…', 'Écrire une réponse…', '留下回复…'],
  /* A comment is masculine. */
  edited: ['edited', 'modifié', '已编辑'],
  more: ['More', 'Plus', '更多'],
  remove: ['Remove', 'Retirer', '移除'],
  /* The toast after deleting one. */
  deleted: ['Comment deleted', 'Commentaire supprimé', '评论已删除'],
  /* A thread on words in a document.
     Google Docs' words in French. */
  resolve: ['Resolve', 'Résoudre', '解决'],
  reopen: ['Reopen', 'Rouvrir', '重新打开'],
  resolvedBy: [(name: string) => `Resolved by ${name}`, (name: string) => `Résolu par ${name}`, (name: string) => `由 ${name} 解决`],
  resolved: ['Resolved', 'Résolu', '已解决'],
  onDeletedText: ['On deleted text', 'Sur un texte supprimé', '关于已删除的文本'],
  showWords: ['Show in the document', 'Afficher dans le document', '在文档中显示'],
  close: ['Close', 'Fermer', '关闭'],
  wordsGone: ['Those words are no longer in the document.', 'Ce texte ne figure plus dans le document.', '这些文字已不在文档中。'],
  couldNotComment: ['Couldn’t add the comment. Try again.', 'Impossible d’ajouter le commentaire. Réessayez.', '无法添加评论，请重试。'],
  /* An agent's question with choices. */
  recommended: ['Recommended', 'Recommandé', '推荐'],
  answered: [(choice: string) => `Answered: ${choice}`, (choice: string) => `Réponse : ${choice}`, (choice: string) => `已回答：${choice}`],
  couldNotAnswer: ['Couldn’t send your answer. Try again.', 'Impossible d’envoyer votre réponse. Réessayez.', '无法发送回答，请重试。'],
})
