import type { ReactNode } from 'react'
import { one, say } from '../data/words.js'

/** Account — `ui/Account.tsx`: profile, password, tokens, two-factor, notifications, devices and your data. */
export const ACCOUNT = say({
  /* Leaving the workspace. */
  leaveWorkspace: ['Leave workspace', 'Quitter l’espace de travail'],
  leaveWorkspaceHint: [
    (ws: string) => `Leave ${ws}. You can be invited back.`,
    (ws: string) => `Quitter ${ws}. Vous pourrez y être invité à nouveau.`,
  ],
  leaveEllipsis: ['Leave…', 'Quitter…'],
  leaveName: [(ws: string) => `Leave ${ws}?`, (ws: string) => `Quitter ${ws}\u00a0?`],
  leaveLoses: ['You’ll lose access to its projects and chats.', 'Vous n’aurez plus accès à ses projets ni à ses discussions.'],
  leaveKeeps: ['What you made stays, under your name.', 'Ce que vous avez créé reste, à votre nom.'],
  leaveBack: ['Someone can invite you back.', 'Quelqu’un pourra vous inviter à nouveau.'],
  leaveGo: ['Leave workspace', 'Quitter l’espace de travail'],
  leavingWs: ['Leaving…', 'Départ…'],
  couldntLeave: ['Couldn’t leave. Try again.', 'Impossible de quitter. Réessayez.'],
  ownerCantLeave: [
    (ws: string) => `You own ${ws}. Hand it over to someone else before you leave.`,
    (ws: string) => `Vous êtes propriétaire de ${ws}. Transférez-le à quelqu’un d’autre avant de partir.`,
  ],
  handOver: ['Hand over', 'Transférer'],
  picture: ['Picture', 'Photo'],
  uploading: ['Uploading…', 'Importation…'],
  pictureHint: [
    'PNG, JPEG, GIF, WebP or SVG. Large images are resized.',
    'PNG, JPEG, GIF, WebP ou SVG. Les grandes images sont redimensionnées.',
  ],
  change: ['Change', 'Modifier'],
  uploadPicture: ['Upload picture', 'Importer une photo'],
  couldntUpload: ['Couldn’t upload. Try again.', 'Impossible d’importer. Réessayez.'],
  name: ['Name', 'Nom'],
  nameHint: ['Shown to everyone in your workspaces.', 'Visible par tous dans vos espaces de travail.'],
  yourName: ['Your name', 'Votre nom'],
  title: ['Title', 'Fonction'],
  titleHint: ['Shown under your name on your profile card.', 'Affichée sous votre nom sur votre carte de profil.'],
  titleExample: ['Designer, Head of sales…', 'Designer, responsable des ventes…'],
  email: ['Email', 'Adresse e-mail'],
  /* The digest's switch: the mail itself, not the address it goes to. */
  emailDigest: ['Email', 'E-mail'],
  approveFirst: [
    (from: string, to: string) => `Approve the change in the email sent to ${from}. Then a link will be sent to ${to}.`,
    (from: string, to: string) => `Approuvez la modification dans l’e-mail envoyé à ${from}. Un lien sera ensuite envoyé à ${to}.`,
  ],
  yourCurrentAddress: ['your current address', 'votre adresse actuelle'],
  openLinkSentTo: [
    (to: string) => `Open the link sent to ${to} to finish the change.`,
    (to: string) => `Ouvrez le lien envoyé à ${to} pour terminer la modification.`,
  ],
  sent: ['Sent', 'Envoyé'],
  sendAgain: ['Send again', 'Renvoyer'],
  cancel: ['Cancel', 'Annuler'],
  emailHint: ['Used for signing in and for email from Tuff.', 'Pour vous connecter et recevoir les e-mails de Tuff.'],
  password: ['Password', 'Mot de passe'],
  noPasswordYet: [
    'Your account doesn’t have a password yet. Set one to sign in with your email too.',
    'Votre compte n’a pas encore de mot de passe. Définissez-en un pour vous connecter aussi avec votre adresse e-mail.',
  ],
  changingSignsOut: ['Changing it signs you out on your other devices.', 'Le modifier vous déconnecte de vos autres appareils.'],
  linkToSet: [
    (email: string) => `We sent a link to ${email}. Open it to set your password.`,
    (email: string) => `Nous avons envoyé un lien à ${email}. Ouvrez-le pour définir votre mot de passe.`,
  ],
  couldntSendLink: ['Couldn’t send the link. Try again.', 'Impossible d’envoyer le lien. Réessayez.'],
  setPassword: ['Set password', 'Définir un mot de passe'],
  passwordChanged: ['Password changed.', 'Mot de passe modifié.'],
  passwordChangedOut: [
    (n: number) => `Password changed. ${n === 1 ? 'Your other device was' : `${n} other devices were`} signed out.`,
    (n: number) =>
      one(n)
        ? 'Mot de passe modifié. Votre autre appareil a été déconnecté.'
        : `Mot de passe modifié. ${n} autres appareils ont été déconnectés.`,
  ],

  wrongPasswordOrCode: ['Incorrect password or code. Try again.', 'Mot de passe ou code incorrect. Réessayez.'],
  wrongPassword: ['Incorrect password. Try again.', 'Mot de passe incorrect. Réessayez.'],
  tooManyTries: ['Too many tries. Wait a few minutes and try again.', 'Trop de tentatives. Patientez quelques minutes et réessayez.'],
  tooManyAttempts: ['Too many attempts. Wait a few minutes and try again.', 'Trop de tentatives. Patientez quelques minutes et réessayez.'],
  changeYourEmail: ['Change your email', 'Modifier votre adresse e-mail'],
  sending: ['Sending…', 'Envoi…'],
  sendTheLink: ['Send the link', 'Envoyer le lien'],
  approveByInbox: [
    (email: string) =>
      `Your account has no password, so first approve the change in an email sent to ${email}. Then a link will be sent to the new address.`,
    (email: string) =>
      `Votre compte n’a pas de mot de passe : approuvez d’abord la modification dans l’e-mail envoyé à ${email}. Un lien sera ensuite envoyé à la nouvelle adresse.`,
  ],
  linkToNew: [
    (email: string) => `A link will be sent to the new address. Open it to finish the change. Until then, you sign in with ${email}.`,
    (email: string) =>
      `Un lien sera envoyé à la nouvelle adresse. Ouvrez-le pour terminer la modification. D’ici là, vous vous connectez avec ${email}.`,
  ],
  newEmail: ['New email', 'Nouvelle adresse e-mail'],
  yourPassword: ['Your password', 'Votre mot de passe'],
  codeOrRecovery: ['Code from your authenticator, or a recovery code', 'Code de votre application d’authentification, ou code de secours'],
  couldntChangePassword: ['Couldn’t change the password. Try again.', 'Impossible de modifier le mot de passe. Réessayez.'],
  changePassword: ['Change password', 'Modifier le mot de passe'],
  changing: ['Changing…', 'Modification…'],
  staySignedIn: [
    'You’ll stay signed in here. Your other devices will be signed out.',
    'Cet appareil reste connecté. Vos autres appareils seront déconnectés.',
  ],
  currentPassword: ['Current password', 'Mot de passe actuel'],
  newPassword: ['New password', 'Nouveau mot de passe'],

  interfaceLanguage: ['Interface language', 'Langue de l’interface'],
  notTranslated: [
    'Tasks, messages, names and anything else people write aren’t translated.',
    'Les tâches, les messages, les noms et tout ce que les gens écrivent ne sont pas traduits.',
  ],

  tokensAbout: [
    'For AI agents that work as you, like Claude, ChatGPT or any MCP client. A token can do only what you can do, and its actions show under your name in Activity.',
    'Pour les agents IA qui travaillent en votre nom, comme Claude, ChatGPT ou tout client MCP. Un jeton ne peut faire que ce que vous pouvez faire, et ses actions apparaissent sous votre nom dans Activité.',
  ],
  connectOnTheWeb: [
    (address: ReactNode, how: ReactNode) => (
      <>
        To connect ChatGPT or Claude on the web, add {address} as a connector. You’ll be asked to allow it. {how}
      </>
    ),
    (address: ReactNode, how: ReactNode) => (
      <>
        Pour connecter ChatGPT ou Claude sur le web, ajoutez {address} comme connecteur. Vous devrez l’autoriser. {how}
      </>
    ),
  ],
  howToConnect: ['How to connect', 'Comment se connecter'],
  projects: [(n: number) => (n === 1 ? '1 project' : `${n} projects`), (n: number) => (one(n) ? `${n} projet` : `${n} projets`)],
  allYourProjects: ['All your projects', 'Tous vos projets'],
  usedAndExpires: [
    (used: string, expires: string) => `· last used ${used} · expires ${expires}`,
    (used: string, expires: string) => `· dernière utilisation ${used} · expiration ${expires}`,
  ],
  revoke: ['Revoke', 'Révoquer'],

  qrCode: ['QR code for your authenticator app', 'Code QR pour votre application d’authentification'],
  codeDidntWork: [
    'That code didn’t work. Check that the time on your phone is correct, then try again.',
    'Ce code n’a pas fonctionné. Vérifiez que l’heure de votre téléphone est exacte, puis réessayez.',
  ],
  passwordToSetUp: [
    'Enter your password to set up two-factor authentication.',
    'Saisissez votre mot de passe pour configurer l’authentification à deux facteurs.',
  ],
  codeToSetUp: [
    'To set up two-factor authentication, enter the code we email you.',
    'Pour configurer l’authentification à deux facteurs, saisissez le code que nous vous envoyons par e-mail.',
  ],
  confirmEmailFirst: ['Confirm your email first.', 'Confirmez d’abord votre adresse e-mail.'],
  alreadyOn: ['Two-factor authentication is already on.', 'L’authentification à deux facteurs est déjà activée.'],
  startAgain: ['That took too long. Press Set up to start again.', 'Cela a pris trop de temps. Appuyez sur Configurer pour recommencer.'],
  couldNotSendCode: ['Couldn’t send the code. Try again.', 'Impossible d’envoyer le code. Réessayez.'],
  emailCodeToTurnOff: [
    'We emailed you a code. Enter it to turn off two-factor authentication.',
    'Nous vous avons envoyé un code par e-mail. Saisissez-le pour désactiver l’authentification à deux facteurs.',
  ],
  emailCodeOrFactorDidntWork: ['One of the codes didn’t work. Try again.', 'L’un des codes n’a pas fonctionné. Réessayez.'],
  couldntSetUp: ['Couldn’t start setting it up. Try again.', 'Impossible de commencer la configuration. Réessayez.'],
  emailCodeDidntWork: [
    'That code didn’t work. Use the code from our latest email.',
    'Ce code n’a pas fonctionné. Utilisez le code de notre dernier e-mail.',
  ],
  passwordToTurnOff: [
    'Enter your password to turn off two-factor authentication.',
    'Saisissez votre mot de passe pour désactiver l’authentification à deux facteurs.',
  ],
  codeToTurnOff: [
    'Enter a code from your authenticator app, or a recovery code.',
    'Saisissez un code de votre application d’authentification, ou un code de récupération.',
  ],
  on: ['On', 'Activée'],
  off: ['Off', 'Désactivée'],
  asksAndLeft: [
    (left: number) => `Signing in asks for a code from your phone. ${left} recovery codes left.`,
    (left: number) =>
      `La connexion demande un code de votre téléphone. ${left} ${one(left) ? 'code de secours restant' : 'codes de secours restants'}.`,
  ],
  asksForCode: [
    'Asks for a code from an authenticator app on your phone when you sign in.',
    'Demande, à la connexion, un code d’une application d’authentification sur votre téléphone.',
  ],
  turnOff: ['Turn off', 'Désactiver'],
  turnOn: ['Turn on', 'Activer'],
  saveCodes: [
    'Save these recovery codes somewhere safe. Each one works once, and lets you sign in if you lose your phone.',
    'Conservez ces codes de secours en lieu sûr. Chacun ne fonctionne qu’une fois et vous permet de vous connecter si vous perdez votre téléphone.',
  ],
  done: ['Done', 'Terminé'],

  chat: ['Chat', 'Discussions'],
  digestHint: ['Once a day, what you haven’t read in four hours.', 'Une fois par jour, ce que vous n’avez pas lu depuis quatre heures.'],
  emailMeWhatIMissed: ['Email me what I missed', 'M’envoyer par e-mail ce que j’ai manqué'],
  sound: ['Sound', 'Son'],
  soundHint: ['Play a sound on this device when a message arrives.', 'Émettre un son sur cet appareil à l’arrivée d’un message.'],
  playSound: ['Play a sound when a message arrives', 'Émettre un son à l’arrivée d’un message'],
  quietHours: ['Quiet hours', 'Heures de silence'],
  quietHint: [
    'Notifications are held during these hours and sent when they end.',
    'Les notifications sont retenues pendant ces heures et envoyées à la fin.',
  ],
  to: ['to', 'à'],
  quietUntil: ['Quiet until', 'Silence jusqu’à'],
  timeZone: ['Time zone', 'Fuseau horaire'],

  unknownDevice: ['Unknown device', 'Appareil inconnu'],
  browserOn: [
    (browser: string, system: string) => `${browser} on ${system}`,
    (browser: string, system: string) => `${browser} sur ${system}`,
  ],
  activeToday: ['Active today', 'Actif aujourd’hui'],
  activeYesterday: ['Active yesterday', 'Actif hier'],
  activeDaysAgo: [(n: number) => `Active ${n} days ago`, (n: number) => `Actif il y a ${n} jours`],
  activeOn: [(date: string) => `Active ${date}`, (date: string) => `Actif le ${date}`],
  signOutOther: ['Sign out of the other device', 'Déconnecter l’autre appareil'],
  signOutOthers: [(n: number) => `Sign out of ${n} other devices`, (n: number) => `Déconnecter les ${n} autres appareils`],
  thisDevice: ['This device', 'Cet appareil'],
  signOut: ['Sign out', 'Déconnecter'],

  pushUnsupported: [
    'This browser can’t show notifications. On iPhone, they work only after you add Tuff to the Home Screen.',
    'Ce navigateur ne peut pas afficher de notifications. Sur iPhone, elles fonctionnent uniquement une fois Tuff ajouté à l’écran d’accueil.',
  ],
  pushUnavailable: [
    'Push notifications aren’t set up on this server, so they can’t be turned on.',
    'Les notifications push ne sont pas configurées sur ce serveur, elles ne peuvent donc pas être activées.',
  ],
  pushDenied: [
    'Notifications are blocked for this site. To allow them, open the site settings next to the address bar.',
    'Les notifications sont bloquées pour ce site. Pour les autoriser, ouvrez les paramètres du site à côté de la barre d’adresse.',
  ],
  pushOff: [
    'Get notifications on this device, even when the browser is closed.',
    'Recevez des notifications sur cet appareil, même quand le navigateur est fermé.',
  ],
  pushOn: ['On for this device.', 'Activées sur cet appareil.'],
  installForCount: [
    'To show the unread count on the app icon, install the app: Chrome’s ⋮ menu → Cast, save and share → Install.',
    'Pour afficher le nombre de non-lus sur l’icône de l’application, installez-la : menu ⋮ de Chrome → Caster, enregistrer et partager → Installer.',
  ],
  probeSent: [
    'Test notification sent. If you didn’t see it, check Notification Centre — it’s usually there when the alert style is set to None. If not, go to System Settings → Notifications → Chrome and make sure Focus is off.',
    'Notification de test envoyée. Si vous ne l’avez pas vue, regardez dans le centre de notifications — elle s’y trouve généralement quand le style d’alerte est réglé sur Aucun. Sinon, ouvrez Réglages Système → Notifications → Chrome et vérifiez que le mode Concentration est désactivé.',
  ],
  unknownBrowser: ['Unknown browser', 'Navigateur inconnu'],
  stopOn: [(device: string) => `Stop notifications on ${device}`, (device: string) => `Arrêter les notifications sur ${device}`],
  thisBrowser: ['this browser', 'ce navigateur'],
  remove: ['Remove', 'Retirer'],

  couldntCopy: ['Couldn’t make the copy. Try again.', 'Impossible de créer la copie. Réessayez.'],
  couldntCheck: ['Couldn’t check what would be deleted. Try again.', 'Impossible de vérifier ce qui serait supprimé. Réessayez.'],
  couldntDelete: ['Couldn’t delete the account. Try again.', 'Impossible de supprimer le compte. Réessayez.'],
  yourData: ['Your data', 'Vos données'],
  aCopy: ['A copy of your data', 'Une copie de vos données'],
  aCopyHint: [
    'Your account and everything you wrote, in every workspace you’re in, as one file.',
    'Votre compte et tout ce que vous avez écrit, dans tous vos espaces de travail, en un seul fichier.',
  ],
  preparing: ['Preparing…', 'Préparation…'],
  download: ['Download', 'Télécharger'],
  deleteAccount: ['Delete your account', 'Supprimer votre compte'],
  forGood: ['For good. You’ll be signed out everywhere.', 'Définitivement. Toutes vos sessions seront fermées.'],
  deleteEllipsis: ['Delete…', 'Supprimer…'],
  deletedAlone: [
    (names: ReactNode) => <>Deleted with everything in them, since you’re the only one there: {names}.</>,
    (names: ReactNode) => <>Supprimés avec tout leur contenu, car personne d’autre n’en fait partie : {names}.</>,
  ],
  youLeave: [
    (names: string) => `You’ll leave ${names}. What you wrote there stays, under “Deleted account”.`,
    (names: string) => `Vous quitterez ${names}. Ce que vous y avez écrit reste, sous « Compte supprimé ».`,
  ],
  handOverFirst: [
    (names: string) =>
      `First give someone else the workspaces you own that have other people in them: ${names}. Do it from each workspace’s settings.`,
    (names: string) =>
      `Confiez d’abord à quelqu’un d’autre les espaces de travail dont vous êtes propriétaire et qui comptent d’autres personnes : ${names}. Faites-le depuis les paramètres de chaque espace de travail.`,
  ],
  lastInstanceOwner: [
    'You’re the last owner of this server. Add another owner in Server settings first.',
    'Vous êtes le dernier propriétaire de ce serveur. Ajoutez d’abord un autre propriétaire dans les paramètres du serveur.',
  ],
  sixDigits: ['6-digit code', 'Code à 6 chiffres'],
  deleting: ['Deleting…', 'Suppression…'],
  deleteMyAccount: ['Delete my account', 'Supprimer mon compte'],
  /* Ways to sign in. */
  waysIn: ['Ways to sign in', 'Moyens de connexion'],
  waysHint: ['Sign in with these as well as your email.', 'Connectez-vous avec ces comptes en plus de votre adresse e-mail.'],
  notConnected: ['Not connected', 'Non connecté'],
  connected: ['Connected', 'Connecté'],
  connect: ['Connect', 'Connecter'],
  connectWay: [(name: string) => `Connect ${name}`, (name: string) => `Connecter ${name}`],
  removeWay: [(name: string) => `Remove ${name}`, (name: string) => `Retirer ${name}`],
  connectSays: [
    (name: string) => `Confirm it’s you, then choose the ${name} account to sign in with. We’ll email you when it’s connected.`,
    (name: string) =>
      `Confirmez votre identité, puis choisissez le compte ${name} à utiliser pour vous connecter. Nous vous enverrons un e-mail une fois la connexion effectuée.`,
  ],
  removeSays: [
    (name: string) => `Confirm it’s you. You won’t be able to sign in with this ${name} account anymore.`,
    (name: string) => `Confirmez votre identité. Vous ne pourrez plus vous connecter avec ce compte ${name}.`,
  ],
  continue: ['Continue', 'Continuer'],
  wayAdded: ['Connected. You can sign in with it now.', 'Connecté. Vous pouvez maintenant l’utiliser pour vous connecter.'],
  wayTaken: ['That account already signs in to another Tuff account.', 'Ce compte sert déjà à se connecter à un autre compte Tuff.'],
  wayFailed: ['Couldn’t connect. Try again.', 'Impossible de se connecter. Réessayez.'],
  /* A server's own provider that could not be read. */
  wayUnreachable: [
    (name: string) => `Couldn’t reach ${name}. Try again in a few minutes.`,
    (name: string) => `Impossible de joindre ${name}. Réessayez dans quelques minutes.`,
  ],
  wayRemoved: ['Removed.', 'Retiré.'],
  wayLast: [
    'This is how you sign in. Set a password before removing it.',
    'C’est votre moyen de connexion. Définissez un mot de passe avant de le retirer.',
  ],
  couldntRemove: ['Couldn’t remove. Try again.', 'Impossible de retirer. Réessayez.'],
})
