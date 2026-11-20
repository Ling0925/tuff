import { say } from '../data/words.js'

/**
 * A project's feedback page — `ui/FeedbackPage.tsx`, the settings section in
 * `ui/FeedbackSettings.tsx` and the line on a task that came from it.
 */
export const FEEDBACK = say({
  /* The public page. */
  title: [(page: string) => `${page} feedback`, (page: string) => `Retours ${page}`],
  askHead: ['Send a request', 'Envoyer une demande'],
  askTitle: ['What would you like?', 'Que souhaitez-vous ?'],
  askBody: ['Tell us more (optional)', 'Dites-nous en plus (facultatif)'],
  askEmail: ['Your email', 'Votre e-mail'],
  emailUse: [
    'We only use your email to confirm your request and tell you about it.',
    'Votre e-mail sert uniquement à confirmer votre demande et à vous en donner des nouvelles.',
  ],
  send: ['Send', 'Envoyer'],
  sending: ['Sending…', 'Envoi…'],
  sendingAs: [(email: string) => `Sending as ${email}`, (email: string) => `Envoi en tant que ${email}`],
  notYou: ['Not you?', 'Ce n’est pas vous ?'],
  checkEmail: ['Check your email', 'Vérifiez votre messagerie'],
  checkEmailBody: [
    (email: string) => `We sent a link to ${email}. Open it to confirm your request.`,
    (email: string) => `Nous avons envoyé un lien à ${email}. Ouvrez-le pour confirmer votre demande.`,
  ],
  sent: ['Request sent', 'Demande envoyée'],
  sentBody: ['Thanks. The team will see it.', 'Merci. L’équipe la verra.'],
  another: ['Send another request', 'Envoyer une autre demande'],
  failed: ['Couldn’t send your request. Try again.', 'Impossible d’envoyer votre demande. Réessayez.'],
  missing: ['This page doesn’t exist.', 'Cette page n’existe pas.'],
  missingBody: ['Check the address and try again.', 'Vérifiez l’adresse et réessayez.'],
  unavailable: ['This page isn’t available right now.', 'Cette page n’est pas disponible pour le moment.'],
  /* The page a mailed link opens. */
  confirmHead: ['Confirm your request', 'Confirmez votre demande'],
  confirmFrom: [(email: string) => `From ${email}`, (email: string) => `De ${email}`],
  confirm: ['Confirm request', 'Confirmer la demande'],
  confirming: ['Confirming…', 'Confirmation…'],
  confirmed: ['Request confirmed', 'Demande confirmée'],
  confirmedBody: ['Thanks. The team will see it.', 'Merci. L’équipe la verra.'],
  linkGone: ['This link has expired or was already used.', 'Ce lien a expiré ou a déjà été utilisé.'],
  backToPage: ['Go to the page', 'Aller à la page'],
  madeWith: ['Made with Tuff', 'Fait avec Tuff'],

  /* The project's settings. */
  head: ['Feedback page', 'Page de retours'],
  on: ['Feedback page', 'Page de retours'],
  hint: [
    'A public page where anyone can send you requests. They arrive as tasks in Triage.',
    'Une page publique où chacun peut vous envoyer des demandes. Elles arrivent sous forme de tâches dans la liste Triage.',
  ],
  address: ['Address', 'Adresse'],
  addressTaken: ['That address is taken.', 'Cette adresse est déjà prise.'],
  addressBad: ['Use 3 to 40 lowercase letters, numbers and dashes.', 'Utilisez de 3 à 40 lettres minuscules, chiffres et tirets.'],
  name: ['Name', 'Nom'],
  intro: ['Intro', 'Introduction'],
  introHint: ['One line at the top of the page', 'Une ligne en haut de la page'],
  copy: ['Copy', 'Copier'],
  copied: ['Copied', 'Copié'],
  open: ['Open', 'Ouvrir'],
  follow: ['Tell me about new requests', 'Me prévenir des nouvelles demandes'],
  addsTriage: ['Turning this on adds a Triage list where requests arrive.', 'L’activer ajoute une liste Triage où arrivent les demandes.'],
  noTriage: [
    'Requests go to your first list. Turn on Triage to review them first.',
    'Les demandes vont dans votre première liste. Activez Triage pour les examiner d’abord.',
  ],
  managersOnly: [
    'Only people who manage this project can change this.',
    'Seules les personnes qui gèrent ce projet peuvent modifier ceci.',
  ],
  couldntSave: ['Couldn’t save. Try again.', 'Impossible d’enregistrer. Réessayez.'],

  /* A task that came from the page. */
  askedBy: [(email: string) => `Asked on the feedback page by ${email}`, (email: string) => `Demandé sur la page de retours par ${email}`],
  asked: ['Asked on the feedback page', 'Demandé sur la page de retours'],
})
