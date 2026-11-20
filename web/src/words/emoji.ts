import { say } from '../data/words.js'

/** The emoji picker — `ui/EmojiPicker.tsx`, `docs/specs/emoji.md`. */
export const EMOJI = say({
  search: ['Search emoji', 'Rechercher un emoji'],
  recent: ['Recently used', 'Utilisés récemment'],
  people: ['Smileys & people', 'Smileys et personnes'],
  nature: ['Animals & nature', 'Animaux et nature'],
  food: ['Food & drink', 'Nourriture et boissons'],
  activities: ['Activities', 'Activités'],
  travel: ['Travel & places', 'Voyages et lieux'],
  objects: ['Objects', 'Objets'],
  symbols: ['Symbols', 'Symboles'],
  flags: ['Flags', 'Drapeaux'],
  skinTone: ['Skin tone', 'Teint'],
  tones: [
    ['Default', 'Light', 'Medium-light', 'Medium', 'Medium-dark', 'Dark'],
    ['Par défaut', 'Clair', 'Moyennement clair', 'Moyen', 'Moyennement foncé', 'Foncé'],
  ],
  noneFound: [(q: string) => `No emoji for “${q}”`, (q: string) => `Aucun emoji pour « ${q} »`],
  pickOne: ['Pick an emoji', 'Choisissez un emoji'],
})
