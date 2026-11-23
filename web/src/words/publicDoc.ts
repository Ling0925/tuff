import { say } from '../data/words.js'

/** A document shared to the web — `ui/PublicDoc.tsx`. */
export const PUBLIC_DOC = say({
  theme: ['Theme', 'Thème', '主题'],
  system: ['System', 'Système', '跟随系统'],
  light: ['Light', 'Clair', '浅色'],
  dark: ['Dark', 'Sombre', '深色'],
  notSharedTitle: ['Not shared — Tuff', 'Non partagé — Tuff', '未共享 — Tuff'],
  notShared: ['This document isn’t shared.', 'Ce document n’est pas partagé.', '此文档未共享。'],
  notSharedBody: [
    'The link may have been turned off, or the document deleted.',
    'Le lien a peut-être été désactivé, ou le document supprimé.',
    '链接可能已被关闭，或文档已被删除。',
  ],
  updated: [(date: string) => `Updated ${date}`, (date: string) => `Mis à jour le ${date}`, (date: string) => `更新于 ${date}`],
  madeWith: ['Made with Tuff', 'Fait avec Tuff', '由 Tuff 制作'],
})
