import { one, say } from '../data/words.js'

/** A body, drawn and not edited, and the lightbox over it — `ui/Doc.tsx`. */
export const DOC = say({
  previous: ['Previous', 'Précédent'],
  next: ['Next', 'Suivant'],
  gone: [(name: string) => `${name} — no longer available`, (name: string) => `${name} n’est plus disponible`],
  /* A picture the reader may not open — put into a document they cannot
     see, or deleted: the server says the same of both, and must. */
  privatePicture: ['Picture unavailable', 'Image indisponible'],
  offline: [(name: string) => `${name} — not available offline`, (name: string) => `${name} n’est pas disponible hors ligne`],
  downloadName: [(name: string) => `Download ${name}`, (name: string) => `Télécharger ${name}`],
  download: ['Download', 'Télécharger'],
  /* A file's name when the body did not keep one. */
  file: ['File', 'Fichier'],
  couldNotShow: ['This couldn’t be shown.', 'Impossible d’afficher ce contenu.'],
  attachments: [
    (n: number) => (n === 1 ? `${n} attachment` : `${n} attachments`),
    (n: number) => (one(n) ? `${n} pièce jointe` : `${n} pièces jointes`),
  ],
  downloadAll: ['Download all', 'Tout télécharger'],
  open: ['Open', 'Ouvrir'],
})
