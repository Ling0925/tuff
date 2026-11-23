import { say } from '../data/words.js'

/** The emoji picker — `ui/EmojiPicker.tsx`, `docs/specs/emoji.md`. */
export const EMOJI = say({
  search: ['Search emoji', 'Rechercher un emoji', '搜索 Emoji'],
  recent: ['Recently used', 'Utilisés récemment', '最近使用'],
  people: ['Smileys & people', 'Smileys et personnes', '表情与人物'],
  nature: ['Animals & nature', 'Animaux et nature', '动物与自然'],
  food: ['Food & drink', 'Nourriture et boissons', '食物与饮品'],
  activities: ['Activities', 'Activités', '活动'],
  travel: ['Travel & places', 'Voyages et lieux', '旅行与地点'],
  objects: ['Objects', 'Objets', '物品'],
  symbols: ['Symbols', 'Symboles', '符号'],
  flags: ['Flags', 'Drapeaux', '旗帜'],
  skinTone: ['Skin tone', 'Teint', '肤色'],
  tones: [
    ['Default', 'Light', 'Medium-light', 'Medium', 'Medium-dark', 'Dark'],
    ['Par défaut', 'Clair', 'Moyennement clair', 'Moyen', 'Moyennement foncé', 'Foncé'],
    ['默认', '浅色', '中浅', '中等', '中深', '深色'],
  ],
  noneFound: [(q: string) => `No emoji for “${q}”`, (q: string) => `Aucun emoji pour « ${q} »`, (q: string) => `没有「${q}」的 Emoji`],
  pickOne: ['Pick an emoji', 'Choisissez un emoji', '选择一个 Emoji'],
})
