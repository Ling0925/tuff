import type { ReactNode } from 'react'
import { one, say } from '../data/words.js'

/** The ways in before the app — `ui/Access.tsx`: the password field, the wait for a link, the link's page, a forgotten password. */
export const ACCESS = say({
  password: ['Password', 'Mot de passe'],
  hidePassword: ['Hide password', 'Masquer le mot de passe'],
  showPassword: ['Show password', 'Afficher le mot de passe'],
  longEnough: ['Long enough', 'Assez long'],
  atLeastForNew: ['At least 12 characters for a new account', 'Au moins 12 caractères pour un nouveau compte'],
  atLeast: ['At least 12 characters', 'Au moins 12 caractères'],
  moreCharacters: [(n: number) => `${n} more character${one(n) ? '' : 's'}`, (n: number) => `Encore ${n} caractère${one(n) ? '' : 's'}`],

  weSentTo: [
    (email: ReactNode) => <>We sent a link to {email}. Open it to confirm your email and choose a password.</>,
    (email: ReactNode) => (
      <>Nous avons envoyé un lien à {email}. Ouvrez-le pour confirmer votre adresse e-mail et choisir un mot de passe.</>
    ),
  ],
  linkWorks: [
    'The link works for 24 hours. Can’t find it? Check your spam folder, or send another.',
    'Le lien est valable 24 heures. Vous ne le trouvez pas ? Vérifiez vos spams, ou demandez-en un autre.',
  ],
  openInbox: [(name: string) => `Open ${name}`, (name: string) => `Ouvrir ${name}`],
  sending: ['Sending…', 'Envoi…'],
  sentSendAnotherIn: [(s: number) => `Sent. Send another in ${s}s`, (s: number) => `Envoyé. Renvoyer dans ${s} s`],
  sendAnotherIn: [(s: number) => `Send another in ${s}s`, (s: number) => `Renvoyer dans ${s} s`],
  sendAnother: ['Send another', 'Renvoyer'],
  couldntSend: ['Couldn’t send it. Wait a moment and try again.', 'Impossible de l’envoyer. Patientez un instant et réessayez.'],

  confirmingTitle: ['Confirming your email — Tuff', 'Confirmation de votre adresse e-mail — Tuff'],
  confirming: ['Confirming…', 'Confirmation…'],
  confirmed: ['Email confirmed.', 'Adresse e-mail confirmée.'],
  changed: ['Email changed.', 'Adresse e-mail modifiée.'],
  approved: ['Change approved.', 'Modification approuvée.'],
  taken: ['Email not changed.', 'Adresse e-mail non modifiée.'],
  gone: ['This link is no longer valid.', 'Ce lien n’est plus valide.'],
  failed: ['That didn’t work.', 'Cela n’a pas fonctionné.'],
  saidConfirmed: ['Your email is confirmed. Sign in to continue.', 'Votre adresse e-mail est confirmée. Connectez-vous pour continuer.'],
  saidChanged: [
    (email: string) => `From now on, you sign in with ${email}, and emails from Tuff go there.`,
    (email: string) => `Désormais, vous vous connectez avec ${email}, et les e-mails de Tuff y sont envoyés.`,
  ],
  saidApproved: [
    (email: string) => `We sent a link to ${email}. Open it to finish the change.`,
    (email: string) => `Nous avons envoyé un lien à ${email}. Ouvrez-le pour terminer la modification.`,
  ],
  saidTaken: ['That email already belongs to another account.', 'Cette adresse e-mail appartient déjà à un autre compte.'],
  saidGoneMoving: [
    'It was already used or cancelled, or it’s more than a day old. Ask for a new one in Account.',
    'Il a déjà été utilisé ou annulé, ou date de plus d’un jour. Demandez-en un nouveau dans Compte.',
  ],
  saidGone: [
    'It was already used, or it’s more than a day old. Sign up again with the same email to get a new one.',
    'Il a déjà été utilisé, ou date de plus d’un jour. Inscrivez-vous de nouveau avec la même adresse e-mail pour en recevoir un nouveau.',
  ],
  saidFailed: [
    'Couldn’t reach Tuff. Check your connection and open the link again.',
    'Impossible de joindre Tuff. Vérifiez votre connexion et rouvrez le lien.',
  ],
  openTuff: ['Open Tuff', 'Ouvrir Tuff'],
  signIn: ['Sign in', 'Se connecter'],

  /* A change of address's link, before and after the press, */
  askConfirm: ['Confirm your new email.', 'Confirmez votre nouvelle adresse e-mail.'],
  saidAskConfirm: [
    (email: string, name: string, now: string) =>
      `${email} will be the email for your Tuff account, ${name} (${now}). You’ll sign in with it from now on.`,
    (email: string, name: string, now: string) =>
      `${email} deviendra l’adresse e-mail de votre compte Tuff, ${name} (${now}). Vous vous connecterez désormais avec elle.`,
  ],
  confirm: ['Confirm', 'Confirmer'],
  askApprove: ['Approve the new email.', 'Approuvez la nouvelle adresse e-mail.'],
  saidAskApprove: [
    (email: string, name: string, now: string) =>
      `Someone signed in to the Tuff account ${name} (${now}) asked to change its email to ${email}. If you approve, we’ll send a link to that address to finish.`,
    (email: string, name: string, now: string) =>
      `Une personne connectée au compte Tuff ${name} (${now}) a demandé à remplacer son adresse e-mail par ${email}. Si vous approuvez, nous enverrons un lien à cette adresse pour terminer.`,
  ],
  approve: ['Approve', 'Approuver'],
  approving: ['Approving…', 'Approbation…'],
  signInToConfirm: ['Sign in to confirm.', 'Connectez-vous pour confirmer.'],
  saidSignInToConfirm: [
    (email: string, name: string, now: string) =>
      `This link changes the email of the Tuff account ${name} (${now}) to ${email}. To confirm, sign in to that account.`,
    (email: string, name: string, now: string) =>
      `Ce lien remplace l’adresse e-mail du compte Tuff ${name} (${now}) par ${email}. Pour confirmer, connectez-vous à ce compte.`,
  ],
  saidOtherAccount: [
    (email: string, name: string, now: string) =>
      `You’re signed in to a different account. This link changes the email of the Tuff account ${name} (${now}) to ${email}. To confirm, sign in to that account.`,
    (email: string, name: string, now: string) =>
      `Vous êtes connecté à un autre compte. Ce lien remplace l’adresse e-mail du compte Tuff ${name} (${now}) par ${email}. Pour confirmer, connectez-vous à ce compte.`,
  ],
  signInToAnother: ['Sign in to another account', 'Se connecter à un autre compte'],
  ignoreIfNotYou: [
    'If you didn’t ask for this change, ignore the email. Nothing will change.',
    'Si vous n’avez pas demandé ce changement, ignorez l’e-mail. Rien ne changera.',
  ],

  withGoogle: ['Continue with Google', 'Continuer avec Google'],
  withApple: ['Continue with Apple', 'Continuer avec Apple'],
  withGithub: ['Continue with GitHub', 'Continuer avec GitHub'],
  orWithEmail: ['or with email', 'ou par e-mail'],
  troubleConflict: [
    'An account with that email already exists, and the provider didn’t confirm it’s yours. Sign in with your password instead.',
    'Un compte existe déjà avec cette adresse e-mail, et le fournisseur n’a pas confirmé qu’il vous appartient. Connectez-vous plutôt avec votre mot de passe.',
  ],
  troubleGithub: [
    'An account with that email already exists. Sign in the way you usually do.',
    'Un compte existe déjà avec cette adresse e-mail. Connectez-vous comme d’habitude.',
  ],
  troubleNoEmail: [
    'Your GitHub account has no verified email. Add one on GitHub, or sign up with your email.',
    'Votre compte GitHub n’a aucune adresse e-mail vérifiée. Ajoutez-en une sur GitHub, ou inscrivez-vous avec votre adresse e-mail.',
  ],
  troubleExpired: ['That took too long. Try again.', 'Le délai est dépassé. Réessayez.'],
  troubleOff: ['This sign-in method isn’t set up.', 'Ce mode de connexion n’est pas configuré.'],
  troubleFailed: [
    'Couldn’t sign you in. Try again, or sign in with your email.',
    'Impossible de vous connecter. Réessayez, ou connectez-vous avec votre adresse e-mail.',
  ],
  closedTitle: ['Sign-up is closed.', 'Les inscriptions sont fermées.'],
  troubleClosed: [
    'Sign-up is closed on this server. Ask someone here for an invitation.',
    'Les inscriptions sont fermées sur ce serveur. Demandez une invitation à quelqu’un qui l’utilise.',
  ],
  /* A link handed over by hand, followed with a provider's account at
     another address. */
  troubleElsewhere: [
    'This invitation is for a different email address. Continue with the account for that address, or sign up with it below.',
    'Cette invitation est destinée à une autre adresse e-mail. Continuez avec le compte de cette adresse, ou inscrivez-vous avec elle ci-dessous.',
  ],

  forgotTitle: ['Forgot your password — Tuff', 'Mot de passe oublié — Tuff'],
  forgot: ['Forgot your password?', 'Mot de passe oublié ?'],
  forgotSent: [
    (email: string) => `If there’s an account for ${email}, we sent a link to set a new password. It works for an hour.`,
    (email: string) =>
      `Si un compte existe pour ${email}, nous avons envoyé un lien pour définir un nouveau mot de passe. Il est valable une heure.`,
  ],
  forgotAsk: [
    'Enter your email and we’ll send you a link to set a new password.',
    'Saisissez votre adresse e-mail et nous vous enverrons un lien pour définir un nouveau mot de passe.',
  ],
  email: ['Email', 'Adresse e-mail'],
  sendLink: ['Send link', 'Envoyer le lien'],
  /* Your own server with no mail set up. */
  forgotNoMail: [
    'This server can’t send email yet, so it can’t send you a link to reset your password. Ask the server’s owner to set up email in Server settings.',
    'Ce serveur ne peut pas encore envoyer d’e-mails, donc il ne peut pas vous envoyer de lien pour réinitialiser votre mot de passe. Demandez au propriétaire du serveur de configurer l’envoi d’e-mails dans les paramètres du serveur.',
  ],
  unconfirmedTitle: ['Your email isn’t confirmed.', 'Votre adresse e-mail n’est pas confirmée.'],
  unconfirmedNoMail: [
    'This server can’t send email yet, so it can’t send you the link to confirm it. Ask the server’s owner to set up email, or to invite you again.',
    'Ce serveur ne peut pas encore envoyer d’e-mails, donc il ne peut pas vous envoyer le lien pour la confirmer. Demandez au propriétaire du serveur de configurer l’envoi d’e-mails, ou de vous inviter à nouveau.',
  ],
  backToSignIn: ['Back to sign in', 'Retour à la connexion'],

  resetTitle: ['Set a new password — Tuff', 'Nouveau mot de passe — Tuff'],
  reset: ['Set a new password.', 'Définissez un nouveau mot de passe.'],
  resetDone: [
    'Password changed. Every device that was signed in with the old password has been signed out.',
    'Mot de passe modifié. Tous les appareils connectés avec l’ancien mot de passe ont été déconnectés.',
  ],
  resetGone: [
    (askAgain: ReactNode) => <>This link was already used or has expired. {askAgain}.</>,
    (askAgain: ReactNode) => <>Ce lien a déjà été utilisé ou a expiré. {askAgain}.</>,
  ],
  askNew: ['Ask for a new one', 'Demandez-en un nouveau'],
  newPassword: ['New password', 'Nouveau mot de passe'],
  couldntSet: ['Couldn’t set the password. Try again.', 'Impossible de définir le mot de passe. Réessayez.'],
  setPassword: ['Set password', 'Définir le mot de passe'],

  /* The first password, chosen from the sign-up letter — or from an old
     confirmation link, which took the one the account held. */
  chooseTitle: ['Choose a password — Tuff', 'Choisir un mot de passe — Tuff'],
  choose: ['Choose a password.', 'Choisissez un mot de passe.'],
  saidChoose: [
    'Choose a password to finish signing up. You’ll use it with your email to sign in.',
    'Choisissez un mot de passe pour terminer votre inscription. Vous l’utiliserez avec votre adresse e-mail pour vous connecter.',
  ],
  chooseDone: ['Password set. Sign in to continue.', 'Mot de passe défini. Connectez-vous pour continuer.'],
})
