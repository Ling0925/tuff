import { say } from '../data/words.js'

/** Your own server's first opening — `ui/Setup.tsx`. */
export const SETUP = say({
  docTitle: ['Set up Tuff', 'Configurer Tuff', '设置 Tuff'],
  step: [(n: number) => `Step ${n} of 2`, (n: number) => `Étape ${n} sur 2`, (n: number) => `第 ${n} 步，共 2 步`],

  mailTitle: ['Set up email.', 'Configurez l’envoi d’e-mails.', '设置邮件。'],
  mailIntro: [
    'Tuff sends invitations, notifications and password reset links by email.',
    'Tuff envoie les invitations, les notifications et les liens de réinitialisation de mot de passe par e-mail.',
    'Tuff 通过邮件发送邀请、通知和密码重置链接。',
  ],
  testTo: ['Send a test email to', 'Envoyer un e-mail de test à', '发送测试邮件至'],
  test: ['Send a test email', 'Envoyer un e-mail de test', '发送测试邮件'],
  testing: ['Sending…', 'Envoi…', '发送中…'],
  testSent: ['Sent. Check that inbox.', 'Envoyé. Consultez cette boîte de réception.', '已发送。请查收该邮箱。'],
  testFailed: [
    'Couldn’t send it. Check the settings and try again.',
    'Impossible de l’envoyer. Vérifiez les paramètres et réessayez.',
    '无法发送。请检查设置后重试。',
  ],
  continue: ['Continue', 'Continuer', '继续'],
  skip: ['Skip for now', 'Ignorer pour l’instant', '暂时跳过'],

  skipTitle: ['Continue without email?', 'Continuer sans e-mails\u00a0?', '不设置邮件继续？'],
  skipWont: [
    'Without email, Tuff can’t send invitations, notifications or password reset links.',
    'Sans e-mails, Tuff ne peut pas envoyer d’invitations, de notifications ni de liens de réinitialisation de mot de passe.',
    '不设置邮件，Tuff 将无法发送邀请、通知或密码重置链接。',
  ],
  skipWill: [
    'You can still invite people: Tuff shows you a link to send them yourself.',
    'Vous pouvez quand même inviter des personnes\u00a0: Tuff vous donne un lien à leur envoyer vous-même.',
    '你仍然可以邀请成员：Tuff 会提供一个链接供你自行发送。',
  ],
  skipLater: [
    'You can set up email later in Server settings.',
    'Vous pourrez configurer l’envoi d’e-mails plus tard dans les paramètres du serveur.',
    '你可以在「服务器设置」中稍后配置邮件。',
  ],
  skipGo: ['Continue without email', 'Continuer sans e-mails', '不设置邮件继续'],
  back: ['Back', 'Retour', '返回'],

  ownerTitle: ['Create your account.', 'Créez votre compte.', '创建你的账户。'],
  ownerIntro: [
    'You’ll be the owner of this server. You can add other owners later.',
    'Vous serez le propriétaire de ce serveur. Vous pourrez ajouter d’autres propriétaires plus tard.',
    '你将成为此服务器的所有者。之后可以添加其他所有者。',
  ],
  name: ['Your name', 'Votre nom', '你的名字'],
  email: ['Email', 'Adresse e-mail', '邮箱'],
  ownerEmailFixed: [
    'This server is set up for this email.',
    'Ce serveur est configuré pour cette adresse e-mail.',
    '此服务器已为此邮箱配置。',
  ],
  create: ['Create account', 'Créer le compte', '创建账户'],
  creating: ['Creating…', 'Création…', '创建中…'],

  badLinkTitle: ['This link doesn’t work.', 'Ce lien ne fonctionne pas.', '此链接无效。'],
  badLink: [
    'Use the setup link from the server’s log or from setup.sh.',
    'Utilisez le lien de configuration du journal du serveur ou de setup.sh.',
    '请使用服务器日志或 setup.sh 中的设置链接。',
  ],
  doneTitle: ['This server is set up.', 'Ce serveur est configuré.', '此服务器已完成设置。'],
  done: [
    'It already has an owner. Sign in to continue.',
    'Il a déjà un propriétaire. Connectez-vous pour continuer.',
    '它已有所有者。请登录以继续。',
  ],
  signIn: ['Sign in', 'Se connecter', '登录'],
  tooMany: [
    'Too many attempts. Try again in a few minutes.',
    'Trop de tentatives. Réessayez dans quelques minutes.',
    '尝试次数过多。请几分钟后重试。',
  ],
  couldntReach: [
    'Couldn’t reach Tuff. Check your connection and try again.',
    'Impossible de joindre Tuff. Vérifiez votre connexion et réessayez.',
    '无法连接 Tuff。请检查网络后重试。',
  ],
})
