import { one, say } from '../data/words.js'

/** `de Sam`, `d’Anne` — French elides before a vowel. */
const of = (name: string) => (/^[aeiouyàâäéèêëîïôöùûü]/i.test(name) ? `d’${name}` : `de ${name}`)

/** A person's card — `ui/PersonCard.tsx`. Tasks are feminine. */
export const PERSON_CARD = say({
  about: [(name: string) => `About ${name}`, (name: string) => `À propos ${of(name)}`, (name: string) => `关于 ${name}`],
  openTheirPage: ['Open their page in People & Agents', 'Ouvrir sa page dans Personnes et agents', '在「成员与代理」中打开其页面'],
  couldNotLoad: ['Couldn’t load this profile.', 'Impossible de charger ce profil.', '无法加载此资料。'],
  removed: ['No longer in this workspace', 'Ne fait plus partie de cet espace de travail', '已不在此工作区'],
  removedSays: [
    'Their messages and tasks stay where they were. They can’t sign in to this workspace.',
    'Ses messages et ses tâches restent en place. Cette personne ne peut plus se connecter à cet espace de travail.',
    '其消息和任务仍留在原处。此成员无法再登录此工作区。',
  ],
  localTime: [(clock: string) => `${clock} local time`, (clock: string) => `${clock} heure locale`, (clock: string) => `${clock} 本地时间`],
  message: ['Message', 'Envoyer un message', '消息'],
  projectsYouShare: ['Projects you share', 'Projets en commun', '你们共同的项目'],
  nOpen: [(n: number) => `${n} open`, (n: number) => `${n} ${one(n) ? 'ouverte' : 'ouvertes'}`, (n: number) => `${n} 项未完成`],
  nOverdue: [(n: number) => `${n} overdue`, (n: number) => `${n} en retard`, (n: number) => `${n} 项逾期`],
  nDone: [
    (n: number) => `${n} done in 30 days`,
    (n: number) => `${n} ${one(n) ? 'terminée' : 'terminées'} en 30 jours`,
    (n: number) => `30 天内完成 ${n} 项`,
  ],
  assignedTo: [
    (self: boolean, name: string, n: number) => `Assigned to ${self ? 'you' : name} · ${n} open`,
    (self: boolean, name: string, n: number) =>
      `${self ? 'Qui vous sont attribuées' : `Attribuées à ${name}`} · ${n} ${one(n) ? 'ouverte' : 'ouvertes'}`,
    (self: boolean, name: string, n: number) => `指派给${self ? '你' : name} · ${n} 项未完成`,
  ],
})
