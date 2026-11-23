import type { ReactNode } from 'react'
import { say } from '../data/words.js'

/** Signing up — `ui/SignUp.tsx`. */
export const SIGN_UP = say({
  docTitle: ['Get started — Tuff', 'Commencer — Tuff', '开始使用 — Tuff'],
  tooMany: [
    'Too many attempts. Wait a few minutes and try again.',
    'Trop de tentatives. Patientez quelques minutes et réessayez.',
    '尝试次数过多。请等待几分钟后重试。',
  ],
  couldntCreate: [
    'Couldn’t create your account. Check the fields and try again.',
    'Impossible de créer votre compte. Vérifiez les champs et réessayez.',
    '无法创建账户。请检查填写内容后重试。',
  ],
  couldntReach: [
    'Couldn’t reach Tuff. Check your connection and try again.',
    'Impossible de joindre Tuff. Vérifiez votre connexion et réessayez.',
    '无法连接 Tuff。请检查网络后重试。',
  ],
  checkEmail: ['Check your email.', 'Consultez vos e-mails.', '请查收邮件。'],
  differentEmail: ['Use a different email', 'Utiliser une autre adresse e-mail', '使用其他邮箱'],
  start: ['Start a workspace.', 'Créez un espace de travail.', '创建工作区。'],
  yourName: ['Your name', 'Votre nom', '你的名字'],
  email: ['Email', 'Adresse e-mail', '邮箱'],
  notAnEmail: ['That doesn’t look like an email address.', 'Cette adresse e-mail ne semble pas valide.', '这看起来不是有效的邮箱地址。'],
  creating: ['Sending…', 'Envoi…', '发送中…'],
  create: ['Continue', 'Continuer', '继续'],
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
    (terms: ReactNode, privacy: ReactNode) => (
      <>
        我们会通过邮件发送链接，用于确认邮箱并设置密码。继续即表示你接受{terms}和{privacy}。
      </>
    ),
  ],
  terms: ['terms', 'conditions d’utilisation', '服务条款'],
  privacy: ['privacy policy', 'politique de confidentialité', '隐私政策'],
  haveAccount: ['Already have an account?', 'Vous avez déjà un compte ?', '已有账户？'],
  signIn: ['Sign in', 'Se connecter', '登录'],
  /* A server of one's own with no mail set up. */
  noMailTitle: ['Email isn’t set up.', 'L’envoi d’e-mails n’est pas configuré.', '邮件未配置。'],
  noMail: [
    'This server can’t send email yet, so it can’t send the link you need to sign up. Ask someone here to invite you.',
    'Ce serveur ne peut pas encore envoyer d’e-mails, donc il ne peut pas vous envoyer le lien nécessaire pour vous inscrire. Demandez à quelqu’un qui l’utilise de vous inviter.',
    '此服务器还不能发送邮件，因此无法发送注册所需的链接。请让这里的成员邀请你。',
  ],
  /* A server of one's own with sign-up closed. */
  closedTitle: ['Sign-up is closed.', 'Les inscriptions sont fermées.', '注册已关闭。'],
  closed: [
    'This server only lets people in by invitation. Ask someone here to invite you.',
    'Ce serveur n’accepte de nouvelles personnes que sur invitation. Demandez à quelqu’un qui l’utilise de vous inviter.',
    '此服务器仅允许通过邀请加入。请让这里的成员邀请你。',
  ],
})
