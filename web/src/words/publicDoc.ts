import { say } from '../data/words.js'

/** A document shared to the web — `ui/PublicDoc.tsx`. */
export const PUBLIC_DOC = say({
  theme: ['Theme', 'Thème'],
  system: ['System', 'Système'],
  light: ['Light', 'Clair'],
  dark: ['Dark', 'Sombre'],
  notSharedTitle: ['Not shared — Tuff', 'Non partagé — Tuff'],
  notShared: ['This document isn’t shared.', 'Ce document n’est pas partagé.'],
  notSharedBody: [
    'The link may have been turned off, or the document deleted.',
    'Le lien a peut-être été désactivé, ou le document supprimé.',
  ],
  updated: [(date: string) => `Updated ${date}`, (date: string) => `Mis à jour le ${date}`],
  madeWith: ['Made with Tuff', 'Fait avec Tuff'],
})
