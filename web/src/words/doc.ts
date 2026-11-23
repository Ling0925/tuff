import { one, say } from '../data/words.js'

/** A body, drawn and not edited, and the lightbox over it — `ui/Doc.tsx`. */
export const DOC = say({
  previous: ['Previous', 'Précédent', '上一个'],
  next: ['Next', 'Suivant', '下一个'],
  gone: [
    (name: string) => `${name} — no longer available`,
    (name: string) => `${name} n’est plus disponible`,
    (name: string) => `${name}——已不可用`,
  ],
  /* A picture the reader may not open — put into a document they cannot
     see, or deleted: the server says the same of both, and must. */
  privatePicture: ['Picture unavailable', 'Image indisponible', '图片不可用'],
  offline: [
    (name: string) => `${name} — not available offline`,
    (name: string) => `${name} n’est pas disponible hors ligne`,
    (name: string) => `${name}——离线时不可用`,
  ],
  downloadName: [(name: string) => `Download ${name}`, (name: string) => `Télécharger ${name}`, (name: string) => `下载 ${name}`],
  download: ['Download', 'Télécharger', '下载'],
  /* A file's name when the body did not keep one. */
  file: ['File', 'Fichier', '文件'],
  couldNotShow: ['This couldn’t be shown.', 'Impossible d’afficher ce contenu.', '无法显示此内容。'],
  attachments: [
    (n: number) => (n === 1 ? `${n} attachment` : `${n} attachments`),
    (n: number) => (one(n) ? `${n} pièce jointe` : `${n} pièces jointes`),
    (n: number) => `${n} 个附件`,
  ],
  downloadAll: ['Download all', 'Tout télécharger', '全部下载'],
  open: ['Open', 'Ouvrir', '打开'],
})
