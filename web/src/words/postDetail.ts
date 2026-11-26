import { say } from '../data/words.js'

/** An announcement, opened — `ui/PostDetail.tsx`. */
export const POST_DETAIL = say({
  back: ['Back to Announcements', 'Retour aux annonces', '返回公告'],
  /* Following it. As a task's pill says it. */
  subscribe: ['Subscribe', 'Suivre', '订阅'],
  subscribed: ['Subscribed', 'Suivie', '已订阅'],
  gone: [
    'This announcement isn’t available. It may have been deleted, or it’s in a project you’re not on.',
    'Cette annonce n’est pas disponible. Elle a peut-être été supprimée, ou elle se trouve dans un projet dont vous ne faites pas partie.',
    '此公告不可用。它可能已被删除，或位于你未加入的项目中。',
  ],
  unsaved: [
    'Couldn’t save. Try again — your changes are still here.',
    'Impossible d’enregistrer. Réessayez — vos modifications sont toujours là.',
    '保存失败。请重试——你的修改仍在。',
  ],
  more: ['More', 'Plus d’options', '更多'],
  linkCopied: ['Link copied', 'Lien copié', '已复制链接'],
  couldNotCopy: ['Couldn’t copy link', 'Impossible de copier le lien', '无法复制链接'],
  copyLink: ['Copy link', 'Copier le lien', '复制链接'],
  deletePost: ['Delete announcement', 'Supprimer l’annonce', '删除公告'],
  /* On an agent's announcement, to whoever may change it — its title and
     words open until Done. */
  editPost: ['Edit announcement', 'Modifier l’annonce', '编辑公告'],
  doneEditing: ['Done', 'Terminé', '完成'],
  deleteTheirs: [
    (who: string) => `Delete ${who}’s announcement for everyone? You can undo this right after.`,
    (who: string) => `Supprimer l’annonce de ${who} pour tout le monde ? Vous pourrez annuler juste après.`,
    (who: string) => `为所有人删除 ${who} 的公告？操作后可以立即撤销。`,
  ],
  /* The toast after it. */
  deleted: [(title: string) => `Deleted ${title}`, (title: string) => `Annonce supprimée : ${title}`, (title: string) => `已删除 ${title}`],
  keep: ['Cancel', 'Annuler', '取消'],
  deleteIt: ['Delete', 'Supprimer', '删除'],
  /* After the date: how often a check-in is asked, as its author wrote it —
     "Every Monday". */
  asked: [
    (schedule: string) => ` · asked ${schedule}`,
    (schedule: string) => ` · posée ${schedule}`,
    (schedule: string) => ` · 提问于 ${schedule}`,
  ],
  whatAbout: ['What is it about?', 'De quoi s’agit-il ?', '这是关于什么的？'],
  nothingWritten: ['Nothing written yet.', 'Rien d’écrit pour l’instant.', '还没有写任何内容。'],
  /* An announcement kept as its author's draft.
     As a document's draft says it (`words/fileDetail.ts`). */
  draft: ['Draft', 'Brouillon', '草稿'],
  publish: ['Publish', 'Publier', '发布'],
  draftOnlyYou: ['Only you can see this draft', 'Vous seul pouvez voir ce brouillon', '只有你能看到此草稿'],
  couldNotPublish: ['Couldn’t publish. Try again.', 'Impossible de publier. Réessayez.', '发布失败，请重试。'],
})
