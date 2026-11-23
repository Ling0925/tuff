import { say } from '../data/words.js'

/** A project's channels nobody is in any more — `ui/projectSettings/emptyChannels.tsx`. */
export const EMPTY_CHANNELS = say({
  head: ['Empty channels', 'Canaux vides', '空频道'],
  nobody: ['Nobody is in this channel', 'Personne n’est dans ce canal', '此频道中没有人'],
  open: ['Open to the project', 'Ouvrir au projet', '向项目开放'],
  remove: ['Delete', 'Supprimer', '删除'],
  reveals: [
    (project: string) => `Everyone on ${project} will see this channel’s messages and files.`,
    (project: string) => `Tout le monde dans ${project} verra les messages et les fichiers de ce canal.`,
    (project: string) => `${project} 中的所有成员都能看到此频道的消息和文件。`,
  ],
  cancel: ['Cancel', 'Annuler', '取消'],
  failed: ['Couldn’t change the channel. Try again.', 'Impossible de modifier le canal. Réessayez.', '无法更改频道，请重试。'],
})
