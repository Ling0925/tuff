import type { ReactNode } from 'react'
import { one, say } from '../data/words.js'

/** Account — `ui/Account.tsx`: profile, password, tokens, two-factor, notifications, devices and your data. */
export const ACCOUNT = say({
  /* Leaving the workspace. */
  leaveWorkspace: ['Leave workspace', 'Quitter l’espace de travail', '退出工作区'],
  leaveWorkspaceHint: [
    (ws: string) => `Leave ${ws}. You can be invited back.`,
    (ws: string) => `Quitter ${ws}. Vous pourrez y être invité à nouveau.`,
    (ws: string) => `退出 ${ws}。之后仍可被重新邀请。`,
  ],
  leaveEllipsis: ['Leave…', 'Quitter…', '退出…'],
  leaveName: [(ws: string) => `Leave ${ws}?`, (ws: string) => `Quitter ${ws}\u00a0?`, (ws: string) => `退出 ${ws}？`],
  leaveLoses: [
    'You’ll lose access to its projects and chats.',
    'Vous n’aurez plus accès à ses projets ni à ses discussions.',
    '你将失去对其项目和聊天的访问权限。',
  ],
  leaveKeeps: ['What you made stays, under your name.', 'Ce que vous avez créé reste, à votre nom.', '你创建的内容会以你的名义保留。'],
  leaveBack: ['Someone can invite you back.', 'Quelqu’un pourra vous inviter à nouveau.', '其他人可以再次邀请你。'],
  leaveGo: ['Leave workspace', 'Quitter l’espace de travail', '退出工作区'],
  leavingWs: ['Leaving…', 'Départ…', '正在退出…'],
  couldntLeave: ['Couldn’t leave. Try again.', 'Impossible de quitter. Réessayez.', '无法退出，请重试。'],
  ownerCantLeave: [
    (ws: string) => `You own ${ws}. Hand it over to someone else before you leave.`,
    (ws: string) => `Vous êtes propriétaire de ${ws}. Transférez-le à quelqu’un d’autre avant de partir.`,
    (ws: string) => `你是 ${ws} 的所有者。请先转让给他人再退出。`,
  ],
  handOver: ['Hand over', 'Transférer', '转让'],
  picture: ['Picture', 'Photo', '照片'],
  uploading: ['Uploading…', 'Importation…', '上传中…'],
  pictureHint: [
    'PNG, JPEG, GIF, WebP or SVG. Large images are resized.',
    'PNG, JPEG, GIF, WebP ou SVG. Les grandes images sont redimensionnées.',
    '支持 PNG、JPEG、GIF、WebP 或 SVG。较大的图片会被缩放。',
  ],
  change: ['Change', 'Modifier', '更改'],
  uploadPicture: ['Upload picture', 'Importer une photo', '上传照片'],
  couldntUpload: ['Couldn’t upload. Try again.', 'Impossible d’importer. Réessayez.', '上传失败，请重试。'],
  name: ['Name', 'Nom', '名称'],
  nameHint: ['Shown to everyone in your workspaces.', 'Visible par tous dans vos espaces de travail.', '你所在工作区的所有成员都能看到。'],
  yourName: ['Your name', 'Votre nom', '你的名字'],
  title: ['Title', 'Fonction', '职位'],
  titleHint: [
    'Shown under your name on your profile card.',
    'Affichée sous votre nom sur votre carte de profil.',
    '显示在个人资料卡上你的名字下方。',
  ],
  titleExample: ['Designer, Head of sales…', 'Designer, responsable des ventes…', '设计师、销售主管…'],
  email: ['Email', 'Adresse e-mail', '邮箱'],
  /* The digest's switch: the mail itself, not the address it goes to. */
  emailDigest: ['Email', 'E-mail', '邮件'],
  approveFirst: [
    (from: string, to: string) => `Approve the change in the email sent to ${from}. Then a link will be sent to ${to}.`,
    (from: string, to: string) => `Approuvez la modification dans l’e-mail envoyé à ${from}. Un lien sera ensuite envoyé à ${to}.`,
    (from: string, to: string) => `请先在发送至 ${from} 的邮件中批准更改，之后会向 ${to} 发送链接。`,
  ],
  yourCurrentAddress: ['your current address', 'votre adresse actuelle', '你当前的地址'],
  openLinkSentTo: [
    (to: string) => `Open the link sent to ${to} to finish the change.`,
    (to: string) => `Ouvrez le lien envoyé à ${to} pour terminer la modification.`,
    (to: string) => `打开发送至 ${to} 的链接以完成更改。`,
  ],
  sent: ['Sent', 'Envoyé', '已发送'],
  sendAgain: ['Send again', 'Renvoyer', '重新发送'],
  cancel: ['Cancel', 'Annuler', '取消'],
  emailHint: [
    'Used for signing in and for email from Tuff.',
    'Pour vous connecter et recevoir les e-mails de Tuff.',
    '用于登录和接收 Tuff 的邮件。',
  ],
  password: ['Password', 'Mot de passe', '密码'],
  noPasswordYet: [
    'Your account doesn’t have a password yet. Set one to sign in with your email too.',
    'Votre compte n’a pas encore de mot de passe. Définissez-en un pour vous connecter aussi avec votre adresse e-mail.',
    '你的账户还没有密码。设置后即可用邮箱登录。',
  ],
  changingSignsOut: [
    'Changing it signs you out on your other devices.',
    'Le modifier vous déconnecte de vos autres appareils.',
    '修改后，你的其他设备将被退出登录。',
  ],
  linkToSet: [
    (email: string) => `We sent a link to ${email}. Open it to set your password.`,
    (email: string) => `Nous avons envoyé un lien à ${email}. Ouvrez-le pour définir votre mot de passe.`,
    (email: string) => `我们已向 ${email} 发送链接。打开链接即可设置密码。`,
  ],
  couldntSendLink: ['Couldn’t send the link. Try again.', 'Impossible d’envoyer le lien. Réessayez.', '无法发送链接，请重试。'],
  setPassword: ['Set password', 'Définir un mot de passe', '设置密码'],
  passwordChanged: ['Password changed.', 'Mot de passe modifié.', '密码已修改。'],
  passwordChangedOut: [
    (n: number) => `Password changed. ${n === 1 ? 'Your other device was' : `${n} other devices were`} signed out.`,
    (n: number) =>
      one(n)
        ? 'Mot de passe modifié. Votre autre appareil a été déconnecté.'
        : `Mot de passe modifié. ${n} autres appareils ont été déconnectés.`,
    (n: number) => `密码已修改。${n === 1 ? '你的另一台设备已退出登录。' : `${n} 台其他设备已退出登录。`}`,
  ],

  wrongPasswordOrCode: [
    'Incorrect password or code. Try again.',
    'Mot de passe ou code incorrect. Réessayez.',
    '密码或验证码不正确，请重试。',
  ],
  wrongPassword: ['Incorrect password. Try again.', 'Mot de passe incorrect. Réessayez.', '密码不正确，请重试。'],
  tooManyTries: [
    'Too many tries. Wait a few minutes and try again.',
    'Trop de tentatives. Patientez quelques minutes et réessayez.',
    '尝试次数过多，请等待几分钟后重试。',
  ],
  tooManyAttempts: [
    'Too many attempts. Wait a few minutes and try again.',
    'Trop de tentatives. Patientez quelques minutes et réessayez.',
    '尝试次数过多，请等待几分钟后重试。',
  ],
  changeYourEmail: ['Change your email', 'Modifier votre adresse e-mail', '修改邮箱'],
  sending: ['Sending…', 'Envoi…', '发送中…'],
  sendTheLink: ['Send the link', 'Envoyer le lien', '发送链接'],
  approveByInbox: [
    (email: string) =>
      `Your account has no password, so first approve the change in an email sent to ${email}. Then a link will be sent to the new address.`,
    (email: string) =>
      `Votre compte n’a pas de mot de passe : approuvez d’abord la modification dans l’e-mail envoyé à ${email}. Un lien sera ensuite envoyé à la nouvelle adresse.`,
    (email: string) => `你的账户没有密码，请先在发送至 ${email} 的邮件中批准更改，之后会向新地址发送链接。`,
  ],
  linkToNew: [
    (email: string) => `A link will be sent to the new address. Open it to finish the change. Until then, you sign in with ${email}.`,
    (email: string) =>
      `Un lien sera envoyé à la nouvelle adresse. Ouvrez-le pour terminer la modification. D’ici là, vous vous connectez avec ${email}.`,
    (email: string) => `将向新地址发送链接，打开即可完成更改。在此之前，请使用 ${email} 登录。`,
  ],
  newEmail: ['New email', 'Nouvelle adresse e-mail', '新邮箱'],
  yourPassword: ['Your password', 'Votre mot de passe', '你的密码'],
  codeOrRecovery: [
    'Code from your authenticator, or a recovery code',
    'Code de votre application d’authentification, ou code de secours',
    '身份验证器中的验证码，或恢复代码',
  ],
  couldntChangePassword: [
    'Couldn’t change the password. Try again.',
    'Impossible de modifier le mot de passe. Réessayez.',
    '无法修改密码，请重试。',
  ],
  changePassword: ['Change password', 'Modifier le mot de passe', '修改密码'],
  changing: ['Changing…', 'Modification…', '修改中…'],
  staySignedIn: [
    'You’ll stay signed in here. Your other devices will be signed out.',
    'Cet appareil reste connecté. Vos autres appareils seront déconnectés.',
    '此设备将保持登录，其他设备将被退出登录。',
  ],
  currentPassword: ['Current password', 'Mot de passe actuel', '当前密码'],
  newPassword: ['New password', 'Nouveau mot de passe', '新密码'],

  interfaceLanguage: ['Interface language', 'Langue de l’interface', '界面语言'],
  notTranslated: [
    'Tasks, messages, names and anything else people write aren’t translated.',
    'Les tâches, les messages, les noms et tout ce que les gens écrivent ne sont pas traduits.',
    '任务、消息、名字以及人们写下的其他内容不会被翻译。',
  ],

  tokensAbout: [
    'For AI agents that work as you, like Claude, ChatGPT or any MCP client. A token can do only what you can do, and its actions show under your name in Activity.',
    'Pour les agents IA qui travaillent en votre nom, comme Claude, ChatGPT ou tout client MCP. Un jeton ne peut faire que ce que vous pouvez faire, et ses actions apparaissent sous votre nom dans Activité.',
    '用于以你的身份工作的 AI 代理，例如 Claude、ChatGPT 或任何 MCP 客户端。令牌只能做你能做的事，其操作会以你的名义显示在「动态」中。',
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
    (address: ReactNode, how: ReactNode) => (
      <>
        要在网页上连接 ChatGPT 或 Claude，请添加 {address} 作为连接器。系统会请求你授权。{how}
      </>
    ),
  ],
  howToConnect: ['How to connect', 'Comment se connecter', '如何连接'],
  projects: [
    (n: number) => (n === 1 ? '1 project' : `${n} projects`),
    (n: number) => (one(n) ? `${n} projet` : `${n} projets`),
    (n: number) => `${n} 个项目`,
  ],
  allYourProjects: ['All your projects', 'Tous vos projets', '你的所有项目'],
  usedAndExpires: [
    (used: string, expires: string) => `· last used ${used} · expires ${expires}`,
    (used: string, expires: string) => `· dernière utilisation ${used} · expiration ${expires}`,
    (used: string, expires: string) => `· 上次使用 ${used} · 过期 ${expires}`,
  ],
  revoke: ['Revoke', 'Révoquer', '撤销'],

  qrCode: ['QR code for your authenticator app', 'Code QR pour votre application d’authentification', '身份验证器应用的二维码'],
  codeDidntWork: [
    'That code didn’t work. Check that the time on your phone is correct, then try again.',
    'Ce code n’a pas fonctionné. Vérifiez que l’heure de votre téléphone est exacte, puis réessayez.',
    '验证码无效。请检查手机时间是否正确，然后重试。',
  ],
  passwordToSetUp: [
    'Enter your password to set up two-factor authentication.',
    'Saisissez votre mot de passe pour configurer l’authentification à deux facteurs.',
    '输入密码以设置双重验证。',
  ],
  codeToSetUp: [
    'To set up two-factor authentication, enter the code we email you.',
    'Pour configurer l’authentification à deux facteurs, saisissez le code que nous vous envoyons par e-mail.',
    '要设置双重验证，请输入我们通过邮件发送给你的验证码。',
  ],
  confirmEmailFirst: ['Confirm your email first.', 'Confirmez d’abord votre adresse e-mail.', '请先确认你的邮箱。'],
  alreadyOn: ['Two-factor authentication is already on.', 'L’authentification à deux facteurs est déjà activée.', '双重验证已开启。'],
  startAgain: [
    'That took too long. Press Set up to start again.',
    'Cela a pris trop de temps. Appuyez sur Configurer pour recommencer.',
    '操作超时。请按「设置」重新开始。',
  ],
  couldNotSendCode: ['Couldn’t send the code. Try again.', 'Impossible d’envoyer le code. Réessayez.', '无法发送验证码，请重试。'],
  emailCodeToTurnOff: [
    'We emailed you a code. Enter it to turn off two-factor authentication.',
    'Nous vous avons envoyé un code par e-mail. Saisissez-le pour désactiver l’authentification à deux facteurs.',
    '我们已通过邮件发送验证码。输入以关闭双重验证。',
  ],
  emailCodeOrFactorDidntWork: [
    'One of the codes didn’t work. Try again.',
    'L’un des codes n’a pas fonctionné. Réessayez.',
    '其中一个验证码无效，请重试。',
  ],
  couldntSetUp: [
    'Couldn’t start setting it up. Try again.',
    'Impossible de commencer la configuration. Réessayez.',
    '无法开始设置，请重试。',
  ],
  emailCodeDidntWork: [
    'That code didn’t work. Use the code from our latest email.',
    'Ce code n’a pas fonctionné. Utilisez le code de notre dernier e-mail.',
    '验证码无效。请使用我们最新邮件中的验证码。',
  ],
  passwordToTurnOff: [
    'Enter your password to turn off two-factor authentication.',
    'Saisissez votre mot de passe pour désactiver l’authentification à deux facteurs.',
    '输入密码以关闭双重验证。',
  ],
  codeToTurnOff: [
    'Enter a code from your authenticator app, or a recovery code.',
    'Saisissez un code de votre application d’authentification, ou un code de récupération.',
    '输入身份验证器中的验证码，或恢复代码。',
  ],
  on: ['On', 'Activée', '已开启'],
  off: ['Off', 'Désactivée', '已关闭'],
  asksAndLeft: [
    (left: number) => `Signing in asks for a code from your phone. ${left} recovery codes left.`,
    (left: number) =>
      `La connexion demande un code de votre téléphone. ${left} ${one(left) ? 'code de secours restant' : 'codes de secours restants'}.`,
    (left: number) => `登录时需要手机上的验证码。剩余 ${left} 个恢复代码。`,
  ],
  asksForCode: [
    'Asks for a code from an authenticator app on your phone when you sign in.',
    'Demande, à la connexion, un code d’une application d’authentification sur votre téléphone.',
    '登录时要求输入手机上身份验证器应用的验证码。',
  ],
  turnOff: ['Turn off', 'Désactiver', '关闭'],
  turnOn: ['Turn on', 'Activer', '开启'],
  saveCodes: [
    'Save these recovery codes somewhere safe. Each one works once, and lets you sign in if you lose your phone.',
    'Conservez ces codes de secours en lieu sûr. Chacun ne fonctionne qu’une fois et vous permet de vous connecter si vous perdez votre téléphone.',
    '请妥善保存这些恢复代码。每个只能使用一次，在你丢失手机时可用于登录。',
  ],
  done: ['Done', 'Terminé', '完成'],

  chat: ['Chat', 'Discussions', '聊天'],
  digestHint: [
    'Once a day, what you haven’t read in four hours.',
    'Une fois par jour, ce que vous n’avez pas lu depuis quatre heures.',
    '每天一次，汇总你四小时内未读的内容。',
  ],
  emailMeWhatIMissed: ['Email me what I missed', 'M’envoyer par e-mail ce que j’ai manqué', '把错过的内容发邮件给我'],
  sound: ['Sound', 'Son', '声音'],
  soundHint: [
    'Play a sound on this device when a message arrives.',
    'Émettre un son sur cet appareil à l’arrivée d’un message.',
    '收到消息时在此设备上播放提示音。',
  ],
  playSound: ['Play a sound when a message arrives', 'Émettre un son à l’arrivée d’un message', '收到消息时播放提示音'],
  quietHours: ['Quiet hours', 'Heures de silence', '免打扰时段'],
  quietHint: [
    'Notifications are held during these hours and sent when they end.',
    'Les notifications sont retenues pendant ces heures et envoyées à la fin.',
    '在此时间段内暂缓通知，结束后再发送。',
  ],
  to: ['to', 'à', '至'],
  quietUntil: ['Quiet until', 'Silence jusqu’à', '免打扰至'],
  timeZone: ['Time zone', 'Fuseau horaire', '时区'],

  unknownDevice: ['Unknown device', 'Appareil inconnu', '未知设备'],
  browserOn: [
    (browser: string, system: string) => `${browser} on ${system}`,
    (browser: string, system: string) => `${browser} sur ${system}`,
    (browser: string, system: string) => `${system} 上的 ${browser}`,
  ],
  activeToday: ['Active today', 'Actif aujourd’hui', '今天活跃'],
  activeYesterday: ['Active yesterday', 'Actif hier', '昨天活跃'],
  activeDaysAgo: [(n: number) => `Active ${n} days ago`, (n: number) => `Actif il y a ${n} jours`, (n: number) => `${n} 天前活跃`],
  activeOn: [(date: string) => `Active ${date}`, (date: string) => `Actif le ${date}`, (date: string) => `${date} 活跃`],
  signOutOther: ['Sign out of the other device', 'Déconnecter l’autre appareil', '退出另一台设备'],
  signOutOthers: [
    (n: number) => `Sign out of ${n} other devices`,
    (n: number) => `Déconnecter les ${n} autres appareils`,
    (n: number) => `退出 ${n} 台其他设备`,
  ],
  thisDevice: ['This device', 'Cet appareil', '此设备'],
  signOut: ['Sign out', 'Déconnecter', '退出登录'],

  pushUnsupported: [
    'This browser can’t show notifications. On iPhone, they work only after you add Tuff to the Home Screen.',
    'Ce navigateur ne peut pas afficher de notifications. Sur iPhone, elles fonctionnent uniquement une fois Tuff ajouté à l’écran d’accueil.',
    '此浏览器无法显示通知。在 iPhone 上，需要先将 Tuff 添加到主屏幕才能使用。',
  ],
  pushUnavailable: [
    'Push notifications aren’t set up on this server, so they can’t be turned on.',
    'Les notifications push ne sont pas configurées sur ce serveur, elles ne peuvent donc pas être activées.',
    '此服务器未配置推送通知，因此无法开启。',
  ],
  pushDenied: [
    'Notifications are blocked for this site. To allow them, open the site settings next to the address bar.',
    'Les notifications sont bloquées pour ce site. Pour les autoriser, ouvrez les paramètres du site à côté de la barre d’adresse.',
    '此站点的通知已被阻止。如需允许，请打开地址栏旁的本站设置。',
  ],
  pushOff: [
    'Get notifications on this device, even when the browser is closed.',
    'Recevez des notifications sur cet appareil, même quand le navigateur est fermé.',
    '在此设备上接收通知，即使浏览器已关闭。',
  ],
  pushOn: ['On for this device.', 'Activées sur cet appareil.', '已在此设备上开启。'],
  installForCount: [
    'To show the unread count on the app icon, install the app: Chrome’s ⋮ menu → Cast, save and share → Install.',
    'Pour afficher le nombre de non-lus sur l’icône de l’application, installez-la : menu ⋮ de Chrome → Caster, enregistrer et partager → Installer.',
    '要在应用图标上显示未读数，请安装应用：Chrome 的 ⋮ 菜单 → 投放、保存和分享 → 安装。',
  ],
  probeSent: [
    'Test notification sent. If you didn’t see it, check Notification Centre — it’s usually there when the alert style is set to None. If not, go to System Settings → Notifications → Chrome and make sure Focus is off.',
    'Notification de test envoyée. Si vous ne l’avez pas vue, regardez dans le centre de notifications — elle s’y trouve généralement quand le style d’alerte est réglé sur Aucun. Sinon, ouvrez Réglages Système → Notifications → Chrome et vérifiez que le mode Concentration est désactivé.',
    '测试通知已发送。如果没有看到，请检查通知中心——当提醒样式设为「无」时通常会出现在那里。若仍没有，请前往系统设置 → 通知 → Chrome，确认专注模式已关闭。',
  ],
  unknownBrowser: ['Unknown browser', 'Navigateur inconnu', '未知浏览器'],
  stopOn: [
    (device: string) => `Stop notifications on ${device}`,
    (device: string) => `Arrêter les notifications sur ${device}`,
    (device: string) => `停止 ${device} 上的通知`,
  ],
  thisBrowser: ['this browser', 'ce navigateur', '此浏览器'],
  remove: ['Remove', 'Retirer', '移除'],

  couldntCopy: ['Couldn’t make the copy. Try again.', 'Impossible de créer la copie. Réessayez.', '无法创建副本，请重试。'],
  couldntCheck: [
    'Couldn’t check what would be deleted. Try again.',
    'Impossible de vérifier ce qui serait supprimé. Réessayez.',
    '无法检查将被删除的内容，请重试。',
  ],
  couldntDelete: ['Couldn’t delete the account. Try again.', 'Impossible de supprimer le compte. Réessayez.', '无法删除账户，请重试。'],
  yourData: ['Your data', 'Vos données', '你的数据'],
  aCopy: ['A copy of your data', 'Une copie de vos données', '你的数据副本'],
  aCopyHint: [
    'Your account and everything you wrote, in every workspace you’re in, as one file.',
    'Votre compte et tout ce que vous avez écrit, dans tous vos espaces de travail, en un seul fichier.',
    '你的账户以及你写过的全部内容，涵盖你所在的每个工作区，合并为一个文件。',
  ],
  preparing: ['Preparing…', 'Préparation…', '准备中…'],
  download: ['Download', 'Télécharger', '下载'],
  deleteAccount: ['Delete your account', 'Supprimer votre compte', '删除账户'],
  forGood: [
    'For good. You’ll be signed out everywhere.',
    'Définitivement. Toutes vos sessions seront fermées.',
    '永久删除。你将在所有设备上退出登录。',
  ],
  deleteEllipsis: ['Delete…', 'Supprimer…', '删除…'],
  deletedAlone: [
    (names: ReactNode) => <>Deleted with everything in them, since you’re the only one there: {names}.</>,
    (names: ReactNode) => <>Supprimés avec tout leur contenu, car personne d’autre n’en fait partie : {names}.</>,
    (names: ReactNode) => <>由于你是其中唯一的成员，以下内容及其全部数据都会被删除：{names}。</>,
  ],
  youLeave: [
    (names: string) => `You’ll leave ${names}. What you wrote there stays, under “Deleted account”.`,
    (names: string) => `Vous quitterez ${names}. Ce que vous y avez écrit reste, sous « Compte supprimé ».`,
    (names: string) => `你将退出 ${names}。你在这里写的内容会保留，归入「已删除账户」。`,
  ],
  handOverFirst: [
    (names: string) =>
      `First give someone else the workspaces you own that have other people in them: ${names}. Do it from each workspace’s settings.`,
    (names: string) =>
      `Confiez d’abord à quelqu’un d’autre les espaces de travail dont vous êtes propriétaire et qui comptent d’autres personnes : ${names}. Faites-le depuis les paramètres de chaque espace de travail.`,
    (names: string) => `请先将你拥有且还有其他成员的工作区转让给他人：${names}。可在各工作区设置中操作。`,
  ],
  lastInstanceOwner: [
    'You’re the last owner of this server. Add another owner in Server settings first.',
    'Vous êtes le dernier propriétaire de ce serveur. Ajoutez d’abord un autre propriétaire dans les paramètres du serveur.',
    '你是此服务器的最后一位所有者。请先在服务器设置中添加另一位所有者。',
  ],
  sixDigits: ['6-digit code', 'Code à 6 chiffres', '6 位验证码'],
  deleting: ['Deleting…', 'Suppression…', '删除中…'],
  deleteMyAccount: ['Delete my account', 'Supprimer mon compte', '删除我的账户'],
  /* Ways to sign in. */
  waysIn: ['Ways to sign in', 'Moyens de connexion', '登录方式'],
  waysHint: [
    'Sign in with these as well as your email.',
    'Connectez-vous avec ces comptes en plus de votre adresse e-mail.',
    '除了邮箱，也可以用这些账户登录。',
  ],
  notConnected: ['Not connected', 'Non connecté', '未连接'],
  connected: ['Connected', 'Connecté', '已连接'],
  connect: ['Connect', 'Connecter', '连接'],
  connectWay: [(name: string) => `Connect ${name}`, (name: string) => `Connecter ${name}`, (name: string) => `连接 ${name}`],
  removeWay: [(name: string) => `Remove ${name}`, (name: string) => `Retirer ${name}`, (name: string) => `移除 ${name}`],
  connectSays: [
    (name: string) => `Confirm it’s you, then choose the ${name} account to sign in with. We’ll email you when it’s connected.`,
    (name: string) =>
      `Confirmez votre identité, puis choisissez le compte ${name} à utiliser pour vous connecter. Nous vous enverrons un e-mail une fois la connexion effectuée.`,
    (name: string) => `确认是你本人，然后选择用于登录的 ${name} 账户。连接后我们会发送邮件通知你。`,
  ],
  removeSays: [
    (name: string) => `Confirm it’s you. You won’t be able to sign in with this ${name} account anymore.`,
    (name: string) => `Confirmez votre identité. Vous ne pourrez plus vous connecter avec ce compte ${name}.`,
    (name: string) => `确认是你本人。之后你将无法再用此 ${name} 账户登录。`,
  ],
  continue: ['Continue', 'Continuer', '继续'],
  wayAdded: [
    'Connected. You can sign in with it now.',
    'Connecté. Vous pouvez maintenant l’utiliser pour vous connecter.',
    '已连接，现在可以用它登录。',
  ],
  wayTaken: [
    'That account already signs in to another Tuff account.',
    'Ce compte sert déjà à se connecter à un autre compte Tuff.',
    '该账户已用于登录另一个 Tuff 账户。',
  ],
  wayFailed: ['Couldn’t connect. Try again.', 'Impossible de se connecter. Réessayez.', '连接失败，请重试。'],
  /* A server's own provider that could not be read. */
  wayUnreachable: [
    (name: string) => `Couldn’t reach ${name}. Try again in a few minutes.`,
    (name: string) => `Impossible de joindre ${name}. Réessayez dans quelques minutes.`,
    (name: string) => `无法连接 ${name}。请几分钟后重试。`,
  ],
  wayRemoved: ['Removed.', 'Retiré.', '已移除。'],
  wayLast: [
    'This is how you sign in. Set a password before removing it.',
    'C’est votre moyen de connexion. Définissez un mot de passe avant de le retirer.',
    '这是你的登录方式。移除前请先设置密码。',
  ],
  couldntRemove: ['Couldn’t remove. Try again.', 'Impossible de retirer. Réessayez.', '无法移除，请重试。'],
})
