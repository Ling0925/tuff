import { say } from '../data/words.js'

/** A new workspace — `ui/NewWorkspace.tsx`. */
export const NEW_WORKSPACE = say({
  addressTaken: ['That address was just taken.', 'Cette adresse vient d’être prise.', '该地址刚被占用。'],
  couldntCreate: [
    'Couldn’t create the workspace. Try again.',
    'Impossible de créer l’espace de travail. Réessayez.',
    '无法创建工作区，请重试。',
  ],
  /* Refused on a server of one's own with sign-up closed. */
  onlyOwners: [
    'Only this server’s owners can create workspaces.',
    'Seuls les propriétaires de ce serveur peuvent créer des espaces de travail.',
    '只有此服务器的所有者可以创建工作区。',
  ],
  newWorkspace: ['New workspace', 'Nouvel espace de travail', '新建工作区'],
  creating: ['Creating…', 'Création…', '创建中…'],
  create: ['Create workspace', 'Créer l’espace de travail', '创建工作区'],
  name: ['Name', 'Nom', '名称'],
  address: ['Address', 'Adresse', '地址'],
  icon: ['Icon', 'Icône', '图标'],
  removePicture: ['Remove picture', 'Retirer l’image', '移除图片'],
  symbol: ['Symbol', 'Symbole', '符号'],
  firstLetter: ['First letter', 'Première lettre', '首字母'],
  colour: ['Colour', 'Couleur', '颜色'],
  uploadPicture: ['Upload picture', 'Importer une image', '上传图片'],
  available: ['Available', 'Disponible', '可用'],
  shape: [
    'Use 3 to 40 letters, numbers and hyphens.',
    'Utilisez de 3 à 40 lettres, chiffres et tirets.',
    '请使用 3–40 个字母、数字和连字符。',
  ],
  taken: ['Taken.', 'Déjà prise.', '已被占用。'],
  isAvailable: [(slug: string) => `${slug} is available`, (slug: string) => `${slug} est disponible`, (slug: string) => `${slug} 可用`],
  goToWorkspace: ['Go to the workspace', 'Aller à l’espace de travail', '前往工作区'],
  skip: ['Skip', 'Passer', '跳过'],
  sending: ['Sending…', 'Envoi…', '发送中…'],
  sendMany: [(n: number) => `Send ${n} invitations`, (n: number) => `Envoyer ${n} invitations`, (n: number) => `发送 ${n} 个邀请`],
  sendOne: ['Send invitation', 'Envoyer l’invitation', '发送邀请'],
  isReady: [
    (name: string) => `${name} is ready. Who do you want to invite?`,
    (name: string) => `${name} est prêt. Qui voulez-vous inviter ?`,
    (name: string) => `${name} 已就绪。你想邀请谁？`,
  ],
  peopleHint: [
    'Each address gets an email invitation, valid for 7 days.',
    'Chaque adresse reçoit une invitation par e-mail, valable 7 jours.',
    '每个地址会收到邮件邀请，有效期 7 天。',
  ],
  notSentOne: ['This invitation wasn’t sent.', 'Cette invitation n’a pas été envoyée.', '此邀请未发送。'],
  notSentMany: [
    (n: number) => `${n} invitations weren’t sent.`,
    (n: number) => `${n} invitations n’ont pas été envoyées.`,
    (n: number) => `${n} 个邀请未发送。`,
  ],
})
