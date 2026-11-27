import { say } from '../data/words.js'

/**
 * A project's feedback page — `ui/FeedbackPage.tsx`, the settings section in
 * `ui/FeedbackSettings.tsx` and the line on a task that came from it.
 */
export const FEEDBACK = say({
  /* The public page. */
  title: [(page: string) => `${page} feedback`, (page: string) => `Retours ${page}`, (page: string) => `${page} 反馈`],
  askHead: ['Send a request', 'Envoyer une demande', '发送请求'],
  askTitle: ['What would you like?', 'Que souhaitez-vous ?', '你需要什么？'],
  askBody: ['Tell us more (optional)', 'Dites-nous en plus (facultatif)', '补充说明（可选）'],
  askEmail: ['Your email', 'Votre e-mail', '你的邮箱'],
  emailUse: [
    'We only use your email to confirm your request and tell you about it.',
    'Votre e-mail sert uniquement à confirmer votre demande et à vous en donner des nouvelles.',
    '我们只会用你的邮箱确认请求并告知进展。',
  ],
  send: ['Send', 'Envoyer', '发送'],
  sending: ['Sending…', 'Envoi…', '发送中…'],
  sendingAs: [
    (email: string) => `Sending as ${email}`,
    (email: string) => `Envoi en tant que ${email}`,
    (email: string) => `以 ${email} 身份发送`,
  ],
  notYou: ['Not you?', 'Ce n’est pas vous ?', '不是你？'],
  checkEmail: ['Check your email', 'Vérifiez votre messagerie', '请查收邮件'],
  checkEmailBody: [
    (email: string) => `We sent a link to ${email}. Open it to confirm your request.`,
    (email: string) => `Nous avons envoyé un lien à ${email}. Ouvrez-le pour confirmer votre demande.`,
    (email: string) => `我们已向 ${email} 发送链接。打开即可确认你的请求。`,
  ],
  sent: ['Request sent', 'Demande envoyée', '请求已发送'],
  sentBody: ['Thanks. The team will see it.', 'Merci. L’équipe la verra.', '谢谢，团队会看到。'],
  another: ['Send another request', 'Envoyer une autre demande', '再发送一个请求'],
  failed: ['Couldn’t send your request. Try again.', 'Impossible d’envoyer votre demande. Réessayez.', '无法发送请求，请重试。'],
  missing: ['This page doesn’t exist.', 'Cette page n’existe pas.', '此页面不存在。'],
  missingBody: ['Check the address and try again.', 'Vérifiez l’adresse et réessayez.', '请检查地址后重试。'],
  unavailable: ['This page isn’t available right now.', 'Cette page n’est pas disponible pour le moment.', '此页面目前不可用。'],
  /* The page a mailed link opens. */
  confirmHead: ['Confirm your request', 'Confirmez votre demande', '确认你的请求'],
  confirmFrom: [(email: string) => `From ${email}`, (email: string) => `De ${email}`, (email: string) => `来自 ${email}`],
  confirm: ['Confirm request', 'Confirmer la demande', '确认请求'],
  confirming: ['Confirming…', 'Confirmation…', '确认中…'],
  confirmed: ['Request confirmed', 'Demande confirmée', '请求已确认'],
  confirmedBody: ['Thanks. The team will see it.', 'Merci. L’équipe la verra.', '谢谢，团队会看到。'],
  linkGone: ['This link has expired or was already used.', 'Ce lien a expiré ou a déjà été utilisé.', '此链接已过期或已被使用。'],
  backToPage: ['Go to the page', 'Aller à la page', '前往页面'],

  /* The project's settings. */
  head: ['Feedback page', 'Page de retours', '反馈页面'],
  on: ['Feedback page', 'Page de retours', '反馈页面'],
  hint: [
    'A public page where anyone can send you requests. They arrive as tasks in Triage.',
    'Une page publique où chacun peut vous envoyer des demandes. Elles arrivent sous forme de tâches dans la liste Triage.',
    '一个公开页面，任何人都可以向你发送请求。它们会以任务形式进入「分诊」。',
  ],
  address: ['Address', 'Adresse', '地址'],
  addressTaken: ['That address is taken.', 'Cette adresse est déjà prise.', '该地址已被占用。'],
  addressBad: [
    'Use 3 to 40 lowercase letters, numbers and dashes.',
    'Utilisez de 3 à 40 lettres minuscules, chiffres et tirets.',
    '请使用 3–40 个小写字母、数字和连字符。',
  ],
  name: ['Name', 'Nom', '名称'],
  intro: ['Intro', 'Introduction', '简介'],
  introHint: ['One line at the top of the page', 'Une ligne en haut de la page', '页面顶部的一行文字'],
  copy: ['Copy', 'Copier', '复制'],
  copied: ['Copied', 'Copié', '已复制'],
  open: ['Open', 'Ouvrir', '打开'],
  follow: ['Tell me about new requests', 'Me prévenir des nouvelles demandes', '有新请求时通知我'],
  addsTriage: [
    'Turning this on adds a Triage list where requests arrive.',
    'L’activer ajoute une liste Triage où arrivent les demandes.',
    '开启后会添加一个接收请求的「分诊」列表。',
  ],
  noTriage: [
    'Requests go to your first list. Turn on Triage to review them first.',
    'Les demandes vont dans votre première liste. Activez Triage pour les examiner d’abord.',
    '请求会进入你的第一个列表。开启分诊可先审核它们。',
  ],
  managersOnly: [
    'Only people who manage this project can change this.',
    'Seules les personnes qui gèrent ce projet peuvent modifier ceci.',
    '只有管理此项目的人才能更改。',
  ],
  couldntSave: ['Couldn’t save. Try again.', 'Impossible d’enregistrer. Réessayez.', '保存失败，请重试。'],

  /* A task that came from the page. */
  askedBy: [
    (email: string) => `Asked on the feedback page by ${email}`,
    (email: string) => `Demandé sur la page de retours par ${email}`,
    (email: string) => `由 ${email} 在反馈页面提出`,
  ],
  asked: ['Asked on the feedback page', 'Demandé sur la page de retours', '在反馈页面提出'],
})
