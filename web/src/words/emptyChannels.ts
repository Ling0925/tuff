import { say } from '../data/words.js'

/** A project's channels nobody is in any more — `ui/projectSettings/emptyChannels.tsx`. */
export const EMPTY_CHANNELS = say({
  head: ['Empty channels', 'Canaux vides'],
  nobody: ['Nobody is in this channel', 'Personne n’est dans ce canal'],
  open: ['Open to the project', 'Ouvrir au projet'],
  remove: ['Delete', 'Supprimer'],
  reveals: [
    (project: string) => `Everyone on ${project} will see this channel’s messages and files.`,
    (project: string) => `Tout le monde dans ${project} verra les messages et les fichiers de ce canal.`,
  ],
  cancel: ['Cancel', 'Annuler'],
  failed: ['Couldn’t change the channel. Try again.', 'Impossible de modifier le canal. Réessayez.'],
})
