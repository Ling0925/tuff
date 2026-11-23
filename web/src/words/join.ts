import { say } from '../data/words.js'

/** Following an invitation — `ui/Join.tsx`. */
export const JOIN = say({
  docTitle: ['Join — Tuff', 'Rejoindre — Tuff', '加入 — Tuff'],
  couldntJoin: ['Couldn’t join. Try again.', 'Impossible de rejoindre l’espace de travail. Réessayez.', '无法加入，请重试。'],
  enterAll: [
    'Enter your name, email and password.',
    'Saisissez votre nom, votre adresse e-mail et votre mot de passe.',
    '请输入你的名字、邮箱和密码。',
  ],
  codeMismatch: ['That code didn’t match.', 'Ce code ne correspond pas.', '验证码不匹配。'],
  /* Signed in with an address nobody has proved yet. */
  confirmFirst: [
    'Confirm your email first. Open the link we sent you to choose a password, then join.',
    'Confirmez d’abord votre adresse e-mail. Ouvrez le lien que nous vous avons envoyé pour choisir un mot de passe, puis rejoignez l’espace.',
    '请先确认邮箱。打开我们发送的链接设置密码，然后加入。',
  ],
  /* The same, on your own server with no mail set up. */
  confirmFirstNoMail: [
    'Your email isn’t confirmed, and this server can’t send email yet. Ask the server’s owner to set up email, or to invite you again.',
    'Votre adresse e-mail n’est pas confirmée, et ce serveur ne peut pas encore envoyer d’e-mails. Demandez au propriétaire du serveur de configurer l’envoi d’e-mails, ou de vous inviter à nouveau.',
    '你的邮箱尚未确认，且此服务器还不能发送邮件。请联系服务器所有者配置邮件，或重新邀请你。',
  ],
  noLonger: ['This link is no longer valid', 'Ce lien n’est plus valide', '此链接已失效'],
  noLongerBody: [
    'It was already used, it expired, or it was cancelled. Ask the person who invited you for a new one.',
    'Il a déjà été utilisé, il a expiré ou il a été annulé. Demandez-en un nouveau à la personne qui vous a envoyé l’invitation.',
    '它已被使用、已过期或被取消。请向邀请你的人索取新链接。',
  ],
  theWorkspace: ['the workspace', 'l’espace de travail', '工作区'],
  alreadyIn: [
    (where: string) => `You’re already in ${where}`,
    (where: string) => `Vous êtes déjà dans ${where}`,
    (where: string) => `你已在 ${where} 中`,
  ],
  signedInAnd: [
    (name: string, where: string) => `You’re signed in as ${name}, and ${where} is one of your workspaces.`,
    (name: string, where: string) => `Vous êtes connecté en tant que ${name}, et ${where} fait partie de vos espaces de travail.`,
    (name: string, where: string) => `你已以 ${name} 身份登录，${where} 是你的工作区之一。`,
  ],
  open: [(where: string) => `Open ${where}`, (where: string) => `Ouvrir ${where}`, (where: string) => `打开 ${where}`],
  join: [(where: string) => `Join ${where}`, (where: string) => `Rejoindre ${where}`, (where: string) => `加入 ${where}`],
  signedInAs: [
    (name: string, email: string) => `You’re signed in as ${name} (${email}).`,
    (name: string, email: string) => `Vous êtes connecté en tant que ${name} (${email}).`,
    (name: string, email: string) => `你已以 ${name}（${email}）身份登录。`,
  ],
  sentTo: [
    (email: string) => `This invitation was sent to ${email}.`,
    (email: string) => `Cette invitation a été envoyée à ${email}.`,
    (email: string) => `此邀请已发送至 ${email}。`,
  ],
  joining: ['Joining…', 'Un instant…', '正在加入…'],
  anotherAccount: ['Use another account', 'Utiliser un autre compte', '使用其他账户'],
  newOrNot: [
    'New to Tuff? Choose a password. Already have an account? Use its email and password.',
    'Première fois sur Tuff ? Choisissez un mot de passe. Vous avez déjà un compte ? Utilisez son adresse e-mail et son mot de passe.',
    '第一次使用 Tuff？请设置密码。已有账户？请使用其邮箱和密码。',
  ],
  yourName: ['Your name', 'Votre nom', '你的名字'],
  email: ['Email', 'Adresse e-mail', '邮箱'],
  code: ['Code from your app, or a recovery code', 'Code de votre application, ou code de secours', '应用中的验证码，或恢复代码'],
  joinButton: ['Join', 'Rejoindre', '加入'],
})
