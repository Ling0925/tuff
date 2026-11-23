import { say } from '../data/words.js'

/** Setting up email — `ui/MailSettings.tsx`, on the setup screen and in Server settings. */
export const MAIL_SETTINGS = say({
  smtp: ['SMTP', 'SMTP', 'SMTP'],
  resend: ['Resend', 'Resend', 'Resend'],
  host: ['Server', 'Serveur', '服务器'],
  hostPlaceholder: ['smtp.example.com', 'smtp.exemple.com', 'smtp.example.com'],
  port: ['Port', 'Port', '端口'],
  security: ['Security', 'Sécurité', '安全'],
  tls: ['TLS', 'TLS', 'TLS'],
  starttls: ['STARTTLS', 'STARTTLS', 'STARTTLS'],
  none: ['None', 'Aucune', '无'],
  user: ['Username', 'Nom d’utilisateur', '用户名'],
  userPlaceholder: ['Usually your email address', 'Souvent votre adresse e-mail', '通常是你的邮箱地址'],
  password: ['Password', 'Mot de passe', '密码'],
  key: ['API key', 'Clé API', 'API 密钥'],
  keyPlaceholder: ['re_…', 're_…', 're_…'],
  saved: ['Saved', 'Enregistré', '已保存'],
  sender: ['Send from', 'Expéditeur', '发件人'],
  senderPlaceholder: ['Tuff <tuff@example.com>', 'Tuff <tuff@exemple.com>', 'Tuff <tuff@example.com>'],
  fromEnv: ['Set by the server’s environment', 'Défini par l’environnement du serveur', '由服务器环境变量设置'],
  fromEnvHint: [
    'To change it, edit SMTP_URL or RESEND_API_KEY in .env and restart Tuff.',
    'Pour le modifier, changez SMTP_URL ou RESEND_API_KEY dans .env et redémarrez Tuff.',
    '要更改，请编辑 .env 中的 SMTP_URL 或 RESEND_API_KEY 并重启 Tuff。',
  ],
  via: [
    (how: string, sender: string) => `${how}, from ${sender}`,
    (how: string, sender: string) => `${how}, expéditeur ${sender}`,
    (how: string, sender: string) => `${how}，发件人 ${sender}`,
  ],
  couldntSave: [
    'Couldn’t save. Check the fields and try again.',
    'Impossible d’enregistrer. Vérifiez les champs et réessayez.',
    '保存失败。请检查填写内容后重试。',
  ],
})
