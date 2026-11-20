import { say } from '../data/words.js'

/** A document, opened — `ui/FileDetail.tsx`. */
export const FILE_DETAIL = say({
  back: ['Back to Files', 'Retour aux fichiers'],
  /* What a document wears — `docs/specs/docs.md`, "A document's mark". */
  changeLook: ['Change icon and colour', 'Changer l’icône et la couleur'],
  itsIcon: ['Icon', 'Icône'],
  itsColour: ['Colour', 'Couleur'],
  ownLook: ['Default', 'Par défaut'],
  /* Following it. As a task's pill says it. */
  subscribe: ['Subscribe', 'Suivre'],
  subscribed: ['Subscribed', 'Suivi'],
  gone: [
    'This document isn’t available. It may have been deleted, or it’s in a project you’re not on.',
    'Ce document n’est pas disponible. Il a peut-être été supprimé, ou il se trouve dans un projet dont vous ne faites pas partie.',
  ],
  version: [(n: number) => `Version ${n}`, (n: number) => `Version ${n}`],
  /* In the PDF's line of facts, after the author. */
  versionFact: [(n: number) => `version ${n}`, (n: number) => `version ${n}`],
  unsaved: [
    'Couldn’t save. Try again — your changes are still here.',
    'Impossible d’enregistrer. Réessayez — vos modifications sont toujours là.',
  ],
  /* Written together, with the connection down. */
  offline: ['Offline. Your changes will save when you reconnect.', 'Hors ligne. Vos modifications seront enregistrées à la reconnexion.'],
  full: [
    'This document is too large to add more. Remove something to keep writing.',
    'Ce document est trop volumineux pour en ajouter davantage. Supprimez du contenu pour continuer.',
  ],
  outOfDate: ['This page is out of date. Reload to keep editing.', 'Cette page n’est plus à jour. Rechargez-la pour continuer à modifier.'],
  more: ['More', 'Plus d’options'],
  linkCopied: ['Link copied', 'Lien copié'],
  publicLinkCopied: ['Public link copied', 'Lien public copié'],
  couldNotCopy: ['Couldn’t copy link', 'Impossible de copier le lien'],
  noLongerShared: ['No longer shared', 'Partage désactivé'],
  couldNotShare: ['Couldn’t change sharing', 'Impossible de modifier le partage'],
  copyLink: ['Copy link', 'Copier le lien'],
  /* A link's address, changed on its screen — `docs/specs/docs.md`. */
  changeLink: ['Change', 'Modifier'],
  linkAddress: ['Link address', 'Adresse du lien'],
  linkNeedsHttp: ['Use an address that starts with http:// or https://.', 'Utilisez une adresse qui commence par http:// ou https://.'],
  couldntChangeLink: ['Couldn’t change the address. Try again.', 'Impossible de modifier l’adresse. Réessayez.'],
  shareToWeb: ['Share to web', 'Partager sur le web'],
  copyPublicLink: ['Copy public link', 'Copier le lien public'],
  exportPdf: ['Export PDF', 'Exporter en PDF'],
  /* Who a document is for. As Notion and
     Google Docs say it: Publish, Share, Only you. */
  publish: ['Publish', 'Publier'],
  draftOnlyYou: ['Only you can see this draft', 'Vous seul pouvez voir ce brouillon'],
  /* Pictures it shows that were put in before it was private. */
  loosePictures: [
    'Pictures added before it was private are still visible to the project.',
    'Les images ajoutées avant qu’il soit privé restent visibles par le projet.',
  ],
  whoCanSee: ['Who can see it', 'Qui peut le voir'],
  everyoneOnProject: ['Everyone on the project', 'Toutes les personnes du projet'],
  /* The two halves of the panel's choice, short enough for one line each. */
  wholeProject: ['Whole project', 'Tout le projet'],
  chosenPeople: ['Chosen people', 'Personnes choisies'],
  /* Under an agent in the list of who can see it: whose agent it is. */
  agentOf: [(name: string) => `${name}’s agent`, (name: string) => `Agent de ${name}`],
  onlyYou: ['Only you', 'Vous seul'],
  sharedWith: [
    (n: number) => (n === 1 ? 'Shared with 1 person' : `Shared with ${n} people`),
    (n: number) => (n === 1 ? 'Partagé avec 1 personne' : `Partagé avec ${n} personnes`),
  ],
  draft: ['Draft', 'Brouillon'],
  /* A document named somewhere it is not seen: its chip, with no name. */
  privateDocument: ['Private document', 'Document privé'],
  published: ['Published', 'Publié'],
  accessSaved: ['Saved', 'Enregistré'],
  couldNotPublish: ['Couldn’t publish. Try again.', 'Impossible de publier. Réessayez.'],
})
