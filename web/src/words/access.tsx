import type { ReactNode } from 'react'
import { one, say } from '../data/words.js'

/** The ways in before the app — `ui/Access.tsx`: the password field, the wait for a link, the link's page, a forgotten password. */
export const ACCESS = say({
  password: ['Password', 'Mot de passe', '密码'],
  hidePassword: ['Hide password', 'Masquer le mot de passe', '隐藏密码'],
  showPassword: ['Show password', 'Afficher le mot de passe', '显示密码'],
  longEnough: ['Long enough', 'Assez long', '长度足够'],
  atLeastForNew: ['At least 12 characters for a new account', 'Au moins 12 caractères pour un nouveau compte', '新账户至少 12 个字符'],
  atLeast: ['At least 12 characters', 'Au moins 12 caractères', '至少 12 个字符'],
  moreCharacters: [
    (n: number) => `${n} more character${one(n) ? '' : 's'}`,
    (n: number) => `Encore ${n} caractère${one(n) ? '' : 's'}`,
    (n: number) => `还需 ${n} 个字符`,
  ],

  weSentTo: [
    (email: ReactNode) => <>We sent a link to {email}. Open it to confirm your email and choose a password.</>,
    (email: ReactNode) => (
      <>Nous avons envoyé un lien à {email}. Ouvrez-le pour confirmer votre adresse e-mail et choisir un mot de passe.</>
    ),
    (email: ReactNode) => <>我们已向 {email} 发送链接。打开以确认邮箱并设置密码。</>,
  ],
  linkWorks: [
    'The link works for 24 hours. Can’t find it? Check your spam folder, or send another.',
    'Le lien est valable 24 heures. Vous ne le trouvez pas ? Vérifiez vos spams, ou demandez-en un autre.',
    '链接 24 小时内有效。找不到？请检查垃圾邮件文件夹，或重新发送。',
  ],
  openInbox: [(name: string) => `Open ${name}`, (name: string) => `Ouvrir ${name}`, (name: string) => `打开 ${name}`],
  sending: ['Sending…', 'Envoi…', '发送中…'],
  sentSendAnotherIn: [
    (s: number) => `Sent. Send another in ${s}s`,
    (s: number) => `Envoyé. Renvoyer dans ${s} s`,
    (s: number) => `已发送。${s} 秒后可再次发送`,
  ],
  sendAnotherIn: [(s: number) => `Send another in ${s}s`, (s: number) => `Renvoyer dans ${s} s`, (s: number) => `${s} 秒后可再次发送`],
  sendAnother: ['Send another', 'Renvoyer', '再次发送'],
  couldntSend: [
    'Couldn’t send it. Wait a moment and try again.',
    'Impossible de l’envoyer. Patientez un instant et réessayez.',
    '无法发送。请稍候再试。',
  ],

  confirmingTitle: ['Confirming your email — Tuff', 'Confirmation de votre adresse e-mail — Tuff', '正在确认邮箱 — Tuff'],
  confirming: ['Confirming…', 'Confirmation…', '正在确认…'],
  confirmed: ['Email confirmed.', 'Adresse e-mail confirmée.', '邮箱已确认。'],
  changed: ['Email changed.', 'Adresse e-mail modifiée.', '邮箱已更改。'],
  approved: ['Change approved.', 'Modification approuvée.', '更改已批准。'],
  taken: ['Email not changed.', 'Adresse e-mail non modifiée.', '邮箱未更改。'],
  gone: ['This link is no longer valid.', 'Ce lien n’est plus valide.', '此链接已失效。'],
  failed: ['That didn’t work.', 'Cela n’a pas fonctionné.', '操作失败。'],
  saidConfirmed: [
    'Your email is confirmed. Sign in to continue.',
    'Votre adresse e-mail est confirmée. Connectez-vous pour continuer.',
    '邮箱已确认。请登录以继续。',
  ],
  saidChanged: [
    (email: string) => `From now on, you sign in with ${email}, and emails from Tuff go there.`,
    (email: string) => `Désormais, vous vous connectez avec ${email}, et les e-mails de Tuff y sont envoyés.`,
    (email: string) => `从现在起，请使用 ${email} 登录，Tuff 的邮件也会发送到该地址。`,
  ],
  saidApproved: [
    (email: string) => `We sent a link to ${email}. Open it to finish the change.`,
    (email: string) => `Nous avons envoyé un lien à ${email}. Ouvrez-le pour terminer la modification.`,
    (email: string) => `我们已向 ${email} 发送链接。打开即可完成更改。`,
  ],
  saidTaken: [
    'That email already belongs to another account.',
    'Cette adresse e-mail appartient déjà à un autre compte.',
    '该邮箱已属于另一个账户。',
  ],
  saidGoneMoving: [
    'It was already used or cancelled, or it’s more than a day old. Ask for a new one in Account.',
    'Il a déjà été utilisé ou annulé, ou date de plus d’un jour. Demandez-en un nouveau dans Compte.',
    '它已被使用或取消，或已超过一天。请在「账户」中重新申请。',
  ],
  saidGone: [
    'It was already used, or it’s more than a day old. Sign up again with the same email to get a new one.',
    'Il a déjà été utilisé, ou date de plus d’un jour. Inscrivez-vous de nouveau avec la même adresse e-mail pour en recevoir un nouveau.',
    '它已被使用，或已超过一天。请用同一邮箱重新注册以获取新链接。',
  ],
  saidFailed: [
    'Couldn’t reach Tuff. Check your connection and open the link again.',
    'Impossible de joindre Tuff. Vérifiez votre connexion et rouvrez le lien.',
    '无法连接 Tuff。请检查网络并重新打开链接。',
  ],
  openTuff: ['Open Tuff', 'Ouvrir Tuff', '打开 Tuff'],
  signIn: ['Sign in', 'Se connecter', '登录'],

  withGoogle: ['Continue with Google', 'Continuer avec Google', '使用 Google 继续'],
  withApple: ['Continue with Apple', 'Continuer avec Apple', '使用 Apple 继续'],
  withGithub: ['Continue with GitHub', 'Continuer avec GitHub', '使用 GitHub 继续'],
  orWithEmail: ['or with email', 'ou par e-mail', '或使用邮箱'],
  troubleConflict: [
    'An account with that email already exists, and the provider didn’t confirm it’s yours. Sign in with your password instead.',
    'Un compte existe déjà avec cette adresse e-mail, et le fournisseur n’a pas confirmé qu’il vous appartient. Connectez-vous plutôt avec votre mot de passe.',
    '该邮箱已有账户，且提供方未能确认它属于你。请改用密码登录。',
  ],
  troubleGithub: [
    'An account with that email already exists. Sign in the way you usually do.',
    'Un compte existe déjà avec cette adresse e-mail. Connectez-vous comme d’habitude.',
    '该邮箱已有账户。请用你常用的方式登录。',
  ],
  troubleNoEmail: [
    'Your GitHub account has no verified email. Add one on GitHub, or sign up with your email.',
    'Votre compte GitHub n’a aucune adresse e-mail vérifiée. Ajoutez-en une sur GitHub, ou inscrivez-vous avec votre adresse e-mail.',
    '你的 GitHub 账户没有已验证的邮箱。请在 GitHub 上添加，或使用邮箱注册。',
  ],
  troubleExpired: ['That took too long. Try again.', 'Le délai est dépassé. Réessayez.', '操作超时，请重试。'],
  troubleOff: ['This sign-in method isn’t set up.', 'Ce mode de connexion n’est pas configuré.', '此登录方式尚未配置。'],
  troubleFailed: [
    'Couldn’t sign you in. Try again, or sign in with your email.',
    'Impossible de vous connecter. Réessayez, ou connectez-vous avec votre adresse e-mail.',
    '无法登录。请重试，或使用邮箱登录。',
  ],
  closedTitle: ['Sign-up is closed.', 'Les inscriptions sont fermées.', '注册已关闭。'],
  troubleClosed: [
    'Sign-up is closed on this server. Ask someone here for an invitation.',
    'Les inscriptions sont fermées sur ce serveur. Demandez une invitation à quelqu’un qui l’utilise.',
    '此服务器已关闭注册。请向这里的成员索取邀请。',
  ],
  /* A link handed over by hand, followed with a provider's account at
     another address. */
  troubleElsewhere: [
    'This invitation is for a different email address. Continue with the account for that address, or sign up with it below.',
    'Cette invitation est destinée à une autre adresse e-mail. Continuez avec le compte de cette adresse, ou inscrivez-vous avec elle ci-dessous.',
    '此邀请面向另一个邮箱地址。请用该地址的账户继续，或在下方用它注册。',
  ],

  forgotTitle: ['Forgot your password — Tuff', 'Mot de passe oublié — Tuff', '忘记密码 — Tuff'],
  forgot: ['Forgot your password?', 'Mot de passe oublié ?', '忘记密码？'],
  forgotSent: [
    (email: string) => `If there’s an account for ${email}, we sent a link to set a new password. It works for an hour.`,
    (email: string) =>
      `Si un compte existe pour ${email}, nous avons envoyé un lien pour définir un nouveau mot de passe. Il est valable une heure.`,
    (email: string) => `如果 ${email} 有对应账户，我们已发送设置新密码的链接，1 小时内有效。`,
  ],
  forgotAsk: [
    'Enter your email and we’ll send you a link to set a new password.',
    'Saisissez votre adresse e-mail et nous vous enverrons un lien pour définir un nouveau mot de passe.',
    '输入你的邮箱，我们会发送设置新密码的链接。',
  ],
  email: ['Email', 'Adresse e-mail', '邮箱'],
  sendLink: ['Send link', 'Envoyer le lien', '发送链接'],
  /* Your own server with no mail set up. */
  forgotNoMail: [
    'This server can’t send email yet, so it can’t send you a link to reset your password. Ask the server’s owner to set up email in Server settings.',
    'Ce serveur ne peut pas encore envoyer d’e-mails, donc il ne peut pas vous envoyer de lien pour réinitialiser votre mot de passe. Demandez au propriétaire du serveur de configurer l’envoi d’e-mails dans les paramètres du serveur.',
    '此服务器还不能发送邮件，因此无法发送重置密码的链接。请联系服务器所有者在「服务器设置」中配置邮件。',
  ],
  unconfirmedTitle: ['Your email isn’t confirmed.', 'Votre adresse e-mail n’est pas confirmée.', '你的邮箱尚未确认。'],
  unconfirmedNoMail: [
    'This server can’t send email yet, so it can’t send you the link to confirm it. Ask the server’s owner to set up email, or to invite you again.',
    'Ce serveur ne peut pas encore envoyer d’e-mails, donc il ne peut pas vous envoyer le lien pour la confirmer. Demandez au propriétaire du serveur de configurer l’envoi d’e-mails, ou de vous inviter à nouveau.',
    '此服务器还不能发送邮件，因此无法发送确认链接。请联系服务器所有者配置邮件，或重新邀请你。',
  ],
  backToSignIn: ['Back to sign in', 'Retour à la connexion', '返回登录'],

  resetTitle: ['Set a new password — Tuff', 'Nouveau mot de passe — Tuff', '设置新密码 — Tuff'],
  reset: ['Set a new password.', 'Définissez un nouveau mot de passe.', '设置新密码。'],
  resetDone: [
    'Password changed. Every device that was signed in with the old password has been signed out.',
    'Mot de passe modifié. Tous les appareils connectés avec l’ancien mot de passe ont été déconnectés.',
    '密码已修改。所有使用旧密码登录的设备都已退出登录。',
  ],
  resetGone: [
    (askAgain: ReactNode) => <>This link was already used or has expired. {askAgain}.</>,
    (askAgain: ReactNode) => <>Ce lien a déjà été utilisé ou a expiré. {askAgain}.</>,
    (askAgain: ReactNode) => <>此链接已被使用或已过期。{askAgain}。</>,
  ],
  askNew: ['Ask for a new one', 'Demandez-en un nouveau', '重新申请'],
  newPassword: ['New password', 'Nouveau mot de passe', '新密码'],
  couldntSet: ['Couldn’t set the password. Try again.', 'Impossible de définir le mot de passe. Réessayez.', '无法设置密码，请重试。'],
  setPassword: ['Set password', 'Définir le mot de passe', '设置密码'],

  /* The first password, chosen from the sign-up letter — or from an old
     confirmation link, which took the one the account held. */
  chooseTitle: ['Choose a password — Tuff', 'Choisir un mot de passe — Tuff', '选择密码 — Tuff'],
  choose: ['Choose a password.', 'Choisissez un mot de passe.', '选择一个密码。'],
  saidChoose: [
    'Choose a password to finish signing up. You’ll use it with your email to sign in.',
    'Choisissez un mot de passe pour terminer votre inscription. Vous l’utiliserez avec votre adresse e-mail pour vous connecter.',
    '选择一个密码以完成注册。登录时将使用它和你的邮箱。',
  ],
  chooseDone: ['Password set. Sign in to continue.', 'Mot de passe défini. Connectez-vous pour continuer.', '密码已设置。请登录以继续。'],
})
