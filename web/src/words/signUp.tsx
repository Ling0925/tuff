import type { ReactNode } from 'react'
import { say } from '../data/words.js'

/** Signing up — `ui/SignUp.tsx`. */
export const SIGN_UP = say({
  docTitle: ['Get started — Tuff', 'Commencer — Tuff'],
  tooMany: ['Too many attempts. Wait a few minutes and try again.', 'Trop de tentatives. Patientez quelques minutes et réessayez.'],
  couldntCreate: [
    'Couldn’t create your account. Check the fields and try again.',
    'Impossible de créer votre compte. Vérifiez les champs et réessayez.',
  ],
  couldntReach: [
    'Couldn’t reach Tuff. Check your connection and try again.',
    'Impossible de joindre Tuff. Vérifiez votre connexion et réessayez.',
  ],
  checkEmail: ['Check your email.', 'Consultez vos e-mails.'],
  differentEmail: ['Use a different email', 'Utiliser une autre adresse e-mail'],
  start: ['Start a workspace.', 'Créez un espace de travail.'],
  yourName: ['Your name', 'Votre nom'],
  email: ['Email', 'Adresse e-mail'],
  notAnEmail: ['That doesn’t look like an email address.', 'Cette adresse e-mail ne semble pas valide.'],
  creating: ['Sending…', 'Envoi…'],
  create: ['Continue', 'Continuer'],
  accept: [
    (terms: ReactNode, privacy: ReactNode) => (
      <>
        We’ll email you a link to confirm your email and choose a password. By continuing, you accept the {terms} and the {privacy}.
      </>
    ),
    (terms: ReactNode, privacy: ReactNode) => (
      <>
        Nous vous enverrons un lien pour confirmer votre adresse e-mail et choisir un mot de passe. En continuant, vous acceptez les {terms}{' '}
        et la {privacy}.
      </>
    ),
  ],
  terms: ['terms', 'conditions d’utilisation'],
  privacy: ['privacy policy', 'politique de confidentialité'],
  haveAccount: ['Already have an account?', 'Vous avez déjà un compte ?'],
  signIn: ['Sign in', 'Se connecter'],
  /* A server of one's own with no mail set up. */
  noMailTitle: ['Email isn’t set up.', 'L’envoi d’e-mails n’est pas configuré.'],
  noMail: [
    'This server can’t send email yet, so it can’t send the link you need to sign up. Ask someone here to invite you.',
    'Ce serveur ne peut pas encore envoyer d’e-mails, donc il ne peut pas vous envoyer le lien nécessaire pour vous inscrire. Demandez à quelqu’un qui l’utilise de vous inviter.',
  ],
  /* A server of one's own with sign-up closed. */
  closedTitle: ['Sign-up is closed.', 'Les inscriptions sont fermées.'],
  closed: [
    'This server only lets people in by invitation. Ask someone here to invite you.',
    'Ce serveur n’accepte de nouvelles personnes que sur invitation. Demandez à quelqu’un qui l’utilise de vous inviter.',
  ],
})
