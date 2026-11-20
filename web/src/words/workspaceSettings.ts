import { say } from '../data/words.js'

/** The workspace's settings — `ui/WorkspaceSettings.tsx`: its name and look, the switches, the handover. */
export const WORKSPACE_SETTINGS = say({
  couldNotSave: ['Couldn’t save. Try again.', 'Impossible d’enregistrer. Réessayez.'],
  couldNotUpload: ['Couldn’t upload. Try again.', 'Impossible d’importer. Réessayez.'],
  workspace: ['Workspace', 'Espace de travail'],
  changeIcon: ['Change icon', 'Changer l’icône'],
  workspaceName: ['Workspace name', 'Nom de l’espace de travail'],
  uploading: ['Uploading…', 'Importation…'],
  changePicture: ['Change picture', 'Changer l’image'],
  uploadPicture: ['Upload picture', 'Importer une image'],
  removePicture: ['Remove picture', 'Retirer l’image'],
  symbol: ['Symbol', 'Symbole'],
  firstLetter: ['First letter', 'Première lettre'],
  colour: ['Colour', 'Couleur'],

  creatingProjects: ['Creating projects', 'Création de projets'],
  creatingProjectsHint: [
    'Who can create projects. The owner always can, and you can allow specific people in People & Agents.',
    'Qui peut créer des projets. Le propriétaire le peut toujours, et vous pouvez l’autoriser à certaines personnes dans Personnes et agents.',
  ],
  invitingPeople: ['Inviting people', 'Invitation de personnes'],
  invitingPeopleHint: ['Who can invite people to the workspace.', 'Qui peut inviter des personnes dans l’espace de travail.'],
  editingOthers: ['Editing what others wrote', 'Modification du contenu des autres'],
  editingOthersHint: [
    'Whether members can edit documents and task descriptions written by someone else. Messages and comments can only be edited by their author.',
    'Si les membres peuvent modifier les documents et les descriptions de tâches écrits par quelqu’un d’autre. Les messages et les commentaires ne peuvent être modifiés que par leur auteur.',
  ],
  membersPage: ['People & Agents page', 'Page Personnes et agents'],
  membersPageHint: [
    'Who can open People & Agents, with everyone’s work, weeks and hours. Everyone can still assign tasks to anyone and add them to projects.',
    'Qui peut ouvrir Personnes et agents, avec le travail, les semaines et les heures de chacun. Tout le monde peut toujours attribuer des tâches à n’importe qui et ajouter des personnes aux projets.',
  ],
  everyone: ['Everyone', 'Tout le monde'],
  onlyTheOwner: ['Only the owner', 'Le propriétaire seulement'],
  allowed: ['Allowed', 'Autorisé'],
  notAllowed: ['Not allowed', 'Non autorisé'],
  permissions: ['Permissions', 'Autorisations'],

  owner: ['Owner', 'Propriétaire'],
  deleteWorkspace: ['Delete workspace', 'Supprimer l’espace de travail'],
  deleteWorkspaceEllipsis: ['Delete workspace…', 'Supprimer l’espace de travail…'],
  /* Your own server's last owner who can sign in. */
  deleteLastOwner: [
    'This is the last workspace of this server’s only owner. Add another owner in Server settings first.',
    'C’est le dernier espace de travail du seul propriétaire de ce serveur. Ajoutez d’abord un autre propriétaire dans les paramètres du serveur.',
  ],
  deleteHint: [
    'For everybody in it, at once. We keep it for 30 days in case you change your mind.',
    'Pour tous ses membres, immédiatement. Nous le gardons 30 jours au cas où vous changeriez d’avis.',
  ],
  deleteName: [(name: string) => `Delete “${name}”?`, (name: string) => `Supprimer « ${name} » ?`],
  deleteWhat: [
    (projects: number, people: number, agents: number) =>
      `${projects} ${projects === 1 ? 'project' : 'projects'} with their tasks, chats and files, for ${people} ${people === 1 ? 'person' : 'people'}${agents ? ` and ${agents} ${agents === 1 ? 'agent' : 'agents'}` : ''}. Everybody loses it at once and is told by email.`,
    (projects: number, people: number, agents: number) =>
      `${projects} ${projects <= 1 ? 'projet' : 'projets'} avec leurs tâches, discussions et fichiers, pour ${people} ${people <= 1 ? 'personne' : 'personnes'}${agents ? ` et ${agents} ${agents <= 1 ? 'agent' : 'agents'}` : ''}. Tout le monde le perd immédiatement et en est prévenu par e-mail.`,
  ],
  deleteBack: [
    (support: string) => `We keep it for 30 days: to bring it back, write to ${support}. After that it’s gone for good.`,
    (support: string) => `Nous le gardons 30 jours : pour le récupérer, écrivez à ${support}. Ensuite, il disparaît définitivement.`,
  ],
  /* Your own server, whose owner sets how long it is kept (`PURGE_AFTER_DAYS`). */
  deleteBackOwn: [
    'It isn’t gone for good straight away: to bring it back, ask the owner of this server.',
    'Il n’est pas supprimé définitivement tout de suite : pour le récupérer, demandez au propriétaire de ce serveur.',
  ],
  typeName: [(name: string) => `Type “${name}” to confirm`, (name: string) => `Saisissez « ${name} » pour confirmer`],
  deleting: ['Deleting…', 'Suppression…'],
  deleteGo: ['Delete workspace', 'Supprimer l’espace de travail'],
  couldNotDelete: ['Couldn’t delete the workspace. Try again.', 'Impossible de supprimer l’espace de travail. Réessayez.'],
  handOver: ['Hand over the workspace', 'Transférer l’espace de travail'],
  handOverHint: [
    'Make someone else the owner. You’ll stay as a member, on every project you can open now.',
    'Transférez la propriété à quelqu’un d’autre. Vous resterez membre, sur chaque projet que vous pouvez ouvrir aujourd’hui.',
  ],
  inviteFirst: [
    'Invite someone first. A workspace can only be handed to someone in it.',
    'Invitez d’abord quelqu’un. Un espace de travail ne peut être transféré qu’à l’un de ses membres.',
  ],
  handOverEllipsis: ['Hand over…', 'Transférer…'],
  wrongPasswordOrCode: ['Incorrect password or code. Try again.', 'Mot de passe ou code incorrect. Réessayez.'],
  codeDidNotMatch: [
    'That code didn’t match. Try again, or email yourself a new one.',
    'Ce code ne correspond pas. Réessayez, ou recevez-en un nouveau par e-mail.',
  ],
  wrongPassword: ['Incorrect password. Try again.', 'Mot de passe incorrect. Réessayez.'],
  tooManyAttempts: [
    'Too many attempts. Wait a few minutes and try again.',
    'Trop de tentatives. Patientez quelques minutes, puis réessayez.',
  ],
  couldNotHandOver: ['Couldn’t hand it over. Try again.', 'Impossible de le transférer. Réessayez.'],
  handingOver: ['Handing over…', 'Transfert…'],
  makeTheOwner: [
    (name: string | null) => `Make ${name ?? 'them'} the owner`,
    (name: string | null) => (name ? `Transférer à ${name}` : 'Transférer'),
  ],
  whatTheyWillDo: [
    'They’ll manage the people and every project. You’ll become a member, and only they can make you the owner again.',
    'Cette personne gérera les personnes et tous les projets. Vous deviendrez membre, et seule elle pourra vous rendre la propriété.',
  ],
  newOwner: ['New owner', 'Nouveau propriétaire'],
  yourPassword: ['Your password', 'Votre mot de passe'],
  password: ['Password', 'Mot de passe'],
  codeFromAuthenticator: [
    'Code from your authenticator, or a recovery code',
    'Code de votre application d’authentification, ou code de secours',
  ],
  codeFromEmail: ['Code from your email', 'Code reçu par e-mail'],
})
