import { one, say } from '../data/words.js'

/** `de Sam`, `d’Anne` — French elides before a vowel. */
const of = (name: string) => (/^[aeiouyàâäéèêëîïôöùûü]/i.test(name) ? `d’${name}` : `de ${name}`)

/** A person's card — `ui/PersonCard.tsx`. Tasks are feminine. */
export const PERSON_CARD = say({
  about: [(name: string) => `About ${name}`, (name: string) => `À propos ${of(name)}`],
  openTheirPage: ['Open their page in People & Agents', 'Ouvrir sa page dans Personnes et agents'],
  couldNotLoad: ['Couldn’t load this profile.', 'Impossible de charger ce profil.'],
  removed: ['No longer in this workspace', 'Ne fait plus partie de cet espace de travail'],
  removedSays: [
    'Their messages and tasks stay where they were. They can’t sign in to this workspace.',
    'Ses messages et ses tâches restent en place. Cette personne ne peut plus se connecter à cet espace de travail.',
  ],
  localTime: [(clock: string) => `${clock} local time`, (clock: string) => `${clock} heure locale`],
  message: ['Message', 'Envoyer un message'],
  projectsYouShare: ['Projects you share', 'Projets en commun'],
  nOpen: [(n: number) => `${n} open`, (n: number) => `${n} ${one(n) ? 'ouverte' : 'ouvertes'}`],
  nOverdue: [(n: number) => `${n} overdue`, (n: number) => `${n} en retard`],
  nDone: [(n: number) => `${n} done in 30 days`, (n: number) => `${n} ${one(n) ? 'terminée' : 'terminées'} en 30 jours`],
  assignedTo: [
    (self: boolean, name: string, n: number) => `Assigned to ${self ? 'you' : name} · ${n} open`,
    (self: boolean, name: string, n: number) =>
      `${self ? 'Qui vous sont attribuées' : `Attribuées à ${name}`} · ${n} ${one(n) ? 'ouverte' : 'ouvertes'}`,
  ],
})
