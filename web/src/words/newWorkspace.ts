import { say } from '../data/words.js'

/** A new workspace — `ui/NewWorkspace.tsx`. */
export const NEW_WORKSPACE = say({
  addressTaken: ['That address was just taken.', 'Cette adresse vient d’être prise.'],
  couldntCreate: ['Couldn’t create the workspace. Try again.', 'Impossible de créer l’espace de travail. Réessayez.'],
  /* Refused on a server of one's own with sign-up closed. */
  onlyOwners: [
    'Only this server’s owners can create workspaces.',
    'Seuls les propriétaires de ce serveur peuvent créer des espaces de travail.',
  ],
  newWorkspace: ['New workspace', 'Nouvel espace de travail'],
  creating: ['Creating…', 'Création…'],
  create: ['Create workspace', 'Créer l’espace de travail'],
  name: ['Name', 'Nom'],
  address: ['Address', 'Adresse'],
  icon: ['Icon', 'Icône'],
  removePicture: ['Remove picture', 'Retirer l’image'],
  symbol: ['Symbol', 'Symbole'],
  firstLetter: ['First letter', 'Première lettre'],
  colour: ['Colour', 'Couleur'],
  uploadPicture: ['Upload picture', 'Importer une image'],
  available: ['Available', 'Disponible'],
  shape: ['Use 3 to 40 letters, numbers and hyphens.', 'Utilisez de 3 à 40 lettres, chiffres et tirets.'],
  taken: ['Taken.', 'Déjà prise.'],
  isAvailable: [(slug: string) => `${slug} is available`, (slug: string) => `${slug} est disponible`],
  goToWorkspace: ['Go to the workspace', 'Aller à l’espace de travail'],
  skip: ['Skip', 'Passer'],
  sending: ['Sending…', 'Envoi…'],
  sendMany: [(n: number) => `Send ${n} invitations`, (n: number) => `Envoyer ${n} invitations`],
  sendOne: ['Send invitation', 'Envoyer l’invitation'],
  isReady: [
    (name: string) => `${name} is ready. Who do you want to invite?`,
    (name: string) => `${name} est prêt. Qui voulez-vous inviter ?`,
  ],
  peopleHint: [
    'Each address gets an email invitation, valid for 7 days.',
    'Chaque adresse reçoit une invitation par e-mail, valable 7 jours.',
  ],
  notSentOne: ['This invitation wasn’t sent.', 'Cette invitation n’a pas été envoyée.'],
  notSentMany: [(n: number) => `${n} invitations weren’t sent.`, (n: number) => `${n} invitations n’ont pas été envoyées.`],
})
