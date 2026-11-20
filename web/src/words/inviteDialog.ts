import { one, say } from '../data/words.js'

/** Inviting people — `ui/InviteDialog.tsx`, and its address chips. */
export const INVITE_DIALOG = say({
  removeEmail: [(email: string) => `Remove ${email}`, (email: string) => `Retirer ${email}`],
  emailAddresses: ['Email addresses', 'Adresses e-mail'],
  emailsExample: ['name@company.com, another@company.com', 'nom@entreprise.com, autre@entreprise.com'],
  notMailed: [
    'the invitation was created, but the email wasn’t sent. Create a link for them instead.',
    'l’invitation a été créée, mais l’e-mail n’a pas été envoyé. Créez plutôt un lien pour cette personne.',
  ],
  notSent: ['not sent', 'non envoyée'],
  theLink: ['The link', 'Le lien'],
  linkNotMade: ['couldn’t be created. Try again.', 'impossible de le créer. Réessayez.'],
  refusedLine: [(email: string, why: string) => `${email}: ${why}`, (email: string, why: string) => `${email} : ${why}`],
  invitePeople: ['Invite people', 'Inviter des personnes'],
  inviteMore: ['Invite more', 'Inviter d’autres personnes'],
  done: ['Done', 'Terminé'],
  linkInstead: ['Create a link instead', 'Créer plutôt un lien'],
  sending: ['Sending…', 'Envoi…'],
  sendMany: [(n: number) => `Send ${n} invitations`, (n: number) => `Envoyer ${n} invitations`],
  sendOne: ['Send invitation', 'Envoyer l’invitation'],
  sentTo: [(email: string) => `Sent to ${email}.`, (email: string) => `Envoyée à ${email}.`],
  sentToMany: [(n: number) => `Sent to ${n} people.`, (n: number) => (one(n) ? `Envoyée à ${n} personne.` : `Envoyées à ${n} personnes.`)],
  expires: [
    'Each invitation expires after 7 days. You can cancel it in People & Agents until it’s accepted.',
    'Chaque invitation expire au bout de 7 jours. Vous pouvez l’annuler dans Personnes et agents tant qu’elle n’est pas acceptée.',
  ],
  people: ['People', 'Personnes'],
  peopleHint: [
    'Each address gets its own email invitation, valid for 7 days.',
    'Chaque adresse reçoit sa propre invitation par e-mail, valable 7 jours.',
  ],
  projects: ['Projects', 'Projets'],
  projectsHint: [
    'If you don’t choose any, they join the workspace and can be added to projects later.',
    'Si vous n’en choisissez aucun, ces personnes rejoignent l’espace de travail et pourront être ajoutées à des projets plus tard.',
  ],
  findProject: ['Find a project', 'Trouver un projet'],
  noProjects: ['No projects yet.', 'Aucun projet pour l’instant.'],
  permissions: ['Permissions', 'Autorisations'],
  permissionsHint: [
    'Only someone who manages these projects can give more than new tasks and channels.',
    'Seule une personne qui gère ces projets peut accorder plus que la création de tâches et de canaux.',
  ],
  copy: ['Copy', 'Copier'],
  /* A server of one's own with no mail set up: the invitation's link is
     shown to pass on by hand. */
  byHandTitle: ['This server can’t send email', 'Ce serveur ne peut pas envoyer d’e-mails'],
  byHandHint: [
    'Copy each link and send it to that person yourself. A link works once, only with that email address, and expires in 7 days.',
    'Copiez chaque lien et envoyez-le vous-même à la personne concernée. Un lien ne fonctionne qu’une fois, uniquement avec cette adresse e-mail, et expire au bout de 7 jours.',
  ],
  copyLinkFor: [(email: string) => `Copy the link for ${email}`, (email: string) => `Copier le lien pour ${email}`],
})
