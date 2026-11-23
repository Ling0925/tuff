import { say } from '../data/words.js'

/** Your own server's owner screen — `ui/Instance.tsx`. */
export const INSTANCE = say({
  title: ['Server settings', 'Paramètres du serveur', '服务器设置'],

  signUp: ['Sign-up', 'Inscriptions', '注册'],
  anyone: ['Anyone can create an account', 'Tout le monde peut créer un compte', '任何人都可以创建账户'],
  anyoneHint: [
    'Off: people join when someone invites them.',
    'Désactivé : on rejoint le serveur sur invitation.',
    '关闭：成员只能通过邀请加入。',
  ],

  owners: ['Owners', 'Propriétaires', '所有者'],
  ownersHint: [
    'Owners see this page. The server always keeps at least one.',
    'Les propriétaires voient cette page. Le serveur en garde toujours au moins un.',
    '所有者可以查看此页面。服务器始终至少保留一位。',
  ],
  you: ['You', 'Vous', '你'],
  remove: ['Remove', 'Retirer', '移除'],
  addPlaceholder: ['Email of an existing account', 'E-mail d’un compte existant', '已有账户的邮箱'],
  add: ['Add owner', 'Ajouter', '添加所有者'],
  noAccount: ['No account has that email.', 'Aucun compte n’utilise cette adresse e-mail.', '没有账户使用该邮箱。'],
  unconfirmed: [
    'That account hasn’t confirmed its email yet.',
    'Ce compte n’a pas encore confirmé son adresse e-mail.',
    '该账户尚未确认邮箱。',
  ],
  lastOwner: ['The server needs at least one owner.', 'Le serveur doit avoir au moins un propriétaire.', '服务器至少需要一位所有者。'],

  email: ['Email', 'E-mail', '邮箱'],
  mailOn: ['Email is set up.', 'L’envoi d’e-mails est configuré.', '邮件已配置。'],
  mailOff: [
    'Email isn’t set up, so no emails are sent.',
    'L’envoi d’e-mails n’est pas configuré : aucun e-mail n’est envoyé.',
    '邮件未配置，因此不会发送任何邮件。',
  ],
  testLetter: ['Send a test email', 'Envoyer un e-mail de test', '发送测试邮件'],
  testHint: ['It goes to your own email.', 'Il est envoyé à votre propre adresse e-mail.', '将发送到你自己的邮箱。'],
  sent: ['Sent. Check your inbox.', 'Envoyé. Consultez votre boîte de réception.', '已发送。请查收。'],
  sentToLog: ['Written to the server’s log.', 'Écrit dans le journal du serveur.', '已写入服务器日志。'],
  notSent: [
    'Couldn’t send it. Check the server’s log.',
    'Impossible de l’envoyer. Consultez le journal du serveur.',
    '无法发送。请查看服务器日志。',
  ],
  /* Setting mail up here. */
  connect: ['Connect', 'Connecter', '连接'],
  save: ['Save', 'Enregistrer', '保存'],
  saving: ['Saving…', 'Enregistrement…', '保存中…'],
  savedSaid: ['Saved.', 'Enregistré.', '已保存。'],
  disconnect: ['Disconnect', 'Déconnecter', '断开连接'],
  /* Proving it is them before mail changes. */
  proveIt: [
    'To save or disconnect, confirm it’s you.',
    'Pour enregistrer ou déconnecter, confirmez votre identité.',
    '要保存或断开连接，请确认是你本人。',
  ],
  yourPassword: ['Your password', 'Votre mot de passe', '你的密码'],
  codeFromAuthenticator: ['Code from your authenticator app', 'Code de votre application d’authentification', '身份验证器应用中的验证码'],
  codeFromEmail: ['Code from your email', 'Code reçu par e-mail', '邮件中的验证码'],
  notThem: ['That didn’t match. Try again.', 'Cela ne correspond pas. Réessayez.', '不匹配，请重试。'],

  version: ['Version', 'Version', '版本'],
  running: [(v: string) => `Version ${v}`, (v: string) => `Version ${v}`, (v: string) => `版本 ${v}`],
  checkOn: [
    'Tuff checks for new versions once a day.',
    'Tuff recherche une nouvelle version une fois par jour.',
    'Tuff 每天检查一次新版本。',
  ],
  checkOff: ['Checking for new versions is off.', 'La recherche de nouvelles versions est désactivée.', '已关闭新版本检查。'],
  unreleased: [
    'A development build. It doesn’t check for new versions.',
    'Une version de développement. Elle ne recherche pas de nouvelles versions.',
    '开发版本，不检查新版本。',
  ],
  isOut: [(v: string) => `Version ${v} is out`, (v: string) => `La version ${v} est disponible`, (v: string) => `版本 ${v} 已发布`],
  securityUpdate: ['Security update', 'Mise à jour de sécurité', '安全更新'],
  howToUpdate: [
    'To update, run this on the server:',
    'Pour mettre à jour, exécutez cette commande sur le serveur :',
    '要更新，请在服务器上运行：',
  ],
  releaseNotes: ['Release notes', 'Notes de version', '发布说明'],
  updateAvailable: ['A security update is available', 'Une mise à jour de sécurité est disponible', '有可用的安全更新'],
  /* After an update. */
  updatedFromTo: [
    (from: string, to: string) => `Updated from version ${from} to ${to}`,
    (from: string, to: string) => `Mis à jour de la version ${from} vers la version ${to}`,
    (from: string, to: string) => `已从版本 ${from} 更新到 ${to}`,
  ],
  updatedTo: [
    (to: string) => `Updated to version ${to}`,
    (to: string) => `Mis à jour vers la version ${to}`,
    (to: string) => `已更新到版本 ${to}`,
  ],
  backupAt: ['Backup from before the update:', 'Sauvegarde d’avant la mise à jour :', '更新前的备份：'],
  noChanges: [
    'No database changes, so no backup was needed.',
    'Aucune modification de la base de données, donc aucune sauvegarde.',
    '数据库没有变更，无需备份。',
  ],
  backupSkipped: [
    'No backup was taken: SKIP_PRE_MIGRATION_BACKUP is set.',
    'Aucune sauvegarde n’a été faite : SKIP_PRE_MIGRATION_BACKUP est défini.',
    '未创建备份：已设置 SKIP_PRE_MIGRATION_BACKUP。',
  ],
  noBackup: [
    'No backup was taken: no backup folder is set (BACKUP_DIR).',
    'Aucune sauvegarde n’a été faite : aucun dossier de sauvegarde n’est défini (BACKUP_DIR).',
    '未创建备份：未设置备份目录（BACKUP_DIR）。',
  ],
  backupNotAVolume: [
    'No backup was taken: the backup folder isn’t a volume, so a backup there would be lost with the container.',
    'Aucune sauvegarde n’a été faite : le dossier des sauvegardes n’est pas un volume, elle aurait été perdue avec le conteneur.',
    '未创建备份：备份目录不是卷，备份会随容器一起丢失。',
  ],
  backupPostgresNewer: [
    'No backup was taken: the database runs a newer Postgres than this version can back up.',
    'Aucune sauvegarde n’a été faite : la base de données utilise une version de Postgres plus récente que celle que cette version sait sauvegarder.',
    '未创建备份：数据库的 Postgres 版本比此版本支持备份的更新。',
  ],
  changes: [
    (n: number) => (n === 1 ? '1 database change' : `${n} database changes`),
    (n: number) => (n === 1 ? '1 modification de la base de données' : `${n} modifications de la base de données`),
    (n: number) => `${n} 项数据库变更`,
  ],
  dismiss: ['Dismiss', 'Ignorer', '忽略'],

  tooMany: [
    'Too many attempts. Try again in a few minutes.',
    'Trop de tentatives. Réessayez dans quelques minutes.',
    '尝试次数过多。请几分钟后重试。',
  ],
  failed: ['Couldn’t save that. Try again.', 'Impossible d’enregistrer. Réessayez.', '保存失败，请重试。'],
})
