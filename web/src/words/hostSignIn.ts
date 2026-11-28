import { say } from '../data/words.js'

/** Signing in on a workspace's own domain — `ui/app/hostSignIn.tsx`. */
export const HOST_SIGN_IN = say({
  signInTo: [(name: string) => `Sign in to ${name}`, (name: string) => `Connectez-vous à ${name}`],
  email: ['Email', 'E-mail'],
  sendCode: ['Email me a code', 'M’envoyer un code par e-mail'],
  sentTo: [
    (email: string) => `We sent a code to ${email}. It works for ten minutes.`,
    (email: string) => `Nous avons envoyé un code à ${email}. Il est valable dix minutes.`,
  ],
  noCode: [
    'No email? Check the address, or ask the person who invited you to add it.',
    'Pas d’e-mail ? Vérifiez l’adresse, ou demandez à la personne qui vous a invité de l’ajouter.',
  ],
  code: ['Code from the email', 'Code reçu par e-mail'],
  signIn: ['Sign in', 'Se connecter'],
  otherAddress: ['Use another email', 'Utiliser une autre adresse e-mail'],
  newCode: ['Send a new code', 'Envoyer un nouveau code'],
  appCode: ['Code from your app, or a recovery code', 'Code de votre application, ou code de secours'],
  wrongCode: [
    'That code didn’t work. Check it, or ask for a new one.',
    'Ce code n’a pas fonctionné. Vérifiez-le, ou demandez-en un nouveau.',
  ],
  tooMany: ['Too many attempts. Try again in a few minutes.', 'Trop de tentatives. Réessayez dans quelques minutes.'],
  couldNotSend: ['Couldn’t send the code. Try again.', 'Impossible d’envoyer le code. Réessayez.'],
  tuffAccount: ['Use your Tuff account', 'Utilisez votre compte Tuff'],
  notIn: [(name: string) => `This account isn’t in ${name}.`, (name: string) => `Ce compte ne fait pas partie de ${name}.`],
  providerFailed: [
    'Signing in that way didn’t work here. Use a code from your email instead.',
    'Cette connexion n’a pas fonctionné ici. Utilisez plutôt un code reçu par e-mail.',
  ],
  expired: ['Your sign-in expired. Sign in again.', 'Votre connexion a expiré. Reconnectez-vous.'],
  security: ['Sign-in and security', 'Connexion et sécurité'],
  securityHint: [
    'Your password, two-factor authentication, devices and connected apps are changed on Tuff.',
    'Votre mot de passe, l’authentification à deux facteurs, vos appareils et vos applications connectées se modifient sur Tuff.',
  ],
  openTuff: ['Open', 'Ouvrir'],
})
